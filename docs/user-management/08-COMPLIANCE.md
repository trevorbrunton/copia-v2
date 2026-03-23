# Chapter 8: Compliance & Data Governance

## Implementation Status

> **Not yet implemented.** This chapter is a design document for future work. Self-service account deletion (soft-delete with 30-day grace period) has been implemented as part of Chapter 2, but the full compliance pipeline (data export, hard purge, consent management, S3/DynamoDB/Cognito cleanup) is not yet built.

## 8.1 Regulatory Scope

The system is designed to satisfy the data handling requirements of:

| Regulation | Key Rights | Applies When |
|------------|-----------|-------------|
| **GDPR** (EU) | Access (Art. 15), Portability (Art. 20), Erasure (Art. 17), Rectification (Art. 16) | Any EU-resident user |
| **CCPA / CPRA** (California) | Know, Delete, Opt-out of sale, Correct | California-resident user |
| **APP** (Australia) | Access (APP 12), Correction (APP 13) | Australian-resident user |

The implementation is unified — the same mechanisms serve all three. The differences are administrative (response deadlines, legal basis documentation), not technical.

## 8.2 Data Inventory

Before implementing compliance features, every table holding personal data must be classified.

### Personal Data Map

| Table | Personal Data Fields | Lawful Basis | Retention |
|-------|---------------------|-------------|-----------|
| `users` | email, name, cognitoId, avatarUrl, ipAddress | Contractual necessity | Account lifetime + 30 days |
| `user_status_history` | userId, ipAddress, changedBy | Legitimate interest (security) | 2 years |
| `user_devices` | deviceId, deviceName, os, browser, lastIp, pushToken | Contractual necessity | Account lifetime |
| `user_sessions` | userId, ipAddress, userAgent, cognitoSub | Legitimate interest (security) | 1 year |
| `org_memberships` | userId | Contractual necessity | Membership lifetime |
| `org_invitations` | email | Consent (invitation accepted) | 90 days after acceptance/expiry |
| `projects` | userId (creator) | Contractual necessity | Org lifetime |
| `chat_conversations` | userId | Contractual necessity | Org lifetime |
| `chat_messages` | userId, content (may contain PII) | Contractual necessity | Org lifetime |
| `audit_log` | userId, ipAddress, metadata | Legitimate interest (security) | 2 years |
| `usage_events` (DynamoDB) | userId, ipAddress | Legitimate interest (analytics) | 90 days (TTL) |
| `usage_*` (Aurora aggregates) | userId | Legitimate interest (analytics) | 2 years |
| `analytics_user_engagement` | userId | Legitimate interest (analytics) | 2 years |
| `impersonation_sessions` | adminUserId, targetUserId | Legitimate interest (support) | 1 year |

## 8.3 Data Subject Rights Implementation

### 8.3.1 Right of Access (Data Export)

A user can request a full export of all their personal data. The export is asynchronous — large datasets are compiled in the background and delivered as a download link.

```sql
-- 014_create_compliance_tables.sql

CREATE TABLE data_export_requests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id),
  org_id      UUID REFERENCES organizations(id),
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'expired', 'downloaded')),
  format      TEXT NOT NULL DEFAULT 'json'
              CHECK (format IN ('json', 'csv')),
  scope       TEXT NOT NULL DEFAULT 'full'
              CHECK (scope IN ('full', 'org')),
  file_key    TEXT,                               -- S3 key for completed export
  file_size   BIGINT,
  expires_at  TIMESTAMPTZ,                        -- Download link expiry
  error       TEXT,
  requested_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  downloaded_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_data_export_user ON data_export_requests(user_id);
```

```typescript
// src/services/compliance-service.ts

export async function requestDataExport(
  tx: TransactionClient,
  userId: string,
  orgId: string | null,
  format: "json" | "csv" = "json",
  scope: "full" | "org" = "full"
) {
  // Rate limit: max 1 export request per 24 hours
  const recent = await tx
    .select()
    .from(dataExportRequests)
    .where(
      and(
        eq(dataExportRequests.userId, userId),
        gte(dataExportRequests.requestedAt, sql`now() - interval '24 hours'`)
      )
    );

  if (recent.length > 0) {
    throw new Error("You can request one data export per 24 hours");
  }

  const [request] = await tx
    .insert(dataExportRequests)
    .values({
      userId,
      orgId,
      format,
      scope,
    })
    .returning();

  // Trigger async export job (Lambda or background task)
  await triggerExportJob(request.id);

  return request;
}
```

### Export Job (Lambda)

```typescript
// lambda/data-export/index.ts

export async function handler(event: { exportRequestId: string }) {
  const request = await getExportRequest(event.exportRequestId);
  const userId = request.userId;

  await updateExportStatus(request.id, "processing");

  try {
    const data = {
      // User profile
      profile: await exportUserProfile(userId),

      // All org memberships
      memberships: await exportMemberships(userId),

      // Projects created by user
      projects: await exportUserProjects(userId, request.orgId),

      // Chat conversations and messages
      conversations: await exportUserConversations(userId, request.orgId),

      // Login history
      loginHistory: await exportSessionHistory(userId),

      // Device list
      devices: await exportDevices(userId),

      // Usage data (from DynamoDB)
      usage: await exportUsageEvents(userId),

      // Audit log entries involving this user
      auditEntries: await exportAuditEntries(userId),

      // Metadata
      _exportInfo: {
        requestedAt: request.requestedAt,
        generatedAt: new Date().toISOString(),
        format: request.format,
        scope: request.scope,
      },
    };

    // Write to S3 (encrypted at rest)
    const fileKey = `exports/${userId}/${request.id}.${request.format}`;
    const formatted = request.format === "json"
      ? JSON.stringify(data, null, 2)
      : convertToCSV(data);

    await uploadToS3(fileKey, formatted);

    // Set 7-day download expiry
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await updateExportRequest(request.id, {
      status: "completed",
      fileKey,
      fileSize: Buffer.byteLength(formatted),
      expiresAt,
      completedAt: new Date(),
    });

    // Notify user
    await sendExportReadyEmail(request.userId, request.id);
  } catch (error) {
    await updateExportRequest(request.id, {
      status: "failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
```

### 8.3.2 Right to Erasure (Right to be Forgotten)

Full data purge. This is the most complex compliance operation because data is spread across Aurora, DynamoDB, S3, and Cognito.

```sql
CREATE TABLE erasure_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'processing', 'completed', 'failed')),
  requested_at    TIMESTAMPTZ DEFAULT now(),
  approved_at     TIMESTAMPTZ,
  approved_by     UUID REFERENCES users(id),       -- Admin who approved (if manual review)
  completed_at    TIMESTAMPTZ,
  steps_completed JSONB DEFAULT '[]',               -- Track which steps are done
  error           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

### Erasure Pipeline

```
User requests erasure
       │
       ▼
┌─────────────────────┐
│ 1. VALIDATE          │
│    - User exists     │
│    - Not sole owner  │
│      of active org   │
│    - Cool-off check  │
│      (72hr grace)    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 2. SOFT DELETE       │  ← Immediate (user can still revert)
│    - Set status =    │
│      soft_deleted    │
│    - Set purgeAfter  │
│      = now + 30 days │
│    - Revoke sessions │
│    - Remove from     │
│      org memberships │
└──────────┬──────────┘
           │
           │  30 days later (automated)
           ▼
┌─────────────────────┐
│ 3. HARD PURGE        │  ← Irreversible
│                      │
│ Aurora:              │
│  □ Anonymize user    │
│    row (keep ID,     │
│    clear PII)        │
│  □ Delete user       │
│    devices           │
│  □ Delete user       │
│    sessions          │
│  □ Delete user       │
│    status history    │
│  □ Anonymize audit   │
│    log entries       │
│  □ Delete chat       │
│    messages by user  │
│  □ Delete chat       │
│    conversations     │
│    by user           │
│  □ Transfer or       │
│    anonymize         │
│    projects          │
│                      │
│ DynamoDB:            │
│  □ Delete usage      │
│    events by userId  │
│  □ Delete rate limit │
│    counters          │
│                      │
│ Cognito:             │
│  □ Admin delete user │
│    from user pool    │
│                      │
│ S3:                  │
│  □ Delete avatars    │
│  □ Delete data       │
│    exports           │
└──────────┬──────────┘
           │
           ▼
   status = purged
   All PII replaced with
   "[deleted]" or NULL
```

### Purge Implementation

```typescript
// src/services/compliance-service.ts

export async function purgeUserData(
  tx: TransactionClient,
  userId: string
) {
  const steps: string[] = [];

  // 1. Anonymize user record (keep UUID for referential integrity)
  await tx
    .update(users)
    .set({
      email: `deleted-${userId.slice(0, 8)}@purged.local`,
      name: null,
      cognitoId: `purged-${userId}`,
      avatarUrl: null,
      status: "purged",
      statusReason: "Data erasure completed",
      metadata: {},
      timezone: null,
      locale: null,
      lastLoginAt: null,
      loginCount: 0,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
  steps.push("user_anonymized");

  // 2. Delete devices and sessions
  await tx.delete(userDevices).where(eq(userDevices.userId, userId));
  steps.push("devices_deleted");

  await tx.delete(userSessions).where(eq(userSessions.userId, userId));
  steps.push("sessions_deleted");

  // 3. Delete status history
  await tx.delete(userStatusHistory).where(eq(userStatusHistory.userId, userId));
  steps.push("status_history_deleted");

  // 4. Anonymize audit log (keep for security, remove PII)
  await tx
    .update(auditLog)
    .set({
      metadata: sql`metadata - 'email' - 'name' - 'ip_address'`,
      ipAddress: null,
    })
    .where(eq(auditLog.userId, userId));
  steps.push("audit_log_anonymized");

  // 5. Delete chat messages and conversations
  await tx.delete(chatMessages).where(eq(chatMessages.userId, userId));
  steps.push("messages_deleted");

  await tx.delete(chatConversations).where(eq(chatConversations.userId, userId));
  steps.push("conversations_deleted");

  // 6. Handle projects — transfer to org or delete
  // If user was sole contributor, anonymize. If org has other members, transfer.
  await tx
    .update(projects)
    .set({ userId: sql`(SELECT id FROM users WHERE email = 'system@myagency.local' LIMIT 1)` })
    .where(eq(projects.userId, userId));
  steps.push("projects_transferred");

  // 7. Delete from Cognito
  try {
    await deleteCognitoUser(userId);
    steps.push("cognito_deleted");
  } catch (error) {
    steps.push(`cognito_delete_failed: ${error}`);
  }

  // 8. Delete DynamoDB usage events (async)
  await triggerDynamoDBPurge(userId);
  steps.push("dynamodb_purge_triggered");

  // 9. Delete S3 objects (avatars, exports)
  await deleteS3Objects(`avatars/${userId}/`);
  await deleteS3Objects(`exports/${userId}/`);
  steps.push("s3_deleted");

  return steps;
}
```

### 8.3.3 Right to Rectification

Users can update their personal data through the existing profile endpoint (`PATCH /api/user`). The admin can also update on their behalf. Changes are tracked in the audit log.

## 8.4 Consent Management

Track which data processing activities a user has consented to.

```sql
CREATE TABLE user_consents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id),
  consent_type TEXT NOT NULL,              -- "analytics", "marketing", "third_party_sharing"
  granted     BOOLEAN NOT NULL,
  granted_at  TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,
  ip_address  TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),

  UNIQUE (user_id, consent_type)
);
```

### Consent Types

| Type | What it covers | Required? | Default |
|------|---------------|-----------|---------|
| `essential` | Account operation, security | Yes (cannot opt out) | Granted |
| `analytics` | Usage tracking, engagement scoring | No | Granted (opt-out) |
| `marketing` | Product update emails, newsletters | No | Not granted (opt-in) |
| `third_party` | Data sharing with integrations | No | Not granted (opt-in) |

### Consent Check in Usage Emitter

```typescript
// In emitUsageEvent, check if user has analytics consent:

export function emitUsageEvent(event: UsageEvent) {
  // Fast path: API call events are always tracked (essential)
  if (event.category === "api_call") {
    eventBuffer.push(event);
    return;
  }

  // Feature/engagement tracking requires analytics consent
  // The consent is cached in the request context to avoid per-event DB lookups
  if (event.category === "feature" && !hasAnalyticsConsent(event.userId)) {
    return; // Silently skip
  }

  eventBuffer.push(event);
}
```

## 8.5 Data Retention Policies

| Data Type | Retention Period | Deletion Method |
|-----------|-----------------|----------------|
| Raw usage events (DynamoDB) | 90 days | DynamoDB TTL (automatic) |
| Usage aggregates (Aurora) | 2 years | Lambda cron (monthly) |
| Audit log entries | 2 years | Lambda cron (monthly) |
| Session records | 1 year | Lambda cron (monthly) |
| Status history | 2 years | Lambda cron (monthly) |
| Expired invitations | 90 days | Lambda cron (weekly) |
| Data export files (S3) | 7 days after generation | S3 lifecycle policy |
| Soft-deleted users | 30 days | Purge Lambda (daily) |

### Retention Enforcement Lambda

```typescript
// lambda/data-retention/index.ts

export async function handler() {
  const results = {
    sessionsDeleted: 0,
    auditEntriesDeleted: 0,
    aggregatesDeleted: 0,
    invitationsDeleted: 0,
    exportsExpired: 0,
  };

  // Delete sessions older than 1 year
  results.sessionsDeleted = await deleteOldSessions(365);

  // Delete audit entries older than 2 years
  results.auditEntriesDeleted = await deleteOldAuditEntries(730);

  // Delete usage aggregates older than 2 years
  results.aggregatesDeleted = await deleteOldAggregates(730);

  // Delete expired invitations
  results.invitationsDeleted = await deleteExpiredInvitations(90);

  // Mark completed exports as expired
  results.exportsExpired = await expireOldExports();

  return results;
}
```

## 8.6 Data Processing Records (GDPR Art. 30)

A machine-readable record of all data processing activities. Required for organizations with 250+ employees or those processing special categories of data.

```typescript
// src/lib/compliance/processing-records.ts

export const DATA_PROCESSING_RECORDS = [
  {
    activity: "User account management",
    purpose: "Provide the myAgency service",
    lawfulBasis: "Contract (Art. 6(1)(b))",
    dataCategories: ["Identity", "Contact"],
    dataSources: ["User registration form"],
    recipients: ["Internal: application servers"],
    transfers: ["AWS ap-southeast-2 (Australia)"],
    retention: "Account lifetime + 30 days",
    technicalMeasures: ["Encryption at rest (AES-256)", "Encryption in transit (TLS 1.3)", "Row-level security"],
  },
  {
    activity: "AI chat processing",
    purpose: "Provide AI assistant functionality",
    lawfulBasis: "Contract (Art. 6(1)(b))",
    dataCategories: ["User content", "Identity"],
    dataSources: ["User input"],
    recipients: ["AWS Bedrock (Haiku 4.5)"],
    transfers: ["AWS us-east-1 (model inference)"],
    retention: "Organization lifetime (user can delete conversations)",
    technicalMeasures: ["Content not used for model training", "Encrypted in transit"],
  },
  {
    activity: "Usage analytics",
    purpose: "Service improvement and capacity planning",
    lawfulBasis: "Legitimate interest (Art. 6(1)(f))",
    dataCategories: ["Usage data", "Technical data"],
    dataSources: ["API request logs"],
    recipients: ["Internal: analytics pipeline"],
    transfers: ["AWS ap-southeast-2"],
    retention: "90 days (raw), 2 years (aggregated)",
    technicalMeasures: ["Pseudonymization in aggregates", "DynamoDB TTL"],
  },
];
```

## 8.7 API Routes

```
app/api/
├── compliance/
│   ├── export/
│   │   ├── route.ts               # POST — request data export
│   │   └── [exportId]/
│   │       ├── route.ts           # GET — check export status
│   │       └── download/route.ts  # GET — download export file
│   ├── erasure/
│   │   └── route.ts               # POST — request erasure
│   ├── consents/
│   │   └── route.ts               # GET — list consents, PATCH — update consent
│   └── processing-records/
│       └── route.ts               # GET — GDPR Art. 30 records
```

## 8.8 Client-Side Hooks

```typescript
// src/hooks/use-compliance.ts

"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/src/lib/api-client";

export function useDataExports() {
  return useQuery({
    queryKey: ["compliance", "exports"],
    queryFn: async () => {
      const res = await apiFetch("/api/compliance/export");
      if (!res.ok) throw new Error("Failed to fetch exports");
      return res.json();
    },
  });
}

export function useRequestDataExport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { format?: "json" | "csv"; scope?: "full" | "org" }) => {
      const res = await apiFetch("/api/compliance/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      if (!res.ok) throw new Error("Failed to request export");
      return res.json();
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["compliance", "exports"] });
    },
  });
}

export function useConsents() {
  return useQuery({
    queryKey: ["compliance", "consents"],
    queryFn: async () => {
      const res = await apiFetch("/api/compliance/consents");
      if (!res.ok) throw new Error("Failed to fetch consents");
      return res.json();
    },
  });
}

export function useUpdateConsent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { consentType: string; granted: boolean }) => {
      const res = await apiFetch("/api/compliance/consents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      if (!res.ok) throw new Error("Failed to update consent");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["compliance", "consents"] });
    },
  });
}
```
