import { useState } from "react";
import { Search, TrendingUp, TrendingDown, Clock, Building2, Calendar, FileText, Activity } from "lucide-react";
import { 
  useGetStockData, 
  useGetStockSummary, 
  useGetStockHistory, 
  getGetStockDataQueryKey, 
  getGetStockSummaryQueryKey, 
  getGetStockHistoryQueryKey 
} from "@workspace/api-client-react";
import type { GetStockHistoryPeriod } from "@workspace/api-client-react/src/generated/api.schemas";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { DeepAnalysis } from "@/components/DeepAnalysis";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from "recharts";

const POPULAR_TICKERS = ["AAPL", "TSLA", "NVDA", "MSFT"];

const formatHebrewNumber = (num: number, options?: Intl.NumberFormatOptions) => {
  return new Intl.NumberFormat("he-IL", options).format(num);
};

export default function Home() {
  const [searchInput, setSearchInput] = useState("");
  const [activeTicker, setActiveTicker] = useState<string | null>(null);
  const [chartPeriod, setChartPeriod] = useState<GetStockHistoryPeriod>("1mo");

  const { data: stockData, isLoading: isLoadingData } = useGetStockData(activeTicker || "", {
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

  const { data: stockHistory, isLoading: isLoadingHistory } = useGetStockHistory(activeTicker || "", { period: chartPeriod }, {
    query: {
      enabled: !!activeTicker,
      queryKey: getGetStockHistoryQueryKey(activeTicker || "", { period: chartPeriod }),
    },
  });

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
                <div className="flex items-center gap-3">
                  <h1 className="text-4xl font-bold font-mono tracking-tighter">{stockData.ticker}</h1>
                  <Badge variant="outline" className="font-mono text-xs">{stockData.exchange}</Badge>
                  {stockData.sector && <Badge variant="secondary" className="text-xs">{stockData.sector}</Badge>}
                </div>
                <h2 className="text-xl text-muted-foreground mt-1">{stockData.companyName}</h2>
              </div>
              
              <div className="text-left md:text-right">
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
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Main Column */}
              <div className="lg:col-span-2 space-y-6">
                {/* Chart Card */}
                <Card className="border-card-border bg-card shadow-md">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Price History</CardTitle>
                    <div className="flex bg-muted p-1 rounded-md">
                      {(["1d", "5d", "1mo", "3mo", "6mo", "1y"] as const).map((p) => (
                        <button
                          key={p}
                          onClick={() => setChartPeriod(p)}
                          className={`px-3 py-1 text-xs font-medium rounded-sm transition-colors ${chartPeriod === p ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                        >
                          {p.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[400px] w-full mt-4">
                      {isLoadingHistory ? (
                        <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">Loading chart data...</div>
                      ) : stockHistory && stockHistory.data.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={stockHistory.data} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                            <defs>
                              <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={stockData.priceChange >= 0 ? 'hsl(var(--positive))' : 'hsl(var(--destructive))'} stopOpacity={0.3}/>
                                <stop offset="95%" stopColor={stockData.priceChange >= 0 ? 'hsl(var(--positive))' : 'hsl(var(--destructive))'} stopOpacity={0}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                            <XAxis 
                              dataKey="date" 
                              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} 
                              axisLine={false} 
                              tickLine={false}
                              tickFormatter={(val) => {
                                const date = new Date(val);
                                return chartPeriod === '1d' ? date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : date.toLocaleDateString([], {month: 'short', day: 'numeric'});
                              }}
                            />
                            <YAxis 
                              domain={['auto', 'auto']} 
                              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))', fontFamily: 'monospace' }} 
                              axisLine={false} 
                              tickLine={false}
                              tickFormatter={(val) => formatHebrewNumber(val)}
                            />
                            <Tooltip 
                              contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }}
                              itemStyle={{ color: 'hsl(var(--foreground))', fontFamily: 'monospace' }}
                              labelStyle={{ color: 'hsl(var(--muted-foreground))', marginBottom: '4px' }}
                              formatter={(value: number) => [formatHebrewNumber(value, { style: 'currency', currency: stockData.currency }), 'Price']}
                              labelFormatter={(label) => new Date(label).toLocaleString()}
                            />
                            <Area 
                              type="monotone" 
                              dataKey="close" 
                              stroke={stockData.priceChange >= 0 ? 'hsl(var(--positive))' : 'hsl(var(--destructive))'} 
                              strokeWidth={2}
                              fillOpacity={1} 
                              fill="url(#colorPrice)" 
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">No data available for this period.</div>
                      )}
                    </div>
                  </CardContent>
                </Card>

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

                {/* Key Metrics Grid */}
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

        {/* Deep Analysis Section */}
        {activeTicker && stockData && !isLoadingData && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-300">
            <Separator className="my-8" />
            <DeepAnalysis ticker={activeTicker} />
          </div>
        )}

      </div>
    </div>
  );
}
