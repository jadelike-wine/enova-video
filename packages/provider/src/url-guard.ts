import { domainError, ERROR_CODES } from '@enova/contracts';
import { lookup } from 'node:dns/promises';

/**
 * SSRF 防护：Provider base_url 与生成结果 URL 在请求前必须经过校验。
 *
 * 规则：
 * - 默认仅允许 https://（开发环境可显式允许 http，用于本地 mock）。
 * - 禁止 localhost / 127.0.0.1 / ::1 / 169.254.0.0/16 / 私有内网段。
 * - 禁止十进制/十六进制/八进制 IP 变体表示的内网地址（BUG-005）。
 * - 禁止 IPv6 mapped IPv4 内网地址（如 ::ffff:127.0.0.1）。
 * - 可选 DNS 解析后校验所有 A/AAAA 记录（默认开启，测试可关闭）。
 */

export interface UrlGuardOptions {
  /** 生产之外（development/test）允许 http；生产强制 https。 */
  allowHttp: boolean;
  /** 是否做 DNS 解析校验。测试注入本地 host 时建议关闭。 */
  resolveDns: boolean;
  /** 额外允许的 host（仅开发）。 */
  devAllowlist?: string[];
  /** 测试注入；生产使用 node:dns/promises.lookup。 */
  dnsLookup?: typeof lookup;
}

const PRIVATE_HOST_GLOBS: Array<{ match: RegExp; reason: string }> = [
  { match: /^localhost$/i, reason: 'localhost' },
  { match: /^127\./i, reason: 'loopback' },
  { match: /^10\./i, reason: 'private-10' },
  { match: /^192\.168\./i, reason: 'private-192.168' },
  { match: /^172\.(1[6-9]|2\d|3[01])\./i, reason: 'private-172.16-31' },
  { match: /^169\.254\./i, reason: 'link-local' },
  { match: /^0\./, reason: 'unspecified' },
  { match: /^0\.0\.0\.0$/i, reason: 'unspecified' },
  { match: /^::1$/i, reason: 'loopback' },
  { match: /^::$/i, reason: 'unspecified' },
  { match: /^fc|^fd/i, reason: 'unique-local-ipv6' },
  { match: /^fe80/i, reason: 'link-local-ipv6' },
  // BUG-005: IPv6 mapped IPv4 内网地址（Node.js URL 会将 ::ffff:127.0.0.1 转为 ::ffff:7f00:1）
  // 这些正则覆盖点分十进制和十六进制两种表示形式。
  { match: /^::ffff:7f/i, reason: 'ipv4-mapped-loopback' },         // ::ffff:127.x.x.x / ::ffff:7f00:1
  { match: /^::ffff:a[0-9a-f]?\.?/i, reason: 'ipv4-mapped-private-10' }, // ::ffff:10.x.x.x / ::ffff:a00:1
  { match: /^::ffff:c0a8/i, reason: 'ipv4-mapped-private-192.168' }, // ::ffff:192.168.x.x / ::ffff:c0a8:1
  { match: /^::ffff:ac1[0-9a-f]/i, reason: 'ipv4-mapped-private-172.16-31' },
  { match: /^::ffff:a9fe/i, reason: 'ipv4-mapped-link-local' },     // ::ffff:169.254.x.x / ::ffff:a9fe:a9fe
  { match: /^::ffff:0/i, reason: 'ipv4-mapped-unspecified' },
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
  // BUG-005: 十进制/十六进制/八进制 IP 变体检测。
  // 例如 2130706433 = 127.0.0.1, 0x7f000001 = 127.0.0.1, 0177.0.0.1 = 127.0.0.1
  const variantReason = checkIpVariant(ip);
  if (variantReason) return { blocked: true, reason: variantReason };
  return { blocked: false };
}

/**
 * BUG-005: 检测十进制/十六进制/八进制 IP 变体是否指向私有/内网地址。
 * - 纯十进制整数（如 2130706433 → 127.0.0.1）
 * - 十六进制（如 0x7f000001 → 127.0.0.1）
 * - 八进制分段（如 0177.0.0.1 → 127.0.0.1）
 * - 混合分段（如 0x7f.0.0.1 → 127.0.0.1）
 *
 * 浏览器和 HTTP 客户端可能将这类变体解析为标准 IP 后发请求，
 * 因此必须在 SSRF guard 层提前拦截。
 */
function checkIpVariant(hostname: string): string | null {
  // 纯十进制整数：尝试转换为 IPv4
  if (/^\d+$/.test(hostname) && hostname.length <= 10) {
    const num = Number(hostname);
    if (num > 0 && num <= 0xffffffff) {
      const ip = longToIpv4(num);
      if (ip) {
        const reason = isPrivateIpLiteral(ip);
        if (reason) return `decimal-ip-${reason} (${hostname}→${ip})`;
      }
    }
    return null;
  }

  // 含十六进制或八进制分段的 IPv4（如 0x7f.0.0.1, 0177.0.0.1, 0x7f.0.0x0.1）
  if (hostname.includes('.') && /0x[0-9a-f]+|^0[0-7]+/i.test(hostname)) {
    const parts = hostname.split('.');
    if (parts.length === 4) {
      const octets: number[] = [];
      for (const part of parts) {
        let val: number;
        if (/^0x[0-9a-f]+$/i.test(part)) {
          val = parseInt(part, 16);
        } else if (/^0[0-7]+$/.test(part) && part.length > 1) {
          val = parseInt(part, 8);
        } else if (/^\d+$/.test(part)) {
          val = parseInt(part, 10);
        } else {
          return null; // 不是 IP 变体
        }
        if (val < 0 || val > 255) return null;
        octets.push(val);
      }
      const ip = octets.join('.');
      const reason = isPrivateIpLiteral(ip);
      if (reason) return `variant-ip-${reason} (${hostname}→${ip})`;
    }
  }

  return null;
}

/** 将 32 位无符号整数转换为点分十进制 IPv4。使用 BigInt 避免 JS 32 位有符号整数溢出。 */
function longToIpv4(num: number): string | null {
  if (!Number.isInteger(num) || num < 0 || num > 0xffffffff) return null;
  const big = BigInt(num);
  return [
    Number((big >> 24n) & 0xffn),
    Number((big >> 16n) & 0xffn),
    Number((big >> 8n) & 0xffn),
    Number(big & 0xffn),
  ].join('.');
}

async function isPrivateViaDns(hostname: string, dnsLookup: typeof lookup = lookup): Promise<string | null> {
  let records: string[];
  try {
    const [a, aaaa] = await Promise.allSettled([dnsLookup(hostname, { all: true }), dnsLookup(hostname, { all: true, family: 6 })]);
    records = [];
    for (const r of [a, aaaa]) {
      if (r.status === 'fulfilled') records.push(...r.value.map((x) => x.address));
    }
  } catch {
    return 'dns-unresolved';
  }
  // Promise.allSettled itself does not reject. If every lookup failed (or
  // returned no address), allowing the later HTTP resolver to try again
  // creates a fail-open DNS-rebinding window.
  if (records.length === 0) return 'dns-unresolved';
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
    const dnsReason = await isPrivateViaDns(hostname, opts.dnsLookup);
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
    const dnsReason = await isPrivateViaDns(host, opts.dnsLookup);
    if (dnsReason) {
      throw domainError(ERROR_CODES.SSRF_BLOCKED, `Blocked SMTP host via DNS: ${host} (${dnsReason})`, 400);
    }
  }
}
