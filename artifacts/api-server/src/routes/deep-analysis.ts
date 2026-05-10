import { Router } from "express";
import https from "https";
import yahooFinanceMod from "yahoo-finance2";
import { openai } from "@workspace/integrations-openai-ai-server";
import { GetStockDeepAnalysisParams } from "@workspace/api-zod";
import { jsonrepair } from "jsonrepair";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const YahooFinance = yahooFinanceMod as any;
const yahooFinance = new YahooFinance();

const router = Router();

function formatNum(value: number | null | undefined): string {
  if (value == null) return "N/A";
  if (Math.abs(value) >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  return `$${value.toFixed(2)}`;
}

function pct(value: number | null | undefined): string {
  if (value == null) return "N/A";
  return `${(value * 100).toFixed(1)}%`;
}

interface QuarterlyData {
  date: string;
  revenue: number | null;
  netIncome: number | null;
  grossProfit: number | null;
  dilutedEPS: number | null;
}

function fetchQuarterlyTimeseries(ticker: string): Promise<QuarterlyData[]> {
  return new Promise((resolve) => {
    const period1 = Math.floor((Date.now() - 2 * 365 * 24 * 60 * 60 * 1000) / 1000);
    const period2 = Math.floor(Date.now() / 1000);
    const types = [
      "quarterlyTotalRevenue",
      "quarterlyNetIncome",
      "quarterlyGrossProfit",
      "quarterlyDilutedEPS",
    ].join(",");
    const url = `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${ticker}?type=${encodeURIComponent(types)}&period1=${period1}&period2=${period2}&merge=false`;

    https.get(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          const results: unknown[] = json?.timeseries?.result ?? [];

          const byDate = new Map<string, Partial<Record<"revenue" | "netIncome" | "grossProfit" | "dilutedEPS", number>>>();

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const extract = (series: any[], field: "revenue" | "netIncome" | "grossProfit" | "dilutedEPS") => {
            for (const item of series) {
              const date: string = item.asOfDate;
              if (!byDate.has(date)) byDate.set(date, {});
              const raw = item.reportedValue?.raw;
              if (raw != null) byDate.get(date)![field] = raw;
            }
          };

          for (const r of results as Record<string, unknown>[]) {
            if (Array.isArray(r.quarterlyTotalRevenue)) extract(r.quarterlyTotalRevenue, "revenue");
            if (Array.isArray(r.quarterlyNetIncome)) extract(r.quarterlyNetIncome, "netIncome");
            if (Array.isArray(r.quarterlyGrossProfit)) extract(r.quarterlyGrossProfit, "grossProfit");
            if (Array.isArray(r.quarterlyDilutedEPS)) extract(r.quarterlyDilutedEPS, "dilutedEPS");
          }

          const sorted: QuarterlyData[] = Array.from(byDate.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([date, vals]) => ({
              date,
              revenue: vals.revenue ?? null,
              netIncome: vals.netIncome ?? null,
              grossProfit: vals.grossProfit ?? null,
              dilutedEPS: vals.dilutedEPS ?? null,
            }));

          resolve(sorted);
        } catch {
          resolve([]);
        }
      });
    }).on("error", () => resolve([]));
  });
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

router.get("/stocks/:ticker/deep-analysis", async (req, res) => {
  const parse = GetStockDeepAnalysisParams.safeParse(req.params);
  if (!parse.success) {
    res.status(400).json({ error: "Bad request", message: "Invalid ticker" });
    return;
  }

  const { ticker } = parse.data;
  const upperTicker = ticker.toUpperCase();

  try {
    // Fetch Yahoo Finance data + quarterly timeseries in parallel
    const [quoteResult, qsResult, quarterlyData] = await Promise.all([
      yahooFinance.quote(upperTicker).catch(() => null),
      yahooFinance.quoteSummary(upperTicker, {
        modules: ["assetProfile", "financialData", "defaultKeyStatistics", "calendarEvents"],
      }).catch(() => null),
      fetchQuarterlyTimeseries(upperTicker),
    ]);

    if (!quoteResult) {
      res.status(404).json({ error: "Not found", message: `Ticker ${upperTicker} not found` });
      return;
    }

    const q = quoteResult;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const qs: any = qsResult;

    const profile = qs?.assetProfile;
    const financials = qs?.financialData;
    const keyStats = qs?.defaultKeyStatistics;

    const companyName = q.longName ?? q.shortName ?? upperTicker;

    // Build quarterly context from timeseries data
    const latestQ = quarterlyData[quarterlyData.length - 1] ?? null;
    const prevQ = quarterlyData[quarterlyData.length - 2] ?? null;

    const revGrowthQoQ = latestQ?.revenue && prevQ?.revenue
      ? ((latestQ.revenue / prevQ.revenue - 1) * 100).toFixed(1) + "%"
      : "N/A";
    const niGrowthQoQ = latestQ?.netIncome && prevQ?.netIncome
      ? ((latestQ.netIncome / prevQ.netIncome - 1) * 100).toFixed(1) + "%"
      : "N/A";

    const quartersTable = quarterlyData.length > 0
      ? quarterlyData.map(qd => {
        const revVsPrev = quarterlyData.indexOf(qd) > 0
          ? ((qd.revenue ?? 0) / (quarterlyData[quarterlyData.indexOf(qd) - 1].revenue ?? 1) - 1 * 100)
          : null;
        void revVsPrev;
        return `  ${qd.date}: הכנסות=${formatNum(qd.revenue)}, רווח נקי=${formatNum(qd.netIncome)}, רווח גולמי=${formatNum(qd.grossProfit)}, EPS=${qd.dilutedEPS?.toFixed(2) ?? "N/A"}`;
      }).join("\n")
      : "  אין נתוני רבעונים זמינים ממקור נתונים";

    const dataContext = `
חברה: ${companyName} (${upperTicker})
תעשייה: ${profile?.industry ?? "N/A"} | סקטור: ${profile?.sector ?? "N/A"}
בורסה: ${q.fullExchangeName ?? q.exchange ?? "N/A"} | מטבע: ${q.currency ?? "USD"}

--- נתוני שוק עדכניים ---
מחיר: $${q.regularMarketPrice?.toFixed(2)} | שינוי יומי: ${q.regularMarketChangePercent?.toFixed(2)}%
שווי שוק: ${formatNum(q.marketCap)}
P/E trailing: ${q.trailingPE?.toFixed(1) ?? "N/A"} | P/E forward: ${q.forwardPE?.toFixed(1) ?? "N/A"}
EPS TTM: $${q.epsTrailingTwelveMonths?.toFixed(2) ?? "N/A"} | EPS forward: $${q.epsForward?.toFixed(2) ?? "N/A"}
P/S: ${keyStats?.priceToSalesRatioTTM?.toFixed(2) ?? "N/A"} | P/B: ${keyStats?.priceToBook?.toFixed(2) ?? "N/A"}
Beta: ${keyStats?.beta?.toFixed(2) ?? "N/A"}
52W High: $${q.fiftyTwoWeekHigh?.toFixed(2) ?? "N/A"} | 52W Low: $${q.fiftyTwoWeekLow?.toFixed(2) ?? "N/A"}

--- נתונים פיננסיים (TTM) ---
הכנסות TTM: ${formatNum(financials?.totalRevenue)}
EBITDA: ${formatNum(financials?.ebitda)}
שולי רווח גולמי: ${pct(financials?.grossMargins)}
שולי EBITDA: ${pct(financials?.ebitdaMargins)}
שולי רווח תפעולי: ${pct(financials?.operatingMargins)}
שולי רווח נקי: ${pct(financials?.profitMargins)}
צמיחת הכנסות YoY: ${pct(financials?.revenueGrowth)}
צמיחת רווח YoY: ${pct(financials?.earningsGrowth)}
ROE: ${pct(financials?.returnOnEquity)} | ROA: ${pct(financials?.returnOnAssets)}
מזומן: ${formatNum(financials?.totalCash)} | חוב: ${formatNum(financials?.totalDebt)}
יחס חוב/הון: ${financials?.debtToEquity?.toFixed(2) ?? "N/A"}

--- ביצועים רבעוניים (נתוני Yahoo Finance Timeseries — 5 רבעונים אחרונים) ---
${quartersTable}

--- השוואת שני רבעונים אחרונים ---
רבעון אחרון (${latestQ?.date ?? "N/A"}):
  הכנסות: ${formatNum(latestQ?.revenue)} | רווח נקי: ${formatNum(latestQ?.netIncome)} | EPS: $${latestQ?.dilutedEPS?.toFixed(2) ?? "N/A"}
רבעון קודם (${prevQ?.date ?? "N/A"}):
  הכנסות: ${formatNum(prevQ?.revenue)} | רווח נקי: ${formatNum(prevQ?.netIncome)} | EPS: $${prevQ?.dilutedEPS?.toFixed(2) ?? "N/A"}
שינוי QoQ: הכנסות ${revGrowthQoQ} | רווח נקי ${niGrowthQoQ}

--- תיאור עסקי ---
${profile?.longBusinessSummary ? profile.longBusinessSummary.slice(0, 800) : "N/A"}
`.trim();

    const systemPrompt = `אתה אנליסט בכיר במחלקת ניתוח עומק (Deep Research) של קרן גידור גלובלית מובילה.
הנתונים שסופקו לך הם נתוני Yahoo Finance אמיתיים ועדכניים — השתמש בהם בדיוק כפי שהם.
כתוב בעברית. חד, ישיר, ללא מילים מיותרות. חשיבה של כסף. כל סעיף חייב לענות: איפה הערך זז ולמה עכשיו.
CRITICAL: החזר אך ורק JSON תקני, ללא markdown, ללא טקסט מחוץ ל-JSON.
CRITICAL: אל תשתמש בגרשיים (") בתוך ערכי טקסט - השתמש בגרש בודד (') או גרשיים עבריים (״) במקום.`;

    const userPrompt = `נתח את ${companyName} (${upperTicker}) לפי הנתונים המדויקים הבאים:

${dataContext}

החזר JSON עם המבנה הבא בדיוק — כל שדות חובה:
{
  "systemUnderstanding": {
    "valueChain": "פירוק שרשרת ערך התעשייה. איפה נוצר ונלכד הערך האמיתי?",
    "valueCreation": "צווארי הבקבוק האמיתיים. מה נותן כוח?",
    "bottlenecks": "כוחות מאקרו שדוחפים או פוגעים בתעשייה עכשיו",
    "macroTrends": "מגמות מבניות - חיוביות ושליליות"
  },
  "companyPositioning": {
    "positionInChain": "מיקום בשרשרת הערך: upstream/midstream/downstream",
    "functionalRole": "תפקיד פונקציונלי אמיתי בתוך המערכת",
    "positionQuality": "בריכת ערך או אזור תחרותי שחוק? נמק"
  },
  "competitiveAdvantage": {
    "differentiation": "בידול אמיתי שאי אפשר לשכפל",
    "moat": "יתרון בר קיימא: network effects/switching costs/IP/cost advantage?",
    "competitiveLandscape": "מתחרים ישירים ועקיפים. עוצמת האיום"
  },
  "valueCaptureQuality": {
    "valueCapture": "האם לוכדת רווחיות אמיתית? ראיות מהמספרים שסופקו",
    "revenueQuality": "יציבות, חזרתיות, כוח תמחור. סוג הכנסות",
    "warningSigns": "אלמנטים מדאיגים בנתונים - מה יכול להיות שגוי בתמחור?"
  },
  "chainComparison": {
    "betterAlternatives": "חברות שתופסות ערך טוב יותר באותה שרשרת",
    "relativePositioning": "הבחירה הטובה ביותר בתעשייה? למה?"
  },
  "forwardLooking": {
    "catalysts": "Repricing catalysts - מה יגרום לשוק לשנות תמחור?",
    "bullCase": "תרחיש שורי: מה צריך לקרות? מכפלה פוטנציאלית?",
    "bearCase": "תרחיש דובי: סיכונים אמיתיים שיהרסו את התזה",
    "baseCase": "תרחיש בסיס: צמיחה ריאלית וכיוון ב-12 חודשים",
    "winConditions": "תנאים קריטיים שחייבים לקרות כדי לנצח"
  },
  "conclusion": {
    "classification": "value_pool / hype / tactical / value_trap",
    "classificationLabel": "מניית בריכת ערך / מניית הייפ / חוליה טקטית מעניינת / מלכודת ערך",
    "reasoning": "2-3 משפטים חדים עם ביסוס אמיתי",
    "actionableIdeas": "Long/Short/Pair/Watchlist עם היגיון ברור"
  },
  "eventAnalysis": {
    "realityVsNarrative": "נתח את הדוח הרבעוני האחרון לפי המספרים שסופקו. הכנסות בפועל, שינוי QoQ, מה הכותרות אומרות לעומת המציאות",
    "secondOrderThinking": "מה השוק מפספס? השלכות לא-מיידיות מהמספרים",
    "capitalFlow": "לאן כסף יזרום בעקבות הנתונים? סקטורים/נכסים",
    "winners": "מי ירוויח מהמצב הנוכחי של ${companyName}?",
    "losers": "מי ייפגע? איפה החולשה נחשפת?",
    "materiality": "רעש קצר טווח או שינוי מגמה? משמעות לחברה/סקטור",
    "actionableInsights": "Long/Short/Pair/Watchlist ספציפי עם תזמון ונימוק"
  }
}`;

    const response = await openai.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 4096,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? "";

    const parsed = robustParseJson(raw);
    if (!parsed) {
      req.log?.warn({ raw: raw.slice(0, 500) }, "Failed to parse AI JSON response");
      res.status(500).json({ error: "Parse error", message: "Failed to parse AI analysis" });
      return;
    }

    const fallbackEvent = {
      realityVsNarrative: "לא ניתן לנתח - בדוק שהטיקר נכון",
      secondOrderThinking: "N/A",
      capitalFlow: "N/A",
      winners: "N/A",
      losers: "N/A",
      materiality: "N/A",
      actionableInsights: "N/A",
    };

    res.json({
      ticker: upperTicker,
      companyName,
      systemUnderstanding: parsed.systemUnderstanding ?? {},
      companyPositioning: parsed.companyPositioning ?? {},
      competitiveAdvantage: parsed.competitiveAdvantage ?? {},
      valueCaptureQuality: parsed.valueCaptureQuality ?? {},
      chainComparison: parsed.chainComparison ?? {},
      forwardLooking: parsed.forwardLooking ?? {},
      conclusion: parsed.conclusion ?? {},
      eventAnalysis: parsed.eventAnalysis ?? fallbackEvent,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    req.log?.error({ err }, "Failed to run deep analysis");
    res.status(500).json({ error: "Internal server error", message: "Failed to generate deep analysis" });
  }
});

export default router;
