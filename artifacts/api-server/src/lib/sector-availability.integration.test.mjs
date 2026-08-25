import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, sectorSymbolAvailabilityTable } from "@workspace/db";
import { recordSectorAvailability } from "./sector-availability.ts";

test("persists availability streaks and clears them after recovery", async () => {
  const scanScope = `test:sector-availability:${randomUUID()}`;
  const symbol = "TEST";
  const failedObservation = [{ symbol, quoteAvailable: false }];

  try {
    const first = await recordSectorAvailability(scanScope, failedObservation);
    assert.equal(first.unavailableSymbols[0]?.consecutiveFailures, 1);
    assert.deepEqual(first.persistentUnavailableSymbols, []);

    await recordSectorAvailability(scanScope, failedObservation);
    const third = await recordSectorAvailability(scanScope, failedObservation);
    assert.equal(third.unavailableSymbols[0]?.consecutiveFailures, 3);
    assert.equal(third.persistentUnavailableSymbols[0]?.symbol, symbol);

    const recovered = await recordSectorAvailability(
      scanScope,
      [{ symbol, quoteAvailable: true }],
    );
    assert.deepEqual(recovered.unavailableSymbols, []);

    const remaining = await db.select()
      .from(sectorSymbolAvailabilityTable)
      .where(and(
        eq(sectorSymbolAvailabilityTable.scanScope, scanScope),
        eq(sectorSymbolAvailabilityTable.symbol, symbol),
      ));
    assert.deepEqual(remaining, []);
  } finally {
    await db.delete(sectorSymbolAvailabilityTable).where(
      eq(sectorSymbolAvailabilityTable.scanScope, scanScope),
    );
  }
});