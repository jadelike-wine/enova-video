/**
 * 动态配置注册表（共享）：定义哪些配置项可管理员后台修改，被 API 与 Worker 共用。
 *
 * 每个条目：
 * - key：读写键，持久化到 settings 表。
 * - valueType：值的解析类型，用于后台表单与实时读取转换。
 * - group：分组，后台界面分类展示。
 * - label / description：后台展示文案。
 * - isSecret：敏感项（如密钥），落库时 AES-GCM 加密，后台返回脱敏。
 * - envKey + envDefault：环境变量兜底。settings 表未显式覆盖时，
 *   以 env 值为准（env 为空时用 envDefault）。管理员后台覆盖后立即生效。
 */

export type SettingValueType = 'string' | 'number' | 'boolean' | 'enum';

export type SettingGroup =
  | 'billing'
  | 'auth'
  | 'payment'
  | 'queue'
  | 'storage'
  | 'log'
  | 'general';

export interface SettingDef {
  key: string;
  valueType: SettingValueType;
  group: SettingGroup;
  label: string;
  description?: string;
  isSecret?: boolean;
  /** 可选值（enum 类型使用）。 */
  options?: string[];
  envKey?: string;
  envDefault?: string;
}

export const SETTINGS: SettingDef[] = [
  // ---- 计费 ----
  {
    key: 'billing.welcomeCredits',
    valueType: 'number',
    group: 'billing',
    label: '新用户注册赠送 Credits',
    description: '新用户注册时自动充入钱包的初始额度。',
    envKey: 'WELCOME_CREDITS',
    envDefault: '100',
  },
  // ---- 认证 ----
  {
    key: 'auth.initialAdminEmail',
    valueType: 'string',
    group: 'auth',
    label: '初始管理员邮箱',
    description: '首次注册即被授予管理员角色的邮箱。',
    envKey: 'INITIAL_ADMIN_EMAIL',
  },
  {
    key: 'auth.initialAdminPassword',
    valueType: 'string',
    group: 'auth',
    label: '初始管理员密码',
    description: '初始管理员密码（仅用于 seed，注册后无效）。',
    isSecret: true,
    envKey: 'INITIAL_ADMIN_PASSWORD',
  },
  {
    key: 'auth.turnstileEnabled',
    valueType: 'boolean',
    group: 'auth',
    label: '启用 Turnstile 验证码',
    description: '登录/注册是否启用 Cloudflare Turnstile 人机验证。',
    envKey: 'TURNSTILE_ENABLED',
    envDefault: 'false',
  },
  {
    key: 'auth.turnstileSiteKey',
    valueType: 'string',
    group: 'auth',
    label: 'Turnstile Site Key',
    description: 'Cloudflare Turnstile 站点密钥（前端公开，用于渲染校验组件）。',
    envKey: 'TURNSTILE_SITE_KEY',
  },
  {
    key: 'auth.turnstileSecretKey',
    valueType: 'string',
    group: 'auth',
    label: 'Turnstile Secret Key',
    description: 'Cloudflare Turnstile 服务端密钥（仅后端校验用，ATS-GCM 加密存储）。',
    isSecret: true,
    envKey: 'TURNSTILE_SECRET_KEY',
  },
  // ---- 支付 ----
  {
    key: 'payment.mode',
    valueType: 'enum',
    group: 'payment',
    label: '支付模式',
    description: 'sandbox=本地演示；alipay/wechat=真实渠道。',
    options: ['sandbox', 'alipay', 'wechat'],
    envKey: 'PAYMENT_MODE',
    envDefault: 'sandbox',
  },
  {
    key: 'payment.creditsPerCny',
    valueType: 'number',
    group: 'payment',
    label: '充值汇率（每 1 元兑换 Credits）',
    description: '1 元人民币可兑换的 credits 数（整数）。',
    envKey: 'PAYMENT_CREDITS_PER_CNY',
    envDefault: '100',
  },
  {
    key: 'payment.minRechargeCents',
    valueType: 'number',
    group: 'payment',
    label: '最小充值金额（分）',
    description: '单笔充值最小金额（人民币分）。',
    envKey: 'PAYMENT_MIN_RECHARGE_CENTS',
    envDefault: '100',
  },
  {
    key: 'payment.returnBaseUrl',
    valueType: 'string',
    group: 'payment',
    label: '支付完成跳转地址',
    description: '支付完成后页面跳转的基础地址（公网）。',
    envKey: 'PAYMENT_RETURN_BASE_URL',
    envDefault: 'http://localhost:3001',
  },
  {
    key: 'payment.notifyUrl',
    valueType: 'string',
    group: 'payment',
    label: '支付异步回调地址',
    description: '渠道异步通知回调地址（公网）。',
    envKey: 'PAYMENT_NOTIFY_URL',
    envDefault: 'http://localhost:3001/api/v1/payment/notify',
  },
  {
    key: 'payment.alipayAppId',
    valueType: 'string',
    group: 'payment',
    label: '支付宝 AppId',
    description: '真实渠道需商户账号。',
    isSecret: true,
    envKey: 'ALIPAY_APP_ID',
  },
  {
    key: 'payment.alipayPrivateKey',
    valueType: 'string',
    group: 'payment',
    label: '支付宝应用私钥',
    description: '敏感字段，AES-GCM 加密存储。',
    isSecret: true,
    envKey: 'ALIPAY_PRIVATE_KEY',
  },
  {
    key: 'payment.alipayPublicKey',
    valueType: 'string',
    group: 'payment',
    label: '支付宝公钥',
    description: '用于验签。',
    isSecret: true,
    envKey: 'ALIPAY_PUBLIC_KEY',
  },
  {
    key: 'payment.alipayGateway',
    valueType: 'string',
    group: 'payment',
    label: '支付宝网关',
    description: '渠道网关地址。',
    envKey: 'ALIPAY_GATEWAY',
    envDefault: 'https://openapi.alipay.com/gateway.do',
  },
  {
    key: 'payment.wechatAppId',
    valueType: 'string',
    group: 'payment',
    label: '微信支付 AppId',
    description: '真实渠道需商户账号。',
    isSecret: true,
    envKey: 'WECHAT_APP_ID',
  },
  {
    key: 'payment.wechatMchId',
    valueType: 'string',
    group: 'payment',
    label: '微信商户号',
    description: '',
    isSecret: true,
    envKey: 'WECHAT_MCH_ID',
  },
  {
    key: 'payment.wechatApiV3Key',
    valueType: 'string',
    group: 'payment',
    label: '微信 APIv3 密钥',
    description: '敏感字段，AES-GCM 加密存储。',
    isSecret: true,
    envKey: 'WECHAT_API_V3_KEY',
  },
  {
    key: 'payment.wechatSerialNo',
    valueType: 'string',
    group: 'payment',
    label: '微信商户证书序列号',
    description: '',
    isSecret: true,
    envKey: 'WECHAT_SERIAL_NO',
  },
  {
    key: 'payment.wechatPrivateKey',
    valueType: 'string',
    group: 'payment',
    label: '微信商户私钥',
    description: '敏感字段，AES-GCM 加密存储。',
    isSecret: true,
    envKey: 'WECHAT_PRIVATE_KEY',
  },
  // ---- 任务 / 视频策略 ----
  {
    key: 'queue.jobAttempts',
    valueType: 'number',
    group: 'queue',
    label: '生成任务最大尝试次数',
    description: 'transient 失败重试次数，耗尽后释放 credits。',
    envKey: 'BULLMQ_JOB_ATTEMPTS',
    envDefault: '5',
  },
  {
    key: 'queue.jobBackoffMs',
    valueType: 'number',
    group: 'queue',
    label: '重试指数退避基础延迟（毫秒）',
    description: 'transient 失败重试的指数退避基础延迟。',
    envKey: 'BULLMQ_JOB_BACKOFF_MS',
    envDefault: '5000',
  },
  {
    key: 'video.pollIntervalMs',
    valueType: 'number',
    group: 'queue',
    label: '视频轮询间隔（毫秒）',
    description: '视频任务延迟轮询间隔。',
    envKey: 'VIDEO_POLL_INTERVAL_MS',
    envDefault: '15000',
  },
  {
    key: 'video.maxPolls',
    valueType: 'number',
    group: 'queue',
    label: '视频最大轮询次数',
    description: '达到后判定超时并终止。',
    envKey: 'VIDEO_MAX_POLLS',
    envDefault: '240',
  },
  {
    key: 'video.maxWaitMs',
    valueType: 'number',
    group: 'queue',
    label: '视频任务墙钟超时（毫秒）',
    description: '视频任务从提交到完成的墙钟超时兜底。',
    envKey: 'VIDEO_MAX_WAIT_MS',
    envDefault: '1800000',
  },
  {
    key: 'credential.retryAttempts',
    valueType: 'number',
    group: 'queue',
    label: 'Credential 切换最大尝试次数',
    description: '一次 Worker attempt 内切换 credential 的次数。',
    envKey: 'CREDENTIAL_RETRY_ATTEMPTS',
    envDefault: '3',
  },
  {
    key: 'credential.leaseTtlMs',
    valueType: 'number',
    group: 'queue',
    label: 'Credential 并发租约 TTL（毫秒）',
    description: '防止 Worker 崩溃后槽位永久占用。',
    envKey: 'CREDENTIAL_LEASE_TTL_MS',
    envDefault: '120000',
  },
  {
    key: 'provider.httpTimeoutMs',
    valueType: 'number',
    group: 'queue',
    label: 'Provider HTTP 超时（毫秒）',
    description: '调用上游 Provider 的超时。',
    envKey: 'PROVIDER_HTTP_TIMEOUT_MS',
    envDefault: '120000',
  },
  // ---- 下载 / SSRF ----
  {
    key: 'storage.maxBytes',
    valueType: 'number',
    group: 'storage',
    label: '下载资源大小上限（字节）',
    description: '防恶意超大文件。',
    envKey: 'STORAGE_MAX_BYTES',
    envDefault: '536870912',
  },
  {
    key: 'storage.downloadTimeoutMs',
    valueType: 'number',
    group: 'storage',
    label: '下载上游资源超时（毫秒）',
    description: '',
    envKey: 'STORAGE_DOWNLOAD_TIMEOUT_MS',
    envDefault: '120000',
  },
  {
    key: 'storage.allowedContentTypes',
    valueType: 'string',
    group: 'storage',
    label: '允许下载的 Content-Type 前缀',
    description: '逗号分隔。',
    envKey: 'STORAGE_ALLOWED_CONTENT_TYPES',
    envDefault: 'image/,video/',
  },
  {
    key: 'ssrf.allowHttp',
    valueType: 'boolean',
    group: 'storage',
    label: '允许 http（非生产）',
    description: '非生产是否放行 http（本地 mock / 私有 S3）。',
    envKey: 'SSRF_ALLOW_HTTP',
    envDefault: 'false',
  },
  {
    key: 'ssrf.devAllowList',
    valueType: 'string',
    group: 'storage',
    label: '本地放行 host 白名单',
    description: '逗号分隔，生产忽略。',
    envKey: 'SSRF_DEV_ALLOW_LIST',
    envDefault: '',
  },
  {
    key: 'ssrf.resolveDns',
    valueType: 'boolean',
    group: 'storage',
    label: '启用 DNS 二次校验',
    description: 'SSRF guard 是否做 DNS 解析二次校验。',
    envKey: 'SSRF_RESOLVE_DNS',
    envDefault: 'true',
  },
  // ---- 日志 ----
  {
    key: 'log.level',
    valueType: 'enum',
    group: 'log',
    label: '日志级别',
    description: '',
    options: ['debug', 'info', 'warn', 'error'],
    envKey: 'LOG_LEVEL',
    envDefault: 'info',
  },
  {
    key: 'log.format',
    valueType: 'enum',
    group: 'log',
    label: '日志格式',
    description: '',
    options: ['text', 'json'],
    envKey: 'LOG_FORMAT',
    envDefault: 'text',
  },
  {
    key: 'log.prompts',
    valueType: 'boolean',
    group: 'log',
    label: '记录 Prompt 到日志',
    description: '是否把用户 prompt 写入日志。',
    envKey: 'LOG_PROMPTS',
    envDefault: 'false',
  },
];

export const SETTINGS_BY_KEY: ReadonlyMap<string, SettingDef> = new Map(
  SETTINGS.map((s) => [s.key, s]),
);

/** 未注册的 key：读取时认为无效，避免后台随意写入脏配置。 */
export function isRegisteredSetting(key: string): boolean {
  return SETTINGS_BY_KEY.has(key);
}