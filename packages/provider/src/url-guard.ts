import { domainError, ERROR_CODES } from '@enova/contracts';
import { lookup } from 'node:dns/promises';

/**
 * SSRF 防护：Provider base_url 与生成结果 URL 在请求前必须经过校验。
 *
 * 规则：
 * - 默认仅允许 https://（开发环境可显式允许 http，用于本地 mock）。
 * - 禁止 localhost / 127.0.0.1 / ::1 / 169.254.0.0/16 / 私有内网段。
 * - 可选 DNS 解析后校验所有 A/AAAA 记录（默认开启，测试可关闭）。
 */

export interface UrlGuardOptions {
  /** 生产之外（development/test）允许 http；生产强制 https。 */
  allowHttp: boolean;
  /** 是否做 DNS 解析校验。测试注入本地 host 时建议关闭。 */
  resolveDns: boolean;
  /** 额外允许的 host（仅开发）。 */
  devAllowlist?: string[];
}

const PRIVATE_HOST_GLOBS: Array<{ match: RegExp; reason: string }> = [
  { match: /^localhost$/i, reason: 'localhost' },
  { match: /^127\./i, reason: 'loopback' },
  { match: /^10\./i, reason: 'private-10' },
  { match: /^192\.168\./i, reason: 'private-192.168' },
  { match: /^172\.(1[6-9]|2\d|3[01])\./i, reason: 'private-172.16-31' },
  { match: /^169\.254\./i, reason: 'link-local' },
  { match: /^0\./, reason: 'unspecified' },
  { match: /^::1$/i, reason: 'loopback' },
  { match: /^::$/i, reason: 'unspecified' },
  { match: /^fc|^fd/i, reason: 'unique-local-ipv6' },
  { match: /^fe80/i, reason: 'link-local-ipv6' },
];

function isPrivateIpLiteral(ip: string): string | null {
  for (const g of PRIVATE_HOST_GLOBS) {
    if (g.match.test(ip)) return g.reason;
  }
  return null;
}

function isPrivateHostname(hostname: string): { blocked: boolean; reason?: string } {
  // Node 的 URL.hostname 对 IPv6 保留方括号（如 '[::1]'），先解包再匹配。
  let ip = hostname;
  if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1);
  const reason = isPrivateIpLiteral(ip);
  if (reason) return { blocked: true, reason };
  return { blocked: false };
}

async function isPrivateViaDns(hostname: string): Promise<string | null> {
  let records: string[];
  try {
    const [a, aaaa] = await Promise.allSettled([lookup(hostname, { all: true }), lookup(hostname, { all: true, family: 6 })]);
    records = [];
    for (const r of [a, aaaa]) {
      if (r.status === 'fulfilled') records.push(...r.value.map((x) => x.address));
    }
  } catch {
    // DNS 解析失败：交由 HTTP 层处理，这里不因此直接放行内网；保守起见视为不可解析。
    return null;
  }
  for (const ip of records) {
    const reason = isPrivateIpLiteral(ip);
    if (reason) return reason;
  }
  return null;
}

/**
 * 校验待请求的 URL（Provider base_url 或上游返回的下载 URL）。
 * 不合法时抛出 SSRF_BLOCKED 领域错误。
 */
export async function validateFetchableUrl(url: string, opts: UrlGuardOptions): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw domainError(ERROR_CODES.SSRF_BLOCKED, 'Invalid URL', 400);
  }

  const scheme = parsed.protocol.toLowerCase();
  // 仅允许 https:（开发/测试可额外放行 http:）；其它 scheme（file:、ftp: 等）一律拦截。
  const allowed = scheme === 'https:' || (scheme === 'http:' && opts.allowHttp);
  if (!allowed) {
    throw domainError(ERROR_CODES.SSRF_BLOCKED, `Blocked URL scheme: ${scheme}`, 400);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (opts.devAllowlist?.some((h) => h.toLowerCase() === hostname)) {
    return;
  }

  const literal = isPrivateHostname(hostname);
  if (literal.blocked) {
    throw domainError(ERROR_CODES.SSRF_BLOCKED, `Blocked host: ${hostname} (${literal.reason})`, 400);
  }

  if (opts.resolveDns) {
    const dnsReason = await isPrivateViaDns(hostname);
    if (dnsReason) {
      throw domainError(ERROR_CODES.SSRF_BLOCKED, `Blocked host via DNS: ${hostname} (${dnsReason})`, 400);
    }
  }
}

/** 校验 Provider base_url（管理员配置，Worker 启动时调用）。 */
export async function validateProviderBaseUrl(url: string, opts: UrlGuardOptions): Promise<void> {
  await validateFetchableUrl(url, opts);
}

/**
 * 校验裸 hostname（无 URL scheme），用于 SMTP 等非 HTTP 出站连接。
 *
 * SMTP host 不是完整 URL，不能走 validateFetchableUrl（它会校验 http/https scheme）。
 * 本函数复用同样的私网/链路本地地址拒绝 + DNS 解析后再校验逻辑，但不校验 scheme。
 *
 * 规则：
 * - 禁止 localhost / 127.0.0.1 / ::1 / 169.254.0.0/16 / 私有内网段。
 * - 可选 DNS 解析后校验所有 A/AAAA 记录（默认开启，测试可关闭）。
 * - devAllowlist 仅在非生产环境生效。
 */
export async function validateSmtpHost(hostname: string, opts: UrlGuardOptions): Promise<void> {
  const host = hostname.trim().toLowerCase();
  if (!host) {
    throw domainError(ERROR_CODES.SSRF_BLOCKED, 'SMTP host is empty', 400);
  }

  if (opts.devAllowlist?.some((h) => h.toLowerCase() === host)) {
    return;
  }

  const literal = isPrivateHostname(host);
  if (literal.blocked) {
    throw domainError(ERROR_CODES.SSRF_BLOCKED, `Blocked SMTP host: ${host} (${literal.reason})`, 400);
  }

  if (opts.resolveDns) {
    const dnsReason = await isPrivateViaDns(host);
    if (dnsReason) {
      throw domainError(ERROR_CODES.SSRF_BLOCKED, `Blocked SMTP host via DNS: ${host} (${dnsReason})`, 400);
    }
  }
}