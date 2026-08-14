import { Inject, Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { ENV, type Env } from '../../config/config.module.js';
import { RedisStore } from './redis-store.service.js';
import type { OperationView } from './types.js';

/** 写入操作记录的输出上限，防止 Redis 膨胀。 */
const MAX_OUTPUT_CHARS = 64 * 1024;

/**
 * 后台更新/回滚执行器。
 *
 * API 容器通过挂载的 /var/run/docker.sock 触发一个 deploy-tool 容器，
 * 由 deploy-tool 在宿主机上执行 scripts/update.sh / scripts/rollback.sh。
 * 执行与 HTTP 请求生命周期解耦：spawn 后在后台运行，进度写入 Redis，
 * 前端可轮询 /operations/:id 获取实时日志。
 *
 * 部署约定：宿主机需把仓库目录挂载进 api 容器，且宿主机在同一绝对路径
 * （默认 /host/repo）可访问该仓库（例如 symlink），deploy-tool 才能挂载并执行。
 */
@Injectable()
export class DeployExecutor {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(RedisStore) private readonly store: RedisStore,
  ) {}

  /** 启动一条后台操作，返回后立即 resolve（不等待脚本完成）。onComplete 在脚本结束时调用（成功/失败均触发）。 */
  run(op: OperationView, scriptArgs: string[], onComplete?: () => void): void {
    const repo = this.env.UPDATE_REPO_MOUNT;
    const scriptsDir = this.env.UPDATE_SCRIPTS_SUBDIR;
    const script = scriptArgs[0] === 'rollback.sh' ? 'rollback.sh' : 'update.sh';
    const scriptRel = `${repo}/${scriptsDir}/${script}`;
    const args = scriptArgs.slice(1);

    const dockerArgs = [
      'run',
      '--rm',
      '-v', `${this.env.UPDATE_DOCKER_SOCKET}:/var/run/docker.sock`,
      '-v', `${repo}:${repo}`,
      '-e', `GITHUB_REPOSITORY=${this.env.UPDATE_GITHUB_REPOSITORY}`,
      '-e', 'AUTO_CONFIRM=1',
      // 健康检查依赖 FRONTEND_URL；未配置时由脚本默认。
      ...(this.env.NODE_ENV === 'production' ? ['-e', 'FRONTEND_URL=http://localhost:3000'] : []),
      this.env.UPDATE_DEPLOY_TOOL_IMAGE,
      '-lc',
      `cd ${repo} && bash ${scriptRel}${args.length ? ' ' + args.join(' ') : ''}`,
    ];

    // Token 只通过环境注入 deploy-tool，绝不进命令行参数。
    if (this.env.UPDATE_GITHUB_TOKEN) {
      dockerArgs.splice(
        dockerArgs.indexOf('-e'),
        0,
        '-e', 'GITHUB_TOKEN',
      );
    }

    let output = '';
    const flush = (final: boolean) => {
      void this.store
        .updateOperation({ ...op, output, ...(final ? { finished_at: new Date().toISOString() } : {}) })
        .catch(() => undefined);
    };

    const childEnv = { ...process.env };
    if (this.env.UPDATE_GITHUB_TOKEN) childEnv.GITHUB_TOKEN = this.env.UPDATE_GITHUB_TOKEN;
    let completed = false;
    const complete = () => {
      if (completed) return;
      completed = true;
      if (onComplete) {
        try {
          onComplete();
        } catch {
          // 释放锁失败不影响结果上报。
        }
      }
    };

    const child = spawn('docker', dockerArgs, {
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const append = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-MAX_OUTPUT_CHARS);
      // 每 500ms 节流落盘一次，避免高频写 Redis。
      if (!flushTimer) {
        flushTimer = setTimeout(() => {
          flushTimer = undefined;
          flush(false);
        }, 500);
      }
    };
    let flushTimer: NodeJS.Timeout | undefined;

    child.stdout.on('data', append);
    child.stderr.on('data', append);

    child.on('error', (err) => {
      output = (output + `\nexecutor_error: ${err.message}`).slice(-MAX_OUTPUT_CHARS);
      void this.store
        .updateOperation({ ...op, status: 'failed', output, exit_code: 127, finished_at: new Date().toISOString() })
        .catch(() => undefined);
      complete();
    });

    child.on('close', (code) => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = undefined;
      }
      const status: OperationView['status'] = code === 0 ? 'success' : 'failed';
      void this.store
        .updateOperation({
          ...op,
          status,
          output,
          exit_code: code ?? 1,
          finished_at: new Date().toISOString(),
        })
        .catch(() => undefined);
      complete();
    });
  }
}
