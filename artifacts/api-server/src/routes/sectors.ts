import { Router } from "express";
import yahooFinanceMod from "yahoo-finance2";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const YahooFinance = yahooFinanceMod as any;
const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const router = Router();

// ── In-memory cache ───────────────────────────────────────────────────────────
const _cache = new Map<string, { data: unknown; expires: number }>();
function getCached<T>(key: string): T | null {
  const e = _cache.get(key);
  if (!e || Date.now() > e.expires) return null;
  return e.data as T;
}
function setCached(key: string, data: unknown, ttlMs = 30 * 60 * 1000) {
  _cache.set(key, { data, expires: Date.now() + ttlMs });
}

// ── Formatting ────────────────────────────────────────────────────────────────
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

// ── Hammer detection ──────────────────────────────────────────────────────────
function isHammer(o: number, h: number, l: number, c: number): boolean {
  if (h === l || o == null || h == null || l == null || c == null) return false;
  const body  = Math.abs(c - o);
  const range = h - l;
  if (range === 0 || body / range < 0.03) return false; // avoid doji
  const lower = Math.min(o, c) - l;
  const upper = h - Math.max(o, c);
  return lower >= 2.0 * body && upper <= 0.35 * body;
}

// ── Curated ticker lists — LARGE caps + RADAR/MID tier mixes ─────────────────
const SECTOR_TICKERS: Record<string, string[]> = {
  "Technology": [
    // Large cap leaders
    "AAPL","MSFT","NVDA","AVGO","ORCL","CRM","ADBE","AMD","QCOM","TXN",
    "IBM","AMAT","KLAC","LRCX","MU","NXPI","ON","MCHP","MPWR","FTNT",
    "ANSS","CDNS","SNPS","NET","PANW","SNOW","PLTR","CRWD","DDOG","ZS",
    "OKTA","MDB","HUBS","CFLT","TWLO","TTD","APP","BILL","ASAN","GTLB",
    // Mid cap ($1B–$10B)
    "PCTY","JAMF","APPN","DOMO","BRZE","SQSP","DOCN","TOST","SMAR","MNDY",
    "AIOT","RELY","AZEK","WEAV","NCNO","EVBG","BLKB","CODA","ACMR","FORM",
    // Radar ($100M–$1B)
    "SMTC","COHU","ATEN","DIOD","VICR","KLIC","CCSI","LSCC","PLAB","CEVA",
    "SLAB","MKSI","AMSC","HIMX","SIMO","NTGR","PCYC","MFAC","IDCC","INSG",
  ],
  "Healthcare": [
    // Large cap
    "UNH","LLY","JNJ","ABBV","MRK","PFE","TMO","ABT","DHR","BMY",
    "AMGN","GILD","CVS","CI","ISRG","BSX","MDT","ELV","HCA","SYK",
    "BIIB","VRTX","REGN","MRNA","ZBH","DXCM","IDXX","WST","IQV","MCK",
    // Mid cap
    "HIMS","TDOC","ACCD","PHR","DOCS","GDRX","AMWL","NVCR","ALKS","RARE",
    "ARWR","KRYS","ACAD","AXSM","PRGO","FOLD","APLS","INVA","TARS","PTGX",
    // Radar
    "AKRO","KYMR","ACER","VNDA","PNTM","ACHC","MTEX","TNXP","ANAB","ASRT",
    "NVAX","OCGN","NVTA","GRPH","RCUS","IMVT","DVAX","CRVS","AGIO","FATE",
  ],
  "Financial Services": [
    // Large cap
    "BRK-B","JPM","V","MA","BAC","WFC","GS","MS","AXP","BLK",
    "SCHW","CB","MET","PGR","C","USB","TFC","SPGI","CME","ICE",
    "COF","BK","STT","PNC","TRV","AIG","AON","MMC","MSCI","MCO",
    // Mid cap
    "UPST","AFRM","SOFI","LC","OPEN","PFSI","NRDS","ENVA","WRLD","CACC",
    "CURO","TREE","LPRO","MGLN","HTLF","ABCB","NCBS","BCAL","FBIZ","PRAA",
    // Radar
    "EZCORP","COOP","SIGI","NRIM","NIC","SBFG","UFCS","WSFS","CFBK","TBNK",
    "MVBF","HONE","BSVN","CZFS","CHMG","ESSA","FFIC","GFED","HARL","LKFN",
  ],
  "Energy": [
    // Large cap
    "XOM","CVX","COP","SLB","EOG","PSX","VLO","OXY","MPC","KMI",
    "WMB","HAL","DVN","BKR","FANG","TRGP","EQT","APA","MRO","HES",
    // Mid cap
    "SBOW","TALO","MARPS","VET","VAALCO","AROC","CIVI","MNRL","PTEN","RES",
    "SGU","GEOC","SM","MGY","CHRD","MTDR","CTRA","PR","LNG","OKE",
    // Radar
    "REX","BORR","NINE","WTTR","KLXE","CXDO","AMPY","SWN","ESTE","ARIS",
    "SND","NEXT","PHX","MMLP","RCON","USPH","NGAS","PTR","INDO","DINO",
  ],
  "Consumer Cyclical": [
    // Large cap
    "AMZN","TSLA","HD","MCD","NKE","SBUX","LOW","TJX","CMG","GM",
    "F","ABNB","BKNG","MAR","HLT","YUM","DRI","EBAY","ETSY","ROST",
    "ORLY","AZO","ULTA","CVNA","NVR","PHM","DHI","LEN","TOL","MDC",
    // Mid cap
    "VSCO","LESL","ODP","LOVE","THO","PATK","GOED","PRKS","KTB","CARG",
    "SBH","CURB","LZB","KIRK","ETD","JOUT","CULP","GASS","BCOR","RCII",
    // Radar
    "EXPR","GCO","BOOT","POWW","BNED","CONN","LAUR","VVPR","HSON","QURE",
    "PLCE","CATO","CHICO","DXLG","TLYS","KOSS","FOSL","CPRI","KSS","PRTY",
  ],
  "Consumer Defensive": [
    // Large cap
    "WMT","PG","COST","KO","PEP","PM","MO","MDLZ","CL","GIS",
    "HSY","CPB","K","CHD","CLX","CAG","HRL","MKC","TSN","SJM",
    "KHC","STZ","TAP","BF-B","CELH","MNST","KDP","COKE","FLO","THS",
    // Mid cap
    "CALM","LANC","SENEA","JJSF","MGPI","DENN","LWAY","AGRO","CVGW","IPAR",
    "ANDE","HLLY","JBSS","FRPT","VLGEA","PTLO","SMPL","HAIN","UNFI","SFM",
    // Radar
    "MGPI","IOSP","NATR","MGLN","EDBL","BRFS","CENT","PZZA","JACK","DIN",
    "DINE","FAT","HABT","TXRH","EAT","BLMN","NATH","LOCO","PBPB","UFPI",
  ],
  "Industrials": [
    // Large cap
    "CAT","DE","HON","UPS","RTX","BA","LMT","GE","MMM","EMR",
    "ITW","ETN","PH","ROK","DOV","GD","NOC","TDG","CARR","OTIS",
    "FDX","NSC","UNP","CSX","WAB","EXPD","CHRW","GWW","FAST","ODFL",
    // Mid cap
    "HXL","TREX","MATX","GATX","GTES","TRN","CW","DXPE","AZZ","CRS",
    "MTRN","NVEE","POWL","KFRC","GNSS","XPO","JBHT","SAIA","LSTR","ARCB",
    // Radar
    "CTOS","HLVX","PGTI","TILE","APOG","MFAC","ARIS","GENC","LMB","HTLD",
    "MRTN","WERN","HUBG","ECHO","FWRD","UHAL","ATRI","PRIM","MYRG","STRL",
  ],
  "Communication Services": [
    // Large cap
    "GOOGL","META","NFLX","CMCSA","DIS","T","VZ","CHTR","TMUS","EA",
    "TTWO","WBD","FOXA","PARA","IAC","ROKU","SPOT","PINS","SNAP","MTCH",
    // Mid cap
    "TKO","NWSA","AMCX","YELP","ANGI","GENI","ZETA","DV","MGNI","PERI",
    "IDT","ITRN","SIRI","LBRDA","ZM","RBLX","U","LYFT","UBER","DASH",
    // Radar
    "IHRT","GCI","LUMN","CTT","KGLA","JMIA","SATS","ATNI","IDT","ACTG",
    "QUAD","MNI","NXST","SBGI","GTN","SSP","FUTU","MOMO","DOYU","HUYA",
  ],
  "Real Estate": [
    // Large cap
    "PLD","AMT","EQIX","SPG","O","CCI","PSA","EXR","DLR","SBAC",
    "WELL","VTR","EQR","AVB","ARE","BXP","KIM","MAA","CPT","NNN",
    // Mid cap
    "WPC","STAG","IRT","TRNO","COLD","IIPR","LXP","GTY","GOOD","UNIT",
    "ALEX","ROIC","PLYM","UHT","CHCT","NXRT","INN","CLPR","MNR","GMRE",
    // Radar
    "VRE","NXRT","SGRY","SAFE","ONNI","REXR","IIIV","GOOD","VICI","SVC",
    "APLE","SOHO","CLDT","AHREIT","BRSP","FSP","VNO","SLG","OFC","DEA",
  ],
  "Basic Materials": [
    // Large cap
    "LIN","APD","SHW","FCX","NEM","NUE","VMC","MLM","ALB","CE",
    "MOS","CF","IFF","FMC","PPG","ECL","DD","DOW","EMN","HUN",
    // Mid cap
    "NGVT","KALU","ATI","CMC","CRS","MTRN","IOSP","SXC","KRO","TROX",
    "RYAM","ASH","ASIX","CCK","SEE","PKG","IP","WRK","AVY","SON",
    // Radar
    "GEF","SLGN","BALL","OI","BMS","GPK","CLW","MERC","HWKN","KWR",
    "GMET","OMG","KOP","UAMY","USAK","CSTM","SXC","ZEUS","IIIN","CENX",
  ],
  "Utilities": [
    // Large cap
    "NEE","DUK","SO","D","AEP","EXC","SRE","XEL","ES","WEC",
    "ED","PPL","AEE","FE","CNP","LNT","EVRG","NI","OGE","PNW",
    // Mid cap
    "AWK","CMS","DTE","ETR","EIX","PCG","PEG","MGEE","ALLETE","AWR",
    "SJW","MSEX","CWCO","UTL","ARTNA","YORW","LABL","CTWS","KINS","OTTR",
    // Radar
    "CWST","NJR","NFG","SR","AGR","GAS","GOOS","ARLO","BWEN","PHX",
    "CEQP","USPH","NGAS","MMLP","MEMP","FCPT","SPTN","WATT","AMTD","REGI",
  ],
};

export const SECTORS = Object.keys(SECTOR_TICKERS);

router.get("/sectors/list", (_req, res) => {
  res.json({ sectors: SECTORS });
});

router.get("/sectors/screen", async (req, res) => {
  const sector = (req.query.sector as string) ?? "Technology";
  const limit  = Math.min(parseInt((req.query.limit as string) ?? "60") || 60, 80);

  if (!SECTORS.includes(sector)) {
    res.status(400).json({ error: "Invalid sector", valid: SECTORS });
    return;
  }

  const cacheKey = `sector:${sector}:${limit}:v2`;
  const cached = getCached(cacheKey);
  if (cached) { res.json(cached); return; }

  try {
    const symbols = (SECTOR_TICKERS[sector] ?? []).slice(0, limit);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let yqArr: any[] = [];
    try {
      const raw = await yahooFinance.quote(symbols, {}, { validateResult: false });
      yqArr = Array.isArray(raw) ? raw : [raw];
    } catch { /* return empty on failure */ }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const yqMap = new Map<string, any>();
    yqArr.forEach(q => { if (q?.symbol) yqMap.set(q.symbol, q); });

    const stocks = symbols
      .map(sym => {
        const q = yqMap.get(sym);
        if (!q) return null;

        const price   = q.regularMarketPrice           ?? null;
        const mc      = q.marketCap                    ?? 0;
        const pe      = q.trailingPE                   ?? null;
        const eps     = q.epsTrailingTwelveMonths       ?? null;
        const change  = q.regularMarketChangePercent    ?? null;
        const vol     = q.regularMarketVolume           ?? null;
        const avgVol  = q.averageDailyVolume3Month      ?? null;
        const hi52    = q.fiftyTwoWeekHigh              ?? null;
        const lo52    = q.fiftyTwoWeekLow               ?? null;
        const sma200  = q.twoHundredDayAverage          ?? null;
        const sma50   = q.fiftyDayAverage               ?? null;
        const beta    = q.beta                          ?? null;
        const dayOpen = q.regularMarketOpen             ?? null;
        const dayHigh = q.regularMarketDayHigh          ?? null;
        const dayLow  = q.regularMarketDayLow           ?? null;

        const vs52High    = hi52   && price ? ((price / hi52   - 1) * 100) : null;
        const vs200dma    = sma200 && price ? ((price / sma200 - 1) * 100) : null;
        const vs50dma     = sma50  && price ? ((price / sma50  - 1) * 100) : null;
        const relVolume   = (vol != null && avgVol && avgVol > 0) ? vol / avgVol : null;

        // Daily hammer from today's OHLC
        const hammerDaily = (dayOpen != null && dayHigh != null && dayLow != null && price != null)
          ? isHammer(dayOpen, dayHigh, dayLow, price)
          : false;

        return {
          symbol:             sym,
          name:               q.longName ?? q.shortName ?? sym,
          price,
          change1d:           change,
          marketCap:          mc,
          marketCapFormatted: mc > 0 ? fmtCap(mc) : "N/A",
          industry:           q.industry    ?? null,
          beta,
          pe,
          eps,
          volume:             vol,
          avgVolume:          avgVol,
          relVolume,
          volumeFormatted:    vol != null ? fmtVol(vol) : null,
          exchange:           q.fullExchangeName ?? q.exchange ?? null,
          vs52High,
          vs200dma,
          vs50dma,
          fiftyTwoWeekHigh:   hi52,
          fiftyTwoWeekLow:    lo52,
          dayOpen,
          dayHigh,
          dayLow,
          hammerDaily,
          qualityTier:        capTier(mc),
        };
      })
      .filter(Boolean);

    stocks.sort((a, b) => ((b?.marketCap ?? 0) - (a?.marketCap ?? 0)));

    const result = { sector, count: stocks.length, stocks, cachedAt: new Date().toISOString() };
    setCached(cacheKey, result);
    res.json(result);
  } catch (err) {
    req.log?.error({ err }, "Sector screen failed");
    res.status(500).json({ error: "Failed to fetch sector data" });
  }
});

// ── Weekly hammer signal scan ─────────────────────────────────────────────────
router.get("/sectors/signals", async (req, res) => {
  const sector = (req.query.sector as string) ?? "Technology";
  const signal = (req.query.signal as string) ?? "hammer_weekly";

  if (!SECTORS.includes(sector)) {
    res.status(400).json({ error: "Invalid sector" });
    return;
  }
  if (signal !== "hammer_weekly") {
    res.status(400).json({ error: "Unsupported signal. Use: hammer_weekly" });
    return;
  }

  const cacheKey = `signals:${sector}:${signal}:v2`;
  const cached = getCached(cacheKey);
  if (cached) { res.json(cached); return; }

  try {
    const symbols = (SECTOR_TICKERS[sector] ?? []).slice(0, 60);

    // First get quotes for basic data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let yqArr: any[] = [];
    try {
      const raw = await yahooFinance.quote(symbols, {}, { validateResult: false });
      yqArr = Array.isArray(raw) ? raw : [raw];
    } catch { /* continue */ }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const yqMap = new Map<string, any>();
    yqArr.forEach(q => { if (q?.symbol) yqMap.set(q.symbol, q); });

    // Fetch weekly chart for each symbol — concurrency limit 6
    const threeWeeksAgo = new Date(Date.now() - 28 * 86400000).toISOString().split("T")[0];

    async function fetchWeeklyHammer(sym: string): Promise<{ isHammerWeekly: boolean; weekOpen: number | null; weekHigh: number | null; weekLow: number | null; weekClose: number | null }> {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chart = await (yahooFinance as any).chart(sym, { period1: threeWeeksAgo, interval: "1wk" });
        const quotes = (chart?.quotes ?? []) as Array<{ open: number; high: number; low: number; close: number; date: Date }>;
        // Use the most recent complete weekly candle
        const candle = quotes.length >= 2 ? quotes[quotes.length - 2] : quotes[quotes.length - 1];
        if (!candle) return { isHammerWeekly: false, weekOpen: null, weekHigh: null, weekLow: null, weekClose: null };
        return {
          isHammerWeekly: isHammer(candle.open, candle.high, candle.low, candle.close),
          weekOpen:  candle.open  ?? null,
          weekHigh:  candle.high  ?? null,
          weekLow:   candle.low   ?? null,
          weekClose: candle.close ?? null,
        };
      } catch {
        return { isHammerWeekly: false, weekOpen: null, weekHigh: null, weekLow: null, weekClose: null };
      }
    }

    // Process in batches of 6 for concurrency
    const results: Array<{ sym: string } & Awaited<ReturnType<typeof fetchWeeklyHammer>>> = [];
    for (let i = 0; i < symbols.length; i += 6) {
      const batch = symbols.slice(i, i + 6);
      const batchResults = await Promise.all(batch.map(async s => ({ sym: s, ...(await fetchWeeklyHammer(s)) })));
      results.push(...batchResults);
    }

    const matches = results
      .filter(r => r.isHammerWeekly)
      .map(r => {
        const q = yqMap.get(r.sym);
        const mc = q?.marketCap ?? 0;
        return {
          symbol:             r.sym,
          name:               q?.longName ?? q?.shortName ?? r.sym,
          price:              q?.regularMarketPrice ?? null,
          change1d:           q?.regularMarketChangePercent ?? null,
          marketCap:          mc,
          marketCapFormatted: mc > 0 ? fmtCap(mc) : "N/A",
          industry:           q?.industry ?? null,
          qualityTier:        capTier(mc),
          volume:             q?.regularMarketVolume ?? null,
          avgVolume:          q?.averageDailyVolume3Month ?? null,
          relVolume:          (q?.regularMarketVolume && q?.averageDailyVolume3Month > 0)
            ? q.regularMarketVolume / q.averageDailyVolume3Month : null,
          vs52High: (q?.fiftyTwoWeekHigh && q?.regularMarketPrice)
            ? ((q.regularMarketPrice / q.fiftyTwoWeekHigh - 1) * 100) : null,
          vs200dma: (q?.twoHundredDayAverage && q?.regularMarketPrice)
            ? ((q.regularMarketPrice / q.twoHundredDayAverage - 1) * 100) : null,
          weekOpen:  r.weekOpen,
          weekHigh:  r.weekHigh,
          weekLow:   r.weekLow,
          weekClose: r.weekClose,
          isHammerWeekly: true,
        };
      });

    const result = { sector, signal, matches, count: matches.length, scannedCount: symbols.length, cachedAt: new Date().toISOString() };
    setCached(cacheKey, result, 60 * 60 * 1000); // 60-min cache for signal scans
    res.json(result);
  } catch (err) {
    req.log?.error({ err }, "Sector signals scan failed");
    res.status(500).json({ error: "Failed to run signal scan" });
  }
});

export default router;
