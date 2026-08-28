import { integer, jsonb, pgTable, text, timestamp, uuid, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const ACCESS_STATUSES = ["pending", "approved", "rejected"] as const;
export type AccessStatus = (typeof ACCESS_STATUSES)[number];

export const accessRequestsTable = pgTable(
  "access_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    email: text("email").notNull(),
    name: text("name").notNull().default(""),
    status: text("status").$type<AccessStatus>().notNull().default("pending"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: text("reviewed_by"),
    tokenHash: text("token_hash"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    lastNotificationAt: timestamp("last_notification_at", { withTimezone: true }),
    lastNotificationAttemptAt: timestamp("last_notification_attempt_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => ({
    userIdUnique: uniqueIndex("access_requests_user_id_unique").on(table.userId),
    emailIndex: index("access_requests_email_idx").on(table.email),
    statusIndex: index("access_requests_status_idx").on(table.status),
  }),
);

export const usageEventsTable = pgTable(
  "usage_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    ticker: text("ticker"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userEventUnique: uniqueIndex("usage_events_user_event_unique").on(table.userId, table.eventId),
    userOccurredIndex: index("usage_events_user_occurred_idx").on(table.userId, table.occurredAt),
    typeOccurredIndex: index("usage_events_type_occurred_idx").on(table.eventType, table.occurredAt),
  }),
);

export const usageRateLimitsTable = pgTable("usage_rate_limits", {
  userId: text("user_id").primaryKey(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
  eventCount: integer("event_count").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAccessRequestSchema = createInsertSchema(accessRequestsTable).omit({
  id: true,
  requestedAt: true,
  reviewedAt: true,
  reviewedBy: true,
  tokenHash: true,
  tokenExpiresAt: true,
  lastNotificationAt: true,
  lastNotificationAttemptAt: true,
  lastSeenAt: true,
  createdAt: true,
  updatedAt: true,
});

export const insertUsageEventSchema = createInsertSchema(usageEventsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertAccessRequest = z.infer<typeof insertAccessRequestSchema>;
export type AccessRequest = typeof accessRequestsTable.$inferSelect;
export type InsertUsageEvent = z.infer<typeof insertUsageEventSchema>;
export type UsageEvent = typeof usageEventsTable.$inferSelect;