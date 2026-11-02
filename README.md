# CivicScope

A nonpartisan, source-backed directory of candidates for federal and state office.

**Status:** Phase 0 (foundations). No candidate data yet.

## Requirements

- Node.js 22 (`.nvmrc`), pnpm 10 (`corepack enable`)
- Docker (local MySQL and integration tests)

## Getting started

```sh
pnpm install
cp .env.example .env
docker compose up -d mysql
set -a; . ./.env; set +a
pnpm db:migrate
pnpm db:seed        # 50 states + DC from Census codes; safe to re-run
pnpm dev            # http://localhost:3000
```

## Common commands

| Command                                        | What it does                                                      |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| `pnpm test`                                    | Unit tests and MySQL integration tests (starts a MySQL container) |
| `pnpm test:unit`                               | Unit tests only, no Docker needed                                 |
| `pnpm lint` / `pnpm typecheck` / `pnpm format` | Code quality                                                      |
| `pnpm db:generate --name <change>`             | Create a migration after editing `packages/db/src/schema`         |

## Layout

```
apps/web          Next.js app: public site, admin CMS (later), API
packages/core     Shared enums, domain rules, validation schemas
packages/db       Drizzle schema, migrations, seed data
docs/adr          Architecture decision records
```

See `docs/adr/0001-foundation-choices.md` for why things are the way they are.
