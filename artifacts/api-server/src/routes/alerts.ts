import { Router } from "express";
import { fetchNewsArticles } from "../lib/enrichment";
import {
  classifyArticleType,
  fetchArticleMetadata,
  type ArticleType,
} from "../lib/article-metadata";

const router = Router();

type WatchItem = {
  ticker?: string;
  companyName?: string | null;
  sector?: string | null;
};

type TrackedArticle = {
  ticker?: string;
  title?: string;
  url?: string;
  source?: string;
  publishedAt?: string;
  summary?: string | null;
  articleType?: ArticleType;
};

type NormalizedTrackedArticle = {
  ticker: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  summary: string;
  articleType: ArticleType;
};

type Alert = {
  id: string;
  subjectType: "stock" | "sector";
  ticker: string;
  subject: string;
  title: string;
  source: string;
  url: string;
  summary: string;
  publishedAt: string;
  sentiment: "positive" | "negative" | "neutral";
  articleType: ArticleType;
  qualityScore: number;
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
const ALERT_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_ALERTS_PER_SCAN = 80;
const HIGH_QUALITY_SOURCES = [
  "reuters", "associated press", "ap news", "bloomberg", "financial times",
  "wall street journal", "cnbc", "marketwatch", "yahoo finance", "sec.gov",
  "nasdaq", "finnhub", "marketaux",
];
const ESTABLISHED_FINANCE_SOURCES = [
  "seeking alpha", "investing.com", "morningstar", "barron's", "benzinga",
  "the motley fool", "etf trends",
];
const ARTICLE_TYPE_LABELS: Record<ArticleType, string> = {
  earnings: "דוחות ותוצאות",
  legal: "משפטי",
  merger: "מיזוגים ורכישות",
  product: "מוצר והשקה",
  leadership: "הנהלה",
  regulation: "רגולציה",
  analyst: "אנליסטים",
  market: "שוק ומסחר",
  other: "חדשות כלליות",
};
const ARTICLE_TYPES = new Set<ArticleType>(Object.keys(ARTICLE_TYPE_LABELS) as ArticleType[]);

function normalizeArticleType(value: unknown): ArticleType {
  return typeof value === "string" && ARTICLE_TYPES.has(value as ArticleType)
    ? value as ArticleType
    : "other";
}

function getLogSafeUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`;
  } catch {
    return "invalid-url";
  }
}

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

function sourceQuality(source: string): number {
  const normalized = source.toLowerCase();
  if (HIGH_QUALITY_SOURCES.some((known) => normalized.includes(known))) return 1;
  if (ESTABLISHED_FINANCE_SOURCES.some((known) => normalized.includes(known))) return 0.78;
  if (normalized.includes(".gov") || normalized.includes("official")) return 0.9;
  if (normalized.includes("news") || normalized.includes("finance")) return 0.62;
  return 0.38;
}

function getQualityScore(
  article: { title: string; summary: string; source: string; sentiment: "positive" | "negative" | "neutral" | null },
  publishedAtMs: number,
  scanStartedAtMs: number,
  isTracked: boolean,
): number {
  const ageRatio = Math.max(0, Math.min(1, (scanStartedAtMs - publishedAtMs) / ALERT_WINDOW_MS));
  const freshness = 1 - ageRatio;
  const titleCompleteness = Math.min(1, article.title.trim().length / 80);
  const summaryCompleteness = Math.min(1, article.summary.trim().length / 240);
  const contentCompleteness = titleCompleteness * 0.65 + summaryCompleteness * 0.35;
  const signalStrength = article.sentiment === "positive" || article.sentiment === "negative"
    ? 1
    : inferSentiment(`${article.title} ${article.summary}`) ? 0.85 : 0.65;
  const trackedContext = isTracked ? 0.04 : 0;

  return Math.round(
    (sourceQuality(article.source) * 0.45
      + contentCompleteness * 0.25
      + signalStrength * 0.16
      + freshness * 0.10
      + trackedContext) * 100,
  );
}

function makeImpact(
  subject: string,
  sentiment: "positive" | "negative" | "neutral",
  title: string,
  articleType: ArticleType,
): {
  impactTitle: string;
  impactSummary: string;
} {
  if (sentiment === "neutral") {
    return {
      impactTitle: `עדכון למעקב ב${subject} · ${ARTICLE_TYPE_LABELS[articleType]}`,
      impactSummary: `הכתבה נשמרה כמקור מועדף למעקב. היא אינה מסומנת כרגע כחיובית או שלילית, אך תישאר בהקשר הסריקות הבאות. (${title.slice(0, 70)}${title.length > 70 ? "…" : ""})`,
    };
  }
  const positive = sentiment === "positive";
  const impactTitle = positive
    ? `פוטנציאל תמיכה ב${subject} · ${ARTICLE_TYPE_LABELS[articleType]}`
    : `סיכון ללחץ על ${subject} · ${ARTICLE_TYPE_LABELS[articleType]}`;
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
    articleType: ArticleType;
  },
  subjectType: "stock" | "sector",
  ticker: string,
  subject: string,
  allowNeutral = false,
  scanStartedAtMs = Date.now(),
  isTracked = false,
): Alert | null {
  const publishedAtMs = Date.parse(article.publishedAt);
  if (
    !Number.isFinite(publishedAtMs)
    || publishedAtMs < scanStartedAtMs - ALERT_WINDOW_MS
    || publishedAtMs > scanStartedAtMs
  ) return null;

  const inferredSentiment = article.sentiment === "positive" || article.sentiment === "negative"
    ? article.sentiment
    : inferSentiment(`${article.title} ${article.summary}`);
  if (!inferredSentiment && !allowNeutral) return null;
  const sentiment = inferredSentiment ?? "neutral";
  const impact = makeImpact(subject, sentiment, article.title, article.articleType);
  return {
    id: `${subjectType}:${ticker}:${article.url}:${sentiment}`,
    subjectType,
    ticker,
    subject,
    title: article.title,
    source: article.source || "מקור חדשות",
    url: article.url,
    summary: article.summary ?? "",
    publishedAt: article.publishedAt,
    sentiment,
    articleType: article.articleType,
    qualityScore: getQualityScore(article, publishedAtMs, scanStartedAtMs, isTracked),
    ...impact,
  };
}

router.post("/alerts/article-metadata", async (req, res) => {
  const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
  if (!url) {
    res.status(400).json({ error: "Bad request", message: "A public article URL is required" });
    return;
  }

  try {
    res.json(await fetchArticleMetadata(url));
  } catch (err) {
    req.log?.warn(
      {
        articleTarget: getLogSafeUrl(url),
        reason: err instanceof Error ? err.message : "Unknown metadata error",
      },
      "Unable to read article metadata",
    );
    res.status(422).json({
      error: "Article metadata unavailable",
      message: "לא הצלחנו לקרוא את פרטי הכתבה מהקישור. אפשר להזין כותרת ותקציר ידנית.",
    });
  }
});

router.post("/alerts/scan", async (req, res) => {
  const rawWatchlist = Array.isArray(req.body?.watchlist) ? req.body.watchlist as WatchItem[] : [];
  const rawTrackedArticles = Array.isArray(req.body?.trackedArticles)
    ? req.body.trackedArticles as TrackedArticle[]
    : [];
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
  if (rawWatchlist.length > 20 || rawTrackedArticles.length > 100) {
    res.status(400).json({
      error: "Bad request",
      message: "A scan can include up to 20 tickers and 100 tracked articles",
    });
    return;
  }

  const watchlistTickers = new Set(watchlist.map((item) => item.ticker));
  const activeSectorEtfs = new Set(
    watchlist.flatMap((item) => {
      const sector = item.sector ? SECTOR_CONFIG.find((config) => config.name === item.sector) : null;
      return sector ? [sector.etf] : [];
    }),
  );
  const trackedArticles = rawTrackedArticles
    .map((article) => ({
      ticker: (article.ticker ?? "").toUpperCase().trim(),
      title: article.title?.trim() || "",
      url: article.url?.trim() || "",
      source: article.source?.trim() || "מקור שמור",
      publishedAt: article.publishedAt ?? new Date().toISOString(),
      summary: article.summary?.trim() || "",
      articleType: normalizeArticleType(article.articleType),
    }))
    .filter((article) => {
      if (!watchlistTickers.has(article.ticker) && !activeSectorEtfs.has(article.ticker)) {
        return false;
      }
      if (!article.title || !article.url) return false;
      try {
        const parsed = new URL(article.url);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
      } catch {
        return false;
      }
    })
    .slice(0, 100);

  const trackedByTicker = new Map<string, NormalizedTrackedArticle[]>();
  for (const article of trackedArticles) {
    const current = trackedByTicker.get(article.ticker) ?? [];
    current.push(article);
    trackedByTicker.set(article.ticker, current);
  }
  const scanStartedAtMs = Date.now();
  const checkedAt = new Date(scanStartedAtMs).toISOString();

  const prioritizeTrackedArticles = (
    ticker: string,
    fetchedArticles: NonNullable<Awaited<ReturnType<typeof fetchNewsArticles>>>["articles"],
  ) => {
    const preferred = trackedByTicker.get(ticker) ?? [];
    const combined = [
      ...preferred.map((article) => ({
        title: article.title,
        url: article.url,
        source: article.source,
        publishedAt: article.publishedAt ?? new Date().toISOString(),
        sentiment: null,
        summary: article.summary ?? "",
        articleType: article.articleType,
        isTracked: true,
      })),
      ...fetchedArticles.map((article) => ({
        ...article,
        articleType: classifyArticleType(`${article.title} ${article.summary}`),
        isTracked: false,
      })),
    ];
    const seenUrls = new Set<string>();
    return combined.filter((article) => {
      if (seenUrls.has(article.url)) return false;
      seenUrls.add(article.url);
      return true;
    });
  };

  try {
    const stockResults = await Promise.allSettled(
      watchlist.map(async (item) => {
        const data = await fetchNewsArticles(item.ticker);
        return {
          item,
          alerts: prioritizeTrackedArticles(item.ticker, data?.articles ?? [])
            .map(({ isTracked, ...article }) => buildAlert(
              article,
              "stock",
              item.ticker,
              item.companyName ?? item.ticker,
              isTracked,
              scanStartedAtMs,
              isTracked,
            ))
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
        return prioritizeTrackedArticles(config.etf, data?.articles ?? [])
          .map(({ isTracked, ...article }) => buildAlert(
            article,
            "sector",
            config.etf,
            sector,
            isTracked,
            scanStartedAtMs,
            isTracked,
          ))
          .filter((alert): alert is Alert => Boolean(alert));
      }),
    );

    const deduplicated = new Map<string, Alert>();
    for (const alert of [
      ...stockResults.flatMap((result) => result.status === "fulfilled" ? result.value.alerts : []),
      ...sectorResults.flatMap((result) => result.status === "fulfilled" ? result.value : []),
    ]) {
      const normalizedTitle = alert.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      const key = `${alert.subjectType}:${alert.ticker}:${normalizedTitle || alert.url}`;
      const existing = deduplicated.get(key);
      if (!existing || alert.qualityScore > existing.qualityScore) {
        deduplicated.set(key, alert);
      }
    }

    const alerts = [...deduplicated.values()]
      .sort((a, b) => (
        b.qualityScore - a.qualityScore
        || new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
      ))
      .slice(0, MAX_ALERTS_PER_SCAN)
      .sort((a, b) => (
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
        || b.qualityScore - a.qualityScore
      ));

    const sources = [...new Set(alerts.map((alert) => alert.source))];
    res.json({
      alerts,
      scannedTickers: watchlist.length,
      scannedSectors: sectorByName.size,
      sources,
      checkedAt,
    });
  } catch (err) {
    req.log?.error({ err }, "Failed to scan market alerts");
    res.status(500).json({ error: "Internal server error", message: "Alert scan failed" });
  }
});

export default router;