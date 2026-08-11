#!/usr/bin/env node
import { migrateSqliteToPg } from './migrate.js';

/**
 * SQLite → Postgres 迁移 CLI。
 *
 * 用法：
 *   node dist/cli.js --sqlite <path> [--database-url <url>] [--email <email>] [--execute]
 *
 * 默认 dry-run（只统计不写库），确认无误后加 --execute 真正写入。
 * 也支持环境变量：SQLITE_PATH / DATABASE_URL / LEGACY_MIGRATION_EMAIL。
 */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const sqlitePath = arg('sqlite') ?? process.env.SQLITE_PATH;
  const databaseUrl = arg('database-url') ?? process.env.DATABASE_URL;
  const email = arg('email') ?? process.env.LEGACY_MIGRATION_EMAIL;
  const execute = process.argv.includes('--execute');

  if (!sqlitePath) {
    console.error('Missing SQLite path. Usage: node dist/cli.js --sqlite <path> [--execute]');
    process.exit(1);
  }
  if (!databaseUrl) {
    console.error('Missing DATABASE_URL (--database-url or env).');
    process.exit(1);
  }

  console.log(
    `Migrating SQLite → Postgres (${execute ? 'EXECUTE mode' : 'DRY-RUN mode'})\n` +
      `  sqlite : ${sqlitePath}\n  pg     : ${databaseUrl}\n  email  : ${email ?? 'legacy@localhost'}`,
  );

  const report = await migrateSqliteToPg({ sqlitePath, databaseUrl, email, execute });

  console.log('\nMigration report:');
  console.log(`  Holder user email : ${report.email}`);
  console.log(`  Workspace         : ${report.workspaceId}`);
  console.log(`  Conversations     : ${report.conversations}`);
  console.log(`  Messages          : ${report.messages}`);
  console.log(`  Image jobs        : ${report.imageJobs}`);
  console.log(`  Video jobs        : ${report.videoJobs}`);
  console.log(`  Uploads           : ${report.uploads}`);
  console.log(`  Skipped (dup)     : ${report.skipped}`);
  console.log(`  Executed          : ${report.executed}`);

  if (!report.executed) {
    console.log('\nDry-run complete. Re-run with --execute to write to Postgres.');
  }
}

void main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});