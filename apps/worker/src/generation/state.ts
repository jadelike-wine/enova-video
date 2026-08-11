import { GENERATION_STATUSES, type GenerationStatus } from '@enova/contracts';

/**
 * GenerationJob 状态机约束。
 * 禁止散落几十处无约束的 update({ status })，所有迁移必须经过本 helper 校验。
 *
 * 合法迁移：
 *   PENDING            → QUEUED / CANCELED
 *   QUEUED             → RUNNING / CANCELED
 *   RUNNING            → SUCCEEDED / FAILED
 *   SUCCEEDED / FAILED / CANCELED  → （终态，不可再迁移）
 */
const ALLOWED: Record<GenerationStatus, readonly GenerationStatus[]> = {
  [GENERATION_STATUSES.PENDING]: [GENERATION_STATUSES.QUEUED, GENERATION_STATUSES.CANCELED],
  [GENERATION_STATUSES.QUEUED]: [GENERATION_STATUSES.RUNNING, GENERATION_STATUSES.CANCELED],
  [GENERATION_STATUSES.RUNNING]: [GENERATION_STATUSES.SUCCEEDED, GENERATION_STATUSES.FAILED],
  [GENERATION_STATUSES.SUCCEEDED]: [],
  [GENERATION_STATUSES.FAILED]: [],
  [GENERATION_STATUSES.CANCELED]: [],
};

export { GENERATION_STATUSES };

export function canTransit(from: GenerationStatus, to: GenerationStatus): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

export function assertTransition(from: GenerationStatus, to: GenerationStatus): void {
  if (!canTransit(from, to)) {
    throw new Error(`Invalid generation status transition: ${from} -> ${to}`);
  }
}

/** 是否终态（SUCCEEDED / FAILED / CANCELED）。 */
export function isTerminal(status: string): boolean {
  return (
    status === GENERATION_STATUSES.SUCCEEDED ||
    status === GENERATION_STATUSES.FAILED ||
    status === GENERATION_STATUSES.CANCELED
  );
}

/** 是否可进入 RUNNING（PENDING / QUEUED / 已 RUNNING 的重试）。 */
export function isRunnable(status: string): boolean {
  return (
    status === GENERATION_STATUSES.PENDING ||
    status === GENERATION_STATUSES.QUEUED ||
    status === GENERATION_STATUSES.RUNNING
  );
}