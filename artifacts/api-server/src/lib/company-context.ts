import { openai } from "@workspace/integrations-openai-ai-server";
import { jsonrepair } from "jsonrepair";
import yahooFinanceMod from "yahoo-finance2";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const YahooFinance = yahooFinanceMod as any;
const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

export type SpecializationStatus = "available" | "insufficient_data" | "unavailable";
export type SpecializationConfidence = "high" | "medium" | "low" | "unknown";

export type CompanySpecialization = {
  status: SpecializationStatus;
  primaryProduct: string | null;
  offerings: string[];
  customerMarkets: string[];
  keywords: string[];
  confidence: SpecializationConfidence;
  source: string | null;
  generatedAt: string | null;
};

export type CompanyContextInput = {
  ticker: string;
  companyName?: string | null;
  sector?: string | null;
  industry?: string | null;
  description?: string | null;
};

const SPECIALIZATION_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const COMPANY_DETAILS_CACHE_TTL_MS = 30 * 60 * 1000;
const specializationCache = new Map<string, { data: CompanySpecialization; ts: number }>();
const companyDetailsCache = new Map<string, { data: CompanyProfileDetails; ts: number }>();

export type CompanyProfileDetails = {
  ticker: string;
  companyName: string;
  description: string | null;
  sector: string | null;
  industry: string | null;
  website: string | null;
  country: string | null;
  employees: number | null;
};

export function unknownSpecialization(status: SpecializationStatus = "unavailable"): CompanySpecialization {
  return {
    status,
    primaryProduct: null,
    offerings: [],
    customerMarkets: [],
    keywords: [],
    confidence: "unknown",
    source: null,
    generatedAt: null,
  };
}

export function cacheCompanySpecialization(ticker: string, specialization: CompanySpecialization): void {
  specializationCache.set(ticker.toUpperCase(), { data: specialization, ts: Date.now() });
}

export async function getCompanyProfileDetails(ticker: string): Promise<CompanyProfileDetails> {
  const upperTicker = ticker.toUpperCase();
  const cached = companyDetailsCache.get(upperTicker);
  if (cached && Date.now() - cached.ts <= COMPANY_DETAILS_CACHE_TTL_MS) {
    return cached.data;
  }

  const quoteSummary = await yahooFinance.quoteSummary(upperTicker, { modules: ["assetProfile"] });
  const profile = quoteSummary?.assetProfile;
  const details: CompanyProfileDetails = {
    ticker: upperTicker,
    companyName: cleanText(profile?.longName, 160) ?? upperTicker,
    description: cleanText(profile?.longBusinessSummary, 8000),
    sector: cleanText(profile?.sector, 100),
    industry: cleanText(profile?.industry, 140),
    website: cleanText(profile?.website, 500),
    country: cleanText(profile?.country, 100),
    employees: typeof profile?.fullTimeEmployees === "number" && Number.isFinite(profile.fullTimeEmployees)
      ? profile.fullTimeEmployees
      : null,
  };
  companyDetailsCache.set(upperTicker, { data: details, ts: Date.now() });
  return details;
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function cleanList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanText(item, maxLength))
    .filter((item): item is string => Boolean(item))
    .filter((item, index, list) => list.indexOf(item) === index)
    .slice(0, maxItems);
}

function parseJsonObject(content: string): Record<string, unknown> | null {
  if (!content.trim()) return null;
  const candidates = [content, content.match(/\{[\s\S]*\}/)?.[0] ?? ""];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      try {
        const parsed = JSON.parse(jsonrepair(candidate));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // Continue to the next possible JSON fragment.
      }
    }
  }
  return null;
}

export function specializationFromValue(
  value: unknown,
  source: string,
  generatedAt: string,
): CompanySpecialization {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return unknownSpecialization("insufficient_data");
  }

  const candidate = value as Record<string, unknown>;
  const primaryProduct = cleanText(candidate.primaryProduct, 180);
  const offerings = cleanList(candidate.offerings, 6, 100);
  const customerMarkets = cleanList(candidate.customerMarkets, 5, 100);
  const keywords = cleanList(candidate.keywords, 8, 50);
  const confidence = candidate.confidence === "high"
    || candidate.confidence === "medium"
    || candidate.confidence === "low"
    ? candidate.confidence
    : "unknown";

  if (!primaryProduct && offerings.length === 0) {
    return unknownSpecialization("insufficient_data");
  }

  return {
    status: "available",
    primaryProduct,
    offerings,
    customerMarkets,
    keywords,
    confidence,
    source,
    generatedAt,
  };
}

export async function getCompanySpecialization(input: CompanyContextInput): Promise<CompanySpecialization> {
  const ticker = input.ticker.toUpperCase();
  const cached = specializationCache.get(ticker);
  if (cached && Date.now() - cached.ts <= SPECIALIZATION_CACHE_TTL_MS) {
    return cached.data;
  }

  const description = cleanText(input.description, 3200);
  const companyName = cleanText(input.companyName, 160) ?? ticker;
  const sector = cleanText(input.sector, 100) ?? "לא ידוע";
  const industry = cleanText(input.industry, 140) ?? "לא ידוע";

  if (!description || description.length < 40) {
    const fallback = unknownSpecialization("insufficient_data");
    cacheCompanySpecialization(ticker, fallback);
    return fallback;
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 700,
      messages: [
        {
          role: "system",
          content: `אתה מחלץ פרופיל עסקי עובדתי מתוך תיאור חברה שסופק ממקור פיננסי.
השתמש אך ורק במידע שאפשר להסיק ישירות מהתיאור, הסקטור והתעשייה. אל תמציא מוצר, לקוח, שוק או מילת מפתח.
החזר JSON בלבד, ללא markdown, בדיוק במבנה:
{"primaryProduct":"מוצר או תחום מרכזי קצר","offerings":["עד 6 מוצרים או שירותים"],"customerMarkets":["עד 5 שווקי יעד או שימוש"],"keywords":["עד 8 מילות מפתח"],"confidence":"high|medium|low"}
אם המידע אינו מספיק, החזר primaryProduct ריק, מערכים ריקים ו-confidence:"low".`,
        },
        {
          role: "user",
          content: `חברה: ${companyName} (${ticker})
סקטור: ${sector}
תעשייה: ${industry}
תיאור מקור:
${description}`,
        },
      ],
    });
    const parsed = parseJsonObject(response.choices[0]?.message?.content ?? "");
    const generatedAt = new Date().toISOString();
    const specialization = specializationFromValue(
      parsed,
      "Yahoo Finance company description, summarized by AI",
      generatedAt,
    );
    cacheCompanySpecialization(ticker, specialization);
    return specialization;
  } catch {
    const fallback = unknownSpecialization("unavailable");
    cacheCompanySpecialization(ticker, fallback);
    return fallback;
  }
}