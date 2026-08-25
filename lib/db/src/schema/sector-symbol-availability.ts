import { integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const sectorSymbolAvailabilityTable = pgTable("sector_symbol_availability", {
  scanScope: text("scan_scope").notNull(),
  symbol: text("symbol").notNull(),
  reason: text("reason").$type<"quote" | "candles">().notNull(),
  consecutiveFailures: integer("consecutive_failures").notNull().default(1),
  firstFailedAt: timestamp("first_failed_at", { withTimezone: true }).notNull().defaultNow(),
  lastFailedAt: timestamp("last_failed_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  primaryKey({
    columns: [table.scanScope, table.symbol, table.reason],
    name: "sector_symbol_availability_pkey",
  }),
]);

export const insertSectorSymbolAvailabilitySchema = createInsertSchema(sectorSymbolAvailabilityTable);
export type InsertSectorSymbolAvailability = z.infer<typeof insertSectorSymbolAvailabilitySchema>;
export type SectorSymbolAvailability = typeof sectorSymbolAvailabilityTable.$inferSelect;