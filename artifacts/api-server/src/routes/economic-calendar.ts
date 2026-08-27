import { Router } from "express";
import https from "https";
import { GetEconomicCalendarResponse } from "@workspace/api-zod";

const INVESTING_CALENDAR_URL = "https://www.investing.com/economic-calendar/Service/getCalendarFilteredData";
const INVESTING_CALENDAR_PAGE = "https://www.investing.com/economic-calendar";
const INVESTING_OCCURRENCES_URL = "https://endpoints.investing.com/pd-instruments/v1/calendars/economic/events/occurrences";
const INVESTING_CALENDAR_WIDGET_URL = "https://sslecal2.investing.com/";
const CACHE_TTL_MS = 5 * 60 * 1000;

type CountryConfig = {
  id: string;
  name: "United States" | "Israel";
  code: "US" | "IL";
};

const COUNTRIES: CountryConfig[] = [
  { id: "5", name: "United States", code: "US" },
  { id: "23", name: "Israel", code: "IL" },
];

type CalendarEvent = {
  id: string;
  dateTime: string;
  country: "United States" | "Israel";
  countryCode: "US" | "IL";
  currency: string;
  importance: number;
  title: string;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
  result: "better" | "worse" | "neutral" | null;
  eventUrl: string;
};

type EconomicCalendarData = {
  source: string;
  sourceUrl: string;
  timeZone: string;
  generatedAt: string;
  upcoming: CalendarEvent[];
  recent: CalendarEvent[];
  unavailableCountries: string[];
};

let cache: { expiresAt: number; data: EconomicCalendarData } | null = null;

function htmlDecode(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)));
}

function stripHtml(value: string): string {
  return htmlDecode(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getAttribute(html: string, name: string): string | null {
  const match = html.match(new RegExp(`(?:^|\\s)${escapeRegExp(name)}="([^"]*)"`, "i"));
  return match?.[1] ? htmlDecode(match[1]) : null;
}

function getCell(row: string, className: string): string | null {
  const match = row.match(
    new RegExp(`<td[^>]*class="[^"]*\\b${escapeRegExp(className)}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/td>`, "i"),
  );
  const text = match ? stripHtml(match[1]) : "";
  return text || null;
}

function importanceFromRow(row: string): number {
  const sentimentCell = row.match(/<td[^>]*class="[^"]*\bsentiment\b[^"]*"[^>]*title="([^"]*)"/i);
  const label = sentimentCell?.[1] ?? "";
  if (/high volatility/i.test(label) || /bull3/i.test(row)) return 3;
  if (/moderate volatility/i.test(label) || /bull2/i.test(row)) return 2;
  return 1;
}

function resultFromRow(row: string): CalendarEvent["result"] {
  if (/actual[^>]*greenFont|greenFont[^>]*actual|data-result="better"/i.test(row)) return "better";
  if (/actual[^>]*redFont|redFont[^>]*actual|data-result="worse"/i.test(row)) return "worse";
  return /actual_to_forecast[^>]*neutral|blackFont/i.test(row) ? "neutral" : null;
}

function parseDateTime(raw: string | null): string | null {
  if (!raw || !/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) return null;
  return `${raw.replace(/\//g, "-").replace(" ", "T")}Z`;
}

function parseCalendarHtml(html: string, country: CountryConfig): CalendarEvent[] {
  const rows = html.match(/<tr id="eventRowId_[^"]+"[\s\S]*?<\/tr>/gi) ?? [];
  const seen = new Set<string>();
  const events: CalendarEvent[] = [];

  for (const row of rows) {
    const id = row.match(/\sid="eventRowId_(\d+)"/i)?.[1] ?? null;
    const dateTime = parseDateTime(getAttribute(row, "data-event-datetime"));
    const titleMatch = row.match(/<td[^>]*class="[^"]*\bevent\b[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    const title = titleMatch ? stripHtml(titleMatch[2]) : null;
    if (!id || !dateTime || !title || !titleMatch || seen.has(id)) continue;

    seen.add(id);
    const href = htmlDecode(titleMatch[1]);
    events.push({
      id,
      dateTime,
      country: country.name,
      countryCode: country.code,
      currency: getCell(row, "flagCur")?.split(/\s+/).pop() ?? (country.code === "US" ? "USD" : "ILS"),
      importance: importanceFromRow(row),
      title,
      actual: getCell(row, "act"),
      forecast: getCell(row, "fore"),
      previous: getCell(row, "prev"),
      result: resultFromRow(row),
      eventUrl: href.startsWith("http") ? href : `https://www.investing.com${href}`,
    });
  }

  return events;
}

function parseWidgetDateTime(dayStartMs: number | null, time: string | null): string | null {
  if (!dayStartMs || !time) return null;
  const timeMatch = time.match(/(^|\s)(\d{1,2}):(\d{2})(?:\s|$)/);
  if (!timeMatch) return null;

  const date = new Date(dayStartMs);
  date.setUTCHours(Number(timeMatch[2]), Number(timeMatch[3]), 0, 0);
  return date.toISOString();
}

function parseCalendarWidgetHtml(html: string, country: CountryConfig): CalendarEvent[] {
  const rows = html.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];
  const seen = new Set<string>();
  const events: CalendarEvent[] = [];
  let dayStartMs: number | null = null;

  for (const row of rows) {
    const dayStamp = row.match(/\bid="theDay(\d+)"/i)?.[1];
    if (dayStamp) {
      const value = Number(dayStamp);
      dayStartMs = Number.isFinite(value) ? (value < 1_000_000_000_000 ? value * 1_000 : value) : null;
    }

    const id = row.match(/\sid="eventRowId_(\d+)"/i)?.[1] ?? null;
    const titleMatch = row.match(/<td[^>]*class="[^"]*\bevent\b[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    const title = titleMatch ? stripHtml(titleMatch[2]) : null;
    const dateTime = parseDateTime(getAttribute(row, "data-event-datetime"))
      ?? parseWidgetDateTime(dayStartMs, getCell(row, "time"));
    if (!id || !dateTime || !title || !titleMatch || seen.has(id)) continue;

    seen.add(id);
    const href = htmlDecode(titleMatch[1]);
    events.push({
      id,
      dateTime,
      country: country.name,
      countryCode: country.code,
      currency: getCell(row, "flagCur")?.split(/\s+/).pop() ?? (country.code === "US" ? "USD" : "ILS"),
      importance: importanceFromRow(row),
      title,
      actual: getCell(row, "act"),
      forecast: getCell(row, "fore"),
      previous: getCell(row, "prev"),
      result: resultFromRow(row),
      eventUrl: href.startsWith("http") ? href : `https://www.investing.com${href}`,
    });
  }

  return events;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function fetchCountryCalendar(country: CountryConfig, from: string, to: string): Promise<CalendarEvent[]> {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams();
    body.append("dateFrom", from);
    body.append("dateTo", to);
    body.append("timeZone", "15"); // GMT keeps the returned timestamp unambiguous.
    body.append("timeFilter", "timeOnly");
    body.append("currentTab", "custom");
    body.append("submitFilters", "1");
    body.append("limit_from", "0");
    body.append("limit_to", "1000");
    body.append("country[]", country.id);
    body.append("importance[]", "1");
    body.append("importance[]", "2");
    body.append("importance[]", "3");
    const request = https.request(
      INVESTING_CALENDAR_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "Content-Length": Buffer.byteLength(body.toString()),
          "User-Agent": "Mozilla/5.0 (compatible; StockPulse/1.0)",
          Accept: "text/html, */*; q=0.01",
          "X-Requested-With": "XMLHttpRequest",
          Referer: `${INVESTING_CALENDAR_PAGE}/`,
        },
        timeout: 15_000,
      },
      (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => { raw += chunk; });
        response.on("end", () => {
          if ((response.statusCode ?? 500) >= 400) {
            reject(new Error(`Investing.com returned ${response.statusCode}`));
            return;
          }
          try {
            const payload = JSON.parse(raw) as { data?: string };
            resolve(parseCalendarHtml(payload.data ?? "", country));
          } catch {
            reject(new Error("Investing.com returned an invalid calendar response"));
          }
        });
      },
    );

    request.on("timeout", () => request.destroy(new Error("Investing.com calendar request timed out")));
    request.on("error", reject);
    request.write(body.toString());
    request.end();
  });
}

function fetchCurrentWeekWidgetCalendar(country: CountryConfig): Promise<CalendarEvent[]> {
  return new Promise((resolve, reject) => {
    const url = new URL(INVESTING_CALENDAR_WIDGET_URL);
    url.searchParams.set("columns", "exc_flags,exc_currency,exc_importance,exc_actual,exc_forecast,exc_previous");
    url.searchParams.set("features", "datepicker,timezone");
    url.searchParams.set("countries", country.id);
    url.searchParams.set("importance", "1,2,3");
    url.searchParams.set("calType", "week");
    url.searchParams.set("timeZone", "55"); // UTC, matching the main calendar response.
    url.searchParams.set("lang", "1");

    const request = https.get(
      url,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; StockPulse/1.0)",
          Accept: "text/html, */*; q=0.01",
          Referer: INVESTING_CALENDAR_PAGE,
        },
        timeout: 8_000,
      },
      (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => { raw += chunk; });
        response.on("end", () => {
          if ((response.statusCode ?? 500) >= 400) {
            reject(new Error(`Investing.com calendar widget returned ${response.statusCode}`));
            return;
          }
          resolve(parseCalendarWidgetHtml(raw, country));
        });
      },
    );

    request.on("timeout", () => request.destroy(new Error("Investing.com calendar widget request timed out")));
    request.on("error", reject);
  });
}

type InvestingOccurrencePayload = {
  events?: Array<{
    event_id?: number;
    country_id?: number;
    currency?: string;
    importance?: "low" | "medium" | "high";
    long_name?: string;
    page_link?: string;
  }>;
  occurrences?: Array<{
    occurrence_id?: number;
    event_id?: number;
    occurrence_time?: string;
    actual?: number | string | null;
    forecast?: number | string | null;
    previous?: number | string | null;
    actual_to_forecast?: "positive" | "negative" | "neutral";
    reference_period?: string;
    precision?: number;
    unit?: string;
  }>;
};

function formatOccurrenceValue(
  value: number | string | null | undefined,
  precision: number | undefined,
  unit: string | undefined,
): string | null {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = typeof value === "number" ? value : Number(value);
  const formatted = Number.isFinite(numberValue) && typeof value !== "string"
    ? (precision === undefined ? String(value) : numberValue.toFixed(precision))
    : String(value);
  return `${formatted}${unit ?? ""}`.trim() || null;
}

function fetchOccurrencesFallback(from: Date, to: Date): Promise<CalendarEvent[]> {
  return new Promise((resolve, reject) => {
    const url = new URL(INVESTING_OCCURRENCES_URL);
    url.searchParams.set("domain_id", "1");
    url.searchParams.set("limit", "500");
    url.searchParams.set("start_date", from.toISOString());
    url.searchParams.set("end_date", to.toISOString());

    https.get(
      url,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; StockPulse/1.0)",
          Accept: "application/json, text/plain, */*",
          Referer: `${INVESTING_CALENDAR_PAGE}/`,
        },
        timeout: 15_000,
      },
      (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => { raw += chunk; });
        response.on("end", () => {
          if ((response.statusCode ?? 500) >= 400) {
            reject(new Error(`Investing.com occurrence endpoint returned ${response.statusCode}`));
            return;
          }
          try {
            const payload = JSON.parse(raw) as InvestingOccurrencePayload;
            const targetCountries = new Map(COUNTRIES.map((country) => [Number(country.id), country]));
            const eventMeta = new Map(
              (payload.events ?? [])
                .filter((event) => event.event_id && event.country_id && targetCountries.has(event.country_id))
                .map((event) => [event.event_id!, event]),
            );
            const events = (payload.occurrences ?? []).flatMap((occurrence) => {
              const meta = occurrence.event_id ? eventMeta.get(occurrence.event_id) : undefined;
              const country = meta?.country_id ? targetCountries.get(meta.country_id) : undefined;
              if (!meta || !country || !occurrence.occurrence_id || !occurrence.occurrence_time || !meta.long_name) return [];
              const importance = meta.importance === "high" ? 3 : meta.importance === "medium" ? 2 : 1;
              const period = occurrence.reference_period ? ` (${occurrence.reference_period})` : "";
              return [{
                id: String(occurrence.occurrence_id),
                dateTime: occurrence.occurrence_time,
                country: country.name,
                countryCode: country.code,
                currency: meta.currency ?? (country.code === "US" ? "USD" : "ILS"),
                importance,
                title: `${meta.long_name}${period}`,
                actual: formatOccurrenceValue(occurrence.actual, occurrence.precision, occurrence.unit),
                forecast: formatOccurrenceValue(occurrence.forecast, occurrence.precision, occurrence.unit),
                previous: formatOccurrenceValue(occurrence.previous, occurrence.precision, occurrence.unit),
                result: occurrence.actual_to_forecast === "positive"
                  ? "better"
                  : occurrence.actual_to_forecast === "negative"
                    ? "worse"
                    : occurrence.actual_to_forecast ?? null,
                eventUrl: meta.page_link?.startsWith("http")
                  ? meta.page_link
                  : `https://www.investing.com${meta.page_link ?? "/economic-calendar"}`,
              }] satisfies CalendarEvent[];
            });
            resolve(events);
          } catch {
            reject(new Error("Investing.com occurrence endpoint returned invalid JSON"));
          }
        });
      },
    ).on("error", reject);
  });
}

async function loadEconomicCalendar(): Promise<EconomicCalendarData> {
  if (cache && cache.expiresAt > Date.now()) return cache.data;

  const now = new Date();
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - 14);
  const to = new Date(now);
  to.setUTCDate(to.getUTCDate() + 30);

  const settled = await Promise.allSettled(
    COUNTRIES.map((country) => {
      // Israeli macro releases are less frequent, so retain enough history to show the latest
      // official reading even when no release falls within the near-term calendar window.
      const countryFrom = new Date(from);
      if (country.code === "IL") countryFrom.setUTCDate(countryFrom.getUTCDate() - 106);
      return fetchCountryCalendar(country, formatDate(countryFrom), formatDate(to));
    }),
  );

  let unavailableCountries: string[] = [];
  const events: CalendarEvent[] = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") events.push(...result.value);
    else unavailableCountries.push(COUNTRIES[index].name);
  });

  const widgetSettled = await Promise.allSettled(
    COUNTRIES.map((country) => fetchCurrentWeekWidgetCalendar(country)),
  );
  widgetSettled.forEach((result) => {
    if (result.status === "fulfilled") events.push(...result.value);
  });

  const countriesWithNoEvents = COUNTRIES.filter((country) =>
    !events.some((event) => event.countryCode === country.code),
  );
  if (countriesWithNoEvents.length > 0) {
    try {
      const [recentFallback, upcomingFallback] = await Promise.all([
        fetchOccurrencesFallback(from, now),
        fetchOccurrencesFallback(now, to),
      ]);
      const fallback = [...recentFallback, ...upcomingFallback];
      for (const country of countriesWithNoEvents) {
        events.push(...fallback.filter((event) => event.countryCode === country.code));
      }
      unavailableCountries = unavailableCountries.filter((country) =>
        events.some((event) => event.country === country),
      );
    } catch {
      // The primary Investing calendar result remains usable; expose any missing country transparently.
      unavailableCountries = [...new Set([...unavailableCountries, ...countriesWithNoEvents.map((country) => country.name)])];
    }
  }

  if (events.length === 0) {
    throw new Error("No calendar data was available from Investing.com");
  }

  const nowMs = now.getTime();
  const sorted = [...new Map(events.map((event) => [`${event.countryCode}:${event.id}`, event])).values()]
    .sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime());
  const data: EconomicCalendarData = {
    source: "Investing.com",
    sourceUrl: INVESTING_CALENDAR_PAGE,
    timeZone: "UTC",
    generatedAt: now.toISOString(),
    upcoming: sorted.filter((event) => new Date(event.dateTime).getTime() > nowMs),
    recent: sorted.filter((event) => new Date(event.dateTime).getTime() <= nowMs).reverse(),
    unavailableCountries,
  };
  cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
  return data;
}

const router = Router();

router.get("/economy/calendar", async (req, res): Promise<void> => {
  try {
    const data = await loadEconomicCalendar();
    res.json(GetEconomicCalendarResponse.parse(data));
  } catch (error) {
    req.log?.warn({ err: error }, "Investing.com economic calendar unavailable");
    res.status(502).json({ error: "Economic calendar data is temporarily unavailable" });
  }
});

export default router;