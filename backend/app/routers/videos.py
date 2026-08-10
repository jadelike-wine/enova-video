import asyncio
import json
from fastapi import APIRouter, HTTPException, UploadFile, File, BackgroundTasks
from app.database import get_db, row_to_dict
from app.schemas import VideoGenerateRequest
from app.services.agnes_client import agnes_client
from app.services.error_utils import (
    format_agnes_error,
    is_transient_http_error,
    classify_agnes_error,
    ApiError,
    ERROR_CODES,
)
from app.services.storage import get_storage_service, resolve_display_url
from app.services.video_poller import refresh_task_from_agnes
from app.core.logging import get_logger, set_task_id

logger = get_logger(__name__)

router = APIRouter(prefix="/api/videos", tags=["videos"])


def _serialize(row) -> dict:
    """序列化任务行，并把 qiniu_url 字段替换为当前可读的展示 URL。"""
    d = row_to_dict(row)
    if d:
        d["qiniu_url"] = resolve_display_url(d)
    return d


def _already_stored(row) -> bool:
    """判断该任务是否已转存到对象存储（避免重复上传）。"""
    return bool(row["qiniu_url"] or row["storage_provider"] or row["storage_key"])


async def _submit_to_agnes(task_id: int, payload: dict) -> dict:
    set_task_id(task_id)
    try:
        result = await agnes_client.create_video(payload)
        status = result.get("status", "queued")
        error_msg = format_agnes_error(result.get("error"))
        agnes_task_id = result.get("task_id") or result.get("id")
        video_id = result.get("video_id")
        if status == "failed" and not error_msg:
            error_msg = "视频生成失败（Agnes API 未返回具体原因）"
        with get_db() as conn:
            conn.execute(
                """UPDATE video_tasks SET task_id=?, video_id=?, status=?, progress=?, seconds=?, size=?, duration_ms=?,
                   error_message=? WHERE id=?""",
                (agnes_task_id, video_id,
                 status, result.get("progress", 0),
                 result.get("seconds"), result.get("size"), result.get("duration_ms", 0),
                 error_msg, task_id),
            )
            row = conn.execute("SELECT * FROM video_tasks WHERE id = ?", (task_id,)).fetchone()
        logger.info(
            "video generation submitted task_id=%s agnes_task_id=%s status=%s",
            task_id,
            agnes_task_id,
            status,
            extra={
                "task_id": task_id,
                "video_id": video_id,
                "status": status,
                "generation_id": task_id,
            },
        )
        return _serialize(row)
    except Exception as e:
        err_text = str(e).strip() or "提交到 Agnes API 失败（无详细错误信息）"
        with get_db() as conn:
            conn.execute(
                "UPDATE video_tasks SET status='failed', error_message=? WHERE id=?",
                (err_text, task_id),
            )
            row = conn.execute("SELECT * FROM video_tasks WHERE id = ?", (task_id,)).fetchone()
        logger.error(
            "video generation submit failed task_id=%s",
            task_id,
            exc_info=e,
            extra={"task_id": task_id, "error_code": classify_agnes_error(e)},
        )
        return _serialize(row)


@router.get("/models")
def list_models():
    return {
        "models": [{"id": "agnes-video-v2.0", "name": "Agnes Video V2.0"}],
        "modes": [
            {"id": "text2video", "name": "文生视频"},
            {"id": "img2video", "name": "图生视频"},
            {"id": "multi_img", "name": "多图视频"},
            {"id": "keyframes", "name": "关键帧动画"},
        ],
        "frame_presets": [
            {"label": "约 3 秒", "num_frames": 81, "frame_rate": 24},
            {"label": "约 5 秒", "num_frames": 121, "frame_rate": 24},
            {"label": "约 10 秒", "num_frames": 241, "frame_rate": 24},
            {"label": "约 18 秒", "num_frames": 441, "frame_rate": 24},
        ],
        "resolution_presets": [
            {"id": "480p-h", "group": "landscape", "label": "854×480（16:9，480p）", "width": 854, "height": 480},
            {"id": "720p-h", "group": "landscape", "label": "1280×720（16:9，720p）", "width": 1280, "height": 720},
            {"id": "1080p-h", "group": "landscape", "label": "1920×1080（16:9，1080p）", "width": 1920, "height": 1080},
            {"id": "480p-v", "group": "portrait", "label": "480×854（9:16，480p）", "width": 480, "height": 854},
            {"id": "720p-v", "group": "portrait", "label": "720×1280（9:16，720p）", "width": 720, "height": 1280},
            {"id": "1080p-v", "group": "portrait", "label": "1080×1920（9:16，1080p）", "width": 1080, "height": 1920},
        ],
    }


@router.get("/tasks")
def list_tasks(limit: int = 20, offset: int = 0):
    limit = max(1, min(limit, 100))
    offset = max(0, offset)
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM video_tasks ORDER BY created_at DESC LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()
    return [_serialize(r) for r in rows]


@router.get("/tasks/{task_id}")
async def get_task(task_id: int):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM video_tasks WHERE id = ?", (task_id,)).fetchone()
    if not row:
        raise HTTPException(404, "任务不存在")

    should_sync = (
        row["video_id"]
        and row["status"] == "failed"
        and is_transient_http_error(Exception(row["error_message"] or ""))
    )
    if should_sync:
        try:
            await refresh_task_from_agnes(
                task_id,
                row["video_id"],
                row["model"],
                already_stored=_already_stored(row),
            )
            with get_db() as conn:
                row = conn.execute("SELECT * FROM video_tasks WHERE id = ?", (task_id,)).fetchone()
        except Exception:
            pass

    return _serialize(row)


@router.delete("/tasks/{task_id}")
def delete_task(task_id: int):
    with get_db() as conn:
        row = conn.execute("SELECT id FROM video_tasks WHERE id = ?", (task_id,)).fetchone()
        if not row:
            raise HTTPException(404, "任务不存在")
        conn.execute("DELETE FROM video_tasks WHERE id = ?", (task_id,))
    return {"ok": True}


@router.post("/generate")
async def generate_video(body: VideoGenerateRequest, background_tasks: BackgroundTasks):
    payload = {
        "model": body.model,
        "prompt": body.prompt,
        "width": body.width,
        "height": body.height,
        "num_frames": body.num_frames,
        "frame_rate": body.frame_rate,
    }
    if body.negative_prompt:
        payload["negative_prompt"] = body.negative_prompt
    if body.num_inference_steps:
        payload["num_inference_steps"] = body.num_inference_steps
    if body.seed is not None:
        payload["seed"] = body.seed

    input_images = None
    if body.mode == "text2video":
        pass
    elif body.mode == "img2video":
        if not body.image:
            raise HTTPException(400, "图生视频需要提供输入图片")
        payload["image"] = body.image if isinstance(body.image, str) else body.image[0]
        input_images = [payload["image"]]
    elif body.mode == "multi_img":
        imgs = body.images or (body.image if isinstance(body.image, list) else [body.image] if body.image else [])
        if len(imgs) < 2:
            raise HTTPException(400, "多图视频至少需要 2 张图片")
        payload["extra_body"] = {"image": imgs}
        input_images = imgs
    elif body.mode == "keyframes":
        imgs = body.images or (body.image if isinstance(body.image, list) else [])
        if len(imgs) < 2:
            raise HTTPException(400, "关键帧动画至少需要 2 张关键帧图片")
        payload["extra_body"] = {"image": imgs, "mode": "keyframes"}
        input_images = imgs

    with get_db() as conn:
        cur = conn.execute(
            """INSERT INTO video_tasks (model, mode, prompt, negative_prompt, width, height, num_frames,
               frame_rate, num_inference_steps, seed, input_images, status, request_params)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitting', ?)""",
            (body.model, body.mode, body.prompt, body.negative_prompt, body.width, body.height,
             body.num_frames, body.frame_rate, body.num_inference_steps, body.seed,
             json.dumps(input_images) if input_images else None,
             json.dumps(payload, ensure_ascii=False)),
        )
        task_id = cur.lastrowid
        row = conn.execute("SELECT * FROM video_tasks WHERE id = ?", (task_id,)).fetchone()

    set_task_id(task_id)
    logger.info(
        "video generation requested task_id=%s mode=%s model=%s image_count=%s",
        task_id,
        body.mode,
        body.model,
        len(input_images) if input_images else 0,
        extra={
            "task_id": task_id,
            "mode": body.mode,
            "model": body.model,
            "image_count": len(input_images) if input_images else 0,
        },
    )
    background_tasks.add_task(_submit_to_agnes, task_id, payload)
    return _serialize(row)


@router.post("/tasks/{task_id}/sync")
async def sync_video_task(task_id: int):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM video_tasks WHERE id = ?", (task_id,)).fetchone()
    if not row:
        raise HTTPException(404, "任务不存在")
    if row["status"] == "completed":
        return _serialize(row)
    if not row["video_id"]:
        raise HTTPException(400, "任务尚未提交到服务器，无法刷新状态")

    try:
        await refresh_task_from_agnes(
            task_id,
            row["video_id"],
            row["model"],
            already_stored=_already_stored(row),
        )
    except Exception as e:
        if is_transient_http_error(e):
            raise ApiError(
                429,
                "状态查询被限流，请稍后再试",
                ERROR_CODES["AGNES_RATE_LIMITED"],
            ) from e
        raise ApiError(502, str(e), classify_agnes_error(e)) from e

    with get_db() as conn:
        row = conn.execute("SELECT * FROM video_tasks WHERE id = ?", (task_id,)).fetchone()
    return _serialize(row)


@router.post("/tasks/{task_id}/retry")
async def retry_task(task_id: int, background_tasks: BackgroundTasks):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM video_tasks WHERE id = ?", (task_id,)).fetchone()
    if not row:
        raise HTTPException(404, "任务不存在")
    if row["status"] != "failed":
        raise HTTPException(400, "只有失败的任务可以重试")

    if row["video_id"]:
        try:
            await refresh_task_from_agnes(
                task_id,
                row["video_id"],
                row["model"],
                already_stored=_already_stored(row),
            )
            with get_db() as conn:
                row = conn.execute("SELECT * FROM video_tasks WHERE id = ?", (task_id,)).fetchone()
            return _serialize(row)
        except Exception as e:
            if is_transient_http_error(e):
                raise ApiError(
                    429,
                    "状态查询被限流，视频可能仍在生成中，请稍后再试",
                    ERROR_CODES["AGNES_RATE_LIMITED"],
                ) from e
            raise ApiError(502, str(e), classify_agnes_error(e)) from e

    if not row["request_params"]:
        raise HTTPException(400, "缺少请求参数，无法重试")

    payload = json.loads(row["request_params"])
    with get_db() as conn:
        conn.execute(
            """UPDATE video_tasks SET status='submitting', progress=0, error_message=NULL,
               task_id=NULL, video_id=NULL, output_url=NULL, qiniu_url=NULL,
               storage_provider=NULL, storage_key=NULL,
               seconds=NULL, size=NULL, completed_at=NULL WHERE id=?""",
            (task_id,),
        )
        row = conn.execute("SELECT * FROM video_tasks WHERE id = ?", (task_id,)).fetchone()

    background_tasks.add_task(_submit_to_agnes, task_id, payload)
    return _serialize(row)


@router.post("/upload")
async def upload_image(file: UploadFile = File(...)):
    content = await file.read()
    ext = (file.filename or "image.png").rsplit(".", 1)[-1].lower()
    if ext not in ("png", "jpg", "jpeg", "webp"):
        ext = "png"
    uploaded = await asyncio.to_thread(
        get_storage_service().upload_bytes, content, "img", ext
    )
    if not uploaded:
        raise HTTPException(400, "未配置对象存储，无法上传")
    with get_db() as conn:
        conn.execute(
            """INSERT INTO uploads (filename, original_name, qiniu_key, qiniu_url, file_type, size_bytes)
               VALUES (?, ?, ?, ?, 'img', ?)""",
            (uploaded["key"], file.filename, uploaded["key"], uploaded["url"], uploaded["size"]),
        )
    return {"url": uploaded["url"], "key": uploaded["key"]}
