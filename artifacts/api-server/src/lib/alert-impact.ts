export type ImpactLabel = "positive" | "negative" | "neutral" | "unknown";
export type ImpactConfidence = "high" | "medium" | "low" | "unknown";

export type AlertImpact = {
  label: ImpactLabel;
  confidence: ImpactConfidence;
  reason: string;
};

export function unknownImpact(reason: string): AlertImpact {
  return { label: "unknown", confidence: "unknown", reason };
}

export function defaultDualImpact(
  subjectType: "stock" | "sector",
  sentiment: "positive" | "negative" | "neutral",
): { companyImpact: AlertImpact; sectorImpact: AlertImpact } {
  if (subjectType === "sector") {
    return {
      companyImpact: unknownImpact("זו כתבה סקטוריאלית; אין מספיק הקשר לקביעת השפעה על חברה מסוימת."),
      sectorImpact: {
        label: sentiment,
        confidence: "low",
        reason: "ממתין לסיווג לפי תוכן הכתבה והקשר הסקטור.",
      },
    };
  }
  return {
    companyImpact: {
      label: sentiment,
      confidence: "low",
      reason: "ממתין לסיווג לפי פעילות החברה והקשר הכתבה.",
    },
    sectorImpact: unknownImpact("אירוע נקודתי בחברה אינו נחשב אוטומטית להשפעה על הסקטור כולו."),
  };
}

export function normalizeImpact(value: unknown, fallback: AlertImpact): AlertImpact {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const candidate = value as Record<string, unknown>;
  const label: ImpactLabel = candidate.label === "positive"
    || candidate.label === "negative"
    || candidate.label === "neutral"
    || candidate.label === "unknown"
    ? candidate.label
    : fallback.label;
  const confidence: ImpactConfidence = candidate.confidence === "high"
    || candidate.confidence === "medium"
    || candidate.confidence === "low"
    || candidate.confidence === "unknown"
    ? candidate.confidence
    : fallback.confidence;
  const reason = typeof candidate.reason === "string" && candidate.reason.trim()
    ? candidate.reason.replace(/\s+/g, " ").trim().slice(0, 260)
    : fallback.reason;
  return { label, confidence, reason };
}