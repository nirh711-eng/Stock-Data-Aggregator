import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/react";

export interface TrackedArticle {
  id: string;
  ticker: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  summary?: string | null;
  articleType?: "earnings" | "legal" | "merger" | "product" | "leadership" | "regulation" | "analyst" | "market" | "other";
  addedAt: string;
}

type TrackedArticlesByTicker = Record<string, TrackedArticle[]>;

const TRACKED_ARTICLES_KEY = "stockpulse_tracked_market_articles";

const TRACKED_ARTICLES_LEGACY_CLAIM_KEY = "stockpulse_tracked_market_articles_legacy_claimed";
export const MAX_TRACKED_ARTICLES = 100;
export const MAX_TRACKED_ARTICLES_PER_TICKER = 20;

type RemotePreferences = {
  trackedArticles?: unknown;
};

function trackedArticlesKeyForUser(userId: string) {
  return `${TRACKED_ARTICLES_KEY}:${userId}`;
}
const ARTICLE_TYPES = new Set<NonNullable<TrackedArticle["articleType"]>>([
  "earnings", "legal", "merger", "product", "leadership", "regulation", "analyst", "market", "other",
]);

function loadTrackedArticles(storageKey = TRACKED_ARTICLES_KEY): TrackedArticlesByTicker {
  try {
    const raw = localStorage.getItem(storageKey);
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
        const articleType = typeof article.articleType === "string"
          && ARTICLE_TYPES.has(article.articleType as NonNullable<TrackedArticle["articleType"]>)
          ? article.articleType as NonNullable<TrackedArticle["articleType"]>
          : "other";
        candidates.push({
          id: typeof article.id === "string" ? article.id : getArticleId(ticker, url),
          ticker,
          title,
          url,
          source: typeof article.source === "string" && article.source.trim() ? article.source.trim() : "מקור שמור",
          publishedAt: typeof article.publishedAt === "string" ? article.publishedAt : new Date().toISOString(),
          summary: typeof article.summary === "string" ? article.summary : "",
          articleType,
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
      localStorage.setItem(storageKey, JSON.stringify(normalized));
    }
    return normalized;
  } catch {
    return {};
  }
}

function saveTrackedArticles(articles: TrackedArticlesByTicker, storageKey = TRACKED_ARTICLES_KEY) {
  localStorage.setItem(storageKey, JSON.stringify(articles));
}

function normalizeTicker(ticker: string) {
  return ticker.trim().toUpperCase();
}

function getArticleId(ticker: string, url: string) {
  return `${normalizeTicker(ticker)}:${url.trim()}`;
}

export function useTrackedArticles() {
  const [trackedArticles, setTrackedArticles] = useState<TrackedArticlesByTicker>(loadTrackedArticles);
  const trackedArticlesRef = useRef(trackedArticles);
  const syncedUserIdRef = useRef<string | null>(null);
  const { isLoaded, isSignedIn, userId } = useAuth();

  useEffect(() => {
    trackedArticlesRef.current = trackedArticles;
  }, [trackedArticles]);

  const applyRemoteArticles = useCallback((preferences: RemotePreferences, ownerId: string) => {
    const remote = preferences.trackedArticles;
    if (!remote || typeof remote !== "object" || Array.isArray(remote)) return;
    const storageKey = trackedArticlesKeyForUser(ownerId);
    localStorage.setItem(storageKey, JSON.stringify(remote));
    const normalized = loadTrackedArticles(storageKey);
    setTrackedArticles(normalized);
  }, []);

  const syncAccountArticles = useCallback(async () => {
    if (!isLoaded || !isSignedIn || !userId || syncedUserIdRef.current === userId) return;
    syncedUserIdRef.current = userId;
    try {
      const hasMigrated = localStorage.getItem(trackedArticlesMigrationKey(userId)) === "1";
      const canClaimLegacyData = localStorage.getItem(TRACKED_ARTICLES_LEGACY_CLAIM_KEY) !== "1";
      const response = !hasMigrated && canClaimLegacyData
        ? await fetch("/api/preferences/merge", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ watchlist: [], trackedArticles: trackedArticlesRef.current }),
        })
        : await fetch("/api/preferences", { credentials: "include" });
      if (!response.ok) throw new Error("Unable to merge tracked articles");
      applyRemoteArticles(await response.json() as RemotePreferences, userId);
      localStorage.setItem(trackedArticlesMigrationKey(userId), "1");
      if (canClaimLegacyData) {
        localStorage.setItem(TRACKED_ARTICLES_LEGACY_CLAIM_KEY, "1");
        localStorage.removeItem(TRACKED_ARTICLES_KEY);
      }
    } catch {
      syncedUserIdRef.current = null;
    }
  }, [applyRemoteArticles, isLoaded, isSignedIn, userId]);

  useEffect(() => {
    if (!isLoaded) return;
    syncedUserIdRef.current = null;
    if (!isSignedIn || !userId) {
      setTrackedArticles(loadTrackedArticles());
      return;
    }
    setTrackedArticles(loadTrackedArticles(trackedArticlesKeyForUser(userId)));
    void syncAccountArticles();
  }, [isLoaded, isSignedIn, syncAccountArticles, userId]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !userId) {
      syncedUserIdRef.current = null;
      return;
    }
    const refreshFromAccount = async () => {
      try {
        const response = await fetch("/api/preferences", { credentials: "include" });
        if (!response.ok) return;
        applyRemoteArticles(await response.json() as RemotePreferences, userId);
      } catch {
        // The local copy remains available until the next successful refresh.
      }
    };
    window.addEventListener("focus", refreshFromAccount);
    return () => window.removeEventListener("focus", refreshFromAccount);
  }, [applyRemoteArticles, isLoaded, isSignedIn, userId]);

  const saveArticleToAccount = useCallback(async (article: TrackedArticle) => {
    if (!isSignedIn) return;
    try {
      const response = await fetch("/api/preferences/articles", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(article),
      });
      if (!response.ok) throw new Error("Unable to save tracked article");
      if (!userId) return;
      applyRemoteArticles(await response.json() as RemotePreferences, userId);
    } catch {
      // The local copy remains available until the next successful refresh.
    }
  }, [applyRemoteArticles, isSignedIn, userId]);

  const removeArticleFromAccount = useCallback(async (ticker: string, article: TrackedArticle) => {
    if (!isSignedIn) return;
    try {
      const response = await fetch("/api/preferences/articles", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, id: article.id, url: article.url }),
      });
      if (!response.ok) throw new Error("Unable to remove tracked article");
      if (!userId) return;
      applyRemoteArticles(await response.json() as RemotePreferences, userId);
    } catch {
      // The local copy remains available until the next successful refresh.
    }
  }, [applyRemoteArticles, isSignedIn, userId]);

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

        const trackedArticle: TrackedArticle = {
          ...article,
          id,
          ticker: normalizedTicker,
          url: normalizedUrl,
          addedAt: new Date().toISOString(),
        };
        const next = {
          ...previous,
          [normalizedTicker]: [
            trackedArticle,
            ...existing,
          ],
        };
        saveTrackedArticles(
          next,
          isSignedIn && userId ? trackedArticlesKeyForUser(userId) : TRACKED_ARTICLES_KEY,
        );
        void saveArticleToAccount(trackedArticle);
        return next;
      });
      return true;
    },
    [isSignedIn, saveArticleToAccount, trackedArticles, userId],
  );

  const removeTrackedArticle = useCallback((ticker: string, id: string) => {
    const normalizedTicker = normalizeTicker(ticker);
    setTrackedArticles((previous) => {
      const article = (previous[normalizedTicker] ?? []).find((item) => item.id === id);
      const remaining = (previous[normalizedTicker] ?? []).filter((article) => article.id !== id);
      const next = { ...previous };
      if (remaining.length > 0) next[normalizedTicker] = remaining;
      else delete next[normalizedTicker];
      saveTrackedArticles(
        next,
        isSignedIn && userId ? trackedArticlesKeyForUser(userId) : TRACKED_ARTICLES_KEY,
      );
      if (article) void removeArticleFromAccount(normalizedTicker, article);
      return next;
    });
  }, [isSignedIn, removeArticleFromAccount, userId]);

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

function trackedArticlesMigrationKey(userId: string) {
  return `${TRACKED_ARTICLES_KEY}:migrated:${userId}`;
}
