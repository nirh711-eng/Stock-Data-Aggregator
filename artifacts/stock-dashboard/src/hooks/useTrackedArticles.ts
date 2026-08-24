import { useCallback, useState } from "react";

export interface TrackedArticle {
  id: string;
  ticker: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  summary?: string | null;
  addedAt: string;
}

type TrackedArticlesByTicker = Record<string, TrackedArticle[]>;

const TRACKED_ARTICLES_KEY = "stockpulse_tracked_market_articles";
export const MAX_TRACKED_ARTICLES = 100;
export const MAX_TRACKED_ARTICLES_PER_TICKER = 20;

function loadTrackedArticles(): TrackedArticlesByTicker {
  try {
    const raw = localStorage.getItem(TRACKED_ARTICLES_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    const candidates: TrackedArticle[] = [];
    for (const [tickerKey, articles] of Object.entries(parsed)) {
      const ticker = normalizeTicker(tickerKey);
      if (!/^[A-Z]{1,6}$/.test(ticker) || !Array.isArray(articles)) continue;

      for (const article of articles) {
        if (!article || typeof article !== "object") continue;
        const url = typeof article.url === "string" ? article.url.trim() : "";
        const title = typeof article.title === "string" ? article.title.trim() : "";
        if (!url || !title) continue;
        try {
          const protocol = new URL(url).protocol;
          if (protocol !== "http:" && protocol !== "https:") continue;
        } catch {
          continue;
        }
        candidates.push({
          id: typeof article.id === "string" ? article.id : getArticleId(ticker, url),
          ticker,
          title,
          url,
          source: typeof article.source === "string" && article.source.trim() ? article.source.trim() : "מקור שמור",
          publishedAt: typeof article.publishedAt === "string" ? article.publishedAt : new Date().toISOString(),
          summary: typeof article.summary === "string" ? article.summary : "",
          addedAt: typeof article.addedAt === "string" ? article.addedAt : new Date().toISOString(),
        });
      }
    }

    candidates.sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime());
    const normalized: TrackedArticlesByTicker = {};
    const seenIds = new Set<string>();
    for (const article of candidates) {
      if (seenIds.has(article.id)) continue;
      if (Object.values(normalized).flat().length >= MAX_TRACKED_ARTICLES) break;
      const current = normalized[article.ticker] ?? [];
      if (current.length >= MAX_TRACKED_ARTICLES_PER_TICKER) continue;
      seenIds.add(article.id);
      normalized[article.ticker] = [...current, article];
    }

    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      localStorage.setItem(TRACKED_ARTICLES_KEY, JSON.stringify(normalized));
    }
    return normalized;
  } catch {
    return {};
  }
}

function saveTrackedArticles(articles: TrackedArticlesByTicker) {
  localStorage.setItem(TRACKED_ARTICLES_KEY, JSON.stringify(articles));
}

function normalizeTicker(ticker: string) {
  return ticker.trim().toUpperCase();
}

function getArticleId(ticker: string, url: string) {
  return `${normalizeTicker(ticker)}:${url.trim()}`;
}

export function useTrackedArticles() {
  const [trackedArticles, setTrackedArticles] = useState<TrackedArticlesByTicker>(loadTrackedArticles);

  const addTrackedArticle = useCallback(
    (
      ticker: string,
      article: Omit<TrackedArticle, "id" | "ticker" | "addedAt">,
    ) => {
      const normalizedTicker = normalizeTicker(ticker);
      const normalizedUrl = article.url.trim();
      if (!normalizedTicker || !normalizedUrl) return false;

      const id = getArticleId(normalizedTicker, normalizedUrl);
      if ((trackedArticles[normalizedTicker] ?? []).some((item) => item.id === id)) {
        return false;
      }
      if (
        (trackedArticles[normalizedTicker] ?? []).length >= MAX_TRACKED_ARTICLES_PER_TICKER ||
        Object.values(trackedArticles).flat().length >= MAX_TRACKED_ARTICLES
      ) {
        return false;
      }
      setTrackedArticles((previous) => {
        const existing = previous[normalizedTicker] ?? [];
        if (
          existing.some((item) => item.id === id) ||
          existing.length >= MAX_TRACKED_ARTICLES_PER_TICKER ||
          Object.values(previous).flat().length >= MAX_TRACKED_ARTICLES
        ) return previous;

        const next = {
          ...previous,
          [normalizedTicker]: [
            {
              ...article,
              id,
              ticker: normalizedTicker,
              url: normalizedUrl,
              addedAt: new Date().toISOString(),
            },
            ...existing,
          ],
        };
        saveTrackedArticles(next);
        return next;
      });
      return true;
    },
    [trackedArticles],
  );

  const removeTrackedArticle = useCallback((ticker: string, id: string) => {
    const normalizedTicker = normalizeTicker(ticker);
    setTrackedArticles((previous) => {
      const remaining = (previous[normalizedTicker] ?? []).filter((article) => article.id !== id);
      const next = { ...previous };
      if (remaining.length > 0) next[normalizedTicker] = remaining;
      else delete next[normalizedTicker];
      saveTrackedArticles(next);
      return next;
    });
  }, []);

  const isArticleTracked = useCallback(
    (ticker: string, url: string) => {
      const normalizedTicker = normalizeTicker(ticker);
      return (trackedArticles[normalizedTicker] ?? []).some(
        (article) => article.url === url,
      );
    },
    [trackedArticles],
  );

  return {
    trackedArticles,
    addTrackedArticle,
    removeTrackedArticle,
    isArticleTracked,
  };
}