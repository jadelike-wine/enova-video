"""none StorageProvider：不转存，直接使用 Agnes 原始 URL。"""
from __future__ import annotations

from typing import Optional

from app.services.storage.base import StorageProvider, StorageUploadResult


class NoneProvider(StorageProvider):
    name = "none"

    def upload_bytes(
        self,
        data: bytes,
        media_type: str = "img",
        ext: str = "png",
        content_type: Optional[str] = None,
    ) -> Optional[StorageUploadResult]:
        return None

    def upload_from_url(
        self,
        source_url: str,
        media_type: str = "img",
        ext: Optional[str] = None,
        content_type: Optional[str] = None,
    ) -> Optional[StorageUploadResult]:
        return None

    def get_display_url(self, key: str) -> str:
        return ""