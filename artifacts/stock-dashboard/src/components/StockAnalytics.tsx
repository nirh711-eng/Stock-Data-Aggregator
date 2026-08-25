import React from "react";
import {
  getGetStockAnalyticsQueryKey,
  useGetStockAnalytics,
  type PricePoint,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Activity,
  CalendarDays,
  Clock,
  Info,
  Minus,
  PieChart,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

export interface StockAnalyticsPanelProps {
  ticker: string;
}

const formatLargeNumber = (num: number | null | undefined): string => {
  if (num == null) return "—";
  
  const absNum = Math.abs(num);
  const sign = num < 0 ? "-" : "";
  
  if (absNum >= 1e9) return `${sign}${(absNum / 1e9).toFixed(2)}B`;
  if (absNum >= 1e6) return `${sign}${(absNum / 1e6).toFixed(2)}M`;
  if (absNum >= 1e3) return `${sign}${(absNum / 1e3).toFixed(2)}K`;
  
  return `${sign}${absNum.toFixed(2)}`;
};

const renderReturn = (val: number | null | undefined) => {
  if (val == null) return "—";
  const isPositive = val > 0;
  const isNegative = val < 0;
  const sign = isPositive ? "+" : "";
  const colorClass = isPositive ? "text-emerald-500" : isNegative ? "text-rose-500" : "text-muted-foreground";
  const Icon = isPositive ? TrendingUp : isNegative ? TrendingDown : Minus;
  
  return (
    <div dir="ltr" className={`flex items-center gap-1.5 ${colorClass}`}>
      <span className="font-mono font-medium">{sign}{val.toFixed(2)}%</span>
      <Icon className="w-3.5 h-3.5" />
    </div>
  );
};

const formatDate = (dateStr: string) => {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const day = d.getDate().toString().padStart(2, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const year = d.getFullYear().toString().slice(-2);
  return `${day}/${month}/${year}`;
};

function DataRow({ label, value, highlight }: { label: string; value: React.ReactNode, highlight?: boolean }) {
  return (
    <div className="flex justify-between items-center py-2.5 border-b border-border/50 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div dir="ltr" className={`text-sm ${highlight ? 'font-semibold text-foreground' : 'text-foreground font-mono'}`}>
        {value}
      </div>
    </div>
  )
}

function CandleGlyph({ candle, label, emphasis = false }: { candle: PricePoint; label: string; emphasis?: boolean }) {
  const open = candle.open ?? candle.close;
  const high = candle.high ?? Math.max(open, candle.close);
  const low = candle.low ?? Math.min(open, candle.close);
  const range = Math.max(high - low, 0.0001);
  const top = (value: number) => ((high - value) / range) * 100;
  const bullish = candle.close >= open;
  const bodyTop = top(Math.max(open, candle.close));
  const bodyHeight = Math.max((Math.abs(candle.close - open) / range) * 100, 5);
  const candleColor = bullish ? "bg-emerald-500 border-emerald-400" : "bg-rose-500 border-rose-400";

  return (
    <div className={`flex flex-col items-center gap-1 min-w-0 ${emphasis ? "w-16" : "w-10"}`} dir="ltr">
      <div className={`${emphasis ? "h-28" : "h-20"} relative w-full`}>
        <span className={`absolute left-1/2 top-0 bottom-0 w-px -translate-x-1/2 ${bullish ? "bg-emerald-400/80" : "bg-rose-400/80"}`} />
        <span
          className={`absolute left-1/2 w-4 -translate-x-1/2 border ${candleColor} ${emphasis ? "w-6" : ""}`}
          style={{ top: `${bodyTop}%`, height: `${bodyHeight}%` }}
        />
      </div>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}

function weekdayLabel(dateStr: string) {
  return new Intl.DateTimeFormat("he-IL", { weekday: "short", timeZone: "UTC" })
    .format(new Date(`${dateStr}T12:00:00.000Z`))
    .replace(".", "");
}

export function StockAnalyticsPanel({ ticker }: StockAnalyticsPanelProps) {
  const { data, isLoading, isError } = useGetStockAnalytics(ticker, {
    query: {
      enabled: !!ticker,
      staleTime: 60000,
      queryKey: getGetStockAnalyticsQueryKey(ticker),
    }
  });

  if (isLoading) {
    return (
      <Card className="bg-card border-border">
        <CardHeader className="pb-3 border-b border-border mb-4">
          <div className="flex items-center gap-2">
            <Skeleton className="h-6 w-6 rounded-full" />
            <Skeleton className="h-6 w-48" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="space-y-4">
              <Skeleton className="h-5 w-32 mb-6" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
            <div className="space-y-4">
              <Skeleton className="h-5 w-32 mb-6" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
            <div className="space-y-4">
              <Skeleton className="h-5 w-32 mb-6" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Card className="bg-card border-border">
        <CardHeader className="pb-3 border-b border-border mb-4">
          <CardTitle className="text-lg font-medium flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            ניתוח מתקדם
            <span dir="ltr" className="text-muted-foreground text-sm font-mono mr-auto">{ticker}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="py-12 text-center text-muted-foreground flex flex-col items-center gap-3 bg-muted/20 rounded-lg">
            <Info className="w-8 h-8 opacity-20" />
            <span>לא ניתן לטעון נתוני ניתוח עבור <span dir="ltr" className="font-mono">{ticker}</span> כרגע.</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card border-border shadow-sm">
      <CardHeader className="pb-3 border-b border-border mb-4 bg-muted/10">
        <CardTitle className="text-lg font-medium flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary" />
          ניתוח מתקדם
          <span dir="ltr" className="text-muted-foreground text-sm font-mono mr-auto bg-background px-2 py-0.5 rounded border border-border">
            {data.ticker}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-10">
          
          <div className="space-y-1">
            <h3 className="text-base font-semibold flex items-center gap-2 mb-4 pb-2 border-b border-border/50 text-foreground">
              <PieChart className="w-4 h-4 text-blue-400" />
              נתוני יסוד
            </h3>
            <DataRow label="SHORT FLOAT" value={data.fundamentals.shortFloat != null ? `${(data.fundamentals.shortFloat * 100).toFixed(2)}%` : "—"} />
            <DataRow label="OPERATING CASH FLOW" value={formatLargeNumber(data.fundamentals.operatingCashFlow)} />
            <DataRow label="FREE CASH FLOW" value={formatLargeNumber(data.fundamentals.freeCashFlow)} />
            <DataRow label="P/E" value={data.fundamentals.trailingPE != null ? data.fundamentals.trailingPE.toFixed(2) : "—"} />
            <DataRow label="FORWARD P/E" value={data.fundamentals.forwardPE != null ? data.fundamentals.forwardPE.toFixed(2) : "—"} />
            <DataRow label="52W HIGH" value={data.fundamentals.fiftyTwoWeekHigh != null ? `$${data.fundamentals.fiftyTwoWeekHigh.toFixed(2)}` : "—"} />
            <DataRow label="52W LOW" value={data.fundamentals.fiftyTwoWeekLow != null ? `$${data.fundamentals.fiftyTwoWeekLow.toFixed(2)}` : "—"} />
          </div>

          <div className="space-y-1">
            <h3 className="text-base font-semibold flex items-center gap-2 mb-4 pb-2 border-b border-border/50 text-foreground">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              תשואות מחיר
            </h3>
            <DataRow label="יומי (1D)" value={renderReturn(data.returns.day)} />
            <DataRow label="שבועי (1W)" value={renderReturn(data.returns.week)} />
            <DataRow label="חודשי (1M)" value={renderReturn(data.returns.month)} />
            <DataRow label="מתחילת השנה (YTD)" value={renderReturn(data.returns.ytd)} />
            <DataRow label="שנתי (1Y)" value={renderReturn(data.returns.year)} />
          </div>
        </div>

        <section className="mt-9 border-t border-border/50 pt-6">
          <h3 className="text-base font-semibold flex items-center gap-2 mb-5 text-foreground">
            <CalendarDays className="w-4 h-4 text-orange-400" />
            השבוע המלא האחרון
          </h3>
          {data.latestCompletedWeek ? (
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_minmax(10rem,0.6fr)] gap-5">
              <div className="rounded-lg border border-border/60 bg-muted/10 px-4 py-2">
                <DataRow label="תאריכים" value={`${formatDate(data.latestCompletedWeek.weekStart)}–${formatDate(data.latestCompletedWeek.weekEnd)}`} />
                <DataRow label="פתיחה" value={`$${data.latestCompletedWeek.weeklyCandle.open?.toFixed(2) ?? "—"}`} />
                <DataRow label="גבוה" value={`$${data.latestCompletedWeek.weeklyCandle.high?.toFixed(2) ?? "—"}`} />
                <DataRow label="נמוך" value={`$${data.latestCompletedWeek.weeklyCandle.low?.toFixed(2) ?? "—"}`} />
                <DataRow label="סגירה" value={`$${data.latestCompletedWeek.weeklyCandle.close.toFixed(2)}`} highlight />
                <DataRow label="נפח ממוצע יומי" value={formatLargeNumber(data.latestCompletedWeek.averageDailyVolume)} />
                <DataRow label="נפח שבועי" value={formatLargeNumber(data.latestCompletedWeek.totalVolume)} />
              </div>

              <div className="rounded-lg border border-border/60 bg-background/40 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">נרות יומיים</span>
                  <span className="text-xs text-muted-foreground" dir="ltr">{data.latestCompletedWeek.dailyCandles.length} sessions</span>
                </div>
                <div className="flex min-h-28 items-end justify-around gap-2" dir="ltr">
                  {data.latestCompletedWeek.dailyCandles.map((candle) => (
                    <CandleGlyph key={candle.date} candle={candle} label={weekdayLabel(candle.date)} />
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-orange-400/20 bg-orange-400/[0.04] p-4 flex flex-col">
                <span className="text-sm font-medium">נר שבועי</span>
                <div className="flex flex-1 items-center justify-center py-3">
                  <CandleGlyph candle={data.latestCompletedWeek.weeklyCandle} label="1W" emphasis />
                </div>
                <div className="rounded-md border border-orange-400/20 bg-orange-400/10 px-2 py-1.5 text-center text-xs font-medium text-orange-400">
                  {data.latestCompletedWeek.candlePattern}
                </div>
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground flex flex-col items-center justify-center gap-3 bg-muted/10 rounded-lg border border-border/50 border-dashed">
              <Clock className="w-6 h-6 opacity-30" />
              אין עדיין שבוע מסחר מלא להצגה עבור מניה זו.
            </div>
          )}
        </section>

        <div className="text-[11px] text-muted-foreground/60 flex items-center gap-1.5 mt-8 pt-4 border-t border-border/50">
          <Clock className="w-3.5 h-3.5" />
          עודכן לאחרונה: <span dir="ltr" className="font-mono">{new Date(data.fetchedAt).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "medium" })}</span>
        </div>
      </CardContent>
    </Card>
  );
}
