import os
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent  # backend/
load_dotenv(BASE_DIR / ".env")

QINIU_ACCESS_KEY = os.getenv("QINIU_ACCESS_KEY", "").strip()
QINIU_SECRET_KEY = os.getenv("QINIU_SECRET_KEY", "").strip()
QINIU_BUCKET = os.getenv("QINIU_BUCKET", "").strip()
QINIU_DOMAIN = os.getenv("QINIU_DOMAIN", "").strip().rstrip("/")
QINIU_REGION = os.getenv("QINIU_REGION", "z0").strip()

DATABASE_PATH = os.getenv("DATABASE_PATH", str(BASE_DIR / "database" / "aimodel.db"))

# ---- 版本 / 发布信息（Docker build 时注入，见 VERSION 与 GitHub Actions）----
# 当前应用版本，SemVer，如 1.2.0（不带 v 前缀）
APP_VERSION = os.getenv("APP_VERSION", "").strip().lstrip("v")
# 构建时的 Git commit SHA
GIT_SHA = os.getenv("GIT_SHA", "").strip()
# 构建时间（UTC ISO 8601）
BUILD_TIME = os.getenv("BUILD_TIME", "").strip()

# ---- 更新检查（仅后端使用，绝不注入 NEXT_PUBLIC_*）----
# GitHub 仓库，形如 owner/repo
GITHUB_REPOSITORY = os.getenv("GITHUB_REPOSITORY", "jadelike-wine/enova-video").strip()
# 更新通道：stable（默认，忽略 draft / prerelease）
UPDATE_CHANNEL = os.getenv("UPDATE_CHANNEL", "stable").strip().lower() or "stable"
# 只读 GitHub Token（private 仓库需要；public 仓库可留空）。仅后端使用，禁止输出到日志。
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "").strip()

# ---- 日志 ----
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").strip().upper() or "INFO"
LOG_FORMAT = os.getenv("LOG_FORMAT", "text").strip().lower() or "text"
# 是否把用户 prompt 写入日志（默认关闭，避免把敏感/超长内容刷进 Docker log）
LOG_PROMPTS = os.getenv("LOG_PROMPTS", "false").lower() in ("1", "true", "yes", "on")
# 是否输出请求级 access 日志
ACCESS_LOG = os.getenv("ACCESS_LOG", "true").lower() in ("1", "true", "yes", "on")

_VALID_LOG_LEVELS = ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL")
if LOG_LEVEL not in _VALID_LOG_LEVELS:
    LOG_LEVEL = "INFO"
if LOG_FORMAT not in ("text", "json"):
    LOG_FORMAT = "text"

TEXT_MODELS = ["agnes-2.0-flash", "agnes-1.5-flash"]
IMAGE_MODELS = ["agnes-image-2.0-flash", "agnes-image-2.1-flash"]
VIDEO_MODELS = ["agnes-video-v2.0"]

IMAGE_SIZES = ["1024x768", "1024x1024", "768x1024", "768x768", "1280x720", "720x1280"]


def is_qiniu_configured() -> bool:
    return bool(
        QINIU_ACCESS_KEY
        and QINIU_SECRET_KEY
        and QINIU_BUCKET
        and QINIU_DOMAIN
    )


def validate_config():
    pass
