"""版本信息与更新检查服务。

- 提供当前版本（Docker build 时注入 APP_VERSION / GIT_SHA / BUILD_TIME）。
- SemVer 解析 / 比较。
- 通过 GitHub Releases API 检查最新 stable release。
- 更新检查失败只影响单次请求，绝不拖垮主应用：
  所有异常统一抛 UpdateCheckError，由 router 转成稳定的 UPDATE_CHECK_FAILED 错误码。
- GITHUB_TOKEN 仅用于私有仓库只读访问，严禁写入任何日志。
"""
from __future__ import annotations

import re
import time
from typing import Any, Dict, Optional, Tuple

import httpx

from app.config import (
    APP_VERSION,
    GIT_SHA,
    BUILD_TIME,
    GITHUB_REPOSITORY,
    GITHUB_TOKEN,
    UPDATE_CHANNEL,
)
from app.core.logging import get_logger

logger = get_logger(__name__)

# 当前版本，去掉 v 前缀统一为 SemVer（如 1.2.0）；未注入时回退为开发占位
CURRENT_VERSION = (APP_VERSION or "0.0.0-development").strip().lstrip("v") or "0.0.0-development"

# stable 通道：忽略 draft / prerelease
_STABLE_CHANNEL = "stable"

_SEMVER_RE = re.compile(
    r"^v?(?P<major>\d+)\.(?P<minor>\d+)\.(?P<patch>\d+)"
    r"(?:-(?P<prerelease>[0-9A-Za-z.-]+))?(?:\+(?P<build>[0-9A-Za-z.-]+))?$"
)

_GITHUB_API = "https://api.github.com"
# 更新检查超时：GitHub 挂掉时快速失败，不影响主应用
_CHECK_TIMEOUT = httpx.Timeout(8.0, connect=5.0)


class UpdateCheckError(Exception):
    """更新检查失败（GitHub API / 网络 / 解析），携带稳定 error_code。"""

    def __init__(self, message: str = "update check failed"):
        super().__init__(message)
        self.error_code = "UPDATE_CHECK_FAILED"


def parse_semver(version: str) -> Optional[Tuple[int, int, int]]:
    """解析 x.y.z，返回 (major, minor, patch)；非法版本返回 None。"""
    if not version:
        return None
    m = _SEMVER_RE.match(str(version).strip())
    if not m:
        return None
    return (int(m["major"]), int(m["minor"]), int(m["patch"]))


def compare_semver(a: str, b: str) -> Optional[int]:
    """比较两个 SemVer。返回 1 / 0 / -1；任一非法返回 None。"""
    pa, pb = parse_semver(a), parse_semver(b)
    if pa is None or pb is None:
        return None
    return (pa > pb) - (pa < pb)


def current_version() -> str:
    return CURRENT_VERSION


def version_info() -> Dict[str, str]:
    """GET /api/system/version 用的当前构建信息。"""
    return {
        "version": CURRENT_VERSION,
        "git_sha": GIT_SHA,
        "build_time": BUILD_TIME,
    }


def _github_headers() -> Dict[str, str]:
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "enova-video-updater",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if GITHUB_TOKEN:
        headers["Authorization"] = f"Bearer {GITHUB_TOKEN}"
    return headers


def _fetch_releases() -> list:
    """拉取 GitHub releases 原始列表（网络层，不判稳定性）。"""
    url = f"{_GITHUB_API}/repos/{GITHUB_REPOSITORY}/releases"
    params = {"per_page": "20"}
    with httpx.Client(timeout=_CHECK_TIMEOUT) as client:
        resp = client.get(url, params=params, headers=_github_headers())
        resp.raise_for_status()
        releases = resp.json()
    if not isinstance(releases, list):
        raise UpdateCheckError("unexpected GitHub releases response")
    return releases


def _is_stable(release: dict) -> bool:
    """stable 通道过滤：忽略 draft / prerelease / 无 tag。"""
    return not release.get("draft") and not release.get("prerelease") and bool(release.get("tag_name"))


def _latest_stable() -> Optional[Dict[str, Any]]:
    """在 stable 列表里选出 SemVer 最高的 release。"""
    best: Optional[Dict[str, Any]] = None
    best_key: Optional[Tuple[int, int, int]] = None
    for release in _fetch_releases():
        if UPDATE_CHANNEL == _STABLE_CHANNEL and not _is_stable(release):
            continue
        key = parse_semver(str(release.get("tag_name", "")))
        if key is None:
            continue
        if best_key is None or key > best_key:
            best, best_key = release, key
    return best


def check_update() -> Dict[str, Any]:
    """GET /api/system/update/check 核心逻辑。

    返回（成功时）：
        current_version / latest_version / update_available / published_at /
        release_notes / release_url / channel
    任何异常抛 UpdateCheckError -> UPDATE_CHECK_FAILED。
    """
    start = time.monotonic()
    release: Optional[Dict[str, Any]] = None
    try:
        release = _latest_stable()
    except UpdateCheckError:
        raise
    except Exception as exc:  # 网络 / 超时 / 非预期
        logger.info(
            "update_check_failed error_code=UPDATE_CHECK_FAILED repo=%s current=%s channel=%s",
            GITHUB_REPOSITORY,
            CURRENT_VERSION,
            UPDATE_CHANNEL,
        )
        logger.debug("update check exception: %s", exc)
        raise UpdateCheckError(str(exc)) from exc
    finally:
        logger.info(
            "update_check current=%s repo=%s channel=%s duration_ms=%d",
            CURRENT_VERSION,
            GITHUB_REPOSITORY,
            UPDATE_CHANNEL,
            int((time.monotonic() - start) * 1000),
        )

    if release is None:
        # 没有 stable release：视为「已是最新」，而不是失败
        return {
            "current_version": CURRENT_VERSION,
            "latest_version": CURRENT_VERSION,
            "update_available": False,
            "published_at": None,
            "release_notes": "",
            "release_url": "",
            "channel": UPDATE_CHANNEL,
        }

    latest_tag = str(release.get("tag_name", "")).strip().lstrip("v")
    cmp = compare_semver(CURRENT_VERSION, latest_tag)
    update_available = cmp is not None and cmp < 0

    return {
        "current_version": CURRENT_VERSION,
        "latest_version": latest_tag,
        "update_available": update_available,
        "published_at": release.get("published_at"),
        "release_notes": release.get("body") or "",
        "release_url": release.get("html_url") or "",
        "channel": UPDATE_CHANNEL,
    }