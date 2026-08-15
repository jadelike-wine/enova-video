import { z } from 'zod';

/**
 * 共享环境变量 Schema（Node 侧：api / worker）。
 *
 * 架构原则：
 *   .env = 系统如何启动（bootstrap / infrastructure / root secret）
 *   System Settings = 系统启动之后如何运行（管理员后台动态配置，存数据库）
 *
 * 本 Schema 包含两类配置：
 * 1. Bootstrap 配置：启动/基础设施/根密钥，必须在进程启动前确定，不可动态修改。
 * 2. Legacy fallback 配置：已迁移到 System Settings 的业务配置。
 *    首次启动时 SettingsStore.migrateFromEnv() 会将它们幂等迁移到 DB。
 *    迁移后这些 env 值仅作为 fallback（DB 值 > legacy env > schema default）。
 *    新部署无需设置这些变量；管理员后台修改后 DB 值优先。
 */

const envBool = (def = false) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? def : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

export const envSchema = z.object({
  // ============================================================
  // Bootstrap 配置（必须在进程启动前确定）
  // ============================================================

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

  // 安全
  /** AES-GCM 用的 32 字节 Master Key，hex 或 base64。生产必须从 KMS/Secret 注入。
   *  严禁存入数据库或管理员后台——数据库中的 Secret 由它加密。 */
  CREDENTIAL_MASTER_KEY: z
    .string()
    .default('dev-master-key-not-for-production')
    .describe('32-byte master key for AES-GCM provider secret encryption (hex/base64)'),
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

  // ---- P0: 邮件 (SMTP) ----
  /** SMTP 服务器主机。生产环境必填（否则邮件功能不可用）。 */
  SMTP_HOST: z.string().optional().default(''),
  /** SMTP 服务器端口。 */
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  /** 是否使用 TLS 直连（465=true, 587=false 用 STARTTLS）。 */
  SMTP_SECURE: envBool(false),
  /** SMTP 认证用户名。 */
  SMTP_USER: z.string().optional().default(''),
  /** SMTP 认证密码（从 Secret 注入，严禁写入日志）。 */
  SMTP_PASSWORD: z.string().optional().default(''),
  /** 发件人显示名称。 */
  SMTP_FROM_NAME: z.string().default('EnovaMotion'),
  /** 发件人邮箱地址。 */
  SMTP_FROM_EMAIL: z.string().optional().default(''),

  // ---- P0: 前端 URL（邮件链接/CORS）----
  /** 密码重置页面 URL（前端）。 */
  APP_PASSWORD_RESET_URL: z.string().default('http://localhost:3000/zh-CN/auth/reset-password'),
  /** 邮箱验证页面 URL（前端）。 */
  APP_EMAIL_VERIFY_URL: z.string().default('http://localhost:3000/zh-CN/auth/verify-email'),
  /** 站点名称（邮件品牌/显示）。 */
  SITE_NAME: z.string().default('EnovaMotion'),
  /** 站点对外访问的完整 URL（CORS 允许列表 + cookie secure 判断）。 */
  APP_SITE_URL: z.string().default('http://localhost:3000'),

  // ---- P0: 客服邮箱 ----
  /** 客服邮箱（用户退款/订单问题联系）。生产环境必填。 */
  SUPPORT_EMAIL: z.string().optional().default('support@example.com'),

  // ---- P0: CORS / 安全 ----
  /** CORS 允许的源列表（逗号分隔）。生产必填。 */
  CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),
  /** Swagger 文档是否启用（生产默认 false）。 */
  SWAGGER_ENABLED: envBool(false),

  // ---- P0: 限流 ----
  /** 限流是否启用（默认 true）。关闭仅用于测试。 */
  RATE_LIMIT_ENABLED: envBool(true),
  /** 限流 Redis key 前缀。 */
  RATE_LIMIT_PREFIX: z.string().default('enova:rl'),

  // ============================================================
  // Legacy fallback 配置（已迁移到 System Settings）
  // 首次启动自动迁移到 DB；之后仅作为 fallback。
  // 新部署无需设置以下变量。
  // ============================================================

  // Worker 并发（BullMQ 构造时固定，restartRequired）
  BULLMQ_CONCURRENCY: z.coerce.number().int().positive().default(3),
  /** 生成任务最大尝试次数（transient 失败重试，耗尽后 failed handler release）。 */
  BULLMQ_JOB_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  /** 指数退避基础延迟（毫秒）。 */
  BULLMQ_JOB_BACKOFF_MS: z.coerce.number().int().positive().default(5_000),

  // 日志（运行时设置，进程启动时仅作为 legacy fallback）
  LOG_LEVEL: z.preprocess(
    (value) => {
      const normalized = String(value ?? '').trim().toUpperCase();
      const aliases: Record<string, string> = {
        DEBUG: 'debug',
        INFO: 'info',
        WARNING: 'warn',
        WARN: 'warn',
        ERROR: 'error',
        CRITICAL: 'fatal',
        FATAL: 'fatal',
      };
      return aliases[normalized] ?? value;
    },
    z.enum(['debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  ),
  LOG_FORMAT: z.enum(['text', 'json']).default('text'),
  LOG_PROMPTS: envBool(false),
  ACCESS_LOG: envBool(true),

  // 对象存储（默认 AWS S3；详细配置由 System Settings 管理）
  STORAGE_PROVIDER: z.enum(['aws_s3', 'qiniu', 'none']).default('aws_s3'),
  AWS_REGION: z.string().optional().default('ap-southeast-1'),
  AWS_S3_BUCKET: z.string().optional().default(''),
  AWS_S3_PREFIX: z.string().optional().default('agnes-ai'),
  AWS_S3_PUBLIC_BASE_URL: z.string().optional().default(''),
  AWS_S3_ENDPOINT_URL: z.string().optional().default(''),
  AWS_ACCESS_KEY_ID: z.string().optional().default(''),
  AWS_SECRET_ACCESS_KEY: z.string().optional().default(''),
  AWS_SESSION_TOKEN: z.string().optional().default(''),
  QINIU_ACCESS_KEY: z.string().optional().default(''),
  QINIU_SECRET_KEY: z.string().optional().default(''),
  QINIU_BUCKET: z.string().optional().default(''),
  QINIU_DOMAIN: z.string().optional().default(''),
  QINIU_REGION: z.string().optional().default('z0'),

  // ---- Provider 流水线 ----
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
  LOGIN_AGREEMENT_ENABLED: envBool(false),
  LOGIN_AGREEMENT_MODE: z.enum(['modal', 'checkbox']).default('modal'),
  LOGIN_AGREEMENT_UPDATED_AT: z.string().default(''),
  LOGIN_AGREEMENT_DOCUMENTS: z.string().default(
    '[{"slug":"terms","title":"服务条款","contentMd":"# 服务条款\\n\\n请在此编辑服务条款内容。"},{"slug":"usage-policy","title":"使用政策","contentMd":"# 使用政策\\n\\n请在此编辑使用政策内容。"},{"slug":"supported-regions","title":"支持的国家和地区","contentMd":"# 支持的国家和地区\\n\\n请在此编辑支持的国家和地区内容。"},{"slug":"service-specific-terms","title":"服务特定条款","contentMd":"# 服务特定条款\\n\\n请在此编辑服务特定条款内容。"}]',
  ),

  // ---- 支付 ----
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
});

export type Env = z.infer<typeof envSchema>;

const DEV_DEFAULTS = new Set(['dev-master-key-not-for-production']);

/** 服务类型：决定生产环境下执行哪些配置校验。 */
export type ServiceType = 'api' | 'worker';

/**
 * 将旧版本使用的 S3_* 配置转换为 canonical AWS_S3_* 配置。
 * 仅在 canonical 值缺失时生效，保证显式的新配置优先。
 */
function normalizeLegacyRuntimeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const normalized = { ...env };
  const aliases: Record<string, string> = {
    AWS_REGION: 'S3_REGION',
    AWS_S3_BUCKET: 'S3_BUCKET',
    AWS_S3_PREFIX: 'S3_PREFIX',
    AWS_S3_PUBLIC_BASE_URL: 'S3_PUBLIC_BASE_URL',
    AWS_S3_ENDPOINT_URL: 'S3_ENDPOINT_URL',
    AWS_ACCESS_KEY_ID: 'S3_ACCESS_KEY',
    AWS_SECRET_ACCESS_KEY: 'S3_SECRET_KEY',
  };
  for (const [canonical, legacy] of Object.entries(aliases)) {
    if (!normalized[canonical] && normalized[legacy]) normalized[canonical] = normalized[legacy];
  }
  if (normalized.STORAGE_PROVIDER?.toLowerCase() === 's3') {
    normalized.STORAGE_PROVIDER = 'aws_s3';
  }
  return normalized;
}

/**
 * 加载并校验环境变量。
 *
 * @param env - 环境变量对象（默认 process.env）
 * @param opts.service - 服务类型：'api' 校验全部生产配置；'worker' 只校验它实际需要的配置。
 *
 * 配置职责边界：
 *   - API 需要：支付、邮件、CORS、站点 URL、存储、凭证、数据库、Redis。
 *   - Worker 需要：凭证、存储、数据库、Redis、Provider 配置。不需要邮件/CORS/支付/SMTP。
 */
export function loadEnv(
  env: NodeJS.ProcessEnv = process.env,
  opts: { service?: ServiceType } = {},
): Env {
  const service = opts.service ?? 'api';
  const normalizedEnv = normalizeLegacyRuntimeEnv(env);
  const parsed = envSchema.safeParse(normalizedEnv);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const data = parsed.data;
  if (data.NODE_ENV === 'production') {
    // ---- 共享校验（API + Worker 都需要）----
    const leaked: string[] = [];
    if (DEV_DEFAULTS.has(data.CREDENTIAL_MASTER_KEY)) leaked.push('CREDENTIAL_MASTER_KEY');
    if (leaked.length > 0) {
      throw new Error(`Production requires real secrets, found dev defaults for: ${leaked.join(', ')}`);
    }
    // 对象存储已迁移到 System Settings。生产进程必须允许在数据库配置完成前启动，
    // 运行时由 SettingsService / WorkerSettings 校验并在未配置时降级为 none。
    // P0: 数据库和 Redis 不允许默认弱密码
    if (data.DATABASE_URL.includes('enova:enova@')) {
      throw new Error('Production must not use default database credentials (enova:enova).');
    }

    // ---- API 专属校验 ----
    if (service === 'api') {
      const hasEnvValue = (key: string): boolean => {
        const value = normalizedEnv[key];
        return value !== undefined && value.trim() !== '';
      };
      const paymentEnvConfigured = [
        'PAYMENT_MODE',
        'PAYMENT_RETURN_BASE_URL',
        'PAYMENT_NOTIFY_URL',
        'ALIPAY_APP_ID',
        'ALIPAY_PRIVATE_KEY',
        'ALIPAY_PUBLIC_KEY',
        'WECHAT_APP_ID',
        'WECHAT_MCH_ID',
        'WECHAT_API_V3_KEY',
        'WECHAT_SERIAL_NO',
        'WECHAT_PRIVATE_KEY',
      ].some(hasEnvValue);
      if (paymentEnvConfigured) {
        // 旧部署显式提供支付环境变量时继续执行原有启动校验；新部署由 DB 设置接管。
        if (data.PAYMENT_MODE === 'sandbox') {
          throw new Error('Production must not use PAYMENT_MODE=sandbox. Set PAYMENT_MODE=alipay or PAYMENT_MODE=wechat.');
        }
        if (data.PAYMENT_RETURN_BASE_URL.includes('localhost') || data.PAYMENT_NOTIFY_URL.includes('localhost')) {
          throw new Error('Production must not use localhost in PAYMENT_RETURN_BASE_URL or PAYMENT_NOTIFY_URL.');
        }
        if (!data.PAYMENT_RETURN_BASE_URL.startsWith('https://')) {
          throw new Error('Production requires PAYMENT_RETURN_BASE_URL to use HTTPS.');
        }
        if (!data.PAYMENT_NOTIFY_URL.startsWith('https://')) {
          throw new Error('Production requires PAYMENT_NOTIFY_URL to use HTTPS.');
        }
        if (data.PAYMENT_MODE === 'alipay') {
          if (!data.ALIPAY_APP_ID || !data.ALIPAY_PRIVATE_KEY || !data.ALIPAY_PUBLIC_KEY) {
            throw new Error('Production with PAYMENT_MODE=alipay requires ALIPAY_APP_ID, ALIPAY_PRIVATE_KEY, and ALIPAY_PUBLIC_KEY.');
          }
        }
        if (data.PAYMENT_MODE === 'wechat') {
          if (!data.WECHAT_APP_ID || !data.WECHAT_MCH_ID || !data.WECHAT_API_V3_KEY || !data.WECHAT_PRIVATE_KEY) {
            throw new Error('Production with PAYMENT_MODE=wechat requires WECHAT_APP_ID, WECHAT_MCH_ID, WECHAT_API_V3_KEY, and WECHAT_PRIVATE_KEY.');
          }
        }
      }
      const smtpEnvConfigured = [
        'SMTP_HOST',
        'SMTP_USER',
        'SMTP_PASSWORD',
        'SMTP_FROM_EMAIL',
        'APP_PASSWORD_RESET_URL',
        'APP_EMAIL_VERIFY_URL',
      ].some(hasEnvValue);
      if (smtpEnvConfigured) {
        // 旧部署显式提供 SMTP 时保留兼容校验；新部署可先启动，再由后台配置邮件。
        if (!data.SMTP_HOST || !data.SMTP_USER || !data.SMTP_PASSWORD || !data.SMTP_FROM_EMAIL) {
          throw new Error('Production requires SMTP_HOST, SMTP_USER, SMTP_PASSWORD, and SMTP_FROM_EMAIL for email delivery.');
        }
        if (!data.APP_PASSWORD_RESET_URL.startsWith('https://')) {
          throw new Error('Production requires APP_PASSWORD_RESET_URL to use HTTPS.');
        }
        if (!data.APP_EMAIL_VERIFY_URL.startsWith('https://')) {
          throw new Error('Production requires APP_EMAIL_VERIFY_URL to use HTTPS.');
        }
      }
      // P0: CORS 必须配置非空合法来源
      if (!data.CORS_ALLOWED_ORIGINS || !data.CORS_ALLOWED_ORIGINS.includes('://')) {
        throw new Error('Production requires CORS_ALLOWED_ORIGINS with valid origin(s) (e.g. https://app.example.com).');
      }
      // P0: 站点 URL 必须使用 HTTPS
      if (hasEnvValue('APP_SITE_URL') && !data.APP_SITE_URL.startsWith('https://')) {
        throw new Error('Production requires APP_SITE_URL to use HTTPS.');
      }
      // P0: CORS 必须使用 HTTPS origin
      if (!data.CORS_ALLOWED_ORIGINS.includes('https://')) {
        throw new Error('Production requires CORS_ALLOWED_ORIGINS to use HTTPS origin(s).');
      }
      // 旧部署显式提供客服邮箱时保留校验；新部署可由 System Settings 配置。
      if (hasEnvValue('SUPPORT_EMAIL') && (!data.SUPPORT_EMAIL || data.SUPPORT_EMAIL === 'support@example.com')) {
        throw new Error('Production requires SUPPORT_EMAIL to be set to a real support email address.');
      }
      // P0: Redis 必须有认证（不允许无密码连接）
      if (data.REDIS_URL.includes('@') === false || data.REDIS_URL.match(/:\w+@/) === null) {
        throw new Error('Production requires Redis URL with authentication (password). Example: redis://:password@host:6379');
      }
      // P0: Turnstile 应在生产环境启用（如果未启用，需明确记录原因）
      if (!data.TURNSTILE_ENABLED) {
        // 不强制报错，但记录警告——某些内网部署可能不需要
        // 管理员需在文档中明确记录为什么关闭
      }
    }
  }
  return data;
}
