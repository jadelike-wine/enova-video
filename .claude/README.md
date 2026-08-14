# .claude/ — Claude Code Repository Configuration

## Purpose

This directory configures Claude Code's behavior when working in the `enova-video` repository. It contains:

- `settings.local.json` — Permission policy (allowlist / denylist) for shell commands that Claude Code may execute without asking for confirmation each time.

## Permission Policy

### Allowlist principles

Only **read-only, test, lint, format, build, git inspection, and local dev** commands belong in the allowlist. The current allowlist covers:

| Category | Examples |
|----------|----------|
| Lint / Typecheck | `pnpm lint`, `pnpm typecheck`, `pnpm --filter <pkg> lint` |
| Tests | `pnpm test`, `pnpm test:*`, `pnpm --filter <pkg> test` |
| Build | `pnpm build`, `pnpm --filter <pkg> build` |
| Local dev | `pnpm dev:api`, `pnpm dev:worker`, `pnpm --filter @enova/web dev` |
| DB / SDK codegen | `pnpm db:generate`, `pnpm db:migrate`, `pnpm sdk:generate` |
| Git inspection (read-only) | `git status`, `git diff`, `git log`, `git show`, `git branch`, `git tag --list` |
| Docker compose validation | `docker compose -f docker-compose.dev.yml config -q`, `ps` |

### Denylist principles

Commands that are **destructive, irreversible, or touch production** must never be auto-approved:

| Forbidden category | Examples |
|--------------------|----------|
| Destructive filesystem | `rm -rf /`, `rm -rf ~` |
| Production deployment | `./scripts/update.sh`, `./scripts/rollback.sh` |
| Production compose stop/down | `docker compose -f docker-compose.prod.yml down/stop` |
| Database restore / deletion | `./scripts/backup.sh --restore`, `psql` (direct) |
| Redis flush | `redis-cli flushall`, `redis-cli flushdb` |

### Before modifying permissions

An agent should check:

1. **Does the command touch production?** If yes, do not add it to the allowlist.
2. **Is the command irreversible?** If yes, do not add it.
3. **Does the command read secrets?** If yes, do not add it.
4. **Is the command already covered by an existing allow entry?** Avoid duplicates.
5. **Does the command match the repo's actual tech stack?** This repo uses `pnpm`, `vitest`, `drizzle`, `bullmq`, and `docker compose` — not `npm`, `yarn`, `jest`, or `mocha`.

## Repo-specific skills

No repo-level skills are currently defined in this directory. Skills should only be added when they solve a **repeated, high-value workflow** that is specific to this repository. Candidate areas (if future need arises):

- Video pipeline debugging (worker → provider → polling → storage → settle)
- Billing reconciliation verification (reserve / settle / release idempotency checks)
- Release validation (VERSION → tag → GHCR images → health check)

Do not create skills just to fill the directory.
