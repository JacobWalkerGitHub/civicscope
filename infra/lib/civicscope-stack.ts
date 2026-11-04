import {
  Duration,
  RemovalPolicy,
  SecretValue,
  Stack,
  Token,
  type StackProps,
  CfnOutput,
  aws_backup as backup,
  aws_certificatemanager as acm,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_cloudwatch as cw,
  aws_cloudwatch_actions as cwActions,
  aws_ec2 as ec2,
  aws_ecr as ecr,
  aws_ecs as ecs,
  aws_elasticloadbalancingv2 as elbv2,
  aws_events as events,
  aws_events_targets as targets,
  aws_iam as iam,
  aws_logs as logs,
  aws_rds as rds,
  aws_secretsmanager as secretsmanager,
  aws_sns as sns,
  aws_sns_subscriptions as subs,
  aws_wafv2 as waf,
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';

export interface CivicScopeStackProps extends StackProps {
  /** Where alarms are emailed. Without it, alarms still show in CloudWatch. */
  alertEmail?: string;
  /** e.g. civicscope.org, with an ACM certificate for it in us-east-1. */
  domainName?: string;
  certificateArn?: string;
  /**
   * Tag of the web and worker images in ECR. "bootstrap" (the first deploy, before any
   * image exists) creates everything but runs nothing: no web tasks, no schedules.
   */
  imageTag: string;
  /**
   * Registers the images' task definitions but keeps the site and schedules off, as in
   * bootstrap. deploy.sh uses it on the first real deploy so the migration can run
   * before any web task needs the database.
   */
  paused?: boolean;
  /** A standby database in a second zone. Plan: off while building, on at launch. */
  multiAz: boolean;
  fecCycle: number;
  congress: number;
  /**
   * Turns on follow email alerts, sent through Amazon SES from this address (its
   * domain must be verified in SES). Without it the Follow buttons stay hidden.
   */
  alertsFromEmail?: string;
}

const DB_NAME = 'civicscope';
const APP_PORT = 3000;
/** com.amazonaws.global.cloudfront.origin-facing in us-east-1. */
const CLOUDFRONT_ORIGIN_FACING_US_EAST_1 = 'pl-3b927c52';

/**
 * CivicScope in AWS, as ADR 0001 and the plan describe:
 *
 *   viewer → CloudFront (+ WAF) → private load balancer (VPC origin) → Fargate (Next.js)
 *                                                                     → RDS MySQL 8.4
 *   EventBridge schedules → Fargate worker tasks (ingests, checks) → RDS
 *
 * Nothing but CloudFront can reach the site: the load balancer has no public address.
 * Alarms go to one SNS topic.
 */
export class CivicScopeStack extends Stack {
  constructor(scope: Construct, id: string, props: CivicScopeStackProps) {
    super(scope, id, props);
    const bootstrap = props.imageTag === 'bootstrap' || props.paused === true;

    // ---------------------------------------------------------------- network
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      // One NAT gateway keeps cost down; tasks lose outbound internet (not the site)
      // if its zone fails.
      natGateways: 1,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'app', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 22 },
        { name: 'data', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });

    // ---------------------------------------------------------------- alarms
    const alarmTopic = new sns.Topic(this, 'Alarms', { displayName: 'CivicScope alarms' });
    if (props.alertEmail) alarmTopic.addSubscription(new subs.EmailSubscription(props.alertEmail));
    const notify = new cwActions.SnsAction(alarmTopic);

    // ---------------------------------------------------------------- secrets
    // The schema owner, used only by the migrate task.
    const dbAdminSecret = new rds.DatabaseSecret(this, 'DbAdminSecret', {
      username: 'civicscope_admin',
    });
    // The least-privilege account the site and the ingests use (packages/db/src/grants.ts).
    // The migrate task creates it and refreshes its grants.
    const dbAppSecret = new secretsmanager.Secret(this, 'DbAppSecret', {
      description: 'CivicScope app database account (least privilege)',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'civicscope_app' }),
        generateStringKey: 'password',
        excludePunctuation: true,
        passwordLength: 32,
      },
    });
    // Filled in by hand after the first deploy (see infra/README.md). "unset" values
    // make the app fail loudly rather than run with a missing key. Never edit these
    // placeholders once deployed: a changed template value makes CloudFormation
    // overwrite the real keys stored in the secret.
    const appSecret = new secretsmanager.Secret(this, 'AppSecret', {
      description: 'CivicScope app settings: AUTH_ENCRYPTION_KEY, API keys, alert webhook',
      secretObjectValue: {
        AUTH_ENCRYPTION_KEY: cdkUnset(),
        FEC_API_KEY: cdkUnset(),
        CONGRESS_API_KEY: cdkUnset(),
        ALERT_WEBHOOK_URL: cdkUnset(''),
        // Only for creating the first owner; set it back to "unset" afterwards.
        BOOTSTRAP_ADMIN_PASSWORD: cdkUnset(),
      },
    });

    // ---------------------------------------------------------------- database
    const parameterGroup = new rds.ParameterGroup(this, 'DbParams', {
      engine: rds.DatabaseInstanceEngine.mysql({ version: rds.MysqlEngineVersion.VER_8_4_10 }),
      parameters: {
        // The audit-log triggers are created by the (non-SUPER) migration user.
        log_bin_trust_function_creators: '1',
        require_secure_transport: '1',
        slow_query_log: '1',
        long_query_time: '1',
      },
    });
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DbSg', {
      vpc,
      description: 'CivicScope database',
      allowAllOutbound: false,
    });
    const db = new rds.DatabaseInstance(this, 'Db', {
      engine: rds.DatabaseInstanceEngine.mysql({ version: rds.MysqlEngineVersion.VER_8_4_10 }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.BURSTABLE4_GRAVITON,
        ec2.InstanceSize.SMALL,
      ),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSecurityGroup],
      credentials: rds.Credentials.fromSecret(dbAdminSecret),
      databaseName: DB_NAME,
      parameterGroup,
      multiAz: props.multiAz,
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      // Point-in-time restore to any second in the last 14 days.
      backupRetention: Duration.days(14),
      preferredBackupWindow: '07:00-08:00',
      preferredMaintenanceWindow: 'sun:08:30-sun:09:30',
      autoMinorVersionUpgrade: true,
      deletionProtection: true,
      removalPolicy: RemovalPolicy.SNAPSHOT,
      cloudwatchLogsExports: ['error', 'slowquery'],
      cloudwatchLogsRetention: logs.RetentionDays.THREE_MONTHS,
    });

    // A monthly copy kept for a year, beyond the 14 days of automated backups.
    const plan = new backup.BackupPlan(this, 'MonthlyBackup', {
      backupPlanRules: [
        new backup.BackupPlanRule({
          ruleName: 'monthly',
          scheduleExpression: events.Schedule.cron({ day: '1', hour: '9', minute: '0' }),
          deleteAfter: Duration.days(365),
        }),
      ],
    });
    plan.addSelection('Db', { resources: [backup.BackupResource.fromRdsDatabaseInstance(db)] });

    // ---------------------------------------------------------------- images
    const lifecycle: ecr.LifecycleRule[] = [{ maxImageCount: 30 }];
    const webRepo = new ecr.Repository(this, 'WebRepo', {
      repositoryName: 'civicscope-web',
      imageScanOnPush: true,
      lifecycleRules: lifecycle,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const workerRepo = new ecr.Repository(this, 'WorkerRepo', {
      repositoryName: 'civicscope-worker',
      imageScanOnPush: true,
      lifecycleRules: lifecycle,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // ---------------------------------------------------------------- shared task settings
    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });
    const dbEnv = {
      DB_HOST: db.dbInstanceEndpointAddress,
      DB_PORT: db.dbInstanceEndpointPort,
      DB_NAME,
      DB_TLS: 'true',
    };
    const appDbSecrets = {
      DB_USER: ecs.Secret.fromSecretsManager(dbAppSecret, 'username'),
      DB_PASSWORD: ecs.Secret.fromSecretsManager(dbAppSecret, 'password'),
    };

    // ---------------------------------------------------------------- web service
    const webLogs = new logs.LogGroup(this, 'WebLogs', {
      retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const webTask = new ecs.FargateTaskDefinition(this, 'WebTask', {
      cpu: 512,
      memoryLimitMiB: 1024,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });
    webTask.addContainer('web', {
      image: ecs.ContainerImage.fromEcrRepository(webRepo, props.imageTag),
      portMappings: [{ containerPort: APP_PORT }],
      logging: ecs.LogDrivers.awsLogs({ logGroup: webLogs, streamPrefix: 'web' }),
      environment: {
        ...dbEnv,
        // CloudFront appends the viewer's address, then the load balancer appends
        // CloudFront's (packages/core/src/net.ts).
        TRUSTED_PROXY_COUNT: '2',
        ADMIN_REQUIRE_TWO_STEP: 'true',
      },
      secrets: {
        ...appDbSecrets,
        AUTH_ENCRYPTION_KEY: ecs.Secret.fromSecretsManager(appSecret, 'AUTH_ENCRYPTION_KEY'),
      },
      healthCheck: {
        command: [
          'CMD',
          'node',
          '-e',
          `fetch('http://127.0.0.1:${APP_PORT}/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))`,
        ],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        startPeriod: Duration.seconds(30),
      },
    });

    const albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSg', {
      vpc,
      description: 'CivicScope load balancer: reachable only from CloudFront VPC origin ENIs',
    });
    // CloudFront's VPC origin reaches the load balancer from CloudFront's own
    // origin-facing addresses, not from addresses inside this VPC, so allow AWS's
    // managed prefix list for them. Synth without an account (tests) uses the
    // us-east-1 list's id.
    const cloudFrontPrefixList = Token.isUnresolved(this.account)
      ? CLOUDFRONT_ORIGIN_FACING_US_EAST_1
      : ec2.PrefixList.fromLookup(this, 'CloudFrontOriginFacing', {
          prefixListName: 'com.amazonaws.global.cloudfront.origin-facing',
        }).prefixListId;
    albSecurityGroup.addIngressRule(ec2.Peer.prefixList(cloudFrontPrefixList), ec2.Port.tcp(80));
    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc,
      internetFacing: false,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroup: albSecurityGroup,
      dropInvalidHeaderFields: true,
    });
    const webSecurityGroup = new ec2.SecurityGroup(this, 'WebSg', {
      vpc,
      description: 'CivicScope web tasks',
    });
    const service = new ecs.FargateService(this, 'WebService', {
      cluster,
      taskDefinition: webTask,
      desiredCount: bootstrap ? 0 : 2,
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [webSecurityGroup],
      circuitBreaker: { enable: true, rollback: true },
      enableExecuteCommand: false,
    });
    const listener = alb.addListener('Http', { port: 80, open: false });
    const targetGroup = listener.addTargets('Web', {
      port: APP_PORT,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [service],
      healthCheck: { path: '/api/health', healthyHttpCodes: '200', interval: Duration.seconds(15) },
      deregistrationDelay: Duration.seconds(30),
    });
    const scaling = service.autoScaleTaskCount({
      minCapacity: bootstrap ? 0 : 2,
      maxCapacity: bootstrap ? 0 : 6,
    });
    scaling.scaleOnCpuUtilization('Cpu', { targetUtilizationPercent: 60 });
    db.connections.allowDefaultPortFrom(webSecurityGroup, 'web tasks');

    // ---------------------------------------------------------------- firewall
    const managed = (name: string, priority: number, countOnly: string[] = []) => ({
      name,
      priority,
      overrideAction: { none: {} },
      statement: {
        managedRuleGroupStatement: {
          vendorName: 'AWS',
          name,
          ruleActionOverrides: countOnly.map((rule) => ({
            name: rule,
            actionToUse: { count: {} },
          })),
        },
      },
      visibilityConfig: visibility(name),
    });
    const rateLimit = (name: string, priority: number, limit: number, pathPrefix?: string) => ({
      name,
      priority,
      action: { block: {} },
      statement: {
        rateBasedStatement: {
          limit,
          evaluationWindowSec: 300,
          aggregateKeyType: 'IP',
          ...(pathPrefix && {
            scopeDownStatement: {
              byteMatchStatement: {
                fieldToMatch: { uriPath: {} },
                positionalConstraint: 'STARTS_WITH',
                searchString: pathPrefix,
                textTransformations: [{ priority: 0, type: 'NONE' }],
              },
            },
          }),
        },
      },
      visibilityConfig: visibility(name),
    });
    const webAcl = new waf.CfnWebACL(this, 'WebAcl', {
      scope: 'CLOUDFRONT',
      defaultAction: { allow: {} },
      visibilityConfig: visibility('civicscope'),
      rules: [
        managed('AWSManagedRulesAmazonIpReputationList', 0),
        // Photo uploads (up to 6 MB) exceed the common set's 8 KB body limit; the app
        // checks their size and contents itself.
        managed('AWSManagedRulesCommonRuleSet', 1, ['SizeRestrictions_BODY']),
        managed('AWSManagedRulesKnownBadInputsRuleSet', 2),
        managed('AWSManagedRulesSQLiRuleSet', 3),
        // Requests per IP per 5 minutes. Only sign-in gets a tight limit (the app also
        // locks accounts after failed attempts): the rest of /admin fetches a page's data
        // for every link it shows, so an editor reaches hundreds of requests quickly.
        rateLimit('sign-in-rate', 10, 100, '/admin/sign-in'),
        rateLimit('search-rate', 11, 600, '/search'),
        // Each ballot lookup calls the Census geocoder: keep one visitor from hammering it.
        rateLimit('ballot-rate', 12, 200, '/ballot'),
        rateLimit('overall-rate', 13, 3000),
      ],
    });

    // ---------------------------------------------------------------- CDN
    const certificate = props.certificateArn
      ? acm.Certificate.fromCertificateArn(this, 'Cert', props.certificateArn)
      : undefined;
    const origin = origins.VpcOrigin.withApplicationLoadBalancer(alb, {
      httpPort: 80,
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
      readTimeout: Duration.seconds(60),
    });
    // Pages decide their own caching with Cache-Control; most are dynamic and say
    // "no-store", so CloudFront passes them through.
    const pageCache = new cloudfront.CachePolicy(this, 'PageCache', {
      defaultTtl: Duration.seconds(0),
      minTtl: Duration.seconds(0),
      maxTtl: Duration.days(1),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
    });
    const distribution = new cloudfront.Distribution(this, 'Cdn', {
      comment: 'CivicScope',
      webAclId: webAcl.attrArn,
      ...(props.domainName && certificate
        ? {
            domainNames: [props.domainName],
            certificate,
            minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
          }
        : {}),
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: pageCache,
        // Forward the viewer's Host header: Next.js checks a server action's Origin
        // against it, so the forms fail without it.
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
      },
      additionalBehaviors: {
        '/_next/static/*': {
          origin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
      },
    });

    // ---------------------------------------------------------------- follow alerts
    // Readers follow a member or a bill and get emails through SES (packages/cms/src/
    // follows.ts). The web tasks send the confirmation emails; a daily worker sends the
    // updates. Both may send only from the one configured address.
    const siteUrl = `https://${props.domainName ?? distribution.distributionDomainName}`;
    const alertsEnv: Record<string, string> = props.alertsFromEmail
      ? { SITE_URL: siteUrl, ALERTS_FROM_EMAIL: props.alertsFromEmail }
      : {};
    const sesSend = props.alertsFromEmail
      ? new iam.PolicyStatement({
          actions: ['ses:SendEmail'],
          resources: [`arn:aws:ses:${this.region}:${this.account}:identity/*`],
          conditions: { StringEquals: { 'ses:FromAddress': props.alertsFromEmail } },
        })
      : undefined;
    for (const [name, value] of Object.entries(alertsEnv)) {
      webTask.defaultContainer!.addEnvironment(name, value);
    }
    if (sesSend) webTask.addToTaskRolePolicy(sesSend);

    // ---------------------------------------------------------------- worker tasks
    const workerLogs = new logs.LogGroup(this, 'WorkerLogs', {
      retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const workerSecurityGroup = new ec2.SecurityGroup(this, 'WorkerSg', {
      vpc,
      description: 'CivicScope worker tasks',
    });
    db.connections.allowDefaultPortFrom(workerSecurityGroup, 'worker tasks');
    const workerImage = ecs.ContainerImage.fromEcrRepository(workerRepo, props.imageTag);

    const workerTask = (
      id: string,
      command: string[],
      admin = false,
      extraSecrets: Record<string, ecs.Secret> = {},
    ) => {
      const task = new ecs.FargateTaskDefinition(this, id, { cpu: 512, memoryLimitMiB: 1024 });
      task.addContainer('worker', {
        image: workerImage,
        command,
        logging: ecs.LogDrivers.awsLogs({ logGroup: workerLogs, streamPrefix: id }),
        environment: { ...dbEnv, ...alertsEnv },
        secrets: admin
          ? {
              // Migrations run as the schema owner, then refresh the app account.
              DB_USER: ecs.Secret.fromSecretsManager(dbAdminSecret, 'username'),
              DB_PASSWORD: ecs.Secret.fromSecretsManager(dbAdminSecret, 'password'),
              APP_DB_USER: ecs.Secret.fromSecretsManager(dbAppSecret, 'username'),
              APP_DB_PASSWORD: ecs.Secret.fromSecretsManager(dbAppSecret, 'password'),
            }
          : {
              ...appDbSecrets,
              AUTH_ENCRYPTION_KEY: ecs.Secret.fromSecretsManager(appSecret, 'AUTH_ENCRYPTION_KEY'),
              FEC_API_KEY: ecs.Secret.fromSecretsManager(appSecret, 'FEC_API_KEY'),
              CONGRESS_API_KEY: ecs.Secret.fromSecretsManager(appSecret, 'CONGRESS_API_KEY'),
              // Added to the secret by hand, not in secretObjectValue above, so a deploy
              // never overwrites the real key.
              OPENSTATES_API_KEY: ecs.Secret.fromSecretsManager(appSecret, 'OPENSTATES_API_KEY'),
              ALERT_WEBHOOK_URL: ecs.Secret.fromSecretsManager(appSecret, 'ALERT_WEBHOOK_URL'),
              ...extraSecrets,
            },
      });
      return task;
    };

    // Run by hand (or by a deploy job) before each new web image goes live.
    const migrateTask = workerTask('MigrateTask', ['db:migrate'], true);
    // Shell-free one-off tasks: `aws ecs run-task` with a command override.
    const adminTask = workerTask('AdminTask', ['check:ingest'], false, {
      // Read by `admin:create-user` so the first owner's password never appears in a
      // command line, the task definition or the logs.
      ADMIN_PASSWORD: ecs.Secret.fromSecretsManager(appSecret, 'BOOTSTRAP_ADMIN_PASSWORD'),
    });

    const schedule = (id: string, cron: events.CronOptions, command: string[]) => {
      const taskDefinition = workerTask(`${id}Task`, command);
      const rule = new events.Rule(this, id, {
        schedule: events.Schedule.cron(cron),
        // Off until images exist and the database is migrated and seeded.
        enabled: !bootstrap,
      });
      rule.addTarget(
        new targets.EcsTask({
          cluster,
          taskDefinition,
          subnetSelection: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
          securityGroups: [workerSecurityGroup],
        }),
      );
      return taskDefinition;
    };
    // Times are UTC.
    schedule('FecDaily', { hour: '10', minute: '0' }, ['ingest:fec', String(props.fecCycle)]);
    // Money raised and spent: the current period and the one before it, whose late
    // reports keep arriving after its election.
    schedule('FecTotalsDaily', { hour: '10', minute: '30' }, [
      'ingest:fec-totals',
      String(props.fecCycle - 2),
      String(props.fecCycle),
    ]);
    schedule('LegislatorsWeekly', { weekDay: 'MON', hour: '9', minute: '0' }, [
      'ingest:legislators',
    ]);
    schedule('CongressDaily', { hour: '11', minute: '0' }, [
      'ingest:congress',
      String(props.congress),
    ]);
    // State legislative votes. About 300 spaced-out requests, so it runs for under an hour.
    schedule('OpenStatesDaily', { hour: '12', minute: '0' }, ['ingest:openstates']);
    // Governors and state legislators in office (Open States' public files, no key).
    schedule('StateOfficialsDaily', { hour: '13', minute: '0' }, ['ingest:state-officials']);
    schedule('IngestCheckHourly', { minute: '30' }, ['check:ingest', '--hours', '1']);
    // Follow alerts, after the day's imports (10:00 to about 14:00 UTC), so mid-morning
    // on the East Coast.
    if (sesSend) {
      schedule('FollowAlertsDaily', { hour: '15', minute: '0' }, [
        'alerts:send',
      ]).addToTaskRolePolicy(sesSend);
    }

    // ---------------------------------------------------------------- alarms
    // 1. Any alert the code raises (packages/cms/src/alerts.ts) in a worker's logs.
    const alertMetric = new logs.MetricFilter(this, 'AlertFilter', {
      logGroup: workerLogs,
      filterPattern: logs.FilterPattern.stringValue('$.event', '=', 'civicscope_alert'),
      metricNamespace: 'CivicScope',
      metricName: 'Alerts',
      metricValue: '1',
      defaultValue: 0,
    }).metric({ statistic: 'Sum', period: Duration.minutes(5) });
    alarm(
      this,
      'IngestAlert',
      alertMetric,
      1,
      'An ingest failed or got stuck (see worker logs)',
      notify,
    );

    // 2. A worker task that stopped with an error, even one that died before it could log.
    new events.Rule(this, 'WorkerTaskFailed', {
      description: 'A CivicScope worker task exited with an error',
      eventPattern: {
        source: ['aws.ecs'],
        detailType: ['ECS Task State Change'],
        detail: {
          clusterArn: [cluster.clusterArn],
          lastStatus: ['STOPPED'],
          group: [{ prefix: 'family:' }],
          containers: { name: ['worker'], exitCode: [{ 'anything-but': 0 }] },
        },
      },
      targets: [new targets.SnsTopic(alarmTopic)],
    });

    // 3. The site.
    alarm(
      this,
      'Site5xx',
      alb.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, {
        period: Duration.minutes(5),
        statistic: 'Sum',
      }),
      10,
      'The site returned 10 or more server errors in 5 minutes',
      notify,
    );
    alarm(
      this,
      'UnhealthyTasks',
      targetGroup.metrics.unhealthyHostCount({ period: Duration.minutes(5), statistic: 'Maximum' }),
      1,
      'A web task is failing its health check',
      notify,
      2,
    );
    alarm(
      this,
      'WebCpu',
      service.metricCpuUtilization({ period: Duration.minutes(5) }),
      85,
      'Web CPU over 85% (autoscaling is at its limit or not keeping up)',
      notify,
      3,
    );

    // 4. The database.
    alarm(
      this,
      'DbCpu',
      db.metricCPUUtilization({ period: Duration.minutes(5) }),
      80,
      'Database CPU over 80%',
      notify,
      3,
    );
    new cw.Alarm(this, 'DbStorage', {
      metric: db.metricFreeStorageSpace({ period: Duration.minutes(5) }),
      threshold: 2 * 1024 ** 3,
      comparisonOperator: cw.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 1,
      alarmDescription: 'Database has less than 2 GB free',
      treatMissingData: cw.TreatMissingData.BREACHING,
    }).addAlarmAction(notify);

    // ---------------------------------------------------------------- outputs
    const out = (name: string, value: string) => new CfnOutput(this, name, { value });
    out('SiteUrl', `https://${props.domainName ?? distribution.distributionDomainName}`);
    out('CloudFrontDomain', distribution.distributionDomainName);
    out('WebRepoUri', webRepo.repositoryUri);
    out('WorkerRepoUri', workerRepo.repositoryUri);
    out('ClusterName', cluster.clusterName);
    out('WebServiceName', service.serviceName);
    out('MigrateTaskDef', migrateTask.family);
    out('AdminTaskDef', adminTask.family);
    out(
      'TaskSubnets',
      vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }).subnetIds.join(','),
    );
    out('WorkerSecurityGroup', workerSecurityGroup.securityGroupId);
    out('AppSecretArn', appSecret.secretArn);
    out('DbInstanceId', db.instanceIdentifier);
    out('AlarmTopicArn', alarmTopic.topicArn);
  }
}

function visibility(metricName: string) {
  return { sampledRequestsEnabled: true, cloudWatchMetricsEnabled: true, metricName };
}

/**
 * A placeholder for a secret field that a person fills in after deploying. Not a
 * secret itself, so plain text in the template is fine; CDK never overwrites the
 * real value later because the secret's value is only set when it is created.
 */
function cdkUnset(value = 'unset') {
  return SecretValue.unsafePlainText(value);
}

function alarm(
  scope: Construct,
  id: string,
  metric: cw.IMetric,
  threshold: number,
  description: string,
  action: cw.IAlarmAction,
  evaluationPeriods = 1,
) {
  new cw.Alarm(scope, id, {
    metric,
    threshold,
    evaluationPeriods,
    comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    alarmDescription: description,
    treatMissingData: cw.TreatMissingData.NOT_BREACHING,
  }).addAlarmAction(action);
}
