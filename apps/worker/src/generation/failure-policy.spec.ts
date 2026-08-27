import { describe, expect, it } from 'vitest'
import { shouldFinalizeFailedJob } from './failure-policy.js'

describe('shouldFinalizeFailedJob', () => {
  it('does not finalize a failed attempt that BullMQ scheduled for retry', () => {
    expect(shouldFinalizeFailedJob({ attemptsMade: 1, attempts: 5 })).toBe(false)
  })

  it('finalizes after the last configured attempt', () => {
    expect(shouldFinalizeFailedJob({ attemptsMade: 5, attempts: 5 })).toBe(true)
  })

  it('finalizes immediately when BullMQ has moved an unrecoverable job to failed', () => {
    expect(shouldFinalizeFailedJob({ attemptsMade: 1, attempts: 5, finishedOn: Date.now() })).toBe(true)
  })
})
