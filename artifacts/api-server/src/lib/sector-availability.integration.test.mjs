import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import http from "node:http";
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

test("retries incomplete sector scans, records failure streaks, and clears maintenance after recovery", async () => {
  const scanScope = "screen:Technology";
  const originalQuote = (await import("yahoo-finance2")).default.prototype.quote;
  const preservedRows = await db.select()
    .from(sectorSymbolAvailabilityTable)
    .where(and(
      eq(sectorSymbolAvailabilityTable.scanScope, scanScope),
      eq(sectorSymbolAvailabilityTable.symbol, "MSFT"),
    ));
  const quoteResponses = [];

  const quote = async (requestedSymbols) => {
    const requested = Array.isArray(requestedSymbols)
      ? requestedSymbols
      : [requestedSymbols];
    quoteResponses.push(requested);
    const recovered = quoteResponses.length >= 4;
    return requested
      .filter((symbol) => recovered || symbol !== "MSFT")
      .map((symbol) => ({
        symbol,
        longName: `${symbol} test company`,
        regularMarketPrice: 100,
        marketCap: 1_000_000_000,
      }));
  };

  const { default: app } = await import("../app.ts");
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const scan = async () => {
    const response = await fetch(
      `${baseUrl}/api/sectors/screen?sector=Technology&limit=2`,
    );
    assert.equal(response.status, 200);
    return response.json();
  };

  try {
    await db.delete(sectorSymbolAvailabilityTable).where(and(
      eq(sectorSymbolAvailabilityTable.scanScope, scanScope),
      eq(sectorSymbolAvailabilityTable.symbol, "MSFT"),
    ));
    (await import("yahoo-finance2")).default.prototype.quote = quote;

    const before = await fetch(`${baseUrl}/api/sectors/list`).then((response) => response.json());
    const first = await scan();
    assert.deepEqual(
      {
        scannedCount: first.scannedCount,
        successfulCount: first.successfulCount,
        failedCount: first.failedCount,
        complete: first.complete,
      },
      { scannedCount: 2, successfulCount: 1, failedCount: 1, complete: false },
    );
    assert.equal(first.unavailableSymbols[0]?.symbol, "MSFT");
    assert.equal(first.unavailableSymbols[0]?.consecutiveFailures, 1);

    const second = await scan();
    assert.equal(second.unavailableSymbols[0]?.consecutiveFailures, 2);
    assert.deepEqual(second.persistentUnavailableSymbols, []);

    const third = await scan();
    assert.equal(third.unavailableSymbols[0]?.consecutiveFailures, 3);
    assert.equal(third.persistentUnavailableSymbols[0]?.symbol, "MSFT");
    assert.equal(third.persistentUnavailableSymbols[0]?.consecutiveFailures, 3);
    assert.equal(quoteResponses.length, 3, "incomplete scans must not be served from cache");

    const recovered = await scan();
    assert.deepEqual(
      {
        scannedCount: recovered.scannedCount,
        successfulCount: recovered.successfulCount,
        failedCount: recovered.failedCount,
        complete: recovered.complete,
      },
      { scannedCount: 2, successfulCount: 2, failedCount: 0, complete: true },
    );
    assert.deepEqual(recovered.unavailableSymbols, []);
    assert.deepEqual(recovered.persistentUnavailableSymbols, []);

    const after = await fetch(`${baseUrl}/api/sectors/list`).then((response) => response.json());
    assert.deepEqual(after, before, "availability recovery must not edit the curated symbol list");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    (await import("yahoo-finance2")).default.prototype.quote = originalQuote;
    await db.delete(sectorSymbolAvailabilityTable).where(and(
      eq(sectorSymbolAvailabilityTable.scanScope, scanScope),
      eq(sectorSymbolAvailabilityTable.symbol, "MSFT"),
    ));
    if (preservedRows.length > 0) {
      await db.insert(sectorSymbolAvailabilityTable).values(preservedRows);
    }
  }
});