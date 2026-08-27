export interface FailedAttemptState {
  attemptsMade: number
  attempts: number
  finishedOn?: number
}

/** BullMQ emits `failed` after every failed attempt, including attempts it will retry. */
export function shouldFinalizeFailedJob(state: FailedAttemptState): boolean {
  return state.finishedOn !== undefined || state.attemptsMade >= Math.max(1, state.attempts)
}
