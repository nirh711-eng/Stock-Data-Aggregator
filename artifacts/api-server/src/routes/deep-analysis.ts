import { Router } from "express";
import https from "https";
import yahooFinanceMod from "yahoo-finance2";
import { openai } from "@workspace/integrations-openai-ai-server";
import { GetStockDeepAnalysisParams } from "@workspace/api-zod";
import { jsonrepair } from "jsonrepair";
import { fetchFinnhub, fetchFmp, fetchFredMacro } from "../lib/enrichment";

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

router.get("/stocks/:ticker/deep-analysis", async (req, res) => {
  const parse = GetStockDeepAnalysisParams.safeParse(req.params);
  if (!parse.success) {
    res.status(400).json({ error: "Bad request", message: "Invalid ticker" });
    return;
  }

  const { ticker } = parse.data;
  const upperTicker = ticker.toUpperCase();

  // Serve from cache if available (60 min)
  const cached = getDeepCache(upperTicker);
  if (cached) { res.json(cached); return; }

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

    const [quoteResult, qsResult, quarterlyData, finnhubData, fmpData, fredData, yNewsData] = await Promise.all([
      yahooFinance.quote(upperTicker).catch(() => null),
      qsWithTimeout,
      fetchQuarterlyTimeseries(upperTicker),
      fetchFinnhub(upperTicker),
      fetchFmp(upperTicker),
      fetchFredMacro(),
      yahooFinance.search(upperTicker, { quotesCount: 0, newsCount: 5 }, { validateResult: false }).catch(() => null),
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

    // Yahoo Finance news (additional source)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const yNewsItems: any[] = yNewsData?.news ?? [];
    const yNewsText = yNewsItems.length > 0
      ? yNewsItems.slice(0, 5).map((n: { title?: string; publisher?: string }) =>
          `  - ${n.title ?? "?"} (${n.publisher ?? "?"})`
        ).join("\n")
      : "  לא זמין";

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
תיאור: ${profile?.longBusinessSummary ? profile.longBusinessSummary.slice(0, 400) : "N/A"}

--- נתוני שוק עדכניים ---
מחיר: $${q.regularMarketPrice?.toFixed(2)} | שינוי יומי: ${q.regularMarketChangePercent?.toFixed(2)}%
שווי שוק: ${formatNum(q.marketCap)} | Enterprise Value: ${formatNum(keyStats?.enterpriseValue)}
P/E trailing: ${q.trailingPE?.toFixed(1) ?? "N/A"} | P/E forward: ${q.forwardPE?.toFixed(1) ?? "N/A"} | PEG: ${keyStats?.pegRatio?.toFixed(2) ?? "N/A"}
EPS TTM: $${q.epsTrailingTwelveMonths?.toFixed(2) ?? "N/A"} | EPS forward: $${q.epsForward?.toFixed(2) ?? "N/A"}
P/S: ${keyStats?.priceToSalesRatioTTM?.toFixed(2) ?? "N/A"} | P/B: ${keyStats?.priceToBook?.toFixed(2) ?? "N/A"} | EV/Revenue: ${keyStats?.enterpriseToRevenue?.toFixed(2) ?? "N/A"} | EV/EBITDA: ${keyStats?.enterpriseToEbitda?.toFixed(2) ?? "N/A"}
Beta: ${keyStats?.beta?.toFixed(2) ?? "N/A"}
52W High: $${q.fiftyTwoWeekHigh?.toFixed(2) ?? "N/A"} | 52W Low: $${q.fiftyTwoWeekLow?.toFixed(2) ?? "N/A"} | מרחק מ-52W High: ${q.regularMarketPrice && q.fiftyTwoWeekHigh ? ((q.regularMarketPrice / q.fiftyTwoWeekHigh - 1) * 100).toFixed(1) + "%" : "N/A"}

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

--- ביצועים רבעוניים (4 רבעונים + FCF) ---
${quartersTable}
שינוי QoQ (הכנסות): ${revGrowthQoQ} | שינוי QoQ (רווח נקי): ${niGrowthQoQ}

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

--- חדשות אחרונות (Yahoo Finance) ---
${yNewsText}

--- חדשות אחרונות (Finnhub) ---
${finnhubData?.newsText ?? "  לא זמין"}

--- עסקאות פנים (Finnhub) ---
${finnhubData?.insiderText ?? "  לא זמין"}

--- מתחרים ישירים ---
${finnhubData?.peersText ?? "לא זמין"}

--- דוחות רבעוניים (FMP — cross-validation) ---
${fmpData?.incomeText ?? "  לא זמין"}

--- פילוח גיאוגרפי הכנסות (FMP) ---
${fmpData?.geoText ?? "  לא זמין"}

--- מחזיקים מוסדיים (FMP) ---
${fmpData?.holdersText ?? "  לא זמין"}
`.trim();

    const systemPrompt = `אתה אנליסט ראשי (Head of Research) במחלקת ניתוח עומק של קרן גידור גלובלית מובילה.
הנתונים שסופקו הם נתונים אמיתיים ועדכניים — השתמש בהם בדיוק כפי שהם ואל תמציא מספרים.
כתוב בעברית. חד, ישיר, ללא מילים מיותרות. כל משפט חייב לנוע כסף. כל שדה — תשובה קצרה וחדה.
CRITICAL: החזר אך ורק JSON תקני, ללא markdown, ללא טקסט מחוץ ל-JSON.
CRITICAL: אל תשתמש בגרשיים (") בתוך ערכי טקסט — השתמש בגרש בודד (') או גרשיים עבריים (״) במקום.`;

    const userPrompt = `נתח את ${companyName} (${upperTicker}) לפי הנתונים המדויקים הבאים:

${dataContext}

החזר JSON עם המבנה הבא בדיוק — כל השדות חובה:
{
  "systemUnderstanding": {
    "valueChain": "פירוק שרשרת ערך התעשייה. איפה נוצר ונלכד הערך האמיתי?",
    "valueCreation": "צווארי הבקבוק האמיתיים. מה נותן כוח?",
    "bottlenecks": "כוחות מאקרו שדוחפים או פוגעים בתעשייה עכשיו",
    "macroTrends": "מגמות מבניות — חיוביות ושליליות"
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
      req.log?.warn({ finishReason, upperTicker }, "Deep analysis AI returned empty content — ticker may lack sufficient data");
      res.status(422).json({ error: "Insufficient data", message: `לא ניתן לנתח את ${upperTicker} — ייתכן שהטיקר לא ידוע או שאין מספיק נתונים פיננסיים עבורו.` });
      return;
    }

    const parsed = robustParseJson(raw);
    if (!parsed) {
      req.log?.warn({ raw: raw.slice(0, 500), finishReason }, "Failed to parse AI JSON response");
      res.status(500).json({ error: "Parse error", message: "Failed to parse AI analysis" });
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
    res.json(result);
  } catch (err) {
    req.log?.error({ err }, "Failed to run deep analysis");
    res.status(500).json({ error: "Internal server error", message: "Failed to generate deep analysis" });
  }
});

export default router;
