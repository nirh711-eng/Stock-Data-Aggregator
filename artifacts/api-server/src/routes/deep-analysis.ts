import { Router } from "express";
import https from "https";
import yahooFinanceMod from "yahoo-finance2";
import { openai } from "@workspace/integrations-openai-ai-server";
import { GetStockDeepAnalysisParams } from "@workspace/api-zod";
import { jsonrepair } from "jsonrepair";
import {
  fetchFinnhub, fetchFmp, fetchFredMacro,
  fetchTechnicals, fetchNewsSentiment, fetchMarketaux, fetchPolygon,
} from "../lib/enrichment";
import pino from "pino";

const bgLogger = pino({ level: "info" });

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
  freeCashFlow: number | null;
  operatingCashFlow: number | null;
}

function fetchQuarterlyTimeseries(ticker: string): Promise<QuarterlyData[]> {
  const TIMEOUT_MS = 7000;

  const fetchPromise = new Promise<QuarterlyData[]>((resolve) => {
    const period1 = Math.floor((Date.now() - 2 * 365 * 24 * 60 * 60 * 1000) / 1000);
    const period2 = Math.floor(Date.now() / 1000);
    const types = [
      "quarterlyTotalRevenue",
      "quarterlyNetIncome",
      "quarterlyGrossProfit",
      "quarterlyDilutedEPS",
      "quarterlyFreeCashFlow",
      "quarterlyOperatingCashFlow",
    ].join(",");
    const url = `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${ticker}?type=${encodeURIComponent(types)}&period1=${period1}&period2=${period2}&merge=false`;

    const req = https.get(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          const results: unknown[] = json?.timeseries?.result ?? [];

          const byDate = new Map<string, Partial<Record<"revenue" | "netIncome" | "grossProfit" | "dilutedEPS" | "freeCashFlow" | "operatingCashFlow", number>>>();

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const extract = (series: any[], field: "revenue" | "netIncome" | "grossProfit" | "dilutedEPS" | "freeCashFlow" | "operatingCashFlow") => {
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
            if (Array.isArray(r.quarterlyFreeCashFlow)) extract(r.quarterlyFreeCashFlow, "freeCashFlow");
            if (Array.isArray(r.quarterlyOperatingCashFlow)) extract(r.quarterlyOperatingCashFlow, "operatingCashFlow");
          }

          const sorted: QuarterlyData[] = Array.from(byDate.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([date, vals]) => ({
              date,
              revenue: vals.revenue ?? null,
              netIncome: vals.netIncome ?? null,
              grossProfit: vals.grossProfit ?? null,
              dilutedEPS: vals.dilutedEPS ?? null,
              freeCashFlow: vals.freeCashFlow ?? null,
              operatingCashFlow: vals.operatingCashFlow ?? null,
            }));

          resolve(sorted);
        } catch {
          resolve([]);
        }
      });
    });
    req.on("error", () => resolve([]));
    req.setTimeout(TIMEOUT_MS, () => { req.destroy(); resolve([]); });
  });

  const timeoutPromise = new Promise<QuarterlyData[]>((resolve) =>
    setTimeout(() => resolve([]), TIMEOUT_MS + 500)
  );

  return Promise.race([fetchPromise, timeoutPromise]);
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

// ── Server-side cache (60 min per ticker) ─────────────────────────────────────
const _deepCache = new Map<string, { data: unknown; expires: number }>();
function getDeepCache<T>(key: string): T | null {
  const e = _deepCache.get(key);
  if (!e || Date.now() > e.expires) return null;
  return e.data as T;
}
function setDeepCache(key: string, data: unknown) {
  _deepCache.set(key, { data, expires: Date.now() + 60 * 60 * 1000 });
}

// ── Background job tracking ────────────────────────────────────────────────────
const _runningJobs = new Set<string>();
const _jobErrors = new Map<string, string>();

// ── Full analysis extracted for background execution ──────────────────────────
async function runDeepAnalysisJob(upperTicker: string): Promise<void> {
  try {
    // Fetch all data sources in parallel
    const QS_TIMEOUT = 12000;
    const qsWithTimeout = Promise.race([
      yahooFinance.quoteSummary(upperTicker, {
        modules: [
          "assetProfile",
          "financialData",
          "defaultKeyStatistics",
          "calendarEvents",
          "recommendationTrend",
          "upgradeDowngradeHistory",
          "earningsHistory",
          "earningsTrend",
          "incomeStatementHistoryQuarterly",
          "balanceSheetHistoryQuarterly",
          "cashflowStatementHistoryQuarterly",
        ],
      }).catch(() => null),
      new Promise<null>((r) => setTimeout(() => r(null), QS_TIMEOUT)),
    ]);

    const [
      quoteResult, qsResult, quarterlyData,
      finnhubData, fmpData, fredData, yNewsData,
      techData, sentimentData, marketauxData, polygonData,
    ] = await Promise.all([
      yahooFinance.quote(upperTicker).catch(() => null),
      qsWithTimeout,
      fetchQuarterlyTimeseries(upperTicker),
      fetchFinnhub(upperTicker),
      fetchFmp(upperTicker),
      fetchFredMacro(),
      yahooFinance.search(upperTicker, { quotesCount: 0, newsCount: 5 }, { validateResult: false }).catch(() => null),
      fetchTechnicals(upperTicker),
      fetchNewsSentiment(upperTicker),
      fetchMarketaux(upperTicker),
      fetchPolygon(upperTicker),
    ]);

    if (!quoteResult) {
      _jobErrors.set(upperTicker, `Ticker ${upperTicker} not found`);
      return;
    }

    const q = quoteResult;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const qs: any = qsResult;

    const profile = qs?.assetProfile;
    const financials = qs?.financialData;
    const keyStats = qs?.defaultKeyStatistics;

    // ── Management Profile ───────────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const officers: any[] = profile?.companyOfficers ?? [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ceoOfficer = officers.find((o: any) =>
      (o.title ?? "").toLowerCase().includes("chief executive") ||
      (o.title ?? "").toLowerCase().includes("ceo")
    ) ?? officers[0] ?? null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cfoOfficer = officers.find((o: any) =>
      (o.title ?? "").toLowerCase().includes("chief financial") ||
      (o.title ?? "").toLowerCase().includes("cfo")
    ) ?? null;
    const ceoName = ceoOfficer ? `${ceoOfficer.name ?? "N/A"} (${ceoOfficer.title ?? "N/A"})` : "N/A";
    const cfoName = cfoOfficer ? cfoOfficer.name ?? "N/A" : "N/A";
    const ceoAge = ceoOfficer?.age ?? null;

    // ── Advanced Financial Ratios ────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const incomeStmts: any[] = qs?.incomeStatementHistoryQuarterly?.incomeStatementHistory ?? [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const balanceSheets: any[] = qs?.balanceSheetHistoryQuarterly?.balanceSheetStatements ?? [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cashflowStmts: any[] = qs?.cashflowStatementHistoryQuarterly?.cashflowStatements ?? [];

    const latestIncome = incomeStmts[0] ?? null;
    const latestBalance = balanceSheets[0] ?? null;
    const latestCashflow = cashflowStmts[0] ?? null;

    // ROIC: NOPAT (annualized) / Invested Capital
    const ebitQ: number | null = latestIncome?.ebit?.raw ?? null;
    const incomeTaxQ: number | null = latestIncome?.incomeTaxExpense?.raw ?? null;
    const incomeBeforeTaxQ: number | null = latestIncome?.incomeBeforeTax?.raw ?? null;
    const taxRate = (incomeTaxQ != null && incomeBeforeTaxQ != null && incomeBeforeTaxQ !== 0)
      ? Math.max(0, Math.min(0.5, Math.abs(incomeTaxQ / incomeBeforeTaxQ)))
      : 0.21;
    const nopatAnnual = ebitQ != null ? ebitQ * 4 * (1 - taxRate) : null;

    const totalEquity: number | null = latestBalance?.totalStockholderEquity?.raw ?? null;
    const longTermDebt: number | null = latestBalance?.longTermDebt?.raw ?? null;
    const shortTermDebt: number | null = latestBalance?.shortLongTermDebt?.raw ?? null;
    const totalDebtBalance = (longTermDebt ?? 0) + (shortTermDebt ?? 0);
    const investedCapital = totalEquity != null ? totalEquity + totalDebtBalance : null;

    const roic = nopatAnnual != null && investedCapital != null && investedCapital > 0
      ? nopatAnnual / investedCapital
      : null;
    const roicStr = roic != null
      ? `${(roic * 100).toFixed(1)}% ${roic > 0.15 ? "🟢 מצוין (>15%)" : roic > 0.08 ? "🟡 ממוצע (8-15%)" : "🔴 נמוך (<8%)"}`
      : "N/A";

    // Interest Coverage: EBIT(annual) / |Interest Expense(annual)|
    const interestExpQ: number | null = latestIncome?.interestExpense?.raw ?? null;
    const ebitAnnual = ebitQ != null ? ebitQ * 4 : null;
    const interestExpAnnual = interestExpQ != null ? interestExpQ * 4 : null;
    const interestCoverage = ebitAnnual != null && interestExpAnnual != null && interestExpAnnual !== 0
      ? ebitAnnual / Math.abs(interestExpAnnual)
      : null;
    const interestCoverageStr = interestCoverage != null
      ? `${interestCoverage.toFixed(1)}x ${interestCoverage < 1.5 ? "🔴 סיכון גבוה (<1.5x)" : interestCoverage < 3 ? "🟡 מוגבל (1.5-3x)" : "🟢 בריא (>3x)"}`
      : "N/A";

    // CAPEX Analysis
    const capexQ: number | null = latestCashflow?.capitalExpenditures?.raw ?? null;
    const depreciationQ: number | null = latestCashflow?.depreciation?.raw ?? null;
    const capexAnnual = capexQ != null ? Math.abs(capexQ) * 4 : null;
    const depreciationAnnual = depreciationQ != null ? Math.abs(depreciationQ) * 4 : null;
    const capexToRev = capexAnnual != null && financials?.totalRevenue != null && financials.totalRevenue > 0
      ? `${(capexAnnual / financials.totalRevenue * 100).toFixed(1)}%`
      : "N/A";
    const capexToDepr = capexAnnual != null && depreciationAnnual != null && depreciationAnnual > 0
      ? capexAnnual / depreciationAnnual
      : null;
    const capexTypeLabel = capexToDepr != null
      ? capexToDepr > 1.5
        ? `📈 Growth CAPEX (${capexToDepr.toFixed(1)}x פחת — השקעה לצמיחה)`
        : capexToDepr > 0.9
          ? `⚖️ Maintenance+ (${capexToDepr.toFixed(1)}x פחת)`
          : `🔧 Maintenance בלבד (${capexToDepr.toFixed(1)}x פחת)`
      : "N/A";

    // ── News deduplication across all sources ────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const yNewsItems: any[] = yNewsData?.news ?? [];

    interface RawNewsItem { headline: string; source: string; sentiment?: string }
    const allNewsRaw: RawNewsItem[] = [
      ...yNewsItems.slice(0, 6).map((n: { title?: string; publisher?: string }) => ({
        headline: n.title ?? "",
        source: n.publisher ?? "Yahoo Finance",
      })),
      ...(Array.isArray(finnhubData?.newsText ? [] : []) ? [] : []).map(() => ({ headline: "", source: "" })),
    ];

    // Parse Finnhub news lines manually
    if (finnhubData?.newsText && finnhubData.newsText !== "  אין חדשות") {
      const fhLines = finnhubData.newsText.split("\n");
      for (const line of fhLines) {
        const m = line.match(/- (.+?) \((.+?),/);
        if (m) allNewsRaw.push({ headline: m[1] ?? "", source: m[2] ?? "Finnhub" });
      }
    }

    // Parse Marketaux news lines
    if (marketauxData?.text) {
      const mxLines = marketauxData.text.split("\n");
      for (const line of mxLines) {
        const m = line.match(/- (.+?) \((.+?)\)/);
        if (m) {
          const sentMatch = line.match(/\| (.+?)$/);
          allNewsRaw.push({ headline: m[1] ?? "", source: m[2] ?? "Marketaux", sentiment: sentMatch?.[1] });
        }
      }
    }

    // Alpha Vantage sentiment articles
    if (sentimentData?.articlesText) {
      const avLines = sentimentData.articlesText.split("\n");
      for (const line of avLines) {
        const m = line.match(/- (.+?) \((.+?)\)/);
        if (m) {
          const sentMatch = line.match(/\| (.+?)(?:\s*\[|$)/);
          allNewsRaw.push({ headline: m[1] ?? "", source: m[2] ?? "Alpha Vantage", sentiment: sentMatch?.[1]?.trim() });
        }
      }
    }

    // Deduplicate by first 50 chars of headline (case-insensitive)
    const seenKeys = new Set<string>();
    const deduped: RawNewsItem[] = [];
    for (const item of allNewsRaw) {
      if (!item.headline) continue;
      const key = item.headline.toLowerCase().replace(/[^a-z0-9\u0590-\u05fe]/g, "").slice(0, 50);
      if (!seenKeys.has(key)) { seenKeys.add(key); deduped.push(item); }
    }
    const mergedNewsText = deduped.slice(0, 12).length > 0
      ? deduped.slice(0, 12).map(n =>
          `  - ${n.headline} (${n.source})${n.sentiment ? " | " + n.sentiment : ""}`
        ).join("\n")
      : "  לא זמין";

    // ── Cross-validated quarterly table (Yahoo + FMP + Polygon) ─────────────────
    // Build best-of-three quarterly rows: use the source with the most data per date
    interface CrossQRow { date: string; rev: string; ni: string; gp: string; eps: string; ocf: string; sources: string }
    const crossRows: CrossQRow[] = [];

    // Yahoo timeseries is most granular — use as base
    const yahooQs = quarterlyData.slice(-4);
    for (const yq of yahooQs) {
      // Find closest FMP quarter (same year-quarter)
      const fmpMatch = (Array.isArray(fmpData?.incomeText) ? [] : []);
      void fmpMatch; // We'll use text only for the prompt; numeric merge uses Polygon

      // Find closest Polygon quarter
      const polyMatch = polygonData?.quarters.find(pq => pq.period.startsWith(yq.date.slice(0, 7)));

      const rev    = yq.revenue       ?? polyMatch?.revenue       ?? null;
      const ni     = yq.netIncome     ?? polyMatch?.netIncome     ?? null;
      const gp     = yq.grossProfit   ?? polyMatch?.grossProfit   ?? null;
      const eps    = yq.dilutedEPS    ?? polyMatch?.eps           ?? null;
      const ocf    = yq.operatingCashFlow ?? polyMatch?.ocf       ?? null;

      const revDelta = yq.revenue && polyMatch?.revenue
        ? ` [Δ${(((yq.revenue / polyMatch.revenue) - 1) * 100).toFixed(1)}%]`
        : "";
      const usedSources = [
        yq.revenue != null ? "Y" : null,
        polyMatch?.revenue != null ? "P" : null,
      ].filter(Boolean).join("+");

      crossRows.push({
        date: yq.date,
        rev: rev != null ? `${formatNum(rev)}${revDelta}` : "N/A",
        ni: formatNum(ni),
        gp: formatNum(gp),
        eps: eps != null ? `$${eps.toFixed(2)}` : "N/A",
        ocf: formatNum(ocf),
        sources: usedSources || "Y",
      });
    }

    const crossValidatedTable = crossRows.length > 0
      ? crossRows.map(r =>
          `  ${r.date} [${r.sources}]: Rev=${r.rev} NI=${r.ni} GP=${r.gp} EPS=${r.eps} OCF=${r.ocf}`
        ).join("\n")
      : "  אין נתוני רבעונים";

    // Delta detection between FMP and Yahoo for latest quarter
    const fmpLatestRevMatch = fmpData?.incomeText?.match(/Rev=\$([\d.]+)([BM])/);
    const yahooLatestRev = yahooQs[yahooQs.length - 1]?.revenue;
    let crossValidationNote = "";
    if (fmpLatestRevMatch && yahooLatestRev) {
      const fmpMult = fmpLatestRevMatch[2] === "B" ? 1e9 : 1e6;
      const fmpRev = parseFloat(fmpLatestRevMatch[1]) * fmpMult;
      const delta = Math.abs((fmpRev / yahooLatestRev) - 1) * 100;
      crossValidationNote = delta > 5
        ? `⚠️ Cross-validation: Yahoo vs FMP הכנסות שונות ב-${delta.toFixed(1)}% — השתמש בזהירות`
        : `✓ Cross-validation: Yahoo ו-FMP מסכימים על הכנסות (±${delta.toFixed(1)}%)`;
    }

    // ── Aggregated sentiment ──────────────────────────────────────────────────────
    const avLabel = sentimentData?.overallLabel ?? "";
    const sentimentSummary = [
      avLabel ? `Alpha Vantage: ${avLabel}` : null,
      sentimentData?.overallScore != null
        ? `ציון ממוצע: ${sentimentData.overallScore.toFixed(3)}`
        : null,
    ].filter(Boolean).join(" | ") || "לא זמין";

    // ── Analyst Consensus ────────────────────────────────────────────────────────
    const recTrend = qs?.recommendationTrend?.trend?.[0] ?? null;
    const upgradeHistory: unknown[] = qs?.upgradeDowngradeHistory?.history ?? [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recentActions = upgradeHistory.slice(0, 5).map((h: any) => ({
      date: h.epochGradeDate instanceof Date
        ? h.epochGradeDate.toISOString().split("T")[0]
        : typeof h.epochGradeDate === "string"
          ? h.epochGradeDate.split("T")[0]
          : String(h.epochGradeDate ?? ""),
      firm: h.firm ?? "",
      toGrade: h.toGrade ?? "",
      fromGrade: h.fromGrade ?? null,
      action: h.action ?? "",
      currentPriceTarget: h.currentPriceTarget ?? null,
      priorPriceTarget: h.priorPriceTarget ?? null,
    }));

    const analystConsensus = {
      targetMeanPrice: financials?.targetMeanPrice ?? null,
      targetHighPrice: financials?.targetHighPrice ?? null,
      targetLowPrice: financials?.targetLowPrice ?? null,
      recommendationKey: financials?.recommendationKey ?? null,
      numberOfAnalystOpinions: financials?.numberOfAnalystOpinions ?? null,
      strongBuy: recTrend?.strongBuy ?? 0,
      buy: recTrend?.buy ?? 0,
      hold: recTrend?.hold ?? 0,
      sell: recTrend?.sell ?? 0,
      strongSell: recTrend?.strongSell ?? 0,
      recentActions,
    };

    const companyName = q.longName ?? q.shortName ?? upperTicker;

    // ── Quarterly Table ──────────────────────────────────────────────────────────
    const latestQ = quarterlyData[quarterlyData.length - 1] ?? null;
    const prevQ = quarterlyData[quarterlyData.length - 2] ?? null;
    const revGrowthQoQ = latestQ?.revenue && prevQ?.revenue
      ? ((latestQ.revenue / prevQ.revenue - 1) * 100).toFixed(1) + "%"
      : "N/A";
    const niGrowthQoQ = latestQ?.netIncome && prevQ?.netIncome
      ? ((latestQ.netIncome / prevQ.netIncome - 1) * 100).toFixed(1) + "%"
      : "N/A";

    const recentQuarters = quarterlyData.slice(-4);
    const quartersTable = recentQuarters.length > 0
      ? recentQuarters.map(qd => {
          const fcfMargin = (qd.freeCashFlow != null && qd.revenue != null && qd.revenue > 0)
            ? ` FCF%=${((qd.freeCashFlow / qd.revenue) * 100).toFixed(1)}%`
            : "";
          return `  ${qd.date}: Rev=${formatNum(qd.revenue)} NI=${formatNum(qd.netIncome)} GP=${formatNum(qd.grossProfit)} EPS=$${qd.dilutedEPS?.toFixed(2) ?? "N/A"} FCF=${formatNum(qd.freeCashFlow)}${fcfMargin}`;
        }).join("\n")
      : "  אין נתוני רבעונים";

    // ── Earnings Beat/Miss ───────────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const earningsHist: any[] = qs?.earningsHistory?.history ?? [];
    const earningsHistText = earningsHist.length > 0
      ? earningsHist.slice(-4).map((e: any) => {
          const surprise = e.surprisePercent != null ? ` (${e.surprisePercent > 0 ? "+" : ""}${(e.surprisePercent * 100).toFixed(1)}%)` : "";
          const beat = e.surprisePercent != null ? (e.surprisePercent > 0 ? "✓ BEAT" : e.surprisePercent < -0.005 ? "✗ MISS" : "~ IN-LINE") : "";
          return `  ${e.quarter?.toISOString?.()?.slice(0, 10) ?? e.period ?? "?"}: צפוי $${e.epsEstimate?.toFixed(2) ?? "?"} | בפועל $${e.epsActual?.toFixed(2) ?? "?"}${surprise} ${beat}`;
        }).join("\n")
      : "  לא זמין";

    // ── Earnings Estimates ───────────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const earningsTrendData: any[] = qs?.earningsTrend?.trend ?? [];
    const nextQTrend = earningsTrendData.find((t: any) => t.period === "0q" || t.period === "+1q");
    const nextYTrend = earningsTrendData.find((t: any) => t.period === "+1y");
    const estimatesText = nextQTrend
      ? `רבעון הבא: EPS צפוי $${nextQTrend.earningsEstimate?.avg?.toFixed(2) ?? "N/A"} (Low $${nextQTrend.earningsEstimate?.low?.toFixed(2) ?? "?"} / High $${nextQTrend.earningsEstimate?.high?.toFixed(2) ?? "?"}) | הכנסות צפויות ${formatNum(nextQTrend.revenueEstimate?.avg ?? null)} | צמיחה ${pct(nextQTrend.growth)}`
      : "לא זמין";
    const nextYearText = nextYTrend
      ? `שנה הבאה (TTM): EPS צפוי $${nextYTrend.earningsEstimate?.avg?.toFixed(2) ?? "N/A"} | צמיחה ${pct(nextYTrend.growth)}`
      : "";

    // ── Next Earnings Date ───────────────────────────────────────────────────────
    const earningsDates = qs?.calendarEvents?.earnings?.earningsDate ?? [];
    const nextEarnings = earningsDates[0] instanceof Date ? earningsDates[0] : (earningsDates[0] ? new Date(earningsDates[0]) : null);
    const daysToEarnings = nextEarnings ? Math.ceil((nextEarnings.getTime() - Date.now()) / 86400000) : null;
    const earningsDateText = nextEarnings
      ? `${nextEarnings.toISOString().slice(0, 10)} (בעוד ${daysToEarnings} ימים)`
      : "לא ידוע";

    // ── Build Full Data Context ──────────────────────────────────────────────────
    const dataContext = `
חברה: ${companyName} (${upperTicker})
תעשייה: ${profile?.industry ?? "N/A"} | סקטור: ${profile?.sector ?? "N/A"}
בורסה: ${q.fullExchangeName ?? q.exchange ?? "N/A"} | מטבע: ${q.currency ?? "USD"}
תיאור: ${profile?.longBusinessSummary ? profile.longBusinessSummary.slice(0, 350) : "N/A"}
${polygonData?.companyText ? polygonData.companyText : ""}

--- נתוני שוק עדכניים ---
מחיר: $${q.regularMarketPrice?.toFixed(2)} | שינוי יומי: ${q.regularMarketChangePercent?.toFixed(2)}%
שווי שוק: ${formatNum(q.marketCap)} | Enterprise Value: ${formatNum(keyStats?.enterpriseValue)}
P/E trailing: ${q.trailingPE?.toFixed(1) ?? "N/A"} | P/E forward: ${q.forwardPE?.toFixed(1) ?? "N/A"} | PEG: ${keyStats?.pegRatio?.toFixed(2) ?? "N/A"}
EPS TTM: $${q.epsTrailingTwelveMonths?.toFixed(2) ?? "N/A"} | EPS forward: $${q.epsForward?.toFixed(2) ?? "N/A"}
P/S: ${keyStats?.priceToSalesRatioTTM?.toFixed(2) ?? "N/A"} | P/B: ${keyStats?.priceToBook?.toFixed(2) ?? "N/A"} | EV/Revenue: ${keyStats?.enterpriseToRevenue?.toFixed(2) ?? "N/A"} | EV/EBITDA: ${keyStats?.enterpriseToEbitda?.toFixed(2) ?? "N/A"}
Beta: ${keyStats?.beta?.toFixed(2) ?? "N/A"}
52W High: $${q.fiftyTwoWeekHigh?.toFixed(2) ?? "N/A"} | 52W Low: $${q.fiftyTwoWeekLow?.toFixed(2) ?? "N/A"} | מרחק מ-52W High: ${q.regularMarketPrice && q.fiftyTwoWeekHigh ? ((q.regularMarketPrice / q.fiftyTwoWeekHigh - 1) * 100).toFixed(1) + "%" : "N/A"}

--- ניתוח טכני (Twelve Data) ---
${techData?.fullText ?? "  לא זמין"}

--- נתונים פיננסיים (TTM) ---
הכנסות TTM: ${formatNum(financials?.totalRevenue)}
EBITDA: ${formatNum(financials?.ebitda)} | FCF TTM: ${formatNum(financials?.freeCashflow)} | OCF TTM: ${formatNum(financials?.operatingCashflow)}
FCF Margin: ${financials?.freeCashflow && financials?.totalRevenue ? ((financials.freeCashflow / financials.totalRevenue) * 100).toFixed(1) + "%" : "N/A"}
שולי רווח גולמי: ${pct(financials?.grossMargins)} | שולי EBITDA: ${pct(financials?.ebitdaMargins)}
שולי רווח תפעולי: ${pct(financials?.operatingMargins)} | שולי רווח נקי: ${pct(financials?.profitMargins)}
צמיחת הכנסות YoY: ${pct(financials?.revenueGrowth)} | צמיחת רווח YoY: ${pct(financials?.earningsGrowth)}
ROE: ${pct(financials?.returnOnEquity)} | ROA: ${pct(financials?.returnOnAssets)}
מזומן: ${formatNum(financials?.totalCash)} | חוב: ${formatNum(financials?.totalDebt)} | D/E: ${financials?.debtToEquity?.toFixed(2) ?? "N/A"}

--- מדדי יעילות הון מתקדמים ---
ROIC (תשואה על הון מושקע): ${roicStr}
יחס כיסוי ריבית (EBIT/Interest): ${interestCoverageStr}
CAPEX שנתי (מוערך 4Q): ${formatNum(capexAnnual)} | CAPEX/Revenue: ${capexToRev}
${capexTypeLabel}
פחת שנתי (מוערך): ${formatNum(depreciationAnnual)} | CAPEX/פחת: ${capexToDepr != null ? capexToDepr.toFixed(2) + "x" : "N/A"}
אחזקות: Insiders ${pct(keyStats?.heldPercentInsiders)} | מוסדיים ${pct(keyStats?.heldPercentInstitutions)}

--- פרופיל הנהלה ---
CEO: ${ceoName}${ceoAge ? ` | גיל: ${ceoAge}` : ""}
CFO: ${cfoName}
מספר נושאי משרה: ${officers.length}

--- ביצועים רבעוניים — Cross-Validated (Yahoo+Polygon, Y=Yahoo P=Polygon) ---
${crossValidatedTable}
${crossValidationNote ? crossValidationNote + "\n" : ""}שינוי QoQ (הכנסות): ${revGrowthQoQ} | שינוי QoQ (רווח נקי): ${niGrowthQoQ}

--- Cross-Reference: FMP דוחות רבעוניים (אימות עצמאי) ---
${fmpData?.incomeText ?? "  לא זמין"}

--- Cross-Reference: Polygon דוחות רבעוניים (אימות עצמאי) ---
${polygonData?.quarterlyText ?? "  לא זמין"}

--- היסטוריית דוחות (Beat/Miss — 4 רבעונים) ---
${earningsHistText}

--- תחזיות קונצנזוס ---
${estimatesText}
${nextYearText}
דוח הבא: ${earningsDateText}

--- ציפיות אנליסטים ---
קונצנזוס: ${analystConsensus.recommendationKey ?? "N/A"} | מספר אנליסטים: ${analystConsensus.numberOfAnalystOpinions ?? "N/A"}
מחיר יעד ממוצע: $${analystConsensus.targetMeanPrice?.toFixed(2) ?? "N/A"} | גבוה: $${analystConsensus.targetHighPrice?.toFixed(2) ?? "N/A"} | נמוך: $${analystConsensus.targetLowPrice?.toFixed(2) ?? "N/A"}
upside למחיר יעד: ${analystConsensus.targetMeanPrice && q.regularMarketPrice ? ((analystConsensus.targetMeanPrice / q.regularMarketPrice - 1) * 100).toFixed(1) + "%" : "N/A"}
דירוגים: Strong Buy=${analystConsensus.strongBuy} | Buy=${analystConsensus.buy} | Hold=${analystConsensus.hold} | Sell=${analystConsensus.sell} | Strong Sell=${analystConsensus.strongSell}
${analystConsensus.recentActions.length > 0 ? "שינויי דירוג:\n" + analystConsensus.recentActions.map(a => `  ${a.date}: ${a.firm} — ${a.fromGrade ? a.fromGrade + " → " : ""}${a.toGrade}${a.currentPriceTarget ? ` (PT: $${a.currentPriceTarget})` : ""}`).join("\n") : ""}

--- מאקרו (FRED) ---
${fredData?.text ?? "  לא זמין"}

--- סנטימנט חדשות מצטבר (Alpha Vantage) ---
${sentimentSummary}

--- חדשות ייחודיות מכל המקורות (מדוּפְּקות, 4 מקורות: Yahoo+Finnhub+Marketaux+AlphaVantage) ---
${mergedNewsText}

--- עסקאות פנים (Finnhub) ---
${finnhubData?.insiderText ?? "  לא זמין"}

--- מתחרים ישירים (Finnhub) ---
${finnhubData?.peersText ?? "לא זמין"}

--- פילוח גיאוגרפי הכנסות (FMP) ---
${fmpData?.geoText ?? "  לא זמין"}

--- מחזיקים מוסדיים (FMP) ---
${fmpData?.holdersText ?? "  לא זמין"}
`.trim();

    const systemPrompt = `אתה אנליסט ראשי (Head of Research) במחלקת ניתוח עומק של קרן גידור גלובלית מובילה.
ההתמחות שלך: זיהוי מוקדם של בריכות ערך (Value Pools), צווארי בקבוק, וזרימת הון חכמה (Smart Money).
המטרה שלך: לא לנתח חברה — אלא להבין את המערכת שבה היא פועלת ולמקם אותה בתוך זרימת הערך.
הנתונים שסופקו הם נתונים אמיתיים ועדכניים — השתמש בהם בדיוק כפי שהם ואל תמציא מספרים.
כתוב בעברית. חד, ישיר, ללא מילים מיותרות. כל משפט חייב לנוע כסף. חשיבה של כסף — לא של כותרות.
CRITICAL: החזר אך ורק JSON תקני, ללא markdown, ללא טקסט מחוץ ל-JSON.
CRITICAL: אל תשתמש בגרשיים (") בתוך ערכי טקסט — השתמש בגרש בודד (') או גרשיים עבריים (״) במקום.`;

    const userPrompt = `נתח את ${companyName} (${upperTicker}) לפי הנתונים המדויקים הבאים:

${dataContext}

החזר JSON עם המבנה הבא בדיוק — כל השדות חובה:
{
  "systemUnderstanding": {
    "valueChain": "פרק את התעשייה: Upstream (ספקים/חומרי גלם) → Midstream (ייצור/פלטפורמות) → Downstream (הפצה/לקוחות). מי שולט בכל שלב? מי נשחק?",
    "valueCreation": "איפה באמת נוצר ונלכד הערך הכלכלי? מי מרוויח מרווחים גבוהים ומי נשחק? בריכות ערך vs אזורים תחרותיים",
    "bottlenecks": "צווארי הבקבוק האמיתיים בתעשייה — מאיפה הכוח? (טכנולוגיה ייחודית / רגולציה / סקייל / קניין רוחני / נתונים / תשתית קריטית). מי שולט בהם?",
    "macroTrends": "כוחות מבניים שדוחפים את התעשייה קדימה (Tailwinds) וכוחות שפוגעים (Headwinds). מה יותר חזק עכשיו?"
  },
  "companyPositioning": {
    "positionInChain": "מיקום בשרשרת הערך: upstream/midstream/downstream",
    "functionalRole": "תפקיד פונקציונלי אמיתי במערכת",
    "positionQuality": "בריכת ערך או אזור תחרותי שחוק? נמק"
  },
  "managementAssessment": {
    "ceoProfile": "CEO שם + רקע + נאמנות לחברה + ניסיון תעשייתי רלוונטי",
    "skinInGame": "אחזקות פנים % + מה זה אומר על alignment עם בעלי מניות",
    "trackRecord": "הצלחות/כישלונות ניהוליים מהותיים תחת הנהלה זו"
  },
  "marketSizing": {
    "tam": "גודל שוק כולל (TAM) ב-$ + שוק ניתן לכיבוש (SAM/SOM) + מה מניע צמיחה",
    "cagr": "קצב צמיחה שנתי ענפי (CAGR) % + השוואה לסקטור",
    "pricingPower": "כוח תמחור: ראיות מהמספרים + גבולות + מה יגרום לשחיקה"
  },
  "competitiveAdvantage": {
    "differentiation": "בידול אמיתי שאי אפשר לשכפל",
    "moat": "יתרון בר-קיימא: network effects/switching costs/IP/cost advantage/brand — עוצמה ועמידות",
    "competitiveLandscape": "מתחרים ישירים ועקיפים. עוצמת האיום"
  },
  "valueCaptureQuality": {
    "valueCapture": "האם לוכדת רווחיות אמיתית? ראיות מהמספרים שסופקו",
    "revenueQuality": "יציבות, חזרתיות, כוח תמחור. סוג הכנסות",
    "warningSigns": "אלמנטים מדאיגים — מה יכול להיות שגוי בתמחור?"
  },
  "financialDeepDive": {
    "roicVsWacc": "ROIC ${roicStr} — האם מעל WACC? האם החברה יוצרת ערך כלכלי אמיתי? ניתוח",
    "interestCoverageInsight": "כיסוי ריבית ${interestCoverageStr} — משמעות לסיכון פירעון + האם החוב לצמיחה או הישרדות?",
    "capexQuality": "CAPEX ${formatNum(capexAnnual)} (${capexToRev} מהכנסות) — ${capexTypeLabel} — השפעה על FCF עתידי",
    "ebitdaToNetIncome": "EBITDA ${formatNum(financials?.ebitda)} vs רווח נקי — ניתוח ההפרש: פחת/הפחתות/ריבית/מסים ומשמעות"
  },
  "chainComparison": {
    "betterAlternatives": "חברות שתופסות ערך טוב יותר באותה שרשרת",
    "relativePositioning": "הבחירה הטובה ביותר בתעשייה? למה?"
  },
  "forwardLooking": {
    "catalysts": "Repricing catalysts — מה יגרום לשוק לשנות תמחור?",
    "bullCase": "תרחיש שורי: מה צריך לקרות? מכפלה פוטנציאלית?",
    "bearCase": "תרחיש דובי: סיכונים אמיתיים שיהרסו את התזה",
    "baseCase": "תרחיש בסיס: צמיחה ריאלית וכיוון ב-12 חודשים",
    "winConditions": "תנאים קריטיים שחייבים לקרות כדי לנצח"
  },
  "valuationDCF": {
    "bullDCF": "DCF שורי: הנחות צמיחה + WACC + שווי הוגן מחושב למניה",
    "baseDCF": "DCF בסיס: הנחות מתונות + WACC + שווי הוגן מחושב למניה",
    "bearDCF": "DCF דובי: הנחות שמרניות + WACC + שווי הוגן מחושב למניה",
    "historicalMultiple": "P/E נוכחי ${q.trailingPE?.toFixed(1) ?? 'N/A'}x vs ממוצע היסטורי ענפי + האם המניה זולה/יקרה היסטורית?"
  },
  "conclusion": {
    "classification": "value_pool | hype | tactical | value_trap",
    "classificationLabel": "מניית בריכת ערך / מניית הייפ / חוליה טקטית מעניינת / מלכודת ערך",
    "reasoning": "2-3 משפטים חדים עם ביסוס אמיתי",
    "actionableIdeas": "Long/Short/Pair/Watchlist עם היגיון ברור"
  },
  "eventAnalysis": {
    "realityVsNarrative": "ניתוח הדוח הרבעוני האחרון לפי המספרים. הכנסות בפועל, שינוי QoQ, מה הכותרות אומרות לעומת המציאות",
    "secondOrderThinking": "מה השוק מפספס? השלכות לא-מיידיות מהמספרים",
    "capitalFlow": "לאן כסף יזרום בעקבות הנתונים? סקטורים/נכסים",
    "winners": "מי ירוויח מהמצב הנוכחי של ${companyName}?",
    "losers": "מי ייפגע? איפה החולשה נחשפת?",
    "materiality": "רעש קצר טווח או שינוי מגמה? משמעות",
    "actionableInsights": "Long/Short/Pair/Watchlist ספציפי עם תזמון ונימוק"
  },
  "fiveYearForecast": "תחזית 2025-2030 שנה-שנה: קטליסטים, הכנסות צפויות %, מאורעות מרכזיים, נקודות מפנה. פסקה אחת קומפקטית.",
  "kpiTracker": "5 KPI קריטיים לבדיקה ברבעון הבא. כל KPI: שם | ערך נוכחי | ספל אזהרה | מה זה אומר. פורמט: KPI1: ... | KPI2: ... וכו",
  "riskMatrix": {
    "supplyChain": "ספקים/לקוחות קריטיים + תלות + סיכוני ריכוז",
    "preMortem": "Pre-Mortem: תרחיש שבו ב-2027 המניה ירדה 60% — מה גרם לכך?",
    "thesisBreaker": "נתון/אירוע ספציפי שיהרוס את התזה לחלוטין + מה לצפות ברבעון הבא כ-warning sign"
  }
}`;

    const response = await openai.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 8192,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? "";
    const finishReason = response.choices[0]?.finish_reason;

    if (!raw || raw.trim() === "") {
      bgLogger.warn({ finishReason, upperTicker }, "Deep analysis AI returned empty content — ticker may lack sufficient data");
      _jobErrors.set(upperTicker, `לא ניתן לנתח את ${upperTicker} — ייתכן שהטיקר לא ידוע או שאין מספיק נתונים פיננסיים עבורו.`);
      return;
    }

    const parsed = robustParseJson(raw);
    if (!parsed) {
      bgLogger.warn({ raw: raw.slice(0, 500), finishReason }, "Failed to parse AI JSON response");
      _jobErrors.set(upperTicker, "שגיאה בעיבוד תשובת AI — נסה שוב");
      return;
    }

    const fallbackEvent = {
      realityVsNarrative: "לא ניתן לנתח — בדוק שהטיקר נכון",
      secondOrderThinking: "N/A",
      capitalFlow: "N/A",
      winners: "N/A",
      losers: "N/A",
      materiality: "N/A",
      actionableInsights: "N/A",
    };

    const result = {
      ticker: upperTicker,
      companyName,
      systemUnderstanding: parsed.systemUnderstanding ?? {},
      companyPositioning: parsed.companyPositioning ?? {},
      managementAssessment: parsed.managementAssessment ?? null,
      marketSizing: parsed.marketSizing ?? null,
      competitiveAdvantage: parsed.competitiveAdvantage ?? {},
      valueCaptureQuality: parsed.valueCaptureQuality ?? {},
      financialDeepDive: parsed.financialDeepDive ?? null,
      chainComparison: parsed.chainComparison ?? {},
      forwardLooking: parsed.forwardLooking ?? {},
      valuationDCF: parsed.valuationDCF ?? null,
      conclusion: parsed.conclusion ?? {},
      eventAnalysis: parsed.eventAnalysis ?? fallbackEvent,
      fiveYearForecast: parsed.fiveYearForecast ?? null,
      kpiTracker: parsed.kpiTracker ?? null,
      riskMatrix: parsed.riskMatrix ?? null,
      analystConsensus,
      generatedAt: new Date().toISOString(),
    };

    setDeepCache(upperTicker, result);
    bgLogger.info({ upperTicker }, "Deep analysis job complete — cached");
  } catch (err) {
    bgLogger.error({ err, upperTicker }, "Deep analysis background job failed");
    _jobErrors.set(upperTicker, "שגיאה פנימית — נסה שוב בעוד מספר שניות");
  } finally {
    _runningJobs.delete(upperTicker);
  }
}

// ── Route: poll-friendly GET ──────────────────────────────────────────────────
// First call: starts background job, returns {status:"running"} immediately.
// Subsequent calls while running: returns {status:"running"}.
// After completion: returns full result from cache.
// On error: returns {status:"error", message}.
router.get("/stocks/:ticker/deep-analysis", (req, res) => {
  const parse = GetStockDeepAnalysisParams.safeParse(req.params);
  if (!parse.success) {
    res.status(400).json({ error: "Bad request", message: "Invalid ticker" });
    return;
  }

  // Prevent browser/proxy caching — polling responses must always be fresh
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.set("Pragma", "no-cache");

  const upperTicker = req.params.ticker.toUpperCase();

  // Serve from cache immediately
  const cached = getDeepCache(upperTicker);
  if (cached) { res.json(cached); return; }

  // Job failed previously — report and clear
  const jobErr = _jobErrors.get(upperTicker);
  if (jobErr) {
    _jobErrors.delete(upperTicker);
    res.status(422).json({ error: "Analysis failed", message: jobErr });
    return;
  }

  // Job already running — tell client to keep polling
  if (_runningJobs.has(upperTicker)) {
    res.json({ status: "running", ticker: upperTicker });
    return;
  }

  // Start background job and return immediately
  _runningJobs.add(upperTicker);
  res.json({ status: "running", ticker: upperTicker });

  // Fire-and-forget — errors handled inside the function
  runDeepAnalysisJob(upperTicker).catch((err) => {
    bgLogger.error({ err, upperTicker }, "Unhandled error in runDeepAnalysisJob");
    _jobErrors.set(upperTicker, "שגיאה לא צפויה — נסה שוב");
    _runningJobs.delete(upperTicker);
  });
});

export default router;
