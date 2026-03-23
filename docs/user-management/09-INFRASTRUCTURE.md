# Chapter 9: AWS Infrastructure

## Implementation Status

> **Not yet implemented.** This chapter is a design document for future work. The current implementation runs entirely on the existing Aurora + Cognito + Next.js stack with no additional AWS services. DynamoDB, Kinesis, Lambda, S3 (for exports/avatars), SES, and EventBridge resources described here are future additions needed for usage metering (Ch 4), quotas (Ch 5), analytics (Ch 6), and compliance (Ch 8).

## 9.1 Architecture Overview

The user/usage management system adds three new AWS services on top of the existing Aurora + Cognito stack:

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Existing Stack                                │
│                                                                      │
│  ┌────────────┐     ┌──────────────────┐     ┌───────────────────┐  │
│  │  Cognito    │     │  Aurora           │     │  Next.js          │  │
│  │  User Pool  │     │  Serverless v2    │     │  (Vercel/Lambda)  │  │
│  └────────────┘     └──────────────────┘     └───────────────────┘  │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│                         New Services                                  │
│                                                                      │
│  ┌────────────────┐  ┌───────────────┐  ┌─────────────────────────┐ │
│  │  DynamoDB       │  │  Kinesis       │  │  Lambda Functions       │ │
│  │                 │  │  Data Stream   │  │                         │ │
│  │  • usage_events │  │                │  │  • usage-consumer       │ │
│  │  • rate_limits  │  │  Shard count:  │  │  • usage-aggregator     │ │
│  │  • usage_cntrs  │  │  1 (auto-scale)│  │  • data-export          │ │
│  │                 │  │                │  │  • data-retention        │ │
│  │  On-demand      │  │  On-demand     │  │  • purge-expired-users  │ │
│  │  capacity       │  │  capacity      │  │  • report-scheduler     │ │
│  └────────────────┘  └───────────────┘  └─────────────────────────┘ │
│                                                                      │
│  ┌────────────────┐  ┌───────────────┐                               │
│  │  S3             │  │  SES           │                              │
│  │                 │  │                │                              │
│  │  • data-exports │  │  Invitations   │                              │
│  │  • avatars      │  │  Quota alerts  │                              │
│  │                 │  │  Export ready   │                              │
│  └────────────────┘  └───────────────┘                               │
│                                                                      │
│  ┌────────────────┐  ┌───────────────┐                               │
│  │  EventBridge    │  │  CloudWatch    │                              │
│  │                 │  │                │                              │
│  │  Cron schedules │  │  Alarms        │                              │
│  │  for Lambdas    │  │  Dashboards    │                              │
│  └────────────────┘  └───────────────┘                               │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## 9.2 DynamoDB Tables

### Table: `myagency-usage-events`

Stores raw usage events. High write throughput, TTL-based cleanup.

```typescript
// CDK Definition
const usageEventsTable = new dynamodb.Table(this, "UsageEvents", {
  tableName: "myagency-usage-events",
  partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
  sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  timeToLiveAttribute: "ttl",
  pointInTimeRecovery: true,
  removalPolicy: cdk.RemovalPolicy.RETAIN,
});

// GSI: Query by userId
usageEventsTable.addGlobalSecondaryIndex({
  indexName: "UserIndex",
  partitionKey: { name: "GSI1PK", type: dynamodb.AttributeType.STRING },
  sortKey: { name: "GSI1SK", type: dynamodb.AttributeType.STRING },
  projectionType: dynamodb.ProjectionType.ALL,
});

// GSI: Query by org + category
usageEventsTable.addGlobalSecondaryIndex({
  indexName: "CategoryIndex",
  partitionKey: { name: "GSI2PK", type: dynamodb.AttributeType.STRING },
  sortKey: { name: "GSI2SK", type: dynamodb.AttributeType.STRING },
  projectionType: dynamodb.ProjectionType.KEYS_ONLY,
});
```

### Table: `myagency-rate-limits`

Stores sliding-window rate limit counters. Short-lived items with TTL.

```typescript
const rateLimitTable = new dynamodb.Table(this, "RateLimits", {
  tableName: "myagency-rate-limits",
  partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
  sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  timeToLiveAttribute: "ttl",
  removalPolicy: cdk.RemovalPolicy.DESTROY, // Ephemeral data, no backup needed
});
```

### Table: `myagency-usage-counters`

Stores monthly aggregated counters for quota enforcement.

```typescript
const usageCounterTable = new dynamodb.Table(this, "UsageCounters", {
  tableName: "myagency-usage-counters",
  partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
  sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  timeToLiveAttribute: "ttl",
  removalPolicy: cdk.RemovalPolicy.RETAIN,
});
```

## 9.3 Kinesis Data Stream

The ingestion stream buffers usage events between the API layer and the DynamoDB consumer Lambda.

```typescript
const usageStream = new kinesis.Stream(this, "UsageStream", {
  streamName: "myagency-usage-events",
  streamMode: kinesis.StreamMode.ON_DEMAND,
  retentionPeriod: cdk.Duration.hours(24),
  encryption: kinesis.StreamEncryption.MANAGED,
});
```

### Why Kinesis Instead of Direct DynamoDB Writes?

| Concern | Direct DynamoDB Write | Kinesis → Lambda → DynamoDB |
|---------|----------------------|---------------------------|
| API latency impact | 5-15ms added per request | 0ms (async putRecord) |
| Error handling | Must handle throttle/failure in hot path | Kinesis retries automatically |
| Batching | Must implement in-process batching | Lambda processes 25+ records per batch |
| Ordering | No guarantee | Per-partition ordering (by orgId) |
| Cost at 1M events/day | ~$1.25 (DynamoDB WCU) | ~$0.40 (Kinesis) + ~$0.20 (Lambda) + ~$1.25 (DynamoDB) |

For low-volume deployments (< 10K events/day), direct DynamoDB writes are simpler and cheaper. The emitter in Chapter 4 supports both modes.

## 9.4 Lambda Functions

### Usage Consumer (Kinesis → DynamoDB)

```typescript
const usageConsumer = new lambda.Function(this, "UsageConsumer", {
  functionName: "myagency-usage-consumer",
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: "index.handler",
  code: lambda.Code.fromAsset("lambda/usage-consumer"),
  timeout: cdk.Duration.seconds(60),
  memorySize: 256,
  environment: {
    USAGE_EVENTS_TABLE: usageEventsTable.tableName,
    USAGE_COUNTERS_TABLE: usageCounterTable.tableName,
  },
});

// Kinesis event source
usageConsumer.addEventSource(
  new lambdaEventSources.KinesisEventSource(usageStream, {
    batchSize: 100,
    startingPosition: lambda.StartingPosition.LATEST,
    maxBatchingWindow: cdk.Duration.seconds(5),
    retryAttempts: 3,
    bisectBatchOnError: true,
    reportBatchItemFailures: true,
  })
);

usageEventsTable.grantWriteData(usageConsumer);
usageCounterTable.grantReadWriteData(usageConsumer);
```

### Usage Aggregator (DynamoDB → Aurora)

```typescript
const usageAggregator = new lambda.Function(this, "UsageAggregator", {
  functionName: "myagency-usage-aggregator",
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: "index.handler",
  code: lambda.Code.fromAsset("lambda/usage-aggregator"),
  timeout: cdk.Duration.minutes(5),
  memorySize: 512,
  environment: {
    USAGE_EVENTS_TABLE: usageEventsTable.tableName,
    AURORA_CLUSTER_ARN: auroraCluster.clusterArn,
    AURORA_SECRET_ARN: auroraCluster.secret!.secretArn,
    AURORA_DATABASE: "mayfly",
  },
  vpc,
  vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
});

// Schedule: every 5 minutes
new events.Rule(this, "AggregatorSchedule", {
  schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
  targets: [new targets.LambdaFunction(usageAggregator)],
});

usageEventsTable.grantReadData(usageAggregator);
auroraCluster.grantDataApiAccess(usageAggregator);
```

### Data Export (on-demand)

```typescript
const dataExportFn = new lambda.Function(this, "DataExport", {
  functionName: "myagency-data-export",
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: "index.handler",
  code: lambda.Code.fromAsset("lambda/data-export"),
  timeout: cdk.Duration.minutes(10),
  memorySize: 1024,
  environment: {
    AURORA_CLUSTER_ARN: auroraCluster.clusterArn,
    AURORA_SECRET_ARN: auroraCluster.secret!.secretArn,
    AURORA_DATABASE: "mayfly",
    USAGE_EVENTS_TABLE: usageEventsTable.tableName,
    EXPORT_BUCKET: exportBucket.bucketName,
  },
  vpc,
  vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
});

exportBucket.grantReadWrite(dataExportFn);
auroraCluster.grantDataApiAccess(dataExportFn);
usageEventsTable.grantReadData(dataExportFn);
```

### Data Retention (scheduled cleanup)

```typescript
const dataRetentionFn = new lambda.Function(this, "DataRetention", {
  functionName: "myagency-data-retention",
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: "index.handler",
  code: lambda.Code.fromAsset("lambda/data-retention"),
  timeout: cdk.Duration.minutes(10),
  memorySize: 512,
  environment: {
    AURORA_CLUSTER_ARN: auroraCluster.clusterArn,
    AURORA_SECRET_ARN: auroraCluster.secret!.secretArn,
    AURORA_DATABASE: "mayfly",
  },
  vpc,
  vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
});

// Schedule: daily at 3 AM UTC
new events.Rule(this, "RetentionSchedule", {
  schedule: events.Schedule.cron({ hour: "3", minute: "0" }),
  targets: [new targets.LambdaFunction(dataRetentionFn)],
});
```

### Purge Expired Users (scheduled)

```typescript
const purgeUsersFn = new lambda.Function(this, "PurgeExpiredUsers", {
  functionName: "myagency-purge-users",
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: "index.handler",
  code: lambda.Code.fromAsset("lambda/purge-expired-users"),
  timeout: cdk.Duration.minutes(10),
  memorySize: 512,
  environment: {
    AURORA_CLUSTER_ARN: auroraCluster.clusterArn,
    AURORA_SECRET_ARN: auroraCluster.secret!.secretArn,
    AURORA_DATABASE: "mayfly",
    COGNITO_USER_POOL_ID: userPool.userPoolId,
    USAGE_EVENTS_TABLE: usageEventsTable.tableName,
    EXPORT_BUCKET: exportBucket.bucketName,
  },
  vpc,
  vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
});

// Schedule: daily at 4 AM UTC
new events.Rule(this, "PurgeSchedule", {
  schedule: events.Schedule.cron({ hour: "4", minute: "0" }),
  targets: [new targets.LambdaFunction(purgeUsersFn)],
});
```

## 9.5 S3 Buckets

```typescript
const exportBucket = new s3.Bucket(this, "ExportBucket", {
  bucketName: `myagency-data-exports-${cdk.Aws.ACCOUNT_ID}`,
  encryption: s3.BucketEncryption.S3_MANAGED,
  enforceSSL: true,
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
  lifecycleRules: [
    {
      // Auto-delete export files after 7 days
      id: "expire-exports",
      expiration: cdk.Duration.days(7),
      enabled: true,
    },
  ],
  removalPolicy: cdk.RemovalPolicy.RETAIN,
});

const avatarBucket = new s3.Bucket(this, "AvatarBucket", {
  bucketName: `myagency-avatars-${cdk.Aws.ACCOUNT_ID}`,
  encryption: s3.BucketEncryption.S3_MANAGED,
  enforceSSL: true,
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
  removalPolicy: cdk.RemovalPolicy.RETAIN,
});
```

## 9.6 SES (Email)

```typescript
const sesIdentity = new ses.EmailIdentity(this, "EmailIdentity", {
  identity: ses.Identity.domain("myagency.example.com"),
});

// Grant SES permissions to Lambdas that send email
const sesSendPolicy = new iam.PolicyStatement({
  actions: ["ses:SendEmail", "ses:SendRawEmail"],
  resources: ["*"],
  conditions: {
    StringEquals: {
      "ses:FromAddress": [
        "noreply@myagency.example.com",
        "support@myagency.example.com",
      ],
    },
  },
});
```

### Email Templates

| Template | Trigger | Recipient |
|----------|---------|-----------|
| `invitation` | Admin invites a user | Invitee email |
| `quota-warning-75` | Org hits 75% of a quota | Org owner |
| `quota-warning-90` | Org hits 90% of a quota | Org owner |
| `quota-exceeded` | Org hits 100% of a quota | Org owner + admins |
| `export-ready` | Data export completed | Requesting user |
| `account-suspended` | Admin suspends a user | Suspended user |
| `account-deletion-scheduled` | User soft-deletes account | User |
| `account-purged` | Account data erased | User (final notice) |
| `weekly-report` | Scheduled report | Configured recipients |

## 9.7 CloudWatch Monitoring

### Alarms

```typescript
// Aurora capacity
new cloudwatch.Alarm(this, "AuroraHighCapacity", {
  metric: auroraCluster.metricACUUtilization(),
  threshold: 80,
  evaluationPeriods: 3,
  comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
  actionsEnabled: true,
  alarmActions: [snsTopic],
});

// DynamoDB throttling
new cloudwatch.Alarm(this, "DynamoThrottles", {
  metric: usageEventsTable.metricThrottledRequestsForOperations({
    operations: [dynamodb.Operation.PUT_ITEM],
  }),
  threshold: 10,
  evaluationPeriods: 1,
  actionsEnabled: true,
  alarmActions: [snsTopic],
});

// Lambda errors
new cloudwatch.Alarm(this, "AggregatorErrors", {
  metric: usageAggregator.metricErrors(),
  threshold: 5,
  evaluationPeriods: 1,
  actionsEnabled: true,
  alarmActions: [snsTopic],
});

// Kinesis iterator age (processing lag)
new cloudwatch.Alarm(this, "KinesisLag", {
  metric: usageStream.metricGetRecordsIteratorAgeMilliseconds(),
  threshold: 60_000, // 1 minute
  evaluationPeriods: 3,
  actionsEnabled: true,
  alarmActions: [snsTopic],
});
```

### Custom Metrics

```typescript
// Publish custom metrics from application code

import { CloudWatchClient, PutMetricDataCommand } from "@aws-sdk/client-cloudwatch";

export async function publishMetric(
  namespace: string,
  metricName: string,
  value: number,
  dimensions: Record<string, string> = {}
) {
  await cloudwatch.send(
    new PutMetricDataCommand({
      Namespace: namespace,
      MetricData: [{
        MetricName: metricName,
        Value: value,
        Unit: "Count",
        Dimensions: Object.entries(dimensions).map(([Name, Value]) => ({ Name, Value })),
        Timestamp: new Date(),
      }],
    })
  );
}

// Usage:
// publishMetric("MyAgency/Usage", "APICallCount", 1, { OrgId: orgId });
// publishMetric("MyAgency/Auth", "LoginCount", 1, { Method: "password" });
// publishMetric("MyAgency/Quota", "QuotaExceeded", 1, { Quota: "aiTokens", Plan: "free" });
```

## 9.8 Cost Estimate

Monthly cost estimate at different scales:

| Component | 10K events/day | 100K events/day | 1M events/day |
|-----------|---------------|-----------------|---------------|
| **DynamoDB (usage events)** | $2 | $15 | $40 |
| **DynamoDB (rate limits)** | $1 | $5 | $15 |
| **DynamoDB (counters)** | $0.50 | $2 | $5 |
| **Kinesis** | $4 | $4 | $12 |
| **Lambda (consumer)** | $0.50 | $3 | $25 |
| **Lambda (aggregator)** | $1 | $2 | $5 |
| **Lambda (scheduled)** | $0.50 | $0.50 | $0.50 |
| **S3 (exports)** | $0.10 | $0.50 | $2 |
| **SES** | $0.10 | $1 | $10 |
| **CloudWatch** | $3 | $5 | $10 |
| **Aurora (additional ACU)** | $0 | $10 | $30 |
| **Total** | **~$13/mo** | **~$48/mo** | **~$155/mo** |

Note: Aurora Serverless v2 cost is the _incremental_ load from analytics queries. The base cluster cost is already part of the existing stack.

## 9.9 CDK Stack Integration

All new resources are added to the existing `MayflyStack` or a separate nested stack:

```typescript
// cdk/lib/user-management-stack.ts

import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as kinesis from "aws-cdk-lib/aws-kinesis";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as s3 from "aws-cdk-lib/aws-s3";

interface UserManagementStackProps extends cdk.NestedStackProps {
  auroraCluster: rds.DatabaseCluster;
  userPool: cognito.UserPool;
  vpc: ec2.IVpc;
}

export class UserManagementStack extends cdk.NestedStack {
  constructor(scope: Construct, id: string, props: UserManagementStackProps) {
    super(scope, id, props);

    // ... all resources defined above ...

    // Outputs
    new cdk.CfnOutput(this, "UsageEventsTable", { value: usageEventsTable.tableName });
    new cdk.CfnOutput(this, "RateLimitTable", { value: rateLimitTable.tableName });
    new cdk.CfnOutput(this, "UsageCountersTable", { value: usageCounterTable.tableName });
    new cdk.CfnOutput(this, "UsageStreamName", { value: usageStream.streamName });
    new cdk.CfnOutput(this, "ExportBucketName", { value: exportBucket.bucketName });
  }
}
```

## 9.10 Environment Variables

New environment variables required by the Next.js application:

```bash
# DynamoDB
USAGE_EVENTS_TABLE=myagency-usage-events
RATE_LIMIT_TABLE=myagency-rate-limits
USAGE_COUNTER_TABLE=myagency-usage-counters

# Kinesis
USAGE_KINESIS_STREAM=myagency-usage-events

# S3
EXPORT_BUCKET=myagency-data-exports-123456789012
AVATAR_BUCKET=myagency-avatars-123456789012

# SES
SES_FROM_ADDRESS=noreply@myagency.example.com

# Feature toggles
USE_KINESIS=true              # false = direct DynamoDB writes
RATE_LIMITING_ENABLED=true    # false = skip rate limit checks
USAGE_TRACKING_ENABLED=true   # false = skip event emission
```
