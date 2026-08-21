# 统一资产页设计

## 背景

EnovaMotion 已有 `assets` 数据表，Worker 在生成任务完成时写入资产记录，生成任务响应中也保留可展示媒体 URL。当前用户侧图片历史和视频历史分开展示，侧边栏的“资产”菜单仍指向图片历史，无法作为统一媒体库使用。

本次变更新增真正按资产查询的用户 API 和独立资产页面，参考用户提供的截图，采用按日期分组的媒体网格和轻量筛选栏。

## 目标

- 将“资产”变为侧边栏中的独立入口，路由为 `/app/assets`。
- 提供 Workspace 隔离的统一资产查询 API，覆盖图片和视频。
- 支持按媒体类型、日期范围和创建时间排序筛选。
- 以缩略图网格按日期分组展示媒体；图片支持预览，视频支持播放。
- 保留现有图片/视频历史页面和其交互，不改变已有创作流程。

## 非目标

- 不新增资产删除、收藏、批量操作或持久化分页游标。
- 不修改 Worker 资产写入逻辑、对象存储实现或数据库 schema。
- 不把生成任务历史替换成资产页；两者仍是不同的产品入口。

## API 设计

新增 `AssetsModule`，包含 controller、service 和用户查询 DTO。controller 使用现有 `AuthGuard`，service 所有查询同时限制 `workspaceId`。

### `GET /api/v1/assets`

查询参数：

- `type`：`ALL`、`IMAGE`、`VIDEO`，默认 `ALL`
- `from`：ISO 日期/时间，可选，包含该时间点
- `to`：ISO 日期/时间，可选，包含该时间点
- `sort`：`NEWEST`、`OLDEST`，默认 `NEWEST`
- `limit`：默认 60，限制在 1–100

查询从 `assets` 出发，按 `workspaceId` 和筛选条件过滤；左连接 `generation_jobs` 用于读取生成任务的 prompt 和 generation id。资产 URL 使用生成任务 `outputJson.url`，不泄露对象存储内部 key 或 provider secret。

返回数组，每项包含：

```ts
{
  id: string
  type: 'IMAGE' | 'VIDEO' | 'UPLOAD'
  url: string | null
  mimeType: string | null
  size: number
  width: number | null
  height: number | null
  duration: number | null
  createdAt: string
  generationId: string | null
  prompt: string | null
}
```

当前页面仅展示有可用 URL 的图片和视频；没有 URL 的资产仍由 API 返回，方便后续对象存储签名 URL 接入。

## Web 页面设计

### 路由与导航

- 新增 `apps/web/app/[locale]/app/assets/page.tsx`。
- 侧边栏将资产从生成菜单的可展开子菜单改为一级 `NavLink`，图标使用文件夹图标。
- 资产页保持独立 active 状态，不与 `/app/images` 或 `/app/videos` 混淆。

### 页面结构

- 页面背景使用现有浅色工作区背景，内容区域保持大留白和低边框密度。
- 顶部为页面标题“资产”和简短说明。
- 筛选栏依次提供：图片/视频切换、筛选、时间、排序。
- 筛选菜单使用现有 Ant Design 组件，支持点击外部关闭和当前选项勾选。
- 资产按本地化日期分组，组标题格式跟随当前 locale；每组使用 CSS grid 自适应列数。
- 图片使用 `object-fit: cover` 缩略图，视频显示播放图标和时长；点击媒体打开预览。
- 加载中显示网格骨架；无资产显示引导创作的空状态；筛选无结果显示清除筛选入口。

### 响应式

- 桌面端保持宽松网格，资产卡片优先展示媒体本身，不加入厚重卡片边框。
- 窄屏下降低网格最小宽度，筛选项允许换行；侧边栏沿用现有移动端行为。

## 数据与错误处理

- 前端请求失败使用现有错误提示机制，不展示内部异常详情。
- 日期参数在前端按 ISO 格式发送；API 对非法日期、未知枚举和超范围 limit 返回现有 DTO 校验错误。
- API 通过 workspace 条件防止跨工作区访问；不接受客户端传入 workspace/user id。
- 没有媒体 URL 的资产不渲染为可点击媒体，避免产生破损预览。

## 测试与验证

- API service/controller 测试：Workspace 隔离、type/date/sort/limit 参数和 URL/prompt 映射。
- Web 测试：导航 active 匹配、筛选状态转换、日期分组和空状态。
- 变更后至少运行 `pnpm --filter @enova/api typecheck`、`pnpm --filter @enova/web typecheck`、相关 Vitest；跨 workspace API 合约变化时同步运行根目录 lint/typecheck/test/build。
- 本次不触碰数据库迁移、OpenAPI 生成文件或 Worker。
