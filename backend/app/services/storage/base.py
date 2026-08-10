"""Storage provider 抽象基类与通用工具。

所有对象存储 Provider（七牛云 / AWS S3 / none）都实现 `StorageProvider`，
业务代码只依赖 `get_storage_service()` 返回的实例，不感知底层实现。
"""
from __future__ import annotations

import re
import uuid
from abc import ABC, abstractmethod
from datetime import date
from typing import Dict, Optional

# media_type -> 仓库内目录名（用于 object key 与七牛前缀映射）
MEDIA_DIRS = {
    "img": "images",
    "video": "videos",
    "document": "documents",
    "other": "other",
}

EXT_CONTENT_TYPES = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "webp": "image/webp",
    "gif": "image/gif",
    "mp4": "video/mp4",
    "webm": "video/webm",
    "mov": "video/quicktime",
    "pdf": "application/pdf",
    "txt": "text/plain",
    "json": "application/json",
}

FALLBACK_CONTENT_TYPE = "application/octet-stream"


def build_object_key(prefix: str, media_type: str = "img", ext: str = "png") -> str:
    """构造防冲突、避免非法路径的 object key。

    形如：{prefix}/images/2026/08/10/{uuid}.{ext}
    """
    media_dir = MEDIA_DIRS.get(media_type, "other")
    ext = re.sub(r"[^A-Za-z0-9]", "", ext or "bin").lower() or "bin"
    today = date.today()
    base = (prefix or "").strip("/")
    return (
        f"{base}/{media_dir}/{today.year:04d}/{today.month:02d}/"
        f"{today.day:02d}/{uuid.uuid4().hex}.{ext}"
    )


def guess_content_type(ext: str) -> str:
    """根据扩展名推断 Content-Type，未知类型回退 octet-stream。"""
    return EXT_CONTENT_TYPES.get((ext or "").lower(), FALLBACK_CONTENT_TYPE)


def guess_ext(resp_content_type: str, url: str = "") -> str:
    """根据上游 Content-Type / URL 推断扩展名，未知回退 png。"""
    ct = (resp_content_type or "").lower()
    if "jpeg" in ct or url.lower().endswith(".jpg"):
        return "jpg"
    if "webp" in ct:
        return "webp"
    if "gif" in ct:
        return "gif"
    if "video" in ct or ".mp4" in url.lower():
        return "mp4"
    if "webm" in ct or ".webm" in url.lower():
        return "webm"
    return "png"


class StorageUploadResult(Dict):
    """统一上传返回结构：{provider, key, url, size}。"""


class StorageProvider(ABC):
    name = "base"

    @abstractmethod
    def upload_bytes(
        self,
        data: bytes,
        media_type: str = "img",
        ext: str = "png",
        content_type: Optional[str] = None,
    ) -> Optional[StorageUploadResult]:
        """上传内存中的原始字节。未转存（none provider）时返回 None。"""

    @abstractmethod
    def upload_from_url(
        self,
        source_url: str,
        media_type: str = "img",
        ext: Optional[str] = None,
        content_type: Optional[str] = None,
    ) -> Optional[StorageUploadResult]:
        """从上游 URL 下载并转存。未转存（none provider）时返回 None。

        大文件（视频）必须流式/临时文件方式处理，避免整块载入内存。
        """

    @abstractmethod
    def get_display_url(self, key: str) -> str:
        """返回对象可读的访问 URL。

        私有 S3 bucket 应返回动态 presigned URL；配置了公开/CDN 域名则返回稳定 URL。
        """