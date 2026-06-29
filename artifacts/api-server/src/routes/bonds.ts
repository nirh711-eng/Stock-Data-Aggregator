import { Router } from "express";
import https from "https";

const FRED_KEY = process.env.FRED_API_KEY ?? "";
const FRED_BASE = "https://api.stlouisfed.org/fred/series/observations";

let bondCache: { data: BondData; ts: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000;

function fetchJson<T>(url: string, timeoutMs = 9000): Promise<T | null> {
  return Promise.race<T | null>([
    new Promise<T | null>((resolve) => {
      https
        .get(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } }, (res) => {
          let raw = "";
          res.on("data", (c: string) => (raw += c));
          res.on("end", () => {
            try { resolve(JSON.parse(raw) as T); } catch { resolve(null); }
          });
        })
        .on("error", () => resolve(null));
    }),
    new Promise<null>((r) => setTimeout(() => r(null), timeoutMs)),
  ]);
}

type FredObs = { observations?: Array<{ value: string; date: string }> };

export interface YieldPoint {
  maturity: string;
  label: string;
  years: number;
  rate: number | null;
  prevRate: number | null;
  change: number | null;
  date: string | null;
}

export interface BondData {
  us: YieldPoint[];
  il: YieldPoint[];
  generatedAt: string;
}

// ── FRED: fetch two observations (latest + prev) for one series ──────────────

async function fredSeries(seriesId: string): Promise<{ rate: number | null; prevRate: number | null; date: string | null }> {
  if (!FRED_KEY) return { rate: null, prevRate: null, date: null };
  const url = `${FRED_BASE}?series_id=${seriesId}&sort_order=desc&limit=2&api_key=${FRED_KEY}&file_type=json`;
  const data = await fetchJson<FredObs>(url);
  const obs = data?.observations ?? [];
  const parse = (o?: { value: string }) => (o?.value && o.value !== "." ? parseFloat(o.value) : null);
  return { rate: parse(obs[0]), prevRate: parse(obs[1]), date: obs[0]?.date ?? null };
}

// ── Build yield curve ─────────────────────────────────────────────────────────

function makePoint(
  maturity: string, label: string, years: number,
  raw: { rate: number | null; prevRate: number | null; date: string | null },
): YieldPoint {
  const change = raw.rate !== null && raw.prevRate !== null
    ? parseFloat((raw.rate - raw.prevRate).toFixed(3))
    : null;
  return { maturity, label, years, rate: raw.rate, prevRate: raw.prevRate, change, date: raw.date };
}

async function buildBondData(): Promise<BondData> {
  // US Treasury (FRED Daily General Series)
  // Israel: OECD/FRED provides short-term call rate + 10Y long-term bond yield
  const [
    us1mo, us3mo, us6mo, us1y, us2y, us5y, us10y, us30y,
    il_shortterm, il_10y,
  ] = await Promise.all([
    fredSeries("DGS1MO"),
    fredSeries("DGS3MO"),
    fredSeries("DGS6MO"),
    fredSeries("DGS1"),
    fredSeries("DGS2"),
    fredSeries("DGS5"),
    fredSeries("DGS10"),
    fredSeries("DGS30"),
    fredSeries("IRSTCI01ILM156N"),   // BOI short-term call rate (monthly, OECD)
    fredSeries("IRLTLT01ILM156N"),   // 10Y long-term government bond (monthly, OECD)
  ]);

  return {
    us: [
      makePoint("1M",  "חודש",      1 / 12, us1mo),
      makePoint("3M",  "3 חודשים",  0.25,   us3mo),
      makePoint("6M",  "6 חודשים",  0.5,    us6mo),
      makePoint("1Y",  "שנה",       1,      us1y),
      makePoint("2Y",  "2 שנים",    2,      us2y),
      makePoint("5Y",  "5 שנים",    5,      us5y),
      makePoint("10Y", "10 שנים",   10,     us10y),
      makePoint("30Y", "30 שנים",   30,     us30y),
    ],
    il: [
      makePoint("Short", "ריבית קצרה",  0.1, il_shortterm),
      makePoint("10Y",   "10 שנים",     10,  il_10y),
    ],
    generatedAt: new Date().toISOString(),
  };
}

// ── Route ─────────────────────────────────────────────────────────────────────

const router = Router();

router.get("/bonds", async (req, res) => {
  if (bondCache && Date.now() - bondCache.ts < CACHE_TTL) {
    res.json(bondCache.data);
    return;
  }
  try {
    const data = await buildBondData();
    bondCache = { data, ts: Date.now() };
    res.json(data);
  } catch (err) {
    req.log?.error({ err }, "Failed to fetch bond data");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
