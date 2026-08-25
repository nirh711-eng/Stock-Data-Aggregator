import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  TrendingUp, TrendingDown, RefreshCw, ArrowUpDown,
  ChevronUp, ChevronDown, Minus, ExternalLink,
  Flame, Hammer, BarChart2, ScanLine, CalendarDays,
} from "lucide-react";
import {
  getGetSectorSignalsQueryKey,
  useGetSectorSignals,
  type SectorSignalMatch,
  type SectorSignalResponse,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

// ── Types ──────────────────────────────────────────────────────────────────────

interface SectorStock {
  symbol: string;
  name: string;
  price: number | null;
  change1d: number | null;
  marketCap: number;
  marketCapFormatted: string;
  industry: string | null;
  beta: number | null;
  pe: number | null;
  eps: number | null;
  volume: number | null;
  avgVolume: number | null;
  relVolume: number | null;
  volumeFormatted: string | null;
  exchange: string | null;
  vs52High: number | null;
  vs200dma: number | null;
  dayOpen: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  hammerDaily: boolean;
  qualityTier: "leader" | "mid" | "radar" | "speculative";
}

interface SectorData {
  sector: string;
  count: number;
  stocks: SectorStock[];
  cachedAt: string;
}

type SignalMatch = SectorSignalMatch & {
  exchange?: string | null;
  pe?: number | null;
  beta?: number | null;
};
type SignalData = SectorSignalResponse;

// ── Config ─────────────────────────────────────────────────────────────────────

const SECTORS: { en: string; he: string }[] = [
  { en: "Technology",            he: "טכנולוגיה" },
  { en: "Healthcare",            he: "בריאות" },
  { en: "Financial Services",    he: "שירותים פיננסיים" },
  { en: "Energy",                he: "אנרגיה" },
  { en: "Consumer Cyclical",     he: "צריכה מחזורית" },
  { en: "Consumer Defensive",    he: "צריכה בסיסית" },
  { en: "Industrials",           he: "תעשייה" },
  { en: "Communication Services",he: "תקשורת" },
  { en: "Real Estate",           he: "נדל\"ן" },
  { en: "Basic Materials",       he: "חומרי גלם" },
  { en: "Utilities",             he: "תשתיות" },
];

type TierKey = "all" | "leader" | "mid" | "radar" | "speculative";
type SignalKey = "unusual_volume" | "hammer_daily" | "hammer_weekly";
type FilterMode = TierKey | SignalKey;

const TIERS: { key: TierKey; label: string; color: string }[] = [
  { key: "all",         label: "הכל",              color: "text-muted-foreground" },
  { key: "leader",      label: "מובילים >$10B",    color: "text-emerald-500" },
  { key: "mid",         label: "בינוני $1B–$10B",  color: "text-blue-500" },
  { key: "radar",       label: "מתחת לראדר",        color: "text-yellow-500" },
  { key: "speculative", label: "ספקולטיבי",         color: "text-rose-500" },
];

const SIGNALS: { key: SignalKey; label: string; color: string; icon: React.ReactNode }[] = [
  { key: "unusual_volume", label: "ווליום חריג",   color: "text-orange-400", icon: <Flame className="w-3 h-3" /> },
  { key: "hammer_daily",   label: "פטיש יומי",     color: "text-violet-400", icon: <Hammer className="w-3 h-3" /> },
  { key: "hammer_weekly",  label: "פטיש שבועי",    color: "text-cyan-400",   icon: <Hammer className="w-3 h-3" /> },
];

const TIER_BADGE: Record<string, string> = {
  leader:      "border-emerald-500/40 text-emerald-500 bg-emerald-500/10",
  mid:         "border-blue-500/40 text-blue-500 bg-blue-500/10",
  radar:       "border-yellow-500/40 text-yellow-500 bg-yellow-500/10",
  speculative: "border-rose-500/40 text-rose-500 bg-rose-500/10",
};

const TIER_LABELS: Record<string, string> = {
  leader: "מוביל", mid: "בינוני", radar: "מתחת לראדר", speculative: "ספקולטיבי",
};

type SortKey = "marketCap" | "change1d" | "pe" | "beta" | "vs52High" | "relVolume";

const SORTS: { key: SortKey; label: string; signalOnly?: SignalKey }[] = [
  { key: "marketCap",  label: "שווי שוק" },
  { key: "change1d",   label: "שינוי יומי" },
  { key: "pe",         label: "P/E" },
  { key: "beta",       label: "ביטא" },
  { key: "vs52High",   label: "מרחק מ-52W High" },
  { key: "relVolume",  label: "ווליום יחסי", signalOnly: "unusual_volume" },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

async function fetchSector(sector: string): Promise<SectorData> {
  const r = await fetch(`${BASE}/api/sectors/screen?sector=${encodeURIComponent(sector)}&limit=60`);
  if (!r.ok) throw new Error("Failed");
  return r.json() as Promise<SectorData>;
}

function pctColor(v: number | null): string {
  if (v == null) return "text-muted-foreground";
  if (v > 0) return "text-emerald-500";
  if (v < 0) return "text-rose-500";
  return "text-muted-foreground";
}

function fmtVol(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(Math.round(v));
}

// Hammer candle visual mini-bar
function HammerVisual({ o, h, l, c, label }: { o: number | null; h: number | null; l: number | null; c: number | null; label: string }) {
  if (!o || !h || !l || !c) return <span className="text-muted-foreground/40 text-[9px]">—</span>;
  const range = h - l;
  if (range === 0) return null;
  const bodyTop    = ((h - Math.max(o, c)) / range * 100).toFixed(0);
  const bodyHeight = (Math.abs(c - o) / range * 100).toFixed(0);
  const isGreen    = c >= o;
  return (
    <div className="flex flex-col items-center gap-0.5" title={`${label} O:${o?.toFixed(2)} H:${h?.toFixed(2)} L:${l?.toFixed(2)} C:${c?.toFixed(2)}`}>
      <div className="text-[8px] text-muted-foreground/60 font-mono">{label}</div>
      <div className="relative w-2 h-10 flex flex-col items-center">
        {/* upper shadow */}
        <div className="w-px bg-muted-foreground/50" style={{ height: `${bodyTop}%` }} />
        {/* body */}
        <div className={`w-2 ${isGreen ? "bg-emerald-500" : "bg-rose-500"}`} style={{ height: `${bodyHeight}%`, minHeight: "2px" }} />
        {/* lower shadow — remainder */}
        <div className="w-px bg-muted-foreground/50 flex-1" />
      </div>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

interface Props {
  onSelectTicker: (ticker: string) => void;
}

const TIER_KEYS: TierKey[] = ["all", "leader", "mid", "radar", "speculative"];
function isTier(f: FilterMode): f is TierKey { return TIER_KEYS.includes(f as TierKey); }

export function SectorExplorer({ onSelectTicker }: Props) {
  const [sector, setSector]     = useState("Technology");
  const [filter, setFilter]     = useState<FilterMode>("all");
  const [sortKey, setSortKey]   = useState<SortKey>("marketCap");
  const [sortAsc, setSortAsc]   = useState(false);
  const [marketDailyRequested, setMarketDailyRequested] = useState(false);

  // Main sector data
  const { data, isLoading, isFetching, refetch } = useQuery<SectorData>({
    queryKey: ["sectorScreen", sector],
    queryFn:  () => fetchSector(sector),
    staleTime: 30 * 60 * 1000,
  });

  // Candle signals are loaded only when their filter or explicit market scan is active.
  const {
    data: weeklySignalData,
    isLoading: isWeeklySignalLoading,
    isFetching: isWeeklySignalFetching,
    isError: isWeeklySignalError,
    refetch: refetchWeeklySignal,
  } = useGetSectorSignals(
    { sector, signal: "hammer_weekly" },
    {
      query: {
        queryKey: getGetSectorSignalsQueryKey({ sector, signal: "hammer_weekly" }),
        enabled: filter === "hammer_weekly",
        staleTime: 0,
        refetchOnMount: "always",
      },
    },
  );
  const {
    data: sectorDailySignalData,
    isLoading: isSectorDailyLoading,
    isFetching: isSectorDailyFetching,
    isError: isSectorDailyError,
    refetch: refetchSectorDaily,
  } = useGetSectorSignals(
    { sector, signal: "hammer_daily" },
    {
      query: {
        queryKey: getGetSectorSignalsQueryKey({ sector, signal: "hammer_daily" }),
        enabled: filter === "hammer_daily" && !marketDailyRequested,
        staleTime: 0,
        refetchOnMount: "always",
      },
    },
  );
  const {
    data: marketDailySignalData,
    isLoading: isMarketDailyLoading,
    isFetching: isMarketDailyFetching,
    isError: isMarketDailyError,
    refetch: refetchMarketDaily,
  } = useGetSectorSignals(
    { sector: "all", signal: "hammer_daily" },
    {
      query: {
        queryKey: getGetSectorSignalsQueryKey({ sector: "all", signal: "hammer_daily" }),
        enabled: marketDailyRequested,
        staleTime: 0,
        refetchOnMount: "always",
        retry: 1,
      },
    },
  );

  const signalData: SignalData | undefined = filter === "hammer_weekly"
    ? weeklySignalData
    : marketDailyRequested
      ? marketDailySignalData
      : sectorDailySignalData;
  const isSignalLoading = filter === "hammer_weekly"
    ? isWeeklySignalLoading
    : marketDailyRequested
      ? isMarketDailyLoading
      : isSectorDailyLoading;
  const isSignalFetching = filter === "hammer_weekly"
    ? isWeeklySignalFetching
    : marketDailyRequested
      ? isMarketDailyFetching
      : isSectorDailyFetching;
  const isSignalError = filter === "hammer_weekly"
    ? isWeeklySignalError
    : marketDailyRequested
      ? isMarketDailyError
      : isSectorDailyError;
  const isSignalIncomplete = Boolean(signalData && !signalData.complete);
  const refetchSignal = filter === "hammer_weekly"
    ? refetchWeeklySignal
    : marketDailyRequested
      ? refetchMarketDaily
      : refetchSectorDaily;

  const tierCounts = useMemo(() => {
    if (!data?.stocks) return {} as Record<string, number>;
    return data.stocks.reduce((acc, s) => {
      acc[s.qualityTier] = (acc[s.qualityTier] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }, [data]);

  const signalCounts = useMemo(() => {
    if (!data?.stocks) return { unusual_volume: 0, hammer_daily: 0 };
    const unusual = data.stocks.filter(s => (s.relVolume ?? 0) >= 2.0).length;
    const hammerD  = filter === "hammer_daily" ? (signalData?.count ?? 0) : 0;
    return { unusual_volume: unusual, hammer_daily: hammerD };
  }, [data, filter, signalData]);

  // Build the displayed list based on active filter
  const displayed = useMemo((): (SectorStock | SignalMatch)[] => {
    if (filter === "hammer_weekly" || filter === "hammer_daily") {
      return signalData?.matches ?? [];
    }
    if (!data?.stocks) return [];
    let list = [...data.stocks];
    if (filter === "leader")      list = list.filter(s => s.qualityTier === "leader");
    if (filter === "mid")         list = list.filter(s => s.qualityTier === "mid");
    if (filter === "radar")       list = list.filter(s => s.qualityTier === "radar");
    if (filter === "speculative") list = list.filter(s => s.qualityTier === "speculative");
    if (filter === "unusual_volume") list = list.filter(s => (s.relVolume ?? 0) >= 2.0);
    return list;
  }, [data, signalData, filter]);

  const sorted = useMemo(() => {
    const list = [...displayed];
    list.sort((a, b) => {
      let av: number | null = null;
      let bv: number | null = null;
      if (sortKey === "marketCap") { av = a.marketCap; bv = b.marketCap; }
      if (sortKey === "change1d")  { av = a.change1d;  bv = b.change1d;  }
      if (sortKey === "pe")        { av = (a.pe != null && a.pe > 0) ? a.pe : null; bv = (b.pe != null && b.pe > 0) ? b.pe : null; }
      if (sortKey === "beta")      { av = a.beta ?? null;  bv = b.beta ?? null; }
      if (sortKey === "vs52High")  { av = a.vs52High; bv = b.vs52High; }
      if (sortKey === "relVolume") { av = a.relVolume; bv = b.relVolume; }
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return sortAsc ? av - bv : bv - av;
    });
    return list;
  }, [displayed, sortKey, sortAsc]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(v => !v);
    else { setSortKey(key); setSortAsc(false); }
  };

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return <ArrowUpDown className="w-3 h-3 opacity-40" />;
    return sortAsc ? <ChevronUp className="w-3 h-3 text-primary" /> : <ChevronDown className="w-3 h-3 text-primary" />;
  };

  const cachedMins = data?.cachedAt
    ? Math.round((Date.now() - new Date(data.cachedAt).getTime()) / 60000)
    : null;

  const isSignalLoadingActive = (filter === "hammer_weekly" || filter === "hammer_daily")
    && (isSignalLoading || isSignalFetching);

  const showHammerCols   = filter === "hammer_daily" || filter === "hammer_weekly";
  const showRelVolCol    = filter === "unusual_volume";
  const showWeeklyCandle = filter === "hammer_weekly";

  const runMarketDailyScan = () => {
    setFilter("hammer_daily");
    if (marketDailyRequested) {
      void refetchMarketDaily();
      return;
    }
    setMarketDailyRequested(true);
  };

  return (
    <div className="space-y-4">
      {/* Sector Chips */}
      <div className="flex flex-wrap gap-2">
        {SECTORS.map(s => (
          <button
            key={s.en}
            onClick={() => { setSector(s.en); setFilter("all"); setMarketDailyRequested(false); }}
            className={`text-xs px-3 py-1.5 rounded-full border transition-all font-medium
              ${sector === s.en
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"}`}
          >
            {s.he}
          </button>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-violet-500/25 bg-violet-500/5 px-3 py-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 text-sm font-semibold text-violet-300">
            <Hammer className="w-4 h-4" />
            סורק פטיש יומי — רשימות הסקטורים
          </div>
          <p className="text-[11px] text-muted-foreground">
            סורק את רשימות המניות הקיימות בכל הסקטורים, לפי יום המסחר האחרון שהושלם בלבד.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={runMarketDailyScan}
          disabled={isMarketDailyLoading || isMarketDailyFetching}
          className="shrink-0 bg-violet-600 text-white hover:bg-violet-500"
        >
          <ScanLine className={`w-3.5 h-3.5 ml-1.5 ${(isMarketDailyLoading || isMarketDailyFetching) ? "animate-spin" : ""}`} />
          {(isMarketDailyLoading || isMarketDailyFetching) ? "סורק את השוק..." : "סרוק פטיש יומי"}
        </Button>
      </div>

      {/* Tier Filters */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-[10px] text-muted-foreground/60 ml-1 font-medium">שווי שוק:</span>
          {TIERS.map(t => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={`text-[11px] px-2.5 py-1 rounded-full border transition-all
                ${filter === t.key
                  ? `border-current ${t.color} bg-current/10`
                  : "border-border text-muted-foreground hover:border-muted-foreground"}`}
            >
              {t.label}
              {t.key === "all" && data && <span className="ml-1 opacity-60">({data.count})</span>}
              {t.key !== "all" && tierCounts[t.key] != null && <span className="ml-1 opacity-60">({tierCounts[t.key]})</span>}
            </button>
          ))}
        </div>

        {/* Signal Filters */}
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-[10px] text-muted-foreground/60 ml-1 font-medium">סיגנלים:</span>
          {SIGNALS.map(sig => (
            <button
              key={sig.key}
              onClick={() => {
                setFilter(sig.key);
                setMarketDailyRequested(false);
                if (sig.key === "unusual_volume") setSortKey("relVolume");
              }}
              className={`text-[11px] px-2.5 py-1 rounded-full border transition-all flex items-center gap-1
                ${filter === sig.key
                  ? `border-current ${sig.color} bg-current/10 font-semibold`
                  : "border-border text-muted-foreground hover:border-muted-foreground"}`}
            >
              {sig.icon}{sig.label}
              {sig.key === "unusual_volume" && data && <span className="opacity-60">({signalCounts.unusual_volume})</span>}
              {sig.key === "hammer_daily"   && data && <span className="opacity-60">({signalCounts.hammer_daily})</span>}
              {sig.key === "hammer_weekly" && filter === "hammer_weekly" && signalData && <span className="opacity-60">({signalData.count})</span>}
            </button>
          ))}
          <div className="mr-auto flex items-center gap-2">
            {cachedMins != null && (
              <span className="text-[10px] text-muted-foreground/40">cache: לפני {cachedMins} דק׳</span>
            )}
            <Button
              variant="ghost" size="icon" className="h-6 w-6"
              onClick={() => {
                if (filter === "hammer_daily" || filter === "hammer_weekly") {
                  void refetchSignal();
                } else {
                  void refetch();
                }
              }}
              disabled={isFetching || isSignalFetching}
            >
              <RefreshCw className={`w-3 h-3 ${(isFetching || isSignalFetching) ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
      </div>

      {/* Signal description banner */}
      {filter === "unusual_volume" && (
        <div className="flex items-center gap-2 text-xs bg-orange-500/10 border border-orange-500/30 rounded-lg px-3 py-2 text-orange-500">
          <Flame className="w-3.5 h-3.5 shrink-0" />
          ווליום חריג — מניות עם נפח מסחר פי 2+ מהממוצע היומי שלהן (3 חודשים)
        </div>
      )}
      {filter === "hammer_daily" && (
        <div className="flex items-center gap-2 text-xs bg-violet-500/10 border border-violet-500/30 rounded-lg px-3 py-2 text-violet-400">
          <Hammer className="w-3.5 h-3.5 shrink-0" />
          <span>
            {marketDailyRequested ? "סריקת רשימות הסקטורים: " : `סקטור ${SECTORS.find((item) => item.en === sector)?.he ?? sector}: `}
            פטיש ביום המסחר האחרון שהושלם — צל תחתון ≥ 2× הגוף וצל עליון ≤ 35% מהגוף.
          </span>
          {signalData?.candleDate && (
            <span className="mr-auto flex items-center gap-1 whitespace-nowrap text-violet-300/80">
              <CalendarDays className="w-3 h-3" />
              {signalData.candleDate}
            </span>
          )}
          {isSignalLoadingActive && <span className="animate-pulse mr-auto whitespace-nowrap">סורק...</span>}
        </div>
      )}
      {filter === "hammer_weekly" && (
        <div className="flex items-center gap-2 text-xs bg-cyan-500/10 border border-cyan-500/30 rounded-lg px-3 py-2 text-cyan-400">
          <Hammer className="w-3.5 h-3.5 shrink-0" />
          פטיש שבועי — נר שבועי אחרון שמציג תצורת פטיש — סריקה על {signalData?.scannedCount ?? "..."} מניות
          {isSignalLoadingActive && <span className="animate-pulse mr-2">⏳ סורק...</span>}
        </div>
      )}

      {isSignalError && (filter === "hammer_daily" || filter === "hammer_weekly") && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          הסריקה נכשלה — נסה שוב בעוד רגע.
        </div>
      )}
      {isSignalIncomplete && (filter === "hammer_daily" || filter === "hammer_weekly") && (
        <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          כיסוי חלקי: {signalData?.successfulCount ?? 0} מתוך {signalData?.scannedCount ?? 0} מניות עובדו; {signalData?.failedCount ?? 0} לא היו זמינות אצל ספק הנתונים. ההתאמות המוצגות מבוססות על המניות שעובדו בהצלחה.
        </div>
      )}

      {/* Sort bar */}
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground border-b border-border pb-2">
        <span className="mr-2 font-medium">ממיין:</span>
        {SORTS.filter(s => !s.signalOnly || s.signalOnly === filter).map(s => (
          <button
            key={s.key}
            onClick={() => handleSort(s.key)}
            className={`flex items-center gap-0.5 px-2 py-0.5 rounded hover:text-foreground transition-colors
              ${sortKey === s.key ? "text-primary" : ""}`}
          >
            {s.label}<SortIcon k={s.key} />
          </button>
        ))}
      </div>

      {/* Table */}
      {(isLoading || isSignalLoadingActive) ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex gap-3 items-center">
              <Skeleton className="h-8 w-16 flex-shrink-0" />
              <Skeleton className="h-8 flex-1" />
              <Skeleton className="h-8 w-24 flex-shrink-0" />
              <Skeleton className="h-8 w-20 flex-shrink-0" />
            </div>
          ))}
        </div>
      ) : isSignalError ? (
        <div className="text-center py-12">
          <p className="text-sm text-muted-foreground">לא ניתן להציג תוצאות מהסריקה.</p>
        </div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-12 space-y-2">
          <p className="text-sm text-muted-foreground">
            {filter === "hammer_daily"
              ? marketDailyRequested
                ? "לא נמצאו מניות עם תצורת פטיש ביום המסחר הקודם בסריקת השוק."
                : "לא נמצאו מניות עם תצורת פטיש ביום המסחר הקודם בסקטור זה."
              :
             filter === "hammer_weekly"  ? "לא נמצאו מניות עם תצורת פטיש שבועי." :
             filter === "unusual_volume" ? "לא נמצאו מניות עם ווליום חריג כרגע." :
             filter === "radar"          ? "לא נמצאו מניות בטווח $100M–$1B בסקטור זה." :
             "לא נמצאו מניות."}
          </p>
          {filter === "radar" && (
            <p className="text-xs text-muted-foreground/60">ייתכן שכל המניות שנטענו הן מעל $1B. נסה לרענן.</p>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left pb-2 pr-3 font-medium w-[5rem]">סמל</th>
                <th className="text-left pb-2 pr-3 font-medium min-w-[9rem]">חברה</th>
                <th className="text-right pb-2 pr-3 font-medium whitespace-nowrap">שווי שוק</th>
                <th className="text-right pb-2 pr-3 font-medium">מחיר</th>
                <th className="text-right pb-2 pr-3 font-medium">שינוי</th>
                {showRelVolCol && <th className="text-right pb-2 pr-3 font-medium whitespace-nowrap text-orange-400">ווליום יחסי</th>}
                {showRelVolCol && <th className="text-right pb-2 pr-3 font-medium whitespace-nowrap">נפח</th>}
                {!showRelVolCol && !showHammerCols && <th className="text-right pb-2 pr-3 font-medium">P/E</th>}
                {!showRelVolCol && !showHammerCols && <th className="text-right pb-2 pr-3 font-medium">ביטא</th>}
                {!showRelVolCol && <th className="text-right pb-2 pr-3 font-medium whitespace-nowrap">מ-52W Hi</th>}
                {!showRelVolCol && <th className="text-right pb-2 pr-3 font-medium whitespace-nowrap">vs SMA200</th>}
                {showHammerCols && <th className="text-right pb-2 pr-3 font-medium whitespace-nowrap">תאריך נר</th>}
                {showHammerCols && <th className="text-center pb-2 pr-3 font-medium whitespace-nowrap">נר</th>}
                {showHammerCols && <th className="text-right pb-2 pr-3 font-medium whitespace-nowrap">OHLC</th>}
                <th className="text-right pb-2 pr-3 font-medium">דרגה</th>
                <th className="pb-2 w-[3rem]" />
              </tr>
            </thead>
            <tbody>
              {sorted.map(s => {
                const sw = s as SignalMatch;
                const isHammerWeeklyRow = showWeeklyCandle && sw.isHammerWeekly;
                const displayExchange = (s as SectorStock).exchange;
                const candle = isHammerWeeklyRow
                  ? { date: sw.candleDate, open: sw.weekOpen ?? null, high: sw.weekHigh ?? null, low: sw.weekLow ?? null, close: sw.weekClose ?? null, label: "שבועי" }
                  : { date: sw.candleDate, open: sw.candleOpen ?? null, high: sw.candleHigh ?? null, low: sw.candleLow ?? null, close: sw.candleClose ?? null, label: "יומי" };
                return (
                  <tr
                    key={s.symbol}
                    className="border-b border-border/40 hover:bg-muted/30 transition-colors group"
                  >
                    {/* Symbol */}
                    <td className="py-2 pr-3">
                      <span className="font-mono font-bold text-foreground tracking-tight">{s.symbol}</span>
                      {displayExchange && (
                        <span className="block text-[9px] text-muted-foreground/50 font-mono">{displayExchange}</span>
                      )}
                    </td>

                    {/* Name */}
                    <td className="py-2 pr-3 max-w-[12rem]">
                      <span className="block truncate text-foreground/80">{s.name}</span>
                      {s.industry && (
                        <span className="block text-[9px] text-muted-foreground/50 truncate">{s.industry}</span>
                      )}
                    </td>

                    {/* Market cap */}
                    <td className="py-2 pr-3 text-right font-mono whitespace-nowrap">{s.marketCapFormatted}</td>

                    {/* Price */}
                    <td className="py-2 pr-3 text-right font-mono">
                      {s.price != null ? `$${s.price.toFixed(2)}` : "—"}
                    </td>

                    {/* Change 1d */}
                    <td className="py-2 pr-3 text-right font-mono">
                      <span className={`flex items-center justify-end gap-0.5 ${pctColor(s.change1d)}`}>
                        {s.change1d != null
                          ? s.change1d > 0
                            ? <><TrendingUp className="w-3 h-3" />+{s.change1d.toFixed(2)}%</>
                            : s.change1d < 0
                              ? <><TrendingDown className="w-3 h-3" />{s.change1d.toFixed(2)}%</>
                              : <><Minus className="w-3 h-3" />0.00%</>
                          : "—"}
                      </span>
                    </td>

                    {/* Unusual volume columns */}
                    {showRelVolCol && (
                      <td className="py-2 pr-3 text-right font-mono">
                        {s.relVolume != null ? (
                          <span className={`font-bold ${s.relVolume >= 3 ? "text-orange-400" : s.relVolume >= 2 ? "text-yellow-500" : "text-muted-foreground"}`}>
                            {s.relVolume.toFixed(2)}x
                          </span>
                        ) : <span className="text-muted-foreground/40">—</span>}
                      </td>
                    )}
                    {showRelVolCol && (
                      <td className="py-2 pr-3 text-right font-mono text-muted-foreground/80">
                        {fmtVol(s.volume)}
                      </td>
                    )}

                    {/* Regular columns (when not signal mode) */}
                    {!showRelVolCol && !showHammerCols && (
                      <td className="py-2 pr-3 text-right font-mono">
                        {s.pe != null
                          ? <span className={s.pe < 0 ? "text-rose-500/70" : ""}>{s.pe.toFixed(1)}</span>
                          : <span className="text-muted-foreground/40">—</span>}
                      </td>
                    )}
                    {!showRelVolCol && !showHammerCols && (
                      <td className="py-2 pr-3 text-right font-mono">
                        {s.beta != null
                          ? <span className={s.beta > 2 ? "text-rose-500/80" : s.beta > 1.5 ? "text-yellow-500/80" : ""}>{s.beta.toFixed(2)}</span>
                          : <span className="text-muted-foreground/40">—</span>}
                      </td>
                    )}

                    {/* vs 52W High */}
                    {!showRelVolCol && (
                      <td className="py-2 pr-3 text-right font-mono">
                        {s.vs52High != null
                          ? <span className={s.vs52High > -5 ? "text-emerald-500" : s.vs52High > -20 ? "text-yellow-500" : "text-rose-500/70"}>
                              {s.vs52High.toFixed(1)}%
                            </span>
                          : <span className="text-muted-foreground/40">—</span>}
                      </td>
                    )}
                    {!showRelVolCol && (
                      <td className="py-2 pr-3 text-right font-mono">
                        {s.vs200dma != null
                          ? <span className={s.vs200dma > 0 ? "text-emerald-500/80" : "text-rose-500/70"}>
                              {s.vs200dma > 0 ? "+" : ""}{s.vs200dma.toFixed(1)}%
                            </span>
                          : <span className="text-muted-foreground/40">—</span>}
                      </td>
                    )}

                    {showHammerCols && (
                      <td className="py-2 pr-3 text-right font-mono text-[10px] text-muted-foreground/80 whitespace-nowrap">
                        {candle.date ?? (isHammerWeeklyRow ? "שבוע אחרון" : "—")}
                      </td>
                    )}

                    {/* Hammer candle visual */}
                    {showHammerCols && (
                      <td className="py-1 pr-3 text-center">
                        <HammerVisual o={candle.open} h={candle.high} l={candle.low} c={candle.close} label={candle.label} />
                      </td>
                    )}
                    {showHammerCols && (
                      <td className="py-2 pr-3 text-right font-mono text-[9px] leading-4 whitespace-nowrap text-muted-foreground/80">
                        {candle.open != null && candle.high != null && candle.low != null && candle.close != null
                          ? <span>O {candle.open.toFixed(2)}<br />H {candle.high.toFixed(2)} · L {candle.low.toFixed(2)}<br />C {candle.close.toFixed(2)}</span>
                          : <span className="text-muted-foreground/40">—</span>}
                      </td>
                    )}

                    {/* Tier badge */}
                    <td className="py-2 pr-3 text-right whitespace-nowrap">
                      <Badge variant="outline" className={`text-[9px] px-1.5 py-0 h-4 font-normal ${TIER_BADGE[s.qualityTier]}`}>
                        {TIER_LABELS[s.qualityTier]}
                      </Badge>
                    </td>

                    {/* Analyze button */}
                    <td className="py-2 text-right">
                      <button
                        onClick={() => onSelectTicker(s.symbol)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 text-primary hover:text-primary/80 text-[10px] font-medium"
                      >
                        נתח<ExternalLink className="w-2.5 h-2.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer */}
      {sorted.length > 0 && (
        <div className="flex items-center justify-between text-[10px] text-muted-foreground/30 pt-1">
          <span>
            {filter === "unusual_volume" && <><Flame className="w-3 h-3 inline mr-1 text-orange-400/50" />relVolume ≥ 2.0x</>}
            {filter === "hammer_daily" && (
              <><Hammer className="w-3 h-3 inline mr-1 text-violet-400/50" />
                {marketDailyRequested ? "סריקת רשימות הסקטורים" : "סריקת סקטור"} — {signalData?.count ?? 0} התאמות מתוך {signalData?.scannedCount ?? 0} מניות
                {signalData?.candleDate ? ` · נר ${signalData.candleDate}` : ""}
                {isSignalIncomplete ? ` · כיסוי ${signalData?.successfulCount ?? 0}/${signalData?.scannedCount ?? 0}` : ""}
              </>
            )}
            {filter === "hammer_weekly"  && <><Hammer className="w-3 h-3 inline mr-1 text-cyan-400/50" />נר שבועי אחרון — {signalData?.count ?? 0} מתוך {signalData?.scannedCount ?? 0} מניות</>}
            {isTier(filter) && "Yahoo Finance • cache 30 דקות"}
          </span>
          <span>לחץ על שורה לניתוח מלא</span>
        </div>
      )}

      {/* Legend for hammer */}
      {showHammerCols && (
        <Card className="border-dashed">
          <CardContent className="py-3 px-4">
            <div className="flex items-start gap-6 text-[10px] text-muted-foreground/70">
              <div className="flex items-center gap-1.5">
                <BarChart2 className="w-3 h-3 text-primary/60" />
                <span>תצורת פטיש (Hammer): צל תחתון ארוך מרמז על דחייה של מחירים נמוכים וחזרה פוטנציאלית כלפי מעלה.</span>
              </div>
              <div className="shrink-0">
                <span className="text-emerald-500">ירוק</span> = close &gt; open &nbsp;|&nbsp;
                <span className="text-rose-500">אדום</span> = close &lt; open
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
