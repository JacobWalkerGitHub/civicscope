# ADR 0010: Launch hardening and AWS hosting

Status: accepted (Phase 6)

## Context

Phase 6 makes CivicScope safe to launch: a security review, a firewall, a tested way to
restore backups, alarms (including when an ingest fails), a load test and a written correction
policy. Jacob chose AWS (ECS, RDS, CloudFront) over Vercel, as ADR 0001 proposed.

## Decisions

- **One CDK stack in us-east-1** (`infra/`). CloudFront's WAF must be in us-east-1, and one
  region keeps it to one deploy. See `infra/README.md` for what it creates and the runbooks.
- **The load balancer is private.** CloudFront reaches it through a VPC origin, so the WAF
  can't be bypassed by calling the load balancer directly. CloudFront forwards the viewer's Host
  header, which Next.js server actions need for their origin check.
- **Two images from one Dockerfile.** `web` is the Next.js standalone server; `worker` is the
  whole workspace and runs `pnpm` scripts (migrations, ingests, checks) as ECS tasks.
- **Two database accounts in production, as in ADR 0005.** The site and the ingests use the
  least-privilege account; only the migrate task uses the schema owner, and it refreshes the
  app account's grants each time. The database requires TLS; the images trust the RDS
  certificate authorities.
- **Alerts work on any host.** Code raises an alert as one JSON log line
  (`"event":"civicscope_alert"`) and, if `ALERT_WEBHOOK_URL` is set, a webhook post. In AWS a
  log metric filter turns the line into an alarm, and a separate rule catches worker tasks that
  exit with an error before they can log. `pnpm check:ingest` (hourly) catches runs that failed
  or are stuck "running".
- **The restore drill is a script plus a runbook.** `pnpm db:verify-restore` checks a restored
  copy (migrations, key tables, no published entry without a citation) and can compare it table
  by table with the original. CI runs the full drill on every commit against a local
  mysqldump; in AWS it runs against a point-in-time restore every three months.
- **Client IPs are read from the right of X-Forwarded-For**, counting `TRUSTED_PROXY_COUNT`
  proxies, so rate limits can't be dodged with a fake header.
- **CSP with inline scripts allowed**, until pages move to nonces (see the security review).
- **The correction policy is on the Corrections page**, where people report mistakes.

## Consequences

- About $200 a month with Multi-AZ before traffic. Single-AZ while building saves about $25.
- First load test (one local server, no CDN, 20 workers, 30 s): 50 requests/s, p95 740 ms,
  no errors. Production has at least two tasks and autoscaling; run `pnpm test:load` against
  the deployed site before launch.
- Deploys are manual (`infra/README.md`). A GitHub Actions deploy with OIDC is a follow-up once
  the AWS account exists.
