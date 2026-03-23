import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  unique,
  date,
  numeric,
} from "drizzle-orm/pg-core";

// ─── Users ──────────────────────────────────────────────────
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  supabaseId: text("supabase_id").notNull().unique(),
  email: text("email").notNull().unique(),
  name: text("name"),
  status: text("status").notNull().default("active"),
  statusReason: text("status_reason"),
  statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  purgeAfter: timestamp("purge_after", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  loginCount: integer("login_count").notNull().default(0),
  avatarUrl: text("avatar_url"),
  timezone: text("timezone").notNull().default("UTC"),
  locale: text("locale").notNull().default("en"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ─── Status Enums ──────────────────────────────────────────
export const projectStatuses = ["active", "draft", "completed", "archived"] as const;
export type ProjectStatus = (typeof projectStatuses)[number];

export const meetingStatuses = ["scheduled", "confirmed", "completed", "cancelled"] as const;
export type MeetingStatus = (typeof meetingStatuses)[number];

export const deviceTypes = ["desktop", "mobile", "tablet"] as const;
export type DeviceType = (typeof deviceTypes)[number];

// ─── Projects ───────────────────────────────────────────────
export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ─── Chat Conversations ─────────────────────────────────────
export const chatConversations = pgTable("chat_conversations", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  title: text("title"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ─── Chat Messages ──────────────────────────────────────────
export const chatMessages = pgTable("chat_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => chatConversations.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  role: text("role").notNull(), // 'user' | 'assistant'
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ─── User Status History ────────────────────────────────────
export const userStatusHistory = pgTable("user_status_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  fromStatus: text("from_status").notNull(),
  toStatus: text("to_status").notNull(),
  reason: text("reason"),
  changedBy: uuid("changed_by").references(() => users.id),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ─── User Devices ───────────────────────────────────────────
export const userDevices = pgTable(
  "user_devices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceFingerprint: text("device_fingerprint").notNull(),
    deviceName: text("device_name"),
    deviceType: text("device_type"),
    os: text("os"),
    browser: text("browser"),
    trusted: integer("trusted").notNull().default(0),
    lastIp: text("last_ip"),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [unique("uq_user_device_fingerprint").on(table.userId, table.deviceFingerprint)]
);

// ─── User Sessions ──────────────────────────────────────────
export const userSessions = pgTable("user_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  deviceId: uuid("device_id").references(() => userDevices.id, {
    onDelete: "set null",
  }),
  status: text("status").notNull().default("active"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow(),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }).defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  endedReason: text("ended_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ─── Meetings ───────────────────────────────────────────────
export const meetings = pgTable("meetings", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  title: text("title").notNull(),
  description: text("description"),
  location: text("location"),
  startTime: timestamp("start_time", { withTimezone: true }).notNull(),
  endTime: timestamp("end_time", { withTimezone: true }).notNull(),
  attendees: jsonb("attendees").$type<string[]>().notNull().default([]),
  status: text("status").notNull().default("scheduled"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ─── Workflow Events (webhook processing audit trail) ───────
// No RLS — system events, not user data. No user_id column.
export const workflowEvents = pgTable("workflow_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventId: text("event_id").notNull().unique(),
  eventType: text("event_type").notNull(),
  source: text("source").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status").notNull().default("received"),
  traceId: text("trace_id"),
  result: jsonb("result"),
  error: text("error"),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ─── Roster Tasks ──────────────────────────────────────────
export const rosterTasks = pgTable("roster_tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  visitId: integer("visit_id").notNull(),
  clientId: integer("client_id"),
  status: text("status").notNull().default("detected"),
  urgency: text("urgency").notNull().default("planned"),
  version: integer("version").notNull().default(1),
  matchResult: jsonb("match_result"),
  llmRecommendation: jsonb("llm_recommendation"),
  contacts: jsonb("contacts").notNull().default([]),
  currentContactIndex: integer("current_contact_index").notNull().default(0),
  cascadeStrategy: text("cascade_strategy").notNull().default("sequential"),
  assignedEmployeeId: integer("assigned_employee_id"),
  escalatedTo: uuid("escalated_to").references(() => users.id),
  escalationReason: text("escalation_reason"),
  sourceEventId: text("source_event_id"),
  detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
  scoringCompletedAt: timestamp("scoring_completed_at", { withTimezone: true }),
  firstContactAt: timestamp("first_contact_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  timeToFillMs: integer("time_to_fill_ms"),
  createdBy: text("created_by").notNull().default("system"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Roster Audit Log ──────────────────────────────────────
export const rosterAuditLog = pgTable("roster_audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => rosterTasks.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  action: text("action").notNull(),
  actor: text("actor").notNull(),
  details: jsonb("details").notNull().default({}),
  reasoning: text("reasoning"),
});

// ─── Roster Daily Metrics ──────────────────────────────────
export const rosterDailyMetrics = pgTable(
  "roster_daily_metrics",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    date: date("date").notNull(),
    tasksCreated: integer("tasks_created").notNull().default(0),
    tasksFilledAutonomous: integer("tasks_filled_autonomous").notNull().default(0),
    tasksEscalated: integer("tasks_escalated").notNull().default(0),
    avgTimeToFillMs: integer("avg_time_to_fill_ms"),
    firstContactAcceptanceRate: numeric("first_contact_acceptance_rate", { precision: 5, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("uq_roster_metrics_user_date").on(table.userId, table.date)]
);

// ─── Types ──────────────────────────────────────────────────
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type ChatConversation = typeof chatConversations.$inferSelect;
export type NewChatConversation = typeof chatConversations.$inferInsert;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;
export type UserStatusHistory = typeof userStatusHistory.$inferSelect;
export type NewUserStatusHistory = typeof userStatusHistory.$inferInsert;
export type UserDevice = typeof userDevices.$inferSelect;
export type NewUserDevice = typeof userDevices.$inferInsert;
export type UserSession = typeof userSessions.$inferSelect;
export type NewUserSession = typeof userSessions.$inferInsert;
export type Meeting = typeof meetings.$inferSelect;
export type NewMeeting = typeof meetings.$inferInsert;
export type WorkflowEvent = typeof workflowEvents.$inferSelect;
export type NewWorkflowEvent = typeof workflowEvents.$inferInsert;
export type RosterTask = typeof rosterTasks.$inferSelect;
export type NewRosterTask = typeof rosterTasks.$inferInsert;
export type RosterAuditLogEntry = typeof rosterAuditLog.$inferSelect;
export type NewRosterAuditLogEntry = typeof rosterAuditLog.$inferInsert;
export type RosterDailyMetric = typeof rosterDailyMetrics.$inferSelect;
export type NewRosterDailyMetric = typeof rosterDailyMetrics.$inferInsert;
