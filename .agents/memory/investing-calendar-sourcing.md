---
name: Investing calendar sourcing
description: Reliable access pattern and coverage caveats for Investing.com economic calendar data.
---

Use Investing.com's own calendar endpoints rather than direct page scraping. The filtered calendar POST endpoint can intermittently throttle or return sparse country results; importantly, it can succeed while omitting already-completed events from the current day. Keep a short cache for its fresh values and use the `solidcode/economic-calendar-data-scraper` Apify actor as an exact Investing-backed supplement for the current and next week.

**Why:** Direct HTML pages and Investing's calendar widget are protected by Cloudflare from the server. A country-level fallback cannot detect the successful-but-incomplete current-day response. The first evaluated Apify actor (`pintostudio/economic-calendar-data-investing-com`) failed internally despite valid requests; the SolidCode actor returned the complete daily list, including low-impact rows and event links.

**How to apply:** Preserve source attribution and event links. Query the SolidCode actor with lowercase country names, a bounded current-plus-next-week date range, no importance filter, and UTC default time zone; cache those paid results for several hours while continuing to refresh the direct source independently. Continue to treat genuinely sparse Israeli coverage as valid source coverage rather than inventing values.