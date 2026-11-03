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

You need an AWS account, the AWS CLI signed in, and Docker.

1. Set the context in `cdk.json`: at least `civicscope:alertEmail`. For a custom domain, request an
   ACM certificate **in us-east-1**, then set `civicscope:domainName` and `civicscope:certificateArn`.
   Set `civicscope:multiAz` to `false` while building to halve the database cost.
2. Bootstrap CDK once per account: `pnpm --filter @civicscope/infra exec cdk bootstrap`.
3. Create the image repositories and everything else. The web service can't start until an image
   exists, so the first deploy creates the repositories first:
   ```sh
   cd infra
   pnpm exec cdk deploy --exclusively CivicScope   # stops waiting on the service; that's expected the first time
   ```
   If the first deploy waits too long on the web service, push the images (step 4) and it finishes.
4. Build and push the images, tagged with the git commit:
   ```sh
   TAG=$(git rev-parse --short HEAD)
   ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
   REGISTRY=$ACCOUNT.dkr.ecr.us-east-1.amazonaws.com
   aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin $REGISTRY
   docker build --platform linux/amd64 --target web -t $REGISTRY/civicscope-web:$TAG .
   docker build --platform linux/amd64 --target worker -t $REGISTRY/civicscope-worker:$TAG .
   docker push $REGISTRY/civicscope-web:$TAG && docker push $REGISTRY/civicscope-worker:$TAG
   ```
5. Fill in the app secret (the `AppSecretArn` output) in the Secrets Manager console:
   `AUTH_ENCRYPTION_KEY` (`openssl rand -base64 32`, and keep a copy somewhere safe: losing it
   means every admin re-enrols their authenticator app), `FEC_API_KEY`, `CONGRESS_API_KEY`, and
   optionally `ALERT_WEBHOOK_URL` (an https Slack-style webhook). Leave the field names as they are.
6. Deploy with the tag, run migrations, then load the reference data and the first owner:
   ```sh
   pnpm exec cdk deploy -c civicscope:imageTag=$TAG
   ./run-task.sh migrate                     # schema, plus the app account and its grants
   ./run-task.sh admin db:seed               # the 50 states, DC and the issue list
   ```
   For the first owner, put a password of 12 or more characters in the app secret's
   `BOOTSTRAP_ADMIN_PASSWORD` field, then:
   ```sh
   ./run-task.sh admin admin:create-user -- --email you@example.com --name "Your Name" --role owner
   ```
   Sign in, set up two-step sign-in, then set `BOOTSTRAP_ADMIN_PASSWORD` back to `unset`.
7. Confirm the email from SNS so alarms reach you.

## Every deploy

Build and push both images with a new tag (step 4), run `./run-task.sh migrate` with the new
worker image, then `pnpm exec cdk deploy -c civicscope:imageTag=$TAG`. ECS replaces web tasks one
at a time and rolls back on its own if the new ones fail their health check.

## Backup restore drill

Do this before launch and then every three months. It proves the backups work and how long a
restore takes.

1. In the RDS console, pick the database, **Actions → Restore to point in time**, latest restorable
   time. Name it `civicscope-drill`, same subnet group and security group, Single-AZ.
2. Run the check against it from the worker (it reads `RESTORE_DATABASE_URL`):
   ```sh
   ./run-task.sh drill db:verify-restore --target "mysql://civicscope_admin:<password>@<drill endpoint>/civicscope?ssl={\"rejectUnauthorized\":true}"
   ```
   It checks every migration is present, the key tables have rows, and no published entry has lost
   its citations, and prints row counts and the newest audit entry.
3. Write down the date, the restore time and the result in `docs/restore-drills.md`.
4. Delete `civicscope-drill` (skip the final snapshot).

`pnpm test` also runs the same check on every commit against a local dump and restore
(`packages/db/test/restore.integration.test.ts`).

## Costs, roughly

The fixed monthly cost with Multi-AZ is a little under $200: the database (about $50, double with
Multi-AZ), two web tasks (about $35), the NAT gateway (about $35), the load balancer (about $20),
WAF (about $10 plus requests) and CloudFront traffic. Single-AZ while building saves about $25.
