import { useRef, useState, useEffect } from "react";
import { Bell, BellRing, Trash2, CheckCheck, TrendingUp, TrendingDown, Calendar, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { WatchlistAlert } from "@/hooks/useWatchlist";

interface NotificationCenterProps {
  alerts: WatchlistAlert[];
  unreadCount: number;
  isChecking: boolean;
  onMarkAllRead: () => void;
  onClearAlerts: () => void;
  onTickerClick?: (ticker: string) => void;
}

export function NotificationCenter({
  alerts,
  unreadCount,
  isChecking,
  onMarkAllRead,
  onClearAlerts,
  onTickerClick,
}: NotificationCenterProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleOpen = () => {
    setOpen((v) => !v);
    if (!open && unreadCount > 0) {
      setTimeout(onMarkAllRead, 1500);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="ghost"
        size="icon"
        className="relative"
        onClick={handleOpen}
        title="התראות"
      >
        {isChecking ? (
          <BellRing className="w-5 h-5 animate-pulse text-primary" />
        ) : (
          <Bell className={`w-5 h-5 ${unreadCount > 0 ? "text-primary" : "text-muted-foreground"}`} />
        )}
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute top-full left-0 mt-2 w-[340px] bg-card border border-border rounded-xl shadow-2xl z-50 overflow-hidden"
          style={{ right: "auto", left: "50%", transform: "translateX(-50%)" }}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="text-sm font-semibold text-foreground">התראות</span>
            <div className="flex gap-1">
              {unreadCount > 0 && (
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onMarkAllRead} title="סמן הכל כנקרא">
                  <CheckCheck className="w-4 h-4" />
                </Button>
              )}
              {alerts.length > 0 && (
                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={onClearAlerts} title="נקה הכל">
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>

          <div className="max-h-[400px] overflow-y-auto divide-y divide-border">
            {alerts.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground text-sm">
                <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
                אין התראות עדיין
              </div>
            ) : (
              alerts.map((alert) => (
                <AlertItem
                  key={alert.id}
                  alert={alert}
                  onTickerClick={(t) => {
                    onTickerClick?.(t);
                    setOpen(false);
                  }}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AlertItem({ alert, onTickerClick }: { alert: WatchlistAlert; onTickerClick: (t: string) => void }) {
  const isNew = !alert.seenAt;
  const isNewReport = alert.type === "new_report";
  const isPositive = (alert.priceChangePercent ?? 0) >= 0;

  return (
    <button
      className={`w-full text-right px-4 py-3 hover:bg-muted/50 transition-colors ${isNew ? "bg-primary/5" : ""}`}
      onClick={() => onTickerClick(alert.ticker)}
      dir="rtl"
    >
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 p-1.5 rounded-full shrink-0 ${isNewReport ? "bg-positive/10 text-positive" : "bg-primary/10 text-primary"}`}>
          {isNewReport ? <FileText className="w-3.5 h-3.5" /> : <Calendar className="w-3.5 h-3.5" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-mono font-bold text-sm text-foreground">{alert.ticker}</span>
            {isNew && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
            <Badge variant={isNewReport ? "default" : "secondary"} className="text-[10px] py-0 h-4 px-1.5 mr-auto">
              {isNewReport ? "דוח חדש" : "דוח צפוי"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground leading-snug">{alert.message}</p>
          {alert.price != null && (
            <div className={`flex items-center gap-1 mt-1 text-xs font-mono ${isPositive ? "text-positive" : "text-destructive"}`}>
              {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              <span>${alert.price.toFixed(2)}</span>
              <span>({isPositive ? "+" : ""}{(alert.priceChangePercent ?? 0).toFixed(2)}%)</span>
            </div>
          )}
          <p className="text-[10px] text-muted-foreground/60 mt-1">
            {new Date(alert.receivedAt).toLocaleString("he-IL")}
          </p>
        </div>
      </div>
    </button>
  );
}
