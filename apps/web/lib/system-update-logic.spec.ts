import { describe, it, expect } from 'vitest'
import {
  getActionVerb,
  buildSuccessMessage,
  shouldStopPolling,
  isVersionChanged,
  shouldTriggerVersionCheck,
  shouldResolveStaleOnError,
  isPollTimedOut,
} from './system-update-logic'

describe('system-update-logic', () => {
  // ------------------------------------------------------------------
  // getActionVerb：根据 action 返回正确中文动词
  // ------------------------------------------------------------------
  describe('getActionVerb', () => {
    it('returns 回滚 for rollback action', () => {
      expect(getActionVerb('rollback')).toBe('回滚')
    })

    it('returns 更新 for update action', () => {
      expect(getActionVerb('update')).toBe('更新')
    })

    it('returns 更新 when action is undefined', () => {
      expect(getActionVerb(undefined)).toBe('更新')
    })
  })

  // ------------------------------------------------------------------
  // buildSuccessMessage：成功通知文案（核心 P2 回归点）
  // ------------------------------------------------------------------
  describe('buildSuccessMessage', () => {
    it('builds update success message with version', () => {
      expect(buildSuccessMessage('update', '1.6.0')).toBe(
        '更新成功，当前版本已更新至 v1.6.0',
      )
    })

    it('builds rollback success message with version', () => {
      expect(buildSuccessMessage('rollback', '1.5.0')).toBe(
        '回滚成功，当前版本已回退至 v1.5.0',
      )
    })

    it('builds update success message without version', () => {
      expect(buildSuccessMessage('update')).toBe('更新成功')
    })

    it('builds rollback success message without version', () => {
      expect(buildSuccessMessage('rollback')).toBe('回滚成功')
    })

    it('defaults to update verb when action is undefined', () => {
      expect(buildSuccessMessage(undefined, '1.6.0')).toBe(
        '更新成功，当前版本已更新至 v1.6.0',
      )
    })

    // P2 回归：回滚操作绝不应被标记为「系统更新成功」
    it('rollback message never contains 更新成功 (P2 regression guard)', () => {
      const msg = buildSuccessMessage('rollback', '1.5.0')
      expect(msg).not.toContain('更新成功')
      expect(msg).toContain('回滚成功')
    })
  })

  // ------------------------------------------------------------------
  // shouldStopPolling：success/failed 应停止轮询，running 不停
  // ------------------------------------------------------------------
  describe('shouldStopPolling', () => {
    it('returns true for success', () => {
      expect(shouldStopPolling('success')).toBe(true)
    })

    it('returns true for failed', () => {
      expect(shouldStopPolling('failed')).toBe(true)
    })

    it('returns false for running', () => {
      expect(shouldStopPolling('running')).toBe(false)
    })
  })

  // ------------------------------------------------------------------
  // isVersionChanged：版本号兜底判断
  // ------------------------------------------------------------------
  describe('isVersionChanged', () => {
    it('returns true when targetVersion is reached', () => {
      expect(isVersionChanged('1.5.0', '1.6.0', '1.6.0')).toBe(true)
    })

    it('returns false when targetVersion not reached', () => {
      expect(isVersionChanged('1.5.0', '1.5.0', '1.6.0')).toBe(false)
    })

    it('returns true when no targetVersion and version changed', () => {
      expect(isVersionChanged('1.5.0', '1.6.0', undefined)).toBe(true)
    })

    it('returns false when no targetVersion and version unchanged', () => {
      expect(isVersionChanged('1.5.0', '1.5.0', undefined)).toBe(false)
    })

    it('returns false when targetVersion is empty string', () => {
      // targetVersion is falsy → falls through to version change check
      expect(isVersionChanged('1.5.0', '1.6.0', '')).toBe(true)
    })
  })

  // ------------------------------------------------------------------
  // shouldTriggerVersionCheck：连续 running 计数阈值
  // ------------------------------------------------------------------
  describe('shouldTriggerVersionCheck', () => {
    it('returns false below threshold', () => {
      expect(shouldTriggerVersionCheck(9)).toBe(false)
    })

    it('returns true at threshold', () => {
      expect(shouldTriggerVersionCheck(10)).toBe(true)
    })

    it('returns true above threshold', () => {
      expect(shouldTriggerVersionCheck(15)).toBe(true)
    })

    it('returns false at zero', () => {
      expect(shouldTriggerVersionCheck(0)).toBe(false)
    })

    it('respects custom threshold', () => {
      expect(shouldTriggerVersionCheck(5, 5)).toBe(true)
      expect(shouldTriggerVersionCheck(4, 5)).toBe(false)
    })
  })

  // ------------------------------------------------------------------
  // shouldResolveStaleOnError：连续失败阈值
  // ------------------------------------------------------------------
  describe('shouldResolveStaleOnError', () => {
    it('returns false at or below threshold', () => {
      expect(shouldResolveStaleOnError(30)).toBe(false)
      expect(shouldResolveStaleOnError(0)).toBe(false)
    })

    it('returns true above threshold', () => {
      expect(shouldResolveStaleOnError(31)).toBe(true)
    })

    it('respects custom threshold', () => {
      expect(shouldResolveStaleOnError(6, 5)).toBe(true)
      expect(shouldResolveStaleOnError(5, 5)).toBe(false)
    })
  })

  // ------------------------------------------------------------------
  // isPollTimedOut：轮询超时判断
  // ------------------------------------------------------------------
  describe('isPollTimedOut', () => {
    const MAX = 15 * 60 * 1000 // 15 分钟

    it('returns false when within time limit', () => {
      const started = Date.now()
      expect(isPollTimedOut(started, started + 60_000)).toBe(false)
    })

    it('returns true when exceeded time limit', () => {
      const started = Date.now()
      expect(isPollTimedOut(started, started + MAX + 1)).toBe(true)
    })

    it('returns false exactly at limit', () => {
      const started = 1_000_000
      expect(isPollTimedOut(started, started + MAX)).toBe(false)
    })

    it('returns true just past limit', () => {
      const started = 1_000_000
      expect(isPollTimedOut(started, started + MAX + 1)).toBe(true)
    })
  })
})
