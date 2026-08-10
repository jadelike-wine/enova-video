"""统一日志体系。

目标（Docker 环境）：
- 所有应用日志输出到 stdout / stderr，不写容器内 .log 文件。
- 支持 text / json 两种格式（LOG_FORMAT）。
- 支持 LOG_LEVEL 控制日志等级。
- 通过 ContextVar 注入 request_id / task_id，service 层无需显式传参。
- 统一的 Secret / URL 脱敏，任何日志（含 message、extra、traceback）都不会泄露凭据。
- 为未来 CloudWatch / Loki / ELK 预留稳定性：一条事件一行、JSON 单行、UTC ISO 8601。

使用方式：
    from app.core.logging import setup_logging, get_logger, set_task_id, redact_url
    setup_logging()
    logger = get_logger(__name__)
    logger.info("Uploaded", extra={"provider": "s3", "bucket": "b", "duration_ms": 12})
"""
from __future__ import annotations

import json
import logging
import os
import re
import sys
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any, Dict, Optional

# ---------------------------------------------------------------------------
# 环境变量（也由 app.config 读取；这里直接读取避免循环依赖）
# ---------------------------------------------------------------------------
LOG_LEVEL_ENV = os.getenv("LOG_LEVEL", "INFO").upper()
LOG_FORMAT_ENV = os.getenv("LOG_FORMAT", "text").lower()
# 是否启用请求级 access log（中间件）
ACCESS_LOG_ENV = os.getenv("ACCESS_LOG", "true").lower() in ("1", "true", "yes", "on")

_VALID_LEVELS = ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL")


def _normalize_level(value: str = LOG_LEVEL_ENV) -> int:
    value = (value or "INFO").upper()
    if value not in _VALID_LEVELS:
        value = "INFO"
    return getattr(logging, value)


# ---------------------------------------------------------------------------
# 请求上下文（ContextVar）
# ---------------------------------------------------------------------------
_request_id_var: ContextVar[str] = ContextVar("request_id", default="")
_task_id_var: ContextVar[str] = ContextVar("task_id", default="")


def get_request_id() -> str:
    return _request_id_var.get()


def set_request_id(request_id: str) -> None:
    _request_id_var.set(request_id or "")


def get_task_id() -> str:
    return _task_id_var.get()


def set_task_id(task_id: Any) -> None:
    """后台任务（视频轮询/转存）显式设置 task_id，不依赖 HTTP request context。"""
    _task_id_var.set("" if task_id is None else str(task_id))


def reset_context() -> None:
    _request_id_var.set("")
    _task_id_var.set("")


# ---------------------------------------------------------------------------
# 脱敏
# ---------------------------------------------------------------------------
REDACTED = "[REDACTED]"

# 敏感字段名：extra 字典 / 结构化数据中命中即整体脱敏
_SENSITIVE_KEYS = re.compile(
    r"(authorization|cookie|set-cookie|set_cookie|api[_-]?key|apikey|access[_-]?"
    r"token|refresh[_-]?token|token|secret|password|passwd|credential|signature|"
    r"x-amz-[\w-]+|aws[_-]?secret|aws[_-]?session|qiniu[_-]?secret|qiniu[_-]?access)",
    re.IGNORECASE,
)

# 文本中的敏感模式（用于 message）
_TEXT_PATTERNS = [
    # Authorization: Bearer <token>
    re.compile(r"(authorization\s*[:=]\s*bearer\s+)([^\s,;]+)", re.IGNORECASE),
    # api_key=xxx / key=xxx / token=xxx / secret=xxx / password=xxx 等 query / kv
    re.compile(
        r"(?i)(\b(?:api[_-]?key|key|token|secret|password|access[_-]?token|"
        r"refresh[_-]?token|credential|signature|aws[_-]?secret[_-]?access[_-]?key|"
        r"aws[_-]?session[_-]?token)\b\s*[:=]\s*)([^\s&,;]+)"
    ),
    # AWS 长密钥（base64，>=40 位连续，不含 /，避免误伤文件路径）。
    # 含 / 的长 token（如 session token）由上面的 kv 模式按 key 名捕获。
    re.compile(r"\b[A-Za-z0-9+]{40,}={0,2}\b"),
    # S3 presigned / 签名 URL 的敏感 query 值
    re.compile(r"(X-Amz-[A-Za-z0-9-]+=)[^&\s]*", re.IGNORECASE),
]


def _redact_value(value: Any) -> Any:
    """对结构化字段值进行递归脱敏。"""
    if isinstance(value, dict):
        return {
            k: (
                REDACTED
                if _SENSITIVE_KEYS.search(k)
                else _redact_value(v)
            )
            for k, v in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [_redact_value(v) for v in value]
    if isinstance(value, str):
        return redact_text(value)
    return value


def redact_text(text: str) -> str:
    """对任意文本做敏感信息脱敏（用于 message 与 traceback）。"""
    if not isinstance(text, str) or not text:
        return text
    for pattern in _TEXT_PATTERNS:
        text = pattern.sub(_replace, text)
    return text


def _replace(match: re.Match) -> str:
    groups = match.groups()
    if len(groups) >= 2 and groups[0]:
        # 保留 key 前缀（如 "Authorization: Bearer "），只脱敏值
        return f"{groups[0]}{REDACTED}"
    return REDACTED


def redact_url(url: str) -> str:
    """去掉 URL 中的敏感 query，只保留 scheme/host/path（用于日志）。"""
    if not url or not isinstance(url, str):
        return url
    from urllib.parse import urlsplit, urlunsplit, parse_qsl

    try:
        parts = urlsplit(url)
    except ValueError:
        return redact_text(url)
    if not parts.scheme:
        return redact_text(url)
    safe_query = "&".join(
        f"{k}=" + (REDACTED if _SENSITIVE_KEYS.search(k) else v)
        for k, v in parse_qsl(parts.query, keep_blank_values=True)
    )
    path = parts.path
    return urlunsplit(
        (parts.scheme, parts.netloc, path, safe_query, parts.fragment)
    )


# ---------------------------------------------------------------------------
# Formatter
# ---------------------------------------------------------------------------
# logging 标准属性，不属于我们对齐的 extra 字段
_STANDARD_ATTRS = {
    "name", "msg", "args", "levelname", "levelno", "pathname", "filename",
    "module", "exc_info", "exc_text", "stack_info", "lineno", "funcName",
    "created", "msecs", "relativeCreated", "thread", "threadName",
    "processName", "process", "message", "asctime", "taskName",
}


def _extract_extra(record: logging.LogRecord) -> Dict[str, Any]:
    extra = {
        k: v
        for k, v in record.__dict__.items()
        if k not in _STANDARD_ATTRS and not k.startswith("_")
    }
    return _redact_value(extra)


def _iso_ts(record: logging.LogRecord) -> str:
    dt = datetime.fromtimestamp(record.created, tz=timezone.utc)
    return dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")


class JsonFormatter(logging.Formatter):
    """单行 JSON：timestamp/level/logger/message + 结构化 extra + traceback。"""

    def format(self, record: logging.LogRecord) -> str:
        payload: Dict[str, Any] = {
            "timestamp": _iso_ts(record),
            "level": record.levelname,
            "logger": record.name,
            "message": redact_text(record.getMessage()),
        }
        extra = _extract_extra(record)
        if extra:
            payload.update(extra)
        if record.request_id:
            payload.setdefault("request_id", record.request_id)
        if record.task_id:
            payload.setdefault("task_id", record.task_id)
        if record.exc_info:
            payload["traceback"] = redact_text(self.formatException(record.exc_info))
        return json.dumps(payload, ensure_ascii=False)


class TextFormatter(logging.Formatter):
    _LEVEL_COLORS = {
        "DEBUG": "\x1b[37m",
        "INFO": "\x1b[32m",
        "WARNING": "\x1b[33m",
        "ERROR": "\x1b[31m",
        "CRITICAL": "\x1b[35m",
    }
    _RESET = "\x1b[0m"

    def __init__(self, fmt: Optional[str] = None, use_color: bool = True):
        super().__init__(fmt)
        self._use_color = use_color

    def format(self, record: logging.LogRecord) -> str:
        ts = datetime.fromtimestamp(record.created, timezone.utc).strftime(
            "%Y-%m-%d %H:%M:%S"
        )
        level = record.levelname
        if self._use_color:
            color = self._LEVEL_COLORS.get(level, "")
            level = f"{color}{level}{self._RESET}"
        base = f"{ts} {level} {record.name}"
        lines = [base]

        extra = _extract_extra(record)
        if record.request_id:
            extra.setdefault("request_id", record.request_id)
        if record.task_id:
            extra.setdefault("task_id", record.task_id)
        if extra:
            kv = " ".join(
                f"{k}={_fmt_kv(v)}" for k, v in sorted(extra.items())
            )
            lines.append(kv)

        message = redact_text(record.getMessage())
        if message:
            lines.append(message)
        text = " ".join(lines).rstrip()

        if record.exc_info:
            text += "\n" + redact_text(self.formatException(record.exc_info))
        return text


def _fmt_kv(value: Any) -> str:
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    return str(value)


# ---------------------------------------------------------------------------
# 上下文注入 Filter
# ---------------------------------------------------------------------------
class ContextInjector(logging.Filter):
    """把 request_id / task_id 从 ContextVar 写入 record（显式 extra 优先）。"""

    def filter(self, record: logging.LogRecord) -> bool:
        if not hasattr(record, "request_id"):
            record.request_id = get_request_id()
        if not hasattr(record, "task_id"):
            record.task_id = get_task_id()
        return True


_SDK_LOGGER = "app"


def get_logger(name: str) -> logging.Logger:
    """获取子 logger，统一使用 app.* 命名空间。"""
    if name.startswith(_SDK_LOGGER):
        return logging.getLogger(name)
    return logging.getLogger(f"{_SDK_LOGGER}.{name}")


def setup_logging(
    level: Optional[str] = None,
    fmt: Optional[str] = None,
    access_log: Optional[bool] = None,
) -> None:
    """初始化根 logger / formatter / 第三方 logger 噪音控制。

    幂等调用：重复调用不会叠加 handler。
    """
    level = (level or LOG_LEVEL_ENV).upper()
    fmt = (fmt or LOG_FORMAT_ENV).lower()
    if level not in _VALID_LEVELS:
        level = "INFO"
    if fmt not in ("text", "json"):
        fmt = "text"
    access_log = LOG_ACCESS_ENV if access_log is None else access_log

    root = logging.getLogger()
    root.setLevel(getattr(logging, level))

    # 移除已存在的 StreamHandler，避免重复
    for handler in list(root.handlers):
        root.removeHandler(handler)

    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(getattr(logging, level))
    if fmt == "json":
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(TextFormatter())
    handler.addFilter(ContextInjector())
    root.addHandler(handler)

    # APScheduler / 三方库噪音控制：正常业务日志比它们更权威
    logging.getLogger("apscheduler").setLevel(logging.WARNING)
    logging.getLogger("apscheduler.executors.default").setLevel(logging.WARNING)
    logging.getLogger("apscheduler.scheduler").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("boto3").setLevel(logging.WARNING)
    logging.getLogger("botocore").setLevel(logging.WARNING)
    logging.getLogger("qiniu").setLevel(logging.WARNING)

    # Uvicorn access log：由我们自己的中间件输出（含 request_id），关闭默认避免重复
    if not access_log:
        logging.getLogger("uvicorn.access").disabled = True
    logging.getLogger("uvicorn.error").setLevel(getattr(logging, level))