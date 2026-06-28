import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Search, MessageSquare, Twitter, ExternalLink,
  TrendingUp, TrendingDown, Minus, RefreshCw, Clock,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface RedditPost {
  title: string;
  subreddit: string;
  score: number;
  numComments: number;
  sentiment: "bullish" | "bearish" | "neutral";
  permalink: string;
}

interface SocialData {
  ticker: string;
  reddit: {
    posts: RedditPost[];
    bullishCount: number;
    bearishCount: number;
    neutralCount: number;
    totalMentions: number;
    sentimentLabel: string;
  } | null;
  twitter: null;
  generatedAt: string;
}

const POPULAR_TICKERS = ["AAPL", "TSLA", "NVDA", "MSFT", "META", "AMZN"];

function SentimentBar({ bullish, bearish, neutral }: { bullish: number; bearish: number; neutral: number }) {
  const total = bullish + bearish + neutral || 1;
  const bPct = (bullish / total) * 100;
  const rPct = (bearish / total) * 100;
  const nPct = (neutral / total) * 100;
  return (
    <div className="w-full h-2 rounded-full overflow-hidden flex gap-px">
      <div className="bg-emerald-500 transition-all" style={{ width: `${bPct}%` }} title={`שורי ${bullish}`} />
      <div className="bg-zinc-600 transition-all" style={{ width: `${nPct}%` }} title={`נייטרלי ${neutral}`} />
      <div className="bg-red-500 transition-all" style={{ width: `${rPct}%` }} title={`דובי ${bearish}`} />
    </div>
  );
}

function SentimentIcon({ sentiment }: { sentiment: "bullish" | "bearish" | "neutral" }) {
  if (sentiment === "bullish") return <TrendingUp className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
  if (sentiment === "bearish") return <TrendingDown className="w-3.5 h-3.5 text-red-400 shrink-0" />;
  return <Minus className="w-3.5 h-3.5 text-zinc-500 shrink-0" />;
}

function RedditPanel({ data, ticker }: { data: SocialData["reddit"]; ticker: string }) {
  if (!data || data.posts.length === 0) {
    return (
      <div className="py-14 text-center space-y-3">
        <MessageSquare className="w-8 h-8 text-muted-foreground/40 mx-auto" />
        <p className="text-muted-foreground text-sm">לא נמצאו פוסטים עבור <span className="font-mono text-foreground">{ticker}</span> השבוע</p>
      </div>
    );
  }

  const sentimentColor =
    data.sentimentLabel === "שורי" ? "border-emerald-500/50 text-emerald-400 bg-emerald-500/10" :
    data.sentimentLabel === "דובי" ? "border-red-500/50 text-red-400 bg-red-500/10" :
    "border-yellow-500/50 text-yellow-400 bg-yellow-500/10";

  return (
    <div className="space-y-4">
      {/* Sentiment summary header */}
      <div className="flex items-center gap-3 p-4 bg-muted/20 rounded-xl border border-border/40">
        <div className="flex-1 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground uppercase tracking-wide">סנטימנט כולל — {data.totalMentions} פוסטים</span>
            <Badge variant="outline" className={`text-xs font-bold border px-2 py-0.5 ${sentimentColor}`}>
              {data.sentimentLabel}
            </Badge>
          </div>
          <SentimentBar bullish={data.bullishCount} bearish={data.bearishCount} neutral={data.neutralCount} />
          <div className="flex items-center gap-4 text-xs">
            <span className="text-emerald-400 font-semibold">🟢 שורי: {data.bullishCount}</span>
            <span className="text-red-400 font-semibold">🔴 דובי: {data.bearishCount}</span>
            <span className="text-muted-foreground">⚪ נייטרלי: {data.neutralCount}</span>
          </div>
        </div>
      </div>

      {/* Post list */}
      <div className="space-y-2">
        {data.posts.map((post, i) => (
          <div key={i} className={`group flex items-start gap-3 p-3 rounded-lg border transition-colors hover:bg-muted/20 ${
            post.sentiment === "bullish" ? "border-emerald-500/20 bg-emerald-500/5" :
            post.sentiment === "bearish" ? "border-red-500/20 bg-red-500/5" :
            "border-border/30 bg-muted/5"
          }`}>
            <div className="mt-0.5">
              <SentimentIcon sentiment={post.sentiment} />
            </div>
            <div className="flex-1 min-w-0">
              <a
                href={post.permalink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-foreground/90 hover:text-foreground leading-snug line-clamp-2 flex items-start gap-1 group/link"
              >
                <span>{post.title}</span>
                <ExternalLink className="w-3 h-3 shrink-0 mt-0.5 opacity-0 group-hover/link:opacity-60 transition-opacity" />
              </a>
              <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
                <span className="text-orange-400/80 font-medium">{post.subreddit}</span>
                <span className="text-muted-foreground/50">·</span>
                <span>⬆ {post.score.toLocaleString()}</span>
                <span className="text-muted-foreground/50">·</span>
                <span>💬 {post.numComments.toLocaleString()}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TwitterPanel() {
  return (
    <div className="py-16 text-center space-y-5">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#1DA1F2]/10 border border-[#1DA1F2]/20 mx-auto">
        <Twitter className="w-7 h-7 text-[#1DA1F2]" />
      </div>
      <div className="space-y-2">
        <h3 className="text-base font-semibold text-foreground">Twitter / X — בקרוב</h3>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed">
          אינטגרציית Twitter תופעל דרך <span className="font-mono text-foreground/70 text-xs bg-muted px-1.5 py-0.5 rounded">Apify</span> — שירות scraping שמאפשר גישה ל-Tweets בזמן אמת ללא Twitter API.
        </p>
      </div>
      <div className="inline-flex items-center gap-2 text-xs text-muted-foreground border border-border/40 rounded-lg px-4 py-2.5 bg-muted/10">
        <Clock className="w-3.5 h-3.5" />
        <span>פתח חשבון ב-apify.com וצור מפתח API — ונחבר אותו</span>
      </div>
    </div>
  );
}

export function SocialPulse() {
  const [searchInput, setSearchInput] = useState("");
  const [activeTicker, setActiveTicker] = useState<string | null>(null);
  const [platform, setPlatform] = useState<"reddit" | "twitter">("reddit");

  const { data, isLoading, isFetching, refetch } = useQuery<SocialData>({
    queryKey: ["social", activeTicker],
    queryFn: async () => {
      const res = await fetch(`/api/social/${encodeURIComponent(activeTicker!)}`);
      if (!res.ok) throw new Error("Failed to fetch social data");
      return res.json() as Promise<SocialData>;
    },
    enabled: !!activeTicker,
    staleTime: 30 * 60 * 1000,
    retry: 1,
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const t = searchInput.trim().toUpperCase();
    if (!t) return;
    if (t === activeTicker) {
      refetch();
    } else {
      setActiveTicker(t);
    }
  };

  const selectTicker = (t: string) => {
    setSearchInput(t);
    setActiveTicker(t);
  };

  const isActive = (t: string) => activeTicker === t;

  return (
    <div className="space-y-5">
      {/* Search bar */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value.toUpperCase())}
            placeholder="הזן טיקר (לדוגמה TSLA)..."
            className="pl-10 font-mono uppercase bg-card border-border"
          />
        </div>
        <Button type="submit" disabled={!searchInput.trim()}>
          <Search className="w-3.5 h-3.5 mr-1.5" />
          חפש
        </Button>
        {activeTicker && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => refetch()}
            disabled={isFetching}
            title="רענן"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        )}
      </form>

      {/* Quick tickers */}
      {!activeTicker && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">פופולרי:</span>
          {POPULAR_TICKERS.map((t) => (
            <button
              key={t}
              onClick={() => selectTicker(t)}
              className="font-mono text-xs px-2.5 py-1 rounded-md border border-border/60 bg-muted/20 hover:bg-muted/50 hover:border-border text-foreground/80 hover:text-foreground transition-colors"
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {/* Platform sub-tabs */}
      {activeTicker && (
        <div className="flex items-center gap-0.5 border-b border-border/50">
          <button
            onClick={() => setPlatform("reddit")}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              platform === "reddit"
                ? "border-orange-400 text-orange-300"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Reddit
            {data?.reddit && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                data.reddit.sentimentLabel === "שורי" ? "bg-emerald-500/20 text-emerald-400" :
                data.reddit.sentimentLabel === "דובי" ? "bg-red-500/20 text-red-400" :
                "bg-yellow-500/20 text-yellow-400"
              }`}>
                {data.reddit.sentimentLabel}
              </span>
            )}
          </button>
          <button
            onClick={() => setPlatform("twitter")}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              platform === "twitter"
                ? "border-[#1DA1F2] text-[#1DA1F2]"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Twitter className="w-3.5 h-3.5" />
            Twitter / X
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">בקרוב</span>
          </button>
        </div>
      )}

      {/* Ticker header when active */}
      {activeTicker && (
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold text-lg text-primary">{activeTicker}</span>
          <span className="text-muted-foreground text-sm">— סנטימנט חברתי</span>
          <div className="flex gap-1 mr-auto">
            {POPULAR_TICKERS.map((t) => (
              <button
                key={t}
                onClick={() => selectTicker(t)}
                className={`font-mono text-xs px-2 py-0.5 rounded border transition-colors ${
                  isActive(t)
                    ? "border-primary text-primary bg-primary/10"
                    : "border-border/40 text-muted-foreground hover:border-border hover:text-foreground bg-muted/10"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full rounded-xl" />
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      )}

      {/* Content */}
      {!isLoading && data && platform === "reddit" && (
        <RedditPanel data={data.reddit} ticker={data.ticker} />
      )}
      {!isLoading && activeTicker && platform === "twitter" && (
        <TwitterPanel />
      )}

      {/* Empty state */}
      {!activeTicker && (
        <div className="py-20 text-center space-y-6">
          <div className="flex justify-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center">
              <MessageSquare className="w-6 h-6 text-orange-400" />
            </div>
            <div className="w-14 h-14 rounded-2xl bg-[#1DA1F2]/10 border border-[#1DA1F2]/20 flex items-center justify-center">
              <Twitter className="w-6 h-6 text-[#1DA1F2]" />
            </div>
          </div>
          <div className="space-y-2">
            <h3 className="text-base font-semibold text-foreground">מודיעין חברתי — פולס שוק</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
              חפש כל טיקר וקבל ניתוח sentiment בזמן אמת מ-Reddit וב-Twitter (בקרוב).
              האלגוריתם מנתח עשרות פוסטים ומסווג: שורי / דובי / נייטרלי.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
