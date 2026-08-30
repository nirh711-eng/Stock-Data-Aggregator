import { Router } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import { jsonrepair } from "jsonrepair";
import yahooFinanceMod from "yahoo-finance2";

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const YahooFinance = yahooFinanceMod as any;
const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

// ── 6-hour server-side cache ──────────────────────────────────────────────────
let _cache: { data: BottleneckAnalysis; expires: number } | null = null;

interface ServingCompany {
  ticker: string;
  name: string;
  role: string;
  moat: string;
  marketCap: string;
}

interface Bottleneck {
  name: string;
  sector: string;
  description: string;
  powerSource: string;
  maturityLevel: string;
  servingCompanies: ServingCompany[];
  capitalFlow: string;
  whyItMatters: string;
  confidenceScore?: number;
  confidenceLabel?: "גבוהה" | "בינונית" | "נמוכה";
  evidence?: string[];
  quantitativeSignals?: {
    companiesCovered: number;
    avgMarketCap: string;
    avg52WeekPosition: number | null;
    avgRelativeVolume: number | null;
  };
}

interface NextBottleneck {
  name: string;
  sector: string;
  timeline: string;
  trigger: string;
  earlySignals: string;
  whyNow: string;
  positionedCompanies: Array<{
    ticker: string;
    name: string;
    whyWin: string;
    marketCap: string;
  }>;
  urgency: "high" | "medium" | "low";
  capitalFlowMap: string;
  confidenceScore?: number;
  confidenceLabel?: "גבוהה" | "בינונית" | "נמוכה";
  evidence?: string[];
}

interface BottleneckAnalysis {
  marketContext: string;
  currentBottlenecks: Bottleneck[];
  nextBottleneck: NextBottleneck;
  smartMoneyFlow: string;
  generatedAt: string;
}

interface MarketEvidence {
  ticker: string;
  marketCap: number | null;
  marketCapLabel: string;
  change1d: number | null;
  relativeVolume: number | null;
  week52Position: number | null;
}

type BottleneckThesis = {
  name: string;
  sector: string;
  description: string;
  powerSource: string;
  maturityLevel: string;
  whyItMatters: string;
  capitalFlow: string;
  evidence: string[];
  tickers: string[];
};

const BOTTLENECK_THESES: BottleneckThesis[] = [
  {
    name: "מאיצי AI וזיכרון High-Bandwidth",
    sector: "שבבים ותשתיות מחשוב",
    description: "המחסור אינו רק ב-GPU בודד אלא בשילוב של מאיצים, זיכרון HBM, אריזה מתקדמת ויכולת ייצור. מי ששולט בצומת הזה מקבל כוח תמחור מול ענן ומפתחי מודלים.",
    powerSource: "טכנולוגיה + IP + תשתית",
    maturityLevel: "בשל",
    whyItMatters: "כל דולר שנוסף להשקעות AI עובר קודם דרך שכבת המאיצים והאריזה, ולכן זו נקודת לכידת ערך מדידה ולא רק נרטיב.",
    capitalFlow: "CAPEX של hyperscalers, הזמנות ארוכות טווח וצמיחת ביקוש לחישוב מואץ.",
    evidence: ["תלות מערכתית במאיץ + HBM + אריזה מתקדמת", "ספקים מעטים עם יתרון ביצועי ותפוקת ייצור", "אימות כמותי לפי שווי, מומנטום ונפח מסחר של החברות המובילות"],
    tickers: ["NVDA", "AVGO", "TSM", "MU"],
  },
  {
    name: "חשמל, קירור וחיבור לרשת עבור דאטה סנטרים",
    sector: "חשמל ותשתיות",
    description: "קצב בניית הדאטה סנטרים נתקל במגבלת הספק, שנאים, קירור וחיבור לרשת. צוואר הבקבוק עובר מסיליקון פיזי למגה-ואטים זמינים ולזמן אספקה.",
    powerSource: "תשתית + רגולציה + סקייל",
    maturityLevel: "בצמיחה",
    whyItMatters: "פרויקט מחשוב שלא מקבל חשמל וחיבור לרשת בזמן אינו מייצר הכנסה, ולכן ספקי התשתית הקריטית עשויים ללכוד ערך גם אם מחזור השבבים מתמתן.",
    capitalFlow: "השקעות תשתית, חוזי ציוד חשמלי ותקציבי הרחבה של ענן ומרכזי נתונים.",
    evidence: ["צורך פיזי שאי אפשר לפתור רק בתוכנה", "זמני אספקה והיתרי רשת יוצרים חסם כניסה", "אימות כמותי לפי שווי, מומנטום ונפח מסחר של הספקים"],
    tickers: ["VRT", "ETN", "PWR", "GEV"],
  },
  {
    name: "ציוד ייצור שבבים ו-lithography",
    sector: "ציוד מוליכים למחצה",
    description: "ייצור שבבים מתקדמים תלוי בציוד מורכב, ידע תהליכי ושרשרת שירות גלובלית. במספר תתי-מערכות יש מעט ספקים עם שנים של יתרון מצטבר.",
    powerSource: "IP + טכנולוגיה + נתוני תהליך",
    maturityLevel: "בשל",
    whyItMatters: "כל הרחבת קיבולת מתקדמת דורשת השקעה בציוד לפני שהכנסות השבבים מגיעות, כך שהספקים נהנים ממנוף על כל שרשרת הערך.",
    capitalFlow: "מפעלי foundry, סובסידיות שבבים והזמנות ציוד לטכנולוגיות 2nm/3nm.",
    evidence: ["ריכוז ספקים גבוה בתהליכי ייצור מתקדמים", "עלות החלפה ואימות תהליך מונעים מעבר מהיר", "אימות כמותי לפי עוצמת מחיר ונפח של מובילי הציוד"],
    tickers: ["ASML", "AMAT", "LRCX", "KLAC"],
  },
  {
    name: "רשתות נתונים ואבטחת תעבורה",
    sector: "תוכנה ותשתיות רשת",
    description: "הרחבת AI מגדילה את תעבורת הנתונים בתוך הדאטה סנטר ומחוצה לו. צוואר הבקבוק נמצא ברכיבי קישוריות, אופטיקה, switching ואבטחה שמאפשרים להעביר את החישוב בפועל.",
    powerSource: "טכנולוגיה + סקייל + תוכנה",
    maturityLevel: "בצמיחה",
    whyItMatters: "ללא רוחב פס, החומרה היקרה אינה מנוצלת; לכן ההוצאה על networking יכולה לצמוח גם כשלקוחות מייעלים את הוצאות המחשוב.",
    capitalFlow: "שדרוגי data center, מעבר ל-800G/1.6T ותקציבי אבטחת ענן.",
    evidence: ["הגידול בחישוב מייצר ביקוש משלים לרשת ולאבטחה", "עלויות מעבר ותאימות מעדיפות ספקים מוכחים", "אימות כמותי לפי ביצועי שוק ונפח מסחר"],
    tickers: ["ANET", "CSCO", "CRWD", "PANW"],
  },
];

const COMPANY_NAMES: Record<string, string> = {
  NVDA: "NVIDIA",
  AVGO: "Broadcom",
  TSM: "TSMC",
  MU: "Micron",
  VRT: "Vertiv",
  ETN: "Eaton",
  PWR: "Quanta Services",
  GEV: "GE Vernova",
  ASML: "ASML",
  AMAT: "Applied Materials",
  LRCX: "Lam Research",
  KLAC: "KLA",
  ANET: "Arista Networks",
  CSCO: "Cisco",
  CRWD: "CrowdStrike",
  PANW: "Palo Alto Networks",
};

const COMPANY_ROLES: Record<string, string> = {
  NVDA: "מאיצי GPU, תוכנת CUDA ופלטפורמת AI",
  AVGO: "שבבי networking, ASIC וקישוריות לדאטה סנטר",
  TSM: "ייצור foundry ואריזה מתקדמת",
  MU: "זיכרון HBM ו-DRAM למחשוב מואץ",
  VRT: "חשמל, UPS וקירור לדאטה סנטרים",
  ETN: "ניהול הספק, switchgear וחיבורי חשמל",
  PWR: "הקמת תשתיות הולכה וחיבור לרשת",
  GEV: "ציוד ייצור חשמל וטורבינות",
  ASML: "מערכות lithography מתקדמות",
  AMAT: "ציוד deposition וייצור wafer",
  LRCX: "ציוד etch וניקוי wafer",
  KLAC: "בקרת תהליך ומטרולוגיה",
  ANET: "מתגי Ethernet ורשתות AI",
  CSCO: "תשתיות switching ואבטחת רשת",
  CRWD: "אבטחת endpoint ותעבורת ענן",
  PANW: "פלטפורמת אבטחת רשת וענן",
};

function formatMarketCap(value: number | null): string {
  if (!value || value <= 0) return "לא זמין";
  if (value >= 1e12) return `$${(value / 1e12).toFixed(1)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(0)}B`;
  return `$${(value / 1e6).toFixed(0)}M`;
}

function confidenceLabel(score: number): "גבוהה" | "בינונית" | "נמוכה" {
  return score >= 75 ? "גבוהה" : score >= 55 ? "בינונית" : "נמוכה";
}

async function fetchMarketEvidence(): Promise<MarketEvidence[]> {
  const tickers = [...new Set(BOTTLENECK_THESES.flatMap((thesis) => thesis.tickers))];
  try {
    const quotes = await yahooFinance.quote(tickers, {}, { validateResult: false }) as Array<Record<string, unknown>>;
    return quotes.map((quote) => {
      const marketCap = typeof quote.marketCap === "number" ? quote.marketCap : null;
      const high = typeof quote.fiftyTwoWeekHigh === "number" ? quote.fiftyTwoWeekHigh : null;
      const low = typeof quote.fiftyTwoWeekLow === "number" ? quote.fiftyTwoWeekLow : null;
      const price = typeof quote.regularMarketPrice === "number" ? quote.regularMarketPrice : null;
      const volume = typeof quote.regularMarketVolume === "number" ? quote.regularMarketVolume : null;
      const averageVolume = typeof quote.averageDailyVolume3Month === "number" ? quote.averageDailyVolume3Month : null;
      return {
        ticker: String(quote.symbol ?? ""),
        marketCap,
        marketCapLabel: formatMarketCap(marketCap),
        change1d: typeof quote.regularMarketChangePercent === "number" ? quote.regularMarketChangePercent : null,
        relativeVolume: volume && averageVolume ? volume / averageVolume : null,
        week52Position: price && high && low && high > low ? ((price - low) / (high - low)) * 100 : null,
      };
    }).filter((item) => item.ticker);
  } catch {
    return [];
  }
}

function evidenceForThesis(thesis: BottleneckThesis, marketEvidence: MarketEvidence[]) {
  const covered = marketEvidence.filter((item) => thesis.tickers.includes(item.ticker));
  const avg = (values: Array<number | null>) => {
    const usable = values.filter((value): value is number => value !== null && Number.isFinite(value));
    return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
  };
  const avgPosition = avg(covered.map((item) => item.week52Position));
  const avgVolume = avg(covered.map((item) => item.relativeVolume));
  const positiveDays = covered.filter((item) => (item.change1d ?? 0) > 0).length;
  const coverageScore = Math.min(25, covered.length * 6);
  const marketScore = (avgPosition ?? 50) >= 65 ? 15 : (avgPosition ?? 50) >= 45 ? 10 : 5;
  const flowScore = (avgVolume ?? 1) >= 1.25 || positiveDays >= Math.ceil(Math.max(1, covered.length) / 2) ? 10 : 5;
  const score = Math.min(95, 50 + coverageScore + marketScore + flowScore);
  return {
    covered,
    avgPosition,
    avgVolume,
    score,
    label: confidenceLabel(score),
  };
}

function buildEvidenceSummary(marketEvidence: MarketEvidence[]): string {
  return BOTTLENECK_THESES.map((thesis) => {
    const details = evidenceForThesis(thesis, marketEvidence);
    const companies = details.covered.map((item) =>
      `${item.ticker}: שווי ${item.marketCapLabel}, שינוי יומי ${item.change1d === null ? "לא זמין" : `${item.change1d.toFixed(2)}%`}, מיקום 52 שבועות ${item.week52Position === null ? "לא זמין" : `${item.week52Position.toFixed(0)}%`}, נפח יחסי ${item.relativeVolume === null ? "לא זמין" : `${item.relativeVolume.toFixed(2)}x`}`,
    ).join(" | ");
    return `${thesis.name}: ${companies || "אין נתון חי"} | ציון אמינות מחושב ${details.score}/100 (${details.label})`;
  }).join("\n");
}

function buildFallbackAnalysis(marketEvidence: MarketEvidence[]): BottleneckAnalysis {
  const currentBottlenecks = BOTTLENECK_THESES.slice(0, 4).map((thesis) => {
    const details = evidenceForThesis(thesis, marketEvidence);
    const companies = (details.covered.length ? details.covered : thesis.tickers.map((ticker) => ({ ticker, marketCapLabel: "לא זמין" })))
      .slice(0, 4)
      .map((item) => ({
        ticker: item.ticker,
        name: COMPANY_NAMES[item.ticker] ?? item.ticker,
        role: COMPANY_ROLES[item.ticker] ?? "ספק קריטי בצומת הערך",
        moat: thesis.powerSource,
        marketCap: item.marketCapLabel,
      }));
    return {
      name: thesis.name,
      sector: thesis.sector,
      description: thesis.description,
      powerSource: thesis.powerSource,
      maturityLevel: thesis.maturityLevel,
      servingCompanies: companies,
      capitalFlow: thesis.capitalFlow,
      whyItMatters: thesis.whyItMatters,
      confidenceScore: details.score,
      confidenceLabel: details.label,
      evidence: thesis.evidence,
      quantitativeSignals: {
        companiesCovered: details.covered.length,
        avgMarketCap: formatMarketCap(
          details.covered.length
            ? details.covered.reduce((sum, item) => sum + (item.marketCap ?? 0), 0) / details.covered.length
            : null,
        ),
        avg52WeekPosition: details.avgPosition,
        avgRelativeVolume: details.avgVolume,
      },
    };
  });
  const nextThesis = BOTTLENECK_THESES[1];
  const nextDetails = evidenceForThesis(nextThesis, marketEvidence);
  return {
    marketContext: "הניתוח משלב מסגרת מבנית של תלות בתשתית עם נתוני שוק חיים עבור החברות בצומת. ציון האמינות אינו תחזית מחיר: הוא משקלל כיסוי נתונים, מיקום מול טווח 52 שבועות ונפח יחסי.",
    currentBottlenecks,
    nextBottleneck: {
      name: "חשמל, קירור וחיבור לרשת עבור דאטה סנטרים",
      sector: nextThesis.sector,
      timeline: "6–18 חודשים",
      trigger: "המשך הרחבת קיבולת AI ללא גידול מקביל בהספק זמין, שנאים וחיבורי רשת.",
      earlySignals: "הזמנות ציוד חשמלי, backlog ארוך, פרויקטים שממתינים לחיבור לרשת ועלייה בנפח המסחר של ספקי התשתית.",
      whyNow: nextThesis.whyItMatters,
      capitalFlowMap: nextThesis.capitalFlow,
      positionedCompanies: nextThesis.tickers.slice(0, 4).map((ticker) => ({
        ticker,
        name: ticker,
        whyWin: "חשיפה ישירה לציוד או לתשתית שמאפשרים להפעיל קיבולת מחשוב חדשה.",
        marketCap: marketEvidence.find((item) => item.ticker === ticker)?.marketCapLabel ?? "לא זמין",
      })),
      urgency: "high",
      confidenceScore: nextDetails.score,
      confidenceLabel: nextDetails.label,
      evidence: nextThesis.evidence,
    },
    smartMoneyFlow: "הכסף עובר מהשכבה הנראית של אפליקציות AI לשכבות הקשות להחלפה: מאיצים, ציוד ייצור, חשמל, קירור ורשת. יש להעדיף חברות שבהן לפחות שניים משלושת האותות — כיסוי נתונים, מיקום 52 שבועות ונפח יחסי — זמינים ותומכים בתזה.",
    generatedAt: new Date().toISOString(),
  };
}

function enrichAiResult(result: BottleneckAnalysis, marketEvidence: MarketEvidence[]): BottleneckAnalysis {
  const allowedTickers = new Set(BOTTLENECK_THESES.flatMap((thesis) => thesis.tickers));
  const enrich = (item: Bottleneck, index: number): Bottleneck => {
    const matched = BOTTLENECK_THESES.find((thesis) =>
      item.sector === thesis.sector
      || item.name.includes(thesis.name.slice(0, 8))
      || thesis.name.includes(item.name.slice(0, 8)),
    ) ?? BOTTLENECK_THESES[index % BOTTLENECK_THESES.length];
    const details = evidenceForThesis(matched, marketEvidence);
    const companies = (Array.isArray(item.servingCompanies) ? item.servingCompanies : [])
      .filter((company) => allowedTickers.has(company.ticker?.toUpperCase?.() ?? ""))
      .map((company) => ({
        ...company,
        ticker: company.ticker.toUpperCase(),
        name: COMPANY_NAMES[company.ticker.toUpperCase()] ?? company.name,
        role: company.role || COMPANY_ROLES[company.ticker.toUpperCase()] || "ספק קריטי בצומת הערך",
      }));
    return {
      ...item,
      servingCompanies: companies.length ? companies : buildFallbackAnalysis(marketEvidence).currentBottlenecks[index].servingCompanies,
      confidenceScore: details.score,
      confidenceLabel: details.label,
      evidence: matched.evidence,
      quantitativeSignals: {
        companiesCovered: details.covered.length,
        avgMarketCap: formatMarketCap(
          details.covered.length
            ? details.covered.reduce((sum, evidence) => sum + (evidence.marketCap ?? 0), 0) / details.covered.length
            : null,
        ),
        avg52WeekPosition: details.avgPosition,
        avgRelativeVolume: details.avgVolume,
      },
    };
  };

  const currentBottlenecks = result.currentBottlenecks.slice(0, 5).map(enrich);
  const next = result.nextBottleneck;
  const nextMatched = BOTTLENECK_THESES.find((thesis) =>
    next.sector === thesis.sector || next.name?.includes(thesis.name.slice(0, 8)),
  ) ?? BOTTLENECK_THESES[1];
  const nextDetails = evidenceForThesis(nextMatched, marketEvidence);
  return {
    ...result,
    currentBottlenecks,
    nextBottleneck: {
      ...next,
      confidenceScore: nextDetails.score,
      confidenceLabel: nextDetails.label,
      evidence: nextMatched.evidence,
      positionedCompanies: (Array.isArray(next.positionedCompanies) ? next.positionedCompanies : [])
        .filter((company) => allowedTickers.has(company.ticker?.toUpperCase?.() ?? ""))
        .map((company) => ({
          ...company,
          ticker: company.ticker.toUpperCase(),
          name: COMPANY_NAMES[company.ticker.toUpperCase()] ?? company.name,
        })),
    },
  };
}

function robustParse(str: string): Record<string, unknown> | null {
  if (!str || str.trim() === "") return null;
  try { return JSON.parse(str); } catch { /* continue */ }
  try { return JSON.parse(jsonrepair(str)); } catch { /* continue */ }
  const extracted = str.match(/\{[\s\S]*\}/)?.[0];
  if (!extracted) return null;
  try { return JSON.parse(jsonrepair(extracted)); } catch { return null; }
}

router.get("/bottlenecks", async (req, res) => {
  if (_cache && Date.now() < _cache.expires) {
    res.json(_cache.data);
    return;
  }

  try {
    const marketEvidence = await fetchMarketEvidence();
    const evidenceSummary = buildEvidenceSummary(marketEvidence);
    const systemPrompt = `אתה אנליסט מאקרו וסוחר בכיר בדסק קטליסטים של קרן גידור גלובלית מובילה.
ההתמחות שלך היא זיהוי מוקדם של: שינויי מבנה בשוק, צווארי בקבוק, בריכות ערך, וזרימת הון חכמה (Smart Money).
כתוב בעברית. חד, ישיר, ללא מילים מיותרות. כל משפט חייב לנוע כסף. חשיבה של כסף — לא של כותרות.
CRITICAL: החזר אך ורק JSON תקני, ללא markdown, ללא טקסט מחוץ ל-JSON.
CRITICAL: אל תשתמש בגרשיים (") בתוך ערכי טקסט — השתמש בגרש בודד (') או תמיד סגור ערכים ב-escaped quotes.
CRITICAL: אל תמציא טיקרים או נתוני שוק. השתמש רק בחברות שמופיעות בראיות החיות שסופקו.`;

    const today = new Date().toLocaleDateString("he-IL", { year: "numeric", month: "long", day: "numeric" });

    const userPrompt = `תאריך היום: ${today}. נתח את צווארי הבקבוק הנוכחיים בשוק ההון הגלובלי לפי המסגרת הבאה:

זהה 4 צווארי בקבוק שבהם ריכוז כוח אמיתי — מקומות שבהם ערך כלכלי נוצר ונלכד בשל: טכנולוגיה ייחודית, רגולציה, סקייל, קניין רוחני, נתונים, או תשתית קריטית.

לכל צוואר בקבוק — ציין את החברות האמיתיות שמשרתות אותו עם טיקרים נכונים.

לאחר מכן — זהה את צוואר הבקבוק הבא שיתחיל להיבנות ב-6-18 חודשים הקרובים, עם החברות שמוצבות לנצל אותו לפני השוק.

הראיות החיות שעליהן חובה לבסס את התשובה:
${evidenceSummary}

הוסף לכל צוואר גם confidenceScore בין 0 ל-100, confidenceLabel בעברית, ומערך evidence קצר. הציון צריך לשקלל כיסוי נתונים, מיקום מול טווח 52 שבועות ונפח יחסי — הוא אינו יעד מחיר.

החזר JSON בדיוק כך:
{
  "marketContext": "הקשר מאקרו נוכחי שמסביר למה הצווארים הקיימים חזקים עכשיו. 2-3 משפטים.",
  "currentBottlenecks": [
    {
      "name": "שם קצר וחד של צוואר הבקבוק",
      "sector": "תחום/ענף",
      "description": "מה בדיוק מהווה את הצוואר? מאיפה הכוח? 2 משפטים.",
      "powerSource": "טכנולוגיה/רגולציה/סקייל/IP/נתונים/תשתית",
      "maturityLevel": "בשל/בצמיחה/מתפתח",
      "whyItMatters": "למה זה חשוב למשקיע עכשיו? לאן הכסף זז?",
      "capitalFlow": "כמה הון זורם לכאן ולמה — ביקוש מוסדי, ETF flows, insider buying",
      "servingCompanies": [
        {
          "ticker": "NVDA",
          "name": "NVIDIA",
          "role": "תפקיד ספציפי בשירות הצוואר הזה",
          "moat": "מה מגן על מיקומה",
          "marketCap": "Large/Mid/Small"
        }
      ]
    }
  ],
  "nextBottleneck": {
    "name": "שם הצוואר הבא",
    "sector": "תחום",
    "timeline": "טווח זמן צפוי להיווצרות — לדוגמה: 6-12 חודשים",
    "trigger": "מה יגרום לו להיבנות? אירוע/רגולציה/טכנולוגיה ספציפית",
    "earlySignals": "איתותים מוקדמים שכבר רואים עכשיו בשוק",
    "whyNow": "למה עכשיו הזמן לשים לב — לפני שהשוק מתמחר",
    "urgency": "high",
    "capitalFlowMap": "מאיפה הכסף יצא ולאן הוא ייכנס כשהצוואר ייפתח",
    "positionedCompanies": [
      {
        "ticker": "TICKER",
        "name": "שם חברה",
        "whyWin": "למה דווקא היא תנצח — יתרון ספציפי",
        "marketCap": "Large/Mid/Small"
      }
    ]
  },
  "smartMoneyFlow": "תמונת הזרימה הכוללת: מאיפה יוצא כסף חכם ולאן נכנס. איפה האסימטריה הגדולה ביותר כרגע."
}`;

    let response;
    try {
      response = await openai.chat.completions.create({
        model: "gpt-5-mini",
        max_completion_tokens: 4096,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });
    } catch (err) {
      req.log?.warn({ err }, "Bottleneck AI unavailable; using evidence-based fallback");
      const fallback = buildFallbackAnalysis(marketEvidence);
      _cache = { data: fallback, expires: Date.now() + 6 * 60 * 60 * 1000 };
      res.json(fallback);
      return;
    }

    const raw = response.choices[0]?.message?.content ?? "";
    const finishReason = response.choices[0]?.finish_reason;

    if (!raw || raw.trim() === "") {
      req.log?.warn({ finishReason }, "Bottleneck AI returned empty content");
      const fallback = buildFallbackAnalysis(marketEvidence);
      _cache = { data: fallback, expires: Date.now() + 6 * 60 * 60 * 1000 };
      res.json(fallback);
      return;
    }

    const parsed = robustParse(raw);
    if (!parsed) {
      req.log?.warn({ raw: raw.slice(0, 500), finishReason }, "Failed to parse bottleneck JSON");
      const fallback = buildFallbackAnalysis(marketEvidence);
      _cache = { data: fallback, expires: Date.now() + 6 * 60 * 60 * 1000 };
      res.json(fallback);
      return;
    }

    const result: BottleneckAnalysis = {
      marketContext: (parsed.marketContext as string) ?? "",
      currentBottlenecks: (parsed.currentBottlenecks as Bottleneck[]) ?? [],
      nextBottleneck: (parsed.nextBottleneck as NextBottleneck) ?? {},
      smartMoneyFlow: (parsed.smartMoneyFlow as string) ?? "",
      generatedAt: new Date().toISOString(),
    };

    if (!result.currentBottlenecks.length || !result.nextBottleneck?.name) {
      const fallback = buildFallbackAnalysis(marketEvidence);
      _cache = { data: fallback, expires: Date.now() + 6 * 60 * 60 * 1000 };
      res.json(fallback);
      return;
    }

    const enrichedResult = enrichAiResult(result, marketEvidence);
    _cache = { data: enrichedResult, expires: Date.now() + 6 * 60 * 60 * 1000 };
    res.json(enrichedResult);
  } catch (err) {
    req.log?.error({ err }, "Failed to generate bottleneck analysis");
    res.status(500).json({ error: "Internal error", message: "שגיאה בניתוח צווארי הבקבוק" });
  }
});

export default router;
