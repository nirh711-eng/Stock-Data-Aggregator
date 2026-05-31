import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  TrendingUp, TrendingDown, RefreshCw, ArrowUpDown,
  ChevronUp, ChevronDown, Minus, ExternalLink,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

// ── Types ─────────────────────────────────────────────────────────────────────

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
  volumeFormatted: string | null;
  exchange: string | null;
  vs52High: number | null;
  vs200dma: number | null;
  qualityTier: "leader" | "mid" | "radar" | "speculative";
}

interface SectorData {
  sector: string;
  count: number;
  stocks: SectorStock[];
  cachedAt: string;
}

// ── Config ────────────────────────────────────────────────────────────────────

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

const TIERS = [
  { key: "all",         label: "הכל",              color: "text-muted-foreground" },
  { key: "leader",      label: "מובילים  >$10B",   color: "text-emerald-400" },
  { key: "mid",         label: "בינוני $1B–$10B",  color: "text-blue-400" },
  { key: "radar",       label: "מתחת לראדר",        color: "text-yellow-400" },
  { key: "speculative", label: "ספקולטיבי",         color: "text-rose-400" },
];

const TIER_BADGE: Record<string, string> = {
  leader:      "border-emerald-500/40 text-emerald-400 bg-emerald-500/10",
  mid:         "border-blue-500/40 text-blue-400 bg-blue-500/10",
  radar:       "border-yellow-500/40 text-yellow-400 bg-yellow-500/10",
  speculative: "border-rose-500/40 text-rose-400 bg-rose-500/10",
};

const TIER_LABELS: Record<string, string> = {
  leader: "מוביל", mid: "בינוני", radar: "מתחת לראדר", speculative: "ספקולטיבי",
};

type SortKey = "marketCap" | "change1d" | "pe" | "beta" | "vs52High";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "marketCap", label: "שווי שוק" },
  { key: "change1d",  label: "שינוי יומי" },
  { key: "pe",        label: "P/E" },
  { key: "beta",      label: "ביטא" },
  { key: "vs52High",  label: "מרחק מ-52W High" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

async function fetchSector(sector: string): Promise<SectorData> {
  const r = await fetch(`${BASE}/api/sectors/screen?sector=${encodeURIComponent(sector)}&limit=50`);
  if (!r.ok) throw new Error("Failed");
  return r.json() as Promise<SectorData>;
}

function fmt2(v: number | null | undefined, suffix = ""): string {
  if (v == null) return "—";
  return `${v.toFixed(2)}${suffix}`;
}

function pctColor(v: number | null): string {
  if (v == null) return "text-muted-foreground";
  if (v > 0) return "text-emerald-400";
  if (v < 0) return "text-rose-400";
  return "text-muted-foreground";
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  onSelectTicker: (ticker: string) => void;
}

export function SectorExplorer({ onSelectTicker }: Props) {
  const [sector, setSector]   = useState("Technology");
  const [tier, setTier]       = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("marketCap");
  const [sortAsc, setSortAsc] = useState(false);

  const { data, isLoading, isFetching, refetch } = useQuery<SectorData>({
    queryKey: ["sectorScreen", sector],
    queryFn:  () => fetchSector(sector),
    staleTime: 30 * 60 * 1000,
  });

  const sorted = useMemo(() => {
    if (!data?.stocks) return [];
    let list = tier === "all" ? [...data.stocks] : data.stocks.filter(s => s.qualityTier === tier);
    list.sort((a, b) => {
      let av: number | null = null;
      let bv: number | null = null;
      if (sortKey === "marketCap") { av = a.marketCap; bv = b.marketCap; }
      if (sortKey === "change1d")  { av = a.change1d;  bv = b.change1d;  }
      if (sortKey === "pe")        { av = a.pe != null && a.pe > 0 ? a.pe : null; bv = b.pe != null && b.pe > 0 ? b.pe : null; }
      if (sortKey === "beta")      { av = a.beta;       bv = b.beta;       }
      if (sortKey === "vs52High")  { av = a.vs52High;   bv = b.vs52High;   }
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return sortAsc ? av - bv : bv - av;
    });
    return list;
  }, [data, tier, sortKey, sortAsc]);

  const tierCounts = useMemo(() => {
    if (!data?.stocks) return {} as Record<string, number>;
    return data.stocks.reduce((acc, s) => { acc[s.qualityTier] = (acc[s.qualityTier] ?? 0) + 1; return acc; }, {} as Record<string, number>);
  }, [data]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(v => !v);
    else { setSortKey(key); setSortAsc(false); }
  };

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return <ArrowUpDown className="w-3 h-3 opacity-40" />;
    return sortAsc
      ? <ChevronUp className="w-3 h-3 text-primary" />
      : <ChevronDown className="w-3 h-3 text-primary" />;
  };

  const cachedMins = data?.cachedAt
    ? Math.round((Date.now() - new Date(data.cachedAt).getTime()) / 60000)
    : null;

  return (
    <div className="space-y-4">
      {/* Sector Chips */}
      <div className="flex flex-wrap gap-2">
        {SECTORS.map(s => (
          <button
            key={s.en}
            onClick={() => { setSector(s.en); setTier("all"); }}
            className={`text-xs px-3 py-1.5 rounded-full border transition-all font-medium
              ${sector === s.en
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"}`}
          >
            {s.he}
          </button>
        ))}
      </div>

      {/* Tier Filter + Sort + Cache info */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div className="flex flex-wrap gap-1.5">
          {TIERS.map(t => (
            <button
              key={t.key}
              onClick={() => setTier(t.key)}
              className={`text-[11px] px-2.5 py-1 rounded-full border transition-all
                ${tier === t.key
                  ? `border-current ${t.color} bg-current/10`
                  : "border-border text-muted-foreground hover:border-muted-foreground"}`}
            >
              {t.label}
              {t.key !== "all" && tierCounts[t.key] != null && (
                <span className="ml-1 opacity-60">({tierCounts[t.key]})</span>
              )}
              {t.key === "all" && data && (
                <span className="ml-1 opacity-60">({data.count})</span>
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {cachedMins != null && (
            <span className="text-[10px] text-muted-foreground/40">
              cache: לפני {cachedMins} דק׳
            </span>
          )}
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Sort bar */}
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground border-b border-border pb-2">
        <span className="mr-2 font-medium">ממיין:</span>
        {SORTS.map(s => (
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
      {isLoading ? (
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
      ) : sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-10">
          לא נמצאו מניות בסקטור זה.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left pb-2 pr-3 font-medium w-[5rem]">סמל</th>
                <th className="text-left pb-2 pr-3 font-medium min-w-[10rem]">חברה</th>
                <th className="text-right pb-2 pr-3 font-medium whitespace-nowrap">שווי שוק</th>
                <th className="text-right pb-2 pr-3 font-medium">מחיר</th>
                <th className="text-right pb-2 pr-3 font-medium">שינוי</th>
                <th className="text-right pb-2 pr-3 font-medium">P/E</th>
                <th className="text-right pb-2 pr-3 font-medium">ביטא</th>
                <th className="text-right pb-2 pr-3 font-medium whitespace-nowrap">מ-52W Hi</th>
                <th className="text-right pb-2 pr-3 font-medium whitespace-nowrap">vs SMA200</th>
                <th className="text-right pb-2 font-medium">דרגה</th>
                <th className="pb-2 w-[3rem]" />
              </tr>
            </thead>
            <tbody>
              {sorted.map(s => (
                <tr
                  key={s.symbol}
                  className="border-b border-border/40 hover:bg-muted/30 transition-colors group"
                >
                  {/* Symbol */}
                  <td className="py-2 pr-3">
                    <span className="font-mono font-bold text-foreground tracking-tight">{s.symbol}</span>
                    {s.exchange && (
                      <span className="block text-[9px] text-muted-foreground/50 font-mono">{s.exchange}</span>
                    )}
                  </td>

                  {/* Name + industry */}
                  <td className="py-2 pr-3 max-w-[14rem]">
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

                  {/* P/E */}
                  <td className="py-2 pr-3 text-right font-mono">
                    {s.pe != null
                      ? <span className={s.pe < 0 ? "text-rose-400/70" : ""}>{s.pe.toFixed(1)}</span>
                      : <span className="text-muted-foreground/40">—</span>}
                  </td>

                  {/* Beta */}
                  <td className="py-2 pr-3 text-right font-mono">
                    {s.beta != null
                      ? <span className={s.beta > 2 ? "text-rose-400/80" : s.beta > 1.5 ? "text-yellow-400/80" : ""}>{s.beta.toFixed(2)}</span>
                      : <span className="text-muted-foreground/40">—</span>}
                  </td>

                  {/* vs 52W High */}
                  <td className="py-2 pr-3 text-right font-mono">
                    {s.vs52High != null
                      ? <span className={s.vs52High > -5 ? "text-emerald-400" : s.vs52High > -20 ? "text-yellow-400" : "text-rose-400/70"}>
                          {s.vs52High.toFixed(1)}%
                        </span>
                      : <span className="text-muted-foreground/40">—</span>}
                  </td>

                  {/* vs SMA200 */}
                  <td className="py-2 pr-3 text-right font-mono">
                    {s.vs200dma != null
                      ? <span className={s.vs200dma > 0 ? "text-emerald-400/80" : "text-rose-400/70"}>
                          {s.vs200dma > 0 ? "+" : ""}{s.vs200dma.toFixed(1)}%
                        </span>
                      : <span className="text-muted-foreground/40">—</span>}
                  </td>

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
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer note */}
      {sorted.length > 0 && (
        <p className="text-[10px] text-muted-foreground/30 text-center pt-1">
          נתונים: FMP Screener + Yahoo Finance • cache 30 דקות • לחץ על שורה לניתוח מלא
        </p>
      )}
    </div>
  );
}
