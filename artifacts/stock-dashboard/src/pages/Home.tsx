import { useState, useEffect, useRef } from "react";
import { Search, TrendingUp, TrendingDown, Clock, Building2, Calendar, FileText, Activity, Star, RefreshCw, AlertTriangle, BarChart2, ArrowUpDown, Layers, Globe, Grid2X2, Zap, MessageSquare, Landmark, Bell, Cloud, LogOut, ShieldCheck } from "lucide-react";
import { useClerk, useUser } from "@clerk/react";
import { useLocation } from "wouter";
import { 
  useGetStockData, 
  useGetStockSummary, 
  getGetStockDataQueryKey, 
  getGetStockSummaryQueryKey,
  getGetStockAnalyticsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { DeepAnalysis } from "@/components/DeepAnalysis";
import { DailyAnalysis } from "@/components/DailyAnalysis";
import { CompanyProfile } from "@/components/CompanyProfile";
import { SectorExplorer } from "@/components/SectorExplorer";
import { NotificationCenter } from "@/components/NotificationCenter";
import { TradingViewChart } from "@/components/TradingViewChart";
import { StockAnalyticsPanel } from "@/components/StockAnalytics";
import { MarketReport } from "@/components/MarketReport";
import { MarketHeatmap } from "@/components/MarketHeatmap";
import { EconomicCalendar } from "@/components/EconomicCalendar";
import { BottleneckExplorer } from "@/components/BottleneckExplorer";
import { SocialPulse } from "@/components/SocialPulse";
import { BondYields } from "@/components/BondYields";
import { MarketAlerts } from "@/components/MarketAlerts";
import { useWatchlist } from "@/hooks/useWatchlist";
import { useUsageTracking } from "@/hooks/useUsageTracking";

const POPULAR_TICKERS = ["AAPL", "TSLA", "NVDA", "MSFT"];
type ActiveTab = "search" | "sectors" | "market" | "heatmap" | "economy" | "bottlenecks" | "social" | "bonds" | "alerts";

function useTimeSince(isoString: string | null | undefined): string {
  const [label, setLabel] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isoString) { setLabel(""); return; }
    const update = () => {
      const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
      if (diff < 60) setLabel(`לפני ${diff} שניות`);
      else if (diff < 3600) setLabel(`לפני ${Math.floor(diff / 60)} דקות`);
      else setLabel(`לפני ${Math.floor(diff / 3600)} שעות`);
    };
    update();
    timerRef.current = setInterval(update, 10000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isoString]);

  return label;
}

function formatVolume(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(v);
}

const formatHebrewNumber = (num: number, options?: Intl.NumberFormatOptions) => {
  return new Intl.NumberFormat("he-IL", options).format(num);
};

export default function Home() {
  const [searchInput, setSearchInput] = useState("");
  const [activeTicker, setActiveTicker] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>("search");
  const [visitedTabs, setVisitedTabs] = useState<Set<ActiveTab>>(() => new Set(["search"]));
  const queryClient = useQueryClient();
  const { signOut } = useClerk();
  const { user } = useUser();
  const [, setLocation] = useLocation();
  const [isAdmin, setIsAdmin] = useState(false);
  const { track } = useUsageTracking();
  const trackedAnalysisTickersRef = useRef(new Set<string>());

  const switchTab = (tab: ActiveTab) => {
    setActiveTab(tab);
    setVisitedTabs((previous) => {
      if (previous.has(tab)) return previous;
      return new Set(previous).add(tab);
    });
  };

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/access/status", { credentials: "include", cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<{ isAdmin?: boolean }> : null)
      .then((payload) => {
        if (!cancelled) setIsAdmin(Boolean(payload?.isAdmin));
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    track("tab_view", { metadata: { tab: activeTab } });
    if (activeTab === "alerts") track("alert_view");
  }, [activeTab, track]);

  const {
    watchlist,
    alerts,
    unreadCount,
    isChecking,
    isWatched,
    addToWatchlist,
    removeFromWatchlist,
    updateLastKnownDate,
    markAllRead,
    clearAlerts,
    requestNotificationPermission,
    syncStatus,
  } = useWatchlist();

  const { data: stockData, isLoading: isLoadingData, isFetching: isFetchingData } = useGetStockData(activeTicker || "", {
    query: {
      enabled: !!activeTicker,
      queryKey: getGetStockDataQueryKey(activeTicker || ""),
    },
  });

  const { data: stockSummary, isLoading: isLoadingSummary } = useGetStockSummary(activeTicker || "", {
    query: {
      enabled: !!activeTicker,
      queryKey: getGetStockSummaryQueryKey(activeTicker || ""),
    },
  });

  useEffect(() => {
    if (stockData && activeTicker && isWatched(activeTicker)) {
      updateLastKnownDate(activeTicker, stockData.quarterlyReport.reportDate ?? null);
    }
  }, [stockData, activeTicker, isWatched, updateLastKnownDate]);

  useEffect(() => {
    if (!stockData || !activeTicker || activeTab !== "search" || trackedAnalysisTickersRef.current.has(activeTicker)) return;
    trackedAnalysisTickersRef.current.add(activeTicker);
    track("analysis_view", { ticker: activeTicker });
  }, [activeTab, activeTicker, stockData, track]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchInput.trim()) {
      const ticker = searchInput.trim().toUpperCase();
      setActiveTicker(ticker);
      track("stock_search", { ticker, metadata: { source: "search_form" } });
    }
  };

  const selectTicker = (ticker: string) => {
    setSearchInput(ticker);
    setActiveTicker(ticker);
    track("stock_search", { ticker, metadata: { source: "selection" } });
    switchTab("search");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleRefresh = () => {
    if (!activeTicker) return;
    queryClient.invalidateQueries({ queryKey: getGetStockDataQueryKey(activeTicker) });
    queryClient.invalidateQueries({ queryKey: getGetStockSummaryQueryKey(activeTicker) });
    queryClient.invalidateQueries({ queryKey: getGetStockAnalyticsQueryKey(activeTicker) });
  };

  const handleWatchlistToggle = async () => {
    if (!activeTicker) return;
    if (isWatched(activeTicker)) {
      removeFromWatchlist(activeTicker);
      track("watchlist_remove", { ticker: activeTicker });
    } else {
      if (watchlist.length >= 20) {
        window.alert("ניתן לעקוב אחר עד 20 טיקרים בכל פעם. הסר טיקר קיים כדי להוסיף חדש.");
        return;
      }
      await requestNotificationPermission();
      addToWatchlist(
        activeTicker, 
        stockData?.quarterlyReport.reportDate ?? null,
        stockData?.companyName ?? null,
        stockData?.sector ?? null
      );
      track("watchlist_add", { ticker: activeTicker });
    }
  };

  const addTickerFromAlerts = async (ticker: string): Promise<string | null> => {
    try {
      const response = await fetch(`/api/stocks/${ticker}`);
      if (!response.ok) {
        return `לא נמצא טיקר ${ticker}. בדוק את הסימול ונסה שוב.`;
      }
      const data = await response.json() as {
        companyName?: string | null;
        sector?: string | null;
        quarterlyReport?: { reportDate?: string | null };
      };
      addToWatchlist(
        ticker,
        data.quarterlyReport?.reportDate ?? null,
        data.companyName ?? null,
        data.sector ?? null,
      );
      return null;
    } catch {
      return "לא ניתן לאמת את הטיקר כרגע. בדוק את החיבור ונסה שוב.";
    }
  };

  const watched = activeTicker ? isWatched(activeTicker) : false;
  const timeSinceMarket = useTimeSince(stockData?.regularMarketTime);

  return (
    <div className="min-h-screen bg-background text-foreground font-sans p-4 md:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Header / Search */}
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-6 border-b border-border">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary flex items-center gap-2">
              <Activity className="w-6 h-6" />
              StockPulse
            </h1>
            <p className="text-sm text-muted-foreground mt-1">מודיעין שוק מקצועי</p>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Cloud className={`h-3.5 w-3.5 ${syncStatus === "offline" ? "text-amber-600" : "text-primary"}`} />
              {syncStatus === "syncing"
                ? "ממזגים את הנתונים המקומיים עם החשבון…"
                : syncStatus === "offline"
                  ? "הנתונים נשמרו במכשיר וייסתנכרנו כשתתחבר שוב"
                  : "רשימת המעקב והמקורות שלך מסונכרנים לחשבון"}
            </p>
          </div>
          
          <div className="flex items-center gap-3 w-full md:w-auto">
            <form onSubmit={handleSearch} className="w-full md:w-96 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input 
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="הזן טיקר (לדוגמה AAPL)..."
                className="pl-10 bg-card border-card-border font-mono uppercase text-lg"
              />
              <Button type="submit" className="absolute right-1 top-1/2 -translate-y-1/2 h-8 px-3 text-xs" variant="secondary">
                חפש
              </Button>
            </form>
            <NotificationCenter
              alerts={alerts}
              unreadCount={unreadCount}
              isChecking={isChecking}
              onMarkAllRead={markAllRead}
              onClearAlerts={clearAlerts}
              onTickerClick={selectTicker}
            />
            {isAdmin && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setLocation("/admin")}
                title="ניהול משתמשים ושימוש"
                className="shrink-0"
                data-testid="admin-dashboard-link"
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                <span className="hidden lg:inline">ניהול</span>
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void signOut({ redirectUrl: import.meta.env.BASE_URL })}
              title={`התנתק${user?.firstName ? ` (${user.firstName})` : ""}`}
              className="shrink-0"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden lg:inline">התנתקות</span>
            </Button>
          </div>
        </header>

        {/* Tab Bar */}
        <div className="flex items-center gap-1 overflow-x-auto border-b border-border pb-0 -mb-2">
          <button
            onClick={() => switchTab("search")}
            data-testid="tab-search"
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px
              ${activeTab === "search"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"}`}
          >
            <Search className="w-3.5 h-3.5" />
            חיפוש מניה
          </button>
          <button
            onClick={() => switchTab("sectors")}
            data-testid="tab-sectors"
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px
              ${activeTab === "sectors"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"}`}
          >
            <Layers className="w-3.5 h-3.5" />
            סקטורים
          </button>
          <button
            onClick={() => switchTab("market")}
            data-testid="tab-market-report"
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px
              ${activeTab === "market"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"}`}
          >
            <Globe className="w-3.5 h-3.5" />
            סיכום יומי
          </button>
          <button
            onClick={() => switchTab("heatmap")}
            data-testid="tab-heatmap"
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px
              ${activeTab === "heatmap"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"}`}
          >
            <Grid2X2 className="w-3.5 h-3.5" />
            מפת חום
          </button>
          <button
            onClick={() => switchTab("economy")}
            data-testid="tab-economic-calendar"
            className={`flex shrink-0 items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px
              ${activeTab === "economy"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"}`}
          >
            <Calendar className="w-3.5 h-3.5" />
            נתונים כלכליים
          </button>
          <button
            onClick={() => switchTab("bottlenecks")}
            data-testid="tab-bottlenecks"
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px
              ${activeTab === "bottlenecks"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"}`}
          >
            <Zap className="w-3.5 h-3.5" />
            צווארי בקבוק
          </button>
          <button
            onClick={() => switchTab("social")}
            data-testid="tab-social"
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px
              ${activeTab === "social"
                ? "border-orange-400 text-orange-300"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"}`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            סנטימנט חברתי
          </button>
          <button
            onClick={() => switchTab("bonds")}
            data-testid="tab-bonds"
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px
              ${activeTab === "bonds"
                ? "border-emerald-400 text-emerald-300"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"}`}
          >
            <Landmark className="w-3.5 h-3.5" />
            תשואות אג&quot;ח
          </button>
          <button
            onClick={() => switchTab("alerts")}
            data-testid="tab-alerts"
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px
              ${activeTab === "alerts"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"}`}
          >
            <Bell className="w-3.5 h-3.5" />
            התראות שוק
          </button>
        </div>

        {/* Alerts Tab */}
        {visitedTabs.has("alerts") && (
          <div hidden={activeTab !== "alerts"} className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <MarketAlerts
              watchlist={watchlist}
              onSelectTicker={selectTicker}
              onAddTicker={addTickerFromAlerts}
              onRemoveTicker={removeFromWatchlist}
            />
          </div>
        )}

        {/* Bond Yields Tab */}
        {visitedTabs.has("bonds") && (
          <div hidden={activeTab !== "bonds"} className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                  <Landmark className="w-4 h-4 text-emerald-400" />
                  תשואות אג&quot;ח ממשלתי — ארה&quot;ב וישראל
                </CardTitle>
              </CardHeader>
              <CardContent>
                <BondYields />
              </CardContent>
            </Card>
          </div>
        )}

        {/* Social Pulse Tab */}
        {visitedTabs.has("social") && (
          <div hidden={activeTab !== "social"} className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                  <MessageSquare className="w-4 h-4 text-orange-400" />
                  סנטימנט חברתי — Reddit &amp; Twitter
                </CardTitle>
              </CardHeader>
              <CardContent>
                <SocialPulse defaultTicker={activeTicker} />
              </CardContent>
            </Card>
          </div>
        )}

        {/* Bottleneck Tab */}
        {visitedTabs.has("bottlenecks") && (
          <div hidden={activeTab !== "bottlenecks"} className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                  <Zap className="w-4 h-4" />
                  צווארי בקבוק — ניתוח מבנה כוח בשוק
                </CardTitle>
              </CardHeader>
              <CardContent>
                <BottleneckExplorer onSelectTicker={(t) => { selectTicker(t); }} />
              </CardContent>
            </Card>
          </div>
        )}

        {/* Market Daily Report Tab */}
        {visitedTabs.has("market") && (
          <div hidden={activeTab !== "market"} className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <MarketReport />
          </div>
        )}

        {/* Market Heatmap Tab */}
        {visitedTabs.has("heatmap") && (
          <div hidden={activeTab !== "heatmap"} className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <MarketHeatmap />
          </div>
        )}

        {/* Important economic releases — U.S. and Israel */}
        {visitedTabs.has("economy") && (
          <div hidden={activeTab !== "economy"} className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <EconomicCalendar />
          </div>
        )}

        {/* Sector Explorer Tab */}
        {visitedTabs.has("sectors") && (
          <div hidden={activeTab !== "sectors"} className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                  <Layers className="w-4 h-4" />
                  סקטורים — חיפוש ומיון מניות
                </CardTitle>
              </CardHeader>
              <CardContent>
                <SectorExplorer onSelectTicker={selectTicker} />
              </CardContent>
            </Card>
          </div>
        )}

        {/* Search Tab content */}
        {visitedTabs.has("search") && <div hidden={activeTab !== "search"}>

        {/* Empty State */}
        {!activeTicker && (
          <div className="py-20 text-center space-y-8">
            <div className="inline-flex items-center justify-center p-4 bg-muted rounded-full mb-4">
              <TrendingUp className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-xl font-semibold text-foreground">סקירת שוק</h2>
            <p className="text-muted-foreground max-w-md mx-auto">
              חפש טיקר למעלה לקבלת נתוני מחיר בזמן אמת, סיכומי AI, וניתוח פיננסי מקיף.
            </p>
            <div className="flex flex-wrap justify-center gap-3 mt-8">
              <span className="text-sm text-muted-foreground self-center mr-2">פופולרי:</span>
              {POPULAR_TICKERS.map(ticker => (
                <Button key={ticker} variant="outline" onClick={() => selectTicker(ticker)} className="font-mono">
                  {ticker}
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* Loading State */}
        {activeTicker && isLoadingData && (
          <div className="space-y-6 animate-pulse">
            <div className="flex justify-between">
              <div className="space-y-2">
                <Skeleton className="h-10 w-48" />
                <Skeleton className="h-4 w-32" />
              </div>
              <div className="space-y-2 text-right">
                <Skeleton className="h-10 w-32 ml-auto" />
                <Skeleton className="h-4 w-24 ml-auto" />
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                <Skeleton className="h-96 w-full rounded-xl" />
                <Skeleton className="h-32 w-full rounded-xl" />
              </div>
              <div className="space-y-6">
                <Skeleton className="h-48 w-full rounded-xl" />
                <Skeleton className="h-64 w-full rounded-xl" />
              </div>
            </div>
          </div>
        )}

        {/* Data View */}
        {activeTicker && stockData && !isLoadingData && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Ticker Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
              <div>
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="text-4xl font-bold font-mono tracking-tighter">{stockData.ticker}</h1>
                  <Badge variant="outline" className="font-mono text-xs">{stockData.exchange}</Badge>
                  {stockData.sector && <Badge variant="secondary" className="text-xs">{stockData.sector}</Badge>}
                  
                  {/* Watchlist toggle */}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleWatchlistToggle}
                    title={watched ? "הסר ממעקב" : "הוסף למעקב"}
                    className={`transition-colors ${watched ? "text-yellow-400 hover:text-yellow-500" : "text-muted-foreground hover:text-yellow-400"}`}
                  >
                    <Star className={`w-5 h-5 ${watched ? "fill-yellow-400" : ""}`} />
                  </Button>

                  {/* Refresh button */}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleRefresh}
                    title="רענן נתונים"
                    disabled={isFetchingData}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <RefreshCw className={`w-4 h-4 ${isFetchingData ? "animate-spin" : ""}`} />
                  </Button>
                </div>
                <h2 className="text-xl text-muted-foreground mt-1">{stockData.companyName}</h2>
                {watched && (
                  <p className="text-xs text-yellow-500/80 mt-1 flex items-center gap-1">
                    <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                    עוקב — תישלח התראה בעת פרסום דוח חדש
                  </p>
                )}
              </div>
              
              <div className="text-left md:text-right space-y-1">
                {/* Market state badge */}
                <div className="flex items-center gap-2 justify-start md:justify-end mb-1">
                  {stockData.marketState === "REGULAR" && (
                    <span className="flex items-center gap-1.5 text-xs font-medium text-positive bg-positive/10 px-2 py-0.5 rounded-full">
                      <span className="w-1.5 h-1.5 rounded-full bg-positive animate-pulse" />
                      שוק פתוח
                    </span>
                  )}
                  {(stockData.marketState === "PRE" || stockData.marketState === "PREPRE") && (
                    <span className="flex items-center gap-1.5 text-xs font-medium text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded-full">
                      <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
                      טרום מסחר
                    </span>
                  )}
                  {(stockData.marketState === "POST" || stockData.marketState === "POSTPOST") && (
                    <span className="flex items-center gap-1.5 text-xs font-medium text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded-full">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                      לאחר שעות
                    </span>
                  )}
                  {stockData.marketState === "CLOSED" && (
                    <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                      שוק סגור
                    </span>
                  )}
                </div>

                {/* Main price */}
                <div className="flex items-center gap-2 justify-start md:justify-end">
                  <span className="text-4xl font-bold font-mono">
                    {formatHebrewNumber(stockData.price, { style: 'currency', currency: stockData.currency })}
                  </span>
                </div>
                <div className={`flex items-center gap-1 font-mono mt-1 ${stockData.priceChange >= 0 ? 'text-positive' : 'text-destructive'}`}>
                  {stockData.priceChange >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                  <span className="text-lg">
                    {stockData.priceChange >= 0 ? '+' : ''}{formatHebrewNumber(stockData.priceChange)} ({stockData.priceChangePercent > 0 ? '+' : ''}{formatHebrewNumber(stockData.priceChangePercent, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%)
                  </span>
                </div>

                {/* Pre-market price */}
                {stockData.preMarketPrice != null && (stockData.marketState === "PRE" || stockData.marketState === "PREPRE") && (
                  <div className="flex items-center gap-2 justify-start md:justify-end mt-2 bg-yellow-400/5 border border-yellow-400/20 rounded-lg px-3 py-1.5">
                    <span className="text-xs text-yellow-400/70 font-medium">טרום מסחר</span>
                    <span className="font-mono font-semibold text-yellow-300">
                      {formatHebrewNumber(stockData.preMarketPrice, { style: 'currency', currency: stockData.currency })}
                    </span>
                    {stockData.preMarketChangePercent != null && (
                      <span className={`text-xs font-mono ${stockData.preMarketChangePercent >= 0 ? 'text-positive' : 'text-destructive'}`}>
                        {stockData.preMarketChangePercent >= 0 ? '+' : ''}{formatHebrewNumber(stockData.preMarketChangePercent, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
                      </span>
                    )}
                  </div>
                )}

                {/* Post-market price */}
                {stockData.postMarketPrice != null && (stockData.marketState === "POST" || stockData.marketState === "POSTPOST" || stockData.marketState === "CLOSED") && (
                  <div className="flex items-center gap-2 justify-start md:justify-end mt-2 bg-blue-400/5 border border-blue-400/20 rounded-lg px-3 py-1.5">
                    <span className="text-xs text-blue-400/70 font-medium">לאחר שעות</span>
                    <span className="font-mono font-semibold text-blue-300">
                      {formatHebrewNumber(stockData.postMarketPrice, { style: 'currency', currency: stockData.currency })}
                    </span>
                    {stockData.postMarketChangePercent != null && (
                      <span className={`text-xs font-mono ${stockData.postMarketChangePercent >= 0 ? 'text-positive' : 'text-destructive'}`}>
                        {stockData.postMarketChangePercent >= 0 ? '+' : ''}{formatHebrewNumber(stockData.postMarketChangePercent, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Data Freshness Bar */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground/50 px-1">
              <span className="flex items-center gap-1.5">
                <Clock className="w-3 h-3" />
                {stockData.regularMarketTime
                  ? <>עדכון אחרון בבורסה: <span className="font-mono text-muted-foreground/70">{new Date(stockData.regularMarketTime).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" })}</span></>
                  : "עדכון אחרון: N/A"
                }
                {timeSinceMarket && <span className="text-muted-foreground/40">({timeSinceMarket})</span>}
              </span>
              <span className="text-muted-foreground/30">·</span>
              <span>מקור: Yahoo Finance</span>
              <span className="text-muted-foreground/30">·</span>
              <span className="flex items-center gap-1 text-yellow-500/50">
                <AlertTriangle className="w-3 h-3" />
                נתונים עשויים להיות מעוכבים עד 15 דקות בשוק פתוח
              </span>
            </div>

            {/* TradingView Chart — Full Width */}
            <div className="w-full rounded-xl overflow-hidden border border-border shadow-lg">
              <div className="flex items-center justify-between px-4 py-2 bg-card border-b border-border">
                <span className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5" />
                  גרף חי
                </span>
                <span className="text-[10px] text-muted-foreground/40 font-mono">Powered by TradingView</span>
              </div>
              <TradingViewChart ticker={activeTicker} height={650} />
            </div>

            <StockAnalyticsPanel ticker={activeTicker} />

            {/* Key Metrics Strip — Row 1 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card className="bg-card border-card-border">
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider flex items-center gap-1">
                    <Building2 className="w-3 h-3" /> שווי שוק
                  </div>
                  <div className="text-lg font-mono font-semibold">{stockData.marketCapFormatted}</div>
                </CardContent>
              </Card>
              <Card className="bg-card border-card-border">
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">P/E (TTM)</div>
                  <div className="text-lg font-mono font-semibold">{stockData.peRatio ? formatHebrewNumber(stockData.peRatio, { maximumFractionDigits: 2 }) : '—'}</div>
                </CardContent>
              </Card>
              <Card className="bg-card border-card-border">
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">EPS (TTM)</div>
                  <div className="text-lg font-mono font-semibold">{stockData.eps != null ? `$${stockData.eps.toFixed(2)}` : '—'}</div>
                </CardContent>
              </Card>
              <Card className="bg-card border-card-border">
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider flex items-center gap-1">
                    <BarChart2 className="w-3 h-3" /> מחזור
                  </div>
                  <div className="text-lg font-mono font-semibold">{formatVolume(stockData.volume)}</div>
                  {stockData.averageVolume != null && (
                    <div className="text-xs text-muted-foreground/50 mt-0.5 font-mono">ממוצע {formatVolume(stockData.averageVolume)}</div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Key Metrics Strip — Row 2 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card className="bg-card border-card-border">
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider flex items-center gap-1">
                    <ArrowUpDown className="w-3 h-3" /> טווח יומי
                  </div>
                  {stockData.dayLow != null && stockData.dayHigh != null ? (
                    <>
                      <div className="text-sm font-mono font-semibold">
                        ${stockData.dayLow.toFixed(2)} – ${stockData.dayHigh.toFixed(2)}
                      </div>
                      <div className="mt-1.5 h-1 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary/60 rounded-full"
                          style={{ width: `${Math.min(100, ((stockData.price - stockData.dayLow) / (stockData.dayHigh - stockData.dayLow)) * 100)}%` }}
                        />
                      </div>
                    </>
                  ) : <div className="text-sm font-mono">—</div>}
                </CardContent>
              </Card>
              <Card className="bg-card border-card-border">
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">טווח 52 שבועות</div>
                  {stockData.fiftyTwoWeekLow != null && stockData.fiftyTwoWeekHigh != null ? (
                    <>
                      <div className="text-sm font-mono font-semibold">
                        ${stockData.fiftyTwoWeekLow.toFixed(2)} – ${stockData.fiftyTwoWeekHigh.toFixed(2)}
                      </div>
                      <div className="mt-1.5 h-1 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary/40 rounded-full"
                          style={{ width: `${Math.min(100, ((stockData.price - stockData.fiftyTwoWeekLow) / (stockData.fiftyTwoWeekHigh - stockData.fiftyTwoWeekLow)) * 100)}%` }}
                        />
                      </div>
                    </>
                  ) : <div className="text-sm font-mono">—</div>}
                </CardContent>
              </Card>
              <Card className="bg-card border-card-border">
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">ביד / אסק</div>
                  <div className="text-sm font-mono font-semibold">
                    {stockData.bid != null ? `$${stockData.bid.toFixed(2)}` : '—'}
                    <span className="text-muted-foreground/40 mx-1">/</span>
                    {stockData.ask != null ? `$${stockData.ask.toFixed(2)}` : '—'}
                  </div>
                  {stockData.bid != null && stockData.ask != null && (
                    <div className="text-xs text-muted-foreground/50 mt-0.5">מרווח ${(stockData.ask - stockData.bid).toFixed(2)}</div>
                  )}
                </CardContent>
              </Card>
              <Card className="bg-card border-card-border">
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">תשואת דיבידנד</div>
                  <div className="text-lg font-mono font-semibold">
                    {stockData.dividendYield != null
                      ? `${(stockData.dividendYield * 100).toFixed(2)}%`
                      : '—'}
                  </div>
                  <div className="text-xs text-muted-foreground/50 mt-0.5">TTM</div>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Main Column */}
              <div className="lg:col-span-2 space-y-6">
                {/* AI Summary */}
                <Card className="border-primary/20 bg-primary/5">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-primary flex items-center gap-2">
                      <FileText className="w-4 h-4" />
                      סיכום ניתוח AI
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {isLoadingSummary ? (
                      <div className="space-y-2 animate-pulse">
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-5/6" />
                        <Skeleton className="h-4 w-4/6" />
                      </div>
                    ) : stockSummary ? (
                      <p className="text-sm leading-relaxed text-foreground/90">{stockSummary.summary}</p>
                    ) : stockData.aiSummary ? (
                      <p className="text-sm leading-relaxed text-foreground/90">{stockData.aiSummary}</p>
                    ) : (
                      <p className="text-sm text-muted-foreground">אין ניתוח זמין.</p>
                    )}
                  </CardContent>
                </Card>

                {/* Company Profile */}
                <CompanyProfile
                  ticker={activeTicker}
                  stockData={{
                    description: stockData.description ?? null,
                    sector: stockData.sector ?? null,
                    industry: stockData.industry ?? null,
                    companyName: stockData.companyName,
                  }}
                />
              </div>

              {/* Sidebar Column */}
              <div className="space-y-6">
                
                {/* Quarterly Report */}
                <Card className="bg-card border-card-border">
                  <CardHeader>
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-muted-foreground" />
                      נתונים פיננסיים
                    </CardTitle>
                    <CardDescription className="text-xs">תקופה: {stockData.quarterlyReport.period}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex justify-between items-center border-b border-border pb-2">
                      <span className="text-sm text-muted-foreground">הכנסות</span>
                      <span className="font-mono text-sm font-medium">{stockData.quarterlyReport.revenueFormatted || '-'}</span>
                    </div>
                    <div className="flex justify-between items-center border-b border-border pb-2">
                      <span className="text-sm text-muted-foreground">רווח נקי</span>
                      <span className="font-mono text-sm font-medium">{stockData.quarterlyReport.netIncomeFormatted || '-'}</span>
                    </div>
                    <div className="flex justify-between items-center border-b border-border pb-2">
                      <span className="text-sm text-muted-foreground">צמיחה</span>
                      <span className={`font-mono text-sm font-medium ${stockData.quarterlyReport.revenueGrowth && stockData.quarterlyReport.revenueGrowth >= 0 ? 'text-positive' : 'text-destructive'}`}>
                        {stockData.quarterlyReport.revenueGrowth ? `${formatHebrewNumber(stockData.quarterlyReport.revenueGrowth * 100, { maximumFractionDigits: 2 })}%` : '-'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">EPS</span>
                      <span className="font-mono text-sm font-medium">{stockData.quarterlyReport.eps ? formatHebrewNumber(stockData.quarterlyReport.eps, { maximumFractionDigits: 2 }) : '-'}</span>
                    </div>
                  </CardContent>
                </Card>

                {/* Upcoming Events */}
                <Card className="bg-card border-card-border">
                  <CardHeader>
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-muted-foreground" />
                      אירועים קרובים
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {stockData.upcomingEvents && stockData.upcomingEvents.length > 0 ? (
                      <div className="space-y-4">
                        {stockData.upcomingEvents.map((event, i) => (
                          <div key={i} className="flex gap-3 relative">
                            {i !== stockData.upcomingEvents.length - 1 && (
                              <div className="absolute left-[11px] top-6 bottom-[-16px] w-[2px] bg-border" />
                            )}
                            <div className="mt-1 w-6 h-6 rounded-full bg-secondary border-2 border-background flex items-center justify-center z-10 shrink-0">
                              <div className="w-2 h-2 rounded-full bg-primary" />
                            </div>
                            <div>
                              <p className="text-sm font-medium">{event.title}</p>
                              <div className="flex items-center gap-2 mt-1">
                                <Clock className="w-3 h-3 text-muted-foreground" />
                                <span className="text-xs text-muted-foreground font-mono">
                                  {new Date(event.date).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                                </span>
                                <Badge variant="secondary" className="text-[10px] py-0 px-1.5 h-4">{event.type}</Badge>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-4">No upcoming events scheduled.</p>
                    )}
                  </CardContent>
                </Card>

              </div>
            </div>
          </div>
        )}

        {/* Daily Analysis + Deep Analysis */}
        {activeTicker && stockData && !isLoadingData && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-300">
            <Separator className="my-8" />
            <DailyAnalysis ticker={activeTicker} />
            <Separator className="my-6" />
            <DeepAnalysis ticker={activeTicker} />
          </div>
        )}

        </div>}

      </div>
    </div>
  );
}
