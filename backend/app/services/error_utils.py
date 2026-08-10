import json
import logging
from typing import Any, Optional

from fastapi import HTTPException

logger = logging.getLogger(__name__)


# 稳定的错误码：API Response 与日志共用，便于 grep 定位
ERROR_CODES = {
    "AGNES_TIMEOUT": "AGNES_TIMEOUT",
    "AGNES_CONNECT": "AGNES_CONNECT_ERROR",
    "AGNES_UNAUTHORIZED": "AGNES_UNAUTHORIZED",
    "AGNES_FORBIDDEN": "AGNES_FORBIDDEN",
    "AGNES_RATE_LIMITED": "AGNES_RATE_LIMITED",
    "AGNES_UPSTREAM": "AGNES_SERVER_ERROR",
    "AGNES_INVALID": "AGNES_INVALID_RESPONSE",
    "S3_ACCESS_DENIED": "S3_ACCESS_DENIED",
    "S3_NO_SUCH_BUCKET": "S3_NO_SUCH_BUCKET",
    "S3_UPLOAD_FAILED": "S3_UPLOAD_FAILED",
    "S3_BUCKET_NOT_CONFIGURED": "S3_BUCKET_NOT_CONFIGURED",
    "QINIU_UPLOAD_FAILED": "QINIU_UPLOAD_FAILED",
    "DATABASE_WRITE_FAILED": "DATABASE_WRITE_FAILED",
    "VIDEO_POLL_FAILED": "VIDEO_POLL_FAILED",
    "INTERNAL_ERROR": "INTERNAL_ERROR",
    "UNKNOWN": "UNKNOWN_ERROR",
}


class ApiError(HTTPException):
    """带稳定 error_code 的 HTTP 异常，Response 与日志统一使用该 code。"""

    def __init__(
        self,
        status_code: int,
        detail: str,
        error_code: str = ERROR_CODES["UNKNOWN"],
    ):
        super().__init__(status_code=status_code, detail=detail)
        self.error_code = error_code


def classify_agnes_error(exc: BaseException, status_code: Optional[int] = None) -> str:
    """把 Agnes 上游异常归类为稳定错误码。"""
    text = str(exc).lower()
    sc = status_code
    if sc == 401 or "401" in text or "unauthorized" in text:
        return ERROR_CODES["AGNES_UNAUTHORIZED"]
    if sc == 403 or "403" in text or "forbidden" in text:
        return ERROR_CODES["AGNES_FORBIDDEN"]
    if sc == 429 or "too many requests" in text or is_rate_limit_error(exc):
        return ERROR_CODES["AGNES_RATE_LIMITED"]
    if "timeout" in text or "timed out" in text:
        return ERROR_CODES["AGNES_TIMEOUT"]
    if "connect" in text or "connection" in text or "refused" in text or "resolve" in text:
        return ERROR_CODES["AGNES_CONNECT"]
    if sc and 500 <= sc < 600:
        return ERROR_CODES["AGNES_UPSTREAM"]
    if isinstance(exc, (ValueError, KeyError, json.JSONDecodeError)) or "invalid" in text:
        return ERROR_CODES["AGNES_INVALID"]
    return ERROR_CODES["UNKNOWN"]


def classify_s3_error(exc: BaseException) -> str:
    """把 botocore S3 异常归类为稳定错误码。"""
    text = str(exc).lower()
    if "accessdenied" in text or "access denied" in text:
        return ERROR_CODES["S3_ACCESS_DENIED"]
    if "nosuchbucket" in text or "no such bucket" in text or "does not exist" in text:
        return ERROR_CODES["S3_NO_SUCH_BUCKET"]
    if "bucket" in text and "not configured" in text:
        return ERROR_CODES["S3_BUCKET_NOT_CONFIGURED"]
    return ERROR_CODES["S3_UPLOAD_FAILED"]


def format_agnes_error(err: Any) -> Optional[str]:
    """Normalize Agnes API error payloads into a human-readable string."""
    if err is None:
        return None
    if isinstance(err, str):
        text = err.strip()
        return text or None
    if isinstance(err, dict):
        for key in ("message", "msg", "detail", "error", "code", "type"):
            val = err.get(key)
            if val is None or val == "":
                continue
            if isinstance(val, str):
                return val
            if isinstance(val, dict):
                nested = format_agnes_error(val)
                if nested:
                    return nested
            return str(val)
        return json.dumps(err, ensure_ascii=False)
    return str(err)


def is_transient_http_error(err: BaseException) -> bool:
    """Return True for rate limits / temporary upstream failures."""
    text = str(err).lower()
    markers = (
        "429",
        "too many requests",
        "503",
        "502",
        "504",
        "timeout",
        "timed out",
        "connection reset",
        "connection refused",
        "temporarily unavailable",
    )
    return any(marker in text for marker in markers)


def is_rate_limit_error(err: BaseException) -> bool:
    text = str(err).lower()
    return "429" in text or "too many requests" in text
