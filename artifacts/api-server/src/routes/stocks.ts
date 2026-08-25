import { Router } from "express";
import yahooFinanceMod from "yahoo-finance2";
import { openai } from "@workspace/integrations-openai-ai-server";
import { jsonrepair } from "jsonrepair";
import {
  GetStockDataParams,
  GetStockSummaryParams,
  GetStockHistoryParams,
  GetStockHistoryQueryParams,
} from "@workspace/api-zod";
import { isoWeekStart, latestCompletedWeekStart } from "../lib/stock-week-completion.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const YahooFinance = yahooFinanceMod as any;
const yahooFinance = new YahooFinance();
const router = Router();

const STOCK_CACHE_TTL_MS = 5 * 60 * 1000;
const _stockCache = new Map<string, { data: unknown; ts: number }>();
function getStockCache(key: string, ttlMs = STOCK_CACHE_TTL_MS): unknown | null {
  const entry = _stockCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > ttlMs) { _stockCache.delete(key); return null; }
  return entry.data;
}
function setStockCache(key: string, data: unknown) { _stockCache.set(key, { data, ts: Date.now() }); }

const ANALYTICS_CACHE_TTL_MS = 15 * 60 * 1000;

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "raw" in value) {
    const raw = (value as { raw?: unknown }).raw;
    return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  }
  return null;
}

type NormalizedCandle = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

function toDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function exchangeLocalDateKey(value: Date, exchangeTimezone: unknown): string {
  if (typeof exchangeTimezone !== "string" || !exchangeTimezone) return toDateKey(value);
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: exchangeTimezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(value);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
    const year = part("year");
    const month = part("month");
    const day = part("day");
    return year && month && day ? `${year}-${month}-${day}` : toDateKey(value);
  } catch {
    return toDateKey(value);
  }
}

function percentChange(current: number | null, base: number | null): number | null {
  if (current == null || base == null || base === 0) return null;
  return ((current / base) - 1) * 100;
}

function candlePattern(open: number, high: number, low: number, close: number): string {
  const range = high - low;
  if (range <= 0) return "ללא שינוי";
  const bodyRatio = Math.abs(close - open) / range;
  if (bodyRatio <= 0.1) return "דוג׳י — חוסר הכרעה";
  if (close > open) return bodyRatio >= 0.65 ? "נר חיובי חזק" : "נר חיובי";
  return bodyRatio >= 0.65 ? "נר שלילי חזק" : "נר שלילי";
}

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

  const cached = getStockCache(upperTicker);
  if (cached) { res.json(cached); return; }

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

    setStockCache(upperTicker, stockData);
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

router.get("/stocks/:ticker/profile", async (req, res) => {
  const parse = GetStockDataParams.safeParse(req.params);
  if (!parse.success) {
    res.status(400).json({ error: "Bad request", message: "Invalid ticker" });
    return;
  }

  const { ticker } = parse.data;
  const upperTicker = ticker.toUpperCase();

  try {
    const qsResult = await yahooFinance.quoteSummary(upperTicker, {
      modules: ["assetProfile"],
    }).catch(() => null);

    const profile = qsResult?.assetProfile ?? null;
    const description: string | null = profile?.longBusinessSummary ?? null;
    const sector: string | null = profile?.sector ?? null;
    const industry: string | null = profile?.industry ?? null;
    const website: string | null = profile?.website ?? null;
    const companyName: string = profile?.longName ?? upperTicker;
    const country: string | null = profile?.country ?? null;
    const employees: number | null = profile?.fullTimeEmployees ?? null;

    type Agreement = { type: string; partner: string | null; description: string };
    let agreements: Agreement[] = [];

    if (description) {
      try {
        const response = await openai.chat.completions.create({
          model: "gpt-5-mini",
          max_completion_tokens: 4096,
          messages: [
            {
              role: "system",
              content: `מתוך תיאור העסק שיסופק לך, חלץ 4-6 הסכמים עסקיים פעילים מרכזיים, שותפויות, חוזי הפצה, הסכמי טכנולוגיה, לקוחות מרכזיים, או ספקים אסטרטגיים.
החזר אך ורק מערך JSON תקני (ללא markdown, ללא טקסט נוסף) בפורמט:
[{"type":"שם הסוג בעברית","partner":"שם השותף/חברה או null","description":"תיאור קצר בעברית שורה אחת"}]
סוגים אפשריים: שותפות טכנולוגית, הסכם הפצה, הסכם ייצור, הסכם תוכן, לקוח אסטרטגי, ספק מרכזי, הסכם רישוי, אחר.
אל תשתמש בגרשיים כפולים בתוך ערכי הטקסט.`,
            },
            {
              role: "user",
              content: `חברה: ${upperTicker}\n${description.slice(0, 1200)}`,
            },
          ],
        });
        const content = response.choices[0]?.message?.content ?? "[]";
        const parsed = JSON.parse(jsonrepair(content));
        if (Array.isArray(parsed)) agreements = parsed.slice(0, 6) as Agreement[];
      } catch {
        agreements = [];
      }
    }

    res.json({ ticker: upperTicker, companyName, description, sector, industry, website, country, employees, agreements, generatedAt: new Date().toISOString() });
  } catch (err) {
    req.log?.error({ err }, "Failed to fetch company profile");
    res.status(500).json({ error: "Internal server error", message: "Failed to fetch company profile" });
  }
});

router.get("/stocks/:ticker/analytics", async (req, res) => {
  const parse = GetStockDataParams.safeParse(req.params);
  if (!parse.success) {
    res.status(400).json({ error: "Bad request", message: "Invalid ticker" });
    return;
  }

  const upperTicker = parse.data.ticker.toUpperCase();
  const cacheKey = `analytics:${upperTicker}`;
  const cached = getStockCache(cacheKey, ANALYTICS_CACHE_TTL_MS);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const [quoteResult, summaryResult, historyResult] = await Promise.allSettled([
      yahooFinance.quote(upperTicker),
      yahooFinance.quoteSummary(upperTicker, {
        modules: ["financialData", "defaultKeyStatistics"],
      }),
      yahooFinance.historical(upperTicker, {
        period1: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
        period2: new Date(),
        interval: "1d",
      }),
    ]);

    if (quoteResult.status === "rejected") {
      res.status(404).json({ error: "Not found", message: `Ticker ${upperTicker} not found` });
      return;
    }

    const quote = quoteResult.value;
    const summary = summaryResult.status === "fulfilled" ? summaryResult.value : null;
    const financialData = summary?.financialData;
    const keyStatistics = summary?.defaultKeyStatistics;

    const fundamentals = {
      shortFloat: asNumber(keyStatistics?.shortPercentOfFloat),
      operatingCashFlow: asNumber(financialData?.operatingCashflow),
      freeCashFlow: asNumber(financialData?.freeCashflow),
      trailingPE: asNumber(quote.trailingPE) ?? asNumber(keyStatistics?.trailingPE),
      forwardPE: asNumber(financialData?.forwardPE) ?? asNumber(quote.forwardPE),
      fiftyTwoWeekHigh: asNumber(quote.fiftyTwoWeekHigh),
      fiftyTwoWeekLow: asNumber(quote.fiftyTwoWeekLow),
    };

    // Only complete OHLC rows participate in the weekly candle calculation.
    const candles: NormalizedCandle[] = historyResult.status === "fulfilled"
      ? historyResult.value.flatMap((item: {
          date: Date | string;
          open?: unknown;
          high?: unknown;
          low?: unknown;
          close?: unknown;
          volume?: unknown;
        }) => {
          const open = asNumber(item.open);
          const high = asNumber(item.high);
          const low = asNumber(item.low);
          const close = asNumber(item.close);
          if (open == null || high == null || low == null || close == null) return [];
          const date = item.date instanceof Date
            ? exchangeLocalDateKey(item.date, quote.exchangeTimezoneName)
            : String(item.date).slice(0, 10);
          return [{
            date,
            open,
            high,
            low,
            close,
            volume: asNumber(item.volume) ?? 0,
          }];
        })
      : [];

    const ordered = candles
      .filter((candle) => !Number.isNaN(new Date(`${candle.date}T00:00:00.000Z`).getTime()))
      .sort((a, b) => a.date.localeCompare(b.date));
    const latest = ordered.at(-1) ?? null;
    const validClose = ordered.filter((candle) => candle.close != null);
    const closeAtOrBefore = (date: Date) => {
      const target = toDateKey(date);
      return validClose.filter((candle) => candle.date <= target).at(-1)?.close ?? null;
    };

    let dayReturn: number | null = null;
    if (latest) {
      const latestIndex = validClose.findIndex((candle) => candle.date === latest.date);
      dayReturn = percentChange(latest.close, latestIndex > 0 ? validClose[latestIndex - 1].close : null);
    }

    const latestDate = latest ? new Date(`${latest.date}T00:00:00.000Z`) : new Date();
    const monthAgo = new Date(latestDate);
    monthAgo.setUTCMonth(monthAgo.getUTCMonth() - 1);
    const yearAgo = new Date(latestDate);
    yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1);
    const weekAgo = new Date(latestDate);
    weekAgo.setUTCDate(weekAgo.getUTCDate() - 7);
    const yearStart = new Date(Date.UTC(latestDate.getUTCFullYear(), 0, 1));

    const returns = {
      day: dayReturn,
      week: percentChange(latest?.close ?? null, closeAtOrBefore(weekAgo)),
      month: percentChange(latest?.close ?? null, closeAtOrBefore(monthAgo)),
      ytd: percentChange(latest?.close ?? null, closeAtOrBefore(yearStart)),
      year: percentChange(latest?.close ?? null, closeAtOrBefore(yearAgo)),
    };

    const weeks = new Map<string, NormalizedCandle[]>();
    for (const candle of ordered) {
      const weekStart = isoWeekStart(candle.date);
      const group = weeks.get(weekStart) ?? [];
      group.push(candle);
      weeks.set(weekStart, group);
    }

    // Yahoo daily bars are grouped by the instrument's exchange-local ISO week.
    // This supports standard Monday–Friday equities while retaining every session
    // returned for holiday-shortened weeks.
    const today = exchangeLocalDateKey(new Date(), quote.exchangeTimezoneName);
    const completedWeekStart = latestCompletedWeekStart(
      weeks,
      today,
      String(quote.marketState ?? ""),
    );
    let latestCompletedWeek: {
      weekStart: string;
      weekEnd: string;
      dailyCandles: NormalizedCandle[];
      weeklyCandle: NormalizedCandle;
      averageDailyVolume: number | null;
      totalVolume: number | null;
      candlePattern: string;
    } | null = null;

    if (completedWeekStart) {
      const dailyCandles = (weeks.get(completedWeekStart) ?? []).sort((a, b) => a.date.localeCompare(b.date));
      const first = dailyCandles[0];
      const last = dailyCandles.at(-1);
      if (first && last) {
        const totalVolume = dailyCandles.reduce((sum, candle) => sum + candle.volume, 0);
        const averageDailyVolume = totalVolume / dailyCandles.length;
        const weeklyCandle = {
          date: last.date,
          open: first.open,
          high: Math.max(...dailyCandles.map((candle) => candle.high)),
          low: Math.min(...dailyCandles.map((candle) => candle.low)),
          close: last.close,
          volume: totalVolume,
        };
        latestCompletedWeek = {
          weekStart: completedWeekStart,
          weekEnd: last.date,
          dailyCandles,
          weeklyCandle,
          averageDailyVolume,
          totalVolume,
          candlePattern: candlePattern(weeklyCandle.open, weeklyCandle.high, weeklyCandle.low, weeklyCandle.close),
        };
      }
    }

    const analytics = {
      ticker: upperTicker,
      fetchedAt: new Date().toISOString(),
      fundamentals,
      returns,
      latestCompletedWeek,
    };
    setStockCache(cacheKey, analytics);
    res.json(analytics);
  } catch (err) {
    req.log?.error({ err }, "Failed to fetch stock analytics");
    res.status(500).json({ error: "Internal server error", message: "Failed to fetch stock analytics" });
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
      period2: new Date(),
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
