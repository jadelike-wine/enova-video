import json
import time
import asyncio
import httpx
from typing import AsyncGenerator, Optional
from urllib.parse import urlsplit

from app.services.api_key_service import (
    get_active_api_key,
    get_active_api_key_info,
)
from app.services.app_settings_service import get_agnes_base_url
from app.services.error_utils import (
    format_agnes_error,
    classify_agnes_error,
    ERROR_CODES,
)
from app.core.logging import get_logger, redact_url

logger = get_logger(__name__)

NO_API_KEY_MSG = "尚未配置 Agnes AI API Key，无法操作。请前往设置页面添加并启用 API Key。"


def _upstream_host(base_url: str) -> str:
    try:
        return urlsplit(base_url).netloc
    except ValueError:
        return ""


def _payload_summary(payload: dict) -> dict:
    """请求体摘要：只记录长度/数量等元信息，不记录 prompt/base64/图片 URL。"""
    summary = {}
    prompt = payload.get("prompt")
    if isinstance(prompt, str):
        summary["prompt_length"] = len(prompt)
    if isinstance(prompt, list):
        summary["prompt_length"] = sum(len(p) for p in prompt if isinstance(p, str))
    images = payload.get("images") or []
    if isinstance(images, list):
        summary["image_count"] = len(images)
    if payload.get("image"):
        summary["has_image"] = True
    return summary


class AgnesClient:
    @property
    def base_url(self) -> str:
        return get_agnes_base_url()

    def _headers(self) -> dict:
        api_key = get_active_api_key()
        if not api_key:
            raise RuntimeError(NO_API_KEY_MSG)
        return {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

    def _log_start(self, operation: str, model: str, payload: dict = None) -> dict:
        extra = {
            "operation": operation,
            "model": model,
            "upstream_host": _upstream_host(self.base_url),
            "method": "POST",
        }
        info = get_active_api_key_info()
        if info:
            extra["api_key_id"] = info["api_key_id"]
            extra["key_suffix"] = info["key_suffix"]
        if payload:
            extra.update(_payload_summary(payload))
        logger.info("%s started", operation, extra=extra)
        return extra

    def _log_done(self, operation: str, extra: dict, status: int, duration_ms: int):
        logger.info(
            "%s completed",
            operation,
            extra={
                **extra,
                "status": status,
                "duration_ms": duration_ms,
            },
        )

    def _log_error(
        self,
        operation: str,
        extra: dict,
        exc: BaseException,
        status: Optional[int] = None,
        retry_count: int = 0,
    ):
        code = classify_agnes_error(exc, status)
        level = (
            logger.warning
            if code in (ERROR_CODES["AGNES_RATE_LIMITED"],)
            else logger.error
        )
        level(
            "%s failed",
            operation,
            exc_info=exc,
            extra={
                **extra,
                "status": status,
                "error_code": code,
                "retry_count": retry_count,
            },
        )
        return code

    async def chat_completion_stream(
        self, model: str, messages: list, **kwargs
    ) -> AsyncGenerator[dict, None]:
        payload = {"model": model, "messages": messages, "stream": True, **kwargs}
        start = time.time()
        usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
        extra = self._log_start("chat_stream", model)

        async with httpx.AsyncClient(timeout=300, trust_env=False) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/v1/chat/completions",
                headers=self._headers(),
                json=payload,
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data = line[6:]
                    if data.strip() == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    if chunk.get("usage"):
                        usage = chunk["usage"]
                    choices = chunk.get("choices") or []
                    if not choices:
                        continue
                    delta = choices[0].get("delta", {})
                    content = delta.get("content") or delta.get("reasoning_content") or ""
                    if content:
                        yield {"type": "content", "content": content}
                duration_ms = int((time.time() - start) * 1000)
                self._log_done("chat_stream", extra, resp.status_code, duration_ms)
                yield {"type": "done", "usage": usage, "duration_ms": duration_ms}

    async def chat_completion(self, model: str, messages: list, **kwargs) -> dict:
        payload = {"model": model, "messages": messages, **kwargs}
        start = time.time()
        extra = self._log_start("chat", model)
        async with httpx.AsyncClient(timeout=300, trust_env=False) as client:
            resp = await client.post(
                f"{self.base_url}/v1/chat/completions",
                headers=self._headers(),
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
            duration_ms = int((time.time() - start) * 1000)
            self._log_done("chat", extra, resp.status_code, duration_ms)
            data["duration_ms"] = duration_ms
            return data

    async def generate_image(self, payload: dict) -> dict:
        start = time.time()
        url = f"{self.base_url}/v1/images/generations"
        extra = self._log_start("image_generation", payload.get("model"), payload)
        async with httpx.AsyncClient(timeout=360, trust_env=False) as client:
            resp = await client.post(url, headers=self._headers(), json=payload)
            if resp.status_code >= 400:
                exc = RuntimeError(f"Agnes API {resp.status_code}")
                self._log_error(
                    "image_generation", extra, exc, resp.status_code
                )
                raise exc
            data = resp.json()
            duration_ms = int((time.time() - start) * 1000)
            self._log_done("image_generation", extra, resp.status_code, duration_ms)
            data["duration_ms"] = duration_ms
            return data

    async def create_video(self, payload: dict) -> dict:
        start = time.time()
        extra = self._log_start("video_generation", payload.get("model"), payload)
        async with httpx.AsyncClient(timeout=120, trust_env=False) as client:
            resp = await client.post(
                f"{self.base_url}/v1/videos",
                headers=self._headers(),
                json=payload,
            )
            if resp.status_code >= 400:
                detail = None
                try:
                    body = resp.json()
                    detail = format_agnes_error(body.get("error") or body)
                except Exception:
                    detail = resp.text.strip() or None
                exc = RuntimeError(
                    detail or f"Agnes API {resp.status_code}: {resp.text or '请求失败'}"
                )
                self._log_error("video_generation", extra, exc, resp.status_code)
                raise exc
            data = resp.json()
            duration_ms = int((time.time() - start) * 1000)
            self._log_done("video_generation", extra, resp.status_code, duration_ms)
            data["duration_ms"] = duration_ms
            return data

    async def get_video_status(self, video_id: str, model_name: Optional[str] = None) -> dict:
        params = {"video_id": video_id}
        if model_name:
            params["model_name"] = model_name

        delays = (0, 2, 5, 10)
        last_error = None
        retry_count = 0
        extra = {
            "operation": "video_status",
            "video_id": video_id,
            "model": model_name,
            "upstream_host": _upstream_host(self.base_url),
            "method": "GET",
        }
        info = get_active_api_key_info()
        if info:
            extra["api_key_id"] = info["api_key_id"]
            extra["key_suffix"] = info["key_suffix"]

        for attempt_index, delay in enumerate(delays):
            if delay:
                await asyncio.sleep(delay)
            start = time.time()
            try:
                async with httpx.AsyncClient(timeout=60, trust_env=False) as client:
                    resp = await client.get(
                        f"{self.base_url}/agnesapi",
                        headers=self._headers(),
                        params=params,
                    )
                    resp.raise_for_status()
                    duration_ms = int((time.time() - start) * 1000)
                    logger.info(
                        "video_status completed",
                        extra={
                            **extra,
                            "status": resp.status_code,
                            "duration_ms": duration_ms,
                            "retry_count": retry_count,
                        },
                    )
                    return resp.json()
            except httpx.HTTPStatusError as e:
                last_error = e
                if e.response.status_code == 429 and attempt_index < len(delays) - 1:
                    retry_count = attempt_index + 1
                    logger.warning(
                        "video_status retry",
                        extra={
                            **extra,
                            "status": 429,
                            "retry_count": retry_count,
                            "max_attempts": len(delays),
                            "reason": "rate_limit",
                        },
                    )
                    continue
                self._log_error(
                    "video_status", extra, e, e.response.status_code, retry_count
                )
                raise
            except (httpx.TimeoutException, httpx.TransportError) as e:
                last_error = e
                if attempt_index < len(delays) - 1:
                    retry_count = attempt_index + 1
                    logger.warning(
                        "video_status retry",
                        extra={
                            **extra,
                            "retry_count": retry_count,
                            "max_attempts": len(delays),
                            "reason": "timeout" if isinstance(e, httpx.TimeoutException) else "connect_error",
                        },
                    )
                    continue
                self._log_error("video_status", extra, e, retry_count=retry_count)
                raise

        if last_error:
            raise last_error
        raise RuntimeError("查询视频状态失败")

    async def get_video_status_by_task(self, task_id: str) -> dict:
        start = time.time()
        extra = {
            "operation": "video_status_by_task",
            "video_id": task_id,
            "upstream_host": _upstream_host(self.base_url),
            "method": "GET",
        }
        async with httpx.AsyncClient(timeout=60, trust_env=False) as client:
            resp = await client.get(
                f"{self.base_url}/v1/videos/{task_id}",
                headers=self._headers(),
            )
            resp.raise_for_status()
            duration_ms = int((time.time() - start) * 1000)
            logger.info(
                "video_status_by_task completed",
                extra={**extra, "status": resp.status_code, "duration_ms": duration_ms},
            )
            return resp.json()


agnes_client = AgnesClient()