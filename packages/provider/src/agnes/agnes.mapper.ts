import type { ProviderImageResult, ProviderJobStatus, ProviderVideoSubmission } from '../ai-provider.interface.js';
import { ProviderError } from '../errors.js';
import { formatAgnesError } from './agnes.errors.js';
import type { AgnesImageResponse, AgnesVideoResponse } from './agnes.types.js';

/**
 * 把 Agnes 原始响应映射为平台归一化类型。
 * 业务/Worker 只依赖归一化类型，禁止看到 Agnes 的 status string / task_id。
 */

export function mapAgnesImageResponse(resp: AgnesImageResponse): ProviderImageResult {
  const item = resp.data?.[0];
  if (!item) {
    throw new ProviderError('Agnes image response missing data', { category: 'PROVIDER_BAD_REQUEST' });
  }
  if (!item.url && !item.b64_json) {
    throw new ProviderError('Agnes image response missing url/b64_json', { category: 'PROVIDER_BAD_REQUEST' });
  }
  return {
    sourceUrl: item.url,
    base64: item.b64_json,
    revisedPrompt: item.revised_prompt,
    providerMetadata: { durationMs: resp.duration_ms },
  };
}

/**
 * 提取视频提交后用于后续轮询的 provider_job_id。
 * 优先使用 video_id（Agnes 推荐的轮询标识）；回退到 task_id / id。
 */
export function extractProviderJobId(resp: AgnesVideoResponse): string {
  const id = resp.video_id || resp.task_id || resp.id;
  if (!id) {
    throw new ProviderError('Agnes video submit missing task_id/id', { category: 'PROVIDER_BAD_REQUEST' });
  }
  return id;
}

/** 把 Agnes 视频状态字符串映射为平台 ProviderJobStatus。 */
export function mapAgnesVideoStatus(resp: AgnesVideoResponse): ProviderJobStatus {
  const raw = resp.status ?? 'queued';
  switch (raw) {
    case 'completed': {
      // 优先从 metadata.url 读取最终视频地址；回退到旧字段 remixed_from_video_id。
      const url = resp.metadata?.url ?? resp.remixed_from_video_id;
      if (!url) {
        throw new ProviderError('Agnes video completed without result url', { category: 'PROVIDER_BAD_REQUEST' });
      }
      return {
        status: 'succeeded',
        sourceUrl: url,
        duration: resp.seconds ?? undefined,
        width: undefined,
        height: undefined,
        providerMetadata: { progress: resp.progress, size: resp.size, seconds: resp.seconds },
      };
    }
    case 'failed': {
      return { status: 'failed', errorMessage: formatAgnesError(resp.error) ?? 'Agnes video generation failed' };
    }
    case 'queued':
    case 'in_progress':
    case 'processing':
    default:
      return { status: 'processing', progress: resp.progress ?? 0 };
  }
}

/** 视频提交结果归一化（providerJobId + 初始状态）。 */
export function mapAgnesVideoSubmission(resp: AgnesVideoResponse): ProviderVideoSubmission {
  return {
    providerJobId: extractProviderJobId(resp),
    status: mapAgnesVideoStatus(resp),
  };
}