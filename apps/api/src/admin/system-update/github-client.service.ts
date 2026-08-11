import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../../config/config.module.js';
import { compareVersions, normalizeVersion } from './semver.js';
import type { GitHubRelease } from './types.js';

/**
 * GitHub Releases 只读客户端。
 * - 单次请求超时由 UPDATE_CHECK_TIMEOUT_MS 控制（AbortController）。
 * - UPDATE_GITHUB_TOKEN 仅私有仓库限流用，写入请求头，绝不写入日志。
 */
@Injectable()
export class GitHubReleaseClient {
  constructor(@Inject(ENV) private readonly env: Env) {}

  private get repo(): string {
    return this.env.UPDATE_GITHUB_REPOSITORY;
  }

  /** 获取最新 stable release（过滤 draft/prerelease，取 SemVer 最高）。失败返回 null。 */
  async fetchLatestRelease(): Promise<GitHubRelease | null> {
    const releases = await this.fetchRecentReleases(20);
    return releases[0] ?? null;
  }

  /** 获取近期 stable release，按 SemVer 降序（已过滤 draft/prerelease）。 */
  async fetchRecentReleases(perPage = 15): Promise<GitHubRelease[]> {
    const url = `https://api.github.com/repos/${this.repo}/releases?per_page=${perPage}`;
    const json = await this.getText(url);
    if (!json) return [];

    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];

    const releases = parsed
      .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
      .filter((r) => !r.draft && !r.prerelease)
      .filter((r) => typeof r.tag_name === 'string' && /^v?\d+\.\d+\.\d+(\.\d+)?$/.test(r.tag_name))
      .map((r) => this.toRelease(r));

    releases.sort((a, b) => compareVersions(b.tag_name, a.tag_name));
    return releases;
  }

  private toRelease(r: Record<string, unknown>): GitHubRelease {
    const assets = Array.isArray(r.assets)
      ? r.assets
          .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
          .map((a) => ({
            name: String(a.name ?? ''),
            browser_download_url: String(a.browser_download_url ?? ''),
            size: Number(a.size ?? 0),
          }))
      : [];
    return {
      tag_name: normalizeVersion(String(r.tag_name)),
      name: String(r.name ?? ''),
      body: String(r.body ?? ''),
      published_at: String(r.published_at ?? ''),
      html_url: String(r.html_url ?? ''),
      draft: Boolean(r.draft),
      prerelease: Boolean(r.prerelease),
      assets,
    };
  }

  private async getText(url: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.env.UPDATE_CHECK_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'enova-video-system-update',
      };
      const token = this.env.UPDATE_GITHUB_TOKEN;
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch(url, { headers, signal: controller.signal });
      if (!res.ok) return '';
      return await res.text();
    } catch {
      return '';
    } finally {
      clearTimeout(timer);
    }
  }
}
