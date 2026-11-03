#!/usr/bin/env bash
# Ships the committed code to AWS: builds both images, uploads them, deploys, and
# runs any new database migrations.
#   infra/deploy.sh
# Needs Docker Desktop running and an AWS sign-in (`aws sso login`).
set -euo pipefail
cd "$(dirname "$0")/.."
if ! git diff --quiet HEAD; then
  echo "You have uncommitted changes. Commit or stash them first, so the images match a commit." >&2
  exit 1
fi
docker info >/dev/null 2>&1 || { echo "Docker isn't running. Open Docker Desktop and try again." >&2; exit 1; }
TAG=$(git rev-parse --short HEAD)
REGISTRY=$(aws sts get-caller-identity --query Account --output text).dkr.ecr.us-east-1.amazonaws.com
echo "Building and uploading $TAG..."
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin "$REGISTRY"
for target in web worker; do
  docker build --platform linux/amd64 --target "$target" -t "$REGISTRY/civicscope-$target:$TAG" .
  docker push "$REGISTRY/civicscope-$target:$TAG"
done
cd infra
echo "Deploying $TAG..."
pnpm exec cdk deploy -c "civicscope:imageTag=$TAG"
echo "Applying database migrations..."
./run-task.sh migrate
echo "Done: $TAG is live."
