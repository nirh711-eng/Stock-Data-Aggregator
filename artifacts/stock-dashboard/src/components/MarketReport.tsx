import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetMarketDailyReport,
  getGetMarketDailyReportQueryKey,
} from "@workspace/api-client-react";
import {
  BarChart3,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  DollarSign,
  Zap,
  Eye,
  Lightbulb,
  Globe,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export function MarketReport() {
  const queryClient = useQueryClient();
  const [isRequested, setIsRequested] = useState(false);

  const { data, isLoading, isFetching } = useGetMarketDailyReport({
    query: {
      enabled: isRequested,
      queryKey: getGetMarketDailyReportQueryKey(),
      staleTime: 5 * 60 * 1000,
    },
  });

  const handleLoad = () => setIsRequested(true);
  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: getGetMarketDailyReportQueryKey() });
  };

  const pctColor = (v: number | null | undefined) => {
    if (v == null) return "text-muted-foreground";
    return v > 0 ? "text-green-400" : v < 0 ? "text-red-400" : "text-muted-foreground";
  };

  const pctStr = (v: number | null | undefined) => {
    if (v == null) return "N/A";
    return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
  };

  const PctIcon = ({ v }: { v: number | null | undefined }) => {
    if (v == null) return <Minus className="w-3 h-3 text-muted-foreground" />;
    return v > 0.3
      ? <ArrowUpRight className="w-3 h-3 text-green-400" />
      : v < -0.3
        ? <ArrowDownRight className="w-3 h-3 text-red-400" />
        : <Minus className="w-3 h-3 text-muted-foreground" />;
  };

  // ── Landing state ─────────────────────────────────────────────────────────
  if (!isRequested) {
    return (
      <div className="flex flex-col items-center justify-center p-12 bg-card border border-border rounded-xl text-center space-y-6 shadow-sm" dir="rtl">
        <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center text-primary">
          <Globe className="w-8 h-8" />
        </div>
        <div className="max-w-lg space-y-2">
          <h3 className="text-xl font-bold">סיכום שוק יומי</h3>
          <p className="text-muted-foreground text-sm leading-relaxed">
            תמונת מצב מלאה של השוק — 11 סקטורים בזמן אמת, מדדים ראשיים, VIX, זרימת הון בין הסקטורים וניתוח AI של מה מניע את השוק היום.
          </p>
        </div>
        <Button onClick={handleLoad} size="lg" className="font-semibold px-8">
          צור דוח שוק
        </Button>
        <p className="text-xs text-muted-foreground">הדוח מתעדכן כל 5 דקות</p>
      </div>
    );
  }

  // ── Loading state ─────────────────────────────────────────────────────────
  if (isLoading || (isFetching && !data)) {
    return (
      <div className="mt-4 space-y-4" dir="rtl">
        <div className="flex items-center gap-3 text-primary animate-pulse py-3">
          <Activity className="w-5 h-5" />
          <span className="font-medium">טוען נתוני שוק בזמן אמת...</span>
        </div>
        {[1, 2, 3].map(i => (
          <Card key={i} className="border-border">
            <CardHeader><Skeleton className="h-5 w-1/3" /></CardHeader>
            <CardContent className="space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-4/6" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mt-4 p-6 text-center text-destructive bg-destructive/10 rounded-lg" dir="rtl">
        לא ניתן לטעון את הדוח. נסה שוב.
      </div>
    );
  }

  // Sort sectors: best to worst
  const sorted = [...data.sectorPerformance].sort(
    (a, b) => (b.changePercent ?? -999) - (a.changePercent ?? -999)
  );

  const vixBg = (data.vixLevel ?? 0) > 30
    ? "bg-red-500/10 border-red-500/30 text-red-400"
    : (data.vixLevel ?? 0) > 20
      ? "bg-orange-500/10 border-orange-500/30 text-orange-400"
      : "bg-green-500/10 border-green-500/30 text-green-400";

  const getMarketPostureColor = (posture: string) => {
    const p = posture.toLowerCase();
    if (p.includes("risk-on")) return "text-green-400";
    if (p.includes("risk-off")) return "text-red-400";
    return "text-yellow-400";
  };

  return (
    <div className="space-y-5 mt-4" dir="rtl">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Globe className="w-5 h-5 text-primary" />
            סיכום שוק יומי
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5" dir="ltr">
            {new Date(data.generatedAt).toLocaleString("he-IL")}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isFetching} className="gap-2">
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
          רענן
        </Button>
      </div>

      {/* ── Indices Strip ── */}
      <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-2">
        {data.indices.map(idx => (
          <div key={idx.ticker} className="bg-card border border-border rounded-lg p-2.5 text-center">
            <div className="text-xs text-muted-foreground mb-1 font-mono truncate" dir="ltr">{idx.ticker}</div>
            <div className="text-xs font-medium text-foreground/80 mb-1 truncate">{idx.name}</div>
            <div className={`text-sm font-bold flex items-center justify-center gap-0.5 ${pctColor(idx.changePercent)}`}>
              <PctIcon v={idx.changePercent} />
              {pctStr(idx.changePercent)}
            </div>
            {idx.price != null && (
              <div className="text-xs text-muted-foreground font-mono mt-0.5">
                {idx.ticker === "^VIX" ? idx.price.toFixed(2) : `$${idx.price.toFixed(2)}`}
              </div>
            )}
          </div>
        ))}

        {/* VIX Fear badge */}
        {data.fearLabel && (
          <div className={`border rounded-lg p-2.5 text-center flex flex-col items-center justify-center ${vixBg}`}>
            <div className="text-xs font-bold uppercase tracking-wide mb-1">Fear Gauge</div>
            <div className="text-xs font-medium">{data.fearLabel}</div>
          </div>
        )}
      </div>

      {/* ── AI Market Pulse ── */}
      <Card className="border-t-[3px] border-t-primary bg-card/50 shadow-md">
        <CardHeader className="pb-3 border-b border-border/50 bg-muted/20">
          <CardTitle className="text-sm flex items-center gap-2 text-primary">
            <Zap className="w-4 h-4" />
            <span>Macro Pulse — ניתוח AI של מצב השוק</span>
            <Badge className={`mr-auto text-xs py-0.5 ${getMarketPostureColor(data.marketPulse.marketPosture) === "text-green-400" ? "bg-green-500/20 text-green-400 border-green-500/30" : getMarketPostureColor(data.marketPulse.marketPosture) === "text-red-400" ? "bg-red-500/20 text-red-400 border-red-500/30" : "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"}`}>
              {data.marketPulse.marketPosture.split("—")[0].trim()}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 grid grid-cols-1 md:grid-cols-2 gap-x-8 divide-y divide-border/30 md:divide-y-0">
          <div className="divide-y divide-border/30">
            <div className="py-3">
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1.5 font-medium">עמדת שוק (Risk-On / Risk-Off)</div>
              <p className={`text-sm leading-relaxed font-medium ${getMarketPostureColor(data.marketPulse.marketPosture)}`}>{data.marketPulse.marketPosture}</p>
            </div>
            <div className="py-3">
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1.5 font-medium">רוטציה בין סקטורים</div>
              <p className="text-sm leading-relaxed text-foreground">{data.marketPulse.sectorRotation}</p>
            </div>
            <div className="py-3">
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1.5 font-medium">השפעת מאקרו</div>
              <p className="text-sm leading-relaxed text-foreground">{data.marketPulse.macroImpact}</p>
            </div>
          </div>
          <div className="divide-y divide-border/30 md:border-r md:border-border/30 md:pr-8">
            <div className="py-3">
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1.5 font-medium flex items-center gap-1">
                <DollarSign className="w-3 h-3" /> זרימת הון
              </div>
              <p className="text-sm leading-relaxed text-foreground">{data.marketPulse.capitalFlow}</p>
            </div>
            <div className="py-3">
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1.5 font-medium flex items-center gap-1">
                <Eye className="w-3 h-3" /> נושאים מרכזיים
              </div>
              <p className="text-sm leading-relaxed text-foreground">{data.marketPulse.keyThemes}</p>
            </div>
            <div className="py-3">
              <div className="text-xs text-orange-400 uppercase tracking-wide mb-1.5 font-medium flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> סיכונים מיידיים
              </div>
              <p className="text-sm leading-relaxed text-orange-300/90">{data.marketPulse.risks}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Sector Heatmap ── */}
      <Card className="border-t-[3px] border-t-blue-500 bg-card/50 shadow-md">
        <CardHeader className="pb-3 border-b border-border/50 bg-muted/20">
          <CardTitle className="text-sm flex items-center gap-2 text-blue-400">
            <BarChart3 className="w-4 h-4" />
            <span>ביצועי סקטורים — 11 ETFs בזמן אמת</span>
            <span className="mr-auto text-xs text-muted-foreground font-normal">ממוין מהטוב לגרוע</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 gap-2">
            {sorted.map(sector => {
              const cp = sector.changePercent ?? 0;
              const isPos = cp > 0;
              const barPct = Math.min(Math.abs(cp) * 15, 100);
              const rvStr = sector.relativeVolume != null
                ? sector.relativeVolume > 1.5 ? `${sector.relativeVolume.toFixed(1)}x 🔥` : `${sector.relativeVolume.toFixed(1)}x`
                : "N/A";
              const fromHigh = sector.fiftyTwoWeekHigh && sector.price
                ? ((sector.price / sector.fiftyTwoWeekHigh - 1) * 100).toFixed(0) + "% מהשיא"
                : null;

              return (
                <div key={sector.ticker} className="flex items-center gap-3 group hover:bg-muted/10 rounded-lg px-2 py-1.5 transition-colors">
                  {/* Ticker + Name */}
                  <div className="w-28 shrink-0">
                    <div className="text-xs font-mono text-muted-foreground" dir="ltr">{sector.ticker}</div>
                    <div className="text-xs font-medium text-foreground truncate">{sector.name}</div>
                  </div>

                  {/* Bar */}
                  <div className="flex-1 relative h-5 bg-muted/20 rounded overflow-hidden">
                    <div
                      className={`absolute top-0 bottom-0 rounded transition-all ${isPos ? "bg-green-500/40 right-1/2" : "bg-red-500/40 left-1/2"}`}
                      style={{ width: `${barPct * 0.5}%` }}
                    />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className={`text-xs font-bold ${pctColor(sector.changePercent)}`}>
                        {pctStr(sector.changePercent)}
                      </span>
                    </div>
                  </div>

                  {/* Price */}
                  <div className="w-16 text-right shrink-0">
                    <div className="text-xs font-mono font-medium" dir="ltr">
                      ${sector.price?.toFixed(2) ?? "—"}
                    </div>
                    {fromHigh && <div className="text-xs text-muted-foreground/60">{fromHigh}</div>}
                  </div>

                  {/* Relative Volume */}
                  <div className="w-14 text-right shrink-0">
                    <div className={`text-xs font-medium ${sector.relativeVolume != null && sector.relativeVolume > 1.5 ? "text-yellow-400" : "text-muted-foreground"}`}>
                      {rvStr}
                    </div>
                    <div className="text-xs text-muted-foreground/50">נפח</div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border/30 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 bg-green-500/40 rounded" /> עלייה
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 bg-red-500/40 rounded" /> ירידה
            </div>
            <div className="flex items-center gap-1">
              🔥 נפח גבוה מהרגיל (≥1.5x)
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Sector Winners & Losers + Actionable ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="border-t-[3px] border-t-emerald-500 bg-card/50 shadow-sm">
          <CardHeader className="pb-2 border-b border-border/50 bg-muted/20">
            <CardTitle className="text-sm flex items-center gap-2 text-emerald-400">
              <TrendingUp className="w-4 h-4" />
              מובילים — כסף נכנס
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-3 text-sm text-foreground/90 leading-relaxed">
            {data.marketPulse.topSectors}
          </CardContent>
        </Card>

        <Card className="border-t-[3px] border-t-rose-500 bg-card/50 shadow-sm">
          <CardHeader className="pb-2 border-b border-border/50 bg-muted/20">
            <CardTitle className="text-sm flex items-center gap-2 text-rose-400">
              <TrendingDown className="w-4 h-4" />
              פגועים — כסף יוצא
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-3 text-sm text-foreground/90 leading-relaxed">
            {data.marketPulse.weakSectors}
          </CardContent>
        </Card>
      </div>

      {/* ── Actionable Insights ── */}
      <Card className="border-[2px] border-primary/30 bg-card shadow-md">
        <CardHeader className="pb-3 border-b border-border/50 bg-muted/20">
          <CardTitle className="text-sm flex items-center gap-2 text-primary">
            <Lightbulb className="w-4 h-4" />
            רעיונות לפעולה — ETF/Long/Short/Pair
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="bg-primary/10 border border-primary/20 rounded-xl p-4 text-sm text-foreground leading-relaxed">
            {data.marketPulse.actionableInsights}
          </div>
        </CardContent>
      </Card>

      <div className="text-center text-xs text-muted-foreground font-mono pb-2" dir="ltr">
        Market data · Generated: {new Date(data.generatedAt).toLocaleString()} · Cached 5 min
      </div>
    </div>
  );
}
