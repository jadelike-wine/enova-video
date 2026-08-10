import asyncio
import time
import uuid
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from apscheduler.schedulers.background import BackgroundScheduler

from app.database import init_db
from app.core.logging import (
    setup_logging,
    set_request_id,
    set_task_id,
    reset_context,
    get_logger,
)
from app.config import (
    validate_config,
    LOG_LEVEL,
    LOG_FORMAT,
    LOG_PROMPTS,
    ACCESS_LOG,
    DATABASE_PATH,
)
from app.routers import chat, images, videos, settings
from app.services.video_poller import poll_pending_videos
from app.services.storage_settings import (
    get_storage_provider,
    get_aws_bucket,
    get_aws_region,
    get_aws_prefix,
    get_aws_public_base_url,
    get_aws_endpoint_url,
    is_qiniu_configured,
    detect_aws_credential_source,
)
from app.services.app_settings_service import get_agnes_base_url

logger = get_logger(__name__)

scheduler = BackgroundScheduler(job_defaults={"coalesce": True, "max_instances": 1})


# ---------------------------------------------------------------------------
# 启动 / 关闭
# ---------------------------------------------------------------------------
def _log_startup_summary() -> None:
    """输出脱敏后的配置摘要，容器一启动即可判断配置是否正确。"""
    provider = get_storage_provider()
    logger.info("Application starting")
    logger.info("Environment=production")
    logger.info("Log level=%s", LOG_LEVEL)
    logger.info("Log format=%s", LOG_FORMAT)
    logger.info("Log prompts=%s", LOG_PROMPTS)
    logger.info("Database=%s", DATABASE_PATH)
    logger.info("Storage provider=%s", provider)
    if provider == "s3":
        logger.info("AWS region=%s", get_aws_region() or "(unset)")
        logger.info("S3 bucket=%s", get_aws_bucket() or "(unset)")
        logger.info("S3 prefix=%s", get_aws_prefix())
        logger.info(
            "S3 public base URL configured=%s",
            bool(get_aws_public_base_url()),
        )
        logger.info(
            "S3 endpoint URL configured=%s",
            bool(get_aws_endpoint_url()),
        )
        logger.info("S3 credential source=%s", detect_aws_credential_source())
    else:
        logger.info("Qiniu configured=%s", is_qiniu_configured())
    logger.info("Agnes base URL=%s", get_agnes_base_url())
    logger.info("Scheduler enabled=true")


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging(LOG_LEVEL, LOG_FORMAT, ACCESS_LOG)
    validate_config()
    init_db()
    _warn_if_storage_misconfigured()
    _log_startup_summary()
    scheduler.add_job(
        lambda: asyncio.run(poll_pending_videos()),
        "interval",
        seconds=15,
        id="video_poller",
        replace_existing=True,
        coalesce=True,
        max_instances=1,
    )
    scheduler.start()
    logger.info("Scheduler Video poller scheduler started")
    yield
    logger.info("Application shutting down")
    logger.info("Scheduler shutting down")
    scheduler.shutdown(wait=False)
    logger.info("HTTP clients closing")
    logger.info("Application shutdown completed")


def _warn_if_storage_misconfigured():
    """Provider 与必备配置不一致时给出清晰启动日志，但应用仍可启动（容错）。"""
    provider = get_storage_provider()
    if provider == "s3":
        if not get_aws_bucket():
            logger.warning(
                "S3 storage selected but AWS_S3_BUCKET is not configured, "
                "S3 转存将被跳过，生成结果将使用原始 URL"
            )
    elif provider == "qiniu":
        if not is_qiniu_configured():
            logger.warning(
                "STORAGE_PROVIDER=qiniu 但七牛云配置不完整，转存将被跳过，"
                "生成结果将使用原始 URL"
            )


# ---------------------------------------------------------------------------
# Request ID + access log 中间件（纯 ASGI，兼容 StreamingResponse）
# ---------------------------------------------------------------------------
class RequestContextMiddleware:
    """注入 request_id、响应返回 X-Request-ID、输出 access 日志。"""

    def __init__(self, app):
        self.app = app
        self._logger = get_logger("http")

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = {
            k.decode("latin1").lower(): v.decode("latin1")
            for k, v in scope.get("headers", [])
        }
        request_id = headers.get("x-request-id", "").strip() or uuid.uuid4().hex
        set_request_id(request_id)
        set_task_id("")
        start = time.time()
        status_code = 500
        client_ip = headers.get("x-forwarded-for", "").split(",")[0].strip() or (
            scope.get("client") or ("",))[0]

        def send_wrapper(message):
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
                hdrs = list(message.get("headers", []))
                hdrs.append((b"x-request-id", request_id.encode("latin1")))
                message["headers"] = hdrs
            return send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            duration_ms = int((time.time() - start) * 1000)
            if ACCESS_LOG:
                self._logger.info(
                    "request",
                    extra={
                        "request_id": request_id,
                        "method": scope.get("method", ""),
                        "path": scope.get("path", ""),
                        "status": status_code,
                        "duration_ms": duration_ms,
                        "client_ip": client_ip,
                    },
                )
            reset_context()


app = FastAPI(title="Agnes AI Creator", lifespan=lifespan)

app.add_middleware(RequestContextMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat.router)
app.include_router(images.router)
app.include_router(videos.router)
app.include_router(settings.router)


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    from app.core.logging import get_request_id

    return JSONResponse(
        status_code=exc.status_code,
        content={
            "detail": exc.detail,
            "error_code": getattr(exc, "error_code", None),
            "request_id": get_request_id(),
        },
    )


@app.exception_handler(404)
async def not_found_handler(request: Request, exc: Exception):
    from app.core.logging import get_request_id

    return JSONResponse(
        status_code=404,
        content={
            "detail": "Not Found",
            "error_code": "NOT_FOUND",
            "request_id": get_request_id() or None,
        },
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    from app.core.logging import get_request_id
    from app.services.error_utils import ERROR_CODES

    logger.exception(
        "Unhandled exception path=%s method=%s",
        request.url.path,
        request.method,
        exc_info=exc,
    )
    return JSONResponse(
        status_code=500,
        content={
            "detail": "服务器内部错误",
            "error_code": ERROR_CODES["INTERNAL_ERROR"],
            "request_id": get_request_id(),
        },
    )


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/health")
def liveness():
    return {"status": "ok"}