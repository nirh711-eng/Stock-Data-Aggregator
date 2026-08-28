import { logger } from "./logger";

type AccessEmailInput = {
  to: string;
  name: string;
  userId: string;
  approveUrl: string;
  rejectUrl: string;
};

export type AccessEmailResult = "sent" | "not_configured" | "failed";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export async function sendAccessRequestEmail(input: AccessEmailInput): Promise<AccessEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    logger.warn(
      { hasApiKey: Boolean(apiKey), hasFromAddress: Boolean(from) },
      "Access request email is not configured; connect Resend and set RESEND_FROM_EMAIL",
    );
    return "not_configured";
  }

  const safeName = escapeHtml(input.name || "משתמש חדש");
  const safeEmail = escapeHtml(input.to);
  const safeUserId = escapeHtml(input.userId);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: "StockPulse — בקשת גישה חדשה",
      html: `
        <div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.7">
          <h2>בקשת גישה חדשה ל־StockPulse</h2>
          <p><strong>שם:</strong> ${safeName}</p>
          <p><strong>מייל:</strong> ${safeEmail}</p>
          <p><strong>מזהה משתמש:</strong> ${safeUserId}</p>
          <p>
            <a href="${input.approveUrl}" style="display:inline-block;background:#166534;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;margin-left:8px">אישור גישה</a>
            <a href="${input.rejectUrl}" style="display:inline-block;background:#991b1b;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">דחיית גישה</a>
          </p>
          <p style="color:#666;font-size:12px">הקישורים תקפים ל־24 שעות וניתנים לשימוש פעם אחת.</p>
        </div>
      `,
    }),
  });

  if (!response.ok) {
    logger.error({ status: response.status }, "Resend rejected the access request email");
    return "failed";
  }
  return "sent";
}