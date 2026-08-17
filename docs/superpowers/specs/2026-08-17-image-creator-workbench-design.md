# 图片生成创作工作台 UI 重构设计

## 背景与目标

将 `/app/images` 从传统后台式的左右配置面板，重构为接近即梦 AI / Midjourney Web 的沉浸式图片创作工作台。此次变更只涉及 `apps/web` 的页面结构、样式和交互编排，不改变 API、请求 payload、生成状态机、上传流程、credits 逻辑或任务历史数据。

## 视觉与布局

- 页面背景使用 `#FAFAFA`，内容表面使用白色，文字使用近黑色，辅助文字使用灰色，沿用现有绿色品牌色。
- 页面由三段组成：可折叠侧栏、创作画布、底部 Prompt Composer。
- 默认使用宽侧栏 B：约 220px，显示图标和弱化文字。
- 侧栏支持顶部“向内折叠”按钮；折叠后为约 64px 的图标优先模式 A。折叠宽度通过过渡动画变化，主体区域自适应，不改变路由或数据。
- 页面取消图片页内层厚重边框、大卡片阴影和传统表单分组，使用留白、对齐和轻量分隔建立层级。

## 组件边界

### `ImageCreatorLayout`

负责图片页工作台的整体布局、折叠状态和响应式容器，向子组件传递当前任务、提交状态和操作回调。

### `Sidebar`

负责首页、灵感、生成、素材库、画布、视频生成、设置等轻量导航，以及品牌、余额和用户入口。导航项继续使用现有 App Shell 的路由体系；图片页内部可提供与当前路径一致的工作台导航视觉，不创建新的后端入口。

### `PromptComposer`

负责底部大圆角输入框、参考图上传入口、生成模式、模型、比例、清晰度和生成按钮。输入值仍由现有 Ant Design Form 或等价受控状态提交给 `ImageView` 的 `generate` 回调。

### `ModelSelector`

将现有图片模型、尺寸和比例选项转为紧凑工具栏控件，继续从 `lib/models.ts` 读取产品化模型目录。

### `CreationTemplates`

空状态下展示“你好，想创作什么？”和商品图生成、人物写真、科技海报三个横向模板。模板点击只填入提示词和必要的 UI 状态，不直接调用生成接口。

### `GenerationCanvas`

负责空态、生成中、成功和失败四种视图。生成中使用 4 格 shimmer 骨架和进度文案，成功时使用图片网格，失败时保留重新生成入口。

### `ImageGrid` / `ImageCard`

负责生成结果的 2/4 列布局、图片渐入、hover 浮层和下载、重新生成、编辑、收藏/删除等操作。操作复用现有回调；“收藏”若后端没有对应接口，则只提供不改变数据的本地 UI 状态，不伪造持久化能力。

## 数据与状态

- 继续使用 `generationApi.create`、`generationApi.list`、`uploadApi.upload`、`usePaginatedTaskHistory`、`useApiKeyGuard` 和 `useSession`。
- 保留现有 `text2img`、`img2img`、`multi_img` 三种模式和上传校验。
- 保留现有 `PENDING`、`QUEUED`、`RUNNING`、成功、失败、取消状态到 UI 状态的映射。
- 生成时仍先插入 optimistic task，接口成功后替换为服务端任务；失败时移除 optimistic task 并显示已有错误提示。
- 折叠状态只属于页面 UI 状态；本次不增加服务端存储。若适合现有前端结构，可使用 `localStorage` 记忆用户选择，但不影响默认宽侧栏行为。

## 动效与无障碍

- 使用 `framer-motion` 处理页面淡入、侧栏折叠、模板 hover、输入框 focus 光环、骨架 shimmer 和结果渐入。
- 所有图标按钮提供 `aria-label` 或 tooltip；折叠按钮提供 `aria-expanded`。
- 生成按钮在生成中禁用并保留上传/生成阶段的文案反馈。
- 在窄屏下，宽侧栏自动进入图标优先布局，Prompt Composer 保证工具栏可横向滚动或合理换行。

## 错误处理

- 不改变现有 prompt、参考图、API key、上传失败和生成失败校验。
- 失败视图继续展示用户可理解的错误提示和重新生成操作；不在 UI 中暴露 provider secret、API key 或内部堆栈。
- 图片下载失败继续回退到新窗口打开结果 URL。

## 验证范围

- `pnpm --filter @enova/web lint`
- `pnpm --filter @enova/web typecheck`
- `pnpm --filter @enova/web test`
- 如新增依赖或跨 workspace 配置造成影响，再执行根目录 `pnpm build`。
- 手动验证空态、模板填充、三种生成模式、上传校验、生成中四格骨架、成功结果操作、失败重试、侧栏折叠/展开和窄屏布局。

## 明确不在范围内

- 不修改 `apps/api`、`apps/worker`、数据库 schema、迁移、OpenAPI 或 SDK 生成文件。
- 不新增图片生成能力、模型、尺寸、比例或后端收藏接口。
- 不将管理员导航从 `AppShell` 整体改造成创作导航；本次只针对图片生成页面的用户体验，并通过页面内部工作台视觉弱化后台感。
