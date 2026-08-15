# sub2api 风格系统设置实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 enova-video 中实现完整的 sub2api 风格系统设置工作台，复刻视觉和表单交互，同时保留 Enova 的动态配置、安全、审计和多实例生效机制。

**Architecture:** 继续使用 `packages/db` 的设置注册表和 `SettingsStore` 作为后端事实来源，使用 API 的 SettingView/batch 接口保存配置。前端将当前通用行渲染器扩展为业务化 section 面板和结构化编辑器；不复制 sub2api 的旧 Go/Vue/数据库模型。

**Tech Stack:** Next.js 15, React, TypeScript, Tailwind CSS, Ant Design, NestJS/Fastify, Drizzle/PostgreSQL, Redis, Vitest, pnpm.

---

## 文件结构与变更边界

### 将创建的前端文件

- `apps/web/components/application/admin-settings/settings-tabs.ts`：Tab、section、字段归属和视觉元数据。
- `apps/web/components/application/admin-settings/GeneralSettingsPanel.tsx`：通用设置业务布局。
- `apps/web/components/application/admin-settings/AgreementSettingsPanel.tsx`：登录条款专用面板。
- `apps/web/components/application/admin-settings/FeaturesSettingsPanel.tsx`：功能开关和表格偏好。
- `apps/web/components/application/admin-settings/SecuritySettingsPanel.tsx`：安全与认证布局。
- `apps/web/components/application/admin-settings/UserDefaultsSettingsPanel.tsx`：用户默认值布局。
- `apps/web/components/application/admin-settings/GatewaySettingsPanel.tsx`：队列、存储和生成策略布局。
- `apps/web/components/application/admin-settings/PaymentSettingsPanel.tsx`：支付配置布局。
- `apps/web/components/application/admin-settings/BackupSettingsPanel.tsx`：数据备份说明和操作入口。
- `apps/web/components/application/admin-settings/CustomMenuEditor.tsx`：菜单字段化编辑器。
- `apps/web/components/application/admin-settings/CustomEndpointEditor.tsx`：端点字段化编辑器。
- `apps/web/components/application/admin-settings/LogoUploader.tsx`：Logo 预览/上传/移除组件。

### 将修改的前端文件

- `apps/web/components/application/AdminSettingsView.tsx`：保留加载、draft、保存、历史和 Tab URL 状态，改为调用各业务面板。
- `apps/web/components/application/admin/EmailSettingsPanel.tsx`：调整为统一 sub2api 风格的卡片和批量保存布局。
- `apps/web/lib/api.ts`：补充结构化菜单、端点和图片上传相关类型；保持现有设置 API。
- `apps/web/messages/zh-CN.json`、`apps/web/messages/en.json`：补充 Tab、字段、校验、预留能力和操作文案。
- `apps/web/app/globals.css`：只补充必要的设置页布局类，不改动全局无关样式。

### 将修改的后端/共享文件

- `packages/db/src/settings-registry.ts`：补齐与 Enova 产品实际对应的设置项和校验元数据。
- `packages/db/src/settings-registry.spec.ts`：验证配置 key、类型、默认值、分组和边界。
- `apps/api/src/admin/settings.admin.service.ts`：补充复杂 JSON、URL、Logo 和自定义端点校验。
- `apps/api/src/admin/settings.admin.service.spec.ts`：补充保存/校验/生产安全测试。
- `apps/api/src/admin/settings.admin.controller.ts`：仅在 Logo 上传或结构化配置需要专项接口时增加端点。
- `apps/api/openapi.json`：API 变更后由生成流程更新，不手工编辑。
- `packages/sdk/*`：由 SDK 生成流程更新，不手工编辑。
- `packages/db/drizzle/*`：只有新增持久化字段或默认迁移时生成 Drizzle migration。

### 明确不修改

- sub2api 的任何源码、数据库或运行时。
- `apps/api`、`apps/worker` 的生成任务、Provider、计费核心逻辑，除非现有设置项接入需要极小范围适配。
- 现有工作区中与本任务无关的修改：`AppShell.tsx`、`globals.css`、`AdminSettingsView.tsx`、语言包等已有变化必须先区分并保留。

---

## Task 1: 建立设置页业务元数据和回归基线

**Files:**
- Create: `apps/web/components/application/admin-settings/settings-tabs.ts`
- Modify: `apps/web/components/application/AdminSettingsView.tsx`
- Test: `apps/web/components/application/admin-settings/settings-tabs.spec.ts`

- [ ] **Step 1: 写 Tab/section 元数据测试**

测试必须断言：Tab 顺序为 `general, agreement, features, security, users, gateway, payment, email, backup`；通用 section 按品牌、表格、端点、客服文档、首页、菜单顺序返回；每个已注册 group 至少有一个归属规则。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @enova/web test -- apps/web/components/application/admin-settings/settings-tabs.spec.ts`

Expected: FAIL，因为新的元数据模块尚不存在。

- [ ] **Step 3: 实现 `settings-tabs.ts`**

导出 `SettingsTabKey`、`SettingsSectionDef`、`SETTINGS_TABS`、`GENERAL_SECTIONS` 和 `settingBelongsToSection`。字段归属优先使用显式 key 集合，其次使用 group；不要让 `general.*` 自动覆盖 customization/table 分组。

- [ ] **Step 4: 让主页面使用元数据但保持现有行为**

将 `AdminSettingsView.tsx` 中 Tab 常量和 `itemsForTab` 的重复定义替换为新模块导入；保留现有 API 加载、draft、batch save、history、secret 和 storage test 逻辑。

- [ ] **Step 5: 运行回归测试**

Run: `pnpm --filter @enova/web test -- apps/web/components/application/admin-settings/settings-tabs.spec.ts`

Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/application/admin-settings/settings-tabs.ts apps/web/components/application/admin-settings/settings-tabs.spec.ts apps/web/components/application/AdminSettingsView.tsx
git commit -m "refactor(web): centralize system settings tab metadata"
```

## Task 2: 复刻设置工作台外层视觉

**Files:**
- Modify: `apps/web/components/application/AdminSettingsView.tsx`
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/messages/zh-CN.json`
- Modify: `apps/web/messages/en.json`
- Test: `apps/web/components/application/AdminSettingsView.spec.tsx`

- [ ] **Step 1: 增加外层视觉回归测试**

测试渲染管理员设置页，断言存在“系统设置”标题、九个 Tab、`role="tablist"`、激活 Tab、刷新/显示 key 控件和 Tab 级保存按钮。

- [ ] **Step 2: 运行测试确认失败或记录现有缺口**

Run: `pnpm --filter @enova/web test -- apps/web/components/application/AdminSettingsView.spec.tsx`

Expected: 新增断言先失败；若缺少测试依赖，记录具体错误并使用现有 AdminSettingsView 测试模式补齐。

- [ ] **Step 3: 实现外层布局**

将页面外层固定为：标题区、浅灰滚动内容区、横向 Tab 壳、业务面板区。Tab 使用统一图标组件或现有图标系统，不使用 Emoji；激活态、dirty 小圆点、键盘左右/Home/End 导航和 URL `?tab=` 行为保持可访问。

- [ ] **Step 4: 对齐截图视觉参数**

设置卡片使用白色背景、圆角、轻阴影和淡边框；section 使用 `space-y-6`、两列 grid 和响应式单列；保留移动端横向 Tab 滚动。只新增设置页需要的样式类。

- [ ] **Step 5: 补齐中英文 UI 文案**

增加九个 Tab、section 标题、保存状态、默认值来源、预留状态、危险配置提示、添加/删除/移动操作和字段说明文案。

- [ ] **Step 6: 运行测试和 lint**

Run: `pnpm --filter @enova/web test -- apps/web/components/application/AdminSettingsView.spec.tsx`

Run: `pnpm --filter @enova/web lint`

Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/application/AdminSettingsView.tsx apps/web/app/globals.css apps/web/messages/zh-CN.json apps/web/messages/en.json apps/web/components/application/AdminSettingsView.spec.tsx
git commit -m "feat(web): match sub2api system settings shell"
```

## Task 3: 实现通用设置业务面板

**Files:**
- Create: `apps/web/components/application/admin-settings/GeneralSettingsPanel.tsx`
- Create: `apps/web/components/application/admin-settings/LogoUploader.tsx`
- Create: `apps/web/components/application/admin-settings/CustomMenuEditor.tsx`
- Create: `apps/web/components/application/admin-settings/CustomEndpointEditor.tsx`
- Modify: `apps/web/components/application/AdminSettingsView.tsx`
- Modify: `apps/web/lib/api.ts`
- Test: `apps/web/components/application/admin-settings/GeneralSettingsPanel.spec.tsx`

- [ ] **Step 1: 写通用面板失败测试**

测试使用 mock SettingView 列表，断言通用面板渲染站点 URL、站点名称、副标题、Logo、客服邮箱、联系方式、文档链接、首页内容、分页设置、Switch、结构化菜单和端点；断言输入菜单字段时不会要求手写 JSON。

- [ ] **Step 2: 实现 LogoUploader**

组件接收 `value` 和 `onChange`，支持当前图预览、选择 PNG/JPG/SVG、限制 300KB、移除和错误提示。上传结果先保持为现有 `general.siteLogo` 可存储的字符串形式；不把二进制 Secret 写入日志。

- [ ] **Step 3: 实现 CustomMenuEditor**

解析 `general.customMenuItems`，用数组编辑 `id/label/url/visibility/enabled/sortOrder`；支持增加、删除、上移、下移、启用、普通用户/管理员可见范围；提交前做稳定排序和 JSON 序列化。

- [ ] **Step 4: 实现 CustomEndpointEditor**

解析自定义端点配置，编辑名称、URL、描述，支持增加、删除和排序；URL 必须通过前端基础格式校验，最终安全校验由 API 执行。

- [ ] **Step 5: 实现 GeneralSettingsPanel**

按截图组织为多张卡片和 section：站点基础信息两列布局，API/站点 URL 与长文本整行布局，表格偏好两列布局，Logo 上传，首页 Textarea 与 iframe 风险提示，Switch 行，自定义菜单/端点虚线添加区域，底部统一保存。

- [ ] **Step 6: 接入主页面 draft/save 协议**

面板只能通过 `drafts` 和 `onDraftChange` 修改状态，通过 `onBatchSave` 提交；不能绕过现有 Settings API。复杂 JSON 在面板内编辑，外层仍以 SettingView 字符串保存。

- [ ] **Step 7: 运行测试**

Run: `pnpm --filter @enova/web test -- apps/web/components/application/admin-settings/GeneralSettingsPanel.spec.tsx`

Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/application/admin-settings/GeneralSettingsPanel.tsx apps/web/components/application/admin-settings/LogoUploader.tsx apps/web/components/application/admin-settings/CustomMenuEditor.tsx apps/web/components/application/admin-settings/CustomEndpointEditor.tsx apps/web/components/application/admin-settings/GeneralSettingsPanel.spec.tsx apps/web/components/application/AdminSettingsView.tsx apps/web/lib/api.ts
git commit -m "feat(web): add structured general system settings panel"
```

## Task 4: 补齐设置注册表和复杂值校验

**Files:**
- Modify: `packages/db/src/settings-registry.ts`
- Modify: `packages/db/src/settings-registry.spec.ts`
- Modify: `apps/api/src/admin/settings.admin.service.ts`
- Modify: `apps/api/src/admin/settings.admin.service.spec.ts`

- [ ] **Step 1: 对照 sub2api 字段和 Enova 消费者写注册表测试**

测试断言 `general.apiBaseUrl`、必要的 `general.customEndpoints` 或明确的预留字段只有在产品边界允许时注册；现有 `general.siteUrl`、品牌、客服、首页、菜单和 table 配置都有正确类型、默认值和 group。测试同时断言不注册 Backend Mode 等无消费者字段。

- [ ] **Step 2: 实现注册表变更**

新增字段时补齐 `label`、`description`、`valueType`、`envDefault`、`min/max`、`permission` 和 `restartRequired`。复杂设置保持 string 存储，避免改变 settings 表模型。

- [ ] **Step 3: 增加复杂 JSON 校验**

在 `SettingsAdminService` 的单项和 batch 路径统一校验菜单/端点数组、必填字段、URL 协议、排序值、可见范围和数组长度；错误必须返回可读的 validation error，不把任意对象保存进 settings。

- [ ] **Step 4: 增加 Logo 和 URL 校验**

校验 Logo 仅允许受支持的 URL/Data URI 形式和最大长度；站点 URL、文档 URL、端点 URL 按现有生产 HTTPS 和 SSRF 边界执行。不得移除现有生产环境安全守卫。

- [ ] **Step 5: 运行后端测试**

Run: `pnpm --filter @enova/db test -- packages/db/src/settings-registry.spec.ts`

Run: `pnpm --filter @enova/api test -- apps/api/src/admin/settings.admin.service.spec.ts`

Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/settings-registry.ts packages/db/src/settings-registry.spec.ts apps/api/src/admin/settings.admin.service.ts apps/api/src/admin/settings.admin.service.spec.ts
git commit -m "feat(settings): validate sub2api-style structured values"
```

## Task 5: 将其他八个 Tab 业务化布局

**Files:**
- Create/modify: `apps/web/components/application/admin-settings/AgreementSettingsPanel.tsx`
- Create/modify: `apps/web/components/application/admin-settings/FeaturesSettingsPanel.tsx`
- Create/modify: `apps/web/components/application/admin-settings/SecuritySettingsPanel.tsx`
- Create/modify: `apps/web/components/application/admin-settings/UserDefaultsSettingsPanel.tsx`
- Create/modify: `apps/web/components/application/admin-settings/GatewaySettingsPanel.tsx`
- Create/modify: `apps/web/components/application/admin-settings/PaymentSettingsPanel.tsx`
- Modify: `apps/web/components/application/admin/EmailSettingsPanel.tsx`
- Create/modify: `apps/web/components/application/admin-settings/BackupSettingsPanel.tsx`
- Modify: `apps/web/components/application/AdminSettingsView.tsx`
- Test: `apps/web/components/application/admin-settings/settings-panels.spec.tsx`

- [ ] **Step 1: 为各 Tab 写面板映射测试**

测试断言每个现有设置 group/key 只出现在一个 Tab；登录条款、支付、邮件、存储的专用编辑器仍能读写 draft；backup 没有伪造的运行时设置。

- [ ] **Step 2: 提取 AgreementSettingsPanel**

迁移现有协议文档编辑器、模式选择、日期输入和批量保存 footer，保持条款版本校验和历史入口。

- [ ] **Step 3: 实现 FeaturesSettingsPanel**

按 sub2api 风格组织首页、菜单、表格分页和日志开关；复杂项委托已实现的编辑器，不重复 JSON 文本框。

- [ ] **Step 4: 实现 SecuritySettingsPanel**

将认证、限流、SSRF 等配置按“登录认证/安全防护”分卡片，危险项显示红色提示、权限徽章和生产约束说明。

- [ ] **Step 5: 实现 UserDefaultsSettingsPanel**

展示 welcome credits 和当前已注册的用户默认策略；不引入 sub2api 专属订阅/余额模型，除非 Enova 已有对应消费者。

- [ ] **Step 6: 实现 GatewaySettingsPanel**

统一队列、生成轮询、对象存储分组；保留存储 provider 过滤、配置状态和存储测试按钮。

- [ ] **Step 7: 对齐 Payment/Email/Backup**

支付和邮件继续使用原子 batch 与 Secret 语义；备份页只展示真实可用脚本和文档入口，明确环境变量管理，不显示虚假表单。

- [ ] **Step 8: 接入主页面并运行测试**

Run: `pnpm --filter @enova/web test -- apps/web/components/application/admin-settings/settings-panels.spec.tsx`

Expected: PASS。

- [ ] **Step 9: Commit**

```bash
git add apps/web/components/application/admin-settings apps/web/components/application/admin/EmailSettingsPanel.tsx apps/web/components/application/AdminSettingsView.tsx
git commit -m "feat(web): organize all system settings into business panels"
```

## Task 6: 数据迁移、OpenAPI/SDK 和兼容性检查

**Files:**
- Modify/Create: `packages/db/drizzle/<generated-migration>.sql`
- Modify: `apps/api/openapi.json` via generation command
- Modify: `packages/sdk/*` via generation command
- Modify: `docs/product-reference.md` if user-visible settings capability changes
- Test: existing settings integration suites

- [ ] **Step 1: 判断是否需要 migration**

检查新增字段是否只使用现有 `settings` key-value 表。如果没有 schema 变化，不生成空 migration；如果默认值迁移需要写入已有设置表，使用 Drizzle migration 并为重复执行设计幂等条件。

- [ ] **Step 2: 验证环境变量边界**

检查新增动态设置没有错误地复制 bootstrap-only Secret；更新 `.env.example` 或 ADR 仅在配置边界确实发生变化时进行。

- [ ] **Step 3: 重新生成 OpenAPI 和 SDK**

Run: `pnpm sdk:generate`

Expected: 生成文件与 controller/DTO 实际接口一致；禁止手工修改生成文件。

- [ ] **Step 4: 运行设置集成测试**

Run: `pnpm --filter @enova/db test -- packages/db/src/settings-store.spec.ts packages/db/src/settings-registry.spec.ts`

Run: `pnpm --filter @enova/api test -- apps/api/src/admin/settings.admin.service.spec.ts`

Run: `pnpm --filter @enova/web test -- apps/web/components/application/admin-settings`

Expected: PASS。

- [ ] **Step 5: 更新产品文档**

只记录实际已实现的设置能力，明确预留字段和环境变量 fallback，不把 sub2api 专属未实现能力写入产品承诺。

- [ ] **Step 6: Commit**

```bash
git add packages/db/drizzle apps/api/openapi.json packages/sdk docs/product-reference.md
git commit -m "chore(settings): sync generated contracts and docs"
```

## Task 7: 完整验证与视觉检查

**Files:**
- No new source files; inspect all changed files and generated artifacts.

- [ ] **Step 1: 检查工作区变更边界**

Run: `git status --short` and `git diff --stat`

Expected: 只有系统设置相关文件和明确生成文件发生变化；不覆盖用户原有未提交修改。

- [ ] **Step 2: 运行根目录验证**

Run: `pnpm lint`

Run: `pnpm typecheck`

Run: `pnpm test`

Run: `pnpm build`

Expected: 全部 PASS；失败时记录具体 workspace、命令和错误，不把未运行写成通过。

- [ ] **Step 3: 进行页面视觉检查**

启动 web/admin 页面，在桌面宽度和移动宽度分别检查：Tab、卡片、两列布局、Logo、Textarea、Switch、虚线添加区域、底部保存按钮、dirty 状态、错误提示和滚动行为。

- [ ] **Step 4: 验证关键交互**

手工验证：加载默认值、修改并取消、Tab 间切换、批量保存、刷新后回显、菜单排序、Logo 移除、Secret 留空、历史记录、CAS 冲突、无权限访问和生产 URL 校验。

- [ ] **Step 5: 最终状态报告**

报告改动目录、是否生成 migration/OpenAPI/SDK、全部验证命令结果、未解决问题和是否仍存在 sub2api/Enova 产品边界差异。

