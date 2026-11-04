#!/usr/bin/env bash
# One-time setup that lets GitHub Actions deploy CivicScope (.github/workflows/deploy.yml).
# Run it in AWS CloudShell (the >_ icon in the AWS console, us-east-1), signed in as an admin:
#   curl -fsSLO https://raw.githubusercontent.com/JacobWalkerGitHub/civicscope/main/infra/setup-github-deploy.sh
#   bash setup-github-deploy.sh
# It creates, or updates if they exist:
#   - GitHub's sign-in provider in this AWS account (OIDC), so no AWS keys are stored in GitHub
#   - the role civicscope-github-deploy, which only this repository's "production"
#     environment can use, and which can only do what infra/deploy.sh does
# Safe to run again. If the Deploy workflow's "Show the identity AWS will see" step prints a
# different sub than the default below, run it again with that value:
#   SUB='repo:...' bash setup-github-deploy.sh
set -euo pipefail
REPO=${REPO:-JacobWalkerGitHub/civicscope}
# GitHub names this repository by owner and repository ID as well as by name in the
# token's subject (owner@id/repo@id), so a renamed account or repository can't inherit it.
SUB=${SUB:-repo:JacobWalkerGitHub@127368369/civicscope@1443265880:environment:production}
ROLE=civicscope-github-deploy
REGION=us-east-1
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
PROVIDER_ARN=arn:aws:iam::$ACCOUNT:oidc-provider/token.actions.githubusercontent.com

if ! aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$PROVIDER_ARN" >/dev/null 2>&1; then
  echo "Adding GitHub as a sign-in provider..."
  aws iam create-open-id-connect-provider \
    --url https://token.actions.githubusercontent.com \
    --client-id-list sts.amazonaws.com >/dev/null
else
  # A provider made earlier by something else may not accept AWS sign-ins yet.
  aws iam add-client-id-to-open-id-connect-provider \
    --open-id-connect-provider-arn "$PROVIDER_ARN" --client-id sts.amazonaws.com 2>/dev/null || true
fi

trust=$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "$PROVIDER_ARN" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
      "StringEqualsIgnoreCase": { "token.actions.githubusercontent.com:sub": "$SUB" }
    }
  }]
}
JSON
)

# What infra/deploy.sh and infra/run-task.sh need, and nothing else. CloudFormation changes
# themselves go through the roles `cdk bootstrap` created, as they do from a Mac.
policy=$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "CdkBootstrapRoles", "Effect": "Allow", "Action": "sts:AssumeRole",
      "Resource": "arn:aws:iam::$ACCOUNT:role/cdk-hnb659fds-*-$ACCOUNT-$REGION" },
    { "Sid": "EcrSignIn", "Effect": "Allow", "Action": "ecr:GetAuthorizationToken", "Resource": "*" },
    { "Sid": "EcrPush", "Effect": "Allow",
      "Action": ["ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:CompleteLayerUpload",
                 "ecr:InitiateLayerUpload", "ecr:PutImage", "ecr:UploadLayerPart"],
      "Resource": "arn:aws:ecr:$REGION:$ACCOUNT:repository/civicscope-*" },
    { "Sid": "ReadStack", "Effect": "Allow", "Action": "cloudformation:DescribeStacks",
      "Resource": "arn:aws:cloudformation:$REGION:$ACCOUNT:stack/CivicScope/*" },
    { "Sid": "RunMigrations", "Effect": "Allow",
      "Action": ["ecs:DescribeServices", "ecs:DescribeTasks", "ecs:RunTask"], "Resource": "*" },
    { "Sid": "PassTaskRoles", "Effect": "Allow", "Action": "iam:PassRole",
      "Resource": "arn:aws:iam::$ACCOUNT:role/CivicScope-*",
      "Condition": { "StringEquals": { "iam:PassedToService": "ecs-tasks.amazonaws.com" } } },
    { "Sid": "CheckAlarmEmail", "Effect": "Allow", "Action": "sns:ListSubscriptionsByTopic",
      "Resource": "arn:aws:sns:$REGION:$ACCOUNT:*" }
  ]
}
JSON
)

if aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  echo "Updating the role $ROLE (GitHub identity: $SUB)..."
  aws iam update-assume-role-policy --role-name "$ROLE" --policy-document "$trust"
else
  echo "Creating the role $ROLE (GitHub identity: $SUB)..."
  aws iam create-role --role-name "$ROLE" --assume-role-policy-document "$trust" \
    --description "GitHub Actions deploys of CivicScope from $REPO" >/dev/null
fi
aws iam put-role-policy --role-name "$ROLE" --policy-name deploy --policy-document "$policy"

cat <<EOF

Done. Now, on GitHub: $REPO → Settings → Secrets and variables → Actions.
  Variables tab, New repository variable:
    AWS_DEPLOY_ROLE_ARN = arn:aws:iam::$ACCOUNT:role/$ROLE
  Secrets tab, New repository secret:
    CIVICSCOPE_ALERT_EMAIL = the email in your ~/.cdk.json (where alarms go)
  Only if the site uses your own domain, two more variables:
    CIVICSCOPE_DOMAIN_NAME and CIVICSCOPE_CERTIFICATE_ARN, as in your ~/.cdk.json
EOF
