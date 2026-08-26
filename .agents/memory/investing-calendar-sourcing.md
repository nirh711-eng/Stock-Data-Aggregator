---
name: Investing calendar sourcing
description: Reliable access pattern and coverage caveats for Investing.com economic calendar data.
---

Use Investing.com's own calendar endpoints rather than direct page scraping. The filtered calendar POST endpoint can intermittently throttle or return sparse country results; keep a short server cache and fall back to Investing's occurrence JSON endpoint when a country has no usable rows.

**Why:** Direct HTML pages are protected by Cloudflare, while the calendar endpoints return the actual event values. The availability of Israeli releases can be genuinely sparse over a near-term date range, so the UI must show a truthful empty/partial state rather than invent values.

**How to apply:** Keep the source attribution visible even for empty filtered results, preserve each event's Investing.com link, and treat country-filter empty states as valid source coverage rather than an application failure.