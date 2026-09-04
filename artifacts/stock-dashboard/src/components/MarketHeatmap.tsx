import { useMemo } from "react";
import { AlertTriangle, Clock3, Grid2X2, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import {
  getGetMarketHeatmapQueryKey,
  useGetMarketHeatmap,
  type MarketHeatmapItem,
  type MarketHeatmapSector,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function formatTime(value: string | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}

function formatVolume(value: number | null): string {
  if (value == null) return "—";
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(0)}K`;
  return String(Math.round(value));
}

function tileStyle(changePercent: number | null): { backgroundColor: string; borderColor: string } {
  const change = changePercent ?? 0;
  const intensity = Math.min(Math.abs(change) / 5, 1);
  if (change > 0) {
    return {
      backgroundColor: `rgba(16, 185, 129, ${0.10 + intensity * 0.42})`,
      borderColor: `rgba(52, 211, 153, ${0.22 + intensity * 0.45})`,
    };
  }
  if (change < 0) {
    return {
      backgroundColor: `rgba(244, 63, 94, ${0.10 + intensity * 0.42})`,
      borderColor: `rgba(251, 113, 133, ${0.22 + intensity * 0.45})`,
    };
  }
  return { backgroundColor: "rgba(148, 163, 184, 0.10)", borderColor: "rgba(148, 163, 184, 0.22)" };
}

function HeatmapTile({ item }: { item: MarketHeatmapItem }) {
  const style = tileStyle(item.changePercent);
  const change = item.changePercent ?? 0;
  const cap = item.marketCap ?? 0;
  const span = cap >= 5e11 ? 3 : cap >= 1e11 ? 2 : 1;
  return (
    <div
      className="min-h-[72px] rounded-lg border p-2 transition-transform hover:z-10 hover:scale-[1.03]"
      style={{ ...style, gridColumn: `span ${span}` }}
      title={`${item.name} · ${item.sector} · שווי ${item.marketCapFormatted}`}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="font-mono text-xs font-bold text-foreground" dir="ltr">{item.ticker}</span>
        {change > 0
          ? <TrendingUp className="h-3 w-3 text-emerald-300" />
          : change < 0
            ? <TrendingDown className="h-3 w-3 text-rose-300" />
            : null}
      </div>
      <div className="mt-1 truncate text-[10px] text-foreground/75">{item.name}</div>
      <div className={`mt-2 font-mono text-sm font-semibold ${change > 0 ? "text-emerald-200" : change < 0 ? "text-rose-200" : "text-muted-foreground"}`} dir="ltr">
        {change > 0 ? "+" : ""}{change.toFixed(2)}%
      </div>
      <div className="mt-0.5 text-[9px] text-foreground/55">
        {item.marketCapFormatted} · {formatVolume(item.volume)}
      </div>
    </div>
  );
}

function SectorSummary({ sector }: { sector: MarketHeatmapSector }) {
  const change = sector.changePercent ?? 0;
  return (
    <div className="rounded-lg border border-border/60 bg-muted/10 px-3 py-2">
      <div className="truncate text-xs font-medium text-foreground/85">{sector.sector}</div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className={`font-mono text-sm ${change > 0 ? "text-emerald-400" : change < 0 ? "text-rose-400" : "text-muted-foreground"}`} dir="ltr">
          {change > 0 ? "+" : ""}{change.toFixed(2)}%
        </span>
        <span className="text-[10px] text-muted-foreground">{sector.stocks} מניות</span>
      </div>
      <div className="mt-1 text-[10px] text-muted-foreground/70">
        {sector.advances} עולות · {sector.declines} יורדות
      </div>
    </div>
  );
}

export function MarketHeatmap() {
  const { data, isLoading, isFetching, isError, refetch } = useGetMarketHeatmap(
    { limit: 500 },
    {
      query: {
        queryKey: getGetMarketHeatmapQueryKey({ limit: 500 }),
        staleTime: 5 * 60 * 1000,
        refetchOnMount: "always",
      },
    },
  );

  const items = useMemo(
    () => [...(data?.items ?? [])].sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0)).slice(0, 180),
    [data],
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 12 }).map((_, index) => <Skeleton key={index} className="h-16 rounded-lg" />)}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          {Array.from({ length: 24 }).map((_, index) => <Skeleton key={index} className="h-20 rounded-lg" />)}
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <Card className="border-destructive/40 bg-destructive/5">
        <CardContent className="flex items-center justify-between gap-3 py-6">
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" />
            נתוני מפת החום של TradingView אינם זמינים כרגע.
          </div>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            <RefreshCw className="ml-1.5 h-3.5 w-3.5" />
            נסה שוב
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <Card className="border-t-2 border-t-primary bg-card/60">
        <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Grid2X2 className="h-4 w-4 text-primary" />
              מפת חום של מניות ארה״ב
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              גודל התא משקף שווי שוק, הצבע משקף שינוי יומי. מוצגות {data.scannedCount} מניות מתוך {data.totalMarketSymbols.toLocaleString("en-US")} שנסרקו.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching} className="shrink-0">
            <RefreshCw className={`ml-1.5 h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            {isFetching ? "מרענן..." : "רענן"}
          </Button>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/50 pt-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1"><Clock3 className="h-3 w-3" /> עודכן: {formatTime(data.fetchedAt)}</span>
          <span>מקור: {data.source}</span>
          <span className="text-muted-foreground/70">רענון אוטומטי אינו תכוף יותר מפעם ב־5 דקות; רענון ידני זמין כאן.</span>
        </CardContent>
      </Card>

      <div>
        <div className="mb-2 text-xs font-semibold text-muted-foreground">תמונת מצב לפי סקטור</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {data.sectors.slice(0, 15).map((sector) => <SectorSummary key={sector.sector} sector={sector} />)}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-xs font-semibold text-muted-foreground">מניות מובילות לפי שווי שוק</div>
          <div className="text-[10px] text-muted-foreground/60">ירוק = עלייה · אדום = ירידה · עוצמת הצבע = גודל השינוי</div>
        </div>
        <div className="grid auto-rows-[72px] grid-cols-2 gap-1.5 sm:grid-cols-4 md:grid-cols-8 lg:grid-cols-12">
          {items.map((item) => <HeatmapTile key={`${item.exchange ?? "US"}:${item.ticker}`} item={item} />)}
        </div>
      </div>
    </div>
  );
}