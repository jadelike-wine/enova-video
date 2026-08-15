import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./i18n.ts')

// 新架构：前端通过 Next rewrite 把 /api/* 代理到 NestJS API（app 服务自身提供 /api/v1/*）。
// 浏览器只看到 /api/*（同源），Session Cookie（enova_session）随请求自动携带。
const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:3001'

const nextConfig = {
  // Standalone output: 生成最小化 Node Server，便于 Docker 化部署
  output: 'standalone',
  reactStrictMode: true,
  // 开发模式按需编译优化：对 antd、dayjs 等大库按需引入，减少单路由编译模块数
  experimental: {
    optimizePackageImports: ['antd', '@ant-design/icons', 'dayjs', 'next-intl'],
  },
  async redirects() {
    return [
      // Chat 功能已下线：旧的 /chat 链接统一导流到图片生成，避免 404
      { source: '/chat', destination: '/app/images', permanent: true },
      { source: '/chat/:id', destination: '/app/images', permanent: true },
      { source: '/images', destination: '/app/images', permanent: true },
      { source: '/videos', destination: '/app/videos', permanent: true },
      { source: '/settings', destination: '/app/settings', permanent: true },
    ]
  },
  async headers() {
    return [
      {
        source: '/app/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
    ]
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${BACKEND_URL}/api/:path*`,
      },
    ]
  },
}

export default withNextIntl(nextConfig)
