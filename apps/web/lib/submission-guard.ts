export interface SubmissionGuard {
  begin(): boolean
  end(): void
}

export function createSubmissionGuard(): SubmissionGuard {
  let active = false

  return {
    begin() {
      if (active) return false
      active = true
      return true
    },
    end() {
      active = false
    },
  }
}
