<h4 align="right"><a href="README_EN.md">English</a> | <strong>简体中文</strong></h4>
<p align="center">
  <img src="docs/images/logo.jpg" width="138" alt="Agnes AI Creator" style="border-radius: 28px;"/>
</p>
<h1 align="center">Agnes AI Creator</h1>
<p align="center"><strong>基于 Agnes AI 免费大模型的自托管多模态 Web 客户端</strong></p>
<p align="center">AI 对话 · 文生图 / 图生图 · 文生视频 / 图生视频 · 七牛云持久化（可选）</p>
<div align="center">
  <a href="https://platform.agnes-ai.com/" target="_blank">
  <img alt="agnes ai" src="https://img.shields.io/badge/platform-Agnes%20AI-ff6b3d?style=flat-square"></a>
  <a href="https://agnes-ai.com/doc/overview" target="_blank">
  <img alt="models" src="https://img.shields.io/badge/models-text%20%7C%20image%20%7C%20video-black?style=flat-square"></a>
  <a href="https://www.python.org/" target="_blank">
  <img alt="python" src="https://img.shields.io/badge/python-3.10+-3776AB?style=flat-square&logo=python&logoColor=white"></a>
  <a href="https://fastapi.tiangolo.com/" target="_blank">
  <img alt="fastapi" src="https://img.shields.io/badge/FastAPI-0.115-009688?style=flat-square&logo=fastapi&logoColor=white"></a>
  <a href="https://nextjs.org/" target="_blank">
  <img alt="next" src="https://img.shields.io/badge/Next.js-15-000000?style=flat-square&logo=nextdotjs&logoColor=white"></a>
  <a href="https://x.com/haiqushe" target="_blank">
  <img alt="follow" src="https://img.shields.io/badge/follow-@haiqushe-red?style=flat-square"></a>
  <a href="https://dz.haiqushe.com/" target="_blank">
  <img alt="haiqushe" src="https://img.shields.io/badge/海趣社-站点导航-blueviolet?style=flat-square"></a>
</div>

<p align="center">
  <img src="docs/images/ai-img-gen.png" alt="Agnes AI Creator — AI 流式对话界面" width="920" style="border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,0.18);"/>
</p>

<p align="center">
  <strong>对话 · 生图 · 生视频 · 一个界面全搞定</strong><br/>
</p>

## 界面预览

<table cellpadding="6">
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="docs/images/ai-img-gen.png" alt="图片生成界面" width="100%" style="display:block;margin-bottom:6px;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,0.15);"/>
      <strong>🎨 图片生成</strong><br/>
      <span style="font-size:13px">文生图 · 单图编辑 · 多图合成 · 历史回看</span>
    </td>
    <td width="50%" align="center" valign="top">
      <img src="docs/images/ai-video-gen.png" alt="视频生成界面" width="100%" style="display:block;margin-bottom:6px;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,0.15);"/>
      <strong>🎬 视频生成</strong><br/>
      <span style="font-size:13px">文/图生视频 · 关键帧动画 · 内置播放器 · 七牛云转存</span>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="docs/images/ai-chat.png" alt="AI 对话界面" width="100%" style="display:block;margin-bottom:6px;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,0.15);"/>
      <strong>💬 AI 对话</strong><br/>
      <span style="font-size:13px">流式输出 · Thinking 模式 · Token 统计 · 多对话切换</span>
    </td>
    <td width="50%" align="center" valign="top">
      <img src="docs/images/settings.png" alt="网页设置界面" width="100%" style="display:block;margin-bottom:6px;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,0.15);"/>
      <strong>⚙️ 网页设置</strong><br/>
      <span style="font-size:13px">API Key / Base URL 可视化配置 · 多 Key 管理 · 即改即用</span>
    </td>
  </tr>
</table>

## 功能特性

| 模块 | 能力 |
|------|------|
| **文本对话** | 新建 / 切换对话、流式输出、Thinking 模式、Token 与耗时统计 |
| **图片生成** | 文生图、单图编辑、多图合成；多模型支持 |
| **视频生成** | 文生视频、图生视频、多图视频、关键帧动画；后台异步轮询任务状态 |
| **媒体存储** | 图片 / 视频生成结果自动转存七牛云，持久化历史记录 |
| **网页设置** | 可视化配置 API Base URL、多 Key 管理与切换，无需改代码或重启 |

### 支持的模型

| 类型 | 模型 |
|------|------|
| 文本 | `agnes-2.0-flash`、`agnes-1.5-flash`（已弃用） |
| 图片 | `agnes-image-2.0-flash`、`agnes-image-2.1-flash` |
| 视频 | `agnes-video-v2.0` |

## 技术栈

- **前端**: Next.js 15（App Router）· React 19 · TypeScript · Tailwind CSS
- **后端**: Python 3 · FastAPI · httpx · APScheduler
- **数据库**: SQLite（零配置，首次启动自动建表，SQL 文件在 backend/sql 文件夹里）
- **对象存储**: 七牛云（可选）
- **AI 接口**: [Agnes AI OpenAI 兼容 API](https://agnes-ai.com/doc/overview)

## 环境要求

- Python 3.10+
- Node.js 18.18+
- [Agnes AI API Key](https://platform.agnes-ai.com/)（免费申请，在网页 **设置** 中配置）
- 七牛云对象存储（可选，用于持久化保存生成结果）

## 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/jiyiren/agnes-ai-creator.git
cd agnes-ai-creator
```

### 2. 配置后端环境变量（可选）

七牛云与数据库路径通过 `backend/.env` 配置；**Agnes AI 的 API Key 与 Base URL 在网页设置中管理**，无需写入 `.env`。

```bash
cp backend/.env.example backend/.env
```

编辑 `backend/.env`：

| 变量 | 必填 | 说明 |
|------|------|------|
| `QINIU_ACCESS_KEY` | 否 | 七牛云 Access Key |
| `QINIU_SECRET_KEY` | 否 | 七牛云 Secret Key |
| `QINIU_BUCKET` | 否 | 存储桶名称 |
| `QINIU_DOMAIN` | 否 | CDN 访问域名，如 `https://xxx.example.com` |
| `QINIU_REGION` | 否 | 存储区域，默认华东 `z0` |
| `DATABASE_PATH` | 否 | SQLite 路径，默认 `./database/aimodel.db` |

> 未配置七牛云时，AI 生成功能仍可用，但媒体可能不会持久化到对象存储。

### 3. 启动后端

建议使用虚拟环境，避免与系统 Python 包冲突：

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 4. 启动前端

```bash
cd frontend
npm install
npm run dev
```

### 前端环境变量

Next.js 前端通过以下环境变量配置（放在 `frontend/.env` 或部署环境中）：

```env
NEXT_PUBLIC_SITE_URL=https://your-domain.com
BACKEND_URL=http://127.0.0.1:8000
```

| 变量 | 必填 | 说明 |
|------|------|------|
| `NEXT_PUBLIC_SITE_URL` | **生产环境必填** | 站点对外访问的完整域名（如 `https://your-domain.com`）。用于生成 canonical、OpenGraph URL、sitemap 与 robots Sitemap。开发环境未设置时回退到 `http://localhost:3000`；**生产环境未设置会直接构建失败**，防止把 localhost 泄漏到 SEO 输出。 |
| `BACKEND_URL` | 部署时必填 | Next.js Node Server 转发 `/api/*` 时连接的后端 FastAPI 地址，默认 `http://127.0.0.1:8000`。 |

> 注意：Agnes AI 的 API Key 等敏感信息只应保存在后端（`backend/.env` 或网页设置），**不要**放入 `NEXT_PUBLIC_*` 前缀的环境变量，否则会暴露到浏览器端。

### 5. 首次使用：配置 Agnes AI

浏览器访问 [http://localhost:3000](http://localhost:3000)，进入应用侧边栏 **设置** 页面：

<p align="left">
  <img src="docs/images/settings.png" alt="网页设置 — 添加 API Key" width="720" style="border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,0.15);"/>
</p>

1. **API Base URL**：默认为 `https://apihub.agnes-ai.com`，一般无需修改
2. **添加 API Key**：填写名称与 Key，勾选「添加后立即启用」
3. 可添加多个 Key，随时切换「使用中」的 Key

配置完成后即可使用对话、图片、视频功能。

Next.js 前端会将浏览器端的 `/api/*` 请求代理到后端的 `http://127.0.0.1:8000`（可通过 `BACKEND_URL` 环境变量覆盖）。浏览器始终只访问 `/api/*`，不感知后端地址。

## 生产部署

> 部署架构说明：本项目**不是**「静态构建 → Nginx 托管 dist」的传统 SPA 部署。前端是 Next.js Node Server（`next start`），需要常驻进程运行：

```text
Browser
  ↓
Reverse Proxy (Nginx / Caddy / Traefik)
  ├── /api/* → FastAPI (http://127.0.0.1:8000)
  └── /*     → Next.js Node Server (next start, 默认 3000)
```

或直接让 Next.js Node Server 的 `/api/*` rewrite 转发到 `BACKEND_URL`，反向代理只负责把流量交给 Next.js 即可。

### 构建

```bash
# 构建 Next.js 生产包（生产环境必须设置 NEXT_PUBLIC_SITE_URL）
cd frontend
NEXT_PUBLIC_SITE_URL=https://your-domain.com BACKEND_URL=http://127.0.0.1:8000 npm run build

# 后端以生产模式运行（建议在 venv 中）
cd backend
source .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### 运行

```bash
cd frontend
npm run start   # Next.js Node Server，默认端口 3000
```

前端以 Next.js 方式部署，常驻 Node Server；反向代理将 `/*` 转发到 Next.js，将 `/api/*` 转发到 FastAPI（或直接由 Next.js 的 `/api/*` rewrite 转发到 `BACKEND_URL`）。

## API 文档

后端启动后访问 [http://localhost:8000/docs](http://localhost:8000/docs) 查看 Swagger 文档。

### 设置相关接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/settings/status` | 配置状态（是否有启用 Key、Base URL 等） |
| GET | `/api/settings/base-url` | 获取 API Base URL |
| PUT | `/api/settings/base-url` | 更新 API Base URL |
| GET | `/api/settings/api-keys` | 列出所有 API Key（脱敏） |
| POST | `/api/settings/api-keys` | 添加 API Key |
| PATCH | `/api/settings/api-keys/{id}` | 编辑名称或 Key |
| POST | `/api/settings/api-keys/{id}/activate` | 启用指定 Key |
| DELETE | `/api/settings/api-keys/{id}` | 删除 Key |

## 数据库

- 建表 SQL：`backend/sql/schema.sql`
- 默认数据库文件：`backend/database/aimodel.db`
- 首次启动时自动初始化

主要数据表：

| 表名 | 用途 |
|------|------|
| `conversations` / `messages` | 对话与消息记录 |
| `image_tasks` / `video_tasks` | 图片 / 视频生成任务 |
| `uploads` | 上传文件记录 |
| `api_keys` | Agnes AI API Key 配置 |
| `app_settings` | 应用级配置（如 Base URL） |

## 七牛云存储路径

| 类型 | 路径 |
|------|------|
| 图片 | `data/img/` |
| 视频 | `data/video/` |
| 文档 | `data/document/` |
| 其他 | `data/other/` |

## 项目结构

```
agnes-ai-creator/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI 入口 & 定时任务
│   │   ├── config.py            # 环境变量与模型配置
│   │   ├── database.py          # SQLite 连接与初始化
│   │   ├── schemas.py           # 请求 / 响应模型
│   │   ├── routers/             # chat / images / videos / settings
│   │   └── services/            # Agnes API、Key 管理、七牛云、视频轮询
│   ├── sql/schema.sql           # 数据库建表 SQL
│   ├── database/                # SQLite 数据库文件（gitignore）
│   ├── .env.example             # 环境变量示例
│   └── requirements.txt
├── frontend/                # Next.js 15（App Router）
│   ├── app/
│   │   ├── layout.tsx       # 根布局
│   │   ├── page.tsx         # SEO 首页（/）
│   │   ├── ai-chat/         # SEO 落地页（/ai-chat）
│   │   ├── ai-image-generator/
│   │   ├── ai-video-generator/
│   │   ├── models/          # 模型列表与详情（/models/*）
│   │   ├── docs/            # 文档（/docs/*）
│   │   ├── app/             # 交互式应用（/app/chat | /app/images | /app/videos | /app/settings）
│   │   ├── robots.ts        # /robots.txt
│   │   └── sitemap.ts       # /sitemap.xml
│   ├── components/
│   │   ├── marketing/       # 官网 / SEO 组件
│   │   └── application/     # 应用交互组件
│   ├── lib/                 # api.ts / seo.ts / models.ts 等
└── _needs/                      # 需求与设计说明
```


