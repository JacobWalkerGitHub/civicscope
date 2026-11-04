# CivicScope on AWS

The AWS CDK app in this folder creates everything CivicScope needs in `us-east-1`:

| Part             | What it is                                                                                                                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Network          | A VPC across two zones: public subnets (NAT only), app subnets, isolated database subnets                                                                                                            |
| Database         | RDS MySQL 8.4, `db.t4g.small`, encrypted, TLS required, Multi-AZ (`multiAz` context), 14 days of point-in-time backups, plus a monthly AWS Backup copy kept for a year. Deletion protection is on    |
| Site             | Next.js on ECS Fargate (2 to 6 tasks), behind a **private** load balancer that only CloudFront can reach (VPC origin)                                                                                |
| CDN and firewall | CloudFront with AWS WAF: Amazon IP reputation, common rules, known bad inputs, SQL injection, and per-IP rate limits (sign-in 100, search 600, everything 3,000 per 5 minutes)                       |
| Jobs             | The worker image runs on a schedule: FEC daily, Congress daily, legislators weekly, an hourly check for failed or stuck ingests, and daily follow alerts (once turned on)                            |
| Alarms           | One SNS topic (emailed to `alertEmail`): an ingest alert in the logs, a worker task that exits with an error, site 5xx errors, an unhealthy web task, high web or database CPU, low database storage |
| Secrets          | Secrets Manager: the database owner, the least-privilege app account, and an app secret for keys                                                                                                     |

## First deploy

A step-by-step version for a Mac, naming the app for each step, is in the project's
"CivicScope AWS setup guide" doc. In short:

1. Put your own settings in `~/.cdk.json` in your home folder, so your email stays out of
   this public repository:
   ```json
   { "context": { "civicscope:alertEmail": "you@example.com" } }
   ```
   Add `civicscope:domainName` and `civicscope:certificateArn` (an ACM certificate in us-east-1)
   for a custom domain. Run `pnpm exec cdk bootstrap` once per account.
2. `pnpm exec cdk deploy` with the default `imageTag` of `bootstrap`. That creates everything,
   including the image repositories, but runs nothing: no web tasks and no schedules.
3. Build and push both images, tagged with the git commit:
   ```sh
   TAG=$(git rev-parse --short HEAD)
   REGISTRY=$(aws sts get-caller-identity --query Account --output text).dkr.ecr.us-east-1.amazonaws.com
   aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin $REGISTRY
   docker build --platform linux/amd64 --target web -t $REGISTRY/civicscope-web:$TAG .
   docker build --platform linux/amd64 --target worker -t $REGISTRY/civicscope-worker:$TAG .
   docker push $REGISTRY/civicscope-web:$TAG && docker push $REGISTRY/civicscope-worker:$TAG
   ```
4. Fill in the app secret (`AppSecretArn` output): `AUTH_ENCRYPTION_KEY` (`openssl rand -base64 32`,
   and keep a copy: losing it means every admin re-enrols their authenticator app), `FEC_API_KEY`,
   `CONGRESS_API_KEY`, optionally `ALERT_WEBHOOK_URL`, and `BOOTSTRAP_ADMIN_PASSWORD` (12+
   characters, for the first owner). Never change these placeholders in the code afterwards. Keys
   added later (`OPENSTATES_API_KEY`) are added to the secret by hand in the console, before
   the deploy that first reads them.
5. Put the images in place with the site still off, migrate, then turn the site on
   (`infra/deploy.sh` does these three steps by itself whenever the site isn't running yet).
   The web tasks' health check needs the database, so they can't start before the migration:
   ```sh
   pnpm exec cdk deploy -c civicscope:imageTag=$TAG -c civicscope:paused=true
   ./run-task.sh migrate
   pnpm exec cdk deploy -c civicscope:imageTag=$TAG
   ./run-task.sh admin db:seed
   ./run-task.sh admin admin:create-user --email you@example.com --name "Your Name" --role owner
   ```
   Then set `BOOTSTRAP_ADMIN_PASSWORD` back to `unset`, sign in and set up two-step sign-in.
6. Confirm the email from SNS so alarms reach you.

## Running an import now

The imports run on their schedules by themselves. To run one now (after changing an API key,
say), open **Actions → Run import → Run workflow** on GitHub and pick it: Congress, FEC, FEC
totals, legislators, Open States, or the ingest check. It starts the same worker task as the
schedule, with the same arguments, and fails if the import does. The import's own output is
in CloudWatch, in the worker tasks' log group. From a Mac, `./run-task.sh admin ingest:congress 119`
does the same.

## Every deploy

Merge to `main` (see [Deploying from GitHub](#deploying-from-github)), or commit, open
Docker Desktop, then run `infra/deploy.sh`. It builds and uploads both images
tagged with the commit, deploys them, and runs `./run-task.sh migrate`. ECS replaces web tasks
one at a time and rolls back on its own if the new ones fail their health check. Migrations
run right after the new site starts, so a release that adds a column can show errors on the
pages that use it for a minute or two.

## Deploying from GitHub

Once this is set up, merging a pull request into `main` deploys it: after CI passes on
`main`, the Deploy workflow (`.github/workflows/deploy.yml`) runs `infra/deploy.sh` on a
GitHub runner. That works from a phone, with no Docker or Mac needed. To redeploy by hand,
use **Actions → Deploy → Run workflow**. Until the setup is done, the workflow skips itself.

One-time setup:

1. In the AWS console (us-east-1), open **CloudShell** (the `>_` icon at the top) and run:
   ```sh
   curl -fsSLO https://raw.githubusercontent.com/JacobWalkerGitHub/civicscope/main/infra/setup-github-deploy.sh
   bash setup-github-deploy.sh
   ```
   It lets this repository's `production` environment sign in to AWS as the role
   `civicscope-github-deploy`, which can only do what `deploy.sh` does. GitHub stores no
   AWS keys.
2. On GitHub, open **Settings → Secrets and variables → Actions** and add what the script
   prints: the `AWS_DEPLOY_ROLE_ARN` variable, the `CIVICSCOPE_ALERT_EMAIL` secret, and, if
   the site has its own domain, the `CIVICSCOPE_DOMAIN_NAME` and `CIVICSCOPE_CERTIFICATE_ARN`
   variables. These replace `~/.cdk.json` for GitHub deploys. If the live site emails alarms
   or uses a custom domain and the matching setting is missing, the deploy stops before
   changing anything, so an alarm email or domain is never dropped by mistake.
3. Optional: under **Settings → Environments → production**, add yourself as a required
   reviewer if you want to approve each deploy before it runs.

Deploying from a Mac with `infra/deploy.sh` keeps working as before.

## Email alerts for followers

Readers can follow a Member of Congress or a bill and get an email when something new is
recorded. Emails go through Amazon SES. Until the steps below are done, the feature is off
and the **Get email updates** buttons are hidden, so merging the code changes nothing.

1. **Verify the sending domain in SES.** In the AWS console (us-east-1), open **Amazon SES →
   Identities → Create identity → Domain**, enter the site's domain (e.g. `civicscope.org`)
   and keep **Easy DKIM** on. Add the DNS records it shows at your domain registrar (or
   let it add them, if the domain is in Route 53). Wait for the identity to show
   **Verified** (minutes to a few hours). Optional but recommended: set a **custom MAIL FROM
   domain** (e.g. `mail.civicscope.org`) on the same page, and add a DMARC record
   (`_dmarc` TXT, `v=DMARC1; p=none;`) so mail providers trust the emails.
2. **Leave the SES sandbox.** New accounts can only email addresses they have verified.
   Open **SES → Account dashboard → Request production access**: mail type
   _Transactional_, website the site's address, and describe the use: "Readers opt in
   with double opt-in to follow a politician or bill; at most one email a day; every
   email has one-click unsubscribe; bounces and complaints are monitored." AWS usually
   answers within a day. Until then, you can test with an address you verify under
   **Identities**.
3. **Turn it on.** On GitHub, under **Settings → Secrets and variables → Actions →
   Variables**, add `CIVICSCOPE_ALERTS_FROM_EMAIL` with the sending address (e.g.
   `alerts@civicscope.org`; any address at the verified domain, no mailbox needed). For
   deploys from a Mac, add `"civicscope:alertsFromEmail": "alerts@civicscope.org"` to
   `~/.cdk.json`. Then redeploy (**Actions → Deploy → Run workflow**).

The deploy gives the web tasks and the `FollowAlertsDaily` job (15:00 UTC, after the
imports) permission to send from that one address only, and sets `SITE_URL` for the links.
Run it by hand with `./run-task.sh admin alerts:send`. The emails' links are signed with
`AUTH_ENCRYPTION_KEY`, so changing that key retires the links in emails already sent.

## Backup restore drill

Before launch, then every three months:

1. RDS console: the database → **Actions → Restore to point in time** → latest restorable time.
   Name it `civicscope-drill`, Single-AZ, same subnet group and the database's security group.
2. When it's available, copy its endpoint and run `./run-task.sh drill <endpoint>`. It runs
   `pnpm db:verify-restore --host <endpoint>` as the schema owner: every migration present, key
   tables with rows, no published entry without its citations, plus row counts and the newest
   audit entry in the logs.
3. Note the date, how long the restore took and the result in `docs/restore-drills.md`.
4. Delete `civicscope-drill` (no final snapshot).

`pnpm test` also runs a full dump-and-restore drill locally on every commit
(`packages/db/test/restore.integration.test.ts`).

## Costs, roughly

The fixed monthly cost with Multi-AZ is a little under $200: the database (about $50, double with
Multi-AZ), two web tasks (about $35), the NAT gateway (about $35), the load balancer (about $20),
WAF (about $10 plus requests) and CloudFront traffic. Single-AZ while building saves about $25.
