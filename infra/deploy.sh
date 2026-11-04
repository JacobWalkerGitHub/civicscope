#!/usr/bin/env bash
# Ships the committed code to AWS: builds both images, uploads them, deploys, and
# runs any new database migrations.
#   infra/deploy.sh
# Needs Docker Desktop running and an AWS sign-in (`aws sso login`).
# GitHub Actions runs this same script after every merge to main (.github/workflows/deploy.yml);
# there CDK_REQUIRE_APPROVAL=never, because nobody is at a terminal to answer CDK's prompt.
set -euo pipefail
APPROVAL=${CDK_REQUIRE_APPROVAL:-broadening}
cd "$(dirname "$0")/.."
if ! git diff --quiet HEAD; then
  echo "You have uncommitted changes. Commit or stash them first, so the images match a commit." >&2
  exit 1
fi
docker info >/dev/null 2>&1 || { echo "Docker isn't running. Open Docker Desktop and try again." >&2; exit 1; }
TAG=$(git rev-parse --short HEAD)
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
# CDK can't always read an SSO sign-in the way the AWS CLI does: hand it the CLI's
# temporary keys and the account, so every step below uses the same sign-in.
if [ -z "${AWS_ACCESS_KEY_ID:-}" ]; then
  eval "$(aws configure export-credentials --format env)"
fi
export CDK_DEFAULT_ACCOUNT="$ACCOUNT" CDK_DEFAULT_REGION=us-east-1
REGISTRY=$ACCOUNT.dkr.ecr.us-east-1.amazonaws.com
echo "Building and uploading $TAG..."
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin "$REGISTRY"
for target in web worker; do
  docker build --platform linux/amd64 --target "$target" -t "$REGISTRY/civicscope-$target:$TAG" .
  docker push "$REGISTRY/civicscope-$target:$TAG"
done
cd infra
# The site isn't running yet (first deploy, or an earlier one that stopped partway):
# put the new images in place with the site still off, migrate, then turn it on.
# Otherwise new web tasks would wait on a database with no tables or app account.
running=$(aws ecs describe-services --region us-east-1 \
  --cluster "$(./run-task.sh output ClusterName)" --services "$(./run-task.sh output WebServiceName)" \
  --query 'services[0].desiredCount' --output text)
if [ "$running" = "0" ] || [ "$running" = "None" ]; then
  echo "First deploy of the site: setting up $TAG with the site off..."
  pnpm exec cdk deploy --require-approval never -c "civicscope:imageTag=$TAG" -c civicscope:paused=true
  echo "Applying database migrations..."
  ./run-task.sh migrate
  echo "Turning the site on..."
  pnpm exec cdk deploy --require-approval "$APPROVAL" -c "civicscope:imageTag=$TAG"
else
  echo "Deploying $TAG..."
  pnpm exec cdk deploy --require-approval "$APPROVAL" -c "civicscope:imageTag=$TAG"
  echo "Applying database migrations..."
  ./run-task.sh migrate
fi
echo "Done: $TAG is live."
