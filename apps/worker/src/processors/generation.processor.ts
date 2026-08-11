import type { GenerationJobPayload } from '@enova/contracts';
import type { GenerationPipeline } from '../generation/pipeline.js';

/**
 * Generation 队列处理器（路由层）。
 *
 * 职责边界：按 payload.stage 分发给 GenerationPipeline。
 * - stage == 'poll'  → pipeline.poll（视频延迟轮询）
 * - 否则             → pipeline.execute（首次执行 / 图片直接生成）
 *
 * transient / permanent 的失败语义、credential 切换、幂等 finalize 全部封装在 Pipeline 内。
 * 本文件不再包含 GENERATION_PIPELINE_NOT_IMPLEMENTED 桩。
 */
export const PROCESS_GENERATION = 'PROCESS_GENERATION';

export async function processGenerationPayload(
  pipeline: GenerationPipeline,
  payload: GenerationJobPayload,
): Promise<void> {
  if (payload.stage === 'poll') {
    await pipeline.poll(payload);
  } else {
    await pipeline.execute(payload);
  }
}