import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Search, MessageSquare, ExternalLink,
  TrendingUp, TrendingDown, Minus, RefreshCw,
  Newspaper, BarChart2, Twitter,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

// ── Types ──────────────────────────────────────────────────────────────────────

interface RedditPost {
  title: string;
  subreddit: string;
  score: number;
  numComments: number;
  sentiment: "bullish" | "bearish" | "neutral";
  permalink: string;
}

interface NewsArticle {
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  sentiment: "positive" | "negative" | "neutral" | null;
  summary: string;
}

interface StockTwit {
  id: number;
  body: string;
  createdAt: string;
  username: string;
  sentiment: "Bullish" | "Bearish" | null;
  url: string;
}

interface Tweet {
  id: string;
  text: string;
  username: string;
  displayName: string;
  createdAt: string;
  url: string;
  likeCount: number;
  retweetCount: number;
  sentiment: "bullish" | "bearish" | "neutral";
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
  news: { articles: NewsArticle[] } | null;
  stocktwits: {
    twits: StockTwit[];
    bullishCount: number;
    bearishCount: number;
    totalCount: number;
    sentimentLabel: string;
  } | null;
  twitter: {
    tweets: Tweet[];
    bullishCount: number;
    bearishCount: number;
    neutralCount: number;
    totalCount: number;
    sentimentLabel: string;
  } | null;
  generatedAt: string;
}

const POPULAR_TICKERS = ["AAPL", "TSLA", "NVDA", "MSFT", "META", "AMZN"];

// ── Helpers ────────────────────────────────────────────────────────────────────

function SentimentBar({ bullish, bearish, neutral }: { bullish: number; bearish: number; neutral: number }) {
  const total = bullish + bearish + neutral || 1;
  return (
    <div className="w-full h-1.5 rounded-full overflow-hidden flex gap-px">
      <div className="bg-emerald-500 transition-all" style={{ width: `${(bullish / total) * 100}%` }} />
      <div className="bg-zinc-600 transition-all" style={{ width: `${(neutral / total) * 100}%` }} />
      <div className="bg-red-500 transition-all" style={{ width: `${(bearish / total) * 100}%` }} />
    </div>
  );
}

function SentimentIcon({ s }: { s: "bullish" | "bearish" | "neutral" | "Bullish" | "Bearish" | "positive" | "negative" | null }) {
  const norm = s?.toLowerCase();
  if (norm === "bullish" || norm === "positive") return <TrendingUp className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />;
  if (norm === "bearish" || norm === "negative") return <TrendingDown className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />;
  return <Minus className="w-3.5 h-3.5 text-zinc-500 shrink-0 mt-0.5" />;
}

function SentimentBadge({ s }: { s: string | null }) {
  if (!s) return null;
  const norm = s.toLowerCase();
  const cls =
    norm === "bullish" || norm === "positive"
      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
      : norm === "bearish" || norm === "negative"
      ? "bg-red-500/15 text-red-400 border-red-500/30"
      : "bg-zinc-500/15 text-zinc-400 border-zinc-500/30";
  const label =
    norm === "bullish" || norm === "positive" ? "שורי" :
    norm === "bearish" || norm === "negative" ? "דובי" : "נייטרלי";
  return <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${cls}`}>{label}</span>;
}

function relativeTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `לפני ${diff}ש׳`;
  if (diff < 3600) return `לפני ${Math.floor(diff / 60)}ד׳`;
  if (diff < 86400) return `לפני ${Math.floor(diff / 3600)}ש״`;
  return `לפני ${Math.floor(diff / 86400)} ימים`;
}

function SummaryHeader({
  bullish, bearish, neutral, total, label,
}: { bullish: number; bearish: number; neutral: number; total: number; label: string }) {
  const cls =
    label === "שורי" ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10" :
    label === "דובי" ? "border-red-500/40 text-red-400 bg-red-500/10" :
    "border-yellow-500/40 text-yellow-400 bg-yellow-500/10";
  return (
    <div className="p-3 bg-muted/20 rounded-xl border border-border/40 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground uppercase tracking-wide">{total} תוצאות</span>
        <Badge variant="outline" className={`text-xs font-bold border px-2 py-0.5 ${cls}`}>{label}</Badge>
      </div>
      <SentimentBar bullish={bullish} bearish={bearish} neutral={neutral} />
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />{bullish} שורי</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-zinc-500 inline-block" />{neutral} נייטרלי</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />{bearish} דובי</span>
      </div>
    </div>
  );
}

// ── Reddit Panel ───────────────────────────────────────────────────────────────

function RedditPanel({ data, ticker }: { data: SocialData["reddit"]; ticker: string }) {
  if (!data || data.posts.length === 0) {
    return (
      <div className="py-14 text-center space-y-2">
        <MessageSquare className="w-8 h-8 text-muted-foreground/40 mx-auto" />
        <p className="text-sm text-muted-foreground">לא נמצאו פוסטים עבור <span className="font-mono text-foreground">{ticker}</span> השבוע</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <SummaryHeader
        bullish={data.bullishCount} bearish={data.bearishCount}
        neutral={data.neutralCount} total={data.totalMentions}
        label={data.sentimentLabel}
      />
      <div className="space-y-2">
        {data.posts.map((post, i) => (
          <div key={i} className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/20 transition-colors group">
            <SentimentIcon s={post.sentiment} />
            <div className="flex-1 min-w-0">
              <a href={post.permalink} target="_blank" rel="noopener noreferrer"
                className="text-sm text-foreground/85 hover:text-foreground transition-colors flex items-start gap-1 group/link leading-snug">
                <span className="line-clamp-2">{post.title}</span>
                <ExternalLink className="w-3 h-3 shrink-0 mt-0.5 opacity-0 group/link:opacity-60 transition-opacity" />
              </a>
              <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                <span className="text-orange-400/80 font-medium">{post.subreddit}</span>
                {post.score > 0 && <><span className="opacity-40">·</span><span>⬆ {post.score.toLocaleString()}</span></>}
                {post.numComments > 0 && <><span className="opacity-40">·</span><span>💬 {post.numComments}</span></>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── News Panel ─────────────────────────────────────────────────────────────────

function NewsPanel({ data, ticker }: { data: SocialData["news"]; ticker: string }) {
  if (!data || data.articles.length === 0) {
    return (
      <div className="py-14 text-center space-y-2">
        <Newspaper className="w-8 h-8 text-muted-foreground/40 mx-auto" />
        <p className="text-sm text-muted-foreground">לא נמצאו כתבות עבור <span className="font-mono text-foreground">{ticker}</span></p>
      </div>
    );
  }
  const pos = data.articles.filter(a => a.sentiment === "positive").length;
  const neg = data.articles.filter(a => a.sentiment === "negative").length;
  const neu = data.articles.filter(a => !a.sentiment || a.sentiment === "neutral").length;
  const ratio = pos / (pos + neg || 1);
  const label = ratio > 0.6 ? "שורי" : ratio < 0.4 ? "דובי" : "מעורב";

  return (
    <div className="space-y-4">
      <SummaryHeader bullish={pos} bearish={neg} neutral={neu} total={data.articles.length} label={label} />
      <div className="space-y-2">
        {data.articles.map((a, i) => (
          <div key={i} className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/20 transition-colors group">
            <SentimentIcon s={a.sentiment} />
            <div className="flex-1 min-w-0">
              <a href={a.url} target="_blank" rel="noopener noreferrer"
                className="text-sm text-foreground/85 hover:text-foreground transition-colors flex items-start gap-1 group/link leading-snug">
                <span className="line-clamp-2">{a.title}</span>
                <ExternalLink className="w-3 h-3 shrink-0 mt-0.5 opacity-0 group/link:opacity-60 transition-opacity" />
              </a>
              <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
                <span className="text-blue-400/80 font-medium">{a.source}</span>
                <span className="opacity-40">·</span>
                <span>{relativeTime(a.publishedAt)}</span>
                {a.sentiment && <><span className="opacity-40">·</span><SentimentBadge s={a.sentiment} /></>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Twitter/X Panel ───────────────────────────────────────────────────────────

function TwitterPanel({ data, ticker }: { data: SocialData["twitter"]; ticker: string }) {
  if (!data || data.tweets.length === 0) {
    return (
      <div className="py-14 text-center space-y-2">
        <Twitter className="w-8 h-8 text-muted-foreground/40 mx-auto" />
        <p className="text-sm text-muted-foreground">לא נמצאו tweets עבור <span className="font-mono text-foreground">{ticker}</span></p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <SummaryHeader
        bullish={data.bullishCount} bearish={data.bearishCount}
        neutral={data.neutralCount} total={data.totalCount}
        label={data.sentimentLabel}
      />
      <div className="space-y-2">
        {data.tweets.map((t) => (
          <div key={t.id} className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/20 transition-colors group">
            <SentimentIcon s={t.sentiment} />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-foreground/85 leading-snug whitespace-pre-wrap break-words">{t.text}</p>
              <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
                <a href={`https://x.com/${t.username}`} target="_blank" rel="noopener noreferrer"
                  className="text-[#1DA1F2]/80 font-medium hover:text-[#1DA1F2] transition-colors">
                  @{t.username}
                </a>
                <span className="opacity-40">·</span>
                <span>{relativeTime(t.createdAt)}</span>
                {t.likeCount > 0 && <><span className="opacity-40">·</span><span>♥ {t.likeCount.toLocaleString()}</span></>}
                {t.retweetCount > 0 && <><span className="opacity-40">·</span><span>↩ {t.retweetCount.toLocaleString()}</span></>}
                <a href={t.url} target="_blank" rel="noopener noreferrer"
                  className="mr-auto opacity-0 group-hover:opacity-60 hover:opacity-100 transition-opacity">
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground/50 text-center">נתוני X/Twitter דרך Apify — מתעדכן כל 30 דקות</p>
    </div>
  );
}

// ── StockTwits Panel ───────────────────────────────────────────────────────────

function StockTwitsPanel({ data, ticker }: { data: SocialData["stocktwits"]; ticker: string }) {
  if (!data || data.twits.length === 0) {
    return (
      <div className="py-14 text-center space-y-2">
        <BarChart2 className="w-8 h-8 text-muted-foreground/40 mx-auto" />
        <p className="text-sm text-muted-foreground">לא נמצאו twits עבור <span className="font-mono text-foreground">{ticker}</span></p>
      </div>
    );
  }
  const neutral = data.totalCount - data.bullishCount - data.bearishCount;
  return (
    <div className="space-y-4">
      <SummaryHeader
        bullish={data.bullishCount} bearish={data.bearishCount}
        neutral={neutral} total={data.totalCount}
        label={data.sentimentLabel}
      />
      <div className="space-y-2">
        {data.twits.map((t) => (
          <div key={t.id} className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/20 transition-colors">
            <SentimentIcon s={t.sentiment} />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-foreground/85 leading-snug">{t.body}</p>
              <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
                <a href={`https://stocktwits.com/${t.username}`} target="_blank" rel="noopener noreferrer"
                  className="text-green-400/80 font-medium hover:text-green-300 transition-colors">
                  @{t.username}
                </a>
                <span className="opacity-40">·</span>
                <span>{relativeTime(t.createdAt)}</span>
                {t.sentiment && <><span className="opacity-40">·</span><SentimentBadge s={t.sentiment} /></>}
                <a href={t.url} target="_blank" rel="noopener noreferrer" className="ml-auto opacity-0 group-hover:opacity-60 hover:opacity-100">
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground/50 text-center">נתוני StockTwits — מתעדכן כל 15 דקות</p>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

type Platform = "reddit" | "news" | "stocktwits" | "twitter";

export function SocialPulse({ defaultTicker }: { defaultTicker?: string | null }) {
  const [searchInput, setSearchInput] = useState(defaultTicker ?? "");
  const [activeTicker, setActiveTicker] = useState<string | null>(defaultTicker ?? null);
  const [platform, setPlatform] = useState<Platform>("news");

  const { data, isLoading, isFetching, refetch } = useQuery<SocialData>({
    queryKey: ["social", activeTicker],
    queryFn: async () => {
      const res = await fetch(`/api/social/${encodeURIComponent(activeTicker!)}`);
      if (!res.ok) throw new Error("Failed to fetch social data");
      return res.json() as Promise<SocialData>;
    },
    enabled: !!activeTicker,
    staleTime: 15 * 60 * 1000,
    retry: 1,
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const t = searchInput.trim().toUpperCase();
    if (!t) return;
    if (t === activeTicker) { refetch(); } else { setActiveTicker(t); }
  };

  const selectTicker = (t: string) => { setSearchInput(t); setActiveTicker(t); };
  const isActive = (t: string) => activeTicker === t;

  const tabCls = (active: boolean, color: string) =>
    `flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
      active ? `${color} text-foreground` : "border-transparent text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div className="space-y-5">
      {/* Search bar */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            dir="ltr"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value.toUpperCase())}
            placeholder="TSLA, AAPL..."
            className="pl-10 font-mono uppercase bg-card border-border"
          />
        </div>
        <Button type="submit" disabled={!searchInput.trim()}>
          <Search className="w-3.5 h-3.5 mr-1.5" />
          חפש
        </Button>
        {activeTicker && (
          <Button type="button" variant="outline" size="icon" onClick={() => refetch()} disabled={isFetching} title="רענן">
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        )}
      </form>

      {/* Quick tickers — shown only before first search */}
      {!activeTicker && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">פופולרי:</span>
          {POPULAR_TICKERS.map((t) => (
            <button key={t} onClick={() => selectTicker(t)}
              className="font-mono text-xs px-2.5 py-1 rounded-md border border-border/60 bg-muted/20 hover:bg-muted/50 hover:border-border text-foreground/80 hover:text-foreground transition-colors">
              {t}
            </button>
          ))}
        </div>
      )}

      {/* Ticker header + quick switch */}
      {activeTicker && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono font-bold text-lg text-primary">{activeTicker}</span>
          <span className="text-muted-foreground text-sm">— פולס מדיה</span>
          <div className="flex gap-1 mr-auto flex-wrap">
            {POPULAR_TICKERS.map((t) => (
              <button key={t} onClick={() => selectTicker(t)}
                className={`font-mono text-xs px-2 py-0.5 rounded border transition-colors ${
                  isActive(t) ? "border-primary text-primary bg-primary/10" : "border-border/40 text-muted-foreground hover:border-border hover:text-foreground bg-muted/10"
                }`}>
                {t}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Platform tabs */}
      {activeTicker && (
        <div className="flex items-center gap-0.5 border-b border-border/50 overflow-x-auto">
          <button onClick={() => setPlatform("news")} className={tabCls(platform === "news", "border-blue-400")}>
            <Newspaper className="w-3.5 h-3.5" />
            ידיעות
            {data?.news && <SentimentBadge s={
              data.news.articles.filter(a => a.sentiment === "positive").length >
              data.news.articles.filter(a => a.sentiment === "negative").length ? "positive" : "negative"
            } />}
          </button>
          <button onClick={() => setPlatform("twitter")} className={tabCls(platform === "twitter", "border-[#1DA1F2]")}>
            <Twitter className="w-3.5 h-3.5" />
            X / Twitter
            {data?.twitter && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                data.twitter.sentimentLabel === "שורי" ? "bg-emerald-500/20 text-emerald-400" :
                data.twitter.sentimentLabel === "דובי" ? "bg-red-500/20 text-red-400" :
                "bg-yellow-500/20 text-yellow-400"
              }`}>{data.twitter.sentimentLabel}</span>
            )}
          </button>
          <button onClick={() => setPlatform("stocktwits")} className={tabCls(platform === "stocktwits", "border-green-400")}>
            <BarChart2 className="w-3.5 h-3.5" />
            StockTwits
            {data?.stocktwits && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                data.stocktwits.sentimentLabel === "שורי" ? "bg-emerald-500/20 text-emerald-400" :
                data.stocktwits.sentimentLabel === "דובי" ? "bg-red-500/20 text-red-400" :
                "bg-yellow-500/20 text-yellow-400"
              }`}>{data.stocktwits.sentimentLabel}</span>
            )}
          </button>
          <button onClick={() => setPlatform("reddit")} className={tabCls(platform === "reddit", "border-orange-400")}>
            <MessageSquare className="w-3.5 h-3.5" />
            Reddit
            {data?.reddit && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                data.reddit.sentimentLabel === "שורי" ? "bg-emerald-500/20 text-emerald-400" :
                data.reddit.sentimentLabel === "דובי" ? "bg-red-500/20 text-red-400" :
                "bg-yellow-500/20 text-yellow-400"
              }`}>{data.reddit.sentimentLabel}</span>
            )}
          </button>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full rounded-xl" />
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
        </div>
      )}

      {/* Content panels */}
      {!isLoading && data && platform === "news" && <NewsPanel data={data.news} ticker={data.ticker} />}
      {!isLoading && data && platform === "twitter" && <TwitterPanel data={data.twitter} ticker={data.ticker} />}
      {!isLoading && data && platform === "stocktwits" && <StockTwitsPanel data={data.stocktwits} ticker={data.ticker} />}
      {!isLoading && data && platform === "reddit" && <RedditPanel data={data.reddit} ticker={data.ticker} />}

      {/* Empty state */}
      {!activeTicker && (
        <div className="py-16 text-center space-y-5">
          <div className="flex justify-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
              <Newspaper className="w-5 h-5 text-blue-400" />
            </div>
            <div className="w-12 h-12 rounded-2xl bg-[#1DA1F2]/10 border border-[#1DA1F2]/20 flex items-center justify-center">
              <Twitter className="w-5 h-5 text-[#1DA1F2]" />
            </div>
            <div className="w-12 h-12 rounded-2xl bg-green-500/10 border border-green-500/20 flex items-center justify-center">
              <BarChart2 className="w-5 h-5 text-green-400" />
            </div>
            <div className="w-12 h-12 rounded-2xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center">
              <MessageSquare className="w-5 h-5 text-orange-400" />
            </div>
          </div>
          <div className="space-y-1.5">
            <h3 className="text-base font-semibold text-foreground">פולס מדיה — ידיעות, X/Twitter, StockTwits ו-Reddit</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
              חפש טיקר וקבל ידיעות פיננסיות, tweets מ-X, ציוצים מ-StockTwits וסנטימנט Reddit בזמן אמת.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
