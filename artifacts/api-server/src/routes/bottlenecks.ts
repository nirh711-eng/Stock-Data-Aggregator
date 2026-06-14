import { Router } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import { jsonrepair } from "jsonrepair";

const router = Router();

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
}

interface BottleneckAnalysis {
  marketContext: string;
  currentBottlenecks: Bottleneck[];
  nextBottleneck: NextBottleneck;
  smartMoneyFlow: string;
  generatedAt: string;
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
    const systemPrompt = `אתה אנליסט מאקרו וסוחר בכיר בדסק קטליסטים של קרן גידור גלובלית מובילה.
ההתמחות שלך היא זיהוי מוקדם של: שינויי מבנה בשוק, צווארי בקבוק, בריכות ערך, וזרימת הון חכמה (Smart Money).
כתוב בעברית. חד, ישיר, ללא מילים מיותרות. כל משפט חייב לנוע כסף. חשיבה של כסף — לא של כותרות.
CRITICAL: החזר אך ורק JSON תקני, ללא markdown, ללא טקסט מחוץ ל-JSON.
CRITICAL: אל תשתמש בגרשיים (") בתוך ערכי טקסט — השתמש בגרש בודד (') או תמיד סגור ערכים ב-escaped quotes.`;

    const today = new Date().toLocaleDateString("he-IL", { year: "numeric", month: "long", day: "numeric" });

    const userPrompt = `תאריך היום: ${today}. נתח את צווארי הבקבוק הנוכחיים בשוק ההון הגלובלי לפי המסגרת הבאה:

זהה 4-5 צווארי בקבוק שבהם ריכוז כוח אמיתי — מקומות שבהם ערך כלכלי נוצר ונלכד בשל: טכנולוגיה ייחודית, רגולציה, סקייל, קניין רוחני, נתונים, או תשתית קריטית.

לכל צוואר בקבוק — ציין את החברות האמיתיות שמשרתות אותו עם טיקרים נכונים.

לאחר מכן — זהה את צוואר הבקבוק הבא שיתחיל להיבנות ב-6-18 חודשים הקרובים, עם החברות שמוצבות לנצל אותו לפני השוק.

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

    const response = await openai.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 8192,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? "";
    const finishReason = response.choices[0]?.finish_reason;

    if (!raw || raw.trim() === "") {
      req.log?.warn({ finishReason }, "Bottleneck AI returned empty content");
      res.status(500).json({ error: "AI error", message: "לא התקבלה תשובה מהמודל — נסה שוב" });
      return;
    }

    const parsed = robustParse(raw);
    if (!parsed) {
      req.log?.warn({ raw: raw.slice(0, 500), finishReason }, "Failed to parse bottleneck JSON");
      res.status(500).json({ error: "Parse error", message: "שגיאה בעיבוד תשובת AI" });
      return;
    }

    const result: BottleneckAnalysis = {
      marketContext: (parsed.marketContext as string) ?? "",
      currentBottlenecks: (parsed.currentBottlenecks as Bottleneck[]) ?? [],
      nextBottleneck: (parsed.nextBottleneck as NextBottleneck) ?? {},
      smartMoneyFlow: (parsed.smartMoneyFlow as string) ?? "",
      generatedAt: new Date().toISOString(),
    };

    _cache = { data: result, expires: Date.now() + 6 * 60 * 60 * 1000 };
    res.json(result);
  } catch (err) {
    req.log?.error({ err }, "Failed to generate bottleneck analysis");
    res.status(500).json({ error: "Internal error", message: "שגיאה בניתוח צווארי הבקבוק" });
  }
});

export default router;
