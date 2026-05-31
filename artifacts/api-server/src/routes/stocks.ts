import { Router } from "express";
import yahooFinanceMod from "yahoo-finance2";
import { openai } from "@workspace/integrations-openai-ai-server";
import {
  GetStockDataParams,
  GetStockSummaryParams,
  GetStockHistoryParams,
  GetStockHistoryQueryParams,
} from "@workspace/api-zod";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const YahooFinance = yahooFinanceMod as any;
const yahooFinance = new YahooFinance();
const router = Router();

function formatMarketCap(value: number): string {
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  return `$${value.toFixed(0)}`;
}

function formatCurrency(value: number | null | undefined): string | null {
  if (value == null) return null;
  if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  return `$${value.toFixed(2)}`;
}

router.get("/stocks/:ticker", async (req, res) => {
  const parse = GetStockDataParams.safeParse(req.params);
  if (!parse.success) {
    res.status(400).json({ error: "Bad request", message: "Invalid ticker" });
    return;
  }

  const { ticker } = parse.data;
  const upperTicker = ticker.toUpperCase();

  try {
    const [quote, quoteSummary] = await Promise.allSettled([
      yahooFinance.quote(upperTicker),
      yahooFinance.quoteSummary(upperTicker, {
        modules: ["assetProfile", "financialData", "defaultKeyStatistics", "calendarEvents", "incomeStatementHistory"],
      }),
    ]);

    if (quote.status === "rejected") {
      res.status(404).json({ error: "Not found", message: `Ticker ${upperTicker} not found` });
      return;
    }

    const q = quote.value;
    const qs = quoteSummary.status === "fulfilled" ? quoteSummary.value : null;

    const marketCap = q.marketCap ?? 0;

    const incomeStatements = qs?.incomeStatementHistory?.incomeStatementHistory ?? [];
    const latestIncome = incomeStatements[0];

    const quarterlyReport = {
      period: latestIncome
        ? new Date(latestIncome.endDate instanceof Date ? latestIncome.endDate : latestIncome.endDate).toLocaleDateString("en-US", { year: "numeric", month: "short" })
        : "N/A",
      revenue: latestIncome?.totalRevenue ?? null,
      revenueFormatted: formatCurrency(latestIncome?.totalRevenue ?? null),
      netIncome: latestIncome?.netIncome ?? null,
      netIncomeFormatted: formatCurrency(latestIncome?.netIncome ?? null),
      eps: latestIncome?.basicEPS ?? q.epsTrailingTwelveMonths ?? null,
      revenueGrowth: qs?.financialData?.revenueGrowth ?? null,
      reportDate: latestIncome?.endDate
        ? new Date(latestIncome.endDate instanceof Date ? latestIncome.endDate : latestIncome.endDate).toISOString().split("T")[0]
        : null,
    };

    const calendarEvents = qs?.calendarEvents;
    const upcomingEvents: Array<{ title: string; date: string; type: string; description: string | null }> = [];

    if (calendarEvents?.earnings?.earningsDate?.length) {
      for (const d of calendarEvents.earnings.earningsDate.slice(0, 3)) {
        const date = d instanceof Date ? d : new Date(d as string);
        upcomingEvents.push({
          title: "Earnings Report",
          date: date.toISOString().split("T")[0],
          type: "earnings",
          description: `Quarterly earnings for ${upperTicker}`,
        });
      }
    }

    if (calendarEvents?.dividendDate) {
      const d = calendarEvents.dividendDate instanceof Date ? calendarEvents.dividendDate : new Date(calendarEvents.dividendDate as string);
      if (!isNaN(d.getTime())) {
        upcomingEvents.push({
          title: "Dividend Payment",
          date: d.toISOString().split("T")[0],
          type: "dividend",
          description: `Expected dividend for ${upperTicker}`,
        });
      }
    }

    if (calendarEvents?.exDividendDate) {
      const d = calendarEvents.exDividendDate instanceof Date ? calendarEvents.exDividendDate : new Date(calendarEvents.exDividendDate as string);
      if (!isNaN(d.getTime())) {
        upcomingEvents.push({
          title: "Ex-Dividend Date",
          date: d.toISOString().split("T")[0],
          type: "dividend",
          description: `Ex-dividend date for ${upperTicker}`,
        });
      }
    }

    upcomingEvents.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const profile = qs?.assetProfile;

    let aiSummary: string | null = null;
    try {
      const summaryPrompt = `You are a professional financial analyst. In 2-3 concise sentences, provide a brief investment snapshot for ${upperTicker} (${q.longName ?? q.shortName ?? upperTicker}).
Current data:
- Price: ${q.currency ?? "USD"} ${q.regularMarketPrice}
- Change: ${q.regularMarketChangePercent?.toFixed(2)}% today
- Market Cap: ${formatMarketCap(marketCap)}
- P/E Ratio: ${q.trailingPE?.toFixed(1) ?? "N/A"}
- Sector: ${profile?.sector ?? "N/A"}
- Industry: ${profile?.industry ?? "N/A"}
- Revenue Growth: ${qs?.financialData?.revenueGrowth != null ? (qs.financialData.revenueGrowth * 100).toFixed(1) + "%" : "N/A"}

Focus on key strengths, risks, and what investors should watch.`;

      const response = await openai.chat.completions.create({
        model: "gpt-5-mini",
        max_completion_tokens: 200,
        messages: [{ role: "user", content: summaryPrompt }],
      });
      aiSummary = response.choices[0]?.message?.content ?? null;
    } catch (err) {
      req.log?.warn({ err }, "AI summary failed, continuing without it");
    }

    const stockData = {
      ticker: upperTicker,
      companyName: q.longName ?? q.shortName ?? upperTicker,
      price: q.regularMarketPrice ?? 0,
      priceChange: q.regularMarketChange ?? 0,
      priceChangePercent: q.regularMarketChangePercent ?? 0,
      marketCap: marketCap,
      marketCapFormatted: formatMarketCap(marketCap),
      peRatio: q.trailingPE ?? null,
      eps: q.epsTrailingTwelveMonths ?? null,
      quarterlyReport,
      upcomingEvents,
      currency: q.currency ?? "USD",
      exchange: q.fullExchangeName ?? q.exchange ?? "N/A",
      sector: profile?.sector ?? null,
      industry: profile?.industry ?? null,
      website: profile?.website ?? null,
      description: profile?.longBusinessSummary ?? null,
      aiSummary,
      marketState: (q.marketState as string) ?? null,
      preMarketPrice: q.preMarketPrice ?? null,
      preMarketChangePercent: q.preMarketChangePercent ?? null,
      postMarketPrice: q.postMarketPrice ?? null,
      postMarketChangePercent: q.postMarketChangePercent ?? null,
      regularMarketTime: q.regularMarketTime instanceof Date
        ? q.regularMarketTime.toISOString()
        : (q.regularMarketTime ? new Date((q.regularMarketTime as number) * 1000).toISOString() : null),
      fetchedAt: new Date().toISOString(),
      volume: q.regularMarketVolume ?? null,
      averageVolume: q.averageDailyVolume3Month ?? q.averageDailyVolume10Day ?? null,
      dayHigh: q.regularMarketDayHigh ?? null,
      dayLow: q.regularMarketDayLow ?? null,
      fiftyTwoWeekHigh: q.fiftyTwoWeekHigh ?? null,
      fiftyTwoWeekLow: q.fiftyTwoWeekLow ?? null,
      bid: q.bid ?? null,
      ask: q.ask ?? null,
      dividendYield: q.trailingAnnualDividendYield ?? null,
    };

    res.json(stockData);
  } catch (err) {
    req.log?.error({ err }, "Failed to fetch stock data");
    res.status(500).json({ error: "Internal server error", message: "Failed to fetch stock data" });
  }
});

router.get("/stocks/:ticker/summary", async (req, res) => {
  const parse = GetStockSummaryParams.safeParse(req.params);
  if (!parse.success) {
    res.status(400).json({ error: "Bad request", message: "Invalid ticker" });
    return;
  }

  const { ticker } = parse.data;
  const upperTicker = ticker.toUpperCase();

  try {
    const [quoteResult, qsResult] = await Promise.allSettled([
      yahooFinance.quote(upperTicker),
      yahooFinance.quoteSummary(upperTicker, { modules: ["assetProfile", "financialData"] }),
    ]);

    const q = quoteResult.status === "fulfilled" ? quoteResult.value : null;
    const qsData = qsResult.status === "fulfilled" ? qsResult.value : null;

    const prompt = `You are a professional financial analyst. In 2-3 concise sentences, provide a brief investment snapshot for ${upperTicker}${q ? ` (${q.longName ?? upperTicker})` : ""}.
${q ? `Current data: Price ${q.currency} ${q.regularMarketPrice}, P/E ${q.trailingPE?.toFixed(1) ?? "N/A"}, Market Cap ${formatMarketCap(q.marketCap ?? 0)}` : ""}
${qsData?.assetProfile?.sector ? `Sector: ${qsData.assetProfile.sector}` : ""}
Focus on key strengths, risks, and what investors should watch.`;

    const response = await openai.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    });

    res.json({
      ticker: upperTicker,
      summary: response.choices[0]?.message?.content ?? "Summary unavailable",
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    req.log?.error({ err }, "Failed to generate summary");
    res.status(500).json({ error: "Internal server error", message: "Failed to generate AI summary" });
  }
});

router.get("/stocks/:ticker/history", async (req, res) => {
  const paramsParse = GetStockHistoryParams.safeParse(req.params);
  const queryParse = GetStockHistoryQueryParams.safeParse(req.query);

  if (!paramsParse.success) {
    res.status(400).json({ error: "Bad request", message: "Invalid ticker" });
    return;
  }

  const { ticker } = paramsParse.data;
  const period = queryParse.success ? queryParse.data.period : "1mo";
  const upperTicker = ticker.toUpperCase();

  const periodMap: Record<string, { period1: string; interval: "1d" | "1wk" | "1mo" }> = {
    "1d": { period1: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split("T")[0], interval: "1d" },
    "5d": { period1: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().split("T")[0], interval: "1d" },
    "1mo": { period1: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0], interval: "1d" },
    "3mo": { period1: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0], interval: "1d" },
    "6mo": { period1: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split("T")[0], interval: "1wk" },
    "1y": { period1: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split("T")[0], interval: "1wk" },
  };

  const config = periodMap[period ?? "1mo"] ?? periodMap["1mo"];

  try {
    const historical = await yahooFinance.historical(upperTicker, {
      period1: config.period1,
      interval: config.interval,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = historical.map((item: any) => ({
      date: item.date instanceof Date ? item.date.toISOString().split("T")[0] : String(item.date),
      open: item.open ?? 0,
      high: item.high ?? 0,
      low: item.low ?? 0,
      close: item.close ?? 0,
      volume: item.volume ?? 0,
    }));

    res.json({ ticker: upperTicker, period: period ?? "1mo", data });
  } catch (err) {
    req.log?.error({ err }, "Failed to fetch stock history");
    res.status(500).json({ error: "Internal server error", message: "Failed to fetch price history" });
  }
});

export default router;
