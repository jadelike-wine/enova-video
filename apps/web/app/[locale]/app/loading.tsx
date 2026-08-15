import { ContentLoading } from '@/components/application/admin/AdminUi'

/**
 * Next.js App Router loading.tsx：
 * 在个人端子路由切换（RSC 加载 / 代码分包）时自动显示即时 loading。
 * 只替换 AppLayout 的 {children} 区域，不影响 Sidebar。
 */
export default function Loading() {
  return <ContentLoading />
}
