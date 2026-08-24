import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import axios from "axios";

export type ArticleType =
  | "earnings"
  | "legal"
  | "merger"
  | "product"
  | "leadership"
  | "regulation"
  | "analyst"
  | "market"
  | "other";

export type ArticleMetadata = {
  title: string;
  source: string;
  publishedAt: string;
  summary: string;
  articleType: ArticleType;
  fetchedAt: string;
};

const MAX_HTML_BYTES = 1_500_000;
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 8_000;

const ARTICLE_TYPE_TERMS: Array<{ type: ArticleType; terms: string[] }> = [
  { type: "earnings", terms: ["earnings", "revenue", "profit", "quarterly", "eps", "guidance", "דוחות", "רווח", "הכנסות", "תחזית"] },
  { type: "legal", terms: ["lawsuit", "litigation", "court", "settlement", "investigation", "תביעה", "בית משפט", "חקירה", "פשרה"] },
  { type: "merger", terms: ["merger", "acquisition", "acquire", "buyout", "takeover", "מיזוג", "רכישה", "השתלטות"] },
  { type: "product", terms: ["launch", "product", "release", "device", "platform", "אפליקציה", "מוצר", "השקה", "פלטפורמה"] },
  { type: "leadership", terms: ["ceo", "cfo", "executive", "appoints", "resigns", "מנכ", "סמנכ", "הנהלה", "מינוי", "התפטרות"] },
  { type: "regulation", terms: ["regulator", "regulatory", "sec", "antitrust", "policy", "רגולציה", "רשות", "מדיניות", "הגבלים"] },
  { type: "analyst", terms: ["analyst", "price target", "upgrade", "downgrade", "评级", "אנליסט", "מחיר יעד", "המלצה"] },
  { type: "market", terms: ["shares", "stock", "market", "trading", "investors", "מניה", "שוק", "מסחר", "משקיעים"] },
];

export function classifyArticleType(text: string): ArticleType {
  const normalized = text.toLowerCase();
  let best: { type: ArticleType; score: number } = { type: "other", score: 0 };
  for (const candidate of ARTICLE_TYPE_TERMS) {
    const score = candidate.terms.filter((term) => normalized.includes(term.toLowerCase())).length;
    if (score > best.score) best = { type: candidate.type, score };
  }
  return best.type;
}

function decodeHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function readAttribute(tag: string, attribute: string): string | null {
  const match = tag.match(new RegExp(`${attribute}\\s*=\\s*["']([^"']*)["']`, "i"));
  return match?.[1] ? decodeHtml(match[1]) : null;
}

function readMeta(html: string, names: string[]): string | null {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const key = readAttribute(tag, "property") ?? readAttribute(tag, "name");
    if (key && names.some((name) => key.toLowerCase() === name.toLowerCase())) {
      const content = readAttribute(tag, "content");
      if (content) return content;
    }
  }
  return null;
}

function readJsonLd(html: string): Record<string, unknown>[] {
  const scripts = html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) ?? [];
  const records: Record<string, unknown>[] = [];
  for (const script of scripts) {
    const body = script.replace(/^<script\b[^>]*>/i, "").replace(/<\/script>$/i, "").trim();
    try {
      const parsed: unknown = JSON.parse(body);
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      for (const candidate of candidates) {
        if (!candidate || typeof candidate !== "object") continue;
        const record = candidate as Record<string, unknown>;
        records.push(record);
        if (Array.isArray(record["@graph"])) {
          for (const graphItem of record["@graph"]) {
            if (graphItem && typeof graphItem === "object") records.push(graphItem as Record<string, unknown>);
          }
        }
      }
    } catch {
      // Some publishers embed malformed JSON-LD; regular metadata is still useful.
    }
  }
  return records;
}

function isPrivateIp(address: string): boolean {
  const version = net.isIP(address);
  if (version === 4) {
    const octets = address.split(".").map(Number);
    return octets[0] === 0
      || octets[0] === 10
      || octets[0] === 127
      || (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127)
      || (octets[0] === 169 && octets[1] === 254)
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      || (octets[0] === 192 && octets[1] === 0 && octets[2] === 0)
      || (octets[0] === 192 && octets[1] === 168)
      || (octets[0] >= 224);
  }
  const normalized = address.toLowerCase().split("%")[0];
  const ipv6Parts = expandIpv6(normalized);
  if (
    ipv6Parts
    && (
      ipv6Parts.slice(0, 6).every((part) => part === 0)
      || (ipv6Parts.slice(0, 5).every((part) => part === 0) && ipv6Parts[5] === 0xffff)
    )
  ) {
    const mappedIpv4 = [
      ipv6Parts[6] >> 8,
      ipv6Parts[6] & 0xff,
      ipv6Parts[7] >> 8,
      ipv6Parts[7] & 0xff,
    ].join(".");
    return isPrivateIp(mappedIpv4);
  }
  return normalized === "::1"
    || normalized === "::"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || normalized.startsWith("fe8")
    || normalized.startsWith("fe9")
    || normalized.startsWith("fea")
    || normalized.startsWith("feb")
    || normalized.startsWith("ff");
}

function expandIpv6(address: string): number[] | null {
  const [leftRaw, rightRaw, ...extra] = address.split("::");
  if (extra.length > 0) return null;
  const left = leftRaw ? leftRaw.split(":") : [];
  const right = rightRaw ? rightRaw.split(":") : [];
  const parts = [...left, ...right];
  const dottedPart = parts.findIndex((part) => part.includes("."));
  if (dottedPart !== -1) {
    if (dottedPart !== parts.length - 1) return null;
    const octets = parts[dottedPart].split(".").map(Number);
    if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
      return null;
    }
    parts.splice(dottedPart, 1, ((octets[0] << 8) | octets[1]).toString(16), ((octets[2] << 8) | octets[3]).toString(16));
  }
  if (parts.some((part) => !/^[0-9a-f]{1,4}$/i.test(part))) {
    return null;
  }
  const normalizedLeft = left.map((part) => parts.shift() ?? part);
  const normalizedRight = parts;
  const missingParts = 8 - normalizedLeft.length - normalizedRight.length;
  if (missingParts < 0 || (missingParts > 0 && !address.includes("::"))) return null;
  return [...normalizedLeft, ...Array(missingParts).fill("0"), ...normalizedRight]
    .map((part) => Number.parseInt(part, 16));
}

type SafeTarget = {
  url: URL;
  addresses: Array<{ address: string; family: 4 | 6 }>;
};

async function assertPublicUrl(rawUrl: string): Promise<SafeTarget> {
  const parsed = new URL(rawUrl);
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("Only public http and https article URLs are supported");
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".internal")) {
    throw new Error("Private hostnames are not allowed");
  }
  const directFamily = net.isIP(hostname);
  if (directFamily) {
    if (isPrivateIp(hostname)) throw new Error("Private IP addresses are not allowed");
    return { url: parsed, addresses: [{ address: hostname, family: directFamily as 4 | 6 }] };
  }
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error("The article host must resolve to a public address");
  }
  return {
    url: parsed,
    addresses: addresses.map(({ address, family }) => ({ address, family: family as 4 | 6 })),
  };
}

function createPinnedAgent(
  url: URL,
  target: { address: string; family: 4 | 6 },
): http.Agent | https.Agent {
  const lookup: net.LookupFunction = (_hostname, _options, callback) => {
    if (_options.all) {
      callback(null, [{ address: target.address, family: target.family }]);
      return;
    }
    callback(null, target.address, target.family);
  };
  return url.protocol === "https:"
    ? new https.Agent({ lookup })
    : new http.Agent({ lookup });
}

function parseMetadata(html: string, url: URL, fetchedAt: string): ArticleMetadata {
  const head = html.slice(0, MAX_HTML_BYTES);
  const jsonLd = readJsonLd(head);
  const articleJson = jsonLd.find((record) => {
    const type = record["@type"];
    return type === "NewsArticle" || type === "Article" || type === "Report";
  }) ?? jsonLd[0] ?? {};
  const titleTag = decodeHtml(head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const title = readMeta(head, ["og:title", "twitter:title"])
    ?? (typeof articleJson.headline === "string" ? decodeHtml(articleJson.headline) : null)
    ?? titleTag
    ?? url.hostname;
  const summary = readMeta(head, ["og:description", "twitter:description", "description"])
    ?? (typeof articleJson.description === "string" ? decodeHtml(articleJson.description) : "")
    ?? "";
  const publisher = readMeta(head, ["og:site_name", "application-name"]);
  const dateValue = readMeta(head, ["article:published_time", "date", "publish-date"])
    ?? (typeof articleJson.datePublished === "string" ? articleJson.datePublished : null);
  const parsedDate = dateValue && !Number.isNaN(Date.parse(dateValue)) ? new Date(dateValue).toISOString() : fetchedAt;
  const cleanTitle = title.slice(0, 300) || url.hostname;
  const cleanSummary = summary.slice(0, 1_000);

  return {
    title: cleanTitle,
    source: publisher || url.hostname.replace(/^www\./, ""),
    publishedAt: parsedDate,
    summary: cleanSummary,
    articleType: classifyArticleType(`${cleanTitle} ${cleanSummary} ${typeof articleJson.articleSection === "string" ? articleJson.articleSection : ""}`),
    fetchedAt,
  };
}

export async function fetchArticleMetadata(rawUrl: string): Promise<ArticleMetadata> {
  let currentUrl = rawUrl;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const target = await assertPublicUrl(currentUrl);
    const fetchedAt = new Date().toISOString();
    let response: Awaited<ReturnType<typeof axios.get<ArrayBuffer>>> | null = null;
    let requestError: unknown;
    for (const address of target.addresses) {
      const agent = createPinnedAgent(target.url, address);
      try {
        response = await axios.get<ArrayBuffer>(target.url.toString(), {
          httpAgent: target.url.protocol === "http:" ? agent : undefined,
          httpsAgent: target.url.protocol === "https:" ? agent : undefined,
          maxRedirects: 0,
          proxy: false,
          timeout: REQUEST_TIMEOUT_MS,
          responseType: "arraybuffer",
          maxContentLength: MAX_HTML_BYTES,
          maxBodyLength: MAX_HTML_BYTES,
          validateStatus: () => true,
          headers: {
            "User-Agent": "StockPulse/1.0 article metadata reader",
            Accept: "text/html,application/xhtml+xml",
          },
        });
        break;
      } catch (err) {
        requestError = err;
      }
    }
    if (!response) throw requestError ?? new Error("Unable to connect to the article host");
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.location;
      if (!location || redirectCount === MAX_REDIRECTS) throw new Error("Too many article redirects");
      currentUrl = new URL(location, target.url).toString();
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Article page returned HTTP ${response.status}`);
    }
    const contentType = String(response.headers["content-type"] ?? "");
    if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      throw new Error("The link does not point to an HTML article page");
    }
    return parseMetadata(Buffer.from(response.data).toString("utf8"), target.url, fetchedAt);
  }
  throw new Error("Unable to read article metadata");
}