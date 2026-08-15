# sub2api 风格系统设置重构设计

## 目标

在 enova-video 中实现完整的系统设置工作台，使设置模块的 Tab 结构、页面布局、卡片、表单组件、字段组织和保存体验尽量对齐 sub2api，同时保留 enova-video 当前的动态配置安全能力和图片/视频生成产品边界。

本设计覆盖完整系统设置模块，而不只覆盖“通用设置”：通用设置、登录条款、功能开关、安全与认证、用户默认值、网关服务、支付设置、邮件设置和数据备份。

## 视觉与交互基准

唯一视觉基准为用户提供的 sub2api 截图和现有 sub2api `SettingsView.vue`：

- 页面顶部显示“系统设置”和简短说明。
- 使用横向图标 Tab，激活项使用浅色强调背景和底部强调线。
- 页面主体使用浅灰背景、白色大圆角卡片和轻量阴影。
- 通用设置采用两列字段布局；长字段使用整行布局。
- 分组使用卡片标题、说明文字和分隔线。
- Switch、Select、Radio/Segmented、Textarea、Logo 上传和动态列表使用专用组件。
- 自定义菜单和端点使用虚线“添加”区域，并支持编辑、删除和排序。
- 使用页面/Tab 级保存按钮呈现“保存设置”状态；普通字段不在每一行堆叠保存按钮。
- 保留配置历史、Secret 脱敏、需要重启和高风险配置提示，但将其收纳到高级操作或分组提示中，减少主界面噪音。

## Tab 与配置分组

固定保留九个一级 Tab：

1. 通用设置
2. 登录条款
3. 功能开关
4. 安全与认证
5. 用户默认值
6. 网关服务
7. 支付设置
8. 邮件设置
9. 数据备份

通用设置内部按以下业务区块组织：

- 站点基础信息：站点 URL、应用名称、站点名称、站点副标题、Logo。
- 通用表格设置：默认每页条数、可选每页条数。
- 自定义端点：名称、URL、描述和排序/删除。
- 客服与文档：客服邮箱、客服联系方式、文档链接。
- 首页内容：Markdown/HTML/iframe 内容和安全提示。
- 首页开关：简洁首页、隐藏 CCS 导入按钮（仅在功能仍存在时展示）。
- 自定义菜单页面：菜单名称、URL、可见范围、启用状态和排序。

虽然配置注册表继续使用 `general`、`customization`、`table` 等运行时分组，但前端新增独立的业务 section 元数据，避免数据库 group 直接决定用户界面分组。

## 架构方案

### 前端

保留 Next.js App Router、Tailwind、现有 Admin Settings 路由和 API client。将当前单文件视图拆分为设置工作台和领域面板：

- `apps/web/components/application/AdminSettingsView.tsx`：加载、Tab 路由、draft 生命周期和保存协调。
- `apps/web/components/application/admin-settings/settings-tabs.ts`：Tab、section、字段渲染元数据。
- `apps/web/components/application/admin-settings/GeneralSettingsPanel.tsx`：通用设置业务布局。
- `apps/web/components/application/admin-settings/AgreementSettingsPanel.tsx`：登录条款。
- `apps/web/components/application/admin-settings/FeaturesSettingsPanel.tsx`：功能开关。
- `apps/web/components/application/admin-settings/SecuritySettingsPanel.tsx`：安全与认证。
- `apps/web/components/application/admin-settings/UserDefaultsSettingsPanel.tsx`：用户默认值。
- `apps/web/components/application/admin-settings/GatewaySettingsPanel.tsx`：队列、存储和生成网关策略。
- `apps/web/components/application/admin-settings/PaymentSettingsPanel.tsx`：支付配置。
- `apps/web/components/application/admin-settings/EmailSettingsPanel.tsx`：SMTP 和邮件通知。
- `apps/web/components/application/admin-settings/BackupSettingsPanel.tsx`：备份说明和运维入口。
- `apps/web/components/application/admin-settings/CustomMenuEditor.tsx`：结构化菜单编辑器。
- `apps/web/components/application/admin-settings/CustomEndpointEditor.tsx`：结构化端点编辑器。
- `apps/web/components/application/admin-settings/LogoUploader.tsx`：Logo 预览、上传、移除和大小/类型校验。

如现有组件已经覆盖某个面板的稳定实现，优先提取其布局和接口，不重复创建第二套保存逻辑。

### 后端

继续以 enova-video 的注册表和 SettingsStore 为事实来源，不复制 sub2api 的 Go 聚合 `SystemSettings` 表结构：

- `packages/db/src/settings-registry.ts`：配置 key、值类型、默认值、范围、Secret、权限和重启标记。
- `packages/db/src/settings-store.ts`：DB 覆盖、环境变量 fallback、CAS、history 和加密存储。
- `apps/api/src/admin/settings.admin.controller.ts`：读取、单项更新、批量更新、Secret 清除、历史查询和专项测试接口。
- `apps/api/src/admin/settings.admin.service.ts`：校验、生产环境保护、登录条款和存储测试。
- `apps/web/lib/api.ts`：前端 SettingView、结构化设置类型和 API 调用。

新增字段必须先进入注册表，再由 API 返回；禁止只在前端增加表单字段。

### 配置命名

继续采用 namespaced camelCase key：

```text
general.siteUrl
general.apiBaseUrl
general.siteName
general.siteSubtitle
general.siteLogo
general.supportEmail
general.contactInfo
general.docUrl
general.homeContent
general.compactHomeEnabled
general.hideCcsImportButton
general.customMenuItems
general.customEndpoints
table.defaultPageSize
table.pageSizeOptions
```

对于 sub2api 的网关专属配置，只有在 enova-video 已有真实消费者或明确预留边界时才加入注册表。UI 可以展示“预留/不适用”状态，但不能声称配置已经改变不存在的业务行为。

## 保存与数据流

1. 页面通过 `GET /api/v1/admin/settings` 加载完整 SettingView 列表。
2. 面板将字符串值转换为适合编辑的 draft；复杂设置使用结构化编辑器维护，提交前序列化为注册表约定格式。
3. 普通 Tab 使用一次 batch 更新；支付、邮件、存储等必须保持一致性的配置继续走原子批量更新。
4. API 校验字段类型、枚举、数值范围、URL、安全边界、JSON 结构和生产环境限制。
5. SettingsStore 使用 CAS 写入 settings 和 settings_history，提交后通过 Redis 广播失效。
6. 保存成功后刷新当前设置和 draft；Secret 保持脱敏，空 Secret 表示保持原值。
7. 并发版本冲突、校验失败和需要重启的配置分别提供明确提示。

## 产品边界与兼容策略

以下 sub2api 能力不直接伪装成 Enova 已实现功能：

- Backend Mode：仅属于 API Gateway 后端模式；如无 Enova 消费者，标记为预留或不加入。
- CCS 导入：只有 API Keys 页面仍存在对应入口时才保留开关。
- Custom Endpoints：只有 Enova 存在自定义外部端点/iframe 需求时才启用；否则可作为预留字段。
- 上游 Gateway、OAuth、订阅和模型路由设置：仅迁移与 Enova Provider、生成任务、支付和用户模型有实际对应关系的字段。

应用名称与站点名称必须在 UI 中明确使用范围；客服邮箱与客服联系方式必须明确主字段和补充字段，避免两个字段产生展示冲突。

## 安全要求

- Secret 不进入日志、前端 bundle、测试快照或公开站点配置。
- Logo、文档链接、自定义端点和 iframe URL 必须遵循 URL/SSRF/大小/content-type 校验边界。
- 不降低现有生产环境 HTTPS、SSRF DNS 解析和支付回调安全约束。
- 复杂配置的清空、恢复默认值和 Secret 清除必须有确认和 history 记录。
- 高风险安全设置继续受 `settings.security_write` 和敏感操作校验保护。

## 验收标准

### 视觉验收

- 九个 Tab 的顺序、命名、图标位置、激活态和间距与截图风格一致。
- 通用设置页面具备截图中的两列字段、整行字段、分组标题、Logo 上传、Textarea、Switch、虚线添加区域和底部保存按钮。
- 自定义菜单和端点不再要求管理员手写 JSON。
- 移动宽度下两列表单自动变为单列，Tab 可横向滚动。

### 功能验收

- 每个已注册设置均能在明确的 Tab/section 找到。
- 复杂字段保存后可重新加载并保持结构和顺序。
- 单实例、多实例、CAS 冲突、Secret 脱敏、历史记录和权限校验保持有效。
- 不存在的 sub2api 业务不会因为增加 UI 字段而被误认为已实现。

### 工程验收

- 相关 API、注册表、前端组件和设置服务测试通过。
- 涉及 schema 或默认配置时生成并验证 Drizzle migration。
- API 变更后重新生成 OpenAPI 和 SDK。
- 最终按 AGENTS.md 要求执行 `pnpm lint`、`pnpm typecheck`、`pnpm test` 和 `pnpm build`，并记录无法执行的项目。

## 非目标

- 不复制 sub2api 的旧架构目录、Go 服务、Vue 组件或数据库表。
- 不把 Enova-video 改造成 API Gateway 产品。
- 不在本次工作中修改生成任务、计费、Provider 或支付业务逻辑，除非设置字段接入所必需。
- 不对整个仓库做无关格式化。
