import { useState, useEffect, useCallback, useRef } from "react";
import { useScanMarketAlerts, type MarketAlert } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, ExternalLink, Activity, Zap, TrendingUp, TrendingDown, Clock, Bell, Info } from "lucide-react";

const LOCAL_ALERTS_KEY = "stockpulse_market_alerts_data";
const SEEN_ALERTS_KEY = "stockpulse_market_alerts_seen";

export function MarketAlerts({ 
  watchlist, 
  onSelectTicker 
}: { 
  watchlist: Array<{ ticker: string; companyName?: string | null; sector?: string | null }>;
  onSelectTicker: (ticker: string) => void;
}) {
  const [alerts, setAlerts] = useState<MarketAlert[]>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_ALERTS_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const { mutate: scanAlerts, isPending } = useScanMarketAlerts();
  const lastScanRef = useRef<number>(0);
  const hasCompletedInitialScanRef = useRef(false);
  const scanInFlightRef = useRef(false);

  const performScan = useCallback((force = false) => {
    if (!watchlist || watchlist.length === 0) return;
    if (scanInFlightRef.current) return;
    const now = Date.now();
    if (!force && now - lastScanRef.current < 5 * 60 * 1000) return;
    scanInFlightRef.current = true;
    
    scanAlerts(
      {
        data: {
          watchlist: watchlist.map(w => ({
            ticker: w.ticker,
            companyName: w.companyName,
            sector: w.sector,
          }))
        }
      },
      {
        onSuccess: (res) => {
          lastScanRef.current = Date.now();
          scanInFlightRef.current = false;
          
          setAlerts(prev => {
            const isInitialScan = !hasCompletedInitialScanRef.current;
            const seenStr = localStorage.getItem(SEEN_ALERTS_KEY);
            const seenIds = new Set<string>(seenStr ? JSON.parse(seenStr) : []);
            const newAlerts: MarketAlert[] = [];
            
            res.alerts.forEach(alert => {
              if (!seenIds.has(alert.id)) {
                newAlerts.push(alert);
                seenIds.add(alert.id);
              }
            });
            
            if (!isInitialScan && newAlerts.length > 0 && typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
               newAlerts.forEach(a => {
                 new Notification("StockPulse: התראת שוק", {
                   body: `${a.ticker}: ${a.title}`,
                   icon: "/favicon.ico"
                 });
               });
            }
            
            localStorage.setItem(SEEN_ALERTS_KEY, JSON.stringify(Array.from(seenIds)));
            hasCompletedInitialScanRef.current = true;
            
            const merged = [...res.alerts, ...prev].reduce((acc, current) => {
              if (!acc.some(x => x.id === current.id)) {
                acc.push(current);
              }
              return acc;
            }, [] as MarketAlert[]);
            
            merged.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
            
            const limited = merged.slice(0, 100);
            localStorage.setItem(LOCAL_ALERTS_KEY, JSON.stringify(limited));
            return limited;
          });
        },
        onError: () => {
          scanInFlightRef.current = false;
        },
      }
    );
  }, [watchlist, scanAlerts]);

  useEffect(() => {
    performScan();
    const interval = setInterval(() => performScan(), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [performScan]);

  if (watchlist.length === 0) {
    return (
      <div className="py-24 text-center space-y-6 bg-card border border-border rounded-xl shadow-sm">
        <div className="inline-flex items-center justify-center p-5 bg-muted rounded-full mb-2">
          <Bell className="w-10 h-10 text-muted-foreground" />
        </div>
        <h2 className="text-2xl font-semibold text-foreground">אין מניות במעקב</h2>
        <p className="text-muted-foreground max-w-md mx-auto text-lg leading-relaxed">
          סורק ההתראות החכם מנטר התפתחויות עבור המניות ברשימת המעקב שלך בלבד. הוסף מניות למעקב כדי להתחיל.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-xl p-5 shadow-sm flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="bg-primary/10 p-3 rounded-lg shrink-0">
          <Activity className="w-6 h-6 text-primary" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-foreground text-lg">סורק התראות וחדשות</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl leading-relaxed">
            המערכת סורקת באופן רציף מקורות מידע פיננסיים, הודעות חברה, ומגמות סקטוריאליות, 
            המסוננים <strong>אך ורק עבור {watchlist.length} המניות</strong> הנמצאות ברשימת המעקב שלך.
          </p>
        </div>
        <Button 
          variant="outline" 
          onClick={() => performScan(true)} 
          disabled={isPending} 
          className="shrink-0 font-medium bg-background"
        >
          <RefreshCw className={`w-4 h-4 ml-2 ${isPending ? "animate-spin" : ""}`} />
          {isPending ? "סורק..." : "סרוק כעת"}
        </Button>
      </div>

      <div className="space-y-4">
        {alerts.length === 0 && !isPending && (
          <div className="text-center py-20 bg-card/50 border border-dashed border-border rounded-xl">
             <Clock className="w-10 h-10 text-muted-foreground/30 mx-auto mb-4" />
             <p className="text-muted-foreground text-lg">לא נמצאו התראות חדשות לתיק המעקב שלך בשלב זה.</p>
          </div>
        )}
        
        {alerts.length === 0 && isPending && (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <Card key={i} className="animate-pulse shadow-sm border-border">
                <CardContent className="h-40 p-0 bg-muted/20" />
              </Card>
            ))}
          </div>
        )}

        {alerts.map(alert => (
          <Card 
            key={alert.id} 
            className="overflow-hidden border-l-[5px] transition-all hover:shadow-md bg-card/80 backdrop-blur-sm" 
            style={{ 
              borderLeftColor: alert.sentiment === 'positive' 
                ? 'hsl(var(--positive))' 
                : alert.sentiment === 'negative' 
                  ? 'hsl(var(--destructive))' 
                  : 'hsl(var(--primary))' 
            }}
          >
            <CardContent className="p-0">
              <div className="p-5 md:p-6">
                 <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
                   <div className="space-y-3 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge 
                          variant="default" 
                          className="font-mono text-sm cursor-pointer hover:bg-primary/90 transition-colors shadow-sm" 
                          onClick={() => onSelectTicker(alert.ticker)}
                        >
                          {alert.ticker}
                        </Badge>
                        <span className="text-xs font-medium text-foreground/80 bg-muted border border-border px-2.5 py-1 rounded-md">
                          {alert.subjectType === 'sector' ? 'השפעה סקטוריאלית' : 'אירוע חברה'}: {alert.subject}
                        </span>
                        <span className="text-xs text-muted-foreground flex items-center gap-1.5 ml-auto">
                          <Clock className="w-3.5 h-3.5" />
                          {new Date(alert.publishedAt).toLocaleString('he-IL', { 
                            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' 
                          })}
                        </span>
                      </div>
                      
                      <a 
                        href={alert.url} 
                        target="_blank" 
                        rel="noreferrer" 
                        className="text-xl font-bold hover:text-primary transition-colors text-foreground block leading-tight mt-2 mb-1"
                      >
                        {alert.title}
                      </a>
                      
                      <div className="text-sm text-muted-foreground flex items-center gap-2">
                        מקור: <span className="font-medium text-foreground/80">{alert.source}</span>
                        <span className="text-border mx-1">|</span>
                        <a 
                          href={alert.url} 
                          target="_blank" 
                          rel="noreferrer" 
                          className="inline-flex items-center text-primary/80 hover:text-primary font-medium transition-colors"
                        >
                          קרא מקור
                          <ExternalLink className="w-3.5 h-3.5 mr-1" />
                        </a>
                      </div>
                   </div>
                   
                   <div 
                     className={`shrink-0 flex items-center justify-center w-12 h-12 rounded-xl shadow-sm border ${
                       alert.sentiment === 'positive' 
                         ? 'bg-positive/10 text-positive border-positive/20' 
                         : alert.sentiment === 'negative' 
                           ? 'bg-destructive/10 text-destructive border-destructive/20' 
                           : 'bg-primary/10 text-primary border-primary/20'
                     }`}
                   >
                     {alert.sentiment === 'positive' 
                       ? <TrendingUp className="w-6 h-6" /> 
                       : alert.sentiment === 'negative' 
                         ? <TrendingDown className="w-6 h-6" /> 
                         : <Info className="w-6 h-6" />
                     }
                   </div>
                 </div>
                 
                 <div className="mt-5 pt-5 border-t border-border">
                   <h4 className="text-sm font-bold flex items-center gap-2 mb-2 text-foreground">
                     <Zap className={`w-4 h-4 ${
                       alert.sentiment === 'positive' ? 'text-positive' : alert.sentiment === 'negative' ? 'text-destructive' : 'text-primary'
                     }`} />
                     {alert.impactTitle}
                   </h4>
                   <p className="text-sm text-foreground/80 leading-relaxed max-w-4xl">
                     {alert.impactSummary}
                   </p>
                 </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}