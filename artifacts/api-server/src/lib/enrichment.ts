import https from "https";

// ── Generic fetch with timeout ────────────────────────────────────────────────

function fetchJson<T = unknown>(url: string, timeoutMs = 5000): Promise<T | null> {
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

// ── Simple in-memory cache ────────────────────────────────────────────────────

const _cache = new Map<string, { data: unknown; expires: number }>();
function getCache<T>(key: string): T | null {
  const e = _cache.get(key);
  if (!e || Date.now() > e.expires) return null;
  return e.data as T;
}
function setCache(key: string, data: unknown, ttlMs: number): void {
  _cache.set(key, { data, expires: Date.now() + ttlMs });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function today(): string { return new Date().toISOString().split("T")[0]; }
function daysAgo(n: number): string {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}
function fmtB(v: number | null | undefined): string {
  if (v == null || isNaN(v as number)) return "N/A";
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  return `$${v.toFixed(2)}`;
}

const FINNHUB_KEY   = process.env.FINNHUB_API_KEY        ?? "";
const FMP_KEY       = process.env.FMP_API_KEY             ?? "";
const FRED_KEY      = process.env.FRED_API_KEY            ?? "";
const TWELVE_KEY    = process.env.TWELVE_DATA_API_KEY     ?? "";
const AV_KEY        = process.env.ALPHA_VANTAGE_API_KEY   ?? "";
const MARKETAUX_KEY = process.env.MARKETAUX_API_KEY       ?? "";

// ── Finnhub: news + insider transactions + peers ──────────────────────────────

export interface FinnhubData {
  newsText: string;
  insiderText: string;
  peersText: string;
}

type FinnhubNewsItem = { headline: string; source: string; datetime: number };
type FinnhubInsider  = { name?: string; transactionType?: string; share?: number; transactionPrice?: number; transactionDate?: string };
type FinnhubInsiderRes = { data?: FinnhubInsider[] };

export async function fetchFinnhub(ticker: string): Promise<FinnhubData | null> {
  if (!FINNHUB_KEY) return null;
  try {
    const [newsRaw, insiderRaw, peersRaw] = await Promise.all([
      fetchJson<FinnhubNewsItem[]>(
        `https://finnhub.io/api/v1/company-news?symbol=${ticker}&from=${daysAgo(7)}&to=${today()}&token=${FINNHUB_KEY}`
      ),
      fetchJson<FinnhubInsiderRes>(
        `https://finnhub.io/api/v1/stock/insider-transactions?symbol=${ticker}&token=${FINNHUB_KEY}`
      ),
      fetchJson<string[]>(
        `https://finnhub.io/api/v1/stock/peers?symbol=${ticker}&token=${FINNHUB_KEY}`
      ),
    ]);

    const news = (Array.isArray(newsRaw) ? newsRaw : []).slice(0, 3);
    const newsText = news.length > 0
      ? news.map(n => `  - ${n.headline} (${n.source ?? "?"}, ${new Date((n.datetime || 0) * 1000).toLocaleDateString("he-IL")})`).join("\n")
      : "  אין חדשות";

    const insiders = (insiderRaw?.data ?? []).slice(0, 4);
    const insiderText = insiders.length > 0
      ? insiders.map(t => {
          const isSell = (t.transactionType ?? "").toLowerCase().includes("sell");
          const dir = isSell ? "✗ מכר" : "✓ קנה";
          return `  ${dir} | ${t.name ?? "?"} | ${Math.abs(t.share ?? 0).toLocaleString()} מניות @ $${t.transactionPrice?.toFixed(2) ?? "?"} (${t.transactionDate ?? "?"})`;
        }).join("\n")
      : "  אין עסקאות פנים";

    const peers = (Array.isArray(peersRaw) ? peersRaw : []).filter(p => p !== ticker).slice(0, 6);
    const peersText = peers.length > 0 ? peers.join(", ") : "לא זמין";

    return { newsText, insiderText, peersText };
  } catch {
    return null;
  }
}

// ── FMP: quarterly income statement + institutional holders ───────────────────

export interface FmpData {
  incomeText: string;
  holdersText: string;
}

type FmpIncome = {
  date: string; period: string;
  revenue: number; grossProfit: number; grossProfitRatio: number;
  operatingIncome: number; operatingIncomeRatio: number;
  netIncome: number; eps: number; ebitda: number;
  researchAndDevelopmentExpenses?: number;
};
type FmpHolder = { holder: string; shares: number; dateReported: string; change: number; changePercentage: number };

export async function fetchFmp(ticker: string): Promise<FmpData | null> {
  if (!FMP_KEY) return null;
  try {
    const [incomeRaw, holdersRaw] = await Promise.all([
      fetchJson<FmpIncome[]>(
        `https://financialmodelingprep.com/api/v3/income-statement/${ticker}?period=quarter&limit=4&apikey=${FMP_KEY}`
      ),
      fetchJson<FmpHolder[]>(
        `https://financialmodelingprep.com/api/v3/institutional-holder/${ticker}?apikey=${FMP_KEY}`
      ),
    ]);

    const stmts = (Array.isArray(incomeRaw) ? incomeRaw : []).slice(0, 2);
    const incomeText = stmts.length > 0
      ? stmts.map(q => {
          const rd = q.researchAndDevelopmentExpenses ? ` R&D=${fmtB(q.researchAndDevelopmentExpenses)}` : "";
          return `  ${q.date} (${q.period}): Rev=${fmtB(q.revenue)} GP=${fmtB(q.grossProfit)} (${(q.grossProfitRatio * 100).toFixed(1)}%) OpInc=${fmtB(q.operatingIncome)} (${(q.operatingIncomeRatio * 100).toFixed(1)}%) Net=${fmtB(q.netIncome)} EPS=$${q.eps?.toFixed(2) ?? "N/A"} EBITDA=${fmtB(q.ebitda)}${rd}`;
        }).join("\n")
      : "  לא זמין";

    const holders = (Array.isArray(holdersRaw) ? holdersRaw : []).slice(0, 3);
    const holdersText = holders.length > 0
      ? holders.map(h => {
          const chg = h.change > 0 ? `+${h.change.toLocaleString()}` : (h.change ?? 0).toLocaleString();
          return `  ${h.holder}: ${h.shares?.toLocaleString() ?? "?"} מניות | שינוי: ${chg} (${h.changePercentage?.toFixed(1) ?? "?"}%) | ${h.dateReported ?? "?"}`;
        }).join("\n")
      : "  לא זמין";

    return { incomeText, holdersText };
  } catch {
    return null;
  }
}

// ── FRED: key macro indicators (cached 1 hour) ────────────────────────────────

export interface FredMacro {
  text: string;
  fedRate: string;
  t10yield: string;
  cpiYoY: string;
  unemployment: string;
}

type FredObs = { observations?: Array<{ value: string; date: string }> };

export async function fetchFredMacro(): Promise<FredMacro | null> {
  if (!FRED_KEY) return null;
  const cached = getCache<FredMacro>("fred_macro");
  if (cached) return cached;

  try {
    const base = "https://api.stlouisfed.org/fred/series/observations";
    const [fedRaw, t10Raw, cpiRaw, unempRaw] = await Promise.all([
      fetchJson<FredObs>(`${base}?series_id=FEDFUNDS&sort_order=desc&limit=1&api_key=${FRED_KEY}&file_type=json`),
      fetchJson<FredObs>(`${base}?series_id=GS10&sort_order=desc&limit=1&api_key=${FRED_KEY}&file_type=json`),
      fetchJson<FredObs>(`${base}?series_id=CPIAUCSL&sort_order=desc&limit=13&api_key=${FRED_KEY}&file_type=json`),
      fetchJson<FredObs>(`${base}?series_id=UNRATE&sort_order=desc&limit=1&api_key=${FRED_KEY}&file_type=json`),
    ]);

    const get = (d: FredObs | null) => d?.observations?.[0]?.value ?? "N/A";
    const fedRate      = get(fedRaw);
    const t10yield     = get(t10Raw);
    const unemployment = get(unempRaw);

    let cpiYoY = "N/A";
    const obs = cpiRaw?.observations ?? [];
    if (obs.length >= 13) {
      const latest  = parseFloat(obs[0].value);
      const yearAgo = parseFloat(obs[12].value);
      if (latest && yearAgo) cpiYoY = ((latest / yearAgo - 1) * 100).toFixed(1) + "%";
    }

    const text = `ריבית Fed: ${fedRate}% | תשואת אג"ח 10Y: ${t10yield}% | אינפלציה CPI (YoY): ${cpiYoY} | שיעור אבטלה: ${unemployment}%`;
    const result: FredMacro = { text, fedRate, t10yield, cpiYoY, unemployment };
    setCache("fred_macro", result, 60 * 60 * 1000);
    return result;
  } catch {
    return null;
  }
}

// ── Twelve Data: RSI(14) + MACD ───────────────────────────────────────────────

export interface TechnicalsData {
  rsi: number | null;
  rsiText: string;
  macdText: string;
  fullText: string;
}

type TdRsi  = { values?: Array<{ rsi: string }> };
type TdMacd = { values?: Array<{ macd: string; macd_signal: string; macd_hist: string }> };

export async function fetchTechnicals(ticker: string): Promise<TechnicalsData | null> {
  if (!TWELVE_KEY) return null;
  try {
    const [rsiRaw, macdRaw] = await Promise.all([
      fetchJson<TdRsi>(`https://api.twelvedata.com/rsi?symbol=${ticker}&interval=1day&time_period=14&outputsize=1&apikey=${TWELVE_KEY}`),
      fetchJson<TdMacd>(`https://api.twelvedata.com/macd?symbol=${ticker}&interval=1day&fast_period=12&slow_period=26&signal_period=9&outputsize=1&apikey=${TWELVE_KEY}`),
    ]);

    const rsiVal = rsiRaw?.values?.[0]?.rsi ? parseFloat(rsiRaw.values[0].rsi) : null;
    const rsiText = rsiVal != null
      ? `RSI(14): ${rsiVal.toFixed(1)} ${rsiVal > 70 ? "⚠ OVERBOUGHT" : rsiVal < 30 ? "⚠ OVERSOLD" : "(נייטרלי)"}`
      : "RSI(14): N/A";

    const m = macdRaw?.values?.[0];
    const histVal = m ? parseFloat(m.macd_hist) : null;
    const macdText = m
      ? `MACD: ${parseFloat(m.macd).toFixed(3)} | Signal: ${parseFloat(m.macd_signal).toFixed(3)} | Hist: ${histVal?.toFixed(3) ?? "N/A"} ${(histVal ?? 0) > 0 ? "↑ Bullish momentum" : "↓ Bearish momentum"}`
      : "MACD: N/A";

    return { rsi: rsiVal, rsiText, macdText, fullText: `${rsiText}\n${macdText}` };
  } catch {
    return null;
  }
}

// ── Alpha Vantage: news sentiment ─────────────────────────────────────────────

export interface NewsSentimentData {
  overallLabel: string;
  overallScore: number | null;
  articlesText: string;
}

type AVFeed = {
  title: string; source: string;
  overall_sentiment_label?: string;
  ticker_sentiment?: Array<{ ticker: string; ticker_sentiment_label: string; ticker_sentiment_score: string }>;
};
type AVResponse = { overall_sentiment_label?: string; overall_sentiment_score?: string; feed?: AVFeed[] };

export async function fetchNewsSentiment(ticker: string): Promise<NewsSentimentData | null> {
  if (!AV_KEY) return null;
  try {
    const data = await fetchJson<AVResponse>(
      `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${ticker}&limit=5&sort=LATEST&apikey=${AV_KEY}`
    );
    if (!data?.feed || data.feed.length === 0) return null;

    const overall = data.overall_sentiment_label ?? "N/A";
    const overallScore = data.overall_sentiment_score ? parseFloat(data.overall_sentiment_score) : null;

    const articlesText = data.feed.slice(0, 5).map(a => {
      const ts = a.ticker_sentiment?.find(t => t.ticker === ticker);
      const label = ts?.ticker_sentiment_label ?? a.overall_sentiment_label ?? "?";
      const score = ts?.ticker_sentiment_score ? parseFloat(ts.ticker_sentiment_score).toFixed(2) : null;
      return `  - ${a.title} (${a.source}) | ${label}${score ? ` [${score}]` : ""}`;
    }).join("\n");

    return { overallLabel: overall, overallScore, articlesText };
  } catch {
    return null;
  }
}

// ── Marketaux: news + entity sentiment ───────────────────────────────────────

export interface MarketauxData {
  text: string;
}

type MxArticle  = { title: string; source: string; entities?: Array<{ symbol: string; sentiment_score: number }> };
type MxResponse = { data?: MxArticle[] };

export async function fetchMarketaux(ticker: string): Promise<MarketauxData | null> {
  if (!MARKETAUX_KEY) return null;
  try {
    const data = await fetchJson<MxResponse>(
      `https://api.marketaux.com/v1/news/all?symbols=${ticker}&filter_entities=true&language=en&limit=5&api_token=${MARKETAUX_KEY}`
    );
    if (!data?.data || data.data.length === 0) return null;

    const lines = data.data.slice(0, 5).map(a => {
      const ent = a.entities?.find(e => e.symbol === ticker);
      const s = ent?.sentiment_score ?? null;
      const label = s != null ? (s > 0.1 ? "חיובי" : s < -0.1 ? "שלילי" : "נייטרלי") : "";
      return `  - ${a.title} (${a.source})${label ? " | " + label : ""}`;
    }).join("\n");

    return { text: lines };
  } catch {
    return null;
  }
}
