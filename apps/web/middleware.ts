import createMiddleware from 'next-intl/middleware'
import { routing } from './i18n.config'

export default createMiddleware(routing)

export const config = {
  // Match all paths except for:
  // - API routes (rewrites to backend)
  // - Next.js internals (_next, _vercel)
  // - Static files (with extensions)
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
}
