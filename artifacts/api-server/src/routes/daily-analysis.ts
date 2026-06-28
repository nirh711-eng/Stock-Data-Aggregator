import { Router } from "express";
import yahooFinanceMod from "yahoo-finance2";
import { openai } from "@workspace/integrations-openai-ai-server";
import { GetStockDailyAnalysisParams } from "@workspace/api-zod";
import { jsonrepair } from "jsonrepair";
import { fetchFinnhub, fetchTechnicals, fetchNewsSentiment, fetchMarketaux, fetchReddit } from "../lib/enrichment";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const YahooFinance = yahooFinanceMod as any;
const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const router = Router();

function robustParseJson(str: string): Record<string, unknown> | null {
  if (!str || str.trim() === "") return null;
  try { return JSON.parse(str); } catch { /* continue */ }
  try { return JSON.parse(jsonrepair(str)); } catch { /* continue */ }
  const extracted = str.match(/\{[\s\S]*\}/)?.[0];
  if (!extracted) return null;
  try { return JSON.parse(jsonrepair(extracted)); } catch { /* continue */ }
  return null;
}

router.get("/stocks/:ticker/daily-analysis", async (req, res) => {
  const parse = GetStockDailyAnalysisParams.safeParse(req.params);
  if (!parse.success) {
    res.status(400).json({ error: "Bad request", message: "Invalid ticker" });
    return;
  }

  const { ticker } = parse.data;
  const upperTicker = ticker.toUpperCase();

  try {
    const [quoteResult, qsResult, insightsResult, searchResult, finnhubData, techData, sentimentData, marketauxData, redditData] = await Promise.all([
      yahooFinance.quote(upperTicker).catch(() => null),
      yahooFinance.quoteSummary(upperTicker, {
        modules: ["financialData", "defaultKeyStatistics", "recommendationTrend", "assetProfile", "calendarEvents", "earningsHistory"],
      }).catch(() => null),
      yahooFinance.insights(upperTicker).catch(() => null),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      yahooFinance.search(upperTicker, { newsCount: 10, quotesCount: 0 } as any, { validateResult: false }).catch(() => null),
      fetchFinnhub(upperTicker),
      fetchTechnicals(upperTicker),
      fetchNewsSentiment(upperTicker),
      fetchMarketaux(upperTicker),
      fetchReddit(upperTicker),
    ]);

    if (!quoteResult) {
      res.status(404).json({ error: "Not found", message: `Ticker ${upperTicker} not found` });
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q = quoteResult as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const qs = qsResult as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ins = insightsResult as any;

    const companyName = q.longName ?? q.shortName ?? upperTicker;

    // Daily metrics
    const volume = q.regularMarketVolume ?? null;
    const avgVolume10d = q.averageDailyVolume10Day ?? null;
    const volumeRatio = volume && avgVolume10d ? volume / avgVolume10d : null;
    const dayLow = q.regularMarketDayLow ?? null;
    const dayHigh = q.regularMarketDayHigh ?? null;
    const price = q.regularMarketPrice ?? 0;
    const pricePositionInRange =
      dayLow != null && dayHigh != null && dayHigh !== dayLow
        ? (price - dayLow) / (dayHigh - dayLow)
        : null;

    const dailyMetrics = {
      price,
      priceChangePercent: q.regularMarketChangePercent ?? 0,
      volume,
      avgVolume10d,
      volumeRatio,
      dayLow,
      dayHigh,
      pricePositionInRange,
      shortPercentOfFloat: qs?.defaultKeyStatistics?.shortPercentOfFloat ?? null,
      shortRatio: qs?.defaultKeyStatistics?.shortRatio ?? null,
      fiftyTwoWeekChangePercent: qs?.defaultKeyStatistics?.["52WeekChange"] ?? null,
    };

    // Technical outlook from insights
    const techEvents = ins?.instrumentInfo?.technicalEvents;
    const technicalOutlook = techEvents
      ? {
          direction: techEvents.shortTermOutlook?.direction ?? "N/A",
          stateDescription: techEvents.shortTermOutlook?.stateDescription ?? "",
          score: techEvents.shortTermOutlook?.score ?? null,
        }
      : null;

    // Recent news — Yahoo Finance (primary, free) + Finnhub (supplementary)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const yfNews: any[] = (searchResult as any)?.news ?? [];
    const yfNewsItems = yfNews.slice(0, 8).map((n: any) => ({
      title: n.title ?? "",
      publisher: n.publisher ?? null,
      url: n.link ?? null,
      publishedAt: n.providerPublishTime
        ? (n.providerPublishTime instanceof Date
            ? n.providerPublishTime.toISOString()
            : new Date(n.providerPublishTime * 1000).toISOString())
        : null,
    }));

    const finnhubNewsItems = (finnhubData?.newsText ?? "")
      .split("\n")
      .filter(Boolean)
      .map(line => ({ title: line.replace(/^\s*-\s*/, "").replace(/\s*\([^)]+\)\s*$/, "").trim(), publisher: null, url: null, publishedAt: null }));

    // Merge: YF news first, then Finnhub items not already covered (dedupe by title prefix)
    const yfTitles = new Set(yfNewsItems.map(n => n.title.slice(0, 40).toLowerCase()));
    const uniqueFinnhub = finnhubNewsItems.filter(n => !yfTitles.has(n.title.slice(0, 40).toLowerCase()));
    const recentNews = [...yfNewsItems, ...uniqueFinnhub].slice(0, 12);

    // Build combined news text for AI context
    const allNewsText = recentNews.length > 0
      ? recentNews.map(n =>
          `  - ${n.title}${n.publisher ? ` (${n.publisher})` : ""}${n.publishedAt ? ` | ${new Date(n.publishedAt).toLocaleDateString("he-IL")}` : ""}`
        ).join("\n")
      : "  אין חדשות";

    // Significant developments
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sigDevs = (ins?.sigDevs ?? []).slice(0, 4).map((s: any) => ({
      headline: s.headline ?? "",
      date: s.date instanceof Date ? s.date.toISOString().split("T")[0] : s.date ?? null,
    }));

    // Analyst summary
    const recTrend = qs?.recommendationTrend?.trend?.[0] ?? null;
    const financials = qs?.financialData;
    const analystSummary = {
      recommendationKey: financials?.recommendationKey ?? null,
      targetMeanPrice: financials?.targetMeanPrice ?? null,
      numberOfAnalystOpinions: financials?.numberOfAnalystOpinions ?? null,
      strongBuy: recTrend?.strongBuy ?? 0,
      buy: recTrend?.buy ?? 0,
      hold: recTrend?.hold ?? 0,
      sell: recTrend?.sell ?? 0,
      strongSell: recTrend?.strongSell ?? 0,
    };

    // Calendar — next earnings date
    const earningsDates = qs?.calendarEvents?.earnings?.earningsDate ?? [];
    const nextEarnings = earningsDates[0] instanceof Date ? earningsDates[0] : (earningsDates[0] ? new Date(earningsDates[0]) : null);
    const daysToEarnings = nextEarnings ? Math.ceil((nextEarnings.getTime() - Date.now()) / 86400000) : null;
    const earningsDateText = nextEarnings
      ? `${nextEarnings.toISOString().slice(0, 10)} (בעוד ${daysToEarnings} ימים)`
      : "לא ידוע";

    // Most recent earnings beat/miss
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const earningsHist: any[] = qs?.earningsHistory?.history ?? [];
    const lastEarnings = earningsHist[earningsHist.length - 1] ?? null;
    const beatMissText = lastEarnings
      ? (() => {
          const actual = lastEarnings.epsActual;
          const est = lastEarnings.epsEstimate;
          const surp = lastEarnings.surprisePercent;
          const result = surp != null ? (surp > 0.005 ? "BEAT" : surp < -0.005 ? "MISS" : "IN-LINE") : "?";
          return `${result}: צפוי $${est?.toFixed(2) ?? "?"} | בפועל $${actual?.toFixed(2) ?? "?"} (${surp != null ? (surp > 0 ? "+" : "") + (surp * 100).toFixed(1) + "%" : "?"})`;
        })()
      : "לא זמין";

    // 52wk metrics
    const fw52High = q.fiftyTwoWeekHigh ?? null;
    const fw52Low = q.fiftyTwoWeekLow ?? null;
    const distFromHigh = fw52High ? ((price / fw52High - 1) * 100).toFixed(1) + "%" : "N/A";
    const distFromLow = fw52Low ? ((price / fw52Low - 1) * 100).toFixed(1) + "%" : "N/A";

    // Analyst upside
    const targetMean = qs?.financialData?.targetMeanPrice ?? null;
    const analystUpside = targetMean ? ((targetMean / price - 1) * 100).toFixed(1) + "%" : "N/A";

    // Build context for AI
    const volRatioPct = volumeRatio != null ? (volumeRatio * 100).toFixed(0) + "% מהממוצע" : "N/A";
    const priceInRange = pricePositionInRange != null
      ? pricePositionInRange > 0.65 ? "גבוה בטווח היומי (לחץ קנייה)" : pricePositionInRange < 0.35 ? "נמוך בטווח היומי (לחץ מכירה)" : "באמצע הטווח היומי"
      : "N/A";
    const totalAnalysts = analystSummary.strongBuy + analystSummary.buy + analystSummary.hold + analystSummary.sell + analystSummary.strongSell;
    const bullPct = totalAnalysts > 0 ? (((analystSummary.strongBuy + analystSummary.buy) / totalAnalysts) * 100).toFixed(0) : "0";

    // Pre/post market
    const preMarketLine = q.preMarketPrice != null
      ? `Pre-Market: $${q.preMarketPrice.toFixed(2)} (${q.preMarketChangePercent != null ? (q.preMarketChangePercent >= 0 ? "+" : "") + q.preMarketChangePercent.toFixed(2) + "%" : "N/A"})`
      : "";
    const postMarketLine = q.postMarketPrice != null
      ? `After-Hours: $${q.postMarketPrice.toFixed(2)} (${q.postMarketChangePercent != null ? (q.postMarketChangePercent >= 0 ? "+" : "") + q.postMarketChangePercent.toFixed(2) + "%" : "N/A"})`
      : "";

    const dataContext = `
חברה: ${companyName} (${upperTicker}) | סקטור: ${qs?.assetProfile?.sector ?? "N/A"}
תאריך: ${new Date().toLocaleDateString("he-IL", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
מצב שוק: ${q.marketState ?? "N/A"}
${preMarketLine ? preMarketLine + "\n" : ""}${postMarketLine ? postMarketLine + "\n" : ""}
--- נתוני מסחר יומיים ---
מחיר: $${price.toFixed(2)} | שינוי: ${dailyMetrics.priceChangePercent >= 0 ? "+" : ""}${dailyMetrics.priceChangePercent.toFixed(2)}%
טווח יום: $${dayLow?.toFixed(2)} - $${dayHigh?.toFixed(2)} | מיקום מחיר בטווח: ${priceInRange}
נפח: ${volume != null ? (volume / 1e6).toFixed(1) + "M" : "N/A"} | ממוצע 10 ימים: ${avgVolume10d != null ? (avgVolume10d / 1e6).toFixed(1) + "M" : "N/A"} | יחס נפח: ${volRatioPct}
52W High: $${fw52High?.toFixed(2) ?? "N/A"} | מרחק מה-52W High: ${distFromHigh} | 52W Low: $${fw52Low?.toFixed(2) ?? "N/A"} | עלייה מה-52W Low: ${distFromLow}
Short Interest: ${dailyMetrics.shortPercentOfFloat != null ? (dailyMetrics.shortPercentOfFloat * 100).toFixed(1) + "%" : "N/A"} | Short Ratio: ${dailyMetrics.shortRatio?.toFixed(1) ?? "N/A"} ימים

--- כיוון טכני (Trading Central) ---
${technicalOutlook ? `כיוון: ${technicalOutlook.direction} | ${technicalOutlook.stateDescription}` : "לא זמין"}

--- דוח קרוב ---
דוח הבא: ${earningsDateText}
דוח אחרון (Beat/Miss): ${beatMissText}

--- אינדיקטורים טכניים (Twelve Data) ---
${techData?.fullText ?? "לא זמין"}
SMA50: $${(q.fiftyDayAverage ?? 0) > 0 ? (q.fiftyDayAverage as number).toFixed(2) : "N/A"} | SMA200: $${(q.twoHundredDayAverage ?? 0) > 0 ? (q.twoHundredDayAverage as number).toFixed(2) : "N/A"} | מחיר מול SMA50: ${q.regularMarketPrice && q.fiftyDayAverage ? ((q.regularMarketPrice / q.fiftyDayAverage - 1) * 100).toFixed(1) + "%" : "N/A"}

--- חדשות אחרונות ---
${allNewsText}

--- עסקאות פנים אחרונות (Finnhub) ---
${finnhubData?.insiderText ?? "  לא זמין"}

--- סנטימנט חדשות ---
${sentimentData ? `ציון כולל: ${sentimentData.overallLabel} (${sentimentData.overallScore?.toFixed(3) ?? "N/A"})\n${sentimentData.articlesText}` : marketauxData?.text ?? "  ראה חדשות למעלה"}

--- סנטימנט חברתי — Reddit ---
${redditData?.contextText ?? "  לא זמין"}

--- התפתחויות משמעותיות ---
${sigDevs.length > 0 ? sigDevs.map((s: { headline: string; date: string | null }) => `- ${s.headline}`).join("\n") : "אין"}

--- קונצנזוס אנליסטים ---
המלצה: ${analystSummary.recommendationKey ?? "N/A"} | מחיר יעד: $${analystSummary.targetMeanPrice?.toFixed(2) ?? "N/A"} | upside/downside: ${analystUpside}
מספר אנליסטים: ${analystSummary.numberOfAnalystOpinions ?? 0} | קנייה: ${bullPct}% | Hold: ${totalAnalysts > 0 ? ((analystSummary.hold / totalAnalysts) * 100).toFixed(0) : 0}% | מכירה: ${totalAnalysts > 0 ? (((analystSummary.sell + analystSummary.strongSell) / totalAnalysts) * 100).toFixed(0) : 0}%
`.trim();

    const systemPrompt = `אתה אנליסט יומי בחדר מסחר מוסדי. תפקידך: לנתח מה קורה עם מניה ספציפית היום, בצורה ישירה וחדה.
נתח את הנתונים שסופקו ותן תמונה יומית ברורה. כתוב בעברית, משפטים קצרים, מספרים ספציפיים.
CRITICAL: החזר JSON תקני בלבד, ללא markdown. אל תשתמש בגרשיים (") בתוך ערכי טקסט.`;

    const userPrompt = `נתח את ${companyName} (${upperTicker}) לפי הנתונים הבאים:

${dataContext}

החזר JSON בדיוק עם המבנה הזה:
{
  "whatsMoving": "מה מזיז את המניה היום? מה הסיפור מאחורי התנועה? איזה אירוע, חדשה, או דינמיקת שוק מסביר את הכיוון",
  "buyerSellerBalance": "מי שולט היום — קונים או מוכרים? נמק ע-ב נפח מסחר, מיקום מחיר בטווח היומי, short interest, וכיוון טכני",
  "analystView": "מה חושבים האנליסטים? סיכום קונצנזוס ומחיר יעד מול מחיר נוכחי — upside או downside?",
  "actionable": "מה כדאי לעקוב היום? רמות מפתח, אירועים קרובים, או פעולה ספציפית"
}`;

    const response = await openai.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 3000,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? "";
    const parsed = robustParseJson(raw);

    const fallbackAi = {
      whatsMoving: "לא ניתן לנתח — נסה שוב",
      buyerSellerBalance: "N/A",
      analystView: "N/A",
      actionable: "N/A",
    };

    const aiAnalysis = parsed
      ? {
          whatsMoving: String(parsed.whatsMoving ?? fallbackAi.whatsMoving),
          buyerSellerBalance: String(parsed.buyerSellerBalance ?? fallbackAi.buyerSellerBalance),
          analystView: String(parsed.analystView ?? fallbackAi.analystView),
          actionable: String(parsed.actionable ?? fallbackAi.actionable),
        }
      : fallbackAi;

    res.json({
      ticker: upperTicker,
      companyName,
      marketState: q.marketState ?? null,
      dailyMetrics,
      technicalOutlook,
      recentNews,
      sigDevs,
      analystSummary,
      aiAnalysis,
      redditData: redditData ?? null,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    req.log?.error({ err }, "Failed to run daily analysis");
    res.status(500).json({ error: "Internal server error", message: "Failed to generate daily analysis" });
  }
});

export default router;
