import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

export type Database = ReturnType<typeof createDb>;

/** 创建数据库实例。生产环境传入可选已池化的 Pool。 */
export function createDb(connectionString: string) {
  return drizzle(new Pool({ connectionString }), { schema });
}

/** 从现有 Pool 创建（供 NestJS 生命周期共享连接）。 */
export function createDbFromPool(pool: Pool) {
  return drizzle(pool, { schema });
}

export { schema };
export * from './schema.js';
export * from './settings-registry.js';
export * from './settings-store.js';