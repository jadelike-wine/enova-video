from fastapi import APIRouter, HTTPException

from app.schemas import (
    AgnesBaseUrlUpdate,
    ApiKeyCreate,
    ApiKeyUpdate,
    ApiKeyPoolToggle,
    StorageSettingsUpdate,
)
from app.services import api_key_service
from app.services.api_key_pool import api_key_pool
from app.config import is_qiniu_configured
from app.services.storage_settings import (
    set_storage_setting,
    storage_config_snapshot,
    is_storage_ready,
)
from app.services.app_settings_service import (
    DEFAULT_AGNES_BASE_URL,
    get_agnes_base_url,
    set_agnes_base_url,
)

router = APIRouter(prefix="/api/settings", tags=["settings"])

# 网页可编辑的非敏感存储配置项 -> DB key
_STORAGE_FIELD_KEYS = {
    "provider": "storage_provider",
    "aws_region": "aws_region",
    "aws_bucket": "aws_s3_bucket",
    "aws_prefix": "aws_s3_prefix",
    "aws_public_base_url": "aws_s3_public_base_url",
    "aws_endpoint_url": "aws_s3_endpoint_url",
}


def _storage_status() -> dict:
    cfg = storage_config_snapshot()
    return {
        "provider": cfg["provider"],
        "ready": is_storage_ready(),
        "qiniu_configured": cfg["qiniu_configured"],
        "aws_region": cfg["aws_region"],
        "aws_bucket": cfg["aws_bucket"],
        "aws_prefix": cfg["aws_prefix"],
        "aws_public_base_url": cfg["aws_public_base_url"],
        "aws_endpoint_url": cfg["aws_endpoint_url"],
    }


@router.get("/status")
def get_status():
    active = api_key_service.get_active_api_key()
    return {
        "has_active_key": bool(active),
        "key_count": len(api_key_service.list_api_keys()),
        "has_qiniu_config": is_qiniu_configured(),
        "storage": _storage_status(),
        "agnes_base_url": get_agnes_base_url(),
        "default_agnes_base_url": DEFAULT_AGNES_BASE_URL,
    }


@router.get("/storage")
def get_storage():
    return _storage_status()


@router.put("/storage")
def update_storage(body: StorageSettingsUpdate):
    """更新非敏感对象存储配置。凭据（AWS_ACCESS_KEY_ID 等）不在此处管理。"""
    fields = body.model_dump(exclude_unset=True)
    for field, value in fields.items():
        key = _STORAGE_FIELD_KEYS.get(field)
        if key is None:
            continue
        set_storage_setting(key, value if value is not None else "")
    return _storage_status()


@router.get("/base-url")
def get_base_url():
    return {
        "base_url": get_agnes_base_url(),
        "default_base_url": DEFAULT_AGNES_BASE_URL,
    }


@router.put("/base-url")
def update_base_url(body: AgnesBaseUrlUpdate):
    try:
        return {"base_url": set_agnes_base_url(body.base_url)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/api-keys")
def list_api_keys():
    items = api_key_service.list_api_keys()
    pool_status = api_key_pool.pool_status()
    for item in items:
        item["pool_status"] = (
            pool_status.get(item["id"], {}).get("status", "available")
            if item["is_enabled"]
            else "disabled"
        )
    return {"items": items}


@router.post("/api-keys")
def create_api_key(body: ApiKeyCreate):
    try:
        item = api_key_service.create_api_key(
            body.name, body.api_key, activate=body.activate
        )
        api_key_pool.invalidate()
        item["pool_status"] = "available" if item["is_enabled"] else "disabled"
        return item
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/api-keys/{key_id}")
def update_api_key(key_id: int, body: ApiKeyUpdate):
    try:
        item = api_key_service.update_api_key(
            key_id, name=body.name, api_key=body.api_key
        )
        api_key_pool.invalidate()
        return item
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api-keys/{key_id}/pool")
def toggle_pool(key_id: int, body: ApiKeyPoolToggle):
    """开关某个 Key 是否参与视频 Token Pool。"""
    try:
        item = api_key_service.set_enabled(key_id, body.enabled)
        api_key_pool.invalidate()
        return item
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/api-keys/{key_id}/activate")
def activate_api_key(key_id: int):
    try:
        item = api_key_service.activate_api_key(key_id)
        api_key_pool.invalidate()
        return item
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/api-keys/{key_id}")
def delete_api_key(key_id: int):
    try:
        api_key_service.delete_api_key(key_id)
        api_key_pool.invalidate()
        return {"ok": True}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
