---
name: Yahoo Finance v3 usage
description: Compatibility rules for retrieving quote and historical market data with the installed Yahoo Finance client.
---

Yahoo Finance v3 historical requests must specify both `period1` and `period2`; a start date alone fails validation before any market data is fetched.

**Why:** The v3 `historical()` compatibility layer validates chart-style options and rejects an omitted end date as an invalid request, which can silently leave derived analytics empty when errors are deliberately handled as partial data.

**How to apply:** Whenever server code retrieves OHLC history, pass an explicit current end date and ensure partial-data handling preserves a visible unavailable state rather than presenting blank returns as valid analytics.