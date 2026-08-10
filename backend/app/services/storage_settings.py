"""Storage 配置来源：环境变量与网页设置（app_settings）合并。

优先级：网页设置（DB）优先，环境变量兜底。
AWS 凭据（ACCESS_KEY / SECRET / SESSION_TOKEN）只从环境变量 / IAM Role 获取，
绝不由网页写入，避免把 Secret 暴露到浏览器。

注意：boto3 自身会走 AWS 默认 Credential Provider Chain（IAM Role / AWS_PROFILE /
环境变量），因此本模块不校验也不读取凭据，EC2/ECS/EKS 可直接绑定 IAM Role。
"""
from __future__ import annotations

import os

from app.database import get_db

STORAGE_PROVIDER_KEY = "storage_provider"
AWS_REGION_KEY = "aws_region"
AWS_BUCKET_KEY = "aws_s3_bucket"
AWS_PREFIX_KEY = "aws_s3_prefix"
AWS_PUBLIC_BASE_URL_KEY = "aws_s3_public_base_url"
AWS_ENDPOINT_URL_KEY = "aws_s3_endpoint_url"

VALID_PROVIDERS = ("none", "qiniu", "s3")


def _db_value(key: str) -> str:
    with get_db() as conn:
        row = conn.execute(
            "SELECT value FROM app_settings WHERE key = ?", (key,)
        ).fetchone()
        if row and row[0].strip():
            return row[0].strip()
    return ""


def _get(key: str, env_name: str, default: str = "") -> str:
    db = _db_value(key)
    if db:
        return db
    return os.getenv(env_name, "").strip() or default


def set_storage_setting(key: str, value: str) -> None:
    """网页设置写入非敏感配置（幂等 UPSERT）。"""
    with get_db() as conn:
        conn.execute(
            """INSERT INTO app_settings (key, value, updated_at)
               VALUES (?, ?, datetime('now', 'localtime'))
               ON CONFLICT(key) DO UPDATE SET
                 value = excluded.value,
                 updated_at = excluded.updated_at""",
            (key, (value or "").strip()),
        )


def get_storage_provider() -> str:
    p = _get(STORAGE_PROVIDER_KEY, "STORAGE_PROVIDER", "none").lower()
    return p if p in VALID_PROVIDERS else "none"


def get_aws_region() -> str:
    return _get(AWS_REGION_KEY, "AWS_REGION", "")


def get_aws_bucket() -> str:
    return _get(AWS_BUCKET_KEY, "AWS_S3_BUCKET", "")


def get_aws_prefix() -> str:
    return _get(AWS_PREFIX_KEY, "AWS_S3_PREFIX", "agnes-ai")


def get_aws_public_base_url() -> str:
    return _get(AWS_PUBLIC_BASE_URL_KEY, "AWS_S3_PUBLIC_BASE_URL", "").rstrip("/")


def get_aws_endpoint_url() -> str:
    return _get(AWS_ENDPOINT_URL_KEY, "AWS_S3_ENDPOINT_URL", "")


def is_qiniu_configured() -> bool:
    from app.config import (  # 延迟导入避免循环依赖
        QINIU_ACCESS_KEY,
        QINIU_BUCKET,
        QINIU_DOMAIN,
        QINIU_SECRET_KEY,
    )

    return bool(
        QINIU_ACCESS_KEY and QINIU_SECRET_KEY and QINIU_BUCKET and QINIU_DOMAIN
    )


def is_storage_ready() -> bool:
    """判断当前 Provider 是否已完整配置（用于前端状态展示与能力门禁）。"""
    provider = get_storage_provider()
    if provider == "qiniu":
        return is_qiniu_configured()
    if provider == "s3":
        return bool(get_aws_bucket())
    return False


def storage_config_snapshot() -> dict:
    """返回非敏感存储配置快照（不包含任何凭据）。用于 /api/settings/status 与网页展示。"""
    return {
        "provider": get_storage_provider(),
        "qiniu_configured": is_qiniu_configured(),
        "aws_region": get_aws_region(),
        "aws_bucket": get_aws_bucket(),
        "aws_prefix": get_aws_prefix(),
        "aws_public_base_url": get_aws_public_base_url(),
        "aws_endpoint_url": get_aws_endpoint_url(),
    }


def detect_aws_credential_source() -> str:
    """安全地判断当前 AWS 凭据来源（不读取/打印凭据本身）。

    通过 boto3 的 session.get_credentials().method 判断：
    iam-role / env / assume-role / container / profile / sso / unknown。
    不破坏 AWS 默认 Credential Provider Chain。
    """
    try:
        import boto3
    except ImportError:
        return "unknown"
    try:
        session = boto3.Session()
        creds = session.get_credentials()
        if creds is None:
            # AWS_ACCESS_KEY_ID 等环境变量未设置时，get_credentials 可能返回 None
            if os.getenv("AWS_ACCESS_KEY_ID") or os.getenv("AWS_SECRET_ACCESS_KEY"):
                return "environment"
            return "default-chain"
        method = (getattr(creds, "method", "") or "").lower()
        mapping = {
            "assume-role": "iam-role",
            "env": "environment",
            "container": "container-role",
            "iam-role": "iam-role",
            "profile": "profile",
            "sso": "sso",
            "shared-credentials-file": "profile",
        }
        return mapping.get(method, method or "default-chain")
    except Exception:
        return "unknown"