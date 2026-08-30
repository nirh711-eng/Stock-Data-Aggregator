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
  demandAnchors?: string[];
  confidenceScore?: number;
  confidenceLabel?: "גבוהה" | "בינונית" | "נמוכה";
  evidence?: string[];
  quantitativeSignals?: {
    companiesCovered: number;
    underRadarCount: number;
    avgMarketCap: string;
    avg52WeekPosition: number | null;
    avgRelativeVolume: number | null;
    crowdingPenalty: number;
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
  connections: BottleneckConnection[];
  generatedAt: string;
}

interface MarketEvidence {
  ticker: string;
  marketCap: number | null;
  marketCapLabel: string;
  marketCapBand: "Small" | "Mid" | "Large" | "Mega" | "Unknown";
  change1d: number | null;
  relativeVolume: number | null;
  week52Position: number | null;
}

interface BottleneckConnection {
  from: string;
  to: string;
  relation: string;
  whyItMatters: string;
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
  demandAnchors: string[];
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
    evidence: ["תלות מערכתית במאיץ + HBM + אריזה מתקדמת", "ספקים מעטים עם יתרון ביצועי ותפוקת ייצור", "הסורק מפריד בין חברות הביקוש הגדולות לבין חוליות ההיצע הנדירות"],
    tickers: ["AVGO", "TSM", "MU", "ACLS", "ONTO"],
    demandAnchors: ["NVDA", "AMD", "AVGO"],
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
    tickers: ["MOD", "VRT", "ETN", "PWR", "GEV"],
    demandAnchors: ["NVDA", "MSFT", "AMZN"],
  },
  {
    name: "ציוד ייצור שבבים ו-lithography",
    sector: "ציוד מוליכים למחצה",
    description: "ייצור שבבים מתקדמים תלוי בציוד מורכב, ידע תהליכי ושרשרת שירות גלובלית. במספר תתי-מערכות יש מעט ספקים עם שנים של יתרון מצטבר.",
    powerSource: "IP + טכנולוגיה + נתוני תהליך",
    maturityLevel: "בשל",
    whyItMatters: "כל הרחבת קיבולת מתקדמת דורשת השקעה בציוד לפני שהכנסות השבבים מגיעות, כך שהספקים נהנים ממנוף על כל שרשרת הערך.",
    capitalFlow: "מפעלי foundry, סובסידיות שבבים והזמנות ציוד לטכנולוגיות 2nm/3nm.",
    evidence: ["ריכוז ספקים גבוה בתהליכי ייצור מתקדמים", "עלות החלפה ואימות תהליך מונעים מעבר מהיר", "הסורק נותן עדיפות לספקי תהליך קטנים יותר לפני מובילי המדד"],
    tickers: ["ACLS", "ONTO", "FORM", "UCTT", "ASML", "AMAT", "LRCX", "KLAC"],
    demandAnchors: ["TSM", "NVDA", "INTC"],
  },
  {
    name: "אופטיקה, פוטוניקה וקישוריות 800G/1.6T",
    sector: "אופטיקה ורשתות נתונים",
    description: "החישוב המואץ יוצר צוואר פיזי בקישורים בין שרתים: transceivers, לייזרים, DSP, סיבים ואריזה אופטית. זו חוליית היצע צרה יותר מהשמות הגדולים שמוכרים את הענן.",
    powerSource: "טכנולוגיה + IP + ייצור מדויק",
    maturityLevel: "בצמיחה",
    whyItMatters: "ללא קישוריות אופטית מהירה, GPU יקר נשאר לא מנוצל. צוואר האספקה נמצא אצל יצרני הרכיבים וההרכבה, לא בהכרח אצל מפעיל הענן או יצרן המאיץ.",
    capitalFlow: "שדרוגי data center, מעבר ל-800G/1.6T והזמנות לייזרים, DSP ו-transceivers.",
    evidence: ["הגידול בחישוב מייצר ביקוש משלים לקישורים אופטיים", "תהליכי ייצור, yield ותאימות יוצרים חסם כניסה", "מניות נישה מאפשרות לזהות את הצוואר לפני שהסיפור מגיע למדדים הגדולים"],
    tickers: ["LITE", "COHR", "FN", "MTSI", "CIEN", "AAOI"],
    demandAnchors: ["ANET", "NVDA", "META", "MSFT"],
  },
  {
    name: "מגנטים קבועים, rare earth ועיבוד חומרים",
    sector: "מגנטים וחומרי גלם קריטיים",
    description: "מנועים, רובוטיקה, טורבינות, כלי רכב ומערכות צבאיות תלויים במגנטים קבועים ובעיבוד של neodymium, praseodymium, dysprosium ו-terbium. ההיצע מרוכז גיאוגרפית, והחוליה האסטרטגית היא כרייה, הפרדה, alloying וייצור מגנט — לא רק יצרן המוצר הסופי.",
    powerSource: "חומרי גלם + רגולציה + עיבוד ייחודי",
    maturityLevel: "מתפתח",
    whyItMatters: "זו תלות פיזית עם זמני הקמה ארוכים ואפשרויות החלפה מוגבלות. אם שרשרת האספקה מתפצלת גיאוגרפית, ספקי הפרדה ועיבוד יכולים להפוך לצוואר לפני שהביקוש הסופי מתומחר.",
    capitalFlow: "השקעות בשרשרת אספקה מערבית, חוזי offtake, מענקים ממשלתיים וביקוש ממנועים, defense ורובוטיקה.",
    evidence: ["הפרדה ועיבוד דורשים ידע, רישוי ותשתית כימית", "ריכוז גיאוגרפי מגדיל סיכון אספקה גם ללא זינוק במחיר", "הסורק מחפש חברות קטנות ובינוניות עם חשיפה ישירה ולא ETF או יצרן מוצר סופי"],
    tickers: ["MP", "UUUU", "NEO.TO", "LYSDY", "ATI"],
    demandAnchors: ["TSLA", "GEV", "NOC", "RTX"],
  },
];

const COMPANY_NAMES: Record<string, string> = {
  AVGO: "Broadcom",
  TSM: "TSMC",
  MU: "Micron",
  ACLS: "Axcelis Technologies",
  ONTO: "Onto Innovation",
  FORM: "FormFactor",
  UCTT: "Ultra Clean Holdings",
  MOD: "Modine",
  VRT: "Vertiv",
  ETN: "Eaton",
  PWR: "Quanta Services",
  GEV: "GE Vernova",
  ASML: "ASML",
  AMAT: "Applied Materials",
  LRCX: "Lam Research",
  KLAC: "KLA",
  LITE: "Lumentum",
  COHR: "Coherent",
  FN: "Fabrinet",
  MTSI: "MACOM Technology Solutions",
  CIEN: "Ciena",
  AAOI: "Applied Optoelectronics",
  MP: "MP Materials",
  UUUU: "Energy Fuels",
  "NEO.TO": "Neo Performance Materials",
  LYSDY: "Lynas Rare Earths",
  ATI: "ATI",
};

const COMPANY_ROLES: Record<string, string> = {
  AVGO: "שבבי networking, ASIC וקישוריות לדאטה סנטר",
  TSM: "ייצור foundry ואריזה מתקדמת",
  MU: "זיכרון HBM ו-DRAM למחשוב מואץ",
  ACLS: "ציוד ion implantation לייצור שבבים",
  ONTO: "מטרולוגיה ובקרת תהליך לייצור מתקדם",
  FORM: "ציוד בדיקה ואריזה לזיכרון ושבבים",
  UCTT: "רכיבים ושירותים לציוד wafer fabrication",
  MOD: "מערכות thermal management למחשוב ותעשייה",
  VRT: "חשמל, UPS וקירור לדאטה סנטרים",
  ETN: "ניהול הספק, switchgear וחיבורי חשמל",
  PWR: "הקמת תשתיות הולכה וחיבור לרשת",
  GEV: "ציוד ייצור חשמל וטורבינות",
  ASML: "מערכות lithography מתקדמות",
  AMAT: "ציוד deposition וייצור wafer",
  LRCX: "ציוד etch וניקוי wafer",
  KLAC: "בקרת תהליך ומטרולוגיה",
  LITE: "מודולים אופטיים ופתרונות photonics",
  COHR: "לייזרים, transceivers ורכיבים אופטיים",
  FN: "ייצור והרכבה של מודולים אופטיים",
  MTSI: "רכיבי RF, analog ו-DSP לקישוריות",
  CIEN: "מערכות optical transport ו-DWDM",
  AAOI: "לייזרים ו-transceivers לדאטה סנטר",
  MP: "כרייה והפרדה של rare earth בצפון אמריקה",
  UUUU: "עיבוד והפרדת rare earth ומונזיט",
  "NEO.TO": "ייצור אבקות וסגסוגות למגנטים קבועים",
  LYSDY: "כרייה, הפרדה ועיבוד rare earth",
  ATI: "סגסוגות מיוחדות לתעופה, defense ומגנטים",
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

function marketCapBand(value: number | null): "Small" | "Mid" | "Large" | "Mega" | "Unknown" {
  if (!value || value <= 0) return "Unknown";
  if (value >= 200e9) return "Mega";
  if (value >= 10e9) return "Large";
  if (value >= 2e9) return "Mid";
  return "Small";
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
        marketCapBand: marketCapBand(marketCap),
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
  const underRadarCount = covered.filter((item) => item.marketCapBand === "Small" || item.marketCapBand === "Mid").length;
  const underRadarScore = Math.min(24, underRadarCount * 5);
  const coverageScore = Math.min(20, covered.length * 4);
  const marketScore = (avgPosition ?? 50) >= 65 ? 12 : (avgPosition ?? 50) >= 45 ? 8 : 5;
  const flowScore = (avgVolume ?? 1) >= 1.25 || positiveDays >= Math.ceil(Math.max(1, covered.length) / 2) ? 10 : 5;
  const crowdingPenalty = (avgPosition ?? 50) >= 88 ? 12 : (avgPosition ?? 50) >= 78 ? 6 : 0;
  const score = Math.max(20, Math.min(95, 35 + coverageScore + underRadarScore + marketScore + flowScore - crowdingPenalty));
  return {
    covered,
    avgPosition,
    avgVolume,
    underRadarCount,
    crowdingPenalty,
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
    const anchors = thesis.demandAnchors.join(", ");
    return `${thesis.name}: ${companies || "אין נתון חי"} | מועמדים מתחת לרדאר ${details.underRadarCount} | קנס צפיפות ${details.crowdingPenalty} | ציון אמינות מחושב ${details.score}/100 (${details.label}) | עוגני ביקוש בלבד: ${anchors}`;
  }).join("\n");
}

function rankedTheses(marketEvidence: MarketEvidence[]): BottleneckThesis[] {
  return [...BOTTLENECK_THESES].sort((a, b) => {
    const aDetails = evidenceForThesis(a, marketEvidence);
    const bDetails = evidenceForThesis(b, marketEvidence);
    return bDetails.score - aDetails.score || bDetails.underRadarCount - aDetails.underRadarCount;
  });
}

function buildBottleneckConnections(): BottleneckConnection[] {
  return [
    {
      from: "מאיצי AI וזיכרון High-Bandwidth",
      to: "אופטיקה, פוטוניקה וקישוריות 800G/1.6T",
      relation: "החישוב מייצר תעבורה",
      whyItMatters: "כל אשכול GPU חדש מגדיל את מספר הקישורים, ה-transceivers וה-DSP הנדרשים בין השרתים.",
    },
    {
      from: "אופטיקה, פוטוניקה וקישוריות 800G/1.6T",
      to: "רשתות נתונים ואבטחת תעבורה",
      relation: "האופטיקה היא שכבת ההעברה",
      whyItMatters: "בלי שכבת optical transport מהירה, השדרוגים של switching לא מתורגמים לקיבולת שימושית.",
    },
    {
      from: "מאיצי AI וזיכרון High-Bandwidth",
      to: "חשמל, קירור וחיבור לרשת עבור דאטה סנטרים",
      relation: "קיבולת מחשוב צורכת הספק",
      whyItMatters: "צפיפות חישוב גבוהה הופכת מגה-ואטים, שנאים וקירור לתנאי הפעלה ולא להוצאה נלווית.",
    },
    {
      from: "מגנטים קבועים, rare earth ועיבוד חומרים",
      to: "חשמל, קירור וחיבור לרשת עבור דאטה סנטרים",
      relation: "מגנטים מאפשרים מנועים וציוד",
      whyItMatters: "טורבינות, מנועים, רובוטיקה ומערכות קירור תלויים בחומרים מגנטיים עם שרשרת אספקה קצרה.",
    },
    {
      from: "ציוד ייצור שבבים ו-lithography",
      to: "מאיצי AI וזיכרון High-Bandwidth",
      relation: "ציוד הוא צוואר upstream",
      whyItMatters: "בלי ציוד implant, metrology, בדיקה ואריזה, לא ניתן להרחיב את היצע המאיצים והזיכרון.",
    },
  ];
}

function buildFallbackAnalysis(marketEvidence: MarketEvidence[]): BottleneckAnalysis {
  const ranked = rankedTheses(marketEvidence);
  const currentBottlenecks = ranked.slice(0, 5).map((thesis) => {
    const details = evidenceForThesis(thesis, marketEvidence);
    const companies = (details.covered.length ? details.covered : thesis.tickers.map((ticker) => ({ ticker, marketCapLabel: "לא זמין", marketCapBand: "Unknown" as const })))
      .slice(0, 4)
      .map((item) => ({
        ticker: item.ticker,
        name: COMPANY_NAMES[item.ticker] ?? item.ticker,
        role: COMPANY_ROLES[item.ticker] ?? "ספק קריטי בצומת הערך",
        moat: thesis.powerSource,
        marketCap: item.marketCapBand,
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
        demandAnchors: thesis.demandAnchors,
      confidenceScore: details.score,
      confidenceLabel: details.label,
      evidence: thesis.evidence,
      quantitativeSignals: {
        companiesCovered: details.covered.length,
        underRadarCount: details.underRadarCount,
        avgMarketCap: formatMarketCap(
          details.covered.length
            ? details.covered.reduce((sum, item) => sum + (item.marketCap ?? 0), 0) / details.covered.length
            : null,
        ),
        avg52WeekPosition: details.avgPosition,
        avgRelativeVolume: details.avgVolume,
        crowdingPenalty: details.crowdingPenalty,
      },
    };
  });
  const nextThesis = ranked.find((thesis) => thesis.maturityLevel === "מתפתח") ?? ranked[0];
  const nextDetails = evidenceForThesis(nextThesis, marketEvidence);
  return {
    marketContext: "הניתוח מפריד בין עוגני ביקוש גדולים לבין חוליות היצע נדירות. הדירוג מחפש ספקי נישה, תלות פיזית וחסמי החלפה — ומעניש קבוצות שכבר צפופות מדי או קרובות לשיא הטווח.",
    currentBottlenecks,
    nextBottleneck: {
      name: nextThesis.name,
      sector: nextThesis.sector,
      timeline: "6–18 חודשים",
      trigger: `התרחבות הביקוש ל-${nextThesis.name} לפני שהיצע חדש, רישוי ויכולת ייצור יכולים להדביק אותו.`,
      earlySignals: nextThesis.evidence.join(" · "),
      whyNow: nextThesis.whyItMatters,
      capitalFlowMap: nextThesis.capitalFlow,
      positionedCompanies: nextThesis.tickers.slice(0, 4).map((ticker) => ({
        ticker,
        name: COMPANY_NAMES[ticker] ?? ticker,
        whyWin: "חשיפה ישירה לציוד או לתשתית שמאפשרים להפעיל קיבולת מחשוב חדשה.",
        marketCap: marketEvidence.find((item) => item.ticker === ticker)?.marketCapBand ?? "Unknown",
      })),
      urgency: "high",
      confidenceScore: nextDetails.score,
      confidenceLabel: nextDetails.label,
      evidence: nextThesis.evidence,
    },
    smartMoneyFlow: "הכסף עובר מהשכבה הנראית של אפליקציות AI לשכבות הקשות להחלפה: אופטיקה, photonics, מגנטים, עיבוד rare earth, ציוד תהליך, חשמל וקירור. חברות הביקוש הגדולות הן עוגן — לא צוואר — והעדיפות היא לחברות נישה עם סימני ביקוש אך בלי צפיפות קיצונית.",
    connections: buildBottleneckConnections(),
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
      demandAnchors: matched.demandAnchors,
      confidenceScore: details.score,
      confidenceLabel: details.label,
      evidence: matched.evidence,
      quantitativeSignals: {
        companiesCovered: details.covered.length,
        underRadarCount: details.underRadarCount,
        avgMarketCap: formatMarketCap(
          details.covered.length
            ? details.covered.reduce((sum, evidence) => sum + (evidence.marketCap ?? 0), 0) / details.covered.length
            : null,
        ),
        avg52WeekPosition: details.avgPosition,
        avgRelativeVolume: details.avgVolume,
        crowdingPenalty: details.crowdingPenalty,
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
        })).length
        ? (next.positionedCompanies ?? [])
          .filter((company) => allowedTickers.has(company.ticker?.toUpperCase?.() ?? ""))
          .map((company) => ({
            ...company,
            ticker: company.ticker.toUpperCase(),
            name: COMPANY_NAMES[company.ticker.toUpperCase()] ?? company.name,
          }))
        : nextMatched.tickers.slice(0, 4).map((ticker) => ({
          ticker,
          name: COMPANY_NAMES[ticker] ?? ticker,
          whyWin: "חשיפה ישירה לחוליית היצע קריטית עם חסם החלפה.",
          marketCap: marketEvidence.find((item) => item.ticker === ticker)?.marketCapBand ?? "Unknown",
        })),
    },
    connections: buildBottleneckConnections(),
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
CRITICAL: אל תמציא טיקרים או נתוני שוק. השתמש רק בחברות שמופיעות בראיות החיות שסופקו.
CRITICAL: חברות ענק כמו NVDA, MSFT, AMZN או META הן עוגני ביקוש בלבד — אין להציג אותן כצוואר בקבוק אלא אם הן עצמן חוליית היצע נדירה, וזה לא המקרה כאן.
CRITICAL: חפש את החוליה הקטנה/בינונית והקשה להחלפה בתוך השרשרת, גם אם היא פחות מוכרת ופחות סחירה.
CRITICAL: חייב להתייחס לאופטיקה/פוטוניקה/קישוריות ולמגנטים/rare earth כאשר הנתונים תומכים בהם — לא להסתפק בכותרת AI.`;

    const today = new Date().toLocaleDateString("he-IL", { year: "numeric", month: "long", day: "numeric" });

    const userPrompt = `תאריך היום: ${today}. נתח את צווארי הבקבוק הנוכחיים בשוק ההון הגלובלי לפי המסגרת הבאה:

זהה 5 צווארי בקבוק שבהם ריכוז כוח אמיתי — מקומות שבהם ערך כלכלי נוצר ונלכד בשל: טכנולוגיה ייחודית, רגולציה, סקייל, קניין רוחני, נתונים, או תשתית קריטית.

לכל צוואר בקבוק — ציין את החברות האמיתיות שמשרתות אותו עם טיקרים נכונים.
תן עדיפות לחברות Small/Mid Cap ולספקי נישה. חברה גדולה יכולה להיות עוגן ביקוש, אך אינה מקבלת עדיפות רק בגלל גודל או מומנטום.
אל תבחר צוואר רק מפני שמחירו קרוב לשיא: קנס נרטיב/צפיפות והעדף חסם פיזי, ריכוז ספקים, זמני הקמה, רישוי או switching costs.

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
           "ticker": "LITE",
           "name": "Lumentum",
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
  ,
  "connections": [
    {
      "from": "שם צוואר",
      "to": "שם צוואר",
      "relation": "איך הם קשורים",
      "whyItMatters": "למה הקשר חשוב"
    }
  ]
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
      connections: buildBottleneckConnections(),
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
