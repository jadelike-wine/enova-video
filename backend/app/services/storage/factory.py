"""Storage Factory：根据配置返回对应 Provider，并集中处理 Provider 选择逻辑。

业务代码（images / videos router、video poller）只调用 `get_storage_service()`，
不感知底层是 Qiniu 还是 S3。
"""
from __future__ import annotations

from typing import Dict, Optional

from app.services.storage.base import StorageProvider
from app.services.storage.none import NoneProvider
from app.services.storage.qiniu import QiniuProvider
from app.services.storage.s3 import S3Provider
from app.services.storage_settings import get_storage_provider
from app.core.logging import get_logger

logger = get_logger(__name__)

_PRESIGNED_READ_URL_SUPPORTED = ("s3",)

_instance: Optional[StorageProvider] = None


def get_storage_service() -> StorageProvider:
    """返回当前配置对应的 StorageProvider 单例。"""
    global _instance
    if _instance is None:
        _instance = _build_provider()
    return _instance


def _build_provider() -> StorageProvider:
    provider = get_storage_provider()
    if provider == "s3":
        logger.info("Storage provider selected: s3")
        return S3Provider()
    if provider == "qiniu":
        logger.info("Storage provider selected: qiniu")
        return QiniuProvider()
    logger.info("Storage provider selected: none")
    return NoneProvider()


def resolve_display_url(row: Dict) -> str:
    """根据数据库行（含 storage_provider / storage_key / qiniu_url / output_url）
    计算前端展示用的媒体 URL。

    私有 S3 记录：动态生成 presigned URL（不落库）；公开/CDN 或七牛：返回稳定 URL。
    """
    provider = row.get("storage_provider")
    key = row.get("storage_key")
    if provider in _PRESIGNED_READ_URL_SUPPORTED and key:
        try:
            return get_storage_service().get_display_url(key)
        except Exception as e:  # noqa: BLE001 - presigned 生成失败不应阻断展示
            logger.warning("生成存储访问 URL 失败 provider=%s key=%s: %s", provider, key, e)
            return row.get("qiniu_url") or row.get("output_url") or ""
    return row.get("qiniu_url") or row.get("output_url") or ""