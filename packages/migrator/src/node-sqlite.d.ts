/**
 * node:sqlite 是 Node 22.5+ 的实验性内置模块。
 * 仓库整体使用 @types/node ^20（无该模块类型），这里做最小声明以通过 tsc。
 * 运行时要求：Node >= 22.5（项目已使用 v22.x）。
 */
declare module 'node:sqlite' {
  export interface StatementSync {
    all(...params: unknown[]): Record<string, unknown>[];
    get(...params: unknown[]): Record<string, unknown> | undefined;
  }
  export class DatabaseSync {
    constructor(path: string);
    prepare(sql: string): StatementSync;
    close(): void;
  }
}