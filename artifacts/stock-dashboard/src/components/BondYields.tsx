import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, Minus, RefreshCw, AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface YieldPoint {
  maturity: string;
  label: string;
  years: number;
  rate: number | null;
  prevRate: number | null;
  change: number | null;
  date: string | null;
}

interface BondData {
  us: YieldPoint[];
  il: YieldPoint[];
  generatedAt: string;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function fetchBonds(): Promise<BondData> {
  const res = await fetch(`${BASE}/api/bonds`);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json() as Promise<BondData>;
}

// ── Yield Curve SVG ──────────────────────────────────────────────────────────

function YieldCurve({ points, color }: { points: YieldPoint[]; color: string }) {
  const valid = points.filter((p) => p.rate !== null);
  if (valid.length < 2) return null;

  const W = 320, H = 80, PAD = 12;
  const xs = valid.map((p) => p.years);
  const ys = valid.map((p) => p.rate!);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys) - 0.2, yMax = Math.max(...ys) + 0.2;

  const toX = (v: number) => PAD + ((v - xMin) / (xMax - xMin || 1)) * (W - PAD * 2);
  const toY = (v: number) => H - PAD - ((v - yMin) / (yMax - yMin || 1)) * (H - PAD * 2);

  const pts = valid.map((p) => `${toX(p.years).toFixed(1)},${toY(p.rate!).toFixed(1)}`);
  const path = `M ${pts.join(" L ")}`;

  // Fill area under curve
  const fillPts = [
    `${toX(valid[0].years).toFixed(1)},${H - PAD}`,
    ...pts,
    `${toX(valid[valid.length - 1].years).toFixed(1)},${H - PAD}`,
  ];
  const fillPath = `M ${fillPts.join(" L ")} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-14 overflow-visible">
      <defs>
        <linearGradient id={`grad-${color}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={fillPath} fill={`url(#grad-${color})`} />
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {valid.map((p) => (
        <circle
          key={p.maturity}
          cx={toX(p.years)}
          cy={toY(p.rate!)}
          r="3"
          fill={color}
          className="opacity-80"
        />
      ))}
    </svg>
  );
}

// ── Change Badge ─────────────────────────────────────────────────────────────

function ChangeBadge({ change }: { change: number | null }) {
  if (change === null) return <span className="text-muted-foreground text-xs">—</span>;
  const up = change > 0;
  const down = change < 0;
  const cls = up
    ? "text-red-400 flex items-center gap-0.5"
    : down
    ? "text-emerald-400 flex items-center gap-0.5"
    : "text-muted-foreground flex items-center gap-0.5";
  const Icon = up ? TrendingUp : down ? TrendingDown : Minus;
  const sign = up ? "+" : "";
  return (
    <span className={cls + " text-xs font-mono"}>
      <Icon className="w-3 h-3" />
      {sign}{change.toFixed(3)}
    </span>
  );
}

// ── Yield Table ──────────────────────────────────────────────────────────────

function YieldTable({ points, title, flag, color }: {
  points: YieldPoint[];
  title: string;
  flag: string;
  color: string;
}) {
  const valid = points.filter((p) => p.rate !== null);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="text-lg">{flag}</span>
        <h3 className="font-semibold text-sm text-foreground">{title}</h3>
        {valid.length > 0 && valid[0].date && (
          <span className="text-[11px] text-muted-foreground/50 font-mono mr-auto">{valid[0].date}</span>
        )}
      </div>

      {/* Yield curve sparkline */}
      <YieldCurve points={points} color={color} />

      {/* Table */}
      <div className="rounded-lg border border-border/50 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/30 border-b border-border/50">
              <th className="text-right py-1.5 px-3 text-[11px] font-medium text-muted-foreground">טווח</th>
              <th className="text-left py-1.5 px-3 text-[11px] font-medium text-muted-foreground">תשואה %</th>
              <th className="text-left py-1.5 px-3 text-[11px] font-medium text-muted-foreground">שינוי</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p, i) => (
              <tr
                key={p.maturity}
                className={`border-b border-border/30 last:border-0 hover:bg-muted/20 transition-colors ${
                  i % 2 === 0 ? "" : "bg-muted/10"
                }`}
              >
                <td className="py-2 px-3 text-right">
                  <span className="font-mono text-xs text-muted-foreground">{p.maturity}</span>
                  <span className="text-[10px] text-muted-foreground/50 mr-1.5">{p.label}</span>
                </td>
                <td className="py-2 px-3 text-left">
                  {p.rate !== null ? (
                    <span className="font-mono font-semibold text-foreground text-sm">
                      {p.rate.toFixed(3)}%
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-xs">N/A</span>
                  )}
                </td>
                <td className="py-2 px-3 text-left">
                  <ChangeBadge change={p.change} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Spread Highlights ─────────────────────────────────────────────────────────

function SpreadHighlights({ us, il }: { us: YieldPoint[]; il: YieldPoint[] }) {
  const us10 = us.find((p) => p.maturity === "10Y")?.rate ?? null;
  const us2 = us.find((p) => p.maturity === "2Y")?.rate ?? null;
  const il10 = il.find((p) => p.maturity === "10Y")?.rate ?? null;
  const ilShort = il.find((p) => p.maturity === "Short")?.rate ?? null;

  const spread2_10_us = us10 !== null && us2 !== null ? +(us10 - us2).toFixed(3) : null;
  const spread_short_10_il = il10 !== null && ilShort !== null ? +(il10 - ilShort).toFixed(3) : null;
  const spread_us_il = us10 !== null && il10 !== null ? +(il10 - us10).toFixed(3) : null;

  const SpreadCard = ({ label, value, desc }: { label: string; value: number | null; desc: string }) => {
    const positive = value !== null && value > 0;
    const inverted = value !== null && value < 0;
    return (
      <div className="bg-muted/20 rounded-lg p-3 border border-border/40 text-center space-y-0.5">
        <div className="text-[11px] text-muted-foreground">{label}</div>
        <div className={`font-mono font-bold text-base ${positive ? "text-amber-400" : inverted ? "text-blue-400" : "text-foreground"}`}>
          {value !== null ? `${value > 0 ? "+" : ""}${value.toFixed(3)}%` : "—"}
        </div>
        <div className="text-[10px] text-muted-foreground/60">{desc}</div>
        {inverted && value !== null && value < 0 && (
          <div className="text-[10px] text-yellow-500/70 flex items-center justify-center gap-1 mt-0.5">
            <AlertTriangle className="w-2.5 h-2.5" />
            עקום הפוך
          </div>
        )}
      </div>
    );
  };

  if (spread2_10_us === null && spread_short_10_il === null && spread_us_il === null) return null;

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">ספרדים מרכזיים</h4>
      <div className="grid grid-cols-3 gap-2">
        <SpreadCard label="🇺🇸 ספרד 2Y–10Y" value={spread2_10_us} desc="עקום ארה&quot;ב" />
        <SpreadCard label="🇮🇱 ריבית קצרה–10Y" value={spread_short_10_il} desc="עקום ישראל" />
        <SpreadCard label="🇮🇱–🇺🇸 10Y" value={spread_us_il} desc="פרמיית סיכון ישראל" />
      </div>
    </div>
  );
}

// ── Loading Skeleton ──────────────────────────────────────────────────────────

function BondsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[0, 1].map((i) => (
          <div key={i} className="space-y-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-14 w-full rounded-lg" />
            <div className="space-y-1.5">
              {[...Array(5)].map((_, j) => <Skeleton key={j} className="h-9 w-full" />)}
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function BondYields() {
  const { data, isLoading, isFetching, error, refetch, dataUpdatedAt } = useQuery<BondData>({
    queryKey: ["bonds"],
    queryFn: fetchBonds,
    refetchInterval: 5 * 60 * 1000,   // auto-refresh every 5 min
    staleTime: 4 * 60 * 1000,
    retry: 2,
  });

  const updatedLabel = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="space-y-6">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground">
            תשואות אג&quot;ח ממשלתי — ארה&quot;ב (FRED) ו-ישראל (stooq). מתעדכן אוטומטית כל 5 דקות.
          </p>
          {updatedLabel && (
            <p className="text-[11px] text-muted-foreground/50">עדכון אחרון: {updatedLabel}</p>
          )}
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="p-1.5 rounded-md hover:bg-muted/40 transition-colors text-muted-foreground hover:text-foreground"
          title="רענן"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Loading */}
      {isLoading && <BondsSkeleton />}

      {/* Error */}
      {error && !isLoading && (
        <div className="py-12 text-center space-y-2">
          <AlertTriangle className="w-7 h-7 text-yellow-500/60 mx-auto" />
          <p className="text-sm text-muted-foreground">לא ניתן לטעון נתוני אג&quot;ח כרגע</p>
          <button onClick={() => refetch()} className="text-xs text-primary hover:underline">נסה שוב</button>
        </div>
      )}

      {/* Data */}
      {!isLoading && data && (
        <>
          {/* Yield tables side by side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <YieldTable
              points={data.us}
              title='אג"ח ממשלת ארה"ב (UST)'
              flag="🇺🇸"
              color="#60a5fa"
            />
            <YieldTable
              points={data.il}
              title='אג"ח ממשלת ישראל'
              flag="🇮🇱"
              color="#34d399"
            />
          </div>

          {/* Spread highlights */}
          <SpreadHighlights us={data.us} il={data.il} />

          {/* Footnote */}
          <p className="text-[11px] text-muted-foreground/40 text-center">
            נתוני ארה&quot;ב: FRED (יומי) · נתוני ישראל: FRED/OECD (חודשי, ריבית BOI + 10Y) · עודכן: {new Date(data.generatedAt).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}
          </p>
        </>
      )}
    </div>
  );
}
