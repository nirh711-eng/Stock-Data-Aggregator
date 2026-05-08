import { Router } from "express";
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

router.get("/stocks/:ticker/deep-analysis", async (req, res) => {
  const parse = GetStockDeepAnalysisParams.safeParse(req.params);
  if (!parse.success) {
    res.status(400).json({ error: "Bad request", message: "Invalid ticker" });
    return;
  }

  const { ticker } = parse.data;
  const upperTicker = ticker.toUpperCase();

  try {
    const [quoteResult, qsResult] = await Promise.allSettled([
      yahooFinance.quote(upperTicker),
      yahooFinance.quoteSummary(upperTicker, {
        modules: [
          "assetProfile",
          "financialData",
          "defaultKeyStatistics",
          "calendarEvents",
          "earningsTrend",
          "earnings",
          "earningsHistory",
          "incomeStatementHistory",
        ],
      }),
    ]);

    if (quoteResult.status === "rejected") {
      res.status(404).json({ error: "Not found", message: `Ticker ${upperTicker} not found` });
      return;
    }

    const q = quoteResult.value;
    const qs = qsResult.status === "fulfilled" ? qsResult.value : null;

    const profile = qs?.assetProfile;
    const financials = qs?.financialData;
    const keyStats = qs?.defaultKeyStatistics;

    // Primary source: earnings.financialsChart.quarterly (last 4 quarters of revenue + earnings)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const quarterlyFinancials: any[] = qs?.earnings?.financialsChart?.quarterly ?? [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const quarterlyEps: any[] = qs?.earnings?.earningsChart?.quarterly ?? [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const earningsHistory: any[] = qs?.earningsHistory?.history ?? [];
    // Fallback: incomeStatementHistory (annual, less granular)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const incomeHistory: any[] = qs?.incomeStatementHistory?.incomeStatementHistory ?? [];

    // Build quarterly context from earnings module
    const latestQ = quarterlyFinancials[quarterlyFinancials.length - 1];
    const prevQ = quarterlyFinancials[quarterlyFinancials.length - 2];
    const latestEpsQ = quarterlyEps[quarterlyEps.length - 1];
    const latestEpsHistory = earningsHistory[earningsHistory.length - 1];

    // Fallback to incomeStatementHistory
    const latestIncome = incomeHistory[0];
    const prevIncome = incomeHistory[1];

    const latestRev = latestQ?.revenue ?? latestIncome?.totalRevenue ?? null;
    const prevRev = prevQ?.revenue ?? prevIncome?.totalRevenue ?? null;
    const latestEarnings = latestQ?.earnings ?? latestIncome?.netIncome ?? null;
    const latestEpsVal = latestEpsQ?.actual ?? latestEpsHistory?.epsActual ?? q.epsTrailingTwelveMonths ?? null;
    const epsEstimate = latestEpsQ?.estimate ?? latestEpsHistory?.epsEstimate ?? null;
    const epsSurprise = latestEpsHistory?.surprisePercent ?? null;
    const latestPeriod = latestQ?.date ?? latestEpsQ?.date ?? (latestIncome?.endDate ? new Date(latestIncome.endDate).toLocaleDateString("he-IL") : null);

    const revGrowthQoQ = latestRev && prevRev
      ? ((latestRev / prevRev - 1) * 100).toFixed(1) + "%"
      : "N/A";

    const companyName = q.longName ?? q.shortName ?? upperTicker;

    // Build all 4 quarters summary if available
    const quartersText = quarterlyFinancials.length > 0
      ? quarterlyFinancials.map(qf => {
        const qeps = quarterlyEps.find((e: { date: string }) => e.date === qf.date);
        return `  ${qf.date}: הכנסות ${formatNum(qf.revenue)}, רווח ${formatNum(qf.earnings)}, EPS בפועל ${qeps?.actual?.toFixed(2) ?? "N/A"} (אומדן ${qeps?.estimate?.toFixed(2) ?? "N/A"})`;
      }).join("\n")
      : "  אין נתוני רבעונים זמינים";

    const dataContext = `
חברה: ${companyName} (${upperTicker})
תעשייה: ${profile?.industry ?? "N/A"} | סקטור: ${profile?.sector ?? "N/A"}
בורסה: ${q.fullExchangeName ?? q.exchange ?? "N/A"} | מטבע: ${q.currency ?? "USD"}

--- נתוני שוק ---
מחיר: ${q.regularMarketPrice?.toFixed(2)} | שינוי יומי: ${q.regularMarketChangePercent?.toFixed(2)}%
שווי שוק: ${formatNum(q.marketCap)}
מכפיל רווח (P/E): ${q.trailingPE?.toFixed(1) ?? "N/A"} | P/E עתידי: ${q.forwardPE?.toFixed(1) ?? "N/A"}
EPS (TTM): ${q.epsTrailingTwelveMonths?.toFixed(2) ?? "N/A"} | EPS עתידי: ${q.epsForward?.toFixed(2) ?? "N/A"}
מכפיל מכירות: ${keyStats?.priceToSalesRatioTTM?.toFixed(2) ?? "N/A"}
מכפיל ספר: ${keyStats?.priceToBook?.toFixed(2) ?? "N/A"}
Beta: ${keyStats?.beta?.toFixed(2) ?? "N/A"}
52W High: ${q.fiftyTwoWeekHigh?.toFixed(2) ?? "N/A"} | 52W Low: ${q.fiftyTwoWeekLow?.toFixed(2) ?? "N/A"}

--- נתונים פיננסיים (TTM) ---
הכנסות (TTM): ${formatNum(financials?.totalRevenue)}
EBITDA: ${formatNum(financials?.ebitda)}
שולי רווח גולמי: ${pct(financials?.grossMargins)}
שולי EBITDA: ${pct(financials?.ebitdaMargins)}
שולי רווח תפעולי: ${pct(financials?.operatingMargins)}
שולי רווח נקי: ${pct(financials?.profitMargins)}
צמיחת הכנסות (YoY): ${pct(financials?.revenueGrowth)}
צמיחת רווח: ${pct(financials?.earningsGrowth)}
ROE: ${pct(financials?.returnOnEquity)}
ROA: ${pct(financials?.returnOnAssets)}
מזומן: ${formatNum(financials?.totalCash)} | חוב: ${formatNum(financials?.totalDebt)}
יחס חוב/הון עצמי: ${financials?.debtToEquity?.toFixed(2) ?? "N/A"}

--- ביצועים רבעוניים (4 רבעונים אחרונים) ---
${quartersText}

--- רבעון אחרון (${latestPeriod ?? "N/A"}) ---
הכנסות: ${formatNum(latestRev)}
רווח נקי: ${formatNum(latestEarnings)}
EPS בפועל: ${latestEpsVal?.toFixed(2) ?? "N/A"} | EPS אומדן: ${epsEstimate?.toFixed(2) ?? "N/A"}
הפתעת EPS: ${epsSurprise != null ? (epsSurprise * 100).toFixed(1) + "%" : "N/A"}
שינוי הכנסות QoQ: ${revGrowthQoQ}

--- תיאור עסקי ---
${profile?.longBusinessSummary ? profile.longBusinessSummary.slice(0, 800) : "N/A"}
`.trim();

    const systemPrompt = `אתה אנליסט בכיר במחלקת ניתוח עומק (Deep Research) של קרן גידור גלובלית מובילה, עם התמחות בזיהוי מוקדם של מקומות שבהם ערך כלכלי אמיתי נוצר ונלכד.
המטרה שלך היא לא לנתח חברה - אלא להבין את המערכת השלמה שבה היא פועלת, ולמקם אותה בתוך זרימת הערך.
כתוב בעברית. חד, ישיר, בלי מילים מיותרות. חשיבה של כסף - לא של כותרות. כל סעיף חייב לענות על: איפה הערך זז, ולמה עכשיו.
CRITICAL: החזר אך ורק JSON תקני. ללא markdown. ללא טקסט מחוץ ל-JSON.
CRITICAL: אל תשתמש לעולם בגרשיים כפולים (") בתוך ערכי הטקסט - השתמש בגרש בודד (') או בגרשיים עבריים (״) במקום. לדוגמה: כתוב דו״חות ולא דו"חות.`;

    const userPrompt = `נתח את החברה הבאה לפי המבנה המדויק:

${dataContext}

החזר JSON עם המבנה הבא בדיוק (כל השדות חובה, אל תשמיט אף שדה):
{
  "systemUnderstanding": {
    "valueChain": "פירוק שרשרת הערך של התעשייה - Upstream → Midstream → Downstream. איפה באמת נוצר הערך הכלכלי? מי לוכד מרווחים גבוהים?",
    "valueCreation": "איפה צווארי הבקבוק האמיתיים בתעשייה? מה נותן כוח - טכנולוגיה/רגולציה/סקייל/IP?",
    "bottlenecks": "מה הם כוחות המאקרו שדוחפים או פוגעים בתעשייה הזו עכשיו?",
    "macroTrends": "אילו מגמות מבניות משפיעות על התעשייה - חיוביות ושליליות"
  },
  "companyPositioning": {
    "positionInChain": "איפה בדיוק החברה יושבת בשרשרת הערך? upstream/midstream/downstream?",
    "functionalRole": "מה היא באמת עושה בתוך המערכת? לא סיסמאות - תפקיד פונקציונלי אמיתי",
    "positionQuality": "האם היא יושבת באזור בריכת ערך (Value Pool) או באזור תחרותי ושחוק? נמק"
  },
  "competitiveAdvantage": {
    "differentiation": "מה מייחד אותה בפועל לעומת מתחרות? מה שאי אפשר לשכפל בקלות?",
    "moat": "האם יש לה יתרון בר קיימא (Moat)? network effects/switching costs/cost advantage/IP? כמה זמן ישמר?",
    "competitiveLandscape": "מתחרות ישירות ועקיפות. מי יכול להיכנס לשוק? מה עוצמת האיום?"
  },
  "valueCaptureQuality": {
    "valueCapture": "האם החברה באמת לוכדת רווחיות - או רק נהנית מהייפ? ראיות מהמספרים",
    "revenueQuality": "האם ההכנסות יציבות, חוזרות, עם כוח תמחור? מה סוג ההכנסות (SaaS/עסקות/ציקליות)?",
    "warningSigns": "מה יכול להעיד שהשוק מתמחר אותה בצורה שגויה? אלמנטים מדאיגים בנתונים"
  },
  "chainComparison": {
    "betterAlternatives": "האם יש חברות אחרות באותה שרשרת שתופסות ערך בצורה טובה יותר? אילו?",
    "relativePositioning": "האם היא הבחירה הטובה ביותר בתעשייה - או רק נראית טוב על פני השטח? מדוע?"
  },
  "forwardLooking": {
    "catalysts": "מה יכול לגרום לשוק לשנות תמחור? (Repricing Catalysts) - תאריכים/אירועים/מוצרים",
    "bullCase": "תרחיש שורי: מה צריך לקרות כדי שהמניה תעלה משמעותית? מה המכפלה הפוטנציאלית?",
    "bearCase": "תרחיש דובי: מה הסיכונים האמיתיים? מה יכול להרוס את התזה?",
    "baseCase": "תרחיש בסיס: הנחות הצמיחה הריאליות וכיוון המניה ב-12 חודשים",
    "winConditions": "מה חייב לקרות כדי שהיא תהפוך לזוכה אמיתית? רשימה קצרה של תנאים קריטיים"
  },
  "conclusion": {
    "classification": "בחר בדיוק אחד: value_pool / hype / tactical / value_trap",
    "classificationLabel": "תרגום: מניית בריכת ערך / מניית הייפ / חוליה טקטית מעניינת / מלכודת ערך",
    "reasoning": "למה בחרת בסיווג הזה? 2-3 משפטים חדים עם הביסוס האמיתי",
    "actionableIdeas": "רעיונות לפעולה: Long/Short/Pair/Watchlist - עם היגיון ברור של למה עכשיו"
  },
  "eventAnalysis": {
    "realityVsNarrative": "מה בפועל קרה בדוח הרבעוני האחרון? נתח את מספרי ההכנסות, הרווח והפתעת ה-EPS מול הציפיות. עובדות יבשות מול הסיפור שמוכרים בכותרת.",
    "secondOrderThinking": "מה ההשלכות הלא-מיידיות שרוב השוק מפספס מהדוח האחרון? מה האנליסטים לא רואים?",
    "capitalFlow": "לאן כסף עשוי לזרום בעקבות הדוח? (סקטורים/תתי-סקטורים/סוגי נכסים)",
    "winners": "אילו חברות או תעשיות עשויות להרוויח מהמצב הנוכחי של ${companyName}?",
    "losers": "מי צפוי להיפגע? איפה החולשה נחשפת בעקבות הדוח?",
    "materiality": "האם הדוח מייצג רעש קצר טווח או שינוי מגמה אמיתי? מה ההשפעה על החברה/סקטור/שוק?",
    "actionableInsights": "רעיונות מסחר קונקרטיים מהדוח: Long/Short/Pair/Watchlist עם תזמון ונימוק"
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

    const raw = response.choices[0]?.message?.content ?? "{}";

    function robustParseJson(str: string): Record<string, unknown> | null {
      // Attempt 1: direct parse
      try { return JSON.parse(str); } catch { /* continue */ }

      // Attempt 2: jsonrepair — fixes structural issues (unclosed braces, dotted keys, etc.)
      try { return JSON.parse(jsonrepair(str)); } catch { /* continue */ }

      // Attempt 3: extract JSON block and repair
      const extracted = str.match(/\{[\s\S]*\}/)?.[0];
      if (!extracted) return null;
      try { return JSON.parse(jsonrepair(extracted)); } catch { /* continue */ }

      return null;
    }

    const parsed = robustParseJson(raw);
    if (!parsed) {
      req.log?.warn({ raw }, "Failed to parse AI JSON response");
      res.status(500).json({ error: "Parse error", message: "Failed to parse AI analysis" });
      return;
    }

    const fallbackEvent = {
      realityVsNarrative: "נתוני דוח רבעוני מוגבלים — ניתוח מבוסס על מדדי TTM",
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
