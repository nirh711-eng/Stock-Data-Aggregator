import { Router } from "express";
import { fetchReddit, fetchNewsArticles, fetchStockTwits, fetchTwitter } from "../lib/enrichment";

const router = Router();

router.get("/social/:ticker", async (req, res) => {
  const rawTicker = req.params["ticker"] ?? "";
  const ticker = rawTicker.toUpperCase().trim();

  if (!ticker || !/^[A-Z]{1,6}$/.test(ticker)) {
    res.status(400).json({ error: "Bad request", message: "Invalid ticker symbol" });
    return;
  }

  try {
    const [redditData, newsData, stocktwitsData, twitterData] = await Promise.all([
      fetchReddit(ticker),
      fetchNewsArticles(ticker),
      fetchStockTwits(ticker),
      fetchTwitter(ticker),
    ]);
    res.json({
      ticker,
      reddit: redditData ?? null,
      news: newsData ?? null,
      stocktwits: stocktwitsData ?? null,
      twitter: twitterData ?? null,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    req.log?.error({ err }, "Failed to fetch social data");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
