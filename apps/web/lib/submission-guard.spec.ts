import { describe, expect, it } from 'vitest'
import { createSubmissionGuard } from './submission-guard'

describe('createSubmissionGuard', () => {
  it('allows only one submission until the active submission finishes', () => {
    const guard = createSubmissionGuard()

    expect(guard.begin()).toBe(true)
    expect(guard.begin()).toBe(false)

    guard.end()
    expect(guard.begin()).toBe(true)
  })
})
