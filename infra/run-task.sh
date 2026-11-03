#!/usr/bin/env bash
# Runs a one-off worker task in the cluster and waits for it.
#   ./run-task.sh migrate                     # pnpm db:migrate as the schema owner
#   ./run-task.sh admin <pnpm script> [args]  # anything else, as the app account
#   ./run-task.sh drill <pnpm script> [args]  # same as admin; named for the restore drill
set -euo pipefail
kind=${1:?migrate, admin or drill}
shift || true
out() { aws cloudformation describe-stacks --stack-name CivicScope --region us-east-1 \
  --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
cluster=$(out ClusterName)
subnets=$(out TaskSubnets)
sg=$(out WorkerSecurityGroup)
if [ "$kind" = migrate ]; then
  taskdef=$(out MigrateTaskDef); overrides='{}'
else
  taskdef=$(out AdminTaskDef)
  cmd=$(printf '%s\n' "$@" | python3 -c 'import json,sys; print(json.dumps([l.rstrip("\n") for l in sys.stdin]))')
  overrides="{\"containerOverrides\":[{\"name\":\"worker\",\"command\":$cmd}]}"
fi
arn=$(aws ecs run-task --region us-east-1 --cluster "$cluster" --task-definition "$taskdef" \
  --launch-type FARGATE --overrides "$overrides" \
  --network-configuration "awsvpcConfiguration={subnets=[${subnets}],securityGroups=[$sg],assignPublicIp=DISABLED}" \
  --query 'tasks[0].taskArn' --output text)
echo "Started $arn; waiting for it to finish..."
aws ecs wait tasks-stopped --region us-east-1 --cluster "$cluster" --tasks "$arn"
code=$(aws ecs describe-tasks --region us-east-1 --cluster "$cluster" --tasks "$arn" \
  --query 'tasks[0].containers[0].exitCode' --output text)
echo "Exit code $code. Logs: CloudWatch log group of the worker tasks."
exit "$code"
