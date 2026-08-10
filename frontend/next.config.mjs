const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:8000'

const nextConfig = {
  // Standalone output: 生成最小化 Node Server，便于 Docker 化部署
  output: 'standalone',
  reactStrictMode: true,
  async redirects() {
    return [
      { source: '/chat', destination: '/app/chat', permanent: true },
      { source: '/chat/:id', destination: '/app/chat/:id', permanent: true },
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

export default nextConfig