import asyncio
import threading
from app.database import get_db
from app.services.agnes_client import agnes_client
from app.services.error_utils import format_agnes_error, is_transient_http_error
from app.services.storage import get_storage_service
from app.core.logging import get_logger, set_task_id

logger = get_logger(__name__)


def _upload_storage_background(task_id: int, video_url: str):
    """将完成后的视频转存到当前 StorageProvider，不阻塞轮询线程。

    上传失败只记录日志并保留 Agnes 原始 URL，不把 AI 生成结果标记为失败。
    """
    set_task_id(task_id)
    try:
        uploaded = get_storage_service().upload_from_url(video_url, "video")
        if not uploaded:
            return
        with get_db() as conn:
            conn.execute(
                """UPDATE video_tasks SET qiniu_url=?, storage_provider=?, storage_key=? WHERE id=?""",
                (uploaded["url"] or None, uploaded["provider"], uploaded["key"], task_id),
            )
        logger.info(
            "Storage completed",
            extra={
                "task_id": task_id,
                "provider": uploaded["provider"],
                "object_key": uploaded["key"],
            },
        )
    except Exception as e:
        logger.warning(
            "storage task_id=%s upload_failed=true fallback=original_url",
            task_id,
            exc_info=e,
            extra={
                "task_id": task_id,
                "provider": getattr(get_storage_service(), "name", "unknown"),
                "upload_failed": True,
                "fallback": "original_url",
                "error_code": _storage_error_code(e),
            },
        )


def _storage_error_code(e: Exception) -> str:
    try:
        from app.services.error_utils import classify_s3_error

        return classify_s3_error(e)
    except Exception:
        return "STORAGE_UPLOAD_FAILED"


async def refresh_task_from_agnes(
    task_id: int, video_id: str, model: str, *, already_stored: bool = False
) -> bool:
    """Pull latest status from Agnes and persist it. Returns True if updated."""
    set_task_id(task_id)

    # 读取当前库内状态，用于判断是否发生状态变化（决定 INFO / DEBUG）
    with get_db() as conn:
        prev_row = conn.execute(
            "SELECT status FROM video_tasks WHERE id = ?", (task_id,)
        ).fetchone()
    prev_status = prev_row["status"] if prev_row else None

    result = await agnes_client.get_video_status(video_id, model)
    status = result.get("status", "queued")
    progress = result.get("progress", 0)

    update_fields = {
        "status": status,
        "progress": progress,
        "seconds": result.get("seconds"),
        "size": result.get("size"),
    }

    if status == "completed":
        video_url = result.get("remixed_from_video_id")
        update_fields["output_url"] = video_url
        update_fields["error_message"] = None
        logger.info(
            "video.poller task_id=%s status_transition=%s->completed",
            task_id,
            prev_status,
            extra={"task_id": task_id, "video_id": video_id, "status": "completed"},
        )
        if video_url and not already_stored:
            logger.info(
                "Storage started",
                extra={"task_id": task_id, "provider": get_storage_service().name, "media_type": "video"},
            )
            threading.Thread(
                target=_upload_storage_background,
                args=(task_id, video_url),
                daemon=True,
            ).start()
    elif status == "failed":
        err = result.get("error")
        update_fields["error_message"] = format_agnes_error(err) or "生成失败"
        logger.warning(
            "video.poller task_id=%s status_transition=%s->failed",
            task_id,
            prev_status,
            extra={
                "task_id": task_id,
                "video_id": video_id,
                "status": "failed",
                "error_code": "VIDEO_POLL_FAILED",
            },
        )
    elif status != prev_status:
        # 状态发生实际变化时才 INFO
        logger.info(
            "video.poller task_id=%s status_transition=%s->%s",
            task_id,
            prev_status,
            status,
            extra={"task_id": task_id, "video_id": video_id, "status": status, "progress": progress},
        )
    else:
        # 普通重复轮询用 DEBUG，避免刷屏
        logger.debug(
            "video.poller task_id=%s poll_result status=%s progress=%s",
            task_id,
            status,
            progress,
            extra={"task_id": task_id, "video_id": video_id, "status": status, "progress": progress},
        )

    with get_db() as conn:
        sets = ", ".join(f"{k} = ?" for k in update_fields)
        vals = list(update_fields.values())
        sql = f"UPDATE video_tasks SET {sets}"
        if status in ("completed", "failed"):
            sql += ", completed_at = datetime('now', 'localtime')"
        sql += " WHERE id = ?"
        vals.append(task_id)
        conn.execute(sql, vals)
    return True


async def _poll_one(row):
    already_stored = bool(
        row["qiniu_url"] or row["storage_provider"] or row["storage_key"]
    )
    await refresh_task_from_agnes(
        row["id"],
        row["video_id"],
        row["model"],
        already_stored=already_stored,
    )


async def poll_pending_videos():
    """Poll in-progress video tasks and update status."""
    with get_db() as conn:
        rows = conn.execute(
            """SELECT id, video_id, model, qiniu_url, storage_provider, storage_key
               FROM video_tasks
               WHERE status IN ('queued', 'in_progress') AND video_id IS NOT NULL
               ORDER BY created_at ASC"""
        ).fetchall()

    if not rows:
        return

    for row in rows:
        try:
            await _poll_one(row)
        except Exception as e:
            if is_transient_http_error(e):
                continue
            # Non-transient polling errors should not fail the task either.
            continue
        await asyncio.sleep(0.5)