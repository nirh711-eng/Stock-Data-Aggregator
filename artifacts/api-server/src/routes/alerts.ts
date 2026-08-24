import { Router } from "express";
import { fetchNewsArticles } from "../lib/enrichment";

const router = Router();

type WatchItem = {
  ticker?: string;
  companyName?: string | null;
  sector?: string | null;
};

type Alert = {
  id: string;
  subjectType: "stock" | "sector";
  ticker: string;
  subject: string;
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  sentiment: "positive" | "negative";
  impactTitle: string;
  impactSummary: string;
};

const SECTOR_CONFIG: Array<{ name: string; etf: string }> = [
  { name: "טכנולוגיה", etf: "XLK" },
  { name: "בריאות", etf: "XLV" },
  { name: "שירותים פיננסיים", etf: "XLF" },
  { name: "אנרגיה", etf: "XLE" },
  { name: "צריכה מחזורית", etf: "XLY" },
  { name: "צריכה בסיסית", etf: "XLP" },
  { name: "תעשייה", etf: "XLI" },
  { name: "תקשורת", etf: "XLC" },
  { name: "נדל\"ן", etf: "XLRE" },
  { name: "חומרי גלם", etf: "XLB" },
  { name: "תשתיות", etf: "XLU" },
];

const SECTOR_ALIASES: Record<string, string> = {
  Technology: "טכנולוגיה",
  Healthcare: "בריאות",
  "Financial Services": "שירותים פיננסיים",
  Energy: "אנרגיה",
  "Consumer Cyclical": "צריכה מחזורית",
  "Consumer Defensive": "צריכה בסיסית",
  Industrials: "תעשייה",
  "Communication Services": "תקשורת",
  "Real Estate": "נדל\"ן",
  "Basic Materials": "חומרי גלם",
  Utilities: "תשתיות",
};

const POSITIVE_TERMS = [
  "beat", "beats", "growth", "surge", "rally", "upgrade", "profit", "record",
  "strong", "bullish", "approval", "approved", "deal", "contract", "partnership",
  "raises guidance", "outperform", "positive", "ביקוש", "צמיחה", "רווח", "אישור",
  "עסקה", "חוזה", "עלייה", "חיובי",
];

const NEGATIVE_TERMS = [
  "miss", "misses", "drop", "falls", "cut", "downgrade", "loss", "weak",
  "bearish", "warning", "lawsuit", "investigation", "layoff", "recall",
  "decline", "negative", "בעיות", "ירידה", "הפסד", "אזהרה", "תביעה", "חקירה",
  "פיטורים", "שלילי",
];

function normalizeSector(sector: string | null | undefined): string | null {
  if (!sector) return null;
  return SECTOR_ALIASES[sector] ?? (SECTOR_CONFIG.some((s) => s.name === sector) ? sector : null);
}

function inferSentiment(text: string): "positive" | "negative" | null {
  const normalized = text.toLowerCase();
  const positive = POSITIVE_TERMS.filter((term) => normalized.includes(term.toLowerCase())).length;
  const negative = NEGATIVE_TERMS.filter((term) => normalized.includes(term.toLowerCase())).length;
  if (positive === negative) return null;
  return positive > negative ? "positive" : "negative";
}

function makeImpact(subject: string, sentiment: "positive" | "negative", title: string): {
  impactTitle: string;
  impactSummary: string;
} {
  const positive = sentiment === "positive";
  const impactTitle = positive
    ? `פוטנציאל תמיכה ב${subject}`
    : `סיכון ללחץ על ${subject}`;
  const impactSummary = positive
    ? `הכותרת עשויה לתמוך ב${subject} דרך שיפור בציפיות לצמיחה, רווחיות או ביקוש. כדאי לבדוק אם השוק כבר תמחר את החדשה ומה אומרים הנתונים במסחר.`
    : `הכותרת עלולה להכביד על ${subject} דרך פגיעה בציפיות לצמיחה, רווחיות או אמון המשקיעים. כדאי לעקוב אחר עוצמת התגובה והאם הסיכון נקודתי או מתפשט.`;
  return { impactTitle, impactSummary: `${impactSummary} (${title.slice(0, 70)}${title.length > 70 ? "…" : ""})` };
}

function buildAlert(
  article: {
    title: string;
    url: string;
    source: string;
    publishedAt: string;
    sentiment: "positive" | "negative" | "neutral" | null;
    summary: string;
  },
  subjectType: "stock" | "sector",
  ticker: string,
  subject: string,
): Alert | null {
  const sentiment = article.sentiment === "positive" || article.sentiment === "negative"
    ? article.sentiment
    : inferSentiment(`${article.title} ${article.summary}`);
  if (!sentiment) return null;
  const impact = makeImpact(subject, sentiment, article.title);
  return {
    id: `${subjectType}:${ticker}:${article.url}:${sentiment}`,
    subjectType,
    ticker,
    subject,
    title: article.title,
    source: article.source || "מקור חדשות",
    url: article.url,
    publishedAt: article.publishedAt,
    sentiment,
    ...impact,
  };
}

router.post("/alerts/scan", async (req, res) => {
  const rawWatchlist = Array.isArray(req.body?.watchlist) ? req.body.watchlist as WatchItem[] : [];
  const watchlist = rawWatchlist
    .map((item) => ({
      ticker: (item.ticker ?? "").toUpperCase().trim(),
      companyName: item.companyName?.trim() || null,
      sector: normalizeSector(item.sector),
    }))
    .filter((item) => /^[A-Z]{1,6}$/.test(item.ticker))
    .slice(0, 20);

  if (rawWatchlist.length > 0 && watchlist.length === 0) {
    res.status(400).json({ error: "Bad request", message: "No valid tickers supplied" });
    return;
  }

  try {
    const stockResults = await Promise.allSettled(
      watchlist.map(async (item) => {
        const data = await fetchNewsArticles(item.ticker);
        return {
          item,
          alerts: (data?.articles ?? [])
            .map((article) => buildAlert(article, "stock", item.ticker, item.companyName ?? item.ticker))
            .filter((alert): alert is Alert => Boolean(alert)),
        };
      }),
    );

    const sectorByName = new Map<string, { etf: string; stocks: string[] }>();
    for (const item of watchlist) {
      if (!item.sector) continue;
      const config = SECTOR_CONFIG.find((sector) => sector.name === item.sector);
      if (!config) continue;
      const existing = sectorByName.get(item.sector) ?? { etf: config.etf, stocks: [] };
      existing.stocks.push(item.ticker);
      sectorByName.set(item.sector, existing);
    }

    const sectorResults = await Promise.allSettled(
      [...sectorByName.entries()].map(async ([sector, config]) => {
        const data = await fetchNewsArticles(config.etf);
        return (data?.articles ?? [])
          .map((article) => buildAlert(
            article,
            "sector",
            config.etf,
            sector,
          ))
          .filter((alert): alert is Alert => Boolean(alert));
      }),
    );

    const alerts = [
      ...stockResults.flatMap((result) => result.status === "fulfilled" ? result.value.alerts : []),
      ...sectorResults.flatMap((result) => result.status === "fulfilled" ? result.value : []),
    ]
      .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
      .slice(0, 80);

    const sources = [...new Set(alerts.map((alert) => alert.source))];
    res.json({
      alerts,
      scannedTickers: watchlist.length,
      scannedSectors: sectorByName.size,
      sources,
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    req.log?.error({ err }, "Failed to scan market alerts");
    res.status(500).json({ error: "Internal server error", message: "Alert scan failed" });
  }
});

export default router;