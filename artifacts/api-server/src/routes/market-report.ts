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
  { ticker: "SPY",  name: "S&P 500" },
  { ticker: "QQQ",  name: "Nasdaq 100" },
  { ticker: "IWM",  name: "Russell 2000" },
  { ticker: "DIA",  name: "Dow Jones" },
  { ticker: "^VIX", name: "VIX" },
  { ticker: "GLD",  name: "זהב" },
  { ticker: "TLT",  name: "אג\"ח 20Y" },
  { ticker: "UUP",  name: "דולר Index" },
  { ticker: "BTC-USD", name: "Bitcoin" },
];

// ── Simple cache (5 min) ────────────────────────────────────────────────────
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

// ── Fetch Finnhub general market news ────────────────────────────────────────
function fetchMarketNews(finnhubKey: string): Promise<Array<{headline: string; source: string; datetime: number}>> {
  if (!finnhubKey) return Promise.resolve([]);
  return new Promise((resolve) => {
    const url = `https://finnhub.io/api/v1/news?category=general&minId=0&token=${finnhubKey}`;
    https.get(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } }, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        try { resolve((JSON.parse(raw) as Array<{headline: string; source: string; datetime: number}>).slice(0, 8)); }
        catch { resolve([]); }
      });
    }).on("error", () => resolve([]));
    setTimeout(() => resolve([]), 5000);
  });
}

router.get("/market/daily-report", async (req, res) => {
  const cacheKey = "market_daily_report";
  const cached = getCache<unknown>(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const FINNHUB_KEY = process.env.FINNHUB_API_KEY ?? "";
    const allTickers = [...SECTOR_ETFS.map(s => s.ticker), ...INDEX_TICKERS.map(i => i.ticker)];

    // Fetch all quotes in one batch call + macro + news in parallel
    const withTimeout = <T>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
      Promise.race([p, new Promise<T>(res => setTimeout(() => res(fallback), ms))]);

    const [quotesRaw, fredData, marketNews, mxData] = await Promise.all([
      withTimeout(
        yahooFinance.quote(allTickers).catch(() => [] as unknown[]),
        12000,
        [] as unknown[]
      ),
      fetchFredMacro(),
      fetchMarketNews(FINNHUB_KEY),
      fetchMarketaux("SPY"),
    ]);

    // Build sector performance
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sectorPerformance = SECTOR_ETFS.map((s, i) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = quotesRaw[i];
      return {
        ticker: s.ticker,
        name: s.name,
        price: q?.regularMarketPrice ?? null,
        changePercent: q?.regularMarketChangePercent ?? null,
        change: q?.regularMarketChange ?? null,
        volume: q?.regularMarketVolume ?? null,
        avgVolume: q?.averageDailyVolume3Month ?? null,
        fiftyTwoWeekHigh: q?.fiftyTwoWeekHigh ?? null,
        fiftyTwoWeekLow: q?.fiftyTwoWeekLow ?? null,
        relativeVolume: (q?.regularMarketVolume && q?.averageDailyVolume3Month && q.averageDailyVolume3Month > 0)
          ? q.regularMarketVolume / q.averageDailyVolume3Month
          : null,
      };
    });

    // Build indices
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const indices = INDEX_TICKERS.map((idx, i) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = quotesRaw[SECTOR_ETFS.length + i];
      return {
        ticker: idx.ticker,
        name: idx.name,
        price: q?.regularMarketPrice ?? null,
        changePercent: q?.regularMarketChangePercent ?? null,
        change: q?.regularMarketChange ?? null,
      };
    });

    // VIX level for fear/greed proxy
    const vixData = indices.find(i => i.ticker === "^VIX");
    const vixLevel = vixData?.price ?? null;
    const fearLabel = vixLevel != null
      ? vixLevel > 30 ? "פחד קיצוני (VIX>" + vixLevel.toFixed(0) + ")"
        : vixLevel > 20 ? "חרדה (VIX " + vixLevel.toFixed(0) + ")"
          : vixLevel > 15 ? "זהירות (VIX " + vixLevel.toFixed(0) + ")"
            : "חמדנות (VIX<" + vixLevel.toFixed(0) + ")"
      : "N/A";

    // Sort sectors by performance
    const sortedSectors = [...sectorPerformance].sort((a, b) => (b.changePercent ?? -999) - (a.changePercent ?? -999));
    const topSectors = sortedSectors.slice(0, 3);
    const bottomSectors = sortedSectors.slice(-3).reverse();

    // Build data context for AI
    const sectorLines = sectorPerformance.map(s =>
      `  ${s.ticker} (${s.name}): ${pct(s.changePercent)} | מחיר: $${s.price?.toFixed(2) ?? "N/A"} | נפח יחסי: ${s.relativeVolume != null ? s.relativeVolume.toFixed(2) + "x" : "N/A"}`
    ).join("\n");

    const indexLines = indices.map(idx =>
      `  ${idx.name} (${idx.ticker}): ${pct(idx.changePercent)} | $${idx.price?.toFixed(2) ?? "N/A"}`
    ).join("\n");

    const newsLines = marketNews.length > 0
      ? marketNews.map(n => `  - ${n.headline} (${n.source ?? "?"})`).join("\n")
      : "  אין חדשות";

    const dataContext = `
=== דוח שוק יומי | ${new Date().toLocaleDateString("he-IL", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} ===

--- מדדים ראשיים ---
${indexLines}
מד פחד/חמדנות: ${fearLabel}

--- ביצועי סקטורים (ETFs) ---
${sectorLines}

מובילים: ${topSectors.map(s => `${s.name} ${pct(s.changePercent)}`).join(", ")}
פגועים: ${bottomSectors.map(s => `${s.name} ${pct(s.changePercent)}`).join(", ")}

--- מאקרו (FRED) ---
${fredData?.text ?? "לא זמין"}

--- חדשות שוק אחרונות ---
${newsLines}
${mxData?.text ? "\n" + mxData.text : ""}
`.trim();

    const systemPrompt = `אתה ראש מחלקת Macro & Strategy בקרן גידור גלובלית.
אתה מנתח את מצב השוק בזמן אמת על סמך נתוני ETFs, מדדים, נפחים ונתוני מאקרו.
כתוב בעברית. חד, ישיר, מקצועי. כל משפט חייב לנוע כסף.
CRITICAL: החזר אך ורק JSON תקני, ללא markdown, ללא טקסט מחוץ ל-JSON.
CRITICAL: אל תשתמש בגרשיים (") בתוך ערכי טקסט — השתמש בגרש בודד (') במקום.`;

    const userPrompt = `נתח את מצב השוק לפי הנתונים הבאים:

${dataContext}

החזר JSON עם המבנה הבא:
{
  "marketPosture": "Risk-On / Risk-Off / Mixed — עם נימוק מבוסס נתונים",
  "sectorRotation": "ניתוח רוטציה: מאיפה כסף יוצא לאן נכנס + מה מניע זאת",
  "capitalFlow": "זרימת הון בין נכסים: מניות/אג\"ח/זהב/דולר/ביטקוין — מה זה אומר על תיאבון סיכון",
  "keyThemes": "3-4 נושאים עיקריים שמניעים את השוק כרגע עם ראיות מהנתונים",
  "topSectors": "סקטורים עם מומנטום חיובי — למה בדיוק ומה ממשיך לדחוף אותם",
  "weakSectors": "סקטורים חלשים — סיבות ומשמעות לתיק",
  "macroImpact": "השפעת מאקרו נוכחית (ריבית/CPI/VIX) על תנועות הסקטורים",
  "risks": "2-3 סיכונים מיידיים שכל מנהל תיקים חייב לעקוב אחריהם",
  "actionableInsights": "3-4 רעיונות לפעולה ספציפיים (ETF/Long/Short/Pair) עם נימוק קצר לכל אחד"
}`;

    const aiResponse = await openai.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 2048,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const raw = aiResponse.choices[0]?.message?.content ?? "";
    const parsedPulse = robustParseJson(raw);

    const report = {
      generatedAt: new Date().toISOString(),
      fearLabel,
      vixLevel,
      sectorPerformance,
      indices,
      marketPulse: parsedPulse ?? {
        marketPosture: "לא זמין",
        sectorRotation: "לא זמין",
        capitalFlow: "לא זמין",
        keyThemes: "לא זמין",
        topSectors: "לא זמין",
        weakSectors: "לא זמין",
        macroImpact: "לא זמין",
        risks: "לא זמין",
        actionableInsights: "לא זמין",
      },
    };

    setCache(cacheKey, report, 5 * 60 * 1000); // 5 min cache
    res.json(report);
  } catch (err) {
    req.log?.error({ err }, "Failed to generate market daily report");
    res.status(500).json({ error: "Internal server error", message: "Failed to generate market report" });
  }
});

export default router;
