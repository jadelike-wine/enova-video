"""AWS S3 StorageProvider。

设计要点：
- 使用 boto3 官方 SDK，不手拼 AWS Signature。
- 创建 client 时不硬编码凭据，走 AWS 默认 Credential Provider Chain
  （EC2 IAM Role / ECS Task Role / EKS / AWS_PROFILE / 环境变量），
  AWS_ACCESS_KEY_ID 等均为可选。
- 大文件（视频）通过临时文件 + boto3 Transfer Manager 上传，避免整块载入内存。
- 私有 bucket：数据库只保存稳定 object key，读取时动态生成 presigned URL；
  若配置 AWS_S3_PUBLIC_BASE_URL（CloudFront / 自定义 CDN），则返回稳定公开 URL。
"""
from __future__ import annotations

import os
import tempfile
import threading
import time
from typing import Optional

import boto3
import httpx

from app.services.storage_settings import (
    get_aws_bucket,
    get_aws_endpoint_url,
    get_aws_prefix,
    get_aws_public_base_url,
    get_aws_region,
)
from app.services.storage.base import (
    StorageProvider,
    StorageUploadResult,
    build_object_key,
    guess_content_type,
    guess_ext,
)
from app.services.error_utils import classify_s3_error, ERROR_CODES
from app.core.logging import get_logger

logger = get_logger(__name__)

# presigned GET URL 有效期（秒）
PRESIGNED_URL_TTL = 3600


def _is_video(content_type: str, url: str) -> bool:
    ct = (content_type or "").lower()
    return "video" in ct or ".mp4" in url.lower() or ".webm" in url.lower()


class S3Provider(StorageProvider):
    name = "s3"

    def __init__(self) -> None:
        self._client = None
        self._client_lock = threading.Lock()

    def _get_client(self):
        """懒加载并缓存 boto3 client（线程安全）。region/endpoint 与凭据均来自链路。"""
        if self._client is None:
            with self._client_lock:
                if self._client is None:
                    kwargs = {}
                    region = get_aws_region()
                    if region:
                        kwargs["region_name"] = region
                    endpoint = get_aws_endpoint_url()
                    if endpoint:
                        kwargs["endpoint_url"] = endpoint
                    self._client = boto3.client("s3", **kwargs)
        return self._client

    def _upload_file(self, file_path: str, key: str, content_type: str) -> int:
        bucket = get_aws_bucket()
        if not bucket:
            raise RuntimeError("AWS S3 bucket 未配置")
        size = os.path.getsize(file_path)
        logger.info(
            "Upload started",
            extra={
                "provider": "s3",
                "bucket": bucket,
                "object_key": key,
                "content_type": content_type,
                "size_bytes": size,
            },
        )
        start = time.time()
        try:
            self._get_client().upload_file(
                file_path,
                bucket,
                key,
                ExtraArgs={"ContentType": content_type},
            )
        except Exception as e:
            logger.error(
                "Upload failed",
                exc_info=e,
                extra={
                    "provider": "s3",
                    "bucket": bucket,
                    "object_key": key,
                    "error_code": classify_s3_error(e),
                },
            )
            raise
        duration_ms = int((time.time() - start) * 1000)
        logger.info(
            "Upload completed",
            extra={
                "provider": "s3",
                "bucket": bucket,
                "object_key": key,
                "size_bytes": size,
                "duration_ms": duration_ms,
            },
        )
        return size

    def upload_bytes(
        self,
        data: bytes,
        media_type: str = "img",
        ext: str = "png",
        content_type: Optional[str] = None,
    ) -> Optional[StorageUploadResult]:
        key = build_object_key(get_aws_prefix(), media_type, ext)
        ct = content_type or guess_content_type(ext)
        with tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False) as tmp:
            tmp.write(data)
            tmp_path = tmp.name
        try:
            size = self._upload_file(tmp_path, key, ct)
        finally:
            _safe_unlink(tmp_path)
        return {
            "provider": self.name,
            "key": key,
            "url": self._public_url(key),
            "size": size,
        }

    def upload_from_url(
        self,
        source_url: str,
        media_type: str = "img",
        ext: Optional[str] = None,
        content_type: Optional[str] = None,
    ) -> Optional[StorageUploadResult]:
        with httpx.Client(timeout=120, trust_env=False) as client:
            with client.stream("GET", source_url) as resp:
                resp.raise_for_status()
                upstream_ct = resp.headers.get("content-type", "")
                if not ext:
                    ext = guess_ext(upstream_ct, source_url)
                if _is_video(upstream_ct, source_url):
                    media_type = "video"
                ct = content_type or upstream_ct or guess_content_type(ext)
                key = build_object_key(get_aws_prefix(), media_type, ext)
                with tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False) as tmp:
                    for chunk in resp.iter_bytes():
                        tmp.write(chunk)
                    tmp_path = tmp.name
        try:
            size = self._upload_file(tmp_path, key, ct)
        finally:
            _safe_unlink(tmp_path)
        return {
            "provider": self.name,
            "key": key,
            "url": self._public_url(key),
            "size": size,
        }

    def _public_url(self, key: str) -> str:
        base = get_aws_public_base_url()
        if base:
            return f"{base}/{key}"
        # 私有 bucket：不返回固定 URL，读取时动态生成 presigned URL
        return ""

    def get_display_url(self, key: str) -> str:
        public = self._public_url(key)
        if public:
            return public
        bucket = get_aws_bucket()
        if not bucket:
            return ""
        logger.debug(
            "Generated presigned URL object_key=%s expires_in=%s",
            key,
            PRESIGNED_URL_TTL,
            extra={"provider": "s3", "object_key": key, "expires_in": PRESIGNED_URL_TTL},
        )
        return self._get_client().generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": key},
            ExpiresIn=PRESIGNED_URL_TTL,
        )


def _safe_unlink(path: str) -> None:
    try:
        os.unlink(path)
    except OSError:
        pass