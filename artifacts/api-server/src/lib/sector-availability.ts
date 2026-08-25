import { db, sectorSymbolAvailabilityTable } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  PERSISTENT_AVAILABILITY_FAILURE_THRESHOLD,
  type AvailabilityFailureReason,
  type AvailabilityObservation,
  type AvailabilityReport,
  type UnavailableSymbol,
} from "./candle-patterns.js";

type AvailabilityCheck = {
  symbol: string;
  reason: AvailabilityFailureReason;
  available: boolean;
};

function toUnavailableSymbol(row: {
  symbol: string;
  reason: AvailabilityFailureReason;
  consecutiveFailures: number;
  firstFailedAt: Date;
  lastFailedAt: Date;
}): UnavailableSymbol {
  return {
    symbol: row.symbol,
    reason: row.reason,
    consecutiveFailures: row.consecutiveFailures,
    firstFailedAt: row.firstFailedAt.toISOString(),
    lastFailedAt: row.lastFailedAt.toISOString(),
  };
}

/**
 * Persists consecutive provider failures by scan scope. A successful provider
 * response deletes only its own failure record; the curated ticker list is
 * never changed automatically.
 */
export async function recordSectorAvailability(
  scanScope: string,
  observations: readonly AvailabilityObservation[],
): Promise<AvailabilityReport> {
  const checks: AvailabilityCheck[] = observations.flatMap((observation) => {
    const results: AvailabilityCheck[] = [];
    if (observation.quoteAvailable !== undefined) {
      results.push({
        symbol: observation.symbol,
        reason: "quote",
        available: observation.quoteAvailable,
      });
    }
    if (observation.candlesAvailable !== undefined) {
      results.push({
        symbol: observation.symbol,
        reason: "candles",
        available: observation.candlesAvailable,
      });
    }
    return results;
  });

  if (checks.length === 0) {
    return { unavailableSymbols: [], persistentUnavailableSymbols: [] };
  }

  const successfulSymbolsByReason = new Map<AvailabilityFailureReason, string[]>();
  const failures = checks.filter((check) => !check.available);
  for (const check of checks.filter((candidate) => candidate.available)) {
    successfulSymbolsByReason.set(check.reason, [
      ...(successfulSymbolsByReason.get(check.reason) ?? []),
      check.symbol,
    ]);
  }

  await Promise.all([...successfulSymbolsByReason.entries()].map(([reason, symbols]) => (
    db.delete(sectorSymbolAvailabilityTable).where(and(
      eq(sectorSymbolAvailabilityTable.scanScope, scanScope),
      eq(sectorSymbolAvailabilityTable.reason, reason),
      inArray(sectorSymbolAvailabilityTable.symbol, symbols),
    ))
  )));

  if (failures.length === 0) {
    return { unavailableSymbols: [], persistentUnavailableSymbols: [] };
  }

  const now = new Date();
  const rows = await db.insert(sectorSymbolAvailabilityTable)
    .values(failures.map((failure) => ({
      scanScope,
      symbol: failure.symbol,
      reason: failure.reason,
      consecutiveFailures: 1,
      firstFailedAt: now,
      lastFailedAt: now,
      updatedAt: now,
    })))
    .onConflictDoUpdate({
      target: [
        sectorSymbolAvailabilityTable.scanScope,
        sectorSymbolAvailabilityTable.symbol,
        sectorSymbolAvailabilityTable.reason,
      ],
      set: {
        consecutiveFailures: sql`${sectorSymbolAvailabilityTable.consecutiveFailures} + 1`,
        lastFailedAt: now,
        updatedAt: now,
      },
    })
    .returning();

  const unavailableSymbols = rows.map(toUnavailableSymbol);
  return {
    unavailableSymbols,
    persistentUnavailableSymbols: unavailableSymbols.filter(
      (symbol) => symbol.consecutiveFailures >= PERSISTENT_AVAILABILITY_FAILURE_THRESHOLD,
    ),
  };
}