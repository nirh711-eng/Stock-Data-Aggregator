import { useCallback } from "react";

export type UsageEventType =
  | "login"
  | "tab_view"
  | "stock_search"
  | "watchlist_add"
  | "watchlist_remove"
  | "article_saved"
  | "article_removed"
  | "analysis_view"
  | "alert_view";

type TrackOptions = {
  ticker?: string | null;
  metadata?: Record<string, unknown>;
};

function createEventId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useUsageTracking() {
  const track = useCallback((eventType: UsageEventType, options: TrackOptions = {}) => {
    void fetch("/api/usage-events", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        eventId: createEventId(),
        eventType,
        ticker: options.ticker ?? null,
        metadata: options.metadata ?? {},
      }),
    }).catch(() => {
      // Usage tracking must never interrupt the user's action.
    });
  }, []);

  return { track };
}