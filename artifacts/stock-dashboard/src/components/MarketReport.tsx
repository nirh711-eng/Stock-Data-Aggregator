import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetMarketDailyReport,
  getGetMarketDailyReportQueryKey,
} from "@workspace/api-client-react";
type IndexItem = { ticker: string; name: string; price?: number | null; changePercent?: number | null; change?: number | null; preMarketPrice?: number | null; preMarketChangePercent?: number | null; postMarketPrice?: number | null; postMarketChangePercent?: number | null; marketState?: string | null };
type FuturesItem = { ticker: string; name: string; price?: number | null; changePercent?: number | null; preMarketChangePercent?: number | null; marketState?: string | null };
type InternationalItem = { ticker: string; name: string; price?: number | null; changePercent?: number | null; marketState?: string | null };
type CurrencyItem = { ticker: string; name: string; price?: number | null; changePercent?: number | null; preMarketChangePercent?: number | null };
type EconomicEvent = { event: string; country: string; impact?: string | null; actual?: string | null; estimate?: string | null; previous?: string | null; time?: string | null };
type SectorPerformanceItem = { ticker: string; name: string; price?: number | null; changePercent?: number | null; preMarketChangePercent?: number | null; postMarketChangePercent?: number | null; relativeVolume?: number | null; fiftyTwoWeekHigh?: number | null; marketState?: string | null };
import {
  BarChart3, RefreshCw, TrendingUp, TrendingDown, Minus, AlertTriangle,
  DollarSign, Zap, Eye, Lightbulb, Globe, Activity, ArrowUpRight,
  ArrowDownRight, Clock, Calendar, Layers, Banknote, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

// ── helpers ───────────────────────────────────────────────────────────────
const pctStr = (v: number | null | undefined, decimals = 2) => {
  if (v == null) return null;
  return `${v >= 0 ? "+" : ""}${v.toFixed(decimals)}%`;
};

const pctColor = (v: number | null | undefined) => {
  if (v == null) return "text-muted-foreground";
  return v > 0 ? "text-green-400" : v < 0 ? "text-red-400" : "text-muted-foreground";
};

const PctBadge = ({ v, label }: { v: number | null | undefined; label?: string }) => {
  const s = pctStr(v);
  if (!s) return null;
  const col = v! > 0 ? "bg-green-500/15 text-green-400 border-green-500/30"
    : v! < 0 ? "bg-red-500/15 text-red-400 border-red-500/30"
      : "bg-muted/30 text-muted-foreground";
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-mono px-1.5 py-0.5 rounded border ${col}`}>
      {v! > 0.15 ? <ArrowUpRight className="w-2.5 h-2.5" /> : v! < -0.15 ? <ArrowDownRight className="w-2.5 h-2.5" /> : <Minus className="w-2.5 h-2.5" />}
      {s}{label && <span className="opacity-60 ml-0.5">{label}</span>}
    </span>
  );
};

const MARKET_STATE_META: Record<string, { label: string; color: string; bg: string }> = {
  PRE:     { label: "Pre-Market",   color: "text-yellow-400", bg: "bg-yellow-500/10 border-yellow-500/30" },
  REGULAR: { label: "מסחר פעיל",   color: "text-green-400",  bg: "bg-green-500/10 border-green-500/30" },
  POST:    { label: "After-Hours",  color: "text-blue-400",   bg: "bg-blue-500/10 border-blue-500/30" },
  CLOSED:  { label: "שוק סגור",    color: "text-muted-foreground", bg: "bg-muted/20 border-border" },
};

const impactColor = (impact: string | null | undefined) => {
  if (!impact) return "text-muted-foreground";
  const l = impact.toLowerCase();
  if (l === "high") return "text-red-400";
  if (l === "medium") return "text-yellow-400";
  return "text-muted-foreground";
};

// ── sub-components ────────────────────────────────────────────────────────

function IndexCard({ idx }: { idx: IndexItem }) {
  const isVix = idx.ticker === "^VIX";
  const ext = idx.preMarketChangePercent ?? idx.postMarketChangePercent;
  const extLabel = idx.preMarketChangePercent != null ? "pre" : idx.postMarketChangePercent != null ? "aft" : null;

  return (
    <div className="bg-card border border-border rounded-lg p-2.5 flex flex-col gap-1 min-w-0">
      <div className="flex items-center justify-between gap-1">
        <span className="text-xs font-mono text-muted-foreground truncate" dir="ltr">{idx.ticker}</span>
        {idx.marketState && MARKET_STATE_META[idx.marketState] && (
          <span className={`text-[9px] px-1 rounded ${MARKET_STATE_META[idx.marketState].color}`}>
            {MARKET_STATE_META[idx.marketState].label}
          </span>
        )}
      </div>
      <div className="text-xs font-medium text-foreground/80 truncate">{idx.name}</div>
      <div className="flex items-center gap-1 flex-wrap">
        <PctBadge v={idx.changePercent} />
        {ext != null && extLabel && <PctBadge v={ext} label={extLabel} />}
      </div>
      <div className="text-xs font-mono text-muted-foreground">
        {isVix ? idx.price?.toFixed(2) : idx.price != null ? `$${idx.price.toFixed(2)}` : "—"}
      </div>
    </div>
  );
}

function FuturesRow({ f }: { f: FuturesItem }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/20 last:border-0 gap-2">
      <div className="min-w-0">
        <div className="text-xs font-mono text-muted-foreground" dir="ltr">{f.ticker}</div>
        <div className="text-xs text-foreground/80">{f.name}</div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-xs font-mono text-muted-foreground">{f.price != null ? `$${f.price.toFixed(2)}` : "—"}</span>
        <PctBadge v={f.changePercent} />
      </div>
    </div>
  );
}

function IntlRow({ i }: { i: InternationalItem }) {
  const isOpen = i.marketState === "REGULAR";
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/20 last:border-0 gap-2">
      <div className="flex items-center gap-1.5 min-w-0">
        {isOpen && <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0 animate-pulse" />}
        <div>
          <div className="text-xs font-mono text-muted-foreground" dir="ltr">{i.ticker}</div>
          <div className="text-xs text-foreground/80">{i.name}</div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-xs font-mono text-muted-foreground">{i.price != null ? i.price.toFixed(0) : "—"}</span>
        <PctBadge v={i.changePercent} />
      </div>
    </div>
  );
}

function CurrencyRow({ c }: { c: CurrencyItem }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/20 last:border-0 gap-2">
      <div className="text-xs font-medium text-foreground/80">{c.name}</div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-xs font-mono text-muted-foreground">{c.price?.toFixed(4) ?? "—"}</span>
        <PctBadge v={c.changePercent} />
      </div>
    </div>
  );
}

function EventRow({ e }: { e: EconomicEvent }) {
  const timeStr = e.time ? new Date(e.time).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" }) : null;
  return (
    <div className="flex items-start gap-2 py-2 border-b border-border/20 last:border-0">
      <div className="shrink-0 mt-0.5">
        <span className={`text-[10px] font-bold uppercase ${impactColor(e.impact)}`}>
          {e.impact?.charAt(0).toUpperCase() ?? "?"}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-foreground/90 font-medium leading-tight">{e.event}</div>
        <div className="text-[10px] text-muted-foreground mt-0.5 flex gap-2 flex-wrap">
          {timeStr && <span>{timeStr}</span>}
          {e.estimate && <span>צפוי: {e.estimate}</span>}
          {e.actual && <span className="text-green-400">פועלי: {e.actual}</span>}
          {e.previous && <span>קודם: {e.previous}</span>}
        </div>
      </div>
    </div>
  );
}

function SectorHeatmap({ sectors }: { sectors: SectorPerformanceItem[] }) {
  const sorted = [...sectors].sort((a, b) => (b.changePercent ?? -999) - (a.changePercent ?? -999));
  return (
    <div className="space-y-1">
      {sorted.map(s => {
        const cp = s.changePercent ?? 0;
        const isPos = cp >= 0;
        const barWidth = Math.min(Math.abs(cp) * 14, 50);
        const rv = s.relativeVolume;
        const ext = s.preMarketChangePercent ?? s.postMarketChangePercent;
        const extLabel = s.preMarketChangePercent != null ? "pre" : s.postMarketChangePercent != null ? "aft" : null;
        const fromHigh = s.fiftyTwoWeekHigh && s.price && s.fiftyTwoWeekHigh > 0
          ? ((s.price / s.fiftyTwoWeekHigh - 1) * 100) : null;

        return (
          <div key={s.ticker} className="flex items-center gap-2 group hover:bg-muted/10 rounded px-2 py-1 transition-colors">
            <div className="w-28 shrink-0">
              <div className="text-xs font-mono text-muted-foreground leading-none" dir="ltr">{s.ticker}</div>
              <div className="text-xs text-foreground/80 truncate">{s.name}</div>
            </div>

            <div className="flex-1 relative h-5 bg-muted/20 rounded overflow-hidden">
              <div
                className={`absolute top-0 bottom-0 rounded transition-all ${isPos ? "bg-green-500/35 right-1/2" : "bg-red-500/35 left-1/2"}`}
                style={{ width: `${barWidth}%` }}
              />
              <div className="absolute inset-0 flex items-center justify-center gap-1">
                <span className={`text-xs font-bold ${pctColor(s.changePercent)}`}>
                  {pctStr(s.changePercent) ?? "N/A"}
                </span>
                {ext != null && extLabel && <PctBadge v={ext} label={extLabel} />}
              </div>
            </div>

            <div className="w-16 text-right shrink-0">
              <div className="text-xs font-mono" dir="ltr">${s.price?.toFixed(2) ?? "—"}</div>
              {fromHigh != null && (
                <div className="text-[10px] text-muted-foreground/60">{fromHigh.toFixed(0)}% מהשיא</div>
              )}
            </div>

            <div className="w-12 text-right shrink-0">
              <div className={`text-xs font-medium ${rv != null && rv > 1.5 ? "text-yellow-400" : "text-muted-foreground"}`}>
                {rv != null ? `${rv.toFixed(1)}x${rv > 1.5 ? " 🔥" : ""}` : "—"}
              </div>
            </div>
          </div>
        );
      })}
      <div className="flex items-center gap-4 pt-2 text-xs text-muted-foreground border-t border-border/30">
        <span className="flex items-center gap-1"><span className="w-3 h-3 bg-green-500/35 rounded inline-block" />עלייה</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 bg-red-500/35 rounded inline-block" />ירידה</span>
        <span>🔥 נפח ≥1.5x ממוצע</span>
        <span className="mr-auto opacity-60">pre = pre-market · aft = after-hours</span>
      </div>
    </div>
  );
}

function AISection({ label, icon, value, accent }: {
  label: string; icon: React.ReactNode; value: string; accent?: string;
}) {
  return (
    <div className="py-3 border-b border-border/25 last:border-0">
      <div className={`text-xs uppercase tracking-wide mb-1.5 font-semibold flex items-center gap-1.5 ${accent ?? "text-muted-foreground"}`}>
        {icon} {label}
      </div>
      <p className="text-sm leading-relaxed text-foreground/90">{value}</p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────
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

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: getGetMarketDailyReportQueryKey() });
  };

  // ── Landing ──────────────────────────────────────────────────────────────
  if (!isRequested) {
    return (
      <div className="flex flex-col items-center justify-center p-12 bg-card border border-border rounded-xl text-center space-y-6" dir="rtl">
        <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center text-primary">
          <Globe className="w-8 h-8" />
        </div>
        <div className="max-w-lg space-y-2">
          <h3 className="text-xl font-bold">סיכום שוק יומי + הכנה למסחר</h3>
          <p className="text-muted-foreground text-sm leading-relaxed">
            תמונת מצב 360° — 11 סקטורים, מדדים, חוזים עתידיים, שווקים בינלאומיים, מטבעות, לוח אירועים כלכלי, ונתוני pre/post market — הכל עם ניתוח AI לקראת יום המסחר.
          </p>
        </div>
        <Button onClick={() => setIsRequested(true)} size="lg" className="font-semibold px-8">
          צור דוח שוק
        </Button>
        <div className="grid grid-cols-3 gap-4 text-xs text-muted-foreground pt-2 max-w-sm w-full">
          {[["📈", "חוזים 24/7"], ["🌍", "שווקים בינלאומיים"], ["⏰", "Pre-Market"]].map(([icon, label]) => (
            <div key={label} className="flex flex-col items-center gap-1">
              <span className="text-lg">{icon}</span>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Loading ──────────────────────────────────────────────────────────────
  if (isLoading || (isFetching && !data)) {
    return (
      <div className="mt-4 space-y-4" dir="rtl">
        <div className="flex items-center gap-3 text-primary animate-pulse py-3">
          <Activity className="w-5 h-5" />
          <span className="font-medium">שואב נתונים — חוזים, שווקים, מטבעות, AI...</span>
        </div>
        {[1, 2, 3, 4].map(i => (
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

  const stateMeta = data.marketState ? MARKET_STATE_META[data.marketState] ?? MARKET_STATE_META["CLOSED"] : MARKET_STATE_META["CLOSED"];
  const isPreOrClosed = data.marketState === "PRE" || data.marketState === "CLOSED";
  const vixBg = (data.vixLevel ?? 0) > 30 ? "bg-red-500/10 border-red-500/30 text-red-400"
    : (data.vixLevel ?? 0) > 20 ? "bg-orange-500/10 border-orange-500/30 text-orange-400"
      : "bg-green-500/10 border-green-500/30 text-green-400";

  const postureColor = (p: string) => {
    const pl = p.toLowerCase();
    if (pl.includes("risk-on")) return "text-green-400";
    if (pl.includes("risk-off")) return "text-red-400";
    return "text-yellow-400";
  };
  const postureBadgeClass = (p: string) => {
    const pl = p.toLowerCase();
    if (pl.includes("risk-on")) return "bg-green-500/20 text-green-400 border-green-500/30";
    if (pl.includes("risk-off")) return "bg-red-500/20 text-red-400 border-red-500/30";
    return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
  };

  const hasEconomicEvents = data.economicEvents && data.economicEvents.length > 0;

  return (
    <div className="space-y-5 mt-4" dir="rtl">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Globe className="w-5 h-5 text-primary" />
            סיכום שוק יומי
            <Badge className={`text-xs border ${stateMeta.bg} ${stateMeta.color}`}>
              {stateMeta.label}
            </Badge>
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5" dir="ltr">
            {new Date(data.generatedAt).toLocaleString("he-IL")} · Cache 5 min
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isFetching} className="gap-2">
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
          רענן
        </Button>
      </div>

      {/* ── Indices Strip ── */}
      <div>
        <div className="text-xs text-muted-foreground font-medium mb-2 flex items-center gap-1.5">
          <BarChart3 className="w-3.5 h-3.5" /> מדדים ראשיים
          <span className="text-muted-foreground/50">· pre = pre-market · aft = after-hours</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-10 gap-2">
          {data.indices.map(idx => <IndexCard key={idx.ticker} idx={idx} />)}
          {data.fearLabel && (
            <div className={`border rounded-lg p-2.5 text-center flex flex-col items-center justify-center gap-1 ${vixBg}`}>
              <div className="text-[10px] font-bold uppercase tracking-wide">Fear</div>
              <div className="text-xs font-medium leading-tight">{data.fearLabel}</div>
            </div>
          )}
        </div>
      </div>

      {/* ── Futures + International + Currencies (3 columns) ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* Futures */}
        <Card className="border-t-[3px] border-t-purple-500 bg-card/50">
          <CardHeader className="pb-2 border-b border-border/50 bg-muted/10">
            <CardTitle className="text-xs flex items-center gap-1.5 text-purple-400">
              <Clock className="w-3.5 h-3.5" /> חוזים עתידיים (24/7)
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-3 px-3">
            {data.futures.map(f => <FuturesRow key={f.ticker} f={f} />)}
          </CardContent>
        </Card>

        {/* International */}
        <Card className="border-t-[3px] border-t-blue-400 bg-card/50">
          <CardHeader className="pb-2 border-b border-border/50 bg-muted/10">
            <CardTitle className="text-xs flex items-center gap-1.5 text-blue-400">
              <Globe className="w-3.5 h-3.5" /> שווקים בינלאומיים
              <span className="mr-auto text-[10px] text-muted-foreground/60 font-normal flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />פתוח
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-3 px-3">
            {data.international.map(i => <IntlRow key={i.ticker} i={i} />)}
          </CardContent>
        </Card>

        {/* Currencies */}
        <Card className="border-t-[3px] border-t-emerald-400 bg-card/50">
          <CardHeader className="pb-2 border-b border-border/50 bg-muted/10">
            <CardTitle className="text-xs flex items-center gap-1.5 text-emerald-400">
              <Banknote className="w-3.5 h-3.5" /> מטבעות
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-3 px-3">
            {data.currencies.map(c => <CurrencyRow key={c.ticker} c={c} />)}
          </CardContent>
        </Card>
      </div>

      {/* ── Economic Calendar ── */}
      {hasEconomicEvents && (
        <Card className="border-t-[3px] border-t-orange-400 bg-card/50">
          <CardHeader className="pb-2 border-b border-border/50 bg-muted/10">
            <CardTitle className="text-xs flex items-center gap-2 text-orange-400">
              <Calendar className="w-3.5 h-3.5" />
              לוח אירועים כלכלי — היום/מחר
              <div className="flex items-center gap-2 mr-auto text-[10px] font-normal text-muted-foreground">
                <span className="text-red-400 font-bold">H</span> = High impact
                <span className="text-yellow-400 font-bold">M</span> = Medium
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-3 px-3">
            {data.economicEvents.map((e, idx) => <EventRow key={idx} e={e} />)}
          </CardContent>
        </Card>
      )}

      {/* ── AI Macro Pulse ── */}
      <Card className="border-t-[3px] border-t-primary bg-card/50 shadow-md">
        <CardHeader className="pb-3 border-b border-border/50 bg-muted/15">
          <CardTitle className="text-sm flex items-center gap-2 text-primary flex-wrap">
            <Zap className="w-4 h-4" />
            Macro Pulse — ניתוח AI
            <Badge className={`mr-auto text-xs border ${postureBadgeClass(data.marketPulse.marketPosture)}`}>
              {data.marketPulse.marketPosture.split("—")[0].trim().split("|")[0].trim()}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 grid grid-cols-1 md:grid-cols-2 gap-x-8">
          <div>
            {isPreOrClosed && (
              <AISection
                label="Outlook פתיחה — חוזים + בינלאומיים"
                icon={<ChevronRight className="w-3.5 h-3.5" />}
                value={data.marketPulse.premarketOutlook}
                accent="text-yellow-400"
              />
            )}
            <AISection label="עמדת שוק" icon={<Activity className="w-3 h-3" />} value={data.marketPulse.marketPosture} accent={postureColor(data.marketPulse.marketPosture)} />
            <AISection label="רוטציה בין סקטורים" icon={<Layers className="w-3 h-3" />} value={data.marketPulse.sectorRotation} />
            <AISection label="השפעת מאקרו" icon={<BarChart3 className="w-3 h-3" />} value={data.marketPulse.macroImpact} />
          </div>
          <div className="md:border-r md:border-border/30 md:pr-8">
            <AISection label="זרימת הון" icon={<DollarSign className="w-3 h-3" />} value={data.marketPulse.capitalFlow} />
            <AISection label="נושאים מרכזיים" icon={<Eye className="w-3 h-3" />} value={data.marketPulse.keyThemes} />
            <AISection
              label="סיכונים מיידיים"
              icon={<AlertTriangle className="w-3 h-3" />}
              value={data.marketPulse.risks}
              accent="text-orange-400"
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Prep for Trading Day ── */}
      <Card className="border-[2px] border-yellow-500/40 bg-yellow-500/5">
        <CardHeader className="pb-3 border-b border-yellow-500/20">
          <CardTitle className="text-sm flex items-center gap-2 text-yellow-400">
            <Clock className="w-4 h-4" />
            הכנה ליום המסחר — מה לעשות לפני הפעמון
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <p className="text-sm text-foreground/90 leading-relaxed">{data.marketPulse.tradingDayPrep}</p>
        </CardContent>
      </Card>

      {/* ── Sector Winners/Losers + Actionable ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="border-t-[3px] border-t-emerald-500 bg-card/50">
          <CardHeader className="pb-2 border-b border-border/50 bg-muted/10">
            <CardTitle className="text-xs flex items-center gap-1.5 text-emerald-400">
              <TrendingUp className="w-3.5 h-3.5" /> מובילים — כסף נכנס
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-3 text-sm text-foreground/90 leading-relaxed">
            {data.marketPulse.topSectors}
          </CardContent>
        </Card>
        <Card className="border-t-[3px] border-t-rose-500 bg-card/50">
          <CardHeader className="pb-2 border-b border-border/50 bg-muted/10">
            <CardTitle className="text-xs flex items-center gap-1.5 text-rose-400">
              <TrendingDown className="w-3.5 h-3.5" /> פגועים — כסף יוצא
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-3 text-sm text-foreground/90 leading-relaxed">
            {data.marketPulse.weakSectors}
          </CardContent>
        </Card>
      </div>

      {/* ── Sector Heatmap ── */}
      <Card className="border-t-[3px] border-t-blue-500 bg-card/50">
        <CardHeader className="pb-3 border-b border-border/50 bg-muted/10">
          <CardTitle className="text-xs flex items-center gap-2 text-blue-400">
            <BarChart3 className="w-3.5 h-3.5" />
            ביצועי 11 סקטורים — ETFs
            <span className="mr-auto text-muted-foreground font-normal">ממוין מהטוב לגרוע</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-3">
          <SectorHeatmap sectors={data.sectorPerformance} />
        </CardContent>
      </Card>

      {/* ── Actionable Insights ── */}
      <Card className="border-[2px] border-primary/30">
        <CardHeader className="pb-2 border-b border-border/50 bg-muted/15">
          <CardTitle className="text-sm flex items-center gap-2 text-primary">
            <Lightbulb className="w-4 h-4" /> רעיונות לפעולה — ETF / Long / Short / Pair
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="bg-primary/8 border border-primary/20 rounded-xl p-4 text-sm text-foreground leading-relaxed">
            {data.marketPulse.actionableInsights}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
