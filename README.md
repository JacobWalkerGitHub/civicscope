# CivicScope

A nonpartisan, source-backed directory of candidates for federal and state office.

**Status:** Phase 1 (admin CMS) in progress. No candidate data yet.

## Requirements

- Node.js 22 (`.nvmrc`), pnpm 10 (`corepack enable`)
- Docker (local MySQL and integration tests)

## Getting started

```sh
pnpm install
cp .env.example .env
docker compose up -d mysql
pnpm db:migrate
pnpm db:seed        # 50 states + DC from Census codes; safe to re-run
pnpm admin:create-user --email you@example.com --name "Your Name" --role owner
pnpm dev            # http://localhost:3000, admin at http://localhost:3000/admin
```

Scripts and `pnpm dev` read `.env` automatically. `admin:create-user` asks for a password (12+ characters). Roles: `owner` (everything,
including users), `reviewer` (edit, verify, publish), `editor` (draft only), `viewer`
(read-only).

## Common commands

| Command                                        | What it does                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| `pnpm test`                                    | Unit tests and MySQL integration tests (starts a MySQL container)  |
| `pnpm test:unit`                               | Unit tests only, no Docker needed                                  |
| `pnpm lint` / `pnpm typecheck` / `pnpm format` | Code quality                                                       |
| `pnpm db:generate --name <change>`             | Create a migration after editing `packages/db/src/schema`          |
| `pnpm ingest:fec 2028`                         | Import FEC candidate registrations (needs `FEC_API_KEY`)           |
| `pnpm ingest:fec-totals 2026 2028`             | Import FEC money totals for people in races (needs `FEC_API_KEY`)  |
| `pnpm ingest:legislators`                      | Match Members of Congress to people by Bioguide/FEC/Wikidata IDs   |
| `pnpm ingest:congress 119`                     | Import members, bills, House and Senate votes (`CONGRESS_API_KEY`) |
| `pnpm ingest:openstates`                       | Import state legislators and their votes (`OPENSTATES_API_KEY`)    |
| `pnpm ingest:state-officials [--states VA,NJ]` | Import governors and state legislators in office (no key needed)   |
| `pnpm data:calendar --as you@example.com`      | Load the reviewed 2027 election calendar (drafts, dates, links)    |
| `pnpm check:congress-votes [--chamber senate]` | Spot-check a random sample of imported House (or Senate) votes     |
| `pnpm check:ingest`                            | Alert on ingest runs that failed or are stuck (hourly in AWS)      |
| `pnpm db:verify-restore --target <url>`        | Check a restored database copy (backup restore drill)              |
| `pnpm test:load --url <site>`                  | Load-test the public pages of a site you run                       |

## Layout

```
apps/web          Next.js app: public site, admin CMS (later), API
packages/core     Shared enums, domain rules, validation schemas, role permissions
packages/auth     Admin passwords, sessions, sign-in lockout
packages/db       Drizzle schema, migrations, seed data
docs/adr          Architecture decision records
infra             AWS CDK app and deploy runbook (see infra/README.md)
```

See `docs/adr/0001-foundation-choices.md` for why things are the way they are.

Public sections: Elections, Politicians (`/politicians` lists Members of Congress in office,
`/politicians/<bioguide>` their bills and votes, `/politicians/state` governors and state
legislators in office from Open States, with a page each at `/politicians/state/<id>`, `/politicians/candidates` every candidate in
every election with won/lost filters), Bills (`/bills`, with a page per bill at
`/bills/<congress>/<type>/<number>`), Issues and My ballot. Bill summaries are the Congressional
Research Service's; a bill's status label is worked out from its latest action (see
`billStage` in `packages/core/src/congress.ts`). Live election-night results were removed; their
database tables are kept, unused, until a later migration drops them.

Public pages include `/search` (candidates, races, issues and entry text), `/issues`, and a
side-by-side comparison for each race at `/races/<id>/compare` (see ADR 0009). Candidate profiles
show each campaign promise beside the bills and votes an editor linked to it (see ADR 0003).
