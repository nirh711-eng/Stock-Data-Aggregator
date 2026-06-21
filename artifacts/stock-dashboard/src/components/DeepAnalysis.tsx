import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { 
  BrainCircuit, 
  RefreshCw, 
  Network, 
  MapPin, 
  Swords, 
  ShieldCheck, 
  GitCompare, 
  TrendingUp, 
  Scale, 
  AlertTriangle,
  Lightbulb,
  Target,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Users,
  Globe,
  BarChart3,
  Calculator,
  Calendar,
  Activity,
  Skull,
  Clock
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

interface DeepAnalysisProps {
  ticker: string;
}

const QUERY_KEY = (ticker: string) => ["deep-analysis", ticker];

export function DeepAnalysis({ ticker }: DeepAnalysisProps) {
  const queryClient = useQueryClient();
  const [isRequested, setIsRequested] = useState(false);
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, isLoading, isFetching, isError, error } = useQuery<any>({
    queryKey: QUERY_KEY(ticker),
    queryFn: async () => {
      const res = await fetch(`/api/stocks/${encodeURIComponent(ticker)}/deep-analysis`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(body.message ?? `Error ${res.status}`);
      }
      return res.json();
    },
    enabled: !!ticker && isRequested,
    staleTime: 60 * 60 * 1000,
    retry: false,
    // Poll every 5 seconds while job is running
    refetchInterval: (q) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = q.state.data as any;
      return d?.status === "running" ? 5000 : false;
    },
  });

  const isRunning = data?.status === "running";

  // Elapsed timer — runs while polling
  useEffect(() => {
    if (isRequested && (isLoading || isRunning)) {
      if (!timerRef.current) {
        setElapsedSecs(0);
        timerRef.current = setInterval(() => setElapsedSecs(s => s + 1), 1000);
      }
    } else {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  }, [isRequested, isLoading, isRunning]);

  // Reset state when ticker changes
  useEffect(() => {
    setIsRequested(false);
    setElapsedSecs(0);
  }, [ticker]);

  const handleLoad = () => { setElapsedSecs(0); setIsRequested(true); };
  const handleRegenerate = () => {
    setElapsedSecs(0);
    queryClient.removeQueries({ queryKey: QUERY_KEY(ticker) });
    setIsRequested(false);
    setTimeout(() => setIsRequested(true), 50);
  };

  if (!isRequested) {
    return (
      <div className="flex flex-col items-center justify-center p-12 bg-card border border-border rounded-xl mt-8 text-center space-y-6 shadow-sm">
        <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center text-primary mb-2">
          <BrainCircuit className="w-8 h-8" />
        </div>
        <div className="max-w-md space-y-2">
          <h3 className="text-xl font-bold font-sans">Hedge Fund Deep Analysis</h3>
          <p className="text-muted-foreground text-sm">
            ניתוח מוסדי מלא — 15 שלבים: שרשרת ערך, הנהלה, ROIC, DCF 3 תרחישים, תחזית 5 שנים, מטריצת סיכונים ועוד. התהליך לוקח 60-90 שניות בפעם הראשונה ונשמר cache לשעה.
          </p>
        </div>
        <Button onClick={handleLoad} size="lg" className="font-semibold px-8">
          הפעל ניתוח עמוק
        </Button>
      </div>
    );
  }

  if (isError) {
    const errMsg = (error as Error)?.message ?? "שגיאה בטעינת הניתוח. ייתכן שהטיקר אינו נתמך או שאין נתונים פיננסיים מספיקים.";
    return (
      <div className="flex flex-col items-center justify-center p-12 bg-card border border-border rounded-xl mt-8 text-center space-y-4">
        <AlertTriangle className="w-10 h-10 text-rose-500" />
        <h3 className="text-lg font-bold text-rose-500">לא ניתן לבצע ניתוח</h3>
        <p className="text-sm text-muted-foreground max-w-sm">{errMsg}</p>
        <Button variant="outline" size="sm" onClick={() => { setIsRequested(false); }}>
          חזרה
        </Button>
      </div>
    );
  }

  if (isLoading || isRunning || (isFetching && !data?.companyName)) {
    const mins = Math.floor(elapsedSecs / 60);
    const secs = elapsedSecs % 60;
    const elapsedLabel = mins > 0 ? `${mins}:${String(secs).padStart(2, "0")}` : `${secs}s`;
    const steps = [
      "אוסף נתונים פיננסיים מ-Yahoo Finance",
      "טוען נתוני שוק ו-KPIs",
      "מנתח שרשרת ערך ומיקום בשוק",
      "מעריך הנהלה ויתרון תחרותי",
      "מחשב ROIC, DCF ותרחישי תמחור",
      "בונה מטריצת סיכונים ותחזית 5 שנים",
      "מסכם מסקנות מוסדיות",
    ];
    const currentStep = Math.min(Math.floor(elapsedSecs / 12), steps.length - 1);
    return (
      <div className="mt-8 space-y-6" dir="rtl">
        <div className="bg-card border border-border rounded-xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 text-primary">
              <BrainCircuit className="w-6 h-6 animate-pulse" />
              <span className="text-base font-semibold">מנתח {ticker} — ניתוח קרן גידור מלא</span>
            </div>
            <span className="flex items-center gap-1.5 text-sm font-mono text-muted-foreground">
              <Clock className="w-3.5 h-3.5" />
              {elapsedLabel}
            </span>
          </div>
          <div className="space-y-2">
            {steps.map((step, i) => (
              <div key={i} className={`flex items-center gap-2.5 text-sm transition-all duration-500 ${
                i < currentStep ? "text-positive" :
                i === currentStep ? "text-primary font-medium" :
                "text-muted-foreground/40"
              }`}>
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  i < currentStep ? "bg-positive" :
                  i === currentStep ? "bg-primary animate-pulse" :
                  "bg-muted-foreground/20"
                }`} />
                {step}
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground/60 text-center pt-1">
            הניתוח רץ ברקע — הדף יתעדכן אוטומטית כשיסתיים. אל תסגור את הדף.
          </p>
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <Card key={i} className="border-border">
              <CardHeader><Skeleton className="h-6 w-1/3" /></CardHeader>
              <CardContent className="space-y-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!data?.companyName) {
    return (
      <div className="mt-8 p-6 text-center text-destructive bg-destructive/10 rounded-lg">
        לא נטענו נתונים — נסה שוב.
      </div>
    );
  }

  const getConclusionBadgeColor = (classification: string) => {
    switch (classification) {
      case "value_pool": return "bg-green-500/20 text-green-500 border-green-500/30";
      case "hype": return "bg-orange-500/20 text-orange-500 border-orange-500/30";
      case "tactical": return "bg-blue-500/20 text-blue-500 border-blue-500/30";
      case "value_trap": return "bg-red-500/20 text-red-500 border-red-500/30";
      default: return "bg-gray-500/20 text-gray-500 border-gray-500/30";
    }
  };

  const Field = ({ label, content, isWarning = false, isGood = false }: { 
    label: string; content: React.ReactNode; isWarning?: boolean; isGood?: boolean 
  }) => (
    <div className="py-3">
      <div className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide opacity-80">{label}</div>
      <div className={`text-sm leading-relaxed ${isWarning ? "text-orange-400 font-medium" : isGood ? "text-green-400 font-medium" : "text-foreground"}`}>
        {content}
      </div>
    </div>
  );

  return (
    <div className="mt-12 space-y-6" dir="rtl">

      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-primary/10 rounded-lg text-primary">
            <BrainCircuit className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">ניתוח עמוק: {data.companyName}</h2>
            <p className="text-sm text-muted-foreground font-mono" dir="ltr">{ticker} · 15-Step Institutional Framework</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleRegenerate} disabled={isFetching} className="gap-2">
          <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
          <span>רענן</span>
        </Button>
      </div>

      <div className="space-y-5 font-sans">

        {/* ── 1. System Understanding ── */}
        <Card className="border-t-[3px] border-t-blue-500 bg-card/50 shadow-md">
          <CardHeader className="pb-3 border-b border-border/50 bg-muted/20">
            <CardTitle className="text-base flex items-center gap-2 text-blue-400">
              <Network className="w-4 h-4" />
              <span>שלב 1 — מהות המערכת ושרשרת הערך</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 grid grid-cols-1 md:grid-cols-2 gap-x-8 divide-y divide-border/30 md:divide-y-0">
            <div className="divide-y divide-border/30">
              <Field label="שרשרת הערך בתעשייה" content={data.systemUnderstanding.valueChain} />
              <Field label="מגמות מבניות" content={data.systemUnderstanding.macroTrends} />
            </div>
            <div className="divide-y divide-border/30 md:border-r md:border-border/30 md:pr-8">
              <Field label="צווארי בקבוק ויצירת ערך" content={data.systemUnderstanding.valueCreation} />
              <Field label="מנועי מאקרו" content={data.systemUnderstanding.bottlenecks} />
            </div>
          </CardContent>
        </Card>

        {/* ── 2. Company Positioning ── */}
        <Card className="border-t-[3px] border-t-purple-500 bg-card/50 shadow-md">
          <CardHeader className="pb-3 border-b border-border/50 bg-muted/20">
            <CardTitle className="text-base flex items-center gap-2 text-purple-400">
              <MapPin className="w-4 h-4" />
              <span>שלב 2 — מיקום החברה בשרשרת</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 divide-y divide-border/30">
            <Field label="מיקום בשרשרת הערך" content={data.companyPositioning.positionInChain} />
            <Field label="תפקיד פונקציונלי" content={data.companyPositioning.functionalRole} />
            <Field label="איכות המיקום" content={data.companyPositioning.positionQuality} />
          </CardContent>
        </Card>

        {/* ── 3. Management Assessment (NEW) ── */}
        {data.managementAssessment && (
          <Card className="border-t-[3px] border-t-indigo-500 bg-card/50 shadow-md">
            <CardHeader className="pb-3 border-b border-border/50 bg-muted/20">
              <CardTitle className="text-base flex items-center gap-2 text-indigo-400">
                <Users className="w-4 h-4" />
                <span>שלב 3 — פרופיל הנהלה (CEO, Track Record, Skin in the Game)</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 divide-y divide-border/30">
              <Field label="פרופיל CEO" content={data.managementAssessment.ceoProfile} />
              <Field label="Skin in the Game — אחזקות פנים ו-Alignment" content={data.managementAssessment.skinInGame} />
              <Field label="Track Record — הצלחות וכישלונות ניהוליים" content={data.managementAssessment.trackRecord} />
            </CardContent>
          </Card>
        )}

        {/* ── 4. Market Sizing (NEW) ── */}
        {data.marketSizing && (
          <Card className="border-t-[3px] border-t-sky-500 bg-card/50 shadow-md">
            <CardHeader className="pb-3 border-b border-border/50 bg-muted/20">
              <CardTitle className="text-base flex items-center gap-2 text-sky-400">
                <Globe className="w-4 h-4" />
                <span>שלב 4 — גודל שוק, CAGR וכוח תמחור</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-sky-500/5 border border-sky-500/20 rounded-lg p-4">
                <div className="text-sky-400 text-xs font-bold uppercase tracking-wide mb-2">TAM — גודל שוק כולל</div>
                <p className="text-sm text-foreground/90 leading-relaxed">{data.marketSizing.tam}</p>
              </div>
              <div className="bg-sky-500/5 border border-sky-500/20 rounded-lg p-4">
                <div className="text-sky-400 text-xs font-bold uppercase tracking-wide mb-2">CAGR — קצב צמיחה ענפי</div>
                <p className="text-sm text-foreground/90 leading-relaxed">{data.marketSizing.cagr}</p>
              </div>
              <div className="bg-sky-500/5 border border-sky-500/20 rounded-lg p-4">
                <div className="text-sky-400 text-xs font-bold uppercase tracking-wide mb-2">Pricing Power</div>
                <p className="text-sm text-foreground/90 leading-relaxed">{data.marketSizing.pricingPower}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── 5. Competitive Advantage ── */}
        <Card className="border-t-[3px] border-t-cyan-500 bg-card/50 shadow-md">
          <CardHeader className="pb-3 border-b border-border/50 bg-muted/20">
            <CardTitle className="text-base flex items-center gap-2 text-cyan-400">
              <Swords className="w-4 h-4" />
              <span>שלב 5 — יתרון תחרותי וחפיר (Moat)</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 divide-y divide-border/30">
            <Field label="בידול אמיתי" content={data.competitiveAdvantage.differentiation} />
            <Field label="יתרון בר-קיימא (Moat)" content={data.competitiveAdvantage.moat} />
            <Field label="נוף תחרותי" content={data.competitiveAdvantage.competitiveLandscape} />
          </CardContent>
        </Card>

        {/* ── 6. Value Capture Quality ── */}
        <Card className="border-t-[3px] border-t-amber-500 bg-card/50 shadow-md">
          <CardHeader className="pb-3 border-b border-border/50 bg-muted/20">
            <CardTitle className="text-base flex items-center gap-2 text-amber-400">
              <ShieldCheck className="w-4 h-4" />
              <span>שלב 6 — איכות לכידת ערך ומודל עסקי</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 divide-y divide-border/30">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
              <Field label="לכידת ערך" content={data.valueCaptureQuality.valueCapture} />
              <Field label="איכות ההכנסות" content={data.valueCaptureQuality.revenueQuality} />
            </div>
            <Field label="סימני אזהרה" content={data.valueCaptureQuality.warningSigns} isWarning />
          </CardContent>
        </Card>

        {/* ── 7. Financial Deep Dive (NEW) ── */}
        {data.financialDeepDive && (
          <Card className="border-t-[3px] border-t-emerald-400 bg-card/50 shadow-md">
            <CardHeader className="pb-3 border-b border-border/50 bg-muted/20">
              <CardTitle className="text-base flex items-center gap-2 text-emerald-400">
                <BarChart3 className="w-4 h-4" />
                <span>שלב 7 — ניתוח פיננסי עמוק (ROIC, כיסוי ריבית, CAPEX, EBITDA)</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 grid grid-cols-1 md:grid-cols-2 gap-x-8 divide-y divide-border/30 md:divide-y-0">
              <div className="divide-y divide-border/30">
                <Field label="ROIC vs WACC — יצירת ערך כלכלי" content={data.financialDeepDive.roicVsWacc} />
                <Field label="יחס כיסוי ריבית — סיכון פירעון" content={data.financialDeepDive.interestCoverageInsight} />
              </div>
              <div className="divide-y divide-border/30 md:border-r md:border-border/30 md:pr-8">
                <Field label="CAPEX — Growth vs Maintenance" content={data.financialDeepDive.capexQuality} />
                <Field label="EBITDA vs רווח נקי — פחת והפחתות" content={data.financialDeepDive.ebitdaToNetIncome} />
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── 8. Chain Comparison ── */}
        <Card className="border-t-[3px] border-t-teal-500 bg-card/50 shadow-md">
          <CardHeader className="pb-3 border-b border-border/50 bg-muted/20">
            <CardTitle className="text-base flex items-center gap-2 text-teal-400">
              <GitCompare className="w-4 h-4" />
              <span>שלב 8 — השוואה תחרותית בשרשרת</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 divide-y divide-border/30">
            <Field label="אלטרנטיבות טובות יותר" content={data.chainComparison.betterAlternatives} />
            <Field label="מיקום יחסי" content={data.chainComparison.relativePositioning} />
          </CardContent>
        </Card>

        {/* ── 9. Forward Looking + Analyst Consensus ── */}
        <Card className="border-t-[3px] border-t-green-500 bg-card/50 shadow-md">
          <CardHeader className="pb-3 border-b border-border/50 bg-muted/20">
            <CardTitle className="text-base flex items-center gap-2 text-green-400">
              <TrendingUp className="w-4 h-4" />
              <span>שלב 9 — מבט קדימה וקטליסטים</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-5">
            <div>
              <Field label="קטליסטים לשינוי תמחור" content={data.forwardLooking.catalysts} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-green-500/5 border border-green-500/20 rounded-lg p-4">
                <div className="text-green-400 font-bold mb-2 flex items-center gap-2 text-sm">
                  <div className="w-2 h-2 rounded-full bg-green-500" /> תרחיש שורי
                </div>
                <p className="text-sm text-green-100/80 leading-relaxed">{data.forwardLooking.bullCase}</p>
              </div>
              <div className="bg-gray-500/5 border border-gray-500/20 rounded-lg p-4">
                <div className="text-gray-400 font-bold mb-2 flex items-center gap-2 text-sm">
                  <div className="w-2 h-2 rounded-full bg-gray-500" /> תרחיש בסיס
                </div>
                <p className="text-sm text-gray-300 leading-relaxed">{data.forwardLooking.baseCase}</p>
              </div>
              <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-4">
                <div className="text-red-400 font-bold mb-2 flex items-center gap-2 text-sm">
                  <div className="w-2 h-2 rounded-full bg-red-500" /> תרחיש דובי
                </div>
                <p className="text-sm text-red-100/80 leading-relaxed">{data.forwardLooking.bearCase}</p>
              </div>
            </div>
            <div className="border-t border-border/30 pt-3">
              <Field label="תנאי ניצחון" content={data.forwardLooking.winConditions} />
            </div>

            {/* Analyst Consensus */}
            {data.analystConsensus && (
              <div className="pt-4 border-t border-border/40">
                <div className="flex items-center gap-2 mb-4">
                  <Target className="w-4 h-4 text-green-400" />
                  <span className="text-sm font-semibold text-green-400 uppercase tracking-wide">ציפיות אנליסטים</span>
                  {data.analystConsensus.numberOfAnalystOpinions != null && (
                    <span className="text-xs text-muted-foreground">({data.analystConsensus.numberOfAnalystOpinions} אנליסטים)</span>
                  )}
                </div>
                {data.analystConsensus.targetMeanPrice != null && (
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="bg-muted/30 rounded-lg p-3 text-center">
                      <div className="text-xs text-muted-foreground mb-1">יעד נמוך</div>
                      <div className="text-base font-bold text-red-400">${data.analystConsensus.targetLowPrice?.toFixed(2) ?? "—"}</div>
                    </div>
                    <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 text-center">
                      <div className="text-xs text-emerald-400 mb-1">יעד ממוצע</div>
                      <div className="text-lg font-bold text-emerald-400">${data.analystConsensus.targetMeanPrice.toFixed(2)}</div>
                    </div>
                    <div className="bg-muted/30 rounded-lg p-3 text-center">
                      <div className="text-xs text-muted-foreground mb-1">יעד גבוה</div>
                      <div className="text-base font-bold text-green-400">${data.analystConsensus.targetHighPrice?.toFixed(2) ?? "—"}</div>
                    </div>
                  </div>
                )}
                {(() => {
                  const ac = data.analystConsensus;
                  const total = ac.strongBuy + ac.buy + ac.hold + ac.sell + ac.strongSell;
                  if (total === 0) return null;
                  const bullPct = ((ac.strongBuy + ac.buy) / total * 100).toFixed(0);
                  const holdPct = (ac.hold / total * 100).toFixed(0);
                  const bearPct = ((ac.sell + ac.strongSell) / total * 100).toFixed(0);
                  const recKey = ac.recommendationKey?.toLowerCase() ?? "";
                  const recColor = recKey.includes("buy") ? "text-emerald-400" : recKey.includes("sell") ? "text-red-400" : "text-yellow-400";
                  const RecIcon = recKey.includes("buy") ? ArrowUpRight : recKey.includes("sell") ? ArrowDownRight : Minus;
                  return (
                    <div className="space-y-2 mb-4">
                      <div className="flex items-center justify-between mb-1">
                        <div className={`flex items-center gap-1 font-semibold text-sm ${recColor}`}>
                          <RecIcon className="w-4 h-4" />
                          <span className="uppercase tracking-wide">{ac.recommendationKey ?? "N/A"}</span>
                        </div>
                        <div className="text-xs text-muted-foreground flex gap-3">
                          <span className="text-green-400">קנייה {bullPct}%</span>
                          <span className="text-yellow-400">נייטרל {holdPct}%</span>
                          <span className="text-red-400">מכירה {bearPct}%</span>
                        </div>
                      </div>
                      <div className="flex h-2 rounded-full overflow-hidden gap-0.5">
                        <div className="bg-green-500 transition-all" style={{ width: `${bullPct}%` }} />
                        <div className="bg-yellow-500 transition-all" style={{ width: `${holdPct}%` }} />
                        <div className="bg-red-500 transition-all" style={{ width: `${bearPct}%` }} />
                      </div>
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Strong Buy {ac.strongBuy} · Buy {ac.buy}</span>
                        <span>Hold {ac.hold}</span>
                        <span>Sell {ac.sell} · Strong Sell {ac.strongSell}</span>
                      </div>
                    </div>
                  );
                })()}
                {data.analystConsensus.recentActions.length > 0 && (
                  <div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">שינויי דירוג אחרונים</div>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                      {data.analystConsensus.recentActions.map((action: any, i: number) => {
                        const isUpgrade = action.action === "up";
                        const isNew = action.action === "init" || action.action === "reit";
                        const grade = action.toGrade.toLowerCase();
                        const gradeColor = grade.includes("buy") || grade.includes("outperform") || grade.includes("overweight") || grade.includes("positive")
                          ? "text-green-400"
                          : grade.includes("sell") || grade.includes("underperform") || grade.includes("underweight") || grade.includes("negative")
                            ? "text-red-400"
                            : "text-yellow-400";
                        return (
                          <div key={i} className="flex items-center justify-between text-xs bg-muted/20 rounded px-3 py-1.5">
                            <div className="flex items-center gap-2 min-w-0">
                              {isUpgrade ? <ArrowUpRight className="w-3 h-3 text-green-400 shrink-0" /> : isNew ? <Minus className="w-3 h-3 text-blue-400 shrink-0" /> : <ArrowDownRight className="w-3 h-3 text-red-400 shrink-0" />}
                              <span className="text-muted-foreground truncate">{action.firm}</span>
                              {action.fromGrade && <span className="text-muted-foreground/50 shrink-0">← {action.fromGrade}</span>}
                              <span className={`font-semibold shrink-0 ${gradeColor}`}>{action.toGrade}</span>
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                              {action.currentPriceTarget != null && (
                                <span className="text-emerald-400 font-mono">${action.currentPriceTarget}</span>
                              )}
                              <span className="text-muted-foreground/60" dir="ltr">{action.date}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── 10. Valuation DCF (NEW) ── */}
        {data.valuationDCF && (
          <Card className="border-t-[3px] border-t-yellow-500 bg-card/50 shadow-md">
            <CardHeader className="pb-3 border-b border-border/50 bg-muted/20">
              <CardTitle className="text-base flex items-center gap-2 text-yellow-400">
                <Calculator className="w-4 h-4" />
                <span>שלב 10 — הערכת שווי DCF — 3 תרחישים + מכפיל היסטורי</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-green-500/5 border border-green-500/20 rounded-lg p-4">
                  <div className="text-green-400 font-bold mb-2 flex items-center gap-2 text-sm">
                    <div className="w-2 h-2 rounded-full bg-green-500" /> DCF שורי
                  </div>
                  <p className="text-sm text-green-100/80 leading-relaxed">{data.valuationDCF.bullDCF}</p>
                </div>
                <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-4">
                  <div className="text-blue-400 font-bold mb-2 flex items-center gap-2 text-sm">
                    <div className="w-2 h-2 rounded-full bg-blue-500" /> DCF בסיס
                  </div>
                  <p className="text-sm text-blue-100/80 leading-relaxed">{data.valuationDCF.baseDCF}</p>
                </div>
                <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-4">
                  <div className="text-red-400 font-bold mb-2 flex items-center gap-2 text-sm">
                    <div className="w-2 h-2 rounded-full bg-red-500" /> DCF דובי
                  </div>
                  <p className="text-sm text-red-100/80 leading-relaxed">{data.valuationDCF.bearDCF}</p>
                </div>
              </div>
              <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-lg p-4">
                <div className="text-yellow-400 text-xs font-bold uppercase tracking-wide mb-2">
                  <Scale className="w-3 h-3 inline mr-1" />
                  השוואה היסטורית למכפיל
                </div>
                <p className="text-sm text-foreground/90 leading-relaxed">{data.valuationDCF.historicalMultiple}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── 11. Event Analysis ── */}
        <Card className="border-t-[3px] border-t-violet-500 bg-card/50 shadow-md">
          <CardHeader className="pb-3 border-b border-border/50 bg-muted/20">
            <CardTitle className="text-base flex items-center gap-2 text-violet-400">
              <AlertTriangle className="w-4 h-4" />
              <span>שלב 11 — ניתוח הדוח הרבעוני האחרון</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 grid grid-cols-1 md:grid-cols-2 gap-x-8 divide-y divide-border/30 md:divide-y-0">
            <div className="divide-y divide-border/30">
              <Field label="Reality vs Narrative — מה באמת קרה" content={data.eventAnalysis?.realityVsNarrative} />
              <Field label="Second-Order Thinking — מה השוק מפספס" content={data.eventAnalysis?.secondOrderThinking} />
              <Field label="זרימת הון פוטנציאלית" content={data.eventAnalysis?.capitalFlow} />
              <Field label="רמת מהותיות — רעש או מגמה?" content={data.eventAnalysis?.materiality} />
            </div>
            <div className="divide-y divide-border/30 md:border-r md:border-border/30 md:pr-8">
              <Field label="מרוויחים פוטנציאליים" content={data.eventAnalysis?.winners} />
              <Field label="נפגעים פוטנציאליים" content={data.eventAnalysis?.losers} />
              <div className="pt-3">
                <div className="text-xs font-medium text-violet-400 mb-1.5 uppercase tracking-wide">תרגום לפעולה</div>
                <div className="text-sm leading-relaxed text-foreground font-medium p-3 bg-violet-500/10 rounded-md border border-violet-500/20">
                  {data.eventAnalysis?.actionableInsights}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── 12. Five-Year Forecast (NEW) ── */}
        {data.fiveYearForecast && (
          <Card className="border-t-[3px] border-t-orange-500 bg-card/50 shadow-md">
            <CardHeader className="pb-3 border-b border-border/50 bg-muted/20">
              <CardTitle className="text-base flex items-center gap-2 text-orange-400">
                <Calendar className="w-4 h-4" />
                <span>שלב 12 — תחזית 5 שנים (2025–2030)</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-5">
              <div className="bg-orange-500/5 border border-orange-500/20 rounded-lg p-5 text-sm text-foreground/90 leading-relaxed">
                {data.fiveYearForecast}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── 13. KPI Tracker (NEW) ── */}
        {data.kpiTracker && (
          <Card className="border-t-[3px] border-t-lime-500 bg-card/50 shadow-md">
            <CardHeader className="pb-3 border-b border-border/50 bg-muted/20">
              <CardTitle className="text-base flex items-center gap-2 text-lime-400">
                <Activity className="w-4 h-4" />
                <span>שלב 13 — טבלת KPIs לרבעון הבא</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-5">
              <div className="bg-lime-500/5 border border-lime-500/20 rounded-lg p-5">
                <div className="text-xs text-lime-400 uppercase tracking-wide font-bold mb-3">5 מדדים קריטיים לבדיקה — עם ספי אזהרה</div>
                <div className="text-sm text-foreground/90 leading-relaxed whitespace-pre-line">
                  {data.kpiTracker}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── 14. Risk Matrix (NEW) ── */}
        {data.riskMatrix && (
          <Card className="border-t-[3px] border-t-rose-600 bg-card/50 shadow-md">
            <CardHeader className="pb-3 border-b border-border/50 bg-muted/20">
              <CardTitle className="text-base flex items-center gap-2 text-rose-400">
                <Skull className="w-4 h-4" />
                <span>שלב 14 — מטריצת סיכונים ו-Pre-Mortem</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 divide-y divide-border/30">
              <Field label="שרשרת אספקה — ספקים קריטיים ותלויות" content={data.riskMatrix.supplyChain} isWarning />
              <div className="py-3">
                <div className="text-xs font-medium text-rose-400 mb-1.5 uppercase tracking-wide opacity-80">Pre-Mortem — תרחיש ההרס</div>
                <div className="text-sm leading-relaxed text-rose-200/90 bg-rose-500/5 border border-rose-500/20 rounded-lg p-4">
                  {data.riskMatrix.preMortem}
                </div>
              </div>
              <div className="py-3">
                <div className="text-xs font-medium text-orange-400 mb-1.5 uppercase tracking-wide opacity-80">Thesis Breaker — מה יהרוס את ההשקעה</div>
                <div className="text-sm leading-relaxed text-orange-200/90 bg-orange-500/5 border border-orange-500/20 rounded-lg p-4">
                  {data.riskMatrix.thesisBreaker}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── 15. Conclusion ── */}
        <Card className="border-[2px] border-primary/30 bg-card shadow-lg relative overflow-hidden mt-8">
          <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-primary/0 via-primary to-primary/0"></div>
          <CardContent className="pt-10 pb-8 px-8 text-center space-y-8 flex flex-col items-center">
            <div className="flex flex-col items-center gap-3">
              <div className="text-sm font-bold text-muted-foreground uppercase tracking-widest">שלב 15 — מסקנה סופית</div>
              <Badge className={`text-xl py-2 px-6 border-2 ${getConclusionBadgeColor(data.conclusion.classification)}`}>
                {data.conclusion.classificationLabel}
              </Badge>
            </div>
            <div className="max-w-3xl text-lg leading-relaxed text-foreground/90">
              {data.conclusion.reasoning}
            </div>
            <div className="w-full max-w-4xl pt-6 border-t border-border/50 text-right">
              <div className="flex items-center gap-2 text-primary font-bold mb-3 text-lg">
                <Lightbulb className="w-5 h-5" />
                <span>רעיונות לפעולה</span>
              </div>
              <div className="bg-primary/10 border border-primary/20 rounded-xl p-6 text-foreground font-medium leading-relaxed">
                {data.conclusion.actionableIdeas}
              </div>
            </div>
          </CardContent>
        </Card>

      </div>

      <div className="text-center text-xs text-muted-foreground font-mono pt-8 pb-4" dir="ltr">
        Analysis generated at: {new Date(data.generatedAt).toLocaleString()} · 15-step institutional framework
      </div>
    </div>
  );
}
