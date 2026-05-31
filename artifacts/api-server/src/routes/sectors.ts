import { Router } from "express";
import yahooFinanceMod from "yahoo-finance2";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const YahooFinance = yahooFinanceMod as any;
const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const router = Router();

// ── In-memory cache (30 min) ──────────────────────────────────────────────────
const _cache = new Map<string, { data: unknown; expires: number }>();
function getCached<T>(key: string): T | null {
  const e = _cache.get(key);
  if (!e || Date.now() > e.expires) return null;
  return e.data as T;
}
function setCached(key: string, data: unknown, ttlMs = 30 * 60 * 1000) {
  _cache.set(key, { data, expires: Date.now() + ttlMs });
}

// ── Formatting helpers ────────────────────────────────────────────────────────
function fmtCap(v: number): string {
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9)  return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6)  return `$${(v / 1e6).toFixed(1)}M`;
  return `$${v.toFixed(0)}`;
}
function fmtVol(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(v);
}
function capTier(mc: number): "leader" | "mid" | "radar" | "speculative" {
  if (mc >= 10e9)  return "leader";
  if (mc >= 1e9)   return "mid";
  if (mc >= 100e6) return "radar";
  return "speculative";
}

// ── Curated ticker lists per sector ──────────────────────────────────────────
// Top US equities per sector — enriched with live Yahoo Finance quotes
const SECTOR_TICKERS: Record<string, string[]> = {
  "Technology": [
    "AAPL","MSFT","NVDA","AVGO","ORCL","CRM","ADBE","AMD","QCOM","TXN",
    "IBM","AMAT","KLAC","LRCX","MU","NXPI","ON","MCHP","MPWR","FTNT",
    "ANSS","CDNS","SNPS","GDDY","CTSH","HPE","NET","PANW","SNOW","PLTR",
    "CRWD","DDOG","ZS","OKTA","MDB","HUBS","CFLT","TWLO","TTD","APP"
  ],
  "Healthcare": [
    "UNH","LLY","JNJ","ABBV","MRK","PFE","TMO","ABT","DHR","BMY",
    "AMGN","GILD","CVS","CI","ISRG","BSX","MDT","ELV","HCA","SYK",
    "BIIB","VRTX","REGN","MRNA","ZBH","DXCM","IDXX","WST","IQV","MCK",
    "CAH","COR","HUM","MOH","CNC","GEHC","BAX","BDX","COO","EW"
  ],
  "Financial Services": [
    "BRK-B","JPM","V","MA","BAC","WFC","GS","MS","AXP","BLK",
    "SCHW","CB","MET","PGR","C","USB","TFC","SPGI","CME","ICE",
    "COF","BK","STT","PNC","TRV","AIG","AON","MMC","MSCI","MCO",
    "SYF","DFS","ALLY","FITB","RF","HBAN","CFG","KEY","ZION","MTB"
  ],
  "Energy": [
    "XOM","CVX","COP","SLB","EOG","PSX","VLO","OXY","MPC","KMI",
    "WMB","HAL","DVN","BKR","FANG","TRGP","EQT","APA","MRO","HES",
    "PXD","OKE","LNG","CTRA","PR","MTDR","CHRD","SM","MGY","DINO"
  ],
  "Consumer Cyclical": [
    "AMZN","TSLA","HD","MCD","NKE","SBUX","LOW","TJX","CMG","GM",
    "F","ABNB","BKNG","MAR","HLT","YUM","DRI","EBAY","ETSY","ROST",
    "ORLY","AZO","ULTA","BBY","RH","W","CVNA","RIVN","NVR","PHM"
  ],
  "Consumer Defensive": [
    "WMT","PG","COST","KO","PEP","PM","MO","MDLZ","CL","GIS",
    "HSY","CPB","K","CHD","CLX","CAG","HRL","MKC","TSN","SJM",
    "KHC","STZ","TAP","BF-B","CELH","MNST","KDP","COKE","FLO","THS"
  ],
  "Industrials": [
    "CAT","DE","HON","UPS","RTX","BA","LMT","GE","MMM","EMR",
    "ITW","ETN","PH","ROK","DOV","GD","NOC","TDG","CARR","OTIS",
    "FDX","NSC","UNP","CSX","WAB","EXPD","CHRW","GWW","MSC","AOS",
    "IR","CSGP","GNRC","ROP","FAST","ODFL","XPO","JBHT","SAIA","LSTR"
  ],
  "Communication Services": [
    "GOOGL","META","NFLX","CMCSA","DIS","T","VZ","CHTR","TMUS","EA",
    "TTWO","WBD","FOXA","PARA","IAC","SIRI","LBRDA","ROKU","SPOT","PINS",
    "SNAP","MTCH","ZM","RBLX","U","LYFT","UBER","DASH","ABNB","TRIP"
  ],
  "Real Estate": [
    "PLD","AMT","EQIX","SPG","O","CCI","PSA","EXR","DLR","SBAC",
    "WELL","VTR","EQR","AVB","ARE","BXP","KIM","MAA","CPT","NNN",
    "WPC","STAG","IRT","TRNO","COLD","IIPR","MPW","OHI","LTC","PEAK"
  ],
  "Basic Materials": [
    "LIN","APD","SHW","FCX","NEM","NUE","VMC","MLM","ALB","CE",
    "MOS","CF","IFF","FMC","PPG","ECL","DD","DOW","EMN","HUN",
    "CCK","SEE","PKG","IP","WRK","AVY","SON","GEF","SLGN","BALL"
  ],
  "Utilities": [
    "NEE","DUK","SO","D","AEP","EXC","SRE","XEL","ES","WEC",
    "ED","PPL","AEE","FE","CNP","LNT","EVRG","NI","OGE","PNW",
    "AWK","CMS","DTE","ETR","EIX","PCG","PEG","AVA","NWE","OTTR"
  ],
};

export const SECTORS = Object.keys(SECTOR_TICKERS);

router.get("/sectors/list", (_req, res) => {
  res.json({ sectors: SECTORS });
});

router.get("/sectors/screen", async (req, res) => {
  const sector = (req.query.sector as string) ?? "Technology";
  const limit  = Math.min(parseInt((req.query.limit as string) ?? "50") || 50, 60);

  if (!SECTORS.includes(sector)) {
    res.status(400).json({ error: "Invalid sector", valid: SECTORS });
    return;
  }

  const cacheKey = `sector:${sector}:${limit}`;
  const cached = getCached(cacheKey);
  if (cached) { res.json(cached); return; }

  try {
    const symbols = (SECTOR_TICKERS[sector] ?? []).slice(0, limit);

    // Batch Yahoo Finance quotes for all symbols in sector
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let yqArr: any[] = [];
    try {
      const raw = await yahooFinance.quote(symbols, {}, { validateResult: false });
      yqArr = Array.isArray(raw) ? raw : [raw];
    } catch {
      // If batch fails, return empty
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const yqMap = new Map<string, any>();
    yqArr.forEach(q => { if (q?.symbol) yqMap.set(q.symbol, q); });

    const stocks = symbols
      .map(sym => {
        const q = yqMap.get(sym);
        if (!q) return null;

        const price  = q.regularMarketPrice   ?? null;
        const mc     = q.marketCap            ?? 0;
        const pe     = q.trailingPE           ?? null;
        const eps    = q.epsTrailingTwelveMonths ?? null;
        const change = q.regularMarketChangePercent ?? null;
        const vol    = q.regularMarketVolume  ?? null;
        const hi52   = q.fiftyTwoWeekHigh     ?? null;
        const lo52   = q.fiftyTwoWeekLow      ?? null;
        const sma200 = q.twoHundredDayAverage ?? null;
        const sma50  = q.fiftyDayAverage      ?? null;
        const beta   = q.beta                 ?? null;

        const vs52High = hi52  && price ? ((price / hi52  - 1) * 100) : null;
        const vs200dma = sma200 && price ? ((price / sma200 - 1) * 100) : null;
        const vs50dma  = sma50  && price ? ((price / sma50  - 1) * 100) : null;

        return {
          symbol:             sym,
          name:               q.longName ?? q.shortName ?? sym,
          price,
          change1d:           change,
          marketCap:          mc,
          marketCapFormatted: mc > 0 ? fmtCap(mc) : "N/A",
          industry:           q.industry ?? null,
          beta,
          pe,
          eps,
          volume:             vol,
          volumeFormatted:    vol != null ? fmtVol(vol) : null,
          exchange:           q.fullExchangeName ?? q.exchange ?? null,
          vs52High,
          vs200dma,
          vs50dma,
          fiftyTwoWeekHigh:   hi52,
          fiftyTwoWeekLow:    lo52,
          qualityTier:        capTier(mc),
        };
      })
      .filter(Boolean);

    // Sort by market cap descending
    stocks.sort((a, b) => ((b?.marketCap ?? 0) - (a?.marketCap ?? 0)));

    const result = { sector, count: stocks.length, stocks, cachedAt: new Date().toISOString() };
    setCached(cacheKey, result);
    res.json(result);
  } catch (err) {
    req.log?.error({ err }, "Sector screen failed");
    res.status(500).json({ error: "Failed to fetch sector data" });
  }
});

export default router;
