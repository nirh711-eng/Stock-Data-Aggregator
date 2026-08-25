import assert from "node:assert/strict";
import test from "node:test";
import { defaultDualImpact, normalizeImpact } from "./alert-impact.ts";

test("keeps a company-only event unknown for the wider sector by default", () => {
  const impact = defaultDualImpact("stock", "positive");

  assert.equal(impact.companyImpact.label, "positive");
  assert.equal(impact.companyImpact.confidence, "low");
  assert.equal(impact.sectorImpact.label, "unknown");
  assert.equal(impact.sectorImpact.confidence, "unknown");
});

test("keeps a sector headline unknown for a specific company by default", () => {
  const impact = defaultDualImpact("sector", "negative");

  assert.equal(impact.companyImpact.label, "unknown");
  assert.equal(impact.sectorImpact.label, "negative");
  assert.equal(impact.sectorImpact.confidence, "low");
});

test("normalizes a valid classifier response and falls back for malformed values", () => {
  const fallback = defaultDualImpact("stock", "neutral").companyImpact;
  const normalized = normalizeImpact(
    { label: "negative", confidence: "high", reason: "  פגיעה   בביקוש למוצר המרכזי.  " },
    fallback,
  );

  assert.deepEqual(normalized, {
    label: "negative",
    confidence: "high",
    reason: "פגיעה בביקוש למוצר המרכזי.",
  });
  assert.deepEqual(normalizeImpact({ label: "up", reason: "" }, fallback), fallback);
});