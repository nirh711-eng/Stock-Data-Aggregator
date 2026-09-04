---
name: Market scan indicators
description: Durable conventions for Williams %R scans and the market heatmap data source.
---

Williams %R scans use the latest 14 completed daily candles, exclude the current exchange-local session, and expose both normalized -1..0 and conventional -100..0 values. The requested normalized band is -0.75 through -0.25 inclusive.

**Why:** The user specified normalized values, while traders commonly read the percentage form; returning both prevents a silent unit mismatch. Excluding the active candle keeps the signal stable during the trading day.

**How to apply:** Keep sector and market-wide scans on the same completed-candle calculation. The market heatmap uses the public TradingView Scanner response for current U.S. quotes and market-cap sizing, with a five-minute server cache and manual refresh available in the UI.