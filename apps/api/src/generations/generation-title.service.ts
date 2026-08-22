import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { generationJobs, type Database } from '@enova/db';
import { validateFetchableUrl, type UrlGuardOptions } from '@enova/provider';
import { DATABASE } from '../database/database.module.js';
import { ENV, type Env } from '../config/config.module.js';
import { SettingsService } from '../settings/settings.service.js';

const FALLBACK_TITLE = '未命名对话';
const MAX_TITLE_LENGTH = 60;

type CompletionResponse = { choices?: Array<{ message?: { content?: unknown } }> };

/**
 * 独立于主生成流水线的标题生成器。
 *
 * 失败只保留默认标题，绝不影响 generation job、队列或 Credits。由于 Base URL 是
 * 管理员可修改的出站地址，每次请求前都重新执行 SSRF 校验，且禁止跟随重定向。
 */
@Injectable()
export class GenerationTitleService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async generateFor(jobId: string, prompt: string): Promise<void> {
    const enabled = await this.settings.getBoolean('ai.titleGenerationEnabled');
    const apiKey = (await this.settings.getSecret('ai.titleGenerationApiKey'))?.trim();
    const baseUrl = (await this.settings.getString('ai.titleGenerationBaseUrl'))?.trim();
    const model = (await this.settings.getString('ai.titleGenerationModel'))?.trim();
    if (!enabled || !apiKey || !baseUrl || !model || !prompt.trim()) {
      await this.mark(jobId, 'SKIPPED');
      return;
    }

    try {
      await validateFetchableUrl(baseUrl, await this.guardOptions());
      const chinese = /[\u3400-\u9fff]/.test(prompt);
      const template = (await this.settings.getString(chinese ? 'ai.titleGenerationPromptZh' : 'ai.titleGenerationPromptEn'))?.trim() ?? '';
      const usesPlaceholder = template.includes('{{prompt}}');
      const system = usesPlaceholder ? template.replaceAll('{{prompt}}', prompt) : template;
      const body = {
        model,
        temperature: 0.2,
        max_tokens: 64,
        messages: [
          ...(system ? [{ role: 'system', content: system }] : []),
          ...(!usesPlaceholder ? [{ role: 'user', content: prompt }] : []),
        ],
      };
      const response = await fetch(this.completionsUrl(baseUrl), {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8_000),
        redirect: 'manual',
      });
      if (!response.ok) throw new Error(`title completion failed: ${response.status}`);
      const payload = await response.json() as CompletionResponse;
      const title = this.normalizeTitle(payload.choices?.[0]?.message?.content);
      if (!title) throw new Error('title completion returned no title');
      await this.db.update(generationJobs).set({ title, titleGenerationStatus: 'SUCCEEDED' }).where(and(eq(generationJobs.id, jobId), eq(generationJobs.titleGenerationStatus, 'PENDING')));
    } catch {
      // 不记录 prompt、API Key 或上游响应；标题失败对用户是可恢复的默认态。
      await this.mark(jobId, 'FAILED');
    }
  }

  private completionsUrl(baseUrl: string): string {
    const normalized = baseUrl.replace(/\/+$/, '');
    return `${normalized}${normalized.endsWith('/v1') ? '' : '/v1'}/chat/completions`;
  }

  private normalizeTitle(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const title = value.replace(/[\r\n]+/g, ' ').replace(/^['"“”]+|['"“”]+$/g, '').trim();
    if (!title) return null;
    return title.slice(0, MAX_TITLE_LENGTH).trimEnd() || null;
  }

  private async mark(jobId: string, status: 'FAILED' | 'SKIPPED'): Promise<void> {
    await this.db.update(generationJobs).set({ title: FALLBACK_TITLE, titleGenerationStatus: status }).where(and(eq(generationJobs.id, jobId), eq(generationJobs.titleGenerationStatus, 'PENDING')));
  }

  private async guardOptions(): Promise<UrlGuardOptions> {
    const allowHttp = (await this.settings.getBoolean('ssrf.allowHttp')) ?? this.env.SSRF_ALLOW_HTTP;
    const resolveDns = (await this.settings.getBoolean('ssrf.resolveDns')) ?? this.env.SSRF_RESOLVE_DNS;
    const rawAllowlist = (await this.settings.getString('ssrf.devAllowList')) ?? this.env.SSRF_DEV_ALLOW_LIST;
    return { allowHttp, resolveDns, devAllowlist: this.env.NODE_ENV === 'production' ? [] : rawAllowlist.split(',').map((host: string) => host.trim()).filter(Boolean) };
  }
}
