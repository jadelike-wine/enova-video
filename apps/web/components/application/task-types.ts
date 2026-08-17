/* eslint-disable @typescript-eslint/no-explicit-any */
export interface TaskItem {
  id: string | number
  _optimistic?: boolean
  [key: string]: any
}
