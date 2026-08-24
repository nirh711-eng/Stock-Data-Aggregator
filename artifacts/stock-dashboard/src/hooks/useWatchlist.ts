import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@clerk/react";

export interface WatchlistItem {
  ticker: string;
  addedAt: string;
  lastKnownReportDate: string | null;
  companyName?: string | null;
  sector?: string | null;
}

export interface WatchlistAlert {
  id: string;
  ticker: string;
  companyName: string;
  type: "new_report" | "upcoming_earnings";
  message: string;
  currentReportDate?: string | null;
  upcomingEarningsDate?: string | null;
  price?: number | null;
  priceChangePercent?: number | null;
  seenAt: string | null;
  receivedAt: string;
}

const WATCHLIST_KEY = "stockpulse_watchlist";
const ALERTS_KEY = "stockpulse_alerts";
const WATCHLIST_LEGACY_CLAIM_KEY = "stockpulse_watchlist_legacy_claimed";
const POLL_INTERVAL_MS = 5 * 60 * 1000;
const MAX_WATCHLIST_ITEMS = 20;

type RemotePreferences = {
  watchlist?: unknown;
  trackedArticles?: unknown;
  updatedAt?: string;
};

type SyncStatus = "local" | "syncing" | "synced" | "offline";

function watchlistKeyForUser(userId: string) {
  return `${WATCHLIST_KEY}:${userId}`;
}

function watchlistMigrationKey(userId: string) {
  return `${WATCHLIST_KEY}:migrated:${userId}`;
}

function loadWatchlist(storageKey = WATCHLIST_KEY): WatchlistItem[] {
  try {
    const raw = localStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];

    const seen = new Set<string>();
    const normalized = parsed.flatMap((item): WatchlistItem[] => {
      const ticker = typeof item?.ticker === "string" ? item.ticker.trim().toUpperCase() : "";
      if (!/^[A-Z]{1,6}$/.test(ticker) || seen.has(ticker)) return [];
      seen.add(ticker);
      return [{
        ticker,
        addedAt: typeof item.addedAt === "string" ? item.addedAt : new Date().toISOString(),
        lastKnownReportDate: typeof item.lastKnownReportDate === "string" ? item.lastKnownReportDate : null,
        companyName: typeof item.companyName === "string" ? item.companyName : null,
        sector: typeof item.sector === "string" ? item.sector : null,
      }];
    }).slice(0, MAX_WATCHLIST_ITEMS);

    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      localStorage.setItem(storageKey, JSON.stringify(normalized));
    }
    return normalized;
  } catch {
    return [];
  }
}

function saveWatchlist(items: WatchlistItem[], storageKey = WATCHLIST_KEY) {
  localStorage.setItem(storageKey, JSON.stringify(items));
}

function loadAlerts(): WatchlistAlert[] {
  try {
    const raw = localStorage.getItem(ALERTS_KEY);
    return raw ? (JSON.parse(raw) as WatchlistAlert[]) : [];
  } catch {
    return [];
  }
}

function saveAlerts(alerts: WatchlistAlert[]) {
  const limited = alerts.slice(0, 50);
  localStorage.setItem(ALERTS_KEY, JSON.stringify(limited));
}

export function useWatchlist() {
  const [watchlist, setWatchlistState] = useState<WatchlistItem[]>(loadWatchlist);
  const [alerts, setAlertsState] = useState<WatchlistAlert[]>(loadAlerts);
  const [isChecking, setIsChecking] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("local");
  const lastCheckRef = useRef<number>(0);
  const watchlistRef = useRef(watchlist);
  const syncedUserIdRef = useRef<string | null>(null);
  const { isLoaded, isSignedIn, userId } = useAuth();

  const unreadCount = alerts.filter((a) => !a.seenAt).length;

  useEffect(() => {
    watchlistRef.current = watchlist;
  }, [watchlist]);

  const applyRemoteWatchlist = useCallback((preferences: RemotePreferences, ownerId: string) => {
    const next = Array.isArray(preferences.watchlist)
      ? preferences.watchlist
        .flatMap((item): WatchlistItem[] => {
          const ticker = typeof (item as WatchlistItem)?.ticker === "string"
            ? (item as WatchlistItem).ticker.trim().toUpperCase()
            : "";
          if (!/^[A-Z]{1,6}$/.test(ticker)) return [];
          return [{
            ticker,
            addedAt: typeof (item as WatchlistItem).addedAt === "string"
              ? (item as WatchlistItem).addedAt
              : new Date().toISOString(),
            lastKnownReportDate: typeof (item as WatchlistItem).lastKnownReportDate === "string"
              ? (item as WatchlistItem).lastKnownReportDate
              : null,
            companyName: typeof (item as WatchlistItem).companyName === "string"
              ? (item as WatchlistItem).companyName
              : null,
            sector: typeof (item as WatchlistItem).sector === "string"
              ? (item as WatchlistItem).sector
              : null,
          }];
        })
        .slice(0, MAX_WATCHLIST_ITEMS)
      : [];
    setWatchlistState(next);
    saveWatchlist(next, watchlistKeyForUser(ownerId));
  }, []);

  const syncAccountWatchlist = useCallback(async () => {
    if (!isLoaded || !isSignedIn || !userId || syncedUserIdRef.current === userId) return;
    syncedUserIdRef.current = userId;
    setSyncStatus("syncing");
    try {
      const hasMigrated = localStorage.getItem(watchlistMigrationKey(userId)) === "1";
      const canClaimLegacyData = localStorage.getItem(WATCHLIST_LEGACY_CLAIM_KEY) !== "1";
      const response = !hasMigrated && canClaimLegacyData
        ? await fetch("/api/preferences/merge", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ watchlist: watchlistRef.current, trackedArticles: {} }),
        })
        : await fetch("/api/preferences", { credentials: "include" });
      if (!response.ok) throw new Error("Unable to merge watchlist");
      applyRemoteWatchlist(await response.json() as RemotePreferences, userId);
      localStorage.setItem(watchlistMigrationKey(userId), "1");
      if (canClaimLegacyData) {
        localStorage.setItem(WATCHLIST_LEGACY_CLAIM_KEY, "1");
        localStorage.removeItem(WATCHLIST_KEY);
      }
      setSyncStatus("synced");
    } catch {
      syncedUserIdRef.current = null;
      setSyncStatus("offline");
    }
  }, [applyRemoteWatchlist, isLoaded, isSignedIn, userId]);

  useEffect(() => {
    if (!isLoaded) return;
    syncedUserIdRef.current = null;
    if (!isSignedIn || !userId) {
      setWatchlistState(loadWatchlist());
      return;
    }
    setWatchlistState(loadWatchlist(watchlistKeyForUser(userId)));
    void syncAccountWatchlist();
  }, [isLoaded, isSignedIn, syncAccountWatchlist, userId]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !userId) {
      syncedUserIdRef.current = null;
      setSyncStatus("local");
      return;
    }
    const refreshFromAccount = async () => {
      try {
        const response = await fetch("/api/preferences", { credentials: "include" });
        if (!response.ok) return;
        applyRemoteWatchlist(await response.json() as RemotePreferences, userId);
        setSyncStatus("synced");
      } catch {
        setSyncStatus("offline");
      }
    };
    window.addEventListener("focus", refreshFromAccount);
    return () => window.removeEventListener("focus", refreshFromAccount);
  }, [applyRemoteWatchlist, isLoaded, isSignedIn, userId]);

  const saveWatchlistItemToAccount = useCallback(async (item: WatchlistItem) => {
    if (!isSignedIn) return;
    try {
      const response = await fetch(`/api/preferences/watchlist/${encodeURIComponent(item.ticker)}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item),
      });
      if (!response.ok) throw new Error("Unable to save watchlist item");
      if (!userId) return;
      applyRemoteWatchlist(await response.json() as RemotePreferences, userId);
      setSyncStatus("synced");
    } catch {
      setSyncStatus("offline");
    }
  }, [applyRemoteWatchlist, isSignedIn, userId]);

  const removeWatchlistItemFromAccount = useCallback(async (ticker: string) => {
    if (!isSignedIn) return;
    try {
      const response = await fetch(`/api/preferences/watchlist/${encodeURIComponent(ticker)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Unable to remove watchlist item");
      if (!userId) return;
      applyRemoteWatchlist(await response.json() as RemotePreferences, userId);
      setSyncStatus("synced");
    } catch {
      setSyncStatus("offline");
    }
  }, [applyRemoteWatchlist, isSignedIn, userId]);

  const addToWatchlist = useCallback(
    (ticker: string, lastKnownReportDate: string | null = null, companyName: string | null = null, sector: string | null = null) => {
      const normalizedTicker = ticker.trim().toUpperCase();
      if (!/^[A-Z]{1,6}$/.test(normalizedTicker)) return;
      setWatchlistState((prev) => {
        if (prev.find((w) => w.ticker === normalizedTicker)) return prev;
        if (prev.length >= MAX_WATCHLIST_ITEMS) return prev;
        const item = {
          ticker: normalizedTicker,
          addedAt: new Date().toISOString(),
          lastKnownReportDate,
          companyName,
          sector,
        };
        const next = [
          ...prev,
          item,
        ];
        saveWatchlist(next, isSignedIn && userId ? watchlistKeyForUser(userId) : WATCHLIST_KEY);
        void saveWatchlistItemToAccount(item);
        return next;
      });
    },
    [isSignedIn, saveWatchlistItemToAccount, userId]
  );

  const removeFromWatchlist = useCallback((ticker: string) => {
    const normalizedTicker = ticker.trim().toUpperCase();
    setWatchlistState((prev) => {
      const next = prev.filter((w) => w.ticker !== normalizedTicker);
      saveWatchlist(next, isSignedIn && userId ? watchlistKeyForUser(userId) : WATCHLIST_KEY);
      void removeWatchlistItemFromAccount(normalizedTicker);
      return next;
    });
  }, [isSignedIn, removeWatchlistItemFromAccount, userId]);

  const isWatched = useCallback(
    (ticker: string) => watchlist.some((w) => w.ticker === ticker),
    [watchlist]
  );

  const updateLastKnownDate = useCallback(
    (ticker: string, date: string | null) => {
      const normalizedTicker = ticker.trim().toUpperCase();
      setWatchlistState((prev) => {
        const current = prev.find((w) => w.ticker === normalizedTicker);
        if (!current || current.lastKnownReportDate === date) return prev;
        const next = prev.map((w) =>
          w.ticker === normalizedTicker ? { ...w, lastKnownReportDate: date } : w
        );
        saveWatchlist(next, isSignedIn && userId ? watchlistKeyForUser(userId) : WATCHLIST_KEY);
        const updated = next.find((item) => item.ticker === normalizedTicker);
        if (updated) void saveWatchlistItemToAccount(updated);
        return next;
      });
    },
    [isSignedIn, saveWatchlistItemToAccount, userId]
  );

  const markAllRead = useCallback(() => {
    setAlertsState((prev) => {
      const next = prev.map((a) =>
        a.seenAt ? a : { ...a, seenAt: new Date().toISOString() }
      );
      saveAlerts(next);
      return next;
    });
  }, []);

  const clearAlerts = useCallback(() => {
    setAlertsState([]);
    saveAlerts([]);
  }, []);

  const checkWatchlist = useCallback(
    async (force = false) => {
      if (watchlist.length === 0) return;
      const now = Date.now();
      if (!force && now - lastCheckRef.current < POLL_INTERVAL_MS) return;
      lastCheckRef.current = now;
      setIsChecking(true);

      try {
        const payload = {
          watchlist: watchlist.map((w) => ({
            ticker: w.ticker,
            lastKnownReportDate: w.lastKnownReportDate,
          })),
        };

        const res = await fetch("/api/stocks/watchlist/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!res.ok) return;
        const data = (await res.json()) as {
          alerts: Array<{
            ticker: string;
            companyName: string;
            type: "new_report" | "upcoming_earnings";
            message: string;
            currentReportDate?: string | null;
            upcomingEarningsDate?: string | null;
            price?: number | null;
            priceChangePercent?: number | null;
          }>;
        };

        if (data.alerts.length > 0) {
          const newAlerts: WatchlistAlert[] = data.alerts.map((a) => ({
            ...a,
            id: `${a.ticker}-${a.type}-${a.currentReportDate ?? a.upcomingEarningsDate ?? Date.now()}`,
            seenAt: null,
            receivedAt: new Date().toISOString(),
          }));

          setAlertsState((prev) => {
            const existingIds = new Set(prev.map((a) => a.id));
            const truly_new = newAlerts.filter((a) => !existingIds.has(a.id));
            if (truly_new.length === 0) return prev;

            const next = [...truly_new, ...prev];
            saveAlerts(next);

            if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
              for (const alert of truly_new) {
                new Notification("StockPulse התראה", {
                  body: alert.message,
                  icon: "/favicon.ico",
                });
              }
            }

            truly_new.forEach((a) => {
              if (a.type === "new_report" && a.currentReportDate) {
                updateLastKnownDate(a.ticker, a.currentReportDate);
              }
            });

            return next;
          });
        }
      } catch {
        // silent
      } finally {
        setIsChecking(false);
      }
    },
    [watchlist, updateLastKnownDate]
  );

  useEffect(() => {
    if (watchlist.length === 0) return;
    checkWatchlist();
    const interval = setInterval(() => checkWatchlist(), POLL_INTERVAL_MS);
    const onFocus = () => checkWatchlist();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [watchlist, checkWatchlist]);

  const requestNotificationPermission = useCallback(async () => {
    if (!("Notification" in window)) return "denied";
    if (Notification.permission === "granted") return "granted";
    return await Notification.requestPermission();
  }, []);

  return {
    watchlist,
    alerts,
    unreadCount,
    isChecking,
    syncStatus,
    addToWatchlist,
    removeFromWatchlist,
    isWatched,
    updateLastKnownDate,
    markAllRead,
    clearAlerts,
    checkWatchlist,
    requestNotificationPermission,
  };
}
