import { Router } from "express";
import yahooFinanceMod from "yahoo-finance2";
import { openai } from "@workspace/integrations-openai-ai-server";
import { jsonrepair } from "jsonrepair";
import { fetchFredMacro, fetchMarketaux } from "../lib/enrichment";
import https from "https";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const YahooFinance = yahooFinanceMod as any;
const yahooFinance = new YahooFinance();

const router = Router();

const SECTOR_ETFS = [
  { ticker: "XLK",  name: "טכנולוגיה" },
  { ticker: "XLF",  name: "פיננסים" },
  { ticker: "XLV",  name: "בריאות" },
  { ticker: "XLY",  name: "צרכנות שיקולית" },
  { ticker: "XLP",  name: "צרכנות בסיסית" },
  { ticker: "XLE",  name: "אנרגיה" },
  { ticker: "XLI",  name: "תעשייה" },
  { ticker: "XLC",  name: "תקשורת" },
  { ticker: "XLB",  name: "חומרים" },
  { ticker: "XLRE", name: "נדל\"ן" },
  { ticker: "XLU",  name: "שירותים" },
];

const INDEX_TICKERS = [
  { ticker: "SPY",     name: "S&P 500" },
  { ticker: "QQQ",     name: "Nasdaq 100" },
  { ticker: "IWM",     name: "Russell 2000" },
  { ticker: "DIA",     name: "Dow Jones" },
  { ticker: "^VIX",    name: "VIX" },
  { ticker: "GLD",     name: "זהב" },
  { ticker: "TLT",     name: "אג\"ח 20Y" },
  { ticker: "UUP",     name: "דולר Index" },
  { ticker: "BTC-USD", name: "Bitcoin" },
];

const FUTURES_TICKERS = [
  { ticker: "ES=F",  name: "S&P 500 Fut" },
  { ticker: "NQ=F",  name: "Nasdaq Fut" },
  { ticker: "YM=F",  name: "Dow Fut" },
  { ticker: "RTY=F", name: "Russell Fut" },
  { ticker: "CL=F",  name: "נפט WTI" },
  { ticker: "GC=F",  name: "זהב Fut" },
  { ticker: "ZN=F",  name: "T-Note 10Y" },
];

const INTERNATIONAL_TICKERS = [
  { ticker: "^N225",  name: "Nikkei 225" },
  { ticker: "^HSI",   name: "Hang Seng" },
  { ticker: "^GDAXI", name: "DAX" },
  { ticker: "^FTSE",  name: "FTSE 100" },
  { ticker: "^FCHI",  name: "CAC 40" },
];

const CURRENCY_TICKERS = [
  { ticker: "EURUSD=X", name: "EUR/USD" },
  { ticker: "GBPUSD=X", name: "GBP/USD" },
  { ticker: "USDJPY=X", name: "USD/JPY" },
  { ticker: "USDILS=X", name: "USD/ILS" },
  { ticker: "DX-Y.NYB", name: "DXY" },
];

// Major stocks for pre-market rotation signal — grouped by sector
const PREMARKET_STOCKS = [
  // Tech / XLK
  { ticker: "AAPL",  name: "Apple",       sector: "טכנולוגיה" },
  { ticker: "MSFT",  name: "Microsoft",   sector: "טכנולוגיה" },
  { ticker: "NVDA",  name: "Nvidia",      sector: "טכנולוגיה" },
  { ticker: "AMD",   name: "AMD",         sector: "טכנולוגיה" },
  { ticker: "SMCI",  name: "Super Micro", sector: "טכנולוגיה" },
  // Communication / XLC
  { ticker: "META",  name: "Meta",        sector: "תקשורת" },
  { ticker: "GOOGL", name: "Alphabet",    sector: "תקשורת" },
  { ticker: "NFLX",  name: "Netflix",     sector: "תקשורת" },
  // Consumer Disc / XLY
  { ticker: "AMZN",  name: "Amazon",      sector: "צרכנות שיקולית" },
  { ticker: "TSLA",  name: "Tesla",       sector: "צרכנות שיקולית" },
  { ticker: "HD",    name: "Home Depot",  sector: "צרכנות שיקולית" },
  // Finance / XLF
  { ticker: "JPM",   name: "JPMorgan",    sector: "פיננסים" },
  { ticker: "BAC",   name: "Bank of Am",  sector: "פיננסים" },
  { ticker: "GS",    name: "Goldman",     sector: "פיננסים" },
  { ticker: "V",     name: "Visa",        sector: "פיננסים" },
  // Health / XLV
  { ticker: "LLY",   name: "Eli Lilly",   sector: "בריאות" },
  { ticker: "UNH",   name: "UnitedHealth",sector: "בריאות" },
  { ticker: "JNJ",   name: "J&J",         sector: "בריאות" },
  // Energy / XLE
  { ticker: "XOM",   name: "ExxonMobil",  sector: "אנרגיה" },
  { ticker: "CVX",   name: "Chevron",     sector: "אנרגיה" },
  // Industrials / XLI
  { ticker: "CAT",   name: "Caterpillar", sector: "תעשייה" },
  { ticker: "BA",    name: "Boeing",      sector: "תעשייה" },
];

// ── Cache ───────────────────────────────────────────────────────────────────
const _cache = new Map<string, { data: unknown; expires: number }>();
function getCache<T>(key: string): T | null {
  const e = _cache.get(key);
  if (!e || Date.now() > e.expires) return null;
  return e.data as T;
}
function setCache(key: string, data: unknown, ttlMs: number): void {
  _cache.set(key, { data, expires: Date.now() + ttlMs });
}

function pct(v: number | null | undefined): string {
  if (v == null) return "N/A";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function robustParseJson(str: string): Record<string, unknown> | null {
  if (!str || str.trim() === "") return null;
  try { return JSON.parse(str); } catch { /* continue */ }
  try { return JSON.parse(jsonrepair(str)); } catch { /* continue */ }
  const extracted = str.match(/\{[\s\S]*\}/)?.[0];
  if (!extracted) return null;
  try { return JSON.parse(jsonrepair(extracted)); } catch { /* continue */ }
  return null;
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>(res => setTimeout(() => res(fallback), ms))]);
}

function fetchMarketNews(key: string): Promise<Array<{ headline: string; source: string; datetime: number }>> {
  if (!key) return Promise.resolve([]);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve([]), 5000);
    const url = `https://finnhub.io/api/v1/news?category=general&minId=0&token=${key}`;
    https.get(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } }, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        clearTimeout(timer);
        try { resolve((JSON.parse(raw) as Array<{ headline: string; source: string; datetime: number }>).slice(0, 8)); }
        catch { resolve([]); }
      });
    }).on("error", () => { clearTimeout(timer); resolve([]); });
  });
}

function fetchEconomicCalendar(key: string): Promise<Array<{ event: string; country: string; impact: string | null; actual: string | null; estimate: string | null; previous: string | null; time: string | null }>> {
  if (!key) return Promise.resolve([]);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve([]), 5000);
    const now = new Date();
    const from = now.toISOString().split("T")[0];
    const to = new Date(now.getTime() + 86400000).toISOString().split("T")[0];
    const url = `https://finnhub.io/api/v1/calendar/economic?from=${from}&to=${to}&token=${key}`;
    https.get(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } }, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        clearTimeout(timer);
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const parsed: any = JSON.parse(raw);
          const events = (parsed?.economicCalendar?.result ?? parsed?.result ?? []) as Array<{
            event: string; country: string; impact: string; actual: string; estimate: string; previous: string; time: string;
          }>;
          resolve(events.filter(e => e.country === "US" || e.impact === "high").slice(0, 10).map(e => ({
            event: e.event ?? "", country: e.country ?? "", impact: e.impact ?? null,
            actual: e.actual ?? null, estimate: e.estimate ?? null, previous: e.previous ?? null, time: e.time ?? null,
          })));
        } catch { resolve([]); }
      });
    }).on("error", () => { clearTimeout(timer); resolve([]); });
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractQuote(q: any, def: { ticker: string; name: string }) {
  return {
    ticker: def.ticker,
    name: def.name,
    price: q?.regularMarketPrice ?? null,
    changePercent: q?.regularMarketChangePercent ?? null,
    change: q?.regularMarketChange ?? null,
    preMarketPrice: q?.preMarketPrice ?? null,
    preMarketChangePercent: q?.preMarketChangePercent ?? null,
    postMarketPrice: q?.postMarketPrice ?? null,
    postMarketChangePercent: q?.postMarketChangePercent ?? null,
    marketState: q?.marketState ?? null,
  };
}

// ── Build implied pre-market sector rotation from individual stock moves ───
function buildImpliedSectorRotation(
  premarketMovers: Array<{ ticker: string; sector: string; preMarketChangePercent: number | null; changePercent: number | null; marketState: string | null }>
): Array<{ sector: string; avgPrePct: number; stocks: string[] }> {
  const sectorMap = new Map<string, { sum: number; count: number; stocks: string[] }>();
  for (const m of premarketMovers) {
    const pcp = m.preMarketChangePercent ?? m.changePercent;
    if (pcp == null) continue;
    const prev = sectorMap.get(m.sector) ?? { sum: 0, count: 0, stocks: [] };
    prev.sum += pcp;
    prev.count += 1;
    prev.stocks.push(`${m.ticker} ${pcp >= 0 ? "+" : ""}${pcp.toFixed(2)}%`);
    sectorMap.set(m.sector, prev);
  }
  return [...sectorMap.entries()]
    .map(([sector, { sum, count, stocks }]) => ({ sector, avgPrePct: sum / count, stocks }))
    .sort((a, b) => b.avgPrePct - a.avgPrePct);
}

router.get("/market/daily-report", async (req, res) => {
  const cacheKey = "market_daily_report_v3";
  const cached = getCache<unknown>(cacheKey);
  if (cached) { res.json(cached); return; }

  try {
    const FINNHUB_KEY = process.env.FINNHUB_API_KEY ?? "";

    const allTickers = [
      ...SECTOR_ETFS.map(s => s.ticker),
      ...INDEX_TICKERS.map(i => i.ticker),
      ...FUTURES_TICKERS.map(f => f.ticker),
      ...INTERNATIONAL_TICKERS.map(i => i.ticker),
      ...CURRENCY_TICKERS.map(c => c.ticker),
      ...PREMARKET_STOCKS.map(s => s.ticker),
    ];

    const [quotesRaw, fredData, marketNews, mxData, economicEvents] = await Promise.all([
      withTimeout(yahooFinance.quote(allTickers).catch(() => [] as unknown[]), 16000, [] as unknown[]),
      fetchFredMacro(),
      fetchMarketNews(FINNHUB_KEY),
      fetchMarketaux("SPY"),
      fetchEconomicCalendar(FINNHUB_KEY),
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const qArr = quotesRaw as any[];
    let offset = 0;

    const sectorPerformance = SECTOR_ETFS.map((s, i) => {
      const q = qArr[offset + i];
      return {
        ...extractQuote(q, s),
        volume: q?.regularMarketVolume ?? null,
        avgVolume: q?.averageDailyVolume3Month ?? null,
        fiftyTwoWeekHigh: q?.fiftyTwoWeekHigh ?? null,
        fiftyTwoWeekLow: q?.fiftyTwoWeekLow ?? null,
        relativeVolume: (q?.regularMarketVolume && q?.averageDailyVolume3Month && q.averageDailyVolume3Month > 0)
          ? q.regularMarketVolume / q.averageDailyVolume3Month : null,
      };
    });
    offset += SECTOR_ETFS.length;

    const indices = INDEX_TICKERS.map((idx, i) => extractQuote(qArr[offset + i], idx));
    offset += INDEX_TICKERS.length;

    const futures = FUTURES_TICKERS.map((f, i) => extractQuote(qArr[offset + i], f));
    offset += FUTURES_TICKERS.length;

    const international = INTERNATIONAL_TICKERS.map((intl, i) => extractQuote(qArr[offset + i], intl));
    offset += INTERNATIONAL_TICKERS.length;

    const currencies = CURRENCY_TICKERS.map((c, i) => {
      const q = qArr[offset + i];
      return { ticker: c.ticker, name: c.name, price: q?.regularMarketPrice ?? null, changePercent: q?.regularMarketChangePercent ?? null, preMarketChangePercent: q?.preMarketChangePercent ?? null, marketState: q?.marketState ?? null };
    });
    offset += CURRENCY_TICKERS.length;

    // ── Pre-market movers from individual stocks ──────────────────────────
    const premarketMovers = PREMARKET_STOCKS.map((s, i) => {
      const q = qArr[offset + i];
      const preCP = q?.preMarketChangePercent ?? null;
      const postCP = q?.postMarketChangePercent ?? null;
      // Best available "extended hours" signal
      const extCP = preCP ?? postCP ?? null;
      return {
        ticker: s.ticker,
        name: s.name,
        sector: s.sector,
        price: q?.regularMarketPrice ?? null,
        changePercent: q?.regularMarketChangePercent ?? null,
        preMarketPrice: q?.preMarketPrice ?? null,
        preMarketChangePercent: preCP,
        postMarketChangePercent: postCP,
        extendedChangePercent: extCP,   // primary signal for pre/post
        marketState: q?.marketState ?? null,
      };
    });

    // Sort by abs(extended change) descending — stocks actually moving
    const sortedMovers = [...premarketMovers].sort(
      (a, b) => Math.abs(b.extendedChangePercent ?? 0) - Math.abs(a.extendedChangePercent ?? 0)
    );
    const topMovers  = sortedMovers.filter(m => (m.extendedChangePercent ?? 0) > 0).slice(0, 6);
    const bottomMovers = sortedMovers.filter(m => (m.extendedChangePercent ?? 0) < 0).slice(0, 6);

    // Implied sector rotation from pre-market moves
    const impliedSectorRotation = buildImpliedSectorRotation(premarketMovers);

    // Market state from SPY
    const spyQ = qArr[SECTOR_ETFS.length];
    const marketState: string = spyQ?.marketState ?? "CLOSED";

    // VIX
    const vixLevel = indices.find(i => i.ticker === "^VIX")?.price ?? null;
    const fearLabel = vixLevel != null
      ? vixLevel > 30 ? `פחד קיצוני (VIX ${vixLevel.toFixed(0)})` : vixLevel > 20 ? `חרדה (VIX ${vixLevel.toFixed(0)})` : vixLevel > 15 ? `זהירות (VIX ${vixLevel.toFixed(0)})` : `חמדנות (VIX ${vixLevel.toFixed(0)})`
      : "N/A";

    const isPreMarket  = marketState === "PRE";
    const isPostMarket = marketState === "POST";
    const isClosed     = marketState === "CLOSED";
    const sessionLabel = isPreMarket ? "PRE-MARKET 🔴" : isPostMarket ? "AFTER-HOURS" : isClosed ? "CLOSED (נתוני סגירה)" : "REGULAR HOURS ✅";

    // ── AI context ────────────────────────────────────────────────────────
    const extHoursNote = (isPreMarket || isPostMarket || isClosed)
      ? `\n⚠️ CRITICAL: המספרים בסקטורי ETF הם של סגירת אמש. ה-SIGNAL האמיתי לרוטציה עכשיו הוא: (1) חוזים עתידיים, (2) מניות בודדות pre-market.`
      : "";

    const futuresLines = futures.map(f =>
      `  ${f.name}: ${pct(f.changePercent)} | $${f.price?.toFixed(2) ?? "N/A"}`
    ).join("\n");

    const preMoverLines = sortedMovers
      .filter(m => m.extendedChangePercent != null)
      .slice(0, 12)
      .map(m => `  ${m.ticker} (${m.name}/${m.sector}): pre ${pct(m.extendedChangePercent)} | close ${pct(m.changePercent)}`)
      .join("\n");

    const impliedRotLines = impliedSectorRotation
      .map(r => `  ${r.sector}: implied ${r.avgPrePct >= 0 ? "+" : ""}${r.avgPrePct.toFixed(2)}% | [${r.stocks.join(", ")}]`)
      .join("\n");

    const indexLines = indices.map(idx => {
      const pre  = idx.preMarketChangePercent  != null ? ` | Pre: ${pct(idx.preMarketChangePercent)}`  : "";
      const post = idx.postMarketChangePercent != null ? ` | Post: ${pct(idx.postMarketChangePercent)}` : "";
      return `  ${idx.name}: ${pct(idx.changePercent)}${pre}${post}`;
    }).join("\n");

    const intlLines = international.map(i =>
      `  ${i.name}: ${pct(i.changePercent)} (${i.marketState ?? "?"})`
    ).join("\n");

    const currLines = currencies.map(c =>
      `  ${c.name}: ${c.price?.toFixed(4) ?? "N/A"} | ${pct(c.changePercent)}`
    ).join("\n");

    const sectorLines = sectorPerformance.map(s => {
      const pre = s.preMarketChangePercent != null ? ` | Pre ETF: ${pct(s.preMarketChangePercent)}` : "";
      return `  ${s.ticker} (${s.name}): סגירה ${pct(s.changePercent)} | נפח ${s.relativeVolume != null ? s.relativeVolume.toFixed(2) + "x" : "N/A"}${pre}`;
    }).join("\n");

    const calendarLines = economicEvents.length > 0
      ? economicEvents.map(e => `  [${e.impact?.toUpperCase() ?? "?"}] ${e.country} | ${e.event} | actual: ${e.actual ?? "צפוי: " + (e.estimate ?? "?")} (prev: ${e.previous ?? "?"})`).join("\n")
      : "  אין אירועים";

    const newsLines = marketNews.length > 0 ? marketNews.map(n => `  - ${n.headline}`).join("\n") : "  אין";

    const dataContext = `
=== דוח שוק | ${sessionLabel} | ${new Date().toLocaleDateString("he-IL", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} ===${extHoursNote}

[1] חוזים עתידיים — LIVE 24/7 (זה הסיגנל הכי חשוב כרגע)
${futuresLines}

[2] מניות בודדות — Pre/Post Market (מזה בונים רוטציית סקטורים אמיתית)
${preMoverLines || "  אין נתוני pre-market"}

[3] רוטציה מגומרת לפי סקטור (ממוצע מניות בודדות):
${impliedRotLines || "  אין מספיק נתונים"}

[4] שווקים בינלאומיים
${intlLines}

[5] מטבעות
${currLines}

[6] VIX & Fear: ${fearLabel}

[7] מדדים ראשיים (כולל pre/post שלהם)
${indexLines}

[8] ETF סקטורים — ⚠️ נתוני סגירה אחרונה בלבד:
${sectorLines}

[9] לוח אירועים כלכלי
${calendarLines}

[10] מאקרו FRED
${fredData?.text ?? "N/A"}

[11] חדשות
${newsLines}
${mxData?.text ? "\n" + mxData.text : ""}
`.trim();

    const sessionContext = isPreMarket
      ? "השוק בPRE-MARKET. הבסיס לניתוח: חוזים עתידיים + מניות בודדות pre. ETF sectors = נתוני אמש, לא רלוונטיים לרוטציה עכשיו."
      : isClosed
        ? "השוק סגור. נתוני ETF = סגירה אחרונה. רוטציה אמיתית = חוזים + pre-market movers."
        : isPostMarket
          ? "AFTER-HOURS. השתמש בpostMarket movers + חוזים לאמוד כיוון מחר."
          : "מסחר רגיל — כל הנתונים live.";

    const systemPrompt = `אתה ראש מחלקת Macro & Strategy בקרן גידור גלובלית.
${sessionContext}
כתוב בעברית. חד, ישיר, עם מספרים ספציפיים. כל משפט מניע כסף.
CRITICAL: החזר אך ורק JSON תקני, ללא markdown, ללא טקסט מחוץ ל-JSON.
CRITICAL: אל תשתמש בגרשיים (") בתוך ערכי טקסט — השתמש בגרש בודד (') במקום.`;

    const userPrompt = `נתח את מצב השוק לפי הנתונים לפי הסדר העדיפות שלהם:

${dataContext}

החזר JSON:
{
  "marketPosture": "Risk-On / Risk-Off / Mixed — נימוק עם מספרים ספציפיים מהנתונים",
  "premarketOutlook": "מה אומרים החוזים + pre-market movers על הפתיחה — ES=F ב-? , NQ=F ב-? , NVDA/AAPL/TSLA pre בכמה — מה זה מרמז",
  "sectorRotation": "רוטציה אמיתית עכשיו: לפי מניות pre-market ולפי חוזים — מאיפה כסף יוצא לאן נכנס + ראיות מספריות",
  "capitalFlow": "זרימת הון בין נכסים — מניות/אגח/זהב/דולר/ביטקוין — מה כל אחד עושה ומה זה אומר",
  "keyThemes": "3-4 נושאים מניעים עם ראיות מספריות מהנתונים",
  "topSectors": "סקטורים עם מומנטום חיובי pre-market — למה ומה דוחף עם שמות מניות",
  "weakSectors": "סקטורים חלשים pre-market — סיבות עם שמות מניות ספציפיים",
  "macroImpact": "השפעת מאקרו + לוח אירועים על התמונה",
  "risks": "2-3 סיכונים מיידיים עם הוכחות מהנתונים",
  "tradingDayPrep": "4-5 דברים ספציפיים לבדוק/לנהל: מה לעקוב, מה רמות מפתח, מה לעשות אם פתיחה חזקה/חלשה",
  "actionableInsights": "3-4 רעיונות לפעולה (ETF/Long/Short/Pair/Hedge) עם נימוק קצר ורמת הכניסה"
}`;

    const aiResponse = await openai.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 2800,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const parsedPulse = robustParseJson(aiResponse.choices[0]?.message?.content ?? "");

    const report = {
      generatedAt: new Date().toISOString(),
      marketState,
      fearLabel,
      vixLevel,
      sectorPerformance,
      indices,
      futures,
      international,
      currencies,
      economicEvents,
      premarketMovers,
      impliedSectorRotation,
      topPreMarketGainers: topMovers,
      topPreMarketLosers: bottomMovers,
      marketPulse: parsedPulse ?? {
        marketPosture: "לא זמין", premarketOutlook: "לא זמין",
        sectorRotation: "לא זמין", capitalFlow: "לא זמין",
        keyThemes: "לא זמין", topSectors: "לא זמין",
        weakSectors: "לא זמין", macroImpact: "לא זמין",
        risks: "לא זמין", tradingDayPrep: "לא זמין",
        actionableInsights: "לא זמין",
      },
    };

    setCache(cacheKey, report, 5 * 60 * 1000);
    res.json(report);
  } catch (err) {
    req.log?.error({ err }, "market-report failed");
    res.status(500).json({ error: "Internal server error", message: "Failed to generate market report" });
  }
});

export default router;
