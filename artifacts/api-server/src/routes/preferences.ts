import { getAuth } from "@clerk/express";
import { db, userPreferencesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { Router } from "express";

const router = Router();
const MAX_WATCHLIST_ITEMS = 20;
const MAX_TRACKED_ARTICLES = 100;
const MAX_TRACKED_ARTICLES_PER_TICKER = 20;
const tickerPattern = /^[A-Z]{1,6}$/;

type WatchlistItem = {
  ticker: string;
  addedAt: string;
  lastKnownReportDate: string | null;
  companyName: string | null;
  sector: string | null;
};

type TrackedArticle = {
  id: string;
  ticker: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  summary: string;
  addedAt: string;
};

type Preferences = {
  watchlist: WatchlistItem[];
  trackedArticles: Record<string, TrackedArticle[]>;
  updatedAt: string;
};

function requireUserId(req: Parameters<typeof getAuth>[0]): string | null {
  const auth = getAuth(req);
  const userId = auth.sessionClaims?.userId || auth.userId;
  return typeof userId === "string" ? userId : null;
}

function isValidUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function validDate(value: unknown): string {
  if (typeof value !== "string" || Number.isNaN(new Date(value).getTime())) {
    return new Date().toISOString();
  }
  return value;
}

function normalizeWatchlist(value: unknown): WatchlistItem[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const normalized: WatchlistItem[] = [];
  for (const item of value) {
    const raw = item as Partial<WatchlistItem> | null;
    const ticker = typeof raw?.ticker === "string" ? raw.ticker.trim().toUpperCase() : "";
    if (!tickerPattern.test(ticker) || seen.has(ticker)) continue;
    seen.add(ticker);
    normalized.push({
      ticker,
      addedAt: validDate(raw?.addedAt),
      lastKnownReportDate: typeof raw?.lastKnownReportDate === "string" ? raw.lastKnownReportDate : null,
      companyName: typeof raw?.companyName === "string" ? raw.companyName.trim() || null : null,
      sector: typeof raw?.sector === "string" ? raw.sector.trim() || null : null,
    });
    if (normalized.length === MAX_WATCHLIST_ITEMS) break;
  }
  return normalized;
}

function normalizeTrackedArticles(value: unknown): Record<string, TrackedArticle[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const candidates = Object.entries(value as Record<string, unknown>)
    .flatMap(([tickerKey, articles]) => {
      const ticker = tickerKey.trim().toUpperCase();
      if (!tickerPattern.test(ticker) || !Array.isArray(articles)) return [];
      return articles.flatMap((article): TrackedArticle[] => {
        const raw = article as Partial<TrackedArticle> | null;
        const url = typeof raw?.url === "string" ? raw.url.trim() : "";
        const title = typeof raw?.title === "string" ? raw.title.trim() : "";
        if (!url || !title || !isValidUrl(url)) return [];
        return [{
          id: typeof raw?.id === "string" && raw.id ? raw.id : `${ticker}:${url}`,
          ticker,
          title,
          url,
          source: typeof raw?.source === "string" && raw.source.trim() ? raw.source.trim() : "מקור שמור",
          publishedAt: validDate(raw?.publishedAt),
          summary: typeof raw?.summary === "string" ? raw.summary : "",
          addedAt: validDate(raw?.addedAt),
        }];
      });
    })
    .sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime());

  const normalized: Record<string, TrackedArticle[]> = {};
  const seen = new Set<string>();
  for (const article of candidates) {
    const key = `${article.ticker}:${article.url}`;
    if (seen.has(key) || Object.values(normalized).flat().length >= MAX_TRACKED_ARTICLES) continue;
    const tickerArticles = normalized[article.ticker] ?? [];
    if (tickerArticles.length >= MAX_TRACKED_ARTICLES_PER_TICKER) continue;
    seen.add(key);
    normalized[article.ticker] = [...tickerArticles, article];
  }
  return normalized;
}

function mergeWatchlist(current: WatchlistItem[], incoming: WatchlistItem[]): WatchlistItem[] {
  const merged = new Map(current.map((item) => [item.ticker, item]));
  for (const item of incoming) {
    const existing = merged.get(item.ticker);
    if (!existing) {
      merged.set(item.ticker, item);
      continue;
    }
    const newer = new Date(item.addedAt).getTime() > new Date(existing.addedAt).getTime() ? item : existing;
    const older = newer === item ? existing : item;
    merged.set(item.ticker, {
      ...newer,
      lastKnownReportDate: [existing.lastKnownReportDate, item.lastKnownReportDate]
        .filter((date): date is string => Boolean(date))
        .sort()
        .at(-1) ?? null,
      companyName: newer.companyName ?? older.companyName,
      sector: newer.sector ?? older.sector,
    });
  }
  return [...merged.values()]
    .sort((a, b) => new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime())
    .slice(0, MAX_WATCHLIST_ITEMS);
}

function mergeTrackedArticles(
  current: Record<string, TrackedArticle[]>,
  incoming: Record<string, TrackedArticle[]>,
): Record<string, TrackedArticle[]> {
  const all = [...Object.values(current).flat(), ...Object.values(incoming).flat()]
    .sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime());
  const merged: Record<string, TrackedArticle[]> = {};
  const seen = new Set<string>();
  for (const article of all) {
    const key = `${article.ticker}:${article.url}`;
    if (seen.has(key) || Object.values(merged).flat().length >= MAX_TRACKED_ARTICLES) continue;
    const tickerArticles = merged[article.ticker] ?? [];
    if (tickerArticles.length >= MAX_TRACKED_ARTICLES_PER_TICKER) continue;
    seen.add(key);
    merged[article.ticker] = [...tickerArticles, article];
  }
  return merged;
}

async function updatePreferences(
  userId: string,
  mutate: (current: Omit<Preferences, "updatedAt">) => Omit<Preferences, "updatedAt">,
): Promise<Preferences> {
  return db.transaction(async (tx) => {
    await tx.insert(userPreferencesTable)
      .values({ userId, watchlist: [], trackedArticles: {} })
      .onConflictDoNothing();
    await tx.execute(sql`SELECT user_id FROM user_preferences WHERE user_id = ${userId} FOR UPDATE`);
    const [row] = await tx.select().from(userPreferencesTable).where(eq(userPreferencesTable.userId, userId));
    const current = {
      watchlist: normalizeWatchlist(row?.watchlist),
      trackedArticles: normalizeTrackedArticles(row?.trackedArticles),
    };
    const next = mutate(current);
    const [saved] = await tx.update(userPreferencesTable)
      .set({
        watchlist: normalizeWatchlist(next.watchlist),
        trackedArticles: normalizeTrackedArticles(next.trackedArticles),
        updatedAt: new Date(),
      })
      .where(eq(userPreferencesTable.userId, userId))
      .returning();
    return {
      watchlist: normalizeWatchlist(saved.watchlist),
      trackedArticles: normalizeTrackedArticles(saved.trackedArticles),
      updatedAt: saved.updatedAt.toISOString(),
    };
  });
}

router.get("/preferences", async (req, res): Promise<void> => {
  const userId = requireUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const preferences = await updatePreferences(userId, (current) => current);
  res.json(preferences);
});

router.post("/preferences/merge", async (req, res): Promise<void> => {
  const userId = requireUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const incomingWatchlist = normalizeWatchlist(req.body?.watchlist);
  const incomingArticles = normalizeTrackedArticles(req.body?.trackedArticles);
  const preferences = await updatePreferences(userId, (current) => ({
    watchlist: mergeWatchlist(current.watchlist, incomingWatchlist),
    trackedArticles: mergeTrackedArticles(current.trackedArticles, incomingArticles),
  }));
  res.json(preferences);
});

router.put("/preferences/watchlist/:ticker", async (req, res): Promise<void> => {
  const userId = requireUserId(req);
  const ticker = String(req.params.ticker).trim().toUpperCase();
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!tickerPattern.test(ticker)) {
    res.status(400).json({ error: "Bad request", message: "Invalid ticker" });
    return;
  }
  const [item] = normalizeWatchlist([{
    ...req.body,
    ticker,
    addedAt: req.body?.addedAt ?? new Date().toISOString(),
  }]);
  if (!item) {
    res.status(400).json({ error: "Bad request", message: "Invalid watchlist item" });
    return;
  }
  const preferences = await updatePreferences(userId, (current) => ({
    ...current,
    watchlist: mergeWatchlist(
      current.watchlist.filter((existing) => existing.ticker !== ticker),
      [item],
    ),
  }));
  res.json(preferences);
});

router.delete("/preferences/watchlist/:ticker", async (req, res): Promise<void> => {
  const userId = requireUserId(req);
  const ticker = String(req.params.ticker).trim().toUpperCase();
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const preferences = await updatePreferences(userId, (current) => ({
    ...current,
    watchlist: current.watchlist.filter((item) => item.ticker !== ticker),
  }));
  res.json(preferences);
});

router.put("/preferences/articles", async (req, res): Promise<void> => {
  const userId = requireUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const normalized = normalizeTrackedArticles({
    [req.body?.ticker ?? ""]: [{
      ...req.body,
      addedAt: req.body?.addedAt ?? new Date().toISOString(),
    }],
  });
  const article = Object.values(normalized).flat()[0];
  if (!article) {
    res.status(400).json({ error: "Bad request", message: "Invalid tracked article" });
    return;
  }
  const preferences = await updatePreferences(userId, (current) => ({
    ...current,
    trackedArticles: mergeTrackedArticles(
      Object.fromEntries(
        Object.entries(current.trackedArticles).map(([ticker, articles]) => [
          ticker,
          articles.filter((existing) => existing.url !== article.url || existing.ticker !== article.ticker),
        ]),
      ),
      { [article.ticker]: [article] },
    ),
  }));
  res.json(preferences);
});

router.delete("/preferences/articles", async (req, res): Promise<void> => {
  const userId = requireUserId(req);
  const ticker = typeof req.body?.ticker === "string" ? req.body.ticker.trim().toUpperCase() : "";
  const id = typeof req.body?.id === "string" ? req.body.id : "";
  const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!tickerPattern.test(ticker) || (!id && !url)) {
    res.status(400).json({ error: "Bad request", message: "Invalid tracked article" });
    return;
  }
  const preferences = await updatePreferences(userId, (current) => ({
    ...current,
    trackedArticles: Object.fromEntries(
      Object.entries(current.trackedArticles)
        .map(([key, articles]) => [
          key,
          key === ticker ? articles.filter((article) => article.id !== id && article.url !== url) : articles,
        ])
        .filter(([, articles]) => articles.length > 0),
    ),
  }));
  res.json(preferences);
});

export default router;