"""七牛云 StorageProvider：包装现有的 qiniu_service，保持既有行为不变。"""
from __future__ import annotations

import time
from typing import Optional

from app.services.qiniu_service import (
    upload_bytes as _qiniu_upload_bytes,
    upload_from_url as _qiniu_upload_from_url,
)
from app.services.storage.base import StorageProvider, StorageUploadResult
from app.services.error_utils import ERROR_CODES
from app.core.logging import get_logger

logger = get_logger(__name__)


class QiniuProvider(StorageProvider):
    name = "qiniu"

    def _log_start(self, media_type: str) -> None:
        logger.info(
            "Upload started",
            extra={"provider": "qiniu", "media_type": media_type},
        )

    def _log_result(self, result: StorageUploadResult | None, duration_ms: int) -> None:
        if result is None:
            return
        logger.info(
            "Upload completed",
            extra={
                "provider": "qiniu",
                "object_key": result["key"],
                "size_bytes": result["size"],
                "duration_ms": duration_ms,
            },
        )

    def upload_bytes(
        self,
        data: bytes,
        media_type: str = "img",
        ext: str = "png",
        content_type: Optional[str] = None,
    ) -> Optional[StorageUploadResult]:
        self._log_start(media_type)
        start = time.time()
        try:
            result = _qiniu_upload_bytes(data, media_type, ext)
        except Exception as e:
            logger.error(
                "Upload failed",
                exc_info=e,
                extra={
                    "provider": "qiniu",
                    "media_type": media_type,
                    "error_code": ERROR_CODES["QINIU_UPLOAD_FAILED"],
                },
            )
            raise
        self._log_result(result, int((time.time() - start) * 1000))
        return {
            "provider": self.name,
            "key": result["key"],
            "url": result["url"],
            "size": result["size"],
        }

    def upload_from_url(
        self,
        source_url: str,
        media_type: str = "img",
        ext: Optional[str] = None,
        content_type: Optional[str] = None,
    ) -> Optional[StorageUploadResult]:
        self._log_start(media_type)
        start = time.time()
        try:
            result = _qiniu_upload_from_url(source_url, media_type, ext)
        except Exception as e:
            logger.error(
                "Upload failed",
                exc_info=e,
                extra={
                    "provider": "qiniu",
                    "media_type": media_type,
                    "error_code": ERROR_CODES["QINIU_UPLOAD_FAILED"],
                },
            )
            raise
        self._log_result(result, int((time.time() - start) * 1000))
        return {
            "provider": self.name,
            "key": result["key"],
            "url": result["url"],
            "size": result["size"],
        }

    def get_display_url(self, key: str) -> str:
        from app.config import QINIU_DOMAIN

        return f"{QINIU_DOMAIN.rstrip('/')}/{key}"