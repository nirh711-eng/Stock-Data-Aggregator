import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const userPreferencesTable = pgTable("user_preferences", {
  userId: text("user_id").primaryKey(),
  watchlist: jsonb("watchlist").$type<unknown[]>().notNull().default([]),
  trackedArticles: jsonb("tracked_articles").$type<Record<string, unknown[]>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserPreferencesSchema = createInsertSchema(userPreferencesTable)
  .omit({ updatedAt: true });
export type InsertUserPreferences = z.infer<typeof insertUserPreferencesSchema>;
export type UserPreferences = typeof userPreferencesTable.$inferSelect;