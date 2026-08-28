# i18n 完整性修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `/zh-CN` 与 `/en` 在现有 Web 功能中提供等价、locale-aware 的可见界面，并消除邮件模板能力的误导性说明。

**Architecture:** 保持 `next-intl` 的 URL 路由为唯一语言来源。静态 UI 文案迁入两份 message 文件；模型和格式化逻辑改为显式接收翻译/locale；前端通过稳定 API error code 映射本地化提示。邮件不新增按收件人选择语言的行为。

**Tech Stack:** Next.js 15、React 19、TypeScript、next-intl 4、Vitest、NestJS。

---

### Task 1: 建立可回归的 locale 基础工具与测试

**Files:**
- Create: `apps/web/lib/i18n-helpers.ts`
- Create: `apps/web/lib/i18n-helpers.spec.ts`
- Create: `apps/web/messages/messages.spec.ts`
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/zh-CN.json`

- [ ] **Step 1: 写入失败测试，要求两份 messages 的递归叶子键一致，且 helper 用传入 locale 格式化日期/数字。**

```ts
expect(leafKeys(en)).toEqual(leafKeys(zh))
expect(formatDateTime('2026-08-27T12:00:00.000Z', 'en')).not.toEqual(
  formatDateTime('2026-08-27T12:00:00.000Z', 'zh-CN')
)
```

- [ ] **Step 2: 运行失败测试。**

Run: `pnpm --filter @enova/web test -- i18n-helpers.spec.ts messages.spec.ts`

- [ ] **Step 3: 实现纯 locale formatter 与 message 对称性检查，并同时新增两种语言的键。**

```ts
export function formatDateTime(value: string | Date, locale: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}
```

- [ ] **Step 4: 重新运行测试并确认通过。**

Run: `pnpm --filter @enova/web test -- i18n-helpers.spec.ts messages.spec.ts`

### Task 2: 本地化模型、创作工作台、协议与首页降级页

**Files:**
- Modify: `apps/web/lib/models.ts`
- Modify: `apps/web/components/application/ImageView.tsx`
- Modify: `apps/web/components/application/VideoView.tsx`
- Modify: `apps/web/components/application/GenerationWorkspaceChrome.tsx`
- Modify: `apps/web/components/application/image-creator/{CreationTemplates,GenerationCanvas,ImageCard,ModelSelector,PromptComposer}.tsx`
- Modify: `apps/web/components/auth/LoginAgreementGate.tsx`
- Modify: `apps/web/components/marketing/HomeContentRenderer.tsx`
- Modify: `apps/web/app/[locale]/page.tsx`
- Modify: `apps/web/messages/{en,zh-CN}.json`
- Test: `apps/web/components/application/image-creator/ConversationPanel.spec.tsx`

- [ ] **Step 1: 为模型显示工厂和英文首页 metadata 写失败测试。**

```ts
expect(getImageModes(tEn).find((item) => item.id === 'text2img')?.name).toBe('Text to image')
expect(metadata.title.absolute).toContain('EnovaMotion')
```

- [ ] **Step 2: 运行测试，确认现有固定中文实现无法满足断言。**

Run: `pnpm --filter @enova/web test -- ConversationPanel.spec.tsx`

- [ ] **Step 3: 用翻译键替换各组件的可见文字与 aria label，并让模型显示数据由翻译函数生成；保留稳定 ID、尺寸和比例常量。**

```ts
const t = useTranslations('imageCreator')
const modes = useMemo(() => getImageModes(t), [t])
```

- [ ] **Step 4: 使用当前 locale 格式化创作时间；英文首页 metadata 依据 `locale` 选择品牌名。**

```ts
const locale = useLocale()
const createdAt = formatDateTime(task.created_at, locale)
```

- [ ] **Step 5: 运行 Web 创作组件相关测试。**

Run: `pnpm --filter @enova/web test -- ConversationPanel.spec.tsx`

### Task 3: 本地化管理后台和系统设置

**Files:**
- Modify: `apps/web/components/application/AdminSettingsView.tsx`
- Modify: `apps/web/components/application/admin-settings/*.tsx`
- Modify: `apps/web/components/application/admin-settings/settings-tabs.ts`
- Modify: `apps/web/components/application/admin/{AdminAuditView,AdminCustomer360View,AdminDashboardView,AdminGenerationDetailView,AdminGenerationsView,AdminOrderDetailView,AdminOrdersView,AdminPricingView,AdminProvidersView,AdminSystemUpdateView,AdminUi,AdminUsersView,CopyBox,EmailSettingsPanel}.tsx`
- Modify: `apps/web/lib/system-update-logic.ts`
- Modify: `apps/web/messages/{en,zh-CN}.json`
- Test: `apps/web/components/application/AdminSettingsView.spec.tsx`

- [ ] **Step 1: 扩展现有 AdminSettingsView 测试，断言英文 locale 返回英文 tab/状态/确认文案。**

```ts
expect(getSettingTabDefinitions(tEn)[0].label).toBe('General')
```

- [ ] **Step 2: 运行测试，确认静态中文 tab 定义不能满足断言。**

Run: `pnpm --filter @enova/web test -- AdminSettingsView.spec.tsx`

- [ ] **Step 3: 让 tab、group metadata、状态 label 和系统更新成功消息接收翻译函数；其余 admin 组件各自在 React 边界调用 `useTranslations('admin')`。**

```ts
export function getSettingTabDefinitions(t: TFunction) {
  return [{ key: 'general', label: t('settings.tabs.general') }]
}
```

- [ ] **Step 4: 将日期/金额格式化改为 locale 参数，移除 `toLocaleString('zh-CN')` 和隐式浏览器默认 locale。**

- [ ] **Step 5: 将邮件管理界面的语言 selector 命名为“邮件内容语言 / Email content language”，并显示不随访问 URL 自动选择的说明。**

- [ ] **Step 6: 重新运行 AdminSettingsView 测试。**

Run: `pnpm --filter @enova/web test -- AdminSettingsView.spec.tsx`

### Task 4: 将已知 API 错误码映射为本地文案

**Files:**
- Modify: `apps/web/lib/errorMessage.ts`
- Create: `apps/web/lib/errorMessage.spec.ts`
- Modify: `apps/web/components/application/useApiKeyGuard.ts`
- Modify: `apps/web/components/application/{ImageView,VideoView,WalletView,SettingsView}.tsx`
- Modify: `apps/web/components/application/admin/*.tsx`
- Modify: `apps/web/messages/{en,zh-CN}.json`

- [ ] **Step 1: 写失败测试：已知 `INSUFFICIENT_CREDITS` 在英文显示英语文案，未知 Provider text 原样回退。**

```ts
expect(localizeApiError({ error: { code: 'INSUFFICIENT_CREDITS', message: '余额不足' } }, tEn)).toBe('Insufficient credits')
expect(localizeApiError('provider unavailable', tEn)).toBe('provider unavailable')
```

- [ ] **Step 2: 运行失败测试。**

Run: `pnpm --filter @enova/web test -- errorMessage.spec.ts`

- [ ] **Step 3: 实现白名单 error-code helper，并在 alert/notification 调用处传入翻译函数。**

- [ ] **Step 4: 运行测试。**

Run: `pnpm --filter @enova/web test -- errorMessage.spec.ts`

### Task 5: 全量验证与硬编码回归扫描

**Files:**
- Modify: affected Web/API tests only when compilation reveals required fixture changes

- [ ] **Step 1: 运行格式和类型验证。**

Run: `pnpm --filter @enova/web lint && pnpm --filter @enova/web typecheck`

- [ ] **Step 2: 运行 Web 全量测试。**

Run: `pnpm --filter @enova/web test`

- [ ] **Step 3: 运行 API 受影响邮件测试。**

Run: `pnpm --filter @enova/api test -- runtime-email.sender.spec.ts`

- [ ] **Step 4: 扫描可见硬编码文案并人工复核剩余项。**

Run: `rg -n --glob '*.{ts,tsx}' --glob '!**/*.spec.*' '[\p{Han}]' apps/web`

- [ ] **Step 5: 检查 diff 与工作区状态。**

Run: `git diff --check && git status --short`

