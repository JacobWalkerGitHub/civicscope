# ADR 0005: Separate database accounts for migrations and the app

Status: accepted (Phase 1, part 7)

## Context

The audit log, revisions and candidacy status history must never be rewritten. Triggers
(migrations 0001, 0004, 0006) already reject UPDATE and DELETE on those tables, but a
trigger can be dropped by any account allowed to change the schema.

## Decisions

- **Two accounts.** Migrations run as the schema owner. The web app connects as a
  separate least-privilege account (`APP_DB_USER`, for example `civicscope_app`).
- **What the app account can do.** SELECT, INSERT, UPDATE and DELETE on content tables;
  only SELECT and INSERT on `audit_log`, `revision` and `candidacy_status_event`; no
  access to `__drizzle_migrations`; no CREATE, ALTER, DROP or trigger privileges.
- **Grants are rebuilt after every migration.** `pnpm db:migrate` calls
  `applyAppGrants` when `APP_DB_USER` is set: it revokes everything and grants
  table by table from `information_schema`, so new tables are covered and stale
  grants disappear. It can also set or rotate the password (`APP_DB_PASSWORD`).
- **Tested both ways.** An integration test connects as the app account and checks
  the denials; the end-to-end suite runs the whole admin app as that account.

## Consequences

In production the migration task gets the owner's credentials and the web service
gets only the app account's. The host part (`APP_DB_HOST`) should be the VPC range
rather than `%` once the infrastructure exists. Locally, development keeps one account.
