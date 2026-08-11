"""视频 Token Pool（ApiKeyPool）单元测试。

覆盖：
- Round Robin 顺序（A B C A B C）
- 高并发下无 race、分布均匀、不会全部拿到同一 Token
- Disabled Token 跳过（A C A C）
- 429 cooldown：冷却期跳过，到期自动重新进入池
- 全部 cooldown：不 busy loop，返回明确错误（NoAvailableApiKey）
- 401/403：标记 unavailable，后续选择跳过
- Secret safety：返回 dict / 句柄只含脱敏 key_suffix，不含完整 Token
- 视频 Token 绑定：轮询优先使用创建时绑定的 Key（_resolve_poll_key）
- 单 Token 兼容：只有一个 Token 时仍可正常获取
"""
import asyncio
import time
import unittest
from unittest import mock

from app.services import api_key_pool as pool_mod
from app.services.api_key_pool import (
    ApiKeyPool,
    NoAvailableApiKey,
    _mask,
)


def _mk(entries):
    """构造一个注入条目的 Pool，跳过真实 DB 装载。"""
    pool = ApiKeyPool(per_key_limit=1, refresh_ttl=9999)
    pool.seed_entries(
        [
            {"id": e[0], "name": e[1], "api_key": e[2], "is_enabled": e[3]}
            for e in entries
        ]
    )
    return pool


A = (1, "Token A", "sk-AAAA-abcdef", True)
B = (2, "Token B", "sk-BBBB-123456", True)
C = (3, "Token C", "sk-CCCC-789012", True)


class TestMask(unittest.TestCase):
    def test_mask_hides_all_but_last4(self):
        self.assertEqual(_mask("sk-AAAAAAAA-1234"), "****1234")
        self.assertEqual(_mask("short"), "****")


class TestBreakRoundRobin(unittest.TestCase):
    def test_round_robin_order(self):
        pool = _mk([A, B, C])
        seen = []
        for _ in range(6):
            key = pool.get_next_api_key()
            self.assertIsNotNone(key)
            seen.append(key["id"])
            pool.release(key["id"])
        self.assertEqual(seen, [1, 2, 3, 1, 2, 3])

    def test_single_token_still_works(self):
        pool = _mk([A])
        for _ in range(3):
            key = pool.get_next_api_key()
            self.assertIsNotNone(key)
            self.assertEqual(key["id"], 1)
            pool.release(key["id"])

    def test_disabled_token_skipped(self):
        pool = _mk([A, (2, "Token B", "sk-B", False), C])
        seen = []
        for _ in range(6):
            key = pool.get_next_api_key()
            self.assertIsNotNone(key)
            self.assertNotEqual(key["id"], 2)
            seen.append(key["id"])
            pool.release(key["id"])
        self.assertEqual(seen, [1, 3, 1, 3, 1, 3])


class TestCooldown(unittest.TestCase):
    def test_rate_limited_token_skipped_until_expiry(self):
        pool = _mk([A, B, C])
        pool.mark_rate_limited(1, retry_after=10)
        # Token A 冷却，后续拿到的应是 B / C
        k1 = pool.get_next_api_key()
        self.assertNotEqual(k1["id"], 1)
        pool.release(k1["id"])
        k2 = pool.get_next_api_key()
        self.assertNotEqual(k2["id"], 1)
        pool.release(k2["id"])
        # 手动让 Token A 冷却到期，A 应重新进入 Pool
        with pool._lock:
            pool._entries[1].cooldown_until = time.monotonic() - 1
        seen = []
        for _ in range(3):
            key = pool.get_next_api_key()
            self.assertIsNotNone(key)
            seen.append(key["id"])
            pool.release(key["id"])
        self.assertIn(1, seen)

    def test_all_cooldown_raises_without_busy_loop(self):
        pool = _mk([A, B, C])
        pool_mod.ACQUIRE_WAIT_STEP = 0.001
        max_wait_backup = pool_mod.MAX_ACQUIRE_WAIT
        pool_mod.MAX_ACQUIRE_WAIT = 3
        try:
            pool.mark_rate_limited(1, retry_after=300)
            pool.mark_rate_limited(2, retry_after=300)
            pool.mark_rate_limited(3, retry_after=300)
            with self.assertRaises(NoAvailableApiKey):
                asyncio.run(pool.acquire())
        finally:
            pool_mod.ACQUIRE_WAIT_STEP = 0.5
            pool_mod.MAX_ACQUIRE_WAIT = max_wait_backup

    def test_401_marks_unavailable_and_skips(self):
        pool = _mk([A, B, C])
        pool.mark_failed(1, status=401)
        seen = []
        for _ in range(4):
            key = pool.get_next_api_key()
            self.assertIsNotNone(key)
            self.assertNotEqual(key["id"], 1)
            seen.append(key["id"])
            pool.release(key["id"])
        self.assertEqual(seen, [2, 3, 2, 3])


class TestConcurrency(unittest.TestCase):
    async def _hammer(self, pool, n, per_key_limit):
        pool.per_key_limit = per_key_limit
        results = []

        async def grab():
            async with (await pool.acquire()) as key:
                results.append(key.id)
                await asyncio.sleep(0)

        await asyncio.gather(*[grab() for _ in range(n)])
        return results

    def test_high_concurrency_even_distribution(self):
        pool = _mk([A, B, C])
        results = asyncio.run(self._hammer(pool, 30, per_key_limit=100))
        self.assertEqual(len(results), 30)
        dist = {1: 0, 2: 0, 3: 0}
        for rid in results:
            dist[rid] += 1
        # 均匀分布：每个 Token 恰好 10 次
        self.assertEqual(dist, {1: 10, 2: 10, 3: 10})

    def test_high_concurrency_no_race_when_per_key_capped(self):
        # per_key_limit=1：同一时刻每个 Token 最多 1 个 in-flight，
        # 高并发下 acquire 必须互相等待而不是全部拿到同一个 Token。
        pool = _mk([A, B, C])
        results = asyncio.run(self._hammer(pool, 30, per_key_limit=1))
        self.assertEqual(len(results), 30)
        dist = {1: results.count(1), 2: results.count(2), 3: results.count(3)}
        self.assertGreater(dist[1], 0)
        self.assertGreater(dist[2], 0)
        self.assertGreater(dist[3], 0)
        # 无 race：总数正确且没有异常抛出
        self.assertEqual(sum(dist.values()), 30)


class TestSecretSafety(unittest.TestCase):
    def test_returned_dict_contains_masked_suffix_not_full_key(self):
        pool = _mk([A])
        key = pool.get_next_api_key()
        pool.release(key["id"])
        self.assertIn("key_suffix", key)
        self.assertEqual(key["key_suffix"], "****cdef")
        self.assertNotIn("AAAA", key["key_suffix"])
        # dict 里的 raw api_key 仅内部使用，不通过 key_suffix/日志暴露完整值

    def test_key_suffix_never_equals_full_key(self):
        pool = _mk([A, B, C])
        for _ in range(6):
            key = pool.get_next_api_key()
            self.assertNotEqual(key["key_suffix"], key["api_key"])
            self.assertNotIn(key["api_key"][:-4], key["key_suffix"])
            pool.release(key["id"])

    def test_pool_status_has_no_token(self):
        pool = _mk([A, B, C])
        pool.mark_rate_limited(2, retry_after=50)
        status = pool.pool_status()
        self.assertEqual(status[1]["status"], "available")
        self.assertEqual(status[2]["status"], "cooldown")
        self.assertEqual(status[3]["status"], "available")
        for info in status.values():
            self.assertNotIn("api_key", info)
            self.assertNotIn("key", info)


class TestVideoTokenBinding(unittest.TestCase):
    def test_resolve_poll_key_prefers_bound_key(self):
        from app.services.video_poller import _resolve_poll_key

        bound = {"id": 2, "name": "Token B", "api_key": "sk-B", "key_suffix": "****B"}
        with mock.patch.object(pool_mod.api_key_pool, "get_api_key_by_id", return_value=bound), \
             mock.patch.object(pool_mod.api_key_pool, "get_any_api_key", return_value=None):
            key, used_id = _resolve_poll_key(2)
        self.assertEqual(used_id, 2)
        self.assertEqual(key["id"], 2)

    def test_resolve_poll_key_falls_back_for_legacy_task(self):
        from app.services.video_poller import _resolve_poll_key

        fallback = {"id": 1, "name": "Token A", "api_key": "sk-A", "key_suffix": "****A"}
        with mock.patch.object(pool_mod.api_key_pool, "get_api_key_by_id", return_value=None), \
             mock.patch.object(pool_mod.api_key_pool, "get_any_api_key", return_value=fallback):
            key, used_id = _resolve_poll_key(None)
        self.assertEqual(used_id, 1)
        self.assertEqual(key["id"], 1)


if __name__ == "__main__":
    unittest.main()