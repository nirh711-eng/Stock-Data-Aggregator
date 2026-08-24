import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetMarketDailyReport,
  getGetMarketDailyReportQueryKey,
} from "@workspace/api-client-react";
import type {
  IndexItem, FuturesItem, InternationalItem, CurrencyItem, EconomicEvent,
  SectorPerformanceItem, PremarketMover, ImpliedSectorRotation, MarketDailyReport
} from "@workspace/api-client-react";
import {
  BarChart3, RefreshCw, TrendingUp, TrendingDown, Minus, AlertTriangle,
  Zap, Eye, Lightbulb, Globe, Activity, ArrowUpRight,
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

const cleanReportText = (value: string | null | undefined) => (value ?? "")
  .replace(/\bN\/A\b/gi, "אין נתון")
  .replace(/\bpre-market\b/gi, "טרום מסחר")
  .replace(/\bafter-hours\b/gi, "מסחר מאוחר")
  .replace(/\bRisk-On\b/gi, "תיאבון לסיכון")
  .replace(/\bRisk-Off\b/gi, "הפחתת סיכון")
  .replace(/\bETF\b/gi, "קרן סל")
  .replace(/\bLong\b/gi, "לונג")
  .replace(/\bShort\b/gi, "שורט")
  .replace(/\bPair\b/gi, "צמד")
  .replace(/\bHedge\b/gi, "גידור");

const PctBadge = ({ v, label }: { v: number | null | undefined; label?: string }) => {
  const s = pctStr(v);
  if (!s) return null;
  const col = v! > 0 ? "bg-green-500/15 text-green-400 border-green-500/30"
    : v! < 0 ? "bg-red-500/15 text-red-400 border-red-500/30"
      : "bg-muted/30 text-muted-foreground";
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-mono px-1.5 py-0.5 rounded border ${col}`} dir="ltr">
      {v! > 0.15 ? <ArrowUpRight className="w-2.5 h-2.5" /> : v! < -0.15 ? <ArrowDownRight className="w-2.5 h-2.5" /> : <Minus className="w-2.5 h-2.5" />}
      {s}{label && <span className="opacity-60 ml-0.5">{label}</span>}
    </span>
  );
};

const MARKET_STATE_META: Record<string, { label: string; color: string; bg: string }> = {
  PRE:     { label: "טרום מסחר",   color: "text-yellow-400", bg: "bg-yellow-500/10 border-yellow-500/30" },
  REGULAR: { label: "מסחר פעיל",   color: "text-green-400",  bg: "bg-green-500/10 border-green-500/30" },
  POST:    { label: "מסחר מאוחר",  color: "text-blue-400",   bg: "bg-blue-500/10 border-blue-500/30" },
  CLOSED:  { label: "שוק סגור",    color: "text-muted-foreground", bg: "bg-muted/20 border-border" },
};

const translatePosture = (p: string) => {
  if (!p) return "";
  const pl = p.toLowerCase();
  if (pl.includes("risk-on")) return "תיאבון לסיכון";
  if (pl.includes("risk-off")) return "הפחתת סיכון";
  if (pl.includes("mixed")) return "מעורב";
  if (pl.includes("neutral")) return "ניטרלי";
  return cleanReportText(p);
};

const impactColor = (impact: string | null | undefined) => {
  if (!impact) return "text-muted-foreground";
  const l = impact.toLowerCase();
  if (l === "high") return "text-red-400";
  if (l === "medium") return "text-yellow-400";
  return "text-muted-foreground";
};

const impactLabel = (impact: string | null | undefined) => {
  const normalized = impact?.toLowerCase();
  if (normalized === "high") return "גבוהה";
  if (normalized === "medium") return "בינונית";
  if (normalized === "low") return "נמוכה";
  return "לא ידועה";
};

// ── sub-components ────────────────────────────────────────────────────────

type FlowItem = { price?: number | null; changePercent?: number | null };

function FlowInstrument({ label, item }: { label: string; item: FlowItem | undefined }) {
  if (!item) return null;
  const formattedPrice = item.price != null ? (item.price > 1000 ? item.price.toFixed(0) : item.price.toFixed(2)) : "—";
  return (
    <div className="flex flex-col gap-1">
       <span className="text-[10px] text-muted-foreground/80">{label}</span>
       <div className="flex items-center gap-1.5">
         <span className="text-sm font-mono font-medium text-foreground/90" dir="ltr">{formattedPrice}</span>
         <PctBadge v={item.changePercent} />
       </div>
    </div>
  );
}

function AtAGlanceSummary({ data }: { data: MarketDailyReport }) {
  const allItems = [...data.indices, ...data.futures, ...data.currencies, ...data.international];
  const findItem = (tickers: string[]) => allItems.find(i => tickers.includes(i.ticker));

  const stocks = findItem(["^GSPC", "ES=F", "^IXIC", "NQ=F"]);
  const bonds = findItem(["^TNX", "^TYX", "ZN=F", "ZB=F"]);
  const gold = findItem(["GC=F"]);
  const dollar = findItem(["DX-Y.NYB"]);
  const bitcoin = findItem(["BTC-USD"]);

  const topSectors = [...data.sectorPerformance].sort((a, b) => (b.changePercent ?? -999) - (a.changePercent ?? -999)).slice(0, 3);
  const bottomSectors = [...data.sectorPerformance].sort((a, b) => (a.changePercent ?? 999) - (b.changePercent ?? 999)).slice(0, 3);

  return (
    <Card className="border-t-[3px] border-t-primary bg-card/50 shadow-sm">
      <CardHeader className="pb-3 border-b border-border/50 bg-muted/10">
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          מבט על: זרימת הון ומגמות
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <h4 className="text-[11px] font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
             נכסים מרכזיים
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
             <FlowInstrument label="מניות" item={stocks} />
             <FlowInstrument label="אג״ח ותשואות" item={bonds} />
             <FlowInstrument label="זהב" item={gold} />
             <FlowInstrument label="דולר" item={dollar} />
             <FlowInstrument label="ביטקוין" item={bitcoin} />
          </div>
          {data.marketPulse?.capitalFlow && (
            <div className="mt-4 text-xs text-foreground/90 bg-muted/30 p-2.5 rounded border border-border/40 leading-relaxed">
               <span className="font-semibold text-primary/90 ml-1">פרשנות בינה מלאכותית:</span>
               {cleanReportText(data.marketPulse.capitalFlow)}
            </div>
          )}
        </div>

        <div>
          <h4 className="text-[11px] font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
            מובילות ומפגרות — סקטורים
          </h4>
          <div className="space-y-3">
            <div className="flex flex-col gap-2">
               <span className="text-xs text-green-400 font-medium">סקטורים מובילים:</span>
              <div className="flex flex-col gap-1.5">
                 {topSectors.length > 0 ? topSectors.map(s => (
                   <div key={s.ticker} className="flex items-center justify-between bg-green-500/10 border border-green-500/20 px-2.5 py-1.5 rounded">
                     <span className="text-xs text-foreground/90">{s.name}</span>
                     <span dir="ltr" className="text-xs font-mono font-medium text-green-400">{pctStr(s.changePercent)}</span>
                   </div>
                 )) : <span className="text-xs text-muted-foreground">לא זמין</span>}
              </div>
            </div>
            <div className="flex flex-col gap-2 pt-1">
              <span className="text-xs text-red-400 font-medium">סקטורים מפגרים:</span>
              <div className="flex flex-col gap-1.5">
                 {bottomSectors.length > 0 ? bottomSectors.map(s => (
                   <div key={s.ticker} className="flex items-center justify-between bg-red-500/10 border border-red-500/20 px-2.5 py-1.5 rounded">
                     <span className="text-xs text-foreground/90">{s.name}</span>
                     <span dir="ltr" className="text-xs font-mono font-medium text-red-400">{pctStr(s.changePercent)}</span>
                   </div>
                 )) : <span className="text-xs text-muted-foreground">לא זמין</span>}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function IndexCard({ idx }: { idx: IndexItem }) {
  const isVix = idx.ticker === "^VIX";
  const ext = idx.preMarketChangePercent ?? idx.postMarketChangePercent;
  const extLabel = idx.preMarketChangePercent != null ? "טרום" : idx.postMarketChangePercent != null ? "מאוחר" : null;

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
      <div className="text-xs font-mono text-muted-foreground" dir="ltr">
        {isVix ? idx.price?.toFixed(2) : idx.price != null ? `$${idx.price.toFixed(2)}` : "לא זמין"}
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
        <span className="text-xs font-mono text-muted-foreground" dir="ltr">{f.price != null ? `$${f.price.toFixed(2)}` : "—"}</span>
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
        <span className="text-xs font-mono text-muted-foreground" dir="ltr">{i.price != null ? i.price.toFixed(0) : "—"}</span>
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
        <span className="text-xs font-mono text-muted-foreground" dir="ltr">{c.price?.toFixed(4) ?? "—"}</span>
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
           {impactLabel(e.impact)}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-foreground/90 font-medium leading-tight">{e.event}</div>
        <div className="text-[10px] text-muted-foreground mt-0.5 flex gap-2 flex-wrap">
          {timeStr && <span>{timeStr}</span>}
          {e.estimate && <span>צפוי: <span dir="ltr">{e.estimate}</span></span>}
          {e.actual && <span className="text-green-400">בפועל: <span dir="ltr">{e.actual}</span></span>}
          {e.previous && <span>קודם: <span dir="ltr">{e.previous}</span></span>}
        </div>
      </div>
    </div>
  );
}

function PremarketMoverCard({ m, side }: { m: PremarketMover; side: "up" | "down" }) {
  const cp = m.extendedChangePercent ?? m.preMarketChangePercent ?? m.postMarketChangePercent;
  const isUp = (cp ?? 0) >= 0;
  return (
    <div className={`flex items-center justify-between py-1.5 px-2 rounded-lg border transition-colors ${isUp ? "border-green-500/20 bg-green-500/5" : "border-red-500/20 bg-red-500/5"}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-mono font-bold text-foreground" dir="ltr">{m.ticker}</span>
          <span className={`text-[9px] px-1 py-0.5 rounded font-medium ${isUp ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
            {m.sector}
          </span>
        </div>
        <div className="text-[10px] text-muted-foreground/70 mt-0.5">
          סגירה: <span dir="ltr">{pctStr(m.changePercent) ?? "—"}</span>
          {m.preMarketPrice != null && m.price != null && (
            <span className="mr-2 font-mono" dir="ltr">${m.preMarketPrice.toFixed(2)}</span>
          )}
        </div>
      </div>
      <div className="shrink-0 mr-1">
        <PctBadge v={cp} />
      </div>
    </div>
  );
}

function ImpliedRotationBar({ rotation }: { rotation: ImpliedSectorRotation[] }) {
  if (!rotation.length) return null;
  const max = Math.max(...rotation.map(r => Math.abs(r.avgPrePct)), 0.1);
  return (
    <div className="space-y-1.5">
      {rotation.map(r => {
        const barW = Math.min((Math.abs(r.avgPrePct) / max) * 100, 100);
        const isPos = r.avgPrePct >= 0;
        return (
          <div key={r.sector} className="flex items-center gap-2 group">
            <div className="w-24 shrink-0 text-right">
              <span className="text-xs text-foreground/80">{r.sector}</span>
            </div>
            <div className="flex-1 h-5 bg-muted/20 rounded relative overflow-hidden">
              <div
                className={`absolute top-0 bottom-0 rounded transition-all ${isPos ? "bg-green-500/40 right-1/2" : "bg-red-500/40 left-1/2"}`}
                style={{ width: `${barW * 0.5}%` }}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className={`text-xs font-bold ${isPos ? "text-green-400" : "text-red-400"}`} dir="ltr">
                  {r.avgPrePct >= 0 ? "+" : ""}{r.avgPrePct.toFixed(2)}%
                </span>
              </div>
            </div>
            <div className="w-40 text-[10px] text-muted-foreground/60 truncate hidden sm:block">
              {r.stocks.slice(0, 3).join(" · ")}
            </div>
          </div>
        );
      })}
      <div className="text-[10px] text-muted-foreground/50 pt-1">
         * ממוצע משוקלל לפי מניות בודדות — לא סגירת קרן סל
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
        const extLabel = s.preMarketChangePercent != null ? "טרום" : s.postMarketChangePercent != null ? "מאוחר" : null;
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
                <span className={`text-xs font-bold ${pctColor(s.changePercent)}`} dir="ltr">
                  {pctStr(s.changePercent) ?? "לא זמין"}
                </span>
                {ext != null && extLabel && <PctBadge v={ext} label={extLabel} />}
              </div>
            </div>

            <div className="w-16 text-right shrink-0">
              <div className="text-xs font-mono" dir="ltr">${s.price?.toFixed(2) ?? "—"}</div>
              {fromHigh != null && (
                <div className="text-[10px] text-muted-foreground/60" dir="ltr">{fromHigh.toFixed(0)}% מהשיא</div>
              )}
            </div>

            <div className="w-16 text-right shrink-0">
              <div className={`text-xs font-medium ${rv != null && rv > 1.5 ? "text-yellow-400" : "text-muted-foreground"}`} dir="ltr">
                {rv != null ? `${rv.toFixed(1)}x${rv > 1.5 ? " (גבוה)" : ""}` : "—"}
              </div>
            </div>
          </div>
        );
      })}
      <div className="flex items-center gap-4 pt-2 text-xs text-muted-foreground border-t border-border/30">
        <span className="flex items-center gap-1"><span className="w-3 h-3 bg-green-500/35 rounded inline-block" />עלייה</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 bg-red-500/35 rounded inline-block" />ירידה</span>
         <span>נפח חריג (פי 1.5 מהממוצע ומעלה)</span>
        <span className="mr-auto opacity-60">טרום = טרום מסחר · מאוחר = מסחר מאוחר</span>
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
        <p className="text-sm leading-relaxed text-foreground/90">{cleanReportText(value)}</p>
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
          <h3 className="text-xl font-bold">סיכום שוק יומי והכנה למסחר</h3>
          <p className="text-muted-foreground text-sm leading-relaxed">
            תמונת מצב 360° — 11 סקטורים, מדדים, חוזים עתידיים, שווקים בינלאומיים, מטבעות, לוח אירועים כלכלי, ונתוני טרום מסחר ומסחר מאוחר — הכל עם ניתוח AI לקראת יום המסחר.
          </p>
        </div>
        <Button onClick={() => setIsRequested(true)} size="lg" className="font-semibold px-8">
          הצג דוח שוק יומי
        </Button>
        <div className="grid grid-cols-3 gap-4 text-xs text-muted-foreground pt-2 max-w-sm w-full">
          {[
            { icon: <Activity className="w-5 h-5 mx-auto mb-1" />, label: "חוזים 24/7" },
            { icon: <Globe className="w-5 h-5 mx-auto mb-1" />, label: "שווקים בינלאומיים" },
            { icon: <Clock className="w-5 h-5 mx-auto mb-1" />, label: "טרום מסחר" }
          ].map((item) => (
            <div key={item.label} className="flex flex-col items-center">
              {item.icon}
              <span>{item.label}</span>
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
          <span className="font-medium">מעבד נתונים — חוזים, שווקים, מטבעות ומנועי AI...</span>
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
        לא ניתן לטעון את הדוח. נסה שוב מאוחר יותר.
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
    <div className="space-y-6 mt-4" dir="rtl">

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
            {new Date(data.generatedAt).toLocaleString("he-IL")}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isFetching} className="gap-2">
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
          רענן נתונים
        </Button>
      </div>

      {/* ── At A Glance ── */}
      <AtAGlanceSummary data={data} />

      {/* ── Indices Strip ── */}
      <div>
        <div className="text-xs text-muted-foreground font-medium mb-2 flex items-center gap-1.5">
          <BarChart3 className="w-3.5 h-3.5" /> מדדים ראשיים
          <span className="text-muted-foreground/50">· טרום = טרום מסחר · מאוחר = מסחר מאוחר</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-10 gap-2">
          {data.indices.map(idx => <IndexCard key={idx.ticker} idx={idx} />)}
          {data.fearLabel && (
            <div className={`border rounded-lg p-2.5 text-center flex flex-col items-center justify-center gap-1 ${vixBg}`}>
              <div className="text-[10px] font-bold tracking-wide">מדד הפחד</div>
              <div className="text-xs font-medium leading-tight">{data.fearLabel}</div>
            </div>
          )}
        </div>
      </div>

      {/* ── Pre-Market Movers + Implied Sector Rotation ── */}
      {(data.topPreMarketGainers?.length > 0 || data.topPreMarketLosers?.length > 0 || data.impliedSectorRotation?.length > 0) && (
        <div className="space-y-4">
          {/* Header notice */}
          <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg border ${stateMeta.bg} ${stateMeta.color}`}>
            <Activity className="w-3.5 h-3.5 shrink-0" />
            <span className="font-medium">
              {data.marketState === "PRE" ? "טרום מסחר פעיל — הנתונים הבאים מרמזים על מגמת הפתיחה:" : data.marketState === "POST" ? "מסחר מאוחר פעיל — מניות זזות בעקבות דוחות וחדשות:" : "מסחר סגור — חוזים ומניות מרמזים על כיוון פתיחה:"}
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Gainers */}
            <Card className="border-t-[3px] border-t-green-500 bg-card/50">
              <CardHeader className="pb-2 border-b border-border/50 bg-muted/10">
                <CardTitle className="text-xs flex items-center gap-1.5 text-green-400">
                  <ArrowUpRight className="w-3.5 h-3.5" />
                  עולות בולטות (טרום/מאוחר)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-3 space-y-1.5">
                {data.topPreMarketGainers?.length > 0
                  ? data.topPreMarketGainers.map(m => <PremarketMoverCard key={m.ticker} m={m} side="up" />)
                  : <p className="text-xs text-muted-foreground text-center py-4">אין נתונים</p>
                }
              </CardContent>
            </Card>

            {/* Losers */}
            <Card className="border-t-[3px] border-t-red-500 bg-card/50">
              <CardHeader className="pb-2 border-b border-border/50 bg-muted/10">
                <CardTitle className="text-xs flex items-center gap-1.5 text-red-400">
                  <ArrowDownRight className="w-3.5 h-3.5" />
                  יורדות בולטות (טרום/מאוחר)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-3 space-y-1.5">
                {data.topPreMarketLosers?.length > 0
                  ? data.topPreMarketLosers.map(m => <PremarketMoverCard key={m.ticker} m={m} side="down" />)
                  : <p className="text-xs text-muted-foreground text-center py-4">אין נתונים</p>
                }
              </CardContent>
            </Card>

            {/* Implied Rotation */}
            <Card className="border-t-[3px] border-t-violet-500 bg-card/50">
              <CardHeader className="pb-2 border-b border-border/50 bg-muted/10">
                <CardTitle className="text-xs flex items-center gap-1.5 text-violet-400">
                  <Layers className="w-3.5 h-3.5" />
                  רוטציה משוערת — לפי מניות
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-3">
                {data.impliedSectorRotation?.length > 0
                  ? <ImpliedRotationBar rotation={data.impliedSectorRotation} />
                  : <p className="text-xs text-muted-foreground text-center py-4">אין מספיק נתונים לרוטציה</p>
                }
              </CardContent>
            </Card>
          </div>
        </div>
      )}

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
                <span className="text-red-400 font-bold">גבוהה</span> = השפעה גבוהה
                <span className="text-yellow-400 font-bold">בינונית</span> = השפעה בינונית
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
            דופק מאקרו — ניתוח בינה מלאכותית
            <Badge className={`mr-auto text-xs border ${postureBadgeClass(data.marketPulse.marketPosture)}`}>
              {translatePosture(data.marketPulse.marketPosture.split("—")[0].trim().split("|")[0].trim())}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 grid grid-cols-1 md:grid-cols-2 gap-x-8">
          <div>
            {isPreOrClosed && (
              <AISection
                label="תחזית פתיחה — חוזים ושווקים בינלאומיים"
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
            <AISection label="נושאים מרכזיים" icon={<Lightbulb className="w-3 h-3" />} value={data.marketPulse.keyThemes} />
            <AISection label="סקטורים חזקים" icon={<TrendingUp className="w-3 h-3" />} value={data.marketPulse.topSectors} accent="text-green-400" />
            <AISection label="סקטורים חלשים" icon={<TrendingDown className="w-3 h-3" />} value={data.marketPulse.weakSectors} accent="text-red-400" />
            <AISection label="סיכונים" icon={<AlertTriangle className="w-3 h-3" />} value={data.marketPulse.risks} accent="text-orange-400" />
          </div>
        </CardContent>
        <div className="px-4 py-3 bg-muted/20 border-t border-border/50 text-foreground/90">
          <AISection label="הכנה למסחר ותובנות לפעולה" icon={<Eye className="w-3.5 h-3.5" />} value={`${data.marketPulse.tradingDayPrep} ${data.marketPulse.actionableInsights}`} accent="text-foreground" />
        </div>
      </Card>

      {/* ── Sector Heatmap ── */}
      <Card className="border-t-[3px] border-t-cyan-500 bg-card/50">
        <CardHeader className="pb-3 border-b border-border/50 bg-muted/10">
          <CardTitle className="text-sm flex items-center justify-between text-cyan-500">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4" />
              מפת חום סקטורים — ביצועים ונפח
            </div>
            <span className="text-xs font-normal text-muted-foreground">
              ממוין לפי ביצועים היום
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <SectorHeatmap sectors={data.sectorPerformance} />
        </CardContent>
      </Card>

    </div>
  );
}
