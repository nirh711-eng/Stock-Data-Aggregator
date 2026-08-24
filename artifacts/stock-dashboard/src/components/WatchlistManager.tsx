import { FormEvent, useState } from "react";
import { Bookmark, Link2, Plus, Star, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { WatchlistItem } from "@/hooks/useWatchlist";
import {
  MAX_TRACKED_ARTICLES,
  MAX_TRACKED_ARTICLES_PER_TICKER,
  type TrackedArticle,
} from "@/hooks/useTrackedArticles";
import { SECTOR_ETF_BY_NAME } from "@/lib/marketSectors";

type AddArticleInput = Omit<TrackedArticle, "id" | "ticker" | "addedAt">;

export function WatchlistManager({
  watchlist,
  trackedArticles,
  onAddTicker,
  onRemoveTicker,
  onAddArticle,
  onRemoveArticle,
}: {
  watchlist: WatchlistItem[];
  trackedArticles: Record<string, TrackedArticle[]>;
  onAddTicker: (ticker: string) => Promise<string | null>;
  onRemoveTicker: (ticker: string) => void;
  onAddArticle: (ticker: string, article: AddArticleInput) => boolean;
  onRemoveArticle: (ticker: string, id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [ticker, setTicker] = useState("");
  const [tickerError, setTickerError] = useState("");
  const [addingTicker, setAddingTicker] = useState(false);
  const [articleDrafts, setArticleDrafts] = useState<Record<string, {
    url: string;
    title: string;
    summary: string;
  }>>({});
  const [articleError, setArticleError] = useState("");
  const sectorGroups = [...new Map(
    watchlist.flatMap((item) => {
      const etf = item.sector ? SECTOR_ETF_BY_NAME[item.sector] : null;
      return etf ? [[etf, item.sector!] as const] : [];
    }),
  )].map(([ticker, sector]) => ({
    ticker,
    companyName: `מעקב סקטוריאלי: ${sector}`,
    sector,
    kind: "sector" as const,
  }));
  const managedItems = [
    ...watchlist.map((item) => ({ ...item, kind: "stock" as const })),
    ...sectorGroups,
  ];

  const handleAddTicker = async (event: FormEvent) => {
    event.preventDefault();
    const normalizedTicker = ticker.trim().toUpperCase();
    if (!/^[A-Z]{1,6}$/.test(normalizedTicker)) {
      setTickerError("יש להזין טיקר באנגלית, באורך של 1–6 תווים.");
      return;
    }
    if (watchlist.some((item) => item.ticker === normalizedTicker)) {
      setTickerError("הטיקר כבר נמצא ברשימת המעקב.");
      return;
    }
    if (watchlist.length >= 20) {
      setTickerError("ניתן לעקוב אחר עד 20 טיקרים בכל פעם.");
      return;
    }

    setTickerError("");
    setAddingTicker(true);
    const error = await onAddTicker(normalizedTicker);
    setAddingTicker(false);
    if (error) {
      setTickerError(error);
      return;
    }
    setTicker("");
  };

  const handleAddArticle = (event: FormEvent, item: Pick<WatchlistItem, "ticker">) => {
    event.preventDefault();
    const draft = articleDrafts[item.ticker] ?? { url: "", title: "", summary: "" };
    const url = draft.url.trim();
    const title = draft.title.trim();
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      setArticleError("יש להזין קישור מלא לכתבה, כולל https://.");
      return;
    }
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      setArticleError("ניתן לשמור רק קישורי http או https.");
      return;
    }
    if (!title) {
      setArticleError("יש להוסיף כותרת לכתבה כדי שנוכל לנתח אותה בסריקות הבאות.");
      return;
    }
    if ((trackedArticles[item.ticker] ?? []).length >= MAX_TRACKED_ARTICLES_PER_TICKER) {
      setArticleError(`ניתן לשמור עד ${MAX_TRACKED_ARTICLES_PER_TICKER} כתבות עבור כל טיקר.`);
      return;
    }
    if (Object.values(trackedArticles).flat().length >= MAX_TRACKED_ARTICLES) {
      setArticleError(`ניתן לשמור עד ${MAX_TRACKED_ARTICLES} כתבות לכל רשימת המעקב.`);
      return;
    }

    const added = onAddArticle(item.ticker, {
      title,
      url,
      source: parsedUrl.hostname.replace(/^www\./, ""),
      publishedAt: new Date().toISOString(),
      summary: draft.summary.trim(),
    });
    if (!added) {
      setArticleError("הכתבה הזו כבר שמורה עבור הטיקר.");
      return;
    }
    setArticleError("");
    setArticleDrafts((previous) => ({
      ...previous,
      [item.ticker]: { url: "", title: "", summary: "" },
    }));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="shrink-0 bg-background">
          <Star className="w-4 h-4 ml-2" />
          ניהול מעקב
          <span className="mr-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
            {watchlist.length}
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent dir="rtl" className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader className="text-right">
          <DialogTitle className="flex items-center gap-2">
            <Bookmark className="w-5 h-5 text-primary" />
            ניהול רשימת מעקב ומקורות
          </DialogTitle>
          <DialogDescription>
            הוסף או הסר טיקרים, ושמור כתבות חשובות כדי לתת להן עדיפות בסריקות הבאות.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleAddTicker} className="rounded-lg border border-border bg-muted/20 p-3">
          <div className="flex gap-2">
            <Input
              value={ticker}
              onChange={(event) => {
                setTicker(event.target.value.toUpperCase());
                setTickerError("");
              }}
              placeholder="הוסף טיקר, למשל AAPL"
              aria-label="טיקר להוספה לרשימת המעקב"
              className="font-mono uppercase bg-background"
              maxLength={6}
              disabled={addingTicker}
            />
            <Button type="submit" disabled={addingTicker} className="shrink-0">
              <Plus className="w-4 h-4" />
              {addingTicker ? "בודק..." : "הוסף"}
            </Button>
          </div>
          {tickerError && <p className="mt-2 text-xs text-destructive">{tickerError}</p>}
        </form>

        {watchlist.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
            עדיין אין טיקרים במעקב. הוסף את הראשון למעלה.
          </div>
        ) : (
          <div className="space-y-3">
            {managedItems.map((item) => {
              const articles = trackedArticles[item.ticker] ?? [];
              return (
                <section key={item.ticker} className="rounded-lg border border-border bg-card p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-foreground">{item.ticker}</span>
                        {item.kind === "sector" && (
                          <span className="rounded bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                            סקטור
                          </span>
                        )}
                        {item.sector && (
                          <span className="truncate rounded bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                            {item.sector}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {item.companyName ?? "שם החברה ייטען בסריקה"}
                      </p>
                    </div>
                    {item.kind === "stock" && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        title={`הסר ${item.ticker} מרשימת המעקב`}
                        aria-label={`הסר ${item.ticker} מרשימת המעקב`}
                        onClick={() => onRemoveTicker(item.ticker)}
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>

                  <form onSubmit={(event) => handleAddArticle(event, item)} className="mt-3 space-y-2">
                    <Input
                      value={articleDrafts[item.ticker]?.url ?? ""}
                      onChange={(event) => {
                        setArticleError("");
                        setArticleDrafts((previous) => ({
                          ...previous,
                          [item.ticker]: {
                            url: event.target.value,
                            title: previous[item.ticker]?.title ?? "",
                            summary: previous[item.ticker]?.summary ?? "",
                          },
                        }));
                      }}
                      placeholder="הדבק URL של כתבה למעקב"
                      aria-label={`קישור לכתבה עבור ${item.ticker}`}
                      className="text-xs bg-background"
                      type="url"
                    />
                    <div className="flex gap-2">
                      <Input
                        value={articleDrafts[item.ticker]?.title ?? ""}
                        onChange={(event) => {
                          setArticleError("");
                          setArticleDrafts((previous) => ({
                            ...previous,
                            [item.ticker]: {
                              url: previous[item.ticker]?.url ?? "",
                              title: event.target.value,
                              summary: previous[item.ticker]?.summary ?? "",
                            },
                          }));
                        }}
                        placeholder="כותרת הכתבה (לניתוח)"
                        aria-label={`כותרת הכתבה עבור ${item.ticker}`}
                        className="text-xs bg-background"
                      />
                      <Button type="submit" variant="secondary" size="sm" className="shrink-0">
                        <Link2 className="w-3.5 h-3.5" />
                        שמור
                      </Button>
                    </div>
                    <Input
                      value={articleDrafts[item.ticker]?.summary ?? ""}
                      onChange={(event) => {
                        setArticleError("");
                        setArticleDrafts((previous) => ({
                          ...previous,
                          [item.ticker]: {
                            url: previous[item.ticker]?.url ?? "",
                            title: previous[item.ticker]?.title ?? "",
                            summary: event.target.value,
                          },
                        }));
                      }}
                      placeholder="תקציר קצר (אופציונלי, משפר את הניתוח)"
                      aria-label={`תקציר הכתבה עבור ${item.ticker}`}
                      className="text-xs bg-background"
                    />
                  </form>

                  {articles.length > 0 && (
                    <div className="mt-3 space-y-2 border-t border-border pt-3">
                      <p className="text-[11px] font-medium text-muted-foreground">
                        מקורות שמורים ({articles.length})
                      </p>
                      {articles.map((article) => (
                        <div key={article.id} className="flex items-center gap-2 text-xs">
                          <a
                            href={article.url}
                            target="_blank"
                            rel="noreferrer"
                            className="min-w-0 flex-1 truncate text-primary hover:underline"
                            title={article.title}
                          >
                            {article.title}
                          </a>
                          <button
                            type="button"
                            onClick={() => onRemoveArticle(item.ticker, article.id)}
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                            title="הסר מקור שמור"
                            aria-label="הסר מקור שמור"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
        {articleError && <p className="text-xs text-destructive">{articleError}</p>}
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          מקורות שמורים נשמרים בדפדפן הזה, נשלחים בסריקה הבאה ומשמשים כהקשר מועדף לניתוח.
        </p>
      </DialogContent>
    </Dialog>
  );
}