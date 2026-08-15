/**
 * System settings navigation and business ownership metadata.
 *
 * The registry group is an implementation detail. These definitions keep the
 * settings workbench organized by user-facing business concepts instead.
 */

export type SettingsTabKey =
  | 'general'
  | 'agreement'
  | 'features'
  | 'security'
  | 'users'
  | 'gateway'
  | 'payment'
  | 'email'
  | 'backup'

export interface SettingMetadata {
  key: string
  group: string
}

export interface SettingsTabDef {
  key: SettingsTabKey
  label: string
  description: string
  /** Registry groups represented by this tab. */
  groups: readonly string[]
  /** Keys that belong to this tab even when their registry group is shared. */
  onlyKeys?: readonly string[]
  /** Keys excluded from a group-based tab rule. */
  excludeKeys?: readonly string[]
}

export interface SettingsSectionDef {
  key: string
  title: string
  description?: string
  /** Explicit keys take precedence over group ownership. */
  keys?: readonly string[]
  /** Registry groups used only when no explicit key owner exists. */
  groups?: readonly string[]
  /** Keys that must never be claimed by this section's group fallback. */
  excludeKeys?: readonly string[]
}

export const AGREEMENT_KEYS = [
  'general.loginAgreementEnabled',
  'general.loginAgreementMode',
  'general.loginAgreementUpdatedAt',
  'general.loginAgreementDocuments',
] as const

export const AGREEMENT_DOCUMENTS_KEY = 'general.loginAgreementDocuments'

/** Settings moved from the registry's general/customization groups to Features. */
export const CUSTOMIZATION_KEYS: ReadonlySet<string> = new Set([
  'general.homeContent',
  'general.compactHomeEnabled',
  'general.hideCcsImportButton',
  'general.customMenuItems',
  'table.defaultPageSize',
  'table.pageSizeOptions',
])

export const SETTINGS_TABS: readonly SettingsTabDef[] = [
  {
    key: 'general',
    label: '通用设置',
    description: '站点名称、副标题、Logo、客服联系方式、文档链接等基础信息。',
    groups: ['general'],
    excludeKeys: [...AGREEMENT_KEYS, ...CUSTOMIZATION_KEYS],
  },
  {
    key: 'agreement',
    label: '登录条款',
    description: '控制登录和注册时是否要求用户阅读并同意服务条款、隐私政策及其他 Markdown 文档。',
    groups: ['general'],
    onlyKeys: AGREEMENT_KEYS,
  },
  {
    key: 'features',
    label: '功能开关',
    description: '首页内容、简洁首页、自定义菜单、表格分页、日志级别与敏感内容开关等功能性配置。',
    groups: ['customization', 'table', 'log'],
  },
  {
    key: 'security',
    label: '安全与认证',
    description: '登录注册的人机验证，以及限流、SSRF 防护等安全策略。',
    groups: ['auth', 'security'],
  },
  {
    key: 'users',
    label: '用户默认值',
    description: '新用户注册赠金等用户默认策略。',
    groups: ['billing'],
  },
  {
    key: 'gateway',
    label: '网关服务',
    description: '生成任务的并发、重试与轮询策略，以及对象存储与媒体下载安全策略。部分配置需要重启 Worker 进程后生效。',
    groups: ['queue', 'storage'],
  },
  {
    key: 'payment',
    label: '支付设置',
    description: '充值渠道、兑换汇率与商户凭证。接入真实渠道需要商户账号。',
    groups: ['payment'],
  },
  {
    key: 'email',
    label: '邮件设置',
    description: 'SMTP 发信服务与邮件链接地址。',
    groups: ['email'],
  },
  {
    key: 'backup',
    label: '数据备份',
    description: '数据库备份与灾难恢复相关配置。',
    groups: [],
  },
]

const AGREEMENT_KEY_SET: ReadonlySet<string> = new Set(AGREEMENT_KEYS)
const TAB_KEYS: ReadonlySet<string> = new Set(SETTINGS_TABS.map((tab) => tab.key))

/**
 * Sections for the General tab. Keep this order aligned with the visual
 * workbench: branding, table, endpoints, support/docs, homepage, menu.
 */
export const GENERAL_SECTIONS: readonly SettingsSectionDef[] = [
  {
    key: 'branding',
    title: '品牌与站点基础信息',
    description: '站点 URL、应用名称、站点名称、副标题和 Logo。',
    keys: [
      'general.siteUrl',
      'general.apiBaseUrl',
      'general.appName',
      'general.siteName',
      'general.siteSubtitle',
      'general.siteLogo',
    ],
    groups: ['general'],
    excludeKeys: [...AGREEMENT_KEYS],
  },
  {
    key: 'table',
    title: '通用表格设置',
    description: '统一控制后台与用户侧表格组件的默认分页行为。',
    keys: ['table.defaultPageSize', 'table.pageSizeOptions'],
    groups: ['table'],
  },
  {
    key: 'endpoints',
    title: '自定义端点',
    description: '管理 API/站点端点名称、URL、描述和排序。',
    keys: ['general.apiBaseUrl', 'general.customEndpoints'],
  },
  {
    key: 'support',
    title: '客服与文档',
    description: '配置客服邮箱、联系方式和帮助文档入口。',
    keys: ['general.supportEmail', 'general.contactInfo', 'general.docUrl'],
  },
  {
    key: 'homepage',
    title: '首页内容',
    description: '配置首页内容和首页展示开关。',
    keys: [
      'general.homeContent',
      'general.compactHomeEnabled',
      'general.hideCcsImportButton',
    ],
    groups: ['customization'],
  },
  {
    key: 'menu',
    title: '自定义菜单页面',
    description: '配置侧边栏菜单名称、URL、可见范围、启用状态和排序。',
    keys: ['general.customMenuItems'],
    groups: ['customization'],
  },
]

/** Tab icon names remain centralized so the view does not carry tab metadata. */
export const TAB_ICONS: Readonly<Record<SettingsTabKey, string>> = {
  general: '🏠',
  agreement: '📄',
  features: '⚡',
  security: '🛡️',
  users: '👤',
  gateway: '🖥️',
  payment: '💳',
  email: '✉️',
  backup: '🗄️',
}

export function isTabKey(value: string | null | undefined): value is SettingsTabKey {
  return typeof value === 'string' && TAB_KEYS.has(value)
}

/**
 * Resolve a setting's General section. An explicit key owner always wins over
 * every group fallback, which prevents general.* keys from swallowing the
 * customization/table sections.
 */
export function settingBelongsToSection(
  setting: SettingMetadata,
  section: SettingsSectionDef,
): boolean {
  const explicitOwner = GENERAL_SECTIONS.find((candidate) => candidate.keys?.includes(setting.key))
  if (explicitOwner) return explicitOwner.key === section.key
  if (section.excludeKeys?.includes(setting.key)) return false
  return section.groups?.includes(setting.group) ?? false
}

/** Return settings shown by a tab while preserving registry order. */
export function itemsForTab<T extends SettingMetadata>(
  tab: SettingsTabDef,
  settings: readonly T[],
): T[] {
  if (tab.key === 'general') {
    const coveredGroups = new Set(
      SETTINGS_TABS.filter((candidate) => candidate.key !== 'general').flatMap((candidate) => candidate.groups),
    )
    const generalItems = settings.filter((setting) => {
      if (setting.group !== 'general') return false
      if (AGREEMENT_KEY_SET.has(setting.key)) return false
      if (CUSTOMIZATION_KEYS.has(setting.key)) return false
      return true
    })
    const generalKeys = new Set(generalItems.map((setting) => setting.key))
    const uncovered = settings.filter((setting) => {
      if (generalKeys.has(setting.key)) return false
      if (AGREEMENT_KEY_SET.has(setting.key)) return false
      if (CUSTOMIZATION_KEYS.has(setting.key)) return false
      return !coveredGroups.has(setting.group)
    })
    return [...generalItems, ...uncovered]
  }

  return settings.filter((setting) => {
    if (!tab.groups.includes(setting.group)) return false
    if (tab.onlyKeys) return tab.onlyKeys.includes(setting.key)
    if (tab.excludeKeys?.includes(setting.key)) return false
    return true
  })
}
