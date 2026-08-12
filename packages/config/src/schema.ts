import { z } from 'zod';

/**
 * 共享环境变量 Schema（Node 侧：api / worker）。
 * 所有服务统一从这里加载，避免散落的 process.env。
 */

const envBool = (def = false) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? def : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // API
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default('0.0.0.0'),

  // 版本（Docker build 时注入，system-update 展示当前版本）
  APP_VERSION: z.string().default('0.0.0-development'),

  // 数据库
  DATABASE_URL: z
    .string()
    .default('postgresql://enova:enova@localhost:5432/enova'),

  // Redis / Queue
  REDIS_URL: z.string().default('redis://localhost:6379'),
  BULLMQ_PREFIX: z.string().default('enova'),
  BULLMQ_CONCURRENCY: z.coerce.number().int().positive().default(3),
  /** 生成任务最大尝试次数（transient 失败重试，耗尽后 failed handler release）。 */
  BULLMQ_JOB_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  /** 指数退避基础延迟（毫秒）。 */
  BULLMQ_JOB_BACKOFF_MS: z.coerce.number().int().positive().default(5_000),

  // 安全
  /** AES-GCM 用的 32 字节 Master Key，hex 或 base64。生产必须从 KMS/Secret 注入。 */
  CREDENTIAL_MASTER_KEY: z
    .string()
    .default('dev-master-key-not-for-production')
    .describe('32-byte master key for AES-GCM provider secret encryption (hex/base64)'),
  SESSION_SECRET: z
    .string()
    .default('dev-session-secret-not-for-production')
    .describe('session signing secret'),

  // 日志
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  LOG_FORMAT: z.enum(['text', 'json']).default('text'),
  LOG_PROMPTS: envBool(false),

  // 对象存储（默认 none）
  STORAGE_PROVIDER: z.enum(['none', 's3', 'qiniu']).default('none'),
  S3_REGION: z.string().optional().default(''),
  S3_BUCKET: z.string().optional().default(''),
  S3_PREFIX: z.string().optional().default('agnes-ai'),
  S3_PUBLIC_BASE_URL: z.string().optional().default(''),
  S3_ENDPOINT_URL: z.string().optional().default(''),
  S3_ACCESS_KEY: z.string().optional().default(''),
  S3_SECRET_KEY: z.string().optional().default(''),
  QINIU_ACCESS_KEY: z.string().optional().default(''),
  QINIU_SECRET_KEY: z.string().optional().default(''),
  QINIU_BUCKET: z.string().optional().default(''),
  QINIU_DOMAIN: z.string().optional().default(''),

  // ---- Phase 4：Provider 流水线 ----
  /** 最大下载生成的资源字节数（防恶意超大文件）。 */
  STORAGE_MAX_BYTES: z.coerce.number().int().positive().default(512 * 1024 * 1024),
  /** 下载上游资源超时（毫秒）。 */
  STORAGE_DOWNLOAD_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  /** 允许从上游下载的 Content-Type 前缀白名单。 */
  STORAGE_ALLOWED_CONTENT_TYPES: z.string().default('image/,video/'),
  /** 非生产环境是否允许 SSRF guard 放行 http（本地 mock / 私有 S3）。 */
  SSRF_ALLOW_HTTP: envBool(false),
  /** 开发环境显式放行的 host 白名单（逗号分隔，生产忽略）。 */
  SSRF_DEV_ALLOW_LIST: z.string().default(''),
  /** 是否启用 DNS 解析二次校验（测试注入本地 host 时可关闭）。 */
  SSRF_RESOLVE_DNS: envBool(true),

  // Provider HTTP 调用
  PROVIDER_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),

  // Credential Manager
  /** 一次 Worker attempt 内切换 credential 的最大尝试次数（provider 级 retry）。 */
  CREDENTIAL_RETRY_ATTEMPTS: z.coerce.number().int().positive().default(3),
  /** credential 并发 lease 的 TTL（毫秒），防止 Worker 崩溃后槽位永久占用。 */
  CREDENTIAL_LEASE_TTL_MS: z.coerce.number().int().positive().default(120_000),

  // 视频延迟轮询
  VIDEO_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(15_000),
  /** 视频轮询最大次数，达到后判定超时并终止（防止永久轮询）。 */
  VIDEO_MAX_POLLS: z.coerce.number().int().positive().default(240),
  /** 视频任务从提交到完成的墙钟超时（毫秒），兜底约束。 */
  VIDEO_MAX_WAIT_MS: z.coerce.number().int().positive().default(30 * 60 * 1000),

  // 计费
  WELCOME_CREDITS: z.coerce.number().int().nonnegative().default(100),
  TURNSTILE_ENABLED: envBool(false),
  TURNSTILE_SITE_KEY: z.string().optional().default(''),
  TURNSTILE_SECRET_KEY: z.string().optional().default(''),

  // ---- Phase 7：支付 ----
  /** 支付模式：sandbox=本地演示（无需商户密钥）；alipay/wechat=真实渠道。 */
  PAYMENT_MODE: z.enum(['sandbox', 'alipay', 'wechat']).default('sandbox'),
  /** 汇率：1 元人民币可兑换的 credits 数（整数，driver 配置驱动）。 */
  PAYMENT_CREDITS_PER_CNY: z.coerce.number().int().positive().default(100),
  /** 充值单笔最小金额（分，人民币）。 */
  PAYMENT_MIN_RECHARGE_CENTS: z.coerce.number().int().positive().default(100),
  /** 支付完成后的页面跳转基础地址（公网，用于 returnUrl）。 */
  PAYMENT_RETURN_BASE_URL: z.string().default('http://localhost:3001'),
  /** 异步通知回调地址（公网，渠道回调用）。 */
  PAYMENT_NOTIFY_URL: z.string().default('http://localhost:3001/api/v1/payment/notify'),
  // 支付宝（真实渠道需商户账号 + 密钥）
  ALIPAY_APP_ID: z.string().optional().default(''),
  ALIPAY_PRIVATE_KEY: z.string().optional().default(''),
  ALIPAY_PUBLIC_KEY: z.string().optional().default(''),
  ALIPAY_GATEWAY: z.string().optional().default('https://openapi.alipay.com/gateway.do'),
  // 微信支付（真实渠道需商户号 + APIv3 密钥）
  WECHAT_APP_ID: z.string().optional().default(''),
  WECHAT_MCH_ID: z.string().optional().default(''),
  WECHAT_API_V3_KEY: z.string().optional().default(''),
  WECHAT_SERIAL_NO: z.string().optional().default(''),
  WECHAT_PRIVATE_KEY: z.string().optional().default(''),

  // ---- System Update / Rollback（后台一键更新，参考 sub2api）----
  /** 是否启用后台更新/回滚能力。需在 docker-compose 挂载 /var/run/docker.sock 与仓库目录，默认关闭。 */
  UPDATE_ENABLED: envBool(false),
  /** 当前部署的 GitHub 仓库（owner/repo），用于检查与回滚版本列表。 */
  UPDATE_GITHUB_REPOSITORY: z
    .string()
    .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'must be an owner/repository name')
    .default('jadelike-wine/enova-video'),
  /** 私有仓库只读 token（可选），严禁写入日志。 */
  UPDATE_GITHUB_TOKEN: z.string().optional().default(''),
  /** 更新检查结果缓存 TTL（毫秒），默认 20 分钟。 */
  UPDATE_CHECK_CACHE_TTL_MS: z.coerce.number().int().positive().default(20 * 60 * 1000),
  /** 更新检查请求超时（毫秒）。 */
  UPDATE_CHECK_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),
  /** 执行更新/回滚的超时（毫秒），客户端断开后仍继续。 */
  UPDATE_EXEC_TIMEOUT_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  /** Docker daemon socket exposed to the API container for the deploy-tool runner. */
  UPDATE_DOCKER_SOCKET: z.string().default('/var/run/docker.sock'),
  /** 触发脚本的 deploy-tool 容器镜像（含 docker CLI + compose + bash + curl + python3）。 */
  UPDATE_DEPLOY_TOOL_IMAGE: z
    .string()
    .default('docker:cli-git'),
  /** 仓库在 api 容器内的挂载路径（与 docker-compose 卷映射一致）。 */
  UPDATE_REPO_MOUNT: z.string().default('/host/repo'),
  /** 仓库内 scripts 目录相对路径。 */
  UPDATE_SCRIPTS_SUBDIR: z.string().default('scripts'),
  /** 回滚版本列表最多暴露当前版本之前的 N 个稳定版本。 */
  UPDATE_MAX_ROLLBACK_VERSIONS: z.coerce.number().int().min(1).max(10).default(3),
});

export type Env = z.infer<typeof envSchema>;

const DEV_DEFAULTS = new Set(['dev-master-key-not-for-production', 'dev-session-secret-not-for-production']);

export function loadEnv(env: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const data = parsed.data;
  if (data.NODE_ENV === 'production') {
    const leaked: string[] = [];
    if (DEV_DEFAULTS.has(data.CREDENTIAL_MASTER_KEY)) leaked.push('CREDENTIAL_MASTER_KEY');
    if (DEV_DEFAULTS.has(data.SESSION_SECRET)) leaked.push('SESSION_SECRET');
    if (leaked.length > 0) {
      throw new Error(`Production requires real secrets, found dev defaults for: ${leaked.join(', ')}`);
    }
  }
  return data;
}
