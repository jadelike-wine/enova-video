"""系统信息与更新检查路由。

- GET /api/system/version       -> 当前版本 / Git SHA / 构建时间
- GET /api/system/update/check  -> 手动检查更新（只读，不执行升级）

安全：浏览器 -> FastAPI 只做「检查更新」，绝不触达 Docker Socket / 服务器文件系统。
升级/回滚由服务器端 scripts/update.sh、scripts/rollback.sh 或 GitHub Actions 完成。
"""
from fastapi import APIRouter

from app.services import version_service
from app.services.error_utils import ApiError, ERROR_CODES

router = APIRouter(prefix="/api/system", tags=["system"])


@router.get("/version")
def get_version():
    return version_service.version_info()


@router.get("/update/check")
def check_update():
    try:
        return version_service.check_update()
    except version_service.UpdateCheckError as exc:
        # 稳定错误码；只影响本次检查，不影响主应用
        raise ApiError(
            status_code=502,
            detail=f"更新检查失败 ({exc.error_code})",
            error_code=ERROR_CODES["UPDATE_CHECK_FAILED"],
        ) from exc