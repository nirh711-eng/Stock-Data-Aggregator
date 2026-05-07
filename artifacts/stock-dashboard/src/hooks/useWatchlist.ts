import { useState, useEffect, useCallback, useRef } from "react";

export interface WatchlistItem {
  ticker: string;
  addedAt: string;
  lastKnownReportDate: string | null;
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
const POLL_INTERVAL_MS = 5 * 60 * 1000;

function loadWatchlist(): WatchlistItem[] {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY);
    return raw ? (JSON.parse(raw) as WatchlistItem[]) : [];
  } catch {
    return [];
  }
}

function saveWatchlist(items: WatchlistItem[]) {
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(items));
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
  const lastCheckRef = useRef<number>(0);

  const unreadCount = alerts.filter((a) => !a.seenAt).length;

  const addToWatchlist = useCallback(
    (ticker: string, lastKnownReportDate: string | null = null) => {
      setWatchlistState((prev) => {
        if (prev.find((w) => w.ticker === ticker)) return prev;
        const next = [
          ...prev,
          { ticker, addedAt: new Date().toISOString(), lastKnownReportDate },
        ];
        saveWatchlist(next);
        return next;
      });
    },
    []
  );

  const removeFromWatchlist = useCallback((ticker: string) => {
    setWatchlistState((prev) => {
      const next = prev.filter((w) => w.ticker !== ticker);
      saveWatchlist(next);
      return next;
    });
  }, []);

  const isWatched = useCallback(
    (ticker: string) => watchlist.some((w) => w.ticker === ticker),
    [watchlist]
  );

  const updateLastKnownDate = useCallback(
    (ticker: string, date: string | null) => {
      setWatchlistState((prev) => {
        const next = prev.map((w) =>
          w.ticker === ticker ? { ...w, lastKnownReportDate: date } : w
        );
        saveWatchlist(next);
        return next;
      });
    },
    []
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
