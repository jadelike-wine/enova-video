"""版本服务与系统路由单元测试。

- SemVer 解析 / 比较（含非法版本）
- update check：同版本 / 新版本 / 无 stable release / GitHub 失败（UPDATE_CHECK_FAILED）
- /api/system/version 与 /api/system/update/check 路由
- 不访问真实 GitHub；用 unittest.mock 隔离网络。
"""
import unittest
from unittest import mock

from fastapi.testclient import TestClient

from app.services import version_service
from app.services.version_service import (
    parse_semver,
    compare_semver,
    UpdateCheckError,
)


class TestSemVer(unittest.TestCase):
    def test_parse_valid(self):
        self.assertEqual(parse_semver("1.2.0"), (1, 2, 0))
        self.assertEqual(parse_semver("v1.2.0"), (1, 2, 0))
        self.assertEqual(parse_semver("1.2.0-rc.1"), (1, 2, 0))
        self.assertEqual(parse_semver("1.2.0+build.5"), (1, 2, 0))

    def test_parse_invalid(self):
        for bad in ("", "abc", "1.2", "1.2.x", "1..0", None, 123):
            self.assertIsNone(parse_semver(bad))

    def test_compare(self):
        self.assertEqual(compare_semver("1.1.0", "1.2.0"), -1)
        self.assertEqual(compare_semver("1.2.0", "1.1.0"), 1)
        self.assertEqual(compare_semver("1.2.0", "1.2.0"), 0)
        self.assertIsNone(compare_semver("1.2.0", "bad"))


def _release(version, **overrides):
    data = {
        "tag_name": version,
        "draft": False,
        "prerelease": False,
        "published_at": "2026-08-01T00:00:00Z",
        "body": "release notes",
        "html_url": f"https://github.com/x/releases/tag/{version}",
    }
    data.update(overrides)
    return data


class TestUpdateCheck(unittest.TestCase):
    def setUp(self):
        self._orig_version = version_service.CURRENT_VERSION
        self._orig_repo = version_service.GITHUB_REPOSITORY
        self._orig_channel = version_service.UPDATE_CHANNEL

    def tearDown(self):
        version_service.CURRENT_VERSION = self._orig_version
        version_service.GITHUB_REPOSITORY = self._orig_repo
        version_service.UPDATE_CHANNEL = self._orig_channel

    def test_no_update_when_same_version(self):
        version_service.CURRENT_VERSION = "1.2.0"
        with mock.patch.object(version_service, "_fetch_releases", return_value=[_release("1.2.0")]):
            out = version_service.check_update()
        self.assertFalse(out["update_available"])
        self.assertEqual(out["latest_version"], "1.2.0")

    def test_update_available_for_newer(self):
        version_service.CURRENT_VERSION = "1.1.0"
        with mock.patch.object(version_service, "_fetch_releases", return_value=[_release("1.2.0")]):
            out = version_service.check_update()
        self.assertTrue(out["update_available"])
        self.assertEqual(out["current_version"], "1.1.0")
        self.assertEqual(out["latest_version"], "1.2.0")
        self.assertEqual(out["release_notes"], "release notes")
        self.assertIn("releases/tag/1.2.0", out["release_url"])

    def test_ignores_prerelease_and_draft(self):
        version_service.CURRENT_VERSION = "1.1.0"
        releases = [
            _release("9.9.9", prerelease=True),
            _release("9.8.8", draft=True),
            _release("1.2.0"),
        ]
        with mock.patch.object(version_service, "_fetch_releases", return_value=releases):
            out = version_service.check_update()
        self.assertEqual(out["latest_version"], "1.2.0")

    def test_no_stable_release_means_latest(self):
        version_service.CURRENT_VERSION = "1.1.0"
        with mock.patch.object(version_service, "_fetch_releases", return_value=[]):
            out = version_service.check_update()
        self.assertFalse(out["update_available"])
        self.assertEqual(out["latest_version"], "1.1.0")

    def test_github_failure_raises_update_check_error(self):
        version_service.CURRENT_VERSION = "1.1.0"

        def boom(*a, **k):
            raise ConnectionError("github down")

        with mock.patch.object(version_service, "_fetch_releases", side_effect=boom):
            with self.assertRaises(UpdateCheckError) as ctx:
                version_service.check_update()
        self.assertEqual(ctx.exception.error_code, "UPDATE_CHECK_FAILED")


class TestSystemRouter(unittest.TestCase):
    def setUp(self):
        from app.main import app

        self.client = TestClient(app)
        self._orig_version = version_service.CURRENT_VERSION
        self._orig_git = version_service.GIT_SHA
        self._orig_build = version_service.BUILD_TIME

    def tearDown(self):
        version_service.CURRENT_VERSION = self._orig_version
        version_service.GIT_SHA = self._orig_git
        version_service.BUILD_TIME = self._orig_build

    def test_version_endpoint(self):
        version_service.CURRENT_VERSION = "1.2.0"
        version_service.GIT_SHA = "abcdef1"
        version_service.BUILD_TIME = "2026-08-01T00:00:00Z"
        resp = self.client.get("/api/system/version")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["version"], "1.2.0")
        self.assertEqual(body["git_sha"], "abcdef1")
        self.assertEqual(body["build_time"], "2026-08-01T00:00:00Z")

    def test_update_check_endpoint_success(self):
        version_service.CURRENT_VERSION = "1.1.0"
        with mock.patch.object(version_service, "_fetch_releases", return_value=[_release("1.2.0")]):
            resp = self.client.get("/api/system/update/check")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertTrue(body["update_available"])
        self.assertEqual(body["latest_version"], "1.2.0")

    def test_update_check_endpoint_failure_returns_stable_code(self):
        version_service.CURRENT_VERSION = "1.1.0"

        def boom(*a, **k):
            raise ConnectionError("github down")

        with mock.patch.object(version_service, "_fetch_releases", side_effect=boom):
            resp = self.client.get("/api/system/update/check")
        self.assertEqual(resp.status_code, 502)
        body = resp.json()
        self.assertEqual(body["error_code"], "UPDATE_CHECK_FAILED")


if __name__ == "__main__":
    unittest.main()