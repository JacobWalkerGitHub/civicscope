import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { CivicScopeStack } from '../lib/civicscope-stack';

const template = Template.fromStack(
  new CivicScopeStack(new App(), 'Test', {
    imageTag: 'test',
    multiAz: true,
    fecCycle: 2028,
    congress: 119,
    alertEmail: 'alerts@example.com',
  }),
);

describe('CivicScope stack', () => {
  it("lets only CloudFront's origin-facing addresses reach the load balancer", () => {
    template.hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
      SourcePrefixListId: 'pl-3b927c52',
      FromPort: 80,
      ToPort: 80,
      GroupId: { 'Fn::GetAtt': [Match.stringLikeRegexp('^AlbSg'), 'GroupId'] },
    });
  });

  it('keeps the database private, encrypted, backed up and TLS-only', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      Engine: 'mysql',
      MultiAZ: true,
      StorageEncrypted: true,
      PubliclyAccessible: false,
      DeletionProtection: true,
      BackupRetentionPeriod: 14,
    });
    template.hasResourceProperties('AWS::RDS::DBParameterGroup', {
      Parameters: Match.objectLike({
        require_secure_transport: '1',
        log_bin_trust_function_creators: '1',
      }),
    });
    template.hasResourceProperties('AWS::Backup::BackupPlan', {
      BackupPlan: Match.objectLike({
        BackupPlanRule: [Match.objectLike({ Lifecycle: { DeleteAfterDays: 365 } })],
      }),
    });
  });

  it('puts the site behind CloudFront and a WAF, with no public load balancer', () => {
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
      Scheme: 'internal',
    });
    template.hasResourceProperties('AWS::WAFv2::WebACL', {
      Scope: 'CLOUDFRONT',
      Rules: Match.arrayWith([
        Match.objectLike({ Name: 'AWSManagedRulesCommonRuleSet' }),
        Match.objectLike({ Name: 'sign-in-rate' }),
      ]),
    });
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        WebACLId: Match.anyValue(),
        DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: 'redirect-to-https' }),
      }),
    });
  });

  it('alarms on a failed ingest, by log line and by task exit code', () => {
    template.hasResourceProperties('AWS::Logs::MetricFilter', {
      FilterPattern: '{ $.event = "civicscope_alert" }',
    });
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({ 'detail-type': ['ECS Task State Change'] }),
    });
    template.hasResourceProperties('AWS::SNS::Subscription', {
      Protocol: 'email',
      Endpoint: 'alerts@example.com',
    });
  });

  it('gives the web tasks only the app database account, never the schema owner', () => {
    const defs = template.findResources('AWS::ECS::TaskDefinition');
    const web = Object.entries(defs).find(([id]) => id.startsWith('WebTask'))![1];
    const secrets = web.Properties.ContainerDefinitions[0].Secrets.map(
      (s: { Name: string; ValueFrom: unknown }) => JSON.stringify(s),
    );
    expect(secrets.some((s: string) => s.includes('DbAppSecret'))).toBe(true);
    expect(secrets.some((s: string) => s.includes('DbAdminSecret'))).toBe(false);
  });
});

describe('bootstrap deploy', () => {
  it('creates everything but runs nothing before images exist', () => {
    const t = Template.fromStack(
      new CivicScopeStack(new App(), 'Boot', {
        imageTag: 'bootstrap',
        multiAz: false,
        fecCycle: 2028,
        congress: 119,
      }),
    );
    t.hasResourceProperties('AWS::ECS::Service', { DesiredCount: 0 });
    t.resourceCountIs('AWS::ECR::Repository', 2);
    for (const rule of Object.values(t.findResources('AWS::Events::Rule'))) {
      if (rule.Properties.ScheduleExpression) expect(rule.Properties.State).toBe('DISABLED');
    }
  });
});

describe('paused deploy', () => {
  it('registers the new images but keeps the site and schedules off', () => {
    const t = Template.fromStack(
      new CivicScopeStack(new App(), 'Paused', {
        imageTag: 'abc1234',
        paused: true,
        multiAz: false,
        fecCycle: 2028,
        congress: 119,
      }),
    );
    t.hasResourceProperties('AWS::ECS::Service', { DesiredCount: 0 });
    expect(JSON.stringify(t.findResources('AWS::ECS::TaskDefinition'))).toContain(':abc1234');
    for (const rule of Object.values(t.findResources('AWS::Events::Rule'))) {
      if (rule.Properties.ScheduleExpression) expect(rule.Properties.State).toBe('DISABLED');
    }
  });

  it('sends follow alerts only when a sender address is set, and only from it', () => {
    const withAlerts = Template.fromStack(
      new CivicScopeStack(new App(), 'Alerts', {
        imageTag: 'test',
        multiAz: false,
        fecCycle: 2028,
        congress: 119,
        alertsFromEmail: 'alerts@example.org',
      }),
    );
    withAlerts.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'ses:SendEmail',
            Condition: { StringEquals: { 'ses:FromAddress': 'alerts@example.org' } },
          }),
        ]),
      },
    });
    withAlerts.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'cron(0 15 * * ? *)',
    });
    withAlerts.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: [
        Match.objectLike({
          Name: 'web',
          Environment: Match.arrayWith([
            { Name: 'ALERTS_FROM_EMAIL', Value: 'alerts@example.org' },
          ]),
        }),
      ],
    });
    // The default stack has no sender: no schedule, and nothing may send email.
    template.resourcePropertiesCountIs(
      'AWS::Events::Rule',
      { ScheduleExpression: 'cron(0 15 * * ? *)' },
      0,
    );
    expect(JSON.stringify(template.toJSON())).not.toContain('ses:SendEmail');
  });
});
