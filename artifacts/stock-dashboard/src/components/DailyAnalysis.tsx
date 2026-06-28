import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Zap,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Minus,
  BarChart2,
  Users,
  Newspaper,
  Lightbulb,
  Activity,
  ExternalLink,
  MessageSquare,
} from "lucide-react";
import {
  useGetStockDailyAnalysis,
  getGetStockDailyAnalysisQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

interface DailyAnalysisProps {
  ticker: string;
}

function VolumeBar({ ratio }: { ratio: number | null | undefined }) {
  if (ratio == null) return <span className="text-muted-foreground">N/A</span>;
  const pct = Math.min(ratio * 100, 200);
  const color = ratio > 1.5 ? "bg-orange-500" : ratio > 1.0 ? "bg-yellow-500" : "bg-emerald-500/60";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-muted/40 rounded-full overflow-hidden max-w-[120px]">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className={`text-xs font-mono ${ratio > 1.5 ? "text-orange-400" : ratio > 1.0 ? "text-yellow-400" : "text-muted-foreground"}`}>
        {(ratio * 100).toFixed(0)}%
      </span>
    </div>
  );
}

function PriceRangeBar({ position }: { position: number | null | undefined }) {
  if (position == null) return <span className="text-muted-foreground text-xs">N/A</span>;
  const pct = Math.max(0, Math.min(position * 100, 100));
  const label = pct > 65 ? "לחץ קנייה" : pct < 35 ? "לחץ מכירה" : "מאוזן";
  const color = pct > 65 ? "text-green-400" : pct < 35 ? "text-red-400" : "text-yellow-400";
  return (
    <div className="space-y-1">
      <div className="relative h-2 bg-gradient-to-r from-red-500/40 via-yellow-500/40 to-green-500/40 rounded-full">
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white border-2 border-primary shadow-md transition-all"
          style={{ left: `calc(${pct}% - 6px)` }}
        />
      </div>
      <div className={`text-[11px] font-medium ${color}`}>{label} ({pct.toFixed(0)}%)</div>
    </div>
  );
}

export function DailyAnalysis({ ticker }: DailyAnalysisProps) {
  const queryClient = useQueryClient();
  const [isRequested, setIsRequested] = useState(false);

  const { data, isLoading, isFetching } = useGetStockDailyAnalysis(ticker, {
    query: {
      enabled: !!ticker && isRequested,
      queryKey: getGetStockDailyAnalysisQueryKey(ticker),
    },
  });

  const handleLoad = () => setIsRequested(true);
  const handleRegenerate = () => {
    queryClient.invalidateQueries({ queryKey: getGetStockDailyAnalysisQueryKey(ticker) });
  };

  if (!isRequested) {
    return (
      <div
        onClick={handleLoad}
        className="cursor-pointer flex items-center gap-3 px-4 py-3 rounded-lg border border-border/60 bg-card/60 hover:bg-card hover:border-yellow-500/40 transition-all group"
      >
        <div className="p-1.5 rounded-md bg-yellow-500/10 text-yellow-400 group-hover:bg-yellow-500/20 transition-colors">
          <Zap className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-yellow-400">ניתוח יומי</div>
          <div className="text-xs text-muted-foreground">לחץ לניתוח מה מזיז את המניה היום</div>
        </div>
        <div className="text-xs text-muted-foreground/50 group-hover:text-yellow-400/60 transition-colors">~10 שניות</div>
      </div>
    );
  }

  if (isLoading || (isFetching && !data)) {
    return (
      <div className="space-y-3" dir="rtl">
        <div className="flex items-center gap-2 text-yellow-400 animate-pulse py-2">
          <Zap className="w-4 h-4" />
          <span className="text-sm font-medium">מנתח את {ticker} — ניתוח יומי...</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="border-border">
              <CardContent className="pt-4 space-y-2">
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-4 text-center text-destructive bg-destructive/10 rounded-lg text-sm">
        שגיאה בטעינת הניתוח. נסה שוב.
      </div>
    );
  }

  const { dailyMetrics: dm, technicalOutlook: to, recentNews, sigDevs, analystSummary: as_, aiAnalysis } = data;

  const totalAnalysts = as_.strongBuy + as_.buy + as_.hold + as_.sell + as_.strongSell;
  const bullPct = totalAnalysts > 0 ? (((as_.strongBuy + as_.buy) / totalAnalysts) * 100) : 0;
  const recKey = as_.recommendationKey?.toLowerCase() ?? "";
  const RecIcon = recKey.includes("buy") ? TrendingUp : recKey.includes("sell") ? TrendingDown : Minus;
  const recColor = recKey.includes("buy") ? "text-green-400" : recKey.includes("sell") ? "text-red-400" : "text-yellow-400";

  const marketStateLabel: Record<string, string> = {
    REGULAR: "שוק פתוח", PRE: "טרום מסחר", POST: "לאחר מסחר", POSTPOST: "לאחר מסחר", PREPRE: "טרום מסחר", CLOSED: "שוק סגור",
  };

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-yellow-500/10 text-yellow-400">
            <Zap className="w-4 h-4" />
          </div>
          <div>
            <span className="text-base font-bold text-yellow-400">ניתוח יומי</span>
            <span className="text-xs text-muted-foreground mr-2">{data.companyName}</span>
          </div>
          {data.marketState && (
            <Badge variant="outline" className="text-[10px] py-0 border-yellow-500/30 text-yellow-400">
              {marketStateLabel[data.marketState] ?? data.marketState}
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={handleRegenerate} disabled={isFetching} className="gap-1.5 h-7 text-xs">
          <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
          רענן
        </Button>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Volume */}
        <Card className="bg-card/50 border-border/60">
          <CardContent className="pt-3 pb-3">
            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
              <BarChart2 className="w-3 h-3" /> נפח מסחר
            </div>
            <VolumeBar ratio={dm.volumeRatio} />
            <div className="text-[10px] text-muted-foreground mt-1">
              {dm.volume != null ? (dm.volume / 1e6).toFixed(1) + "M" : "N/A"}
              {dm.avgVolume10d != null ? ` / ממוצע ${(dm.avgVolume10d / 1e6).toFixed(1)}M` : ""}
            </div>
          </CardContent>
        </Card>

        {/* Price position */}
        <Card className="bg-card/50 border-border/60">
          <CardContent className="pt-3 pb-3">
            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
              <Activity className="w-3 h-3" /> לחץ קניה/מכירה
            </div>
            <PriceRangeBar position={dm.pricePositionInRange} />
            <div className="text-[10px] text-muted-foreground mt-1">
              {dm.dayLow != null ? `$${dm.dayLow.toFixed(2)}` : ""} – {dm.dayHigh != null ? `$${dm.dayHigh.toFixed(2)}` : ""}
            </div>
          </CardContent>
        </Card>

        {/* Short Interest */}
        <Card className="bg-card/50 border-border/60">
          <CardContent className="pt-3 pb-3">
            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
              פוזיציות שורט
            </div>
            <div className="text-lg font-bold text-foreground">
              {dm.shortPercentOfFloat != null ? (dm.shortPercentOfFloat * 100).toFixed(1) + "%" : "—"}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {dm.shortRatio != null ? `ימים לסגירה: ${dm.shortRatio.toFixed(1)}` : ""}
            </div>
          </CardContent>
        </Card>

        {/* Technical */}
        <Card className="bg-card/50 border-border/60">
          <CardContent className="pt-3 pb-3">
            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
              כיוון טכני
            </div>
            {to ? (
              <>
                <div className={`text-base font-bold ${to.direction.toLowerCase().includes("bull") ? "text-green-400" : to.direction.toLowerCase().includes("bear") ? "text-red-400" : "text-yellow-400"}`}>
                  {to.direction}
                </div>
                <div className="text-[10px] text-muted-foreground leading-tight mt-0.5 line-clamp-2">{to.stateDescription}</div>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">N/A</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* AI Analysis Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card className="border-t-2 border-t-yellow-500/70 bg-card/50">
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-xs font-semibold text-yellow-400 flex items-center gap-1.5 uppercase tracking-wide">
              <Zap className="w-3.5 h-3.5" /> מה מזיז את המניה
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 px-4 pb-3">
            <p className="text-sm leading-relaxed text-foreground">{aiAnalysis.whatsMoving}</p>
          </CardContent>
        </Card>

        <Card className="border-t-2 border-t-blue-500/70 bg-card/50">
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-xs font-semibold text-blue-400 flex items-center gap-1.5 uppercase tracking-wide">
              <Activity className="w-3.5 h-3.5" /> קונים מול מוכרים
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 px-4 pb-3">
            <p className="text-sm leading-relaxed text-foreground">{aiAnalysis.buyerSellerBalance}</p>
          </CardContent>
        </Card>

        <Card className="border-t-2 border-t-emerald-500/70 bg-card/50">
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5 uppercase tracking-wide">
              <Users className="w-3.5 h-3.5" /> ציפיות אנליסטים
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 px-4 pb-3">
            <p className="text-sm leading-relaxed text-foreground">{aiAnalysis.analystView}</p>
            {totalAnalysts > 0 && (
              <div className="mt-2 flex items-center gap-2">
                <RecIcon className={`w-3.5 h-3.5 ${recColor}`} />
                <span className={`text-xs font-semibold ${recColor} uppercase`}>{as_.recommendationKey}</span>
                <span className="text-xs text-muted-foreground">· קנייה {bullPct.toFixed(0)}%</span>
                {as_.targetMeanPrice && (
                  <span className="text-xs text-emerald-400 font-mono">PT ${as_.targetMeanPrice.toFixed(2)}</span>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-t-2 border-t-violet-500/70 bg-card/50">
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-xs font-semibold text-violet-400 flex items-center gap-1.5 uppercase tracking-wide">
              <Lightbulb className="w-3.5 h-3.5" /> מה לעקוב היום
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 px-4 pb-3">
            <p className="text-sm leading-relaxed text-foreground">{aiAnalysis.actionable}</p>
          </CardContent>
        </Card>
      </div>

      {/* News + SigDevs */}
      {(recentNews.length > 0 || sigDevs.length > 0) && (
        <Card className="bg-card/50 border-border/60">
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5 uppercase tracking-wide">
              <Newspaper className="w-3.5 h-3.5" /> חדשות והתפתחויות
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 px-4 pb-3 space-y-1.5">
            {sigDevs.map((s, i) => (
              <div key={i} className="flex items-start gap-2 text-xs py-1 border-b border-border/30 last:border-0">
                <span className="shrink-0 text-orange-400 mt-0.5">⚡</span>
                <span className="text-foreground font-medium">{s.headline}</span>
              </div>
            ))}
            {recentNews.map((n, i) => (
              <div key={i} className="flex items-start gap-2 text-xs py-1 border-b border-border/30 last:border-0">
                <span className="shrink-0 text-muted-foreground/50 mt-0.5">•</span>
                <div className="flex-1 min-w-0">
                  {n.url ? (
                    <a href={n.url} target="_blank" rel="noopener noreferrer" className="text-foreground/80 hover:text-foreground transition-colors flex items-start gap-1 group">
                      <span className="line-clamp-2">{n.title}</span>
                      <ExternalLink className="w-2.5 h-2.5 shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </a>
                  ) : (
                    <span className="text-foreground/80 line-clamp-2">{n.title}</span>
                  )}
                  {n.publisher && <span className="text-muted-foreground/60 mt-0.5 block">{n.publisher}</span>}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Reddit Social Pulse */}
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      {(data as any).redditData && (data as any).redditData.posts?.length > 0 && (() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rd = (data as any).redditData;
        return (
          <Card className="bg-card/50 border-orange-400/30 border-t-2 border-t-orange-400">
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-xs font-semibold text-orange-300 flex items-center gap-1.5 uppercase tracking-wide">
                <MessageSquare className="w-3.5 h-3.5" /> פולס Reddit
                <Badge variant="outline" className={`mr-auto text-[10px] py-0 px-1.5 font-bold border ${
                  rd.sentimentLabel === "שורי"
                    ? "border-emerald-500/50 text-emerald-400 bg-emerald-500/10"
                    : rd.sentimentLabel === "דובי"
                    ? "border-red-500/50 text-red-400 bg-red-500/10"
                    : "border-yellow-500/50 text-yellow-400 bg-yellow-500/10"
                }`}>
                  {rd.sentimentLabel}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 px-4 pb-3">
              <div className="flex items-center gap-3 text-xs mb-2 text-muted-foreground">
                <span className="text-emerald-400 font-semibold">🟢 {rd.bullishCount} שורי</span>
                <span className="text-red-400 font-semibold">🔴 {rd.bearishCount} דובי</span>
                <span>⚪ {rd.neutralCount} נייטרלי</span>
                <span className="mr-auto opacity-60">{rd.totalMentions} פוסטים</span>
              </div>
              <div className="space-y-1.5">
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {rd.posts.slice(0, 4).map((post: any, i: number) => (
                  <div key={i} className="flex items-start gap-2 text-xs py-1 border-b border-border/20 last:border-0">
                    <span className="shrink-0 mt-0.5">
                      {post.sentiment === "bullish" ? "🟢" : post.sentiment === "bearish" ? "🔴" : "⚪"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <a href={post.permalink} target="_blank" rel="noopener noreferrer"
                        className="text-foreground/80 hover:text-foreground transition-colors flex items-start gap-1 group">
                        <span className="line-clamp-1">{post.title}</span>
                        <ExternalLink className="w-2.5 h-2.5 shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </a>
                      <div className="flex items-center gap-1.5 mt-0.5 text-muted-foreground/60">
                        <span className="text-orange-400/70">{post.subreddit}</span>
                        {post.score > 0 && <span>⬆{post.score}</span>}
                        {post.numComments > 0 && <span>💬{post.numComments}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      <div className="text-[10px] text-muted-foreground/40 text-left" dir="ltr">
        {new Date(data.generatedAt).toLocaleTimeString("he-IL")} · Yahoo Finance + AI
      </div>
    </div>
  );
}
