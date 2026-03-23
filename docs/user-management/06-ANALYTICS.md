# Chapter 6: Analytics & Reporting Engine

## Implementation Status

> **Not yet implemented.** This chapter is a design document for future work. It requires the usage metering pipeline (Chapter 4), aggregation Lambda (Chapter 9), and RBAC/org model. No analytics code has been written.

## 6.1 Analytics Scope

The analytics engine answers three categories of questions:

| Category | Example Questions | Audience |
|----------|-------------------|----------|
| **Operational** | How many API calls today? Which endpoint is slowest? | Platform team |
| **Business** | What's our retention rate? Which plan tier has highest engagement? | Product / leadership |
| **User-facing** | How much have I used this month? What's my team's activity? | Org owners, admins |

This chapter focuses on the user-facing and business analytics. Infrastructure monitoring (CloudWatch) is covered in Chapter 9.

## 6.2 Metrics Taxonomy

### 6.2.1 Engagement Metrics

| Metric | Definition | Granularity |
|--------|-----------|-------------|
| **DAU** | Distinct users with >= 1 API call in a day | Daily |
| **WAU** | Distinct users active in trailing 7 days | Daily (rolling) |
| **MAU** | Distinct users active in trailing 30 days | Daily (rolling) |
| **DAU/MAU Ratio** | Stickiness — what % of monthly users return daily | Daily |
| **Session Duration** | Median time between first and last API call per session | Per session |
| **Actions per Session** | Median API calls per session | Per session |
| **Feature Adoption** | % of MAU who used a specific feature | Monthly |

### 6.2.2 Growth Metrics

| Metric | Definition | Granularity |
|--------|-----------|-------------|
| **New Users** | Users created in period | Daily/weekly/monthly |
| **New Orgs** | Orgs created in period | Daily/weekly/monthly |
| **Invitations Sent** | Total invitations issued | Daily |
| **Invitation Acceptance Rate** | Accepted / sent | Monthly |
| **Churn Rate** | Users who became inactive (no activity for 30 days) / MAU | Monthly |
| **Net Revenue Retention** | (Starting MRR + expansion - contraction - churn) / Starting MRR | Monthly |

### 6.2.3 Usage Metrics

| Metric | Definition | Granularity |
|--------|-----------|-------------|
| **API Calls** | Total authenticated requests | Hourly/daily/monthly |
| **AI Token Consumption** | Input + output tokens | Hourly/daily/monthly |
| **AI Cost** | Estimated Bedrock cost | Daily/monthly |
| **Storage** | Total bytes stored per org | Daily snapshot |
| **Conversations** | New AI conversations started | Daily |
| **Projects** | New projects created | Daily |

### 6.2.4 Health Metrics

| Metric | Definition | Granularity |
|--------|-----------|-------------|
| **Error Rate** | 4xx + 5xx responses / total requests | Hourly |
| **P50/P95/P99 Latency** | API response time percentiles | Hourly |
| **Rate Limit Hits** | 429 responses / total requests | Hourly |
| **Quota Utilization** | % of monthly quota consumed | Daily |

## 6.3 Materialized Analytics Tables

Pre-computed tables that power dashboards. Updated by the aggregation Lambda (Chapter 4).

```sql
-- 013_create_analytics_tables.sql

-- Daily active user snapshots
CREATE TABLE analytics_dau (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID REFERENCES organizations(id),   -- NULL = platform-wide
  day         DATE NOT NULL,
  active_users INTEGER NOT NULL DEFAULT 0,
  new_users    INTEGER NOT NULL DEFAULT 0,
  returning_users INTEGER NOT NULL DEFAULT 0,
  churned_users INTEGER NOT NULL DEFAULT 0,         -- Active last period, inactive this period

  UNIQUE (org_id, day)
);

CREATE INDEX idx_analytics_dau_org_day ON analytics_dau(org_id, day);

-- Weekly/Monthly engagement rollups
CREATE TABLE analytics_engagement (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID REFERENCES organizations(id),
  period_type TEXT NOT NULL CHECK (period_type IN ('weekly', 'monthly')),
  period_start DATE NOT NULL,
  dau_avg     NUMERIC(10,2) NOT NULL DEFAULT 0,
  wau         INTEGER NOT NULL DEFAULT 0,
  mau         INTEGER NOT NULL DEFAULT 0,
  stickiness  NUMERIC(5,4) NOT NULL DEFAULT 0,      -- DAU/MAU ratio
  avg_session_duration_s INTEGER NOT NULL DEFAULT 0,
  avg_actions_per_session NUMERIC(10,2) NOT NULL DEFAULT 0,
  retention_d1  NUMERIC(5,4),                        -- Day-1 retention
  retention_d7  NUMERIC(5,4),                        -- Day-7 retention
  retention_d30 NUMERIC(5,4),                        -- Day-30 retention

  UNIQUE (org_id, period_type, period_start)
);

CREATE INDEX idx_analytics_engagement ON analytics_engagement(org_id, period_type, period_start);

-- User engagement scores (computed per-user)
CREATE TABLE analytics_user_engagement (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id),
  user_id     UUID NOT NULL REFERENCES users(id),
  month       DATE NOT NULL,
  engagement_score INTEGER NOT NULL DEFAULT 0,        -- 0-100
  activity_days INTEGER NOT NULL DEFAULT 0,
  total_actions INTEGER NOT NULL DEFAULT 0,
  ai_conversations INTEGER NOT NULL DEFAULT 0,
  projects_touched INTEGER NOT NULL DEFAULT 0,
  features_used TEXT[] NOT NULL DEFAULT '{}',
  segment     TEXT NOT NULL DEFAULT 'inactive',       -- power / active / casual / at_risk / inactive

  UNIQUE (org_id, user_id, month)
);

CREATE INDEX idx_analytics_user_engagement ON analytics_user_engagement(org_id, month, segment);

-- Cohort analysis snapshots
CREATE TABLE analytics_cohorts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID REFERENCES organizations(id),
  cohort_month DATE NOT NULL,                         -- Month the cohort was created
  period_month DATE NOT NULL,                         -- Month being measured
  cohort_size  INTEGER NOT NULL,
  active_count INTEGER NOT NULL,
  retention_rate NUMERIC(5,4) NOT NULL,

  UNIQUE (org_id, cohort_month, period_month)
);

CREATE INDEX idx_analytics_cohorts ON analytics_cohorts(org_id, cohort_month);

-- Feature adoption tracking
CREATE TABLE analytics_feature_adoption (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID REFERENCES organizations(id),
  month       DATE NOT NULL,
  feature     TEXT NOT NULL,
  unique_users INTEGER NOT NULL DEFAULT 0,
  total_events INTEGER NOT NULL DEFAULT 0,
  adoption_rate NUMERIC(5,4) NOT NULL DEFAULT 0,      -- unique_users / MAU

  UNIQUE (org_id, month, feature)
);

CREATE INDEX idx_analytics_feature_adoption ON analytics_feature_adoption(org_id, month);

-- RLS on all analytics tables
ALTER TABLE analytics_dau ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_dau FORCE ROW LEVEL SECURITY;
CREATE POLICY analytics_dau_org ON analytics_dau
  USING (org_id::text = current_setting('app.tenant_id', true) OR org_id IS NULL);

ALTER TABLE analytics_engagement ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_engagement FORCE ROW LEVEL SECURITY;
CREATE POLICY analytics_engagement_org ON analytics_engagement
  USING (org_id::text = current_setting('app.tenant_id', true) OR org_id IS NULL);

ALTER TABLE analytics_user_engagement ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_user_engagement FORCE ROW LEVEL SECURITY;
CREATE POLICY analytics_user_engagement_org ON analytics_user_engagement
  USING (org_id::text = current_setting('app.tenant_id', true));

ALTER TABLE analytics_cohorts ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_cohorts FORCE ROW LEVEL SECURITY;
CREATE POLICY analytics_cohorts_org ON analytics_cohorts
  USING (org_id::text = current_setting('app.tenant_id', true) OR org_id IS NULL);

ALTER TABLE analytics_feature_adoption ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_feature_adoption FORCE ROW LEVEL SECURITY;
CREATE POLICY analytics_feature_adoption_org ON analytics_feature_adoption
  USING (org_id::text = current_setting('app.tenant_id', true) OR org_id IS NULL);
```

## 6.4 Engagement Scoring Algorithm

Every user receives a monthly engagement score (0-100) based on weighted activity signals. The score determines their segment.

```typescript
// src/services/analytics-service.ts (scoring section)

interface EngagementSignals {
  activeDays: number;          // Days with at least 1 action
  totalActions: number;        // Total API calls
  aiConversations: number;     // New conversations started
  projectsTouched: number;     // Unique projects interacted with
  featuresUsed: number;        // Count of distinct features used
  sessionCount: number;        // Number of sessions
  avgSessionDuration: number;  // Average session length in minutes
}

const SIGNAL_WEIGHTS = {
  activeDays:         0.25,    // Most important: frequency
  totalActions:       0.10,    // Volume
  aiConversations:    0.15,    // Core product engagement
  projectsTouched:    0.15,    // Breadth of engagement
  featuresUsed:       0.15,    // Feature exploration
  sessionCount:       0.10,    // Return visits
  avgSessionDuration: 0.10,    // Depth per visit
};

// Normalization benchmarks (what "100%" looks like)
const SIGNAL_BENCHMARKS = {
  activeDays:         20,      // 20 of ~22 working days
  totalActions:       500,     // ~25 actions/day
  aiConversations:    30,      // ~1.5/day
  projectsTouched:    10,      // 10 unique projects
  featuresUsed:       8,       // 8 of ~12 tracked features
  sessionCount:       40,      // ~2 sessions/day
  avgSessionDuration: 30,      // 30 minutes average
};

export function calculateEngagementScore(signals: EngagementSignals): number {
  let score = 0;

  for (const [key, weight] of Object.entries(SIGNAL_WEIGHTS)) {
    const value = signals[key as keyof EngagementSignals];
    const benchmark = SIGNAL_BENCHMARKS[key as keyof typeof SIGNAL_BENCHMARKS];
    const normalized = Math.min(value / benchmark, 1.0); // Cap at 100%
    score += normalized * weight * 100;
  }

  return Math.round(Math.min(score, 100));
}

export type UserSegment = "power" | "active" | "casual" | "at_risk" | "inactive";

export function classifyUser(score: number, activeDays: number): UserSegment {
  if (activeDays === 0) return "inactive";
  if (score >= 70) return "power";
  if (score >= 40) return "active";
  if (score >= 15) return "casual";
  return "at_risk";
}
```

### Segment Definitions

| Segment | Score Range | Description | Typical Action |
|---------|------------|-------------|----------------|
| **Power** | 70-100 | Daily users, heavy AI usage, explore features | Upsell to higher plan |
| **Active** | 40-69 | Regular usage, moderate engagement | Nurture with tips, feature highlights |
| **Casual** | 15-39 | Occasional usage, limited features | Re-engagement campaigns |
| **At Risk** | 1-14 | Very low activity despite recent login | Churn prevention outreach |
| **Inactive** | 0 | No activity in measurement period | Win-back campaigns |

## 6.5 Cohort Retention Analysis

Cohort analysis tracks how groups of users (who signed up in the same month) retain over time.

```typescript
// src/services/analytics-service.ts (cohort section)

export async function getCohortRetention(
  tx: TransactionClient,
  orgId: string | null,       // null = platform-wide
  startMonth: string,         // "2025-06"
  endMonth: string            // "2026-03"
): Promise<CohortMatrix> {
  const rows = await tx
    .select()
    .from(analyticsCohorts)
    .where(
      and(
        orgId ? eq(analyticsCohorts.orgId, orgId) : sql`true`,
        gte(analyticsCohorts.cohortMonth, new Date(`${startMonth}-01`)),
        lte(analyticsCohorts.periodMonth, new Date(`${endMonth}-01`))
      )
    )
    .orderBy(analyticsCohorts.cohortMonth, analyticsCohorts.periodMonth);

  return buildCohortMatrix(rows);
}
```

### Cohort Matrix Output Format

```json
{
  "cohorts": [
    {
      "month": "2025-10",
      "size": 45,
      "retention": [1.0, 0.72, 0.58, 0.51, 0.44, 0.41]
    },
    {
      "month": "2025-11",
      "size": 62,
      "retention": [1.0, 0.68, 0.55, 0.48, 0.43]
    },
    {
      "month": "2025-12",
      "size": 38,
      "retention": [1.0, 0.74, 0.61, 0.53]
    }
  ]
}
```

Rendered as a retention heatmap:

```
         Month 0   Month 1   Month 2   Month 3   Month 4   Month 5
Oct 25   100%      72%       58%       51%       44%       41%
Nov 25   100%      68%       55%       48%       43%
Dec 25   100%      74%       61%       53%
Jan 26   100%      71%       59%
Feb 26   100%      69%
Mar 26   100%

Colors:  ██ >70%   ▓▓ 50-70%   ░░ 30-50%   ·· <30%
```

## 6.6 Analytics Query Service

```typescript
// src/services/analytics-service.ts (queries section)

export async function getDashboardMetrics(
  tx: TransactionClient,
  orgId: string,
  period: "7d" | "30d" | "90d"
): Promise<DashboardMetrics> {
  const startDate = getStartDate(period);

  const [engagement, usage, growth, health] = await Promise.all([
    getEngagementMetrics(tx, orgId, startDate),
    getUsageMetrics(tx, orgId, startDate),
    getGrowthMetrics(tx, orgId, startDate),
    getHealthMetrics(tx, orgId, startDate),
  ]);

  return { engagement, usage, growth, health };
}

interface DashboardMetrics {
  engagement: {
    dau: number;
    dauTrend: number;           // % change vs prior period
    mau: number;
    mauTrend: number;
    stickiness: number;         // DAU/MAU
    stickinessTrend: number;
    avgSessionDuration: number;
  };
  usage: {
    apiCalls: number;
    apiCallsTrend: number;
    aiTokens: number;
    aiTokensTrend: number;
    aiCost: number;
    storageBytes: number;
    newConversations: number;
    newProjects: number;
  };
  growth: {
    newUsers: number;
    newUsersTrend: number;
    invitationsSent: number;
    acceptanceRate: number;
    churnRate: number;
  };
  health: {
    errorRate: number;
    p50Latency: number;
    p95Latency: number;
    rateLimitHits: number;
    quotaUtilization: Record<string, number>;
  };
}

async function getEngagementMetrics(
  tx: TransactionClient,
  orgId: string,
  startDate: Date
) {
  const priorStartDate = getPriorPeriodStart(startDate);

  // Current period
  const current = await tx
    .select({
      dau: sql<number>`avg(active_users)::int`,
    })
    .from(analyticsDau)
    .where(
      and(
        eq(analyticsDau.orgId, orgId),
        gte(analyticsDau.day, startDate)
      )
    );

  // Prior period for trend
  const prior = await tx
    .select({
      dau: sql<number>`avg(active_users)::int`,
    })
    .from(analyticsDau)
    .where(
      and(
        eq(analyticsDau.orgId, orgId),
        gte(analyticsDau.day, priorStartDate),
        lt(analyticsDau.day, startDate)
      )
    );

  const currentDau = current[0]?.dau ?? 0;
  const priorDau = prior[0]?.dau ?? 0;
  const dauTrend = priorDau > 0
    ? Math.round(((currentDau - priorDau) / priorDau) * 100)
    : 0;

  return { dau: currentDau, dauTrend /* ... other metrics ... */ };
}
```

## 6.7 User Activity Timeline

A per-user timeline showing their recent actions, useful for admin/support tools and user profile pages.

```typescript
// src/services/analytics-service.ts (timeline section)

interface ActivityTimelineEntry {
  timestamp: string;
  action: string;
  resource: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}

export async function getUserActivityTimeline(
  tx: TransactionClient,
  orgId: string,
  userId: string,
  limit: number = 50
): Promise<ActivityTimelineEntry[]> {
  // Query the audit log for recent actions by this user
  return tx
    .select({
      timestamp: auditLog.createdAt,
      action: auditLog.action,
      resource: auditLog.resource,
      resourceId: auditLog.resourceId,
      metadata: auditLog.metadata,
    })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.orgId, orgId),
        eq(auditLog.userId, userId)
      )
    )
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
}
```

## 6.8 Export & Scheduled Reports

### Export Formats

| Format | Use Case |
|--------|----------|
| CSV | Spreadsheet analysis, Excel import |
| JSON | API consumption, programmatic analysis |
| PDF | Executive reports (generated via headless browser) |

### Export API

```typescript
// app/api/orgs/[orgId]/analytics/export/route.ts

export const POST = secureHandler(
  async (request, tx, { orgId }) => {
    const { reportType, format, dateRange } = await request.json();

    // reportType: "usage" | "engagement" | "cohorts" | "users"
    // format: "csv" | "json"
    // dateRange: { start: string, end: string }

    const data = await generateReport(tx, orgId, reportType, dateRange);
    const formatted = format === "csv" ? toCSV(data) : JSON.stringify(data);

    return new Response(formatted, {
      headers: {
        "Content-Type": format === "csv" ? "text/csv" : "application/json",
        "Content-Disposition": `attachment; filename="${reportType}-${dateRange.start}-${dateRange.end}.${format}"`,
      },
    });
  },
  { permission: "analytics:export" }
);
```

### Scheduled Reports

Org admins can configure weekly/monthly reports delivered by email.

```sql
CREATE TABLE scheduled_reports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by  UUID NOT NULL REFERENCES users(id),
  report_type TEXT NOT NULL,
  frequency   TEXT NOT NULL CHECK (frequency IN ('weekly', 'monthly')),
  recipients  TEXT[] NOT NULL,             -- Email addresses
  format      TEXT NOT NULL DEFAULT 'csv',
  filters     JSONB DEFAULT '{}',
  enabled     BOOLEAN NOT NULL DEFAULT true,
  last_sent_at TIMESTAMPTZ,
  next_send_at TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

## 6.9 API Route Structure

```
app/api/orgs/[orgId]/analytics/
├── dashboard/route.ts           # GET — dashboard metrics (7d/30d/90d)
├── engagement/route.ts          # GET — engagement metrics + trends
├── users/
│   ├── route.ts                 # GET — user engagement scores + segments
│   └── [userId]/
│       ├── route.ts             # GET — individual user engagement detail
│       └── timeline/route.ts    # GET — user activity timeline
├── cohorts/route.ts             # GET — cohort retention matrix
├── features/route.ts            # GET — feature adoption rates
├── export/route.ts              # POST — generate export
└── reports/
    ├── route.ts                 # GET/POST — scheduled reports CRUD
    └── [reportId]/route.ts      # PATCH/DELETE — manage scheduled report
```

## 6.10 Client-Side Hooks

```typescript
// src/hooks/use-analytics.ts

"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/src/lib/api-client";

export function useDashboardMetrics(period: "7d" | "30d" | "90d" = "30d") {
  return useQuery({
    queryKey: ["analytics", "dashboard", period],
    queryFn: async () => {
      const res = await apiFetch(`/api/orgs/current/analytics/dashboard?period=${period}`);
      if (!res.ok) throw new Error("Failed to fetch dashboard metrics");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,  // 5 minutes
  });
}

export function useUserSegments(month: string) {
  return useQuery({
    queryKey: ["analytics", "segments", month],
    queryFn: async () => {
      const res = await apiFetch(`/api/orgs/current/analytics/users?month=${month}`);
      if (!res.ok) throw new Error("Failed to fetch user segments");
      return res.json();
    },
  });
}

export function useCohortRetention(startMonth: string, endMonth: string) {
  return useQuery({
    queryKey: ["analytics", "cohorts", startMonth, endMonth],
    queryFn: async () => {
      const res = await apiFetch(
        `/api/orgs/current/analytics/cohorts?start=${startMonth}&end=${endMonth}`
      );
      if (!res.ok) throw new Error("Failed to fetch cohort data");
      return res.json();
    },
  });
}

export function useFeatureAdoption(month: string) {
  return useQuery({
    queryKey: ["analytics", "features", month],
    queryFn: async () => {
      const res = await apiFetch(`/api/orgs/current/analytics/features?month=${month}`);
      if (!res.ok) throw new Error("Failed to fetch feature adoption");
      return res.json();
    },
  });
}

export function useUserTimeline(userId: string) {
  return useQuery({
    queryKey: ["analytics", "timeline", userId],
    queryFn: async () => {
      const res = await apiFetch(`/api/orgs/current/analytics/users/${userId}/timeline`);
      if (!res.ok) throw new Error("Failed to fetch timeline");
      return res.json();
    },
    enabled: !!userId,
  });
}
```
