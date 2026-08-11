import { describe, expect, it, vi } from 'vitest';
import { SystemUpdateService } from './system-update.service.js';
import type { GitHubReleaseClient } from './github-client.service.js';
import type { RedisStore } from './redis-store.service.js';
import type { DeployExecutor } from './deploy-executor.service.js';
import type { Env } from '../../config/config.module.js';

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    NODE_ENV: 'test',
    PORT: 3001,
    HOST: '0.0.0.0',
    APP_VERSION: '1.2.0',
    UPDATE_ENABLED: true,
    UPDATE_GITHUB_REPOSITORY: 'jadelike-wine/enova-video',
    UPDATE_GITHUB_TOKEN: '',
    UPDATE_CHECK_CACHE_TTL_MS: 20 * 60 * 1000,
    UPDATE_CHECK_TIMEOUT_MS: 8000,
    UPDATE_EXEC_TIMEOUT_MS: 15 * 60 * 1000,
    UPDATE_DEPLOY_TOOL_IMAGE: 'docker:cli-git',
    UPDATE_REPO_MOUNT: '/host/repo',
    UPDATE_SCRIPTS_SUBDIR: 'scripts',
    UPDATE_MAX_ROLLBACK_VERSIONS: 3,
    ...overrides,
  } as Env;
}

function makeStore(overrides: Partial<RedisStore> = {}): RedisStore {
  return {
    getCache: vi.fn(async () => null),
    setCache: vi.fn(async () => undefined),
    acquireLock: vi.fn(async () => true),
    releaseLock: vi.fn(async () => undefined),
    createOperation: vi.fn(async () => undefined),
    updateOperation: vi.fn(async () => undefined),
    getOperation: vi.fn(async () => null),
    ...overrides,
  } as unknown as RedisStore;
}

function makeGithub(overrides: Partial<GitHubReleaseClient> = {}): GitHubReleaseClient {
  return {
    fetchLatestRelease: vi.fn(async () => null),
    fetchRecentReleases: vi.fn(async () => []),
    ...overrides,
  } as unknown as GitHubReleaseClient;
}

function makeExecutor() {
  let run: any;
  return {
    executor: {
      run: vi.fn((op: unknown, args: string[], onComplete?: () => void) => {
        run = { op, args, onComplete };
      }),
    } as unknown as DeployExecutor,
    getRun: () => run,
  };
}

describe('SystemUpdateService', () => {
  describe('checkStatus', () => {
    it('returns disabled view when UPDATE_ENABLED=false', async () => {
      const svc = new SystemUpdateService(makeEnv({ UPDATE_ENABLED: false }), makeGithub(), makeStore(), makeExecutor().executor);
      const info = await svc.checkStatus();
      expect(info.enabled).toBe(false);
      expect(info.has_update).toBe(false);
    });

    it('uses cache when present and not forced', async () => {
      const cache = JSON.stringify({ latest: '1.3.0', release_info: { name: 'r' }, timestamp: Date.now() });
      const store = makeStore({ getCache: vi.fn(async () => cache) });
      const svc = new SystemUpdateService(makeEnv(), makeGithub(), store, makeExecutor().executor);
      const info = await svc.checkStatus();
      expect(info.cached).toBe(true);
      expect(info.latest_version).toBe('1.3.0');
      expect(info.has_update).toBe(true);
    });

    it('fallbacks to cache on github failure with warning', async () => {
      const cache = JSON.stringify({ latest: '1.3.0', release_info: { name: 'r' }, timestamp: Date.now() });
      const store = makeStore({ getCache: vi.fn(async () => cache) });
      const svc = new SystemUpdateService(makeEnv(), makeGithub({ fetchLatestRelease: vi.fn(async () => null) }), store, makeExecutor().executor);
      const info = await svc.checkStatus(true);
      expect(info.cached).toBe(true);
      expect(info.warning).toContain('cached');
    });

    it('reports has_update when latest is newer', async () => {
      const github = makeGithub({
        fetchLatestRelease: vi.fn(async () => ({
          tag_name: '1.3.0',
          name: 'v1.3.0',
          body: '',
          published_at: '',
          html_url: '',
          draft: false,
          prerelease: false,
          assets: [],
        })),
      });
      const svc = new SystemUpdateService(makeEnv(), github, makeStore(), makeExecutor().executor);
      const info = await svc.checkStatus(true);
      expect(info.latest_version).toBe('1.3.0');
      expect(info.has_update).toBe(true);
    });
  });

  describe('startUpdate / startRollback', () => {
    it('rejects invalid version', async () => {
      const svc = new SystemUpdateService(makeEnv(), makeGithub(), makeStore(), makeExecutor().executor);
      await expect(svc.startUpdate('op1', 'not-a-version')).rejects.toThrowError(/Invalid version/);
    });

    it('throws UPDATE_IN_PROGRESS when lock is busy', async () => {
      const store = makeStore({ acquireLock: vi.fn(async () => false) });
      const svc = new SystemUpdateService(makeEnv(), makeGithub(), store, makeExecutor().executor);
      await expect(svc.startUpdate('op1')).rejects.toThrowError(/in progress/);
    });

    it('runs update.sh with target version when provided', async () => {
      const { executor, getRun } = makeExecutor();
      const svc = new SystemUpdateService(makeEnv(), makeGithub(), makeStore(), executor);
      await svc.startUpdate('op1', '1.3.0');
      const run = getRun();
      expect(run.op.action).toBe('update');
      expect(run.args).toEqual(['update.sh', '1.3.0']);
      expect(typeof run.onComplete).toBe('function');
    });

    it('runs update.sh without args for latest', async () => {
      const { executor, getRun } = makeExecutor();
      const svc = new SystemUpdateService(makeEnv(), makeGithub(), makeStore(), executor);
      await svc.startUpdate('op2');
      expect(getRun().args).toEqual(['update.sh']);
    });

    it('rollback to previous runs rollback.sh --code-only', async () => {
      const { executor, getRun } = makeExecutor();
      const svc = new SystemUpdateService(makeEnv(), makeGithub(), makeStore(), executor);
      await svc.startRollback('op3');
      expect(getRun().args).toEqual(['rollback.sh', '--code-only']);
    });

    it('rollback to a specific version runs update.sh (downgrade)', async () => {
      const { executor, getRun } = makeExecutor();
      const svc = new SystemUpdateService(makeEnv(), makeGithub(), makeStore(), executor);
      await svc.startRollback('op4', '1.1.0');
      expect(getRun().args).toEqual(['update.sh', '1.1.0']);
    });
  });

  describe('listRollbackVersions', () => {
    it('returns only versions strictly older than current, newest first', async () => {
      const github = makeGithub({
        fetchRecentReleases: vi.fn(async () => [
          { tag_name: '1.3.0', name: '', body: '', published_at: 'a', html_url: 'u', draft: false, prerelease: false, assets: [] },
          { tag_name: '1.1.0', name: '', body: '', published_at: 'b', html_url: 'v', draft: false, prerelease: false, assets: [] },
          { tag_name: '1.2.0', name: '', body: '', published_at: 'c', html_url: 'w', draft: false, prerelease: false, assets: [] },
        ]),
      });
      const svc = new SystemUpdateService(makeEnv(), github, makeStore(), makeExecutor().executor);
      const versions = await svc.listRollbackVersions();
      expect(versions.map((v) => v.version)).toEqual(['1.1.0']);
    });
  });
});