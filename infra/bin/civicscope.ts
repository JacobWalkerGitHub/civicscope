import { App } from 'aws-cdk-lib';
import { CivicScopeStack } from '../lib/civicscope-stack';

const app = new App();
const ctx = (key: string) => app.node.tryGetContext(`civicscope:${key}`);

/*
 * One stack in us-east-1. CloudFront's WAF must live in us-east-1, and keeping the
 * site, database and firewall in one region keeps the setup to a single deploy.
 */
new CivicScopeStack(app, 'CivicScope', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' },
  alertEmail: ctx('alertEmail') || undefined,
  domainName: ctx('domainName') || undefined,
  certificateArn: ctx('certificateArn') || undefined,
  imageTag: String(ctx('imageTag') ?? 'bootstrap'),
  paused: ctx('paused') === true || ctx('paused') === 'true',
  multiAz: ctx('multiAz') !== false && ctx('multiAz') !== 'false',
  webTasks: Number(ctx('webTasks') ?? 1),
  fecCycle: Number(ctx('fecCycle') ?? 2028),
  congress: Number(ctx('congress') ?? 119),
  alertsFromEmail: ctx('alertsFromEmail') || undefined,
  shutdown: ctx('shutdown') === true || ctx('shutdown') === 'true',
});
