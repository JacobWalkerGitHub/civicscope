#!/usr/bin/env bash
# Runs a one-off worker task in the cluster and waits for it.
#   ./run-task.sh migrate                     # pnpm db:migrate as the schema owner
#   ./run-task.sh admin <pnpm script> [args]  # anything else, as the app account
#   ./run-task.sh drill <restored endpoint>   # restore drill check, as the schema owner
#   ./run-task.sh output <name>               # print one of the stack's outputs
set -euo pipefail
kind=${1:?migrate, admin, drill or output}
shift || true
out() { aws cloudformation describe-stacks --stack-name CivicScope --region us-east-1 \
  --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
if [ "$kind" = output ]; then out "${1:?output name}"; exit; fi
cluster=$(out ClusterName)
subnets=$(out TaskSubnets)
sg=$(out WorkerSecurityGroup)
json_command() {
  printf '%s\n' "$@" | python3 -c 'import json,sys; print(json.dumps([l.rstrip("\n") for l in sys.stdin]))'
}
case "$kind" in
  migrate)
    taskdef=$(out MigrateTaskDef); overrides='{}' ;;
  drill)
    host=${1:?give the restored database endpoint}
    taskdef=$(out MigrateTaskDef)
    overrides="{\"containerOverrides\":[{\"name\":\"worker\",\"command\":$(json_command db:verify-restore --host "$host")}]}" ;;
  admin)
    taskdef=$(out AdminTaskDef)
    overrides="{\"containerOverrides\":[{\"name\":\"worker\",\"command\":$(json_command "$@")}]}" ;;
  *)
    echo "First argument: migrate, admin or drill" >&2; exit 2 ;;
esac
arn=$(aws ecs run-task --region us-east-1 --cluster "$cluster" --task-definition "$taskdef" \
  --launch-type FARGATE --overrides "$overrides" \
  --network-configuration "awsvpcConfiguration={subnets=[${subnets}],securityGroups=[$sg],assignPublicIp=DISABLED}" \
  --query 'tasks[0].taskArn' --output text)
echo "Started $arn; waiting for it to finish..."
# The ECS waiter gives up after 10 minutes and an import can run for over an hour, so poll.
# RUN_TASK_MAX_WAIT (seconds) stops waiting early and leaves the task running: GitHub's
# AWS sign-in lasts an hour, and the hourly ingest check alerts if the import then fails.
deadline=$(( $(date +%s) + ${RUN_TASK_MAX_WAIT:-86400} ))
while :; do
  status=$(aws ecs describe-tasks --region us-east-1 --cluster "$cluster" --tasks "$arn" \
    --query 'tasks[0].lastStatus' --output text)
  [ "$status" = STOPPED ] && break
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "Still running after ${RUN_TASK_MAX_WAIT}s; leaving it to finish on its own."
    echo "Its output is in CloudWatch, and the hourly ingest check alerts if it fails."
    exit 0
  fi
  echo "Still running ($status)..."
  sleep 30
done
code=$(aws ecs describe-tasks --region us-east-1 --cluster "$cluster" --tasks "$arn" \
  --query 'tasks[0].containers[0].exitCode' --output text)
echo "Exit code $code. Logs: CloudWatch log group of the worker tasks."
exit "$code"
