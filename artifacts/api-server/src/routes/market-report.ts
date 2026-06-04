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
  { ticker: "XLK", name: "טכנולוגיה" },
  { ticker: "XLF", name: "פיננסים" },
  { ticker: "XLV", name: "בריאות" },
  { ticker: "XLY", name: "צרכנות שיקולית" },
  { ticker: "XLP", name: "צרכנות בסיסית" },
  { ticker: "XLE", name: "אנרגיה" },
  { ticker: "XLI", name: "תעשייה" },
  { ticker: "XLC", name: "תקשורת" },
  { ticker: "XLB", name: "חומרים" },
  { ticker: "XLRE", name: "נדל\"ן" },
  { ticker: "XLU", name: "שירותים" },
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

// ── Simple cache (5 min) ───────────────────────────────────────────────────
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

// ── Finnhub general market news ───────────────────────────────────────────
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

// ── Finnhub economic calendar (today + tomorrow) ──────────────────────────
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
          resolve(
            events
              .filter(e => e.country === "US" || e.impact === "high")
              .slice(0, 10)
              .map(e => ({
                event: e.event ?? "",
                country: e.country ?? "",
                impact: e.impact ?? null,
                actual: e.actual ?? null,
                estimate: e.estimate ?? null,
                previous: e.previous ?? null,
                time: e.time ?? null,
              }))
          );
        } catch { resolve([]); }
      });
    }).on("error", () => { clearTimeout(timer); resolve([]); });
  });
}

// ── Extract pre/post market from a Yahoo quote ─────────────────────────────
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

router.get("/market/daily-report", async (req, res) => {
  const cacheKey = "market_daily_report_v2";
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
    ];

    const [quotesRaw, fredData, marketNews, mxData, economicEvents] = await Promise.all([
      withTimeout(
        yahooFinance.quote(allTickers).catch(() => [] as unknown[]),
        14000,
        [] as unknown[]
      ),
      fetchFredMacro(),
      fetchMarketNews(FINNHUB_KEY),
      fetchMarketaux("SPY"),
      fetchEconomicCalendar(FINNHUB_KEY),
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const qArr = quotesRaw as any[];
    let offset = 0;

    // Sector ETFs
    const sectorPerformance = SECTOR_ETFS.map((s, i) => {
      const q = qArr[offset + i];
      const base = extractQuote(q, s);
      return {
        ...base,
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
      return {
        ticker: c.ticker,
        name: c.name,
        price: q?.regularMarketPrice ?? null,
        changePercent: q?.regularMarketChangePercent ?? null,
        preMarketChangePercent: q?.preMarketChangePercent ?? null,
        marketState: q?.marketState ?? null,
      };
    });

    // Detect overall market state from SPY
    const spyQuote = qArr[SECTOR_ETFS.length]; // SPY is first index ticker
    const marketState: string = spyQuote?.marketState ?? "CLOSED";

    // VIX / Fear gauge
    const vixData = indices.find(i => i.ticker === "^VIX");
    const vixLevel = vixData?.price ?? null;
    const fearLabel = vixLevel != null
      ? vixLevel > 30 ? `פחד קיצוני (VIX ${vixLevel.toFixed(0)})`
        : vixLevel > 20 ? `חרדה (VIX ${vixLevel.toFixed(0)})`
          : vixLevel > 15 ? `זהירות (VIX ${vixLevel.toFixed(0)})`
            : `חמדנות (VIX ${vixLevel.toFixed(0)})`
      : "N/A";

    const sortedSectors = [...sectorPerformance].sort((a, b) => (b.changePercent ?? -999) - (a.changePercent ?? -999));
    const topSectors = sortedSectors.slice(0, 3);
    const bottomSectors = sortedSectors.slice(-3).reverse();

    // ── Build AI context ──────────────────────────────────────────────────
    const isPreMarket = marketState === "PRE";
    const isPostMarket = marketState === "POST";
    const isClosed = marketState === "CLOSED";
    const sessionLabel = isPreMarket ? "PRE-MARKET" : isPostMarket ? "AFTER-HOURS" : isClosed ? "CLOSED (נתוני סגירה)" : "REGULAR HOURS";

    const indexLines = indices.map(idx => {
      const pre = idx.preMarketChangePercent != null ? ` | Pre: ${pct(idx.preMarketChangePercent)}` : "";
      const post = idx.postMarketChangePercent != null ? ` | Post: ${pct(idx.postMarketChangePercent)}` : "";
      return `  ${idx.name} (${idx.ticker}): ${pct(idx.changePercent)} | $${idx.price?.toFixed(2) ?? "N/A"}${pre}${post}`;
    }).join("\n");

    const futuresLines = futures.map(f =>
      `  ${f.name} (${f.ticker}): ${pct(f.changePercent)} | $${f.price?.toFixed(2) ?? "N/A"}`
    ).join("\n");

    const intlLines = international.map(i =>
      `  ${i.name} (${i.ticker}): ${pct(i.changePercent)} | ${i.marketState ?? ""}`
    ).join("\n");

    const currLines = currencies.map(c =>
      `  ${c.name}: ${c.price?.toFixed(4) ?? "N/A"} | ${pct(c.changePercent)}`
    ).join("\n");

    const sectorLines = sectorPerformance.map(s => {
      const pre = s.preMarketChangePercent != null ? ` | Pre: ${pct(s.preMarketChangePercent)}` : "";
      return `  ${s.ticker} (${s.name}): ${pct(s.changePercent)} | נפח: ${s.relativeVolume != null ? s.relativeVolume.toFixed(2) + "x" : "N/A"}${pre}`;
    }).join("\n");

    const calendarLines = economicEvents.length > 0
      ? economicEvents.map(e => `  ${e.impact?.toUpperCase() ?? "?"} | ${e.country} | ${e.event} | פועלי: ${e.actual ?? "צפוי: " + (e.estimate ?? "?")} (קודם: ${e.previous ?? "?"})`).join("\n")
      : "  אין אירועים מתוזמנים";

    const newsLines = marketNews.length > 0
      ? marketNews.map(n => `  - ${n.headline}`).join("\n")
      : "  אין חדשות";

    const dataContext = `
=== דוח שוק | ${sessionLabel} | ${new Date().toLocaleDateString("he-IL", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} ===

--- מדדים ראשיים (כולל pre/post market) ---
${indexLines}
מד פחד/חמדנות: ${fearLabel}

--- חוזים עתידיים (24/7) ---
${futuresLines}

--- שווקים בינלאומיים ---
${intlLines}

--- מטבעות ---
${currLines}

--- ביצועי סקטורים ---
${sectorLines}
מובילים: ${topSectors.map(s => `${s.name} ${pct(s.changePercent)}`).join(", ")}
פגועים: ${bottomSectors.map(s => `${s.name} ${pct(s.changePercent)}`).join(", ")}

--- לוח אירועים כלכלי (היום/מחר) ---
${calendarLines}

--- מאקרו (FRED) ---
${fredData?.text ?? "לא זמין"}

--- חדשות ---
${newsLines}
${mxData?.text ? "\n" + mxData.text : ""}
`.trim();

    const sessionContext = isPreMarket
      ? "השוק בשלב PRE-MARKET. הדגש את ניתוח החוזים העתידיים, השווקים הבינלאומיים, ומה הם מרמזים על פתיחת המסחר."
      : isClosed
        ? "השוק סגור. נתח את סגירת יום המסחר האחרון והכן outlook לפתיחה הבאה."
        : isPostMarket
          ? "שלב AFTER-HOURS. נתח את סגירת הרגיל ואת המהלכים בafter-hours."
          : "מסחר רגיל פעיל.";

    const systemPrompt = `אתה ראש מחלקת Macro & Strategy בקרן גידור גלובלית.
${sessionContext}
כתוב בעברית. חד, ישיר, מקצועי. כל משפט חייב להניע כסף.
CRITICAL: החזר אך ורק JSON תקני, ללא markdown, ללא טקסט מחוץ ל-JSON.
CRITICAL: אל תשתמש בגרשיים (") בתוך ערכי טקסט — השתמש בגרש בודד (') במקום.`;

    const userPrompt = `נתח את מצב השוק לפי הנתונים הבאים:

${dataContext}

החזר JSON עם המבנה הבא:
{
  "marketPosture": "Risk-On / Risk-Off / Mixed — עם נימוק מבוסס נתונים ספציפיים",
  "premarketOutlook": "מה מצביעים החוזים העתידיים והשווקים הבינלאומיים על כיוון הפתיחה — ספציפי עם מספרים",
  "sectorRotation": "מאיפה כסף יוצא, לאן נכנס, ומה מניע זאת",
  "capitalFlow": "זרימת הון בין מניות/אגח/זהב/דולר/ביטקוין — מה זה אומר על תיאבון סיכון",
  "keyThemes": "3-4 נושאים עיקריים שמניעים את השוק עם ראיות מהנתונים",
  "topSectors": "סקטורים עם מומנטום חיובי — למה ומה דוחף",
  "weakSectors": "סקטורים חלשים — סיבות ומשמעות לתיק",
  "macroImpact": "השפעת מאקרו (ריבית/CPI/אירועים קלנדריים) על תנועות הסקטורים",
  "risks": "2-3 סיכונים מיידיים שכל מנהל תיקים חייב לעקוב",
  "tradingDayPrep": "3-4 דברים ספציפיים שצריך לעשות/לבדוק לפני/בפתיחת המסחר: מה לצפות, מה לעקוב, מה לנהל",
  "actionableInsights": "3-4 רעיונות לפעולה ספציפיים (ETF/Long/Short/Pair) עם נימוק קצר"
}`;

    const aiResponse = await openai.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 2500,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const raw = aiResponse.choices[0]?.message?.content ?? "";
    const parsedPulse = robustParseJson(raw);

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
