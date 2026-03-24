import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  unique,
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

// ─── Demo Responses ─────────────────────────────────────────
// Pre-produced answers for the avatar demo. Each response has a
// category (e.g. "fund_manager"), a scripted answer text, and an
// optional URL to a pre-generated ElevenLabs audio file.
export const demoResponses = pgTable("demo_responses", {
  id: uuid("id").defaultRandom().primaryKey(),
  category: text("category").notNull().unique(),
  label: text("label").notNull(),
  answerText: text("answer_text").notNull(),
  audioUrl: text("audio_url"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ─── Demo Question Patterns ─────────────────────────────────
// Variant phrasings that map to a demo response. The voice agent
// uses these to classify an incoming question and select the
// matching pre-produced answer.
export const demoQuestionPatterns = pgTable("demo_question_patterns", {
  id: uuid("id").defaultRandom().primaryKey(),
  responseId: uuid("response_id")
    .notNull()
    .references(() => demoResponses.id, { onDelete: "cascade" }),
  pattern: text("pattern").notNull(),
  isCanonical: integer("is_canonical").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ─── Types ──────────────────────────────────────────────────
export const deviceTypes = ["desktop", "mobile", "tablet"] as const;
export type DeviceType = (typeof deviceTypes)[number];

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserStatusHistory = typeof userStatusHistory.$inferSelect;
export type NewUserStatusHistory = typeof userStatusHistory.$inferInsert;
export type UserDevice = typeof userDevices.$inferSelect;
export type NewUserDevice = typeof userDevices.$inferInsert;
export type UserSession = typeof userSessions.$inferSelect;
export type NewUserSession = typeof userSessions.$inferInsert;
export type DemoResponse = typeof demoResponses.$inferSelect;
export type NewDemoResponse = typeof demoResponses.$inferInsert;
export type DemoQuestionPattern = typeof demoQuestionPatterns.$inferSelect;
export type NewDemoQuestionPattern = typeof demoQuestionPatterns.$inferInsert;
