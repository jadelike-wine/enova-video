import sqlite3
import logging
from pathlib import Path
from contextlib import contextmanager
from app.config import DATABASE_PATH, BASE_DIR

logger = logging.getLogger(__name__)


def _migrate_video_tasks_status():
    with sqlite3.connect(DATABASE_PATH) as conn:
        row = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='video_tasks'"
        ).fetchone()
        if not row or "'submitting'" in row[0]:
            return

        logger.info("Applying migration %s", "video_tasks_status_submitting")

        conn.executescript("""
            CREATE TABLE video_tasks_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                model TEXT NOT NULL DEFAULT 'agnes-video-v2.0',
                mode TEXT NOT NULL CHECK(mode IN ('text2video', 'img2video', 'multi_img', 'keyframes')),
                prompt TEXT NOT NULL,
                negative_prompt TEXT,
                task_id TEXT,
                video_id TEXT,
                width INTEGER DEFAULT 1152,
                height INTEGER DEFAULT 768,
                num_frames INTEGER DEFAULT 121,
                frame_rate REAL DEFAULT 24,
                num_inference_steps INTEGER,
                seed INTEGER,
                input_images TEXT,
                output_url TEXT,
                qiniu_url TEXT,
                status TEXT NOT NULL DEFAULT 'queued'
                    CHECK(status IN ('submitting', 'queued', 'in_progress', 'completed', 'failed')),
                progress INTEGER DEFAULT 0,
                seconds TEXT,
                size TEXT,
                duration_ms INTEGER DEFAULT 0,
                error_message TEXT,
                request_params TEXT,
                api_key_id INTEGER,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
                completed_at TEXT
            );
            INSERT INTO video_tasks_new SELECT * FROM video_tasks;
            DROP TABLE video_tasks;
            ALTER TABLE video_tasks_new RENAME TO video_tasks;
            CREATE INDEX IF NOT EXISTS idx_video_tasks_status ON video_tasks(status);
            CREATE INDEX IF NOT EXISTS idx_video_tasks_video_id ON video_tasks(video_id);
            CREATE INDEX IF NOT EXISTS idx_video_tasks_created_at ON video_tasks(created_at DESC);
        """)
        conn.commit()
        logger.info("Migration %s completed", "video_tasks_status_submitting")


def _migrate_storage_columns():
    """为 image_tasks / video_tasks 幂等新增对象存储列（storage_provider / storage_key）。

    旧库升级后：
    - 不 DROP 表、不重建、不丢历史记录
    - 旧记录 storage_provider / storage_key 为 NULL，仍通过原 qiniu_url / output_url 展示
    可重复执行。
    """
    with sqlite3.connect(DATABASE_PATH) as conn:
        for table in ("image_tasks", "video_tasks"):
            cols = {r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}
            for col in ("storage_provider", "storage_key"):
                if col not in cols:
                    conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} TEXT")
        conn.commit()
    logger.info("Migration %s completed", "add_storage_columns")


def _migrate_api_key_pool():
    """为 api_keys 幂等新增 is_enabled 列（视频 Token Pool 参与开关）。

    向后兼容：
    - 已有记录默认 is_enabled = 1，因此升级后原来的 active key 仍会加入 Pool，
      不会因为迁移导致原有效 key 突然不可用。
    - 不重建表、不丢历史记录，可重复执行。
    """
    with sqlite3.connect(DATABASE_PATH) as conn:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(api_keys)").fetchall()}
        if "is_enabled" not in cols:
            conn.execute(
                "ALTER TABLE api_keys ADD COLUMN is_enabled INTEGER NOT NULL DEFAULT 1 "
                "CHECK(is_enabled IN (0, 1))"
            )
        conn.commit()
    logger.info("Migration %s completed", "add_api_keys_is_enabled")


def _migrate_video_api_key_id():
    """为 video_tasks 幂等新增 api_key_id 列，记录创建该视频时使用的 Token。

    老记录（无 api_key_id）在轮询时兼容 fallback 到可用 Token，不影响历史数据。
    可重复执行。
    """
    with sqlite3.connect(DATABASE_PATH) as conn:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(video_tasks)").fetchall()}
        if "api_key_id" not in cols:
            conn.execute("ALTER TABLE video_tasks ADD COLUMN api_key_id INTEGER")
        conn.commit()
    logger.info("Migration %s completed", "add_video_tasks_api_key_id")


def init_db():
    db_path = Path(DATABASE_PATH)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    schema_path = BASE_DIR / "sql" / "schema.sql"
    logger.info("SQLite initialized path=%s", DATABASE_PATH)
    try:
        with sqlite3.connect(DATABASE_PATH) as conn:
            conn.executescript(schema_path.read_text(encoding="utf-8"))
            cols = {row[1] for row in conn.execute("PRAGMA table_info(messages)").fetchall()}
            if "model" not in cols:
                conn.execute("ALTER TABLE messages ADD COLUMN model TEXT")
            conn.commit()
    except Exception:
        logger.error("Database initialization failed", exc_info=True)
        raise
    _migrate_video_tasks_status()
    _migrate_storage_columns()
    _migrate_api_key_pool()
    _migrate_video_api_key_id()
    from app.services.api_key_service import import_env_api_key_if_empty
    from app.services.app_settings_service import ensure_default_settings

    ensure_default_settings()
    import_env_api_key_if_empty()


@contextmanager
def get_db():
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        logger.error("Database transaction failure", exc_info=True)
        raise
    finally:
        conn.close()


def row_to_dict(row):
    if row is None:
        return None
    return dict(row)
