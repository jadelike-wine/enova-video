# i18n 完整性修复设计

## 目标

让 `zh-CN` 与 `en` 两个 URL 路由在 Web UI 中呈现相同的信息与交互，并使数字、日期和可预期的 API 错误跟随 URL locale。语言选择只来自 URL；不写入 User、Workspace、Session 或 API 持久化状态。

## 范围

- 将普通用户界面、创作工作台、登录条款、首页降级页及管理后台的可见静态文案迁入 `next-intl` message 文件。
- 将模型名称/模式/模板等展示数据改为由调用处以翻译函数生成，保留 API ID、尺寸和其他领域常量不变。
- 使用当前 URL locale 格式化日期和数字，移除固定 `zh-CN` 与浏览器默认 locale 的展示格式化。
- 让前端按稳定 API error code 映射本地化提示；不翻译 Provider 原始错误内容，也不改变 API 错误响应契约。
- 纠正邮件模板管理的产品边界：网站路由 locale 为 `zh-CN`/`en`，邮件模板仍为管理员选择的 `zh`/`en` 内容，且当前发信链路不按收件人 URL locale 选取模板。管理页面不再暗示它会自动随用户语言发送。
- 增加 message 结构一致性和 locale-aware 辅助函数的回归测试。

## 非目标

- 不新增用户语言偏好、数据库列、cookie 或 session 字段。
- 不向 API 请求传递 `Accept-Language` / `x-locale`，不让服务端为 HTTP 错误选择语言。
- 不改变支付回调、Provider、Worker、生成状态机或邮件发送的业务行为。
- 不翻译管理员配置的自由文本（自定义菜单名称、首页 Markdown、条款正文、管理员自定义邮件 HTML）。这些内容由管理员自行提供。

## 架构

Web 继续以 `next-intl` 和 `[locale]` 路由作为唯一国际化边界。可见静态文案由组件 `useTranslations()` 或服务端 `getTranslations()` 提供；非 React 展示目录以接收 `TFunction`/locale 的工厂函数或小型 formatter 来避免在领域常量中固化某种语言。

API 继续返回 `error.code` 和诊断 message。前端新增一个白名单式错误码翻译 helper：已知 Enova 业务码显示翻译，未知/Provider 错误保留经现有净化后的文本，确保排障信息不被丢弃。

## 组件与数据流

1. `messages/en.json`、`messages/zh-CN.json` 增加 admin、生成工作台、协议、首页降级、模型展示、错误码和可访问性文案；键结构必须保持一致。
2. `apps/web/lib/models.ts` 仅保留协议 ID、尺寸、比例、能力标识；新增展示工厂在调用组件通过翻译键构造 `label`、`description` 和能力列表。
3. 管理后台及设置面板接收翻译函数或在组件内调用 `useTranslations`，替换所有用户可见硬编码文字、表格空态、确认框、校验提示和 aria label。
4. 统一的 locale formatter 使用当前 `useLocale()` / `useFormatter()`；无法使用 hook 的纯函数显式接收 locale。
5. 邮件设置页将模板 locale 命名为“邮件内容语言”，并明确它不从访问 URL 自动推导；不改 SMTP sender 的模板选择逻辑。

## 错误处理

- 前端对 `ApiError` 提取 `error.code`。若 code 有本地映射，使用翻译；否则使用现有 `formatErrorMessage` 的安全文本。
- 认证、余额、权限、校验和通用网络错误至少有中文/英文映射。HTTP/Provider 的未知错误保留原文，避免产生误导性翻译。
- 翻译键缺失视为测试失败，不在运行时回退到另一种 UI 语言。

## 验证

- 测试两份 messages 的递归叶子键完全一致。
- 测试模型展示工厂在两种 locale 下生成对应语言，并验证 locale formatter 使用调用方提供的 locale。
- 测试已知 API error code 的本地化映射及未知错误回退。
- 对修改范围运行 `@enova/web` 的 lint、typecheck、test；API 邮件文案/测试变更时运行 `@enova/api` 的相关 test/typecheck。
- 最后扫描应用源码中的可见硬编码中文/英文，保留品牌、协议术语、URL、用户/管理员自由文本与代码注释白名单。

