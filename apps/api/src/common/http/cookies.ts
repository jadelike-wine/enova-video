/**
 * 轻量 Cookie 解析（Fastify @fastify/cookie 已注册，但守卫/控制器统一走纯函数，
 * 便于单测与复用）。仅关注我们使用的 session cookie。
 */

/** 从 Cookie 头解析出指定 key 的值，未找到返回 undefined。 */
export function parseCookie(cookieHeader: string | undefined, key: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === key) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return undefined;
}