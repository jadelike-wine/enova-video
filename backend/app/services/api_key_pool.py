"""视频生成 Token Pool（ApiKeyPool）。

职责：
- 在多个「池内启用」的 Agnes API Key 之间做 Round Robin 轮询分配。
- 并发安全（threading.Lock 只保护微秒级的状态更新，绝不在持锁时 sleep）。
- 429 冷却（优先 Retry-After，否则指数退避 + jitter），冷却中的 Key 自动跳过。
- 401/403 临时标记 unavailable（不删除、不记录完整 Token）。
- 每个 Key 的 in-flight 并发上限，避免并发请求全部挤到同一个 Token。

进程内限制：
- 当前为单进程实现（FastAPI 默认单 uvicorn worker）。若未来启用多 worker，
  Round Robin 计数器与冷却状态各自独立，跨进程可能短暂重复使用同一 Token，
  但不会产生数据错误（冷却/禁用等硬约束仍由 DB 的 is_enabled 保证）。
  需要多进程一致时，可把状态迁移到 Redis/DB，当前不引入。
"""

import asyncio
import random
import threading
import time
from dataclasses import dataclass
from typing import Optional

from app.config import (
    VIDEO_MAX_CONCURRENCY,
    VIDEO_MAX_IN_FLIGHT_PER_KEY,
)
from app.database import get_db
from app.core.logging import get_logger

logger = get_logger(__name__)

# 429 未带 Retry-After 时的指数退避基准（秒）
BACKOFF_BASE = (2.0, 5.0, 10.0, 20.0)
MAX_BACKOFF = 30.0
# 冷却退避可叠加的最大抖动（秒）
BACKOFF_JITTER = 0.5
# 401/403 后临时不可用的时长（秒），到期自动重新进入选择
UNAVAILABLE_TTL = 300.0
# 池内键集合的刷新 TTL（秒）。修改 DB 后最多延迟这么久生效。
POOL_REFRESH_TTL = 2.0
# acquire() 等待恢复的最大轮询次数（避免无限 busy loop）
MAX_ACQUIRE_WAIT = 60
# acquire() 每次轮询最多等待的秒数（避免长时间持锁思想下的空转）
ACQUIRE_WAIT_STEP = 0.5


class NoAvailableApiKey(RuntimeError):
    """池内没有可用 Token（全部冷却/不可用/忙或未配置）。"""

    def __init__(self, message: str, wait_seconds: Optional[float] = None):
        super().__init__(message)
        self.wait_seconds = wait_seconds


@dataclass
class PoolEntry:
    id: int
    name: str
    api_key: str
    cooldown_until: float = 0.0  # monotonic 时间戳，429 冷却到期时间
    unavailable_until: float = 0.0  # monotonic 时间戳，401/403 到期时间
    backoff_index: int = 0  # 指数退避档位


class _AcquiredKey:
    """acquire() 成功后的句柄，__aexit__ 自动释放该 Key 的 in-flight 槽位。"""

    __slots__ = ("_pool", "id", "name", "api_key", "key_suffix")

    def __init__(self, pool: "ApiKeyPool", entry: PoolEntry):
        self._pool = pool
        self.id = entry.id
        self.name = entry.name
        self.api_key = entry.api_key
        self.key_suffix = _mask(entry.api_key)

    async def __aenter__(self) -> "_AcquiredKey":
        return self

    async def __aexit__(self, *exc) -> None:
        self._pool.release(self.id)


def _mask(api_key: str) -> str:
    if len(api_key) <= 8:
        return "****"
    return f"****{api_key[-4:]}"


def _invoke_loader(loader) -> list:
    """loader 从 DB 读取「池内启用」的 Key 行。测试可注入假 loader。"""
    if callable(loader) and getattr(loader, "_is_pool_loader", False):
        return loader()
    with get_db() as conn:
        return conn.execute(
            "SELECT id, name, api_key FROM api_keys WHERE is_enabled = 1"
        ).fetchall()


class ApiKeyPool:
    def __init__(
        self,
        *,
        per_key_limit: int = VIDEO_MAX_IN_FLIGHT_PER_KEY,
        refresh_ttl: float = POOL_REFRESH_TTL,
        loader: Optional[callable] = None,
    ):
        self.per_key_limit = per_key_limit
        self._refresh_ttl = refresh_ttl
        self._loader = loader
        self._lock = threading.Lock()
        self._entries: dict[int, PoolEntry] = {}
        self._rr_order: list[int] = []  # 参与轮询的启用 Key id，circular
        self._rr_index = 0
        self._in_flight: dict[int, int] = {}
        self._last_refresh = 0.0

    # ---- 内部：数据装载 / 刷新 ----
    def _refresh_if_stale(self):
        now = time.monotonic()
        if now - self._last_refresh < self._refresh_ttl:
            return
        rows = _invoke_loader(self._loader)
        new_entries = {}
        for r in rows:
            row_id = r["id"]
            old = self._entries.get(row_id)
            new_entries[row_id] = PoolEntry(
                id=row_id,
                name=r["name"],
                api_key=r["api_key"],
                cooldown_until=old.cooldown_until if old else 0.0,
                unavailable_until=old.unavailable_until if old else 0.0,
                backoff_index=old.backoff_index if old else 0,
            )
        self._entries = new_entries
        # 保留已有顺序，追加新增 id
        existing = [eid for eid in self._rr_order if eid in new_entries]
        new_ids = [eid for eid in new_entries if eid not in self._rr_order]
        self._rr_order = existing + new_ids
        self._in_flight = {k: v for k, v in self._in_flight.items() if k in new_entries}
        self._last_refresh = now

    def _pick(self, now: float) -> Optional[PoolEntry]:
        ids = self._rr_order
        if not ids:
            return None
        n = len(ids)
        for step in range(n):
            idx = (self._rr_index + step) % n
            eid = ids[idx]
            entry = self._entries.get(eid)
            if not entry:
                continue
            if entry.cooldown_until and entry.cooldown_until > now:
                continue
            if entry.unavailable_until and entry.unavailable_until > now:
                continue
            if self._in_flight.get(eid, 0) >= self.per_key_limit:
                continue
            self._rr_index = (idx + 1) % n
            return entry
        return None

    def _earliest_recovery(self, now: float) -> Optional[float]:
        """返回最早可恢复的等待秒数；无可恢复（如全部 in-flight 满）返回 None。"""
        earliest = None
        for entry in self._entries.values():
            t = None
            if entry.cooldown_until and entry.cooldown_until > now:
                t = entry.cooldown_until
            if entry.unavailable_until and entry.unavailable_until > now:
                t = min(t, entry.unavailable_until) if t else entry.unavailable_until
            if t and (earliest is None or t < earliest):
                earliest = t
        return (earliest - now) if earliest is not None else None

    # ---- 对外接口：获取 / 释放 ----
    async def acquire(self, preferred_id: Optional[int] = None) -> _AcquiredKey:
        """获取一个可用 Token（按 Round Robin 选择，跳过冷却/不可用/超限）。

        无可用 Token 时按最早恢复时间有界等待，不 busy loop；等待次数达到上限
        抛出 NoAvailableApiKey。
        """
        for _ in range(MAX_ACQUIRE_WAIT):
            with self._lock:
                self._refresh_if_stale()
                now = time.monotonic()
                entry = self._pick(now)
                if entry:
                    self._in_flight[entry.id] = self._in_flight.get(entry.id, 0) + 1
                    logger.info(
                        "token_pool selected",
                        extra={
                            "api_key_id": entry.id,
                            "key_suffix": _mask(entry.api_key),
                            "reason": "round_robin",
                        },
                    )
                    return _AcquiredKey(self, entry)
                wait = self._earliest_recovery(now)
            step = min(wait, ACQUIRE_WAIT_STEP) if wait else ACQUIRE_WAIT_STEP
            await asyncio.sleep(step)
        raise NoAvailableApiKey(
            "所有 API Key 均不可用（冷却/禁用/繁忙），请稍后重试",
            wait_seconds=self._wait_seconds(),
        )

    def get_next_api_key(self) -> Optional[dict]:
        """同步版选择：返回一个可用的 Token 字典（id/name/api_key/key_suffix）。

        只会占用该 Key 的 in-flight 槽位，调用方必须在用完后调用 release(key_id)。
        无可用 Token 时返回 None（不等待）。
        """
        with self._lock:
            self._refresh_if_stale()
            now = time.monotonic()
            entry = self._pick(now)
            if not entry:
                return None
            self._in_flight[entry.id] = self._in_flight.get(entry.id, 0) + 1
            return {
                "id": entry.id,
                "name": entry.name,
                "api_key": entry.api_key,
                "key_suffix": _mask(entry.api_key),
            }

    def get_any_api_key(self) -> Optional[dict]:
        """轻量选择：返回一个健康 Token（不占用 in-flight 槽位）。

        供视频轮询等低频、不想追踪并发槽位的场景使用。无健康 Token 返回 None。
        """
        with self._lock:
            self._refresh_if_stale()
            now = time.monotonic()
            entry = self._pick(now)
            if not entry:
                return None
            return {
                "id": entry.id,
                "name": entry.name,
                "api_key": entry.api_key,
                "key_suffix": _mask(entry.api_key),
            }

    def release(self, key_id: int) -> None:
        with self._lock:
            cur = self._in_flight.get(key_id, 0)
            if cur > 0:
                self._in_flight[key_id] = cur - 1

    def get_api_key_by_id(self, key_id: int) -> Optional[dict]:
        """按 id 取 Token（含已禁用 Key，供任务轮询绑定使用）。无则 None。"""
        with self._lock:
            self._refresh_if_stale()
            entry = self._entries.get(key_id)
            if entry:
                return {
                    "id": entry.id,
                    "name": entry.name,
                    "api_key": entry.api_key,
                    "key_suffix": _mask(entry.api_key),
                }
        # 可能引用了已禁用/新增的 Key，直接从 DB 查
        with get_db() as conn:
            row = conn.execute(
                "SELECT id, name, api_key FROM api_keys WHERE id = ?", (key_id,)
            ).fetchone()
        if not row:
            return None
        return {
            "id": row["id"],
            "name": row["name"],
            "api_key": row["api_key"],
            "key_suffix": _mask(row["api_key"]),
        }

    # ---- 对外接口：状态上报 ----
    def mark_rate_limited(self, key_id: int, retry_after: Optional[float] = None) -> None:
        """Token 收到 429：进入冷却。Retry-After 优先，否则指数退避 + jitter。"""
        with self._lock:
            entry = self._entries.get(key_id)
            if not entry:
                return
            now = time.monotonic()
            if retry_after and retry_after > 0:
                cooldown = float(retry_after)
            else:
                base = BACKOFF_BASE[min(entry.backoff_index, len(BACKOFF_BASE) - 1)]
                cooldown = base
            entry.backoff_index += 1
            jitter = random.uniform(0, BACKOFF_JITTER)
            entry.cooldown_until = now + cooldown + jitter
            logger.info(
                "api_key rate limited",
                extra={
                    "api_key_id": key_id,
                    "key_suffix": _mask(entry.api_key),
                    "cooldown_seconds": round(cooldown, 2),
                },
            )

    def mark_failed(self, key_id: int, status: Optional[int] = None) -> None:
        """Token 401/403：临时标记 unavailable（到期自动恢复），不删除、不记录完整 Token。"""
        with self._lock:
            entry = self._entries.get(key_id)
            if not entry:
                return
            entry.unavailable_until = time.monotonic() + UNAVAILABLE_TTL
            entry.backoff_index = 0
            logger.warning(
                "api_key unavailable",
                extra={
                    "api_key_id": key_id,
                    "key_suffix": _mask(entry.api_key),
                    "status": status,
                },
            )

    def mark_success(self, key_id: int) -> None:
        """Token 请求成功：重置退避档位，使其回到健康状态。"""
        with self._lock:
            entry = self._entries.get(key_id)
            if not entry:
                return
            entry.backoff_index = 0

    def invalidate(self) -> None:
        """强制下次选择时重新从 DB 装载（用于 Key 增删改后即时生效）。"""
        with self._lock:
            self._last_refresh = 0.0

    def _wait_seconds(self) -> Optional[float]:
        with self._lock:
            return self._earliest_recovery(time.monotonic())

    # ---- 设置页展示：池状态 ----
    def pool_status(self) -> dict:
        """返回 {key_id: {"status": "available"|"cooldown"|"unavailable"}}。"""
        with self._lock:
            self._refresh_if_stale()
            now = time.monotonic()
            out = {}
            for eid, entry in self._entries.items():
                if entry.cooldown_until and entry.cooldown_until > now:
                    out[eid] = {"status": "cooldown"}
                elif entry.unavailable_until and entry.unavailable_until > now:
                    out[eid] = {"status": "unavailable"}
                else:
                    out[eid] = {"status": "available"}
            return out

    # ---- 测试辅助：注入条目 ----
    def seed_entries(self, entries: list[dict]) -> None:
        """直接注入内存条目用于测试（id/name/api_key/is_enabled）。"""
        with self._lock:
            self._entries = {}
            self._rr_order = []
            for e in entries:
                if not e.get("is_enabled", True):
                    continue
                self._entries[e["id"]] = PoolEntry(
                    id=e["id"], name=e["name"], api_key=e["api_key"]
                )
                self._rr_order.append(e["id"])
            self._in_flight = {}
            self._rr_index = 0
            self._last_refresh = time.monotonic()


# 全局单例（绑定真实 DB）。并发信号量复用全局并发上限。
class _VideoConcurrency:
    _sem = None

    def __call__(self):
        import asyncio

        if self._sem is None:
            self._sem = asyncio.Semaphore(VIDEO_MAX_CONCURRENCY)
        return self._sem


get_video_concurrency_semaphore = _VideoConcurrency()

api_key_pool = ApiKeyPool()