import { Router } from "express";
import yahooFinanceMod from "yahoo-finance2";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const YahooFinance = yahooFinanceMod as any;
const yahooFinance = new YahooFinance();
const router = Router();

router.post("/stocks/watchlist/check", async (req, res) => {
  const { watchlist } = req.body as {
    watchlist: Array<{ ticker: string; lastKnownReportDate?: string | null }>;
  };

  if (!Array.isArray(watchlist) || watchlist.length === 0) {
    res.json({ alerts: [], checkedAt: new Date().toISOString() });
    return;
  }

  const tickers = watchlist.slice(0, 20);
  const now = new Date();
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const alerts: Array<{
    ticker: string;
    companyName: string;
    type: "new_report" | "upcoming_earnings";
    message: string;
    currentReportDate?: string | null;
    upcomingEarningsDate?: string | null;
    price?: number | null;
    priceChangePercent?: number | null;
  }> = [];

  await Promise.allSettled(
    tickers.map(async ({ ticker, lastKnownReportDate }) => {
      const upperTicker = ticker.toUpperCase();
      try {
        const [quoteResult, qsResult] = await Promise.allSettled([
          yahooFinance.quote(upperTicker),
          yahooFinance.quoteSummary(upperTicker, {
            modules: ["incomeStatementHistory", "calendarEvents"],
          }),
        ]);

        const quote = quoteResult.status === "fulfilled" ? quoteResult.value : null;
        const qs = qsResult.status === "fulfilled" ? qsResult.value : null;

        const companyName = quote?.longName ?? quote?.shortName ?? upperTicker;
        const price = quote?.regularMarketPrice ?? null;
        const priceChangePercent = quote?.regularMarketChangePercent ?? null;

        const incomeStatements = qs?.incomeStatementHistory?.incomeStatementHistory ?? [];
        const latestIncome = incomeStatements[0];
        const currentReportDate = latestIncome?.endDate
          ? new Date(latestIncome.endDate instanceof Date ? latestIncome.endDate : latestIncome.endDate)
              .toISOString()
              .split("T")[0]
          : null;

        if (
          currentReportDate &&
          lastKnownReportDate &&
          currentReportDate !== lastKnownReportDate &&
          new Date(currentReportDate) > new Date(lastKnownReportDate)
        ) {
          alerts.push({
            ticker: upperTicker,
            companyName,
            type: "new_report",
            message: `דוח רבעוני חדש התפרסם עבור ${upperTicker} (${companyName})`,
            currentReportDate,
            price,
            priceChangePercent,
          });
        }

        const earningsDates = qs?.calendarEvents?.earnings?.earningsDate ?? [];
        for (const d of earningsDates) {
          const earningsDate = d instanceof Date ? d : new Date(d as string);
          if (earningsDate > now && earningsDate <= sevenDaysFromNow) {
            alerts.push({
              ticker: upperTicker,
              companyName,
              type: "upcoming_earnings",
              message: `${upperTicker} (${companyName}) — דוח רבעוני צפוי בתאריך ${earningsDate.toLocaleDateString("he-IL")}`,
              upcomingEarningsDate: earningsDate.toISOString().split("T")[0],
              price,
              priceChangePercent,
            });
            break;
          }
        }
      } catch (err) {
        req.log?.warn({ err, ticker: upperTicker }, "Failed to check ticker in watchlist");
      }
    })
  );

  res.json({ alerts, checkedAt: new Date().toISOString() });
});

export default router;
