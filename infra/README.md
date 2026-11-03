# CivicScope on AWS

The AWS CDK app in this folder creates everything CivicScope needs in `us-east-1`:

| Part             | What it is                                                                                                                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Network          | A VPC across two zones: public subnets (NAT only), app subnets, isolated database subnets                                                                                                            |
| Database         | RDS MySQL 8.4, `db.t4g.small`, encrypted, TLS required, Multi-AZ (`multiAz` context), 14 days of point-in-time backups, plus a monthly AWS Backup copy kept for a year. Deletion protection is on    |
| Site             | Next.js on ECS Fargate (2 to 6 tasks), behind a **private** load balancer that only CloudFront can reach (VPC origin)                                                                                |
| CDN and firewall | CloudFront with AWS WAF: Amazon IP reputation, common rules, known bad inputs, SQL injection, and per-IP rate limits (admin 300, search 600, everything 3,000 per 5 minutes)                         |
| Jobs             | The worker image runs on a schedule: FEC daily, Congress daily, legislators weekly, and an hourly check for failed or stuck ingests                                                                  |
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
   characters, for the first owner). Never change these placeholders in the code afterwards.
5. Deploy the images, then prepare the database:
   ```sh
   pnpm exec cdk deploy -c civicscope:imageTag=$TAG
   ./run-task.sh migrate
   ./run-task.sh admin db:seed
   ./run-task.sh admin admin:create-user --email you@example.com --name "Your Name" --role owner
   ```
   Then set `BOOTSTRAP_ADMIN_PASSWORD` back to `unset`, sign in and set up two-step sign-in.
6. Confirm the email from SNS so alarms reach you.

## Every deploy

Commit, open Docker Desktop, then run `infra/deploy.sh`. It builds and uploads both images
tagged with the commit, deploys them, and runs `./run-task.sh migrate`. ECS replaces web tasks
one at a time and rolls back on its own if the new ones fail their health check. Migrations
run right after the new site starts, so a release that adds a column can show errors on the
pages that use it for a minute or two.

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
