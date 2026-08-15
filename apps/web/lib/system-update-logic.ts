/**
 * 系统更新状态机纯函数逻辑。
 *
 * 从 AdminSystemUpdateView 中抽取，使轮询状态转移、版本号兜底判断、
 * 成功通知去重等核心逻辑可独立测试，无需渲染 React 组件。
 */

export type OperationAction = 'update' | 'rollback'
export type OperationStatus = 'running' | 'success' | 'failed'

export interface OperationLike {
  status: OperationStatus
  action?: OperationAction
  target?: string
  output?: string
}

export interface VersionInfo {
  current_version: string
  latest_version: string
}

/**
 * 根据操作 action 返回中文动词。
 * 回滚操作不应被标记为「更新」。
 */
export function getActionVerb(action: OperationAction | undefined): string {
  return action === 'rollback' ? '回滚' : '更新'
}

/**
 * 构造成功通知文案。
 */
export function buildSuccessMessage(action: OperationAction | undefined, versionLabel?: string): string {
  const verb = getActionVerb(action)
  const suffix = versionLabel
    ? `，当前版本已${verb === '回滚' ? '回退' : '更新'}至 v${versionLabel}`
    : ''
  return `${verb}成功${suffix}`
}

/**
 * 判断轮询收到的 operation 是否应终止轮询（success / failed）。
 */
export function shouldStopPolling(status: OperationStatus): boolean {
  return status !== 'running'
}

/**
 * 版本号兜底判断：当前版本是否已达到目标版本。
 *
 * 两种场景：
 * 1. targetVersion 已知 → 当前版本 === targetVersion
 * 2. targetVersion 未知 → 当前版本 !== prevVersion（版本号已变化）
 */
export function isVersionChanged(
  prevVersion: string,
  currentVersion: string,
  targetVersion?: string,
): boolean {
  if (targetVersion) {
    return currentVersion === targetVersion
  }
  return currentVersion !== prevVersion
}

/**
 * 轮询 running 状态计数器：达到阈值后应触发版本号检测。
 *
 * @param runningCount 当前已连续收到 running 的次数
 * @param threshold 阈值（默认 10，约 20s @2s interval）
 * @returns 是否应触发版本号检测
 */
export function shouldTriggerVersionCheck(runningCount: number, threshold = 10): boolean {
  return runningCount >= threshold
}

/**
 * 判断连续请求失败是否应触发兜底 resolve。
 *
 * @param consecutiveErrors 连续失败次数
 * @param threshold 阈值（默认 30，约 60s @2s interval）
 * @returns 是否应触发兜底
 */
export function shouldResolveStaleOnError(consecutiveErrors: number, threshold = 30): boolean {
  return consecutiveErrors > threshold
}

/**
 * 判断轮询是否超时。
 *
 * @param startedAt 开始时间戳
 * @param now 当前时间戳
 * @param maxPollMs 最大轮询时长（默认 15 分钟）
 */
export function isPollTimedOut(startedAt: number, now: number, maxPollMs = 15 * 60 * 1000): boolean {
  return now - startedAt > maxPollMs
}
