import { useState, useEffect } from "react";
import { Search, TrendingUp, TrendingDown, Clock, Building2, Calendar, FileText, Activity, Star, RefreshCw } from "lucide-react";
import { 
  useGetStockData, 
  useGetStockSummary, 
  getGetStockDataQueryKey, 
  getGetStockSummaryQueryKey,
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
import { NotificationCenter } from "@/components/NotificationCenter";
import { TradingViewChart } from "@/components/TradingViewChart";
import { useWatchlist } from "@/hooks/useWatchlist";

const POPULAR_TICKERS = ["AAPL", "TSLA", "NVDA", "MSFT"];

const formatHebrewNumber = (num: number, options?: Intl.NumberFormatOptions) => {
  return new Intl.NumberFormat("he-IL", options).format(num);
};

export default function Home() {
  const [searchInput, setSearchInput] = useState("");
  const [activeTicker, setActiveTicker] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const {
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

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchInput.trim()) {
      setActiveTicker(searchInput.trim().toUpperCase());
    }
  };

  const selectTicker = (ticker: string) => {
    setSearchInput(ticker);
    setActiveTicker(ticker);
  };

  const handleRefresh = () => {
    if (!activeTicker) return;
    queryClient.invalidateQueries({ queryKey: getGetStockDataQueryKey(activeTicker) });
    queryClient.invalidateQueries({ queryKey: getGetStockSummaryQueryKey(activeTicker) });
  };

  const handleWatchlistToggle = async () => {
    if (!activeTicker) return;
    if (isWatched(activeTicker)) {
      removeFromWatchlist(activeTicker);
    } else {
      await requestNotificationPermission();
      addToWatchlist(activeTicker, stockData?.quarterlyReport.reportDate ?? null);
    }
  };

  const watched = activeTicker ? isWatched(activeTicker) : false;

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
            <p className="text-sm text-muted-foreground mt-1">Professional Market Intelligence</p>
          </div>
          
          <div className="flex items-center gap-3 w-full md:w-auto">
            <form onSubmit={handleSearch} className="w-full md:w-96 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input 
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Enter ticker (e.g. AAPL)..."
                className="pl-10 bg-card border-card-border font-mono uppercase text-lg"
              />
              <Button type="submit" className="absolute right-1 top-1/2 -translate-y-1/2 h-8 px-3 text-xs" variant="secondary">
                Search
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
          </div>
        </header>

        {/* Empty State */}
        {!activeTicker && (
          <div className="py-20 text-center space-y-8">
            <div className="inline-flex items-center justify-center p-4 bg-muted rounded-full mb-4">
              <TrendingUp className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-xl font-semibold text-foreground">Market Overview</h2>
            <p className="text-muted-foreground max-w-md mx-auto">
              Search for a stock ticker above to access real-time price data, AI-driven summaries, and comprehensive financial reports.
            </p>
            <div className="flex flex-wrap justify-center gap-3 mt-8">
              <span className="text-sm text-muted-foreground self-center mr-2">Popular:</span>
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
                      Pre-Market
                    </span>
                  )}
                  {(stockData.marketState === "POST" || stockData.marketState === "POSTPOST") && (
                    <span className="flex items-center gap-1.5 text-xs font-medium text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded-full">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                      After-Hours
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
                    <span className="text-xs text-yellow-400/70 font-medium">Pre-Market</span>
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
                    <span className="text-xs text-blue-400/70 font-medium">After-Hours</span>
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

            {/* TradingView Chart — Full Width */}
            <div className="w-full rounded-xl overflow-hidden border border-border shadow-lg">
              <div className="flex items-center justify-between px-4 py-2 bg-card border-b border-border">
                <span className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5" />
                  Live Chart
                </span>
                <span className="text-[10px] text-muted-foreground/40 font-mono">Powered by TradingView</span>
              </div>
              <TradingViewChart ticker={activeTicker} height={650} />
            </div>

            {/* Key Metrics Strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card className="bg-card border-card-border">
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Market Cap</div>
                  <div className="text-lg font-mono font-medium">{stockData.marketCapFormatted}</div>
                </CardContent>
              </Card>
              <Card className="bg-card border-card-border">
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">P/E Ratio</div>
                  <div className="text-lg font-mono font-medium">{stockData.peRatio ? formatHebrewNumber(stockData.peRatio, { maximumFractionDigits: 2 }) : '-'}</div>
                </CardContent>
              </Card>
              <Card className="bg-card border-card-border">
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">EPS</div>
                  <div className="text-lg font-mono font-medium">{stockData.eps ? formatHebrewNumber(stockData.eps, { maximumFractionDigits: 2 }) : '-'}</div>
                </CardContent>
              </Card>
              <Card className="bg-card border-card-border">
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Industry</div>
                  <div className="text-sm font-medium truncate" title={stockData.industry || '-'}>{stockData.industry || '-'}</div>
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
                      AI Analysis Summary
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
                      <p className="text-sm text-muted-foreground">No analysis available.</p>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Sidebar Column */}
              <div className="space-y-6">
                
                {/* Quarterly Report */}
                <Card className="bg-card border-card-border">
                  <CardHeader>
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-muted-foreground" />
                      Latest Financials
                    </CardTitle>
                    <CardDescription className="text-xs">Period: {stockData.quarterlyReport.period}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex justify-between items-center border-b border-border pb-2">
                      <span className="text-sm text-muted-foreground">Revenue</span>
                      <span className="font-mono text-sm font-medium">{stockData.quarterlyReport.revenueFormatted || '-'}</span>
                    </div>
                    <div className="flex justify-between items-center border-b border-border pb-2">
                      <span className="text-sm text-muted-foreground">Net Income</span>
                      <span className="font-mono text-sm font-medium">{stockData.quarterlyReport.netIncomeFormatted || '-'}</span>
                    </div>
                    <div className="flex justify-between items-center border-b border-border pb-2">
                      <span className="text-sm text-muted-foreground">Rev Growth</span>
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
                      Upcoming Events
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

      </div>
    </div>
  );
}
