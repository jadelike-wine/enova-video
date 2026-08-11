import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate as drizzleMigrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

/**
 * 运行时数据库迁移入口（供容器启动前调用）。
 * 用法：node dist/migrate.js <DATABASE_URL> [migrationsFolder]
 * 迁移文件默认位于 packages/db/drizzle；支持通过第二个参数显式传入，
 * 便于容器启动时指向已复制到镜像内的迁移目录。
 */
export async function runMigrations(
  connectionString: string,
  migrationsFolder = process.env.DRIZZLE_MIGRATIONS_PATH ?? `${__dirname}/../drizzle`,
): Promise<void> {
  const pool = new Pool({ connectionString });
  const db = drizzle(pool);
  await drizzleMigrate(db, { migrationsFolder });
  await pool.end();
}

// 直接执行脚本时（node dist/migrate.js DATABASE_URL [migrationsFolder]）
const directUrl = process.argv[2];
if (directUrl && require.main === module) {
  runMigrations(directUrl, process.argv[3])
    .then(() => {
      console.log('migrations applied');
      process.exit(0);
    })
    .catch((err) => {
      console.error('migration failed', err);
      process.exit(1);
    });
}