/**
 * 语义化版本比较（纯函数，无依赖）。
 * 支持 3 段 / 4 段（major.minor.patch[.build]），缺段按 0 处理。
 * 返回：a > b → 1；a === b → 0；a < b → -1。
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 4; i++) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

function parseVersion(v: string): number[] {
  const parts = v.replace(/^v/i, '').split('.');
  const out = [0, 0, 0, 0];
  for (let i = 0; i < parts.length && i < 4; i++) {
    const n = Number(parts[i]);
    if (Number.isFinite(n)) out[i] = n;
  }
  return out;
}

/** 去 v 前缀。 */
export function normalizeVersion(v: string): string {
  return v.replace(/^v/i, '');
}