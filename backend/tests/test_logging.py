"""日志体系单元测试。

覆盖：
- Request ID 自动生成 / 回传 / 保留传入
- 异常响应携带 request_id
- 结构化 extra（provider / task_id）进入日志
- Secret / AWS / Authorization / presigned URL 脱敏
- text 与 json formatter 输出
"""
import io
import json
import logging
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.logging import (
    JsonFormatter,
    TextFormatter,
    ContextInjector,
    redact_text,
    redact_url,
    _redact_value,
    REDACTED,
)
import app.core.logging as core_logging


# ---------------------------------------------------------------------------
# 日志捕获辅助
# ---------------------------------------------------------------------------
class _CaptureHandler(logging.Handler):
    def __init__(self):
        super().__init__()
        self.records = []
        self.stream = io.StringIO()

    def emit(self, record):
        self.records.append(record)
        self.stream.write(self.format(record) + "\n")

    def text(self) -> str:
        return self.stream.getvalue()


def _capture_logger(name, formatter):
    logger = logging.getLogger(name)
    logger.setLevel(logging.DEBUG)
    logger.handlers = []
    handler = _CaptureHandler()
    handler.setFormatter(formatter)
    handler.addFilter(ContextInjector())
    logger.addHandler(handler)
    logger.propagate = False
    return logger, handler


# ---------------------------------------------------------------------------
# 脱敏
# ---------------------------------------------------------------------------
class TestRedaction(unittest.TestCase):
    def test_authorization_bearer_redacted(self):
        out = redact_text("Authorization: Bearer sk-1234567890abcdef123456")
        self.assertNotIn("sk-1234567890", out)
        self.assertIn(REDACTED, out)

    def test_api_key_kv_redacted(self):
        out = redact_text("api_key=sk-abcdef123456 key=abcdefghijklmnopqrstuvwxyz")
        self.assertNotIn("sk-abcdef123456", out)
        self.assertNotIn("abcdefghijklmnopqrstuvwxyz", out)

    def test_aws_secret_long_value_redacted(self):
        secret = "ASIAabcdefghijklmnopqrstuvwxyz0123456789+/="
        out = redact_text(f"secret_value={secret}")
        self.assertNotIn(secret, out)

    def test_presigned_url_query_redacted(self):
        url = ("https://bucket.s3.amazonaws.com/agnes-ai/videos/a.mp4"
               "?X-Amz-Credential=AKIA123&X-Amz-Signature=deadbeef123&token=abc")
        out = redact_url(url)
        self.assertNotIn("AKIA123", out)
        self.assertNotIn("deadbeef123", out)
        self.assertNotIn("abc", out)
        # scheme/host/path 保留，便于定位
        self.assertIn("bucket.s3.amazonaws.com", out)
        self.assertIn("agnes-ai/videos/a.mp4", out)

    def test_extra_sensitive_keys_redacted(self):
        out = _redact_value(
            {"authorization": "Bearer sk-x", "aws_secret_access_key": "s3cr3t",
             "task_id": 123, "provider": "s3"}
        )
        self.assertEqual(out["authorization"], REDACTED)
        self.assertEqual(out["aws_secret_access_key"], REDACTED)
        self.assertEqual(out["task_id"], 123)
        self.assertEqual(out["provider"], "s3")


# ---------------------------------------------------------------------------
# Formatter
# ---------------------------------------------------------------------------
class TestFormatters(unittest.TestCase):
    def test_json_formatter_contains_structured_fields(self):
        logger, handler = _capture_logger("app.storage.s3", JsonFormatter())
        logger.info("Upload completed", extra={"provider": "s3", "task_id": 7, "duration_ms": 10})
        line = handler.text().strip()
        data = json.loads(line)
        self.assertEqual(data["level"], "INFO")
        self.assertEqual(data["logger"], "app.storage.s3")
        self.assertEqual(data["provider"], "s3")
        self.assertEqual(data["task_id"], 7)
        self.assertEqual(data["duration_ms"], 10)
        self.assertIn("timestamp", data)

    def test_json_formatter_redacts_secret_extra(self):
        logger, handler = _capture_logger("app.agnes", JsonFormatter())
        logger.error(
            "failed",
            extra={"authorization": "Bearer sk-full-key", "api_key": "sk-secret"},
        )
        data = json.loads(handler.text().strip())
        self.assertEqual(data["authorization"], REDACTED)
        self.assertEqual(data["api_key"], REDACTED)

    def test_text_formatter_single_line(self):
        logger, handler = _capture_logger("app.http", TextFormatter(use_color=False))
        logger.info("request", extra={"request_id": "rid-1", "method": "GET", "status": 200})
        text = handler.text().strip()
        self.assertIn("rid-1", text)
        self.assertIn("GET", text)
        self.assertEqual(text.count("\n"), 0)


# ---------------------------------------------------------------------------
# Request ID 中间件（用真实 app 验证）
# ---------------------------------------------------------------------------
def _make_test_app():
    from app.main import app
    return app


class TestRequestIdMiddleware(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(_make_test_app())

    def test_request_id_auto_generated_and_returned(self):
        resp = self.client.get("/health")
        self.assertEqual(resp.status_code, 200)
        rid = resp.headers.get("x-request-id")
        self.assertTrue(rid)

    def test_incoming_request_id_preserved(self):
        resp = self.client.get("/health", headers={"X-Request-ID": "test-request-123"})
        self.assertEqual(resp.headers.get("x-request-id"), "test-request-123")

    def test_error_response_contains_request_id(self):
        resp = self.client.get("/api/does-not-exist")
        self.assertEqual(resp.status_code, 404)
        body = resp.json()
        self.assertIn("request_id", body)
        self.assertTrue(body["request_id"])


if __name__ == "__main__":
    unittest.main()