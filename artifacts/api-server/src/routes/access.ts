import { clerkClient, getAuth } from "@clerk/express";
import {
  ACCESS_STATUSES,
  accessRequestsTable,
  db,
  usageEventsTable,
} from "@workspace/db";
import { createHash, randomBytes } from "node:crypto";
import { and, count, desc, eq, gt, gte, isNull, lte, max, sql } from "drizzle-orm";
import { Router, type NextFunction, type Request, type Response } from "express";
import { sendAccessRequestEmail, type AccessEmailResult } from "../lib/access-email";

const router = Router();
const APPROVAL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const NOTIFICATION_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const FAILED_NOTIFICATION_RETRY_MS = 15 * 60 * 1000;
const MAX_EVENTS_PER_MINUTE = 300;
const EVENT_TYPES = new Set([
  "login",
  "tab_view",
  "stock_search",
  "watchlist_add",
  "watchlist_remove",
  "article_saved",
  "article_removed",
  "analysis_view",
  "alert_view",
]);

type Identity = {
  userId: string;
  email: string;
  name: string;
  emailVerified: boolean;
  isAdmin: boolean;
};

type AccessRecord = typeof accessRequestsTable.$inferSelect;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isAdminIdentity(userId: string, email: string, emailVerified: boolean): boolean {
  const configuredUserId = process.env.ACCESS_ADMIN_USER_ID?.trim();
  const configuredEmail = process.env.ACCESS_ADMIN_EMAIL;
  return Boolean(
    (configuredUserId && configuredUserId === userId)
    || (emailVerified && configuredEmail && normalizeEmail(configuredEmail) === normalizeEmail(email)),
  );
}

async function getIdentity(req: Request): Promise<Identity | null> {
  const auth = getAuth(req);
  const userId = auth.userId;
  if (!userId) return null;

  const user = await clerkClient.users.getUser(userId);
  const selectedEmail = user.primaryEmailAddress ?? user.emailAddresses[0];
  const email = selectedEmail?.emailAddress
    ?? "";
  const emailVerified = selectedEmail?.verification?.status === "verified";
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || email || userId;
  return {
    userId,
    email,
    name,
    emailVerified,
    isAdmin: isAdminIdentity(userId, email, emailVerified),
  };
}

function getAppBaseUrl(): string | null {
  const raw = process.env.APP_BASE_URL?.trim()
    || (process.env.NODE_ENV !== "production" && process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : "");
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.hostname !== "localhost") return null;
    url.username = "";
    url.password = "";
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function accessStatus(record: AccessRecord | undefined): "pending" | "approved" | "rejected" {
  if (record && ACCESS_STATUSES.includes(record.status)) return record.status;
  return "pending";
}

async function findAccessRecord(userId: string): Promise<AccessRecord | undefined> {
  const [record] = await db
    .select()
    .from(accessRequestsTable)
    .where(eq(accessRequestsTable.userId, userId))
    .limit(1);
  return record;
}

async function ensureAccessRecord(identity: Identity, req: Request): Promise<{
  record: AccessRecord;
  notification: AccessEmailResult | "not_needed";
}> {
  const existing = await findAccessRecord(identity.userId);

  if (identity.isAdmin) {
    if (!existing) {
      const [record] = await db.insert(accessRequestsTable).values({
        userId: identity.userId,
        email: identity.email,
        name: identity.name,
        status: "approved",
        reviewedAt: new Date(),
        reviewedBy: identity.userId,
        lastSeenAt: new Date(),
      }).returning();
      return { record, notification: "not_needed" };
    }
    if (existing.status !== "approved" || existing.email !== identity.email || existing.name !== identity.name) {
      const [record] = await db.update(accessRequestsTable)
        .set({
          email: identity.email,
          name: identity.name,
          status: "approved",
          reviewedAt: existing.reviewedAt ?? new Date(),
          reviewedBy: existing.reviewedBy ?? identity.userId,
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(accessRequestsTable.userId, identity.userId))
        .returning();
      return { record, notification: "not_needed" };
    }
    await db.update(accessRequestsTable)
      .set({ lastSeenAt: new Date(), updatedAt: new Date() })
      .where(eq(accessRequestsTable.userId, identity.userId));
    return { record: { ...existing, lastSeenAt: new Date() }, notification: "not_needed" };
  }

  if (!existing) {
    const token = randomBytes(32).toString("hex");
    const tokenHash = hashToken(token);
    const tokenExpiresAt = new Date(Date.now() + APPROVAL_TOKEN_TTL_MS);
    const [record] = await db.insert(accessRequestsTable).values({
      userId: identity.userId,
      email: identity.email,
      name: identity.name,
      status: "pending",
      tokenHash,
      tokenExpiresAt,
      lastNotificationAttemptAt: new Date(),
    }).onConflictDoNothing({ target: accessRequestsTable.userId }).returning();
    if (!record) {
      return ensureAccessRecord(identity, req);
    }
    const notification = await notifyAdmin(identity, token, req);
    if (notification === "sent") {
      const [updated] = await db.update(accessRequestsTable)
        .set({ lastNotificationAt: new Date(), updatedAt: new Date() })
        .where(eq(accessRequestsTable.id, record.id))
        .returning();
      return { record: updated ?? record, notification };
    }
    return { record, notification };
  }

  if (existing.status !== "pending") {
    await db.update(accessRequestsTable)
      .set({ lastSeenAt: new Date(), updatedAt: new Date() })
      .where(eq(accessRequestsTable.userId, identity.userId));
    return { record: { ...existing, lastSeenAt: new Date() }, notification: "not_needed" };
  }

  const lastNotificationAt = existing.lastNotificationAt?.getTime() ?? 0;
  const lastAttemptAt = existing.lastNotificationAttemptAt?.getTime() ?? 0;
  const tokenExpired = !existing.tokenHash
    || !existing.tokenExpiresAt
    || existing.tokenExpiresAt.getTime() <= Date.now();
  const retryAfter = existing.lastNotificationAt
    ? NOTIFICATION_COOLDOWN_MS
    : FAILED_NOTIFICATION_RETRY_MS;
  const shouldNotify = tokenExpired || Date.now() - Math.max(lastAttemptAt, lastNotificationAt) >= retryAfter;
  if (!shouldNotify) {
    await db.update(accessRequestsTable)
      .set({ lastSeenAt: new Date(), updatedAt: new Date() })
      .where(eq(accessRequestsTable.userId, identity.userId));
    return { record: { ...existing, lastSeenAt: new Date() }, notification: "not_needed" };
  }

  const token = randomBytes(32).toString("hex");
  const attemptCondition = existing.lastNotificationAttemptAt
    ? eq(accessRequestsTable.lastNotificationAttemptAt, existing.lastNotificationAttemptAt)
    : isNull(accessRequestsTable.lastNotificationAttemptAt);
  const [record] = await db.update(accessRequestsTable)
    .set({
      email: identity.email,
      name: identity.name,
      tokenHash: hashToken(token),
      tokenExpiresAt: new Date(Date.now() + APPROVAL_TOKEN_TTL_MS),
      lastNotificationAttemptAt: new Date(),
      lastSeenAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(
      eq(accessRequestsTable.userId, identity.userId),
      eq(accessRequestsTable.status, "pending"),
      attemptCondition,
    ))
    .returning();
  if (!record) {
    const winner = await findAccessRecord(identity.userId);
    if (!winner) throw new Error("Access request disappeared during notification rotation");
    return { record: winner, notification: "not_needed" };
  }
  const notification = await notifyAdmin(identity, token, req);
  if (notification === "sent") {
    const [updated] = await db.update(accessRequestsTable)
      .set({ lastNotificationAt: new Date(), updatedAt: new Date() })
      .where(eq(accessRequestsTable.id, record.id))
      .returning();
    return { record: updated ?? record, notification };
  }
  return { record, notification };
}

async function notifyAdmin(identity: Identity, token: string, req: Request): Promise<AccessEmailResult> {
  const baseUrl = getAppBaseUrl();
  if (!baseUrl) {
    req.log.warn("APP_BASE_URL is not configured; access request email was not sent");
    return "not_configured";
  }
  const query = `token=${encodeURIComponent(token)}`;
  return sendAccessRequestEmail({
    to: process.env.ACCESS_ADMIN_EMAIL ?? "",
    name: identity.name,
    userId: identity.userId,
    approveUrl: `${baseUrl}/api/access/review?decision=approve&${query}`,
    rejectUrl: `${baseUrl}/api/access/review?decision=reject&${query}`,
  });
}

async function requireIdentity(req: Request, res: Response): Promise<Identity | null> {
  try {
    const identity = await getIdentity(req);
    if (!identity) {
      res.status(401).json({ error: "Unauthorized" });
      return null;
    }
    return identity;
  } catch (error) {
    req.log.error({ err: error }, "Unable to resolve Clerk identity");
    res.status(401).json({ error: "Unable to resolve account" });
    return null;
  }
}

export async function requireApprovedAccess(req: Request, res: Response, next: NextFunction) {
  try {
    const identity = await getIdentity(req);
    if (!identity) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const { record } = await ensureAccessRecord(identity, req);
    const status = accessStatus(record);
    if (status !== "approved") {
      res.status(403).json({
        error: status === "rejected" ? "Access rejected" : "Access pending",
        status,
      });
      return;
    }
    next();
  } catch (error) {
    req.log.error({ err: error }, "Access check failed");
    res.status(500).json({ error: "Access check failed" });
  }
}

async function requireAdmin(req: Request, res: Response): Promise<Identity | null> {
  const identity = await requireIdentity(req, res);
  if (!identity) return null;
  if (!identity.isAdmin) {
    res.status(403).json({ error: "Admin access required" });
    return null;
  }
  return identity;
}

function jsonRecord(record: AccessRecord, usage?: { count: number; lastActivityAt: string | null }) {
  return {
    userId: record.userId,
    email: record.email,
    name: record.name,
    status: accessStatus(record),
    requestedAt: record.requestedAt.toISOString(),
    reviewedAt: record.reviewedAt?.toISOString() ?? null,
    lastSeenAt: record.lastSeenAt?.toISOString() ?? null,
    usageCount: usage?.count ?? 0,
    lastActivityAt: usage?.lastActivityAt ?? null,
  };
}

router.get("/access/status", async (req, res): Promise<void> => {
  const identity = await requireIdentity(req, res);
  if (!identity) return;
  const { record, notification } = await ensureAccessRecord(identity, req);
  res.json({
    status: accessStatus(record),
    isAdmin: identity.isAdmin,
    notification,
    emailConfigured: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL),
    user: { email: identity.email, name: identity.name },
  });
});

router.post("/access/request", async (req, res): Promise<void> => {
  const identity = await requireIdentity(req, res);
  if (!identity) return;
  const { record, notification } = await ensureAccessRecord(identity, req);
  res.status(201).json({
    status: accessStatus(record),
    notification,
    emailConfigured: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL),
  });
});

router.get("/access/review", async (req, res): Promise<void> => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const decision = req.query.decision === "approve" ? "approved"
    : req.query.decision === "reject" ? "rejected"
      : null;
  if (!token || !decision) {
    res.status(400).send("קישור אישור לא תקין.");
    return;
  }

  const [record] = await db.select().from(accessRequestsTable)
    .where(eq(accessRequestsTable.tokenHash, hashToken(token)))
    .limit(1);
  if (!record || record.status !== "pending") {
    res.status(410).send("קישור האישור כבר שומש או שאינו תקף.");
    return;
  }
  if (!record.tokenExpiresAt || record.tokenExpiresAt.getTime() <= Date.now()) {
    res.status(410).send("קישור האישור פג תוקף.");
    return;
  }

  res.status(200).send(`
    <!doctype html>
    <html lang="he" dir="rtl">
      <meta charset="utf-8">
      <title>StockPulse — אישור בקשת גישה</title>
      <body style="font-family:Arial,sans-serif;max-width:520px;margin:80px auto;padding:24px;text-align:center">
        <h1>${decision === "approved" ? "אישור" : "דחיית"} בקשת גישה</h1>
        <p>האם לבצע את הפעולה עבור ${record.email.replaceAll("<", "&lt;").replaceAll(">", "&gt;")}?</p>
        <form method="post" action="/api/access/review">
          <input type="hidden" name="token" value="${token.replaceAll('"', "&quot;")}">
          <input type="hidden" name="decision" value="${decision === "approved" ? "approve" : "reject"}">
          <button type="submit" style="border:0;border-radius:7px;padding:12px 20px;color:white;background:${decision === "approved" ? "#166534" : "#991b1b"};cursor:pointer">
            ${decision === "approved" ? "אשר גישה" : "דחה גישה"}
          </button>
        </form>
      </body>
    </html>
  `);
});

router.post("/access/review", async (req, res): Promise<void> => {
  const token = typeof req.body?.token === "string" ? req.body.token : "";
  const decision = req.body?.decision === "approve" ? "approved"
    : req.body?.decision === "reject" ? "rejected"
      : null;
  if (!token || !decision) {
    res.status(400).send("בקשת אישור לא תקינה.");
    return;
  }
  const [record] = await db.update(accessRequestsTable)
    .set({
      status: decision,
      reviewedAt: new Date(),
      reviewedBy: process.env.ACCESS_ADMIN_EMAIL ?? "email-link",
      tokenHash: null,
      tokenExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(accessRequestsTable.tokenHash, hashToken(token)),
      eq(accessRequestsTable.status, "pending"),
      gt(accessRequestsTable.tokenExpiresAt, new Date()),
    ))
    .returning();
  if (!record) {
    res.status(410).send("קישור האישור כבר שומש או שפג תוקפו.");
    return;
  }
  const label = decision === "approved" ? "אושרה" : "נדחתה";
  res.status(200).send(`
    <!doctype html>
    <html lang="he" dir="rtl">
      <meta charset="utf-8">
      <title>StockPulse — בקשת גישה</title>
      <body style="font-family:Arial,sans-serif;max-width:520px;margin:80px auto;padding:24px;text-align:center">
        <h1>בקשת הגישה ${label}</h1>
        <p>המשתמש ${record.email.replaceAll("<", "&lt;").replaceAll(">", "&gt;")} יקבל את העדכון בכניסה הבאה.</p>
      </body>
    </html>
  `);
});

router.get("/access/admin/users", async (req, res): Promise<void> => {
  const identity = await requireAdmin(req, res);
  if (!identity) return;

  const records = await db.select().from(accessRequestsTable)
    .orderBy(desc(accessRequestsTable.requestedAt));
  const usage = await db.select({
    userId: usageEventsTable.userId,
    count: count(),
    lastActivityAt: max(usageEventsTable.occurredAt),
  }).from(usageEventsTable).groupBy(usageEventsTable.userId);
  const usageByUser = new Map(usage.map((item) => [
    item.userId,
    {
      count: Number(item.count),
      lastActivityAt: item.lastActivityAt?.toISOString() ?? null,
    },
  ]));
  res.json({
    users: records.map((record) => jsonRecord(record, usageByUser.get(record.userId))),
  });
});

router.patch("/access/admin/users/:userId", async (req, res): Promise<void> => {
  const identity = await requireAdmin(req, res);
  if (!identity) return;
  const userId = String(req.params.userId);
  const status = req.body?.status;
  if (!ACCESS_STATUSES.includes(status)) {
    res.status(400).json({ error: "Invalid access status" });
    return;
  }
  const [record] = await db.update(accessRequestsTable)
    .set({
      status,
      reviewedAt: new Date(),
      reviewedBy: identity.userId,
      tokenHash: null,
      tokenExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(eq(accessRequestsTable.userId, userId))
    .returning();
  if (!record) {
    res.status(404).json({ error: "User access request not found" });
    return;
  }
  res.json({ user: jsonRecord(record) });
});

router.get("/access/admin/usage", async (req, res): Promise<void> => {
  const identity = await requireAdmin(req, res);
  if (!identity) return;
  const from = typeof req.query.from === "string" && !Number.isNaN(new Date(req.query.from).getTime())
    ? new Date(req.query.from)
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const to = typeof req.query.to === "string" && !Number.isNaN(new Date(req.query.to).getTime())
    ? new Date(req.query.to)
    : new Date();

  const [summary] = await db.select({
    totalEvents: count(),
  }).from(usageEventsTable).where(and(
    gte(usageEventsTable.occurredAt, from),
    lte(usageEventsTable.occurredAt, to),
  ));
  const activeUsers = await db.select({ userId: usageEventsTable.userId })
    .from(usageEventsTable)
    .where(and(gte(usageEventsTable.occurredAt, from), lte(usageEventsTable.occurredAt, to)))
    .groupBy(usageEventsTable.userId);
  const byType = await db.select({
    eventType: usageEventsTable.eventType,
    count: count(),
  }).from(usageEventsTable)
    .where(and(gte(usageEventsTable.occurredAt, from), lte(usageEventsTable.occurredAt, to)))
    .groupBy(usageEventsTable.eventType)
    .orderBy(desc(count()));
  const topTickers = await db.select({
    ticker: usageEventsTable.ticker,
    count: count(),
  }).from(usageEventsTable)
    .where(and(
      gte(usageEventsTable.occurredAt, from),
      lte(usageEventsTable.occurredAt, to),
    ))
    .groupBy(usageEventsTable.ticker)
    .orderBy(desc(count()))
    .limit(10);
  res.json({
    from: from.toISOString(),
    to: to.toISOString(),
    totalEvents: Number(summary?.totalEvents ?? 0),
    activeUsers: activeUsers.length,
    byType: byType.map((item) => ({ eventType: item.eventType, count: Number(item.count) })),
    topTickers: topTickers
      .filter((item): item is { ticker: string; count: number } => Boolean(item.ticker))
      .map((item) => ({ ticker: item.ticker, count: Number(item.count) })),
  });
});

router.post("/usage-events", async (req, res): Promise<void> => {
  const identity = await requireIdentity(req, res);
  if (!identity) return;
  const { record } = await ensureAccessRecord(identity, req);
  if (accessStatus(record) !== "approved") {
    res.status(403).json({ error: "Access not approved", status: accessStatus(record) });
    return;
  }

  const eventId = typeof req.body?.eventId === "string" ? req.body.eventId.trim() : "";
  const eventType = typeof req.body?.eventType === "string" ? req.body.eventType.trim() : "";
  const ticker = typeof req.body?.ticker === "string" ? req.body.ticker.trim().toUpperCase() : null;
  const metadata = req.body?.metadata;
  if (!eventId || eventId.length > 120 || !EVENT_TYPES.has(eventType)) {
    res.status(400).json({ error: "Invalid usage event" });
    return;
  }
  if (ticker !== null && !/^[A-Z]{1,6}$/.test(ticker)) {
    res.status(400).json({ error: "Invalid ticker" });
    return;
  }
  if (metadata !== undefined && (!metadata || typeof metadata !== "object" || Array.isArray(metadata) || JSON.stringify(metadata).length > 4000)) {
    res.status(400).json({ error: "Invalid event metadata" });
    return;
  }

  const limiterResult = await db.execute<{ event_count: number }>(sql`
    INSERT INTO usage_rate_limits (user_id, window_started_at, event_count, updated_at)
    VALUES (${identity.userId}, now(), 1, now())
    ON CONFLICT (user_id) DO UPDATE SET
      window_started_at = CASE
        WHEN usage_rate_limits.window_started_at <= now() - interval '1 minute' THEN now()
        ELSE usage_rate_limits.window_started_at
      END,
      event_count = CASE
        WHEN usage_rate_limits.window_started_at <= now() - interval '1 minute' THEN 1
        ELSE usage_rate_limits.event_count + 1
      END,
      updated_at = now()
    WHERE usage_rate_limits.window_started_at <= now() - interval '1 minute'
       OR usage_rate_limits.event_count < ${MAX_EVENTS_PER_MINUTE}
    RETURNING event_count
  `);
  if (limiterResult.rows.length === 0) {
    res.status(429).json({ error: "Too many usage events" });
    return;
  }

  await db.insert(usageEventsTable).values({
    userId: identity.userId,
    eventId,
    eventType,
    ticker,
    metadata: metadata ?? {},
  }).onConflictDoNothing();
  res.status(202).json({ accepted: true });
});

export default router;