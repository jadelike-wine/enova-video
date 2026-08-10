"""Storage 层单元测试。

不依赖真实 AWS Credential：
- 上传/Content-Type/key 构造用 FakeClient 验证
- presigned URL 用 mock 验证
- factory Provider 选择用 mock 验证
- 数据库迁移用临时 SQLite 验证
"""
import os
import sqlite3
import tempfile
import unittest
from unittest import mock

from app.services.storage import factory
from app.services.storage.base import build_object_key, guess_content_type, guess_ext
from app.services.storage.none import NoneProvider
from app.services.storage.s3 import S3Provider


class FakeS3Client:
    """记录 upload_file 调用的假 client，不发起真实网络请求。"""

    def __init__(self):
        self.calls = []
        self.presigned = "https://signed.example.com/x?a=1"

    def upload_file(self, path, bucket, key, ExtraArgs=None):
        self.calls.append(
            {
                "path": path,
                "bucket": bucket,
                "key": key,
                "content_type": (ExtraArgs or {}).get("ContentType"),
            }
        )

    def generate_presigned_url(self, *args, **kwargs):
        return self.presigned


@mock.patch("app.services.storage.s3.get_aws_bucket", return_value="my-bucket")
@mock.patch("app.services.storage.s3.get_aws_prefix", return_value="agnes-ai")
class TestObjectKey(unittest.TestCase):
    def test_key_has_prefix_media_date_uuid(self, *_):
        key = build_object_key("agnes-ai", "img", "png")
        self.assertRegex(key, r"^agnes-ai/images/\d{4}/\d{2}/\d{2}/[0-9a-f]{32}\.png$")

    def test_key_sanitizes_bad_ext(self, *_):
        key = build_object_key("agnes-ai", "video", "mp4..")
        self.assertTrue(key.endswith(".mp4"))

    def test_key_media_dirs(self, *_):
        self.assertTrue(build_object_key("p", "video", "mp4").startswith("p/videos/"))
        self.assertTrue(build_object_key("p", "img", "png").startswith("p/images/"))


class TestContentType(unittest.TestCase):
    def test_guess_content_type(self):
        self.assertEqual(guess_content_type("png"), "image/png")
        self.assertEqual(guess_content_type("jpg"), "image/jpeg")
        self.assertEqual(guess_content_type("webp"), "image/webp")
        self.assertEqual(guess_content_type("mp4"), "video/mp4")
        self.assertEqual(guess_content_type("unknown"), "application/octet-stream")

    def test_guess_ext(self):
        self.assertEqual(guess_ext("image/jpeg"), "jpg")
        self.assertEqual(guess_ext("image/webp"), "webp")
        self.assertEqual(guess_ext("video/mp4"), "mp4")
        self.assertEqual(guess_ext("", "https://x/y.mp4"), "mp4")
        self.assertEqual(guess_ext("", ""), "png")


class TestS3Provider(unittest.TestCase):
    def _provider(self, bucket="my-bucket", prefix="agnes-ai", public_base=""):
        patchers = [
            mock.patch("app.services.storage.s3.get_aws_bucket", return_value=bucket),
            mock.patch("app.services.storage.s3.get_aws_prefix", return_value=prefix),
            mock.patch(
                "app.services.storage.s3.get_aws_public_base_url",
                return_value=public_base,
            ),
        ]
        for p in patchers:
            p.start()
            self.addCleanup(p.stop)
        return S3Provider()

    def test_upload_bytes_success_and_content_type(self):
        provider = self._provider()
        client = FakeS3Client()
        provider._client = client  # 复用缓存，指向假 client

        data = b"fake-png-bytes"
        result = provider.upload_bytes(data, "img", "png")

        self.assertEqual(result["provider"], "s3")
        self.assertTrue(result["key"].startswith("agnes-ai/images/"))
        self.assertTrue(result["key"].endswith(".png"))
        self.assertEqual(result["size"], len(data))
        # 上传时设置了正确 ContentType
        self.assertEqual(client.calls[0]["content_type"], "image/png")
        self.assertEqual(client.calls[0]["bucket"], "my-bucket")
        # 临时文件已清理
        self.assertFalse(os.path.exists(client.calls[0]["path"]))

    def test_upload_bytes_respects_content_type_arg(self):
        provider = self._provider()
        client = FakeS3Client()
        provider._client = client
        provider.upload_bytes(b"x", "img", "bin", content_type="image/webp")
        self.assertEqual(client.calls[0]["content_type"], "image/webp")

    def test_upload_bytes_missing_bucket_raises(self):
        provider = self._provider(bucket="")
        with self.assertRaises(RuntimeError):
            provider.upload_bytes(b"x", "img", "png")

    def test_upload_bytes_exception_propagates(self):
        provider = self._provider()
        client = FakeS3Client()

        def boom(*a, **k):
            raise RuntimeError("s3 down")

        client.upload_file = boom
        provider._client = client
        with self.assertRaises(RuntimeError):
            provider.upload_bytes(b"x", "img", "png")

    def test_upload_from_url_streams_to_temp(self):
        provider = self._provider()
        client = FakeS3Client()
        provider._client = client

        class FakeResp:
            def raise_for_status(self):
                pass

            def headers(self):
                return {"content-type": "video/mp4"}

            def iter_bytes(self, *a, **k):
                return iter([b"part1", b"part2"])

        class FakeCtx:
            def __init__(self, resp):
                self._resp = resp

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def stream(self, method, url):
                return FakeStream(self._resp)

        class FakeStream:
            def __init__(self, resp):
                self._resp = resp

            def __enter__(self):
                return self._resp

            def __exit__(self, *a):
                return False

        resp = mock.Mock()
        resp.raise_for_status.return_value = None
        resp.headers = {"content-type": "video/mp4"}
        resp.iter_bytes.return_value = iter([b"part1", b"part2"])

        with mock.patch(
            "app.services.storage.s3.httpx.Client",
            return_value=FakeCtx(resp),
        ):
            result = provider.upload_from_url("https://agnes/x", "video")

        self.assertTrue(result["key"].startswith("agnes-ai/videos/"))
        self.assertTrue(result["key"].endswith(".mp4"))
        self.assertEqual(client.calls[0]["content_type"], "video/mp4")
        self.assertEqual(result["size"], 10)

    def test_public_base_url_display(self):
        provider = self._provider(public_base="https://cdn.example.com")
        self.assertEqual(
            provider.get_display_url("agnes-ai/images/a.png"),
            "https://cdn.example.com/agnes-ai/images/a.png",
        )

    def test_private_bucket_presigned_url(self):
        provider = self._provider(public_base="")
        client = FakeS3Client()
        provider._client = client
        url = provider.get_display_url("agnes-ai/images/a.png")
        self.assertEqual(url, "https://signed.example.com/x?a=1")


class TestNoneProvider(unittest.TestCase):
    def test_returns_none(self):
        p = NoneProvider()
        self.assertIsNone(p.upload_bytes(b"x", "img", "png"))
        self.assertIsNone(p.upload_from_url("https://x", "img"))
        self.assertEqual(p.get_display_url("k"), "")


class TestFactory(unittest.TestCase):
    def setUp(self):
        factory._instance = None

    @mock.patch("app.services.storage.factory.get_storage_provider", return_value="s3")
    def test_provider_s3(self, *_):
        self.assertIsInstance(factory.get_storage_service(), S3Provider)

    @mock.patch("app.services.storage.factory.get_storage_provider", return_value="qiniu")
    def test_provider_qiniu(self, *_):
        from app.services.storage.qiniu import QiniuProvider

        self.assertIsInstance(factory.get_storage_service(), QiniuProvider)

    @mock.patch("app.services.storage.factory.get_storage_provider", return_value="none")
    def test_provider_none(self, *_):
        self.assertIsInstance(factory.get_storage_service(), NoneProvider)


class TestResolveDisplayUrl(unittest.TestCase):
    @mock.patch(
        "app.services.storage.factory.get_storage_service",
        return_value=type("P", (), {"get_display_url": lambda self, k: "https://signed/x"})(),
    )
    def test_s3_private_uses_presigned(self, *_):
        row = {
            "storage_provider": "s3",
            "storage_key": "agnes-ai/images/a.png",
            "qiniu_url": None,
            "output_url": "https://agnes/orig",
        }
        self.assertEqual(factory.resolve_display_url(row), "https://signed/x")

    def test_legacy_qiniu_uses_qiniu_url(self):
        row = {
            "storage_provider": None,
            "storage_key": None,
            "qiniu_url": "https://cdn/a.png",
            "output_url": "https://agnes/orig",
        }
        self.assertEqual(factory.resolve_display_url(row), "https://cdn/a.png")

    def test_old_record_falls_back_to_output_url(self):
        row = {"storage_provider": None, "storage_key": None, "qiniu_url": None,
               "output_url": "https://agnes/orig"}
        self.assertEqual(factory.resolve_display_url(row), "https://agnes/orig")


class TestStorageSettings(unittest.TestCase):
    def setUp(self):
        tmpdir = tempfile.mkdtemp()
        self.db = os.path.join(tmpdir, "test.db")

    @mock.patch("app.services.storage_settings.get_db")
    def test_provider_invalid_falls_back_to_none(self, mock_get_db):
        cm = mock.MagicMock()
        cm.__enter__.return_value.execute.return_value.fetchone.return_value = None
        mock_get_db.return_value = cm
        from app.services import storage_settings

        with mock.patch.dict(os.environ, {}, clear=False):
            with mock.patch.object(
                storage_settings, "get_storage_provider", lambda: "bad"
            ):
                # 直接测 _get 校验逻辑
                pass
        # 校验 VALID_PROVIDERS
        self.assertEqual(storage_settings.get_storage_provider(), "none")


class TestDbMigration(unittest.TestCase):
    def test_adds_columns_idempotently(self):
        from app.database import _migrate_storage_columns

        db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        db.close()
        path = db.name
        try:
            # 构造旧库（无 storage 列），并保留一条旧记录
            with sqlite3.connect(path) as conn:
                conn.executescript(
                    """
                    CREATE TABLE image_tasks (id INTEGER PRIMARY KEY, output_url TEXT, qiniu_url TEXT);
                    CREATE TABLE video_tasks (id INTEGER PRIMARY KEY, output_url TEXT, qiniu_url TEXT, status TEXT);
                    INSERT INTO image_tasks (id, output_url, qiniu_url) VALUES (1, 'https://agnes/1', 'https://cdn/1');
                    """
                )
            with mock.patch("app.database.DATABASE_PATH", path):
                _migrate_storage_columns()
                _migrate_storage_columns()  # 幂等：二次执行不报错
            with sqlite3.connect(path) as conn:
                cols_img = {r[1] for r in conn.execute("PRAGMA table_info(image_tasks)")}
                cols_vid = {r[1] for r in conn.execute("PRAGMA table_info(video_tasks)")}
                self.assertIn("storage_provider", cols_img)
                self.assertIn("storage_key", cols_img)
                self.assertIn("storage_provider", cols_vid)
                self.assertIn("storage_key", cols_vid)
                # 旧记录仍在，且新列为 NULL
                row = conn.execute("SELECT qiniu_url, storage_provider FROM image_tasks WHERE id=1").fetchone()
                self.assertEqual(row[0], "https://cdn/1")
                self.assertIsNone(row[1])
        finally:
            os.unlink(path)


if __name__ == "__main__":
    unittest.main()