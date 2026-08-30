import { useState } from "react";
import { AlertTriangle, Zap, TrendingUp, RefreshCw, ChevronDown, ChevronUp, ExternalLink, Clock, Target, Rocket, CircleDot, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery, useQueryClient } from "@tanstack/react-query";

interface ServingCompany {
  ticker: string;
  name: string;
  role: string;
  moat: string;
  marketCap: string;
}

interface Bottleneck {
  name: string;
  sector: string;
  description: string;
  powerSource: string;
  maturityLevel: string;
  servingCompanies: ServingCompany[];
  capitalFlow: string;
  whyItMatters: string;
  confidenceScore?: number;
  confidenceLabel?: string;
  evidence?: string[];
  quantitativeSignals?: {
    companiesCovered: number;
    avgMarketCap: string;
    avg52WeekPosition: number | null;
    avgRelativeVolume: number | null;
  };
}

interface NextBottleneck {
  name: string;
  sector: string;
  timeline: string;
  trigger: string;
  earlySignals: string;
  whyNow: string;
  positionedCompanies: Array<{ ticker: string; name: string; whyWin: string; marketCap: string }>;
  urgency: "high" | "medium" | "low";
  capitalFlowMap: string;
  confidenceScore?: number;
  confidenceLabel?: string;
  evidence?: string[];
}

interface BottleneckAnalysis {
  marketContext: string;
  currentBottlenecks: Bottleneck[];
  nextBottleneck: NextBottleneck;
  smartMoneyFlow: string;
  generatedAt: string;
}

const MATURITY_COLORS: Record<string, string> = {
  "בשל": "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  "בצמיחה": "bg-blue-500/15 text-blue-400 border-blue-500/30",
  "מתפתח": "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
};

const URGENCY_CONFIG: Record<string, { label: string; cls: string }> = {
  high:   { label: "דחיפות גבוהה", cls: "bg-rose-500/15 text-rose-400 border-rose-500/30" },
  medium: { label: "דחיפות בינונית", cls: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" },
  low:    { label: "אופק ארוך",      cls: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
};

const MKTCAP_COLORS: Record<string, string> = {
  Large: "bg-primary/10 text-primary border-primary/20",
  Mid:   "bg-violet-500/10 text-violet-400 border-violet-500/20",
  Small: "bg-orange-500/10 text-orange-400 border-orange-500/20",
};

function CompanyPill({ c, onClick }: { c: ServingCompany | { ticker: string; name: string; whyWin?: string; moat?: string; marketCap: string }; onClick?: (t: string) => void }) {
  return (
    <button
      onClick={() => onClick?.(c.ticker)}
      className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card hover:border-primary/50 hover:bg-primary/5 transition-all group text-left w-full"
    >
      <div className="flex-shrink-0">
        <span className="font-mono font-bold text-primary text-sm">{c.ticker}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-foreground font-medium truncate">{c.name}</div>
        <div className="text-[11px] text-muted-foreground truncate">
          {"role" in c ? c.role : ("whyWin" in c ? c.whyWin : "")}
        </div>
      </div>
      <div className="flex-shrink-0 flex items-center gap-1">
        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${MKTCAP_COLORS[c.marketCap] ?? ""}`}>
          {c.marketCap}
        </Badge>
        <ExternalLink className="w-3 h-3 text-muted-foreground/40 group-hover:text-primary/60 transition-colors" />
      </div>
    </button>
  );
}

function ConfidenceBadge({ score, label }: { score?: number; label?: string }) {
  if (typeof score !== "number") return null;
  const cls = score >= 75
    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
    : score >= 55
      ? "bg-yellow-500/15 text-yellow-400 border-yellow-500/30"
      : "bg-rose-500/15 text-rose-400 border-rose-500/30";
  return <Badge variant="outline" className={`text-[10px] border ${cls}`}>אמינות {label ?? "בינונית"} · {score}/100</Badge>;
}

function BottleneckCard({ b, idx, onSelectTicker }: { b: Bottleneck; idx: number; onSelectTicker?: (t: string) => void }) {
  const [expanded, setExpanded] = useState(idx === 0);

  return (
    <Card className="border-border bg-card overflow-hidden">
      <CardHeader className="pb-3 cursor-pointer" onClick={() => setExpanded(e => !e)}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-xs font-bold text-primary">{idx + 1}</span>
            </div>
            <div className="flex-1 min-w-0">
              <CardTitle className="text-base font-semibold leading-tight">{b.name}</CardTitle>
              <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                <Badge variant="outline" className="text-[10px] px-2 py-0">{b.sector}</Badge>
                <Badge variant="outline" className={`text-[10px] px-2 py-0 border ${MATURITY_COLORS[b.maturityLevel] ?? ""}`}>
                  {b.maturityLevel}
                </Badge>
                <ConfidenceBadge score={b.confidenceScore} label={b.confidenceLabel} />
                <span className="text-[10px] text-muted-foreground/60 flex items-center gap-1">
                  <Zap className="w-2.5 h-2.5" /> {b.powerSource}
                </span>
              </div>
            </div>
          </div>
          <button className="text-muted-foreground hover:text-foreground flex-shrink-0 mt-1">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0 space-y-4" dir="rtl">
          <p className="text-sm text-muted-foreground leading-relaxed">{b.description}</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-lg bg-muted/40 border border-border p-3 space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1">
                <Target className="w-3 h-3" /> למה זה חשוב
              </div>
              <p className="text-sm text-foreground leading-snug">{b.whyItMatters}</p>
            </div>
            <div className="rounded-lg bg-muted/40 border border-border p-3 space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1">
                <TrendingUp className="w-3 h-3" /> זרימת הון
              </div>
              <p className="text-sm text-foreground leading-snug">{b.capitalFlow}</p>
            </div>
          </div>

          {b.evidence?.length ? (
            <div className="rounded-lg border border-primary/15 bg-primary/5 p-3">
              <div className="text-[10px] uppercase tracking-wider text-primary/70 font-medium mb-2">למה להאמין לזה</div>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {b.evidence.map((item, evidenceIndex) => <li key={evidenceIndex}>• {item}</li>)}
              </ul>
              {b.quantitativeSignals && (
                <div className="mt-2 text-[11px] text-muted-foreground">
                  כיסוי חי: {b.quantitativeSignals.companiesCovered} חברות · שווי ממוצע: {b.quantitativeSignals.avgMarketCap}
                  {b.quantitativeSignals.avg52WeekPosition !== null && ` · מיקום 52 שבועות: ${b.quantitativeSignals.avg52WeekPosition.toFixed(0)}%`}
                  {b.quantitativeSignals.avgRelativeVolume !== null && ` · נפח יחסי: ${b.quantitativeSignals.avgRelativeVolume.toFixed(2)}x`}
                </div>
              )}
            </div>
          ) : null}

          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2 flex items-center gap-1">
              <CircleDot className="w-3 h-3" /> חברות שמשרתות את הצוואר
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {b.servingCompanies?.map((c) => (
                <CompanyPill key={c.ticker} c={c} onClick={onSelectTicker} />
              ))}
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function SkeletonCard() {
  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <Skeleton className="w-7 h-7 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
        <div className="grid grid-cols-2 gap-2">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-14 rounded-lg" />)}
        </div>
      </CardContent>
    </Card>
  );
}

interface Props {
  onSelectTicker?: (ticker: string) => void;
}

export function BottleneckExplorer({ onSelectTicker }: Props) {
  const queryClient = useQueryClient();
  const [isRequested, setIsRequested] = useState(false);

  const { data, isLoading, isError, error } = useQuery<BottleneckAnalysis>({
    queryKey: ["bottlenecks"],
    queryFn: async () => {
      const res = await fetch("/api/bottlenecks");
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(body.message ?? "שגיאה בטעינת ניתוח");
      }
      return res.json() as Promise<BottleneckAnalysis>;
    },
    enabled: isRequested,
    staleTime: 6 * 60 * 60 * 1000,
    retry: false,
  });

  const handleRefresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["bottlenecks"] });
  };

  if (!isRequested) {
    return (
      <div className="flex flex-col items-center justify-center p-12 bg-card border border-border rounded-xl text-center space-y-6 shadow-sm" dir="rtl">
        <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center text-primary">
          <Zap className="w-8 h-8" />
        </div>
        <div className="max-w-md space-y-2">
          <h3 className="text-xl font-bold">ניתוח צווארי בקבוק</h3>
          <p className="text-muted-foreground text-sm leading-relaxed">
            ניתוח AI מבניות — מזהה היכן הכוח האמיתי מרוכז בשוק עכשיו, אילו חברות שולטות בכל צוואר, ואיזה צוואר חדש מתחיל להיבנות בשלושה עד שמונה עשר חודשים הקרובים.
          </p>
          <p className="text-xs text-muted-foreground/60">התוצאה נשמרת cache ל-6 שעות</p>
        </div>
        <Button onClick={() => setIsRequested(true)} size="lg" className="font-semibold px-8">
          הפעל ניתוח שוק
        </Button>
      </div>
    );
  }

  if (isError) {
    const msg = (error as Error)?.message ?? "שגיאה לא ידועה";
    return (
      <div className="flex flex-col items-center justify-center p-12 bg-card border border-border rounded-xl text-center space-y-4" dir="rtl">
        <AlertTriangle className="w-10 h-10 text-rose-500" />
        <h3 className="text-lg font-bold text-rose-500">שגיאה בטעינת ניתוח</h3>
        <p className="text-sm text-muted-foreground max-w-sm">{msg}</p>
        <Button variant="outline" size="sm" onClick={() => setIsRequested(false)}>חזרה</Button>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-5" dir="rtl">
        <div className="flex items-center gap-3 text-primary animate-pulse py-2">
          <Zap className="w-5 h-5" />
          <span className="text-base font-medium">מנתח מבנה שוק — זיהוי צווארי בקבוק וזרימת הון חכמה...</span>
        </div>
        {[1, 2, 3].map(i => <SkeletonCard key={i} />)}
      </div>
    );
  }

  const urgencyConf = URGENCY_CONFIG[data.nextBottleneck?.urgency ?? "medium"];

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" />
            צווארי בקבוק — מפת כוח בשוק
          </h2>
          {data.generatedAt && (
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              עודכן: {new Date(data.generatedAt).toLocaleDateString("he-IL", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} className="flex-shrink-0 gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" />
          רענן
        </Button>
      </div>

      {/* Market Context */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-4">
          <div className="text-[10px] uppercase tracking-wider text-primary/70 font-medium mb-2 flex items-center gap-1">
            <TrendingUp className="w-3 h-3" /> הקשר מאקרו נוכחי
          </div>
          <p className="text-sm text-foreground leading-relaxed">{data.marketContext}</p>
        </CardContent>
      </Card>

      {/* Current Bottlenecks */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
          <CircleDot className="w-3.5 h-3.5" />
          צווארי בקבוק קיימים — היכן הכוח מרוכז עכשיו
        </h3>
        <div className="space-y-3">
          {data.currentBottlenecks?.map((b, i) => (
            <BottleneckCard key={i} b={b} idx={i} onSelectTicker={onSelectTicker} />
          ))}
        </div>
      </div>

      {/* Smart Money Flow */}
      <Card className="border-emerald-500/20 bg-emerald-500/5">
        <CardContent className="p-4">
          <div className="text-[10px] uppercase tracking-wider text-emerald-400 font-medium mb-2 flex items-center gap-1">
            <TrendingUp className="w-3 h-3" /> Smart Money Flow — לאן הכסף החכם זז
          </div>
          <p className="text-sm text-foreground leading-relaxed">{data.smartMoneyFlow}</p>
        </CardContent>
      </Card>

      {/* Next Bottleneck */}
      {data.nextBottleneck && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
            <Rocket className="w-3.5 h-3.5" />
            צוואר הבקבוק הבא — לפני שהשוק מתמחר
          </h3>
          <Card className="border-violet-500/30 bg-violet-500/5 overflow-hidden">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-lg font-bold text-violet-300">{data.nextBottleneck.name}</CardTitle>
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    <Badge variant="outline" className="text-[10px]">{data.nextBottleneck.sector}</Badge>
                    <Badge variant="outline" className={`text-[10px] border ${urgencyConf?.cls ?? ""}`}>
                      {urgencyConf?.label}
                    </Badge>
                    <ConfidenceBadge score={data.nextBottleneck.confidenceScore} label={data.nextBottleneck.confidenceLabel} />
                    <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" /> {data.nextBottleneck.timeline}
                    </span>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-lg bg-background/50 border border-violet-500/20 p-3 space-y-1">
                  <div className="text-[10px] uppercase tracking-wider text-violet-400 font-medium flex items-center gap-1">
                    <Zap className="w-3 h-3" /> טריגר להיווצרות
                  </div>
                  <p className="text-sm leading-snug">{data.nextBottleneck.trigger}</p>
                </div>
                <div className="rounded-lg bg-background/50 border border-violet-500/20 p-3 space-y-1">
                  <div className="text-[10px] uppercase tracking-wider text-violet-400 font-medium flex items-center gap-1">
                    <CircleDot className="w-3 h-3" /> איתותים מוקדמים עכשיו
                  </div>
                  <p className="text-sm leading-snug">{data.nextBottleneck.earlySignals}</p>
                </div>
                <div className="rounded-lg bg-background/50 border border-violet-500/20 p-3 space-y-1">
                  <div className="text-[10px] uppercase tracking-wider text-violet-400 font-medium flex items-center gap-1">
                    <Target className="w-3 h-3" /> למה עכשיו
                  </div>
                  <p className="text-sm leading-snug">{data.nextBottleneck.whyNow}</p>
                </div>
                <div className="rounded-lg bg-background/50 border border-violet-500/20 p-3 space-y-1">
                  <div className="text-[10px] uppercase tracking-wider text-violet-400 font-medium flex items-center gap-1">
                    <ArrowRight className="w-3 h-3" /> מפת זרימת הון
                  </div>
                  <p className="text-sm leading-snug">{data.nextBottleneck.capitalFlowMap}</p>
                </div>
              </div>

              {data.nextBottleneck.evidence?.length ? (
                <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-violet-400 font-medium mb-2">ראיות מוקדמות</div>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {data.nextBottleneck.evidence.map((item, evidenceIndex) => <li key={evidenceIndex}>• {item}</li>)}
                  </ul>
                </div>
              ) : null}

              <div>
                <div className="text-[10px] uppercase tracking-wider text-violet-400 font-medium mb-2 flex items-center gap-1">
                  <Rocket className="w-3 h-3" /> חברות שמוצבות לנצח — לפני השוק
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {data.nextBottleneck.positionedCompanies?.map((c) => (
                    <CompanyPill key={c.ticker} c={c} onClick={onSelectTicker} />
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
