import crypto from "node:crypto";
import { installUsageHandlers, runWithUsageContext } from "../src/utils/usageMeter.js";

// Admin console: token billing, AI usage metering, user governance, support and
// the /api/admin/* API behind autoyt.cc/admin.
//
// Admins sign in with the same Google account flow as users. Emails listed in
// ADMIN_EMAILS are owners; owners add other admins (admin, support, viewer) from
// the Team page. Every admin write is recorded in admin_audit_log.

export const ROLES = ["owner", "admin", "support", "viewer"];
const PERMISSIONS = {
  owner: ["view", "users.manage", "billing.manage", "support.manage", "settings.manage", "team.manage"],
  admin: ["view", "users.manage", "billing.manage", "support.manage", "settings.manage"],
  support: ["view", "support.manage"],
  viewer: ["view"],
};

export function roleCan(role, permission) {
  return Boolean(PERMISSIONS[role]?.includes(permission));
}

export function permissionsFor(role) {
  return [...(PERMISSIONS[role] || [])];
}

export function parseAdminEmails(value) {
  return new Set(String(value || "").split(/[,\s]+/).map((email) => email.trim().toLowerCase()).filter((email) => email.includes("@")));
}

export const DEFAULT_SETTINGS = {
  governance: {
    aiEnabled: true,
    signupsOpen: true,
    maintenanceMode: false,
    maintenanceMessage: "AutoYT is down for maintenance. Your work is saved; try again in a few minutes.",
    disabledProviders: [],
    announcement: { active: false, tone: "info", text: "" },
  },
  billing: {
    // 1 USD of provider cost = tokensPerUsd AutoYT tokens, times the markup.
    tokensPerUsd: 1000000,
    markup: 1.5,
    // Used when a provider reports tokens but no cost.
    inputUsdPer1M: 0.5,
    outputUsdPer1M: 2,
    // Charged per unit when a provider reports neither tokens nor cost.
    flatTokens: { image: 60000, video: 750000, speech: 3000, music: 150000, transcription: 5000, default: 10000 },
    paymentProvider: "manual",
  },
};

export const PROVIDERS = ["openrouter", "videorouter", "gemini", "deepseek", "dashscope", "runway"];

const clampNumber = (value, fallback, min, max) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export function normalizeSettings(key, value = {}) {
  const base = DEFAULT_SETTINGS[key];
  if (!base) throw Object.assign(new Error(`Unknown setting "${key}".`), { statusCode: 404 });
  const input = value && typeof value === "object" ? value : {};
  if (key === "governance") {
    const announcement = input.announcement && typeof input.announcement === "object" ? input.announcement : {};
    return {
      aiEnabled: input.aiEnabled === undefined ? base.aiEnabled : Boolean(input.aiEnabled),
      signupsOpen: input.signupsOpen === undefined ? base.signupsOpen : Boolean(input.signupsOpen),
      maintenanceMode: Boolean(input.maintenanceMode),
      maintenanceMessage: String(input.maintenanceMessage ?? base.maintenanceMessage).trim().slice(0, 400) || base.maintenanceMessage,
      disabledProviders: [...new Set((Array.isArray(input.disabledProviders) ? input.disabledProviders : []).map(String).filter((p) => PROVIDERS.includes(p)))],
      announcement: {
        active: Boolean(announcement.active),
        tone: ["info", "warning", "success"].includes(announcement.tone) ? announcement.tone : "info",
        text: String(announcement.text || "").trim().slice(0, 280),
      },
    };
  }
  const flat = input.flatTokens && typeof input.flatTokens === "object" ? input.flatTokens : {};
  return {
    tokensPerUsd: Math.round(clampNumber(input.tokensPerUsd, base.tokensPerUsd, 1000, 100000000)),
    markup: clampNumber(input.markup, base.markup, 0.1, 20),
    inputUsdPer1M: clampNumber(input.inputUsdPer1M, base.inputUsdPer1M, 0, 1000),
    outputUsdPer1M: clampNumber(input.outputUsdPer1M, base.outputUsdPer1M, 0, 1000),
    flatTokens: Object.fromEntries(Object.entries(base.flatTokens).map(([op, tokens]) => [op, Math.round(clampNumber(flat[op], tokens, 0, 1000000000))])),
    paymentProvider: ["manual", "google_pay"].includes(input.paymentProvider) ? input.paymentProvider : base.paymentProvider,
  };
}

// Converts one metered call into AutoYT tokens. Real provider cost wins, then
// token counts at the fallback rate, then the flat per-unit rate.
export function priceUsage(event, billing = DEFAULT_SETTINGS.billing) {
  const inputTokens = Math.max(0, Number(event.inputTokens) || 0);
  const outputTokens = Math.max(0, Number(event.outputTokens) || 0);
  const reported = Number(event.costUsd);
  let costUsd;
  let estimated = false;
  if (Number.isFinite(reported) && reported > 0) {
    costUsd = reported;
  } else if (inputTokens || outputTokens) {
    costUsd = (inputTokens * billing.inputUsdPer1M + outputTokens * billing.outputUsdPer1M) / 1e6;
    estimated = true;
  } else {
    const units = Math.max(0, Number(event.units) || 0);
    const perUnit = billing.flatTokens[event.operation] ?? billing.flatTokens.default;
    const tokens = Math.ceil(units * perUnit);
    return { tokens, costUsd: tokens / billing.tokensPerUsd / billing.markup, estimated: true };
  }
  return { tokens: Math.ceil(costUsd * billing.tokensPerUsd * billing.markup), costUsd, estimated };
}

// "/api/creator/projects/prj_8f2.../stages" -> "/api/creator/projects/:id/stages"
export function featureFromRequest(method, path) {
  const clean = String(path || "").split("?")[0]
    .split("/")
    .map((part) => (/^[0-9a-f-]{16,}$/i.test(part) || /\d/.test(part) && part.length > 10 || /^[a-z]{2,5}_[A-Za-z0-9-]{6,}$/.test(part) ? ":id" : part))
    .join("/");
  return `${String(method || "GET").toUpperCase()} ${clean}`.slice(0, 160);
}

export function adminError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

const TICKET_STATUSES = ["open", "pending", "resolved", "closed"];
const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"];
const TICKET_CATEGORIES = ["general", "billing", "bug", "account", "feature"];

export function createAdminConsole(deps) {
  const { runPsql, sqlString, jsonbLiteral } = deps;
  const env = deps.env || process.env;
  const owners = () => parseAdminEmails(env.ADMIN_EMAILS);
  const cache = { settings: new Map(), members: { at: 0, map: new Map() }, users: new Map(), seen: new Map() };
  const int = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback);

  async function json(sql, fallback = null) {
    const out = await runPsql(sql);
    return out ? JSON.parse(out) : fallback;
  }
  const list = (sql) => json(`SELECT COALESCE(json_agg(t), '[]'::json)::text FROM (${sql}) t;`, []);

  // ---------- settings ----------
  async function getSettings(key) {
    const hit = cache.settings.get(key);
    if (hit && Date.now() - hit.at < 15000) return hit.value;
    let stored = {};
    try {
      stored = await json(`SELECT COALESCE((SELECT value FROM app_settings WHERE key = ${sqlString(key)}), '{}'::jsonb)::text;`, {});
    } catch (error) {
      if (!hit) console.warn(`[admin] settings "${key}" unavailable:`, error instanceof Error ? error.message : error);
    }
    const value = normalizeSettings(key, { ...DEFAULT_SETTINGS[key], ...stored });
    cache.settings.set(key, { at: Date.now(), value });
    return value;
  }
  async function saveSettings(key, value, adminEmail) {
    const normalized = normalizeSettings(key, value);
    await runPsql(`
INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES (${sqlString(key)}, ${jsonbLiteral(normalized)}, ${sqlString(adminEmail)}, now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now();`);
    cache.settings.set(key, { at: Date.now(), value: normalized });
    return normalized;
  }

  // ---------- admins ----------
  async function memberRoles() {
    if (Date.now() - cache.members.at < 30000) return cache.members.map;
    try {
      const rows = await list(`SELECT lower(email) AS email, role FROM admin_members`);
      cache.members = { at: Date.now(), map: new Map(rows.map((row) => [row.email, row.role])) };
    } catch {
      cache.members = { at: Date.now(), map: new Map() };
    }
    return cache.members.map;
  }
  async function adminRole(email) {
    const clean = String(email || "").trim().toLowerCase();
    if (!clean) return "";
    if (owners().has(clean)) return "owner";
    const role = (await memberRoles()).get(clean);
    return ROLES.includes(role) && role !== "owner" ? role : "";
  }
  async function resolveAdmin(req) {
    const session = await deps.session(req);
    if (!session?.user) return null;
    const role = await adminRole(session.user.email);
    return { ...session.user, email: String(session.user.email || "").toLowerCase(), role, permissions: permissionsFor(role), sessionId: session.id };
  }
  async function audit(admin, action, targetType, targetId, detail, req) {
    try {
      await runPsql(`
INSERT INTO admin_audit_log (admin_email, action, target_type, target_id, detail, ip)
VALUES (${sqlString(admin.email)}, ${sqlString(action)}, ${sqlString(targetType)}, ${sqlString(targetId)}, ${jsonbLiteral(detail || {})}, ${sqlString(String(req?.ip || ""))});`);
    } catch (error) {
      console.warn("[admin] audit write failed:", error instanceof Error ? error.message : error);
    }
  }

  // ---------- billing ----------
  // Creates the account on the default plan if missing, then renews an expired period.
  const ensureAccountSql = (userId) => `
INSERT INTO billing_accounts (user_id, plan_id, allowance_remaining)
SELECT u.id, p.id, p.monthly_tokens FROM app_users u
CROSS JOIN LATERAL (SELECT id, monthly_tokens FROM billing_plans WHERE is_default AND active ORDER BY sort LIMIT 1) p
WHERE u.id = ${sqlString(userId)}
ON CONFLICT (user_id) DO NOTHING;
WITH due AS (
  SELECT a.user_id, p.monthly_tokens FROM billing_accounts a JOIN billing_plans p ON p.id = a.plan_id
  WHERE a.user_id = ${sqlString(userId)} AND a.period_end <= now() FOR UPDATE OF a
), renewed AS (
  UPDATE billing_accounts a SET allowance_remaining = due.monthly_tokens, period_start = now(), period_end = now() + interval '1 month', updated_at = now()
  FROM due WHERE a.user_id = due.user_id
  RETURNING a.user_id, due.monthly_tokens, GREATEST(a.allowance_remaining, 0) + a.bonus_balance AS balance
)
INSERT INTO token_ledger (user_id, kind, tokens, balance_after, note)
SELECT user_id, 'allowance_reset', monthly_tokens, balance, 'Monthly allowance renewed' FROM renewed;`;
  const snapshotSql = (userId) => `${ensureAccountSql(userId)}
SELECT COALESCE((
  SELECT json_build_object(
    'userId', a.user_id, 'planId', a.plan_id, 'planName', p.name, 'priceCents', p.price_cents, 'monthlyTokens', p.monthly_tokens,
    'allowanceRemaining', a.allowance_remaining, 'bonusBalance', a.bonus_balance,
    'balance', GREATEST(a.allowance_remaining, 0) + a.bonus_balance, 'unlimited', a.unlimited, 'status', a.status,
    'periodStart', a.period_start, 'periodEnd', a.period_end, 'paymentProvider', a.payment_provider, 'notes', a.notes,
    'userStatus', u.status, 'statusReason', u.status_reason,
    'periodUsed', (SELECT COALESCE(SUM(tokens_charged), 0) FROM ai_usage_events e WHERE e.user_id = a.user_id AND e.created_at >= a.period_start)
  )
  FROM billing_accounts a JOIN billing_plans p ON p.id = a.plan_id JOIN app_users u ON u.id = a.user_id
  WHERE a.user_id = ${sqlString(userId)}
), 'null'::json)::text;`;

  async function billingSnapshot(userId) {
    const snapshot = await json(snapshotSql(userId));
    if (snapshot) cache.users.set(userId, { at: Date.now(), snapshot });
    return snapshot;
  }
  async function cachedSnapshot(userId) {
    const hit = cache.users.get(userId);
    if (hit && Date.now() - hit.at < 10000) return hit.snapshot;
    return billingSnapshot(userId);
  }
  const forget = (userId) => cache.users.delete(userId);

  async function guard({ provider, userId }) {
    const governance = await getSettings("governance");
    if (!governance.aiEnabled)
      return { blocked: true, status: 503, code: "ai_paused", message: "AI generation is paused for maintenance. Try again shortly." };
    if (governance.disabledProviders.includes(provider))
      return { blocked: true, status: 503, code: "provider_paused", message: `The ${provider} provider is paused. Try again shortly.` };
    if (!userId) return null;
    const snapshot = await cachedSnapshot(userId);
    if (!snapshot) return null;
    if (snapshot.userStatus === "suspended")
      return { blocked: true, status: 403, code: "account_suspended", message: "This account is suspended. Contact support to restore access." };
    if (snapshot.unlimited || snapshot.balance > 0) return null;
    return {
      blocked: true, status: 402, code: "insufficient_tokens",
      message: `You've used all your AutoYT tokens for this period. They renew ${new Date(snapshot.periodEnd).toDateString()}, or upgrade your plan for more.`,
    };
  }

  async function meter(event) {
    const billing = await getSettings("billing");
    const price = priceUsage(event, billing);
    const userId = event.userId || null;
    const insertEvent = (tokens) => `
INSERT INTO ai_usage_events (user_id, provider, model, operation, feature, input_tokens, output_tokens, cost_usd, cost_estimated, tokens_charged, request_ref)
VALUES (${userId ? sqlString(userId) : "NULL"}, ${sqlString(event.provider)}, ${sqlString(event.model)}, ${sqlString(event.operation)}, ${sqlString(event.feature)},
  ${int(event.inputTokens)}, ${int(event.outputTokens)}, ${Number(price.costUsd.toFixed(6))}, ${price.estimated}, ${tokens}, ${sqlString(event.ref || "")});`;
    if (!userId) {
      await runPsql(insertEvent(price.tokens));
      return;
    }
    // Allowance is spent before bonus tokens. Unlimited accounts are metered but not debited.
    await runPsql(`${ensureAccountSql(userId)}
WITH cur AS (SELECT user_id, allowance_remaining, bonus_balance, unlimited FROM billing_accounts WHERE user_id = ${sqlString(userId)} FOR UPDATE)
UPDATE billing_accounts a SET
  allowance_remaining = CASE WHEN cur.unlimited THEN a.allowance_remaining ELSE GREATEST(cur.allowance_remaining - ${price.tokens}, 0) END,
  bonus_balance = CASE WHEN cur.unlimited THEN a.bonus_balance ELSE cur.bonus_balance - GREATEST(${price.tokens} - GREATEST(cur.allowance_remaining, 0), 0) END,
  updated_at = now()
FROM cur WHERE a.user_id = cur.user_id;
${insertEvent(price.tokens)}`);
    forget(userId);
  }

  async function adjustTokens(userId, tokens, { kind = "grant", actor = "system", note = "", reference = "" } = {}) {
    const amount = int(tokens);
    if (!amount) throw adminError("Enter a token amount other than zero.");
    await billingSnapshot(userId);
    const out = await json(`
WITH upd AS (
  UPDATE billing_accounts SET bonus_balance = bonus_balance + ${amount}, updated_at = now()
  WHERE user_id = ${sqlString(userId)}
  RETURNING user_id, GREATEST(allowance_remaining, 0) + bonus_balance AS balance
), led AS (
  INSERT INTO token_ledger (user_id, kind, tokens, balance_after, actor, note, reference)
  SELECT user_id, ${sqlString(kind)}, ${amount}, balance, ${sqlString(actor)}, ${sqlString(note)}, ${sqlString(reference)} FROM upd
  RETURNING balance_after
)
SELECT COALESCE((SELECT json_build_object('balance', balance_after) FROM led), 'null'::json)::text;`);
    forget(userId);
    if (!out) throw adminError("User not found.", 404);
    return out;
  }

  async function changePlan(userId, planId, { actor, resetAllowance = true } = {}) {
    const plan = await json(`SELECT COALESCE((SELECT row_to_json(p) FROM billing_plans p WHERE id = ${sqlString(planId)}), 'null'::json)::text;`);
    if (!plan) throw adminError("That plan doesn't exist.", 404);
    await billingSnapshot(userId);
    await runPsql(`
WITH upd AS (
  UPDATE billing_accounts SET plan_id = ${sqlString(plan.id)},
    ${resetAllowance ? `allowance_remaining = ${int(plan.monthly_tokens)}, period_start = now(), period_end = now() + interval '1 month',` : ""}
    status = 'active', updated_at = now()
  WHERE user_id = ${sqlString(userId)}
  RETURNING user_id, GREATEST(allowance_remaining, 0) + bonus_balance AS balance
)
INSERT INTO token_ledger (user_id, kind, tokens, balance_after, actor, note, reference)
SELECT user_id, 'plan_change', ${resetAllowance ? int(plan.monthly_tokens) : 0}, balance, ${sqlString(actor || "system")}, ${sqlString(`Plan set to ${plan.name}`)}, ${sqlString(plan.id)} FROM upd;`);
    forget(userId);
  }

  // ---------- users ----------
  async function userStatus(userId) {
    const hit = cache.users.get(`status:${userId}`);
    if (hit && Date.now() - hit.at < 20000) return hit.status;
    let status = "active";
    try {
      status = (await runPsql(`SELECT status FROM app_users WHERE id = ${sqlString(userId)};`)) || "active";
    } catch {}
    cache.users.set(`status:${userId}`, { at: Date.now(), status });
    return status;
  }
  function touch(userId) {
    const last = cache.seen.get(userId) || 0;
    if (Date.now() - last < 5 * 60000) return;
    cache.seen.set(userId, Date.now());
    runPsql(`UPDATE app_users SET last_seen_at = now() WHERE id = ${sqlString(userId)};`).catch(() => {});
  }

  async function signupAllowed(profile) {
    const governance = await getSettings("governance");
    if (governance.signupsOpen) return true;
    if (await adminRole(profile.email)) return true;
    const existing = await runPsql(`SELECT 1 FROM app_users WHERE google_sub = ${sqlString(profile.googleSub)} LIMIT 1;`).catch(() => "");
    return Boolean(existing);
  }

  async function publicNotice() {
    const governance = await getSettings("governance");
    return {
      announcement: governance.announcement.active && governance.announcement.text ? governance.announcement : null,
      maintenance: governance.maintenanceMode ? { message: governance.maintenanceMessage } : null,
      aiPaused: !governance.aiEnabled,
    };
  }

  // ---------- middleware ----------
  function usageMiddleware(req, res, next) {
    const context = {
      feature: featureFromRequest(req.method, req.path),
      resolveUser: async () => (await deps.session(req))?.user?.id || null,
    };
    // Handlers wrap provider errors in their own status codes; when the usage
    // guard was the cause, the client gets the guard's status and code instead.
    const send = res.json.bind(res);
    res.json = (body) => {
      const blocked = context.blocked;
      if (blocked && res.statusCode >= 400 && !res.headersSent) {
        res.status(blocked.status);
        return send({ ...(body && typeof body === "object" && !Array.isArray(body) ? body : {}), error: blocked.message, code: blocked.code });
      }
      return send(body);
    };
    runWithUsageContext(context, next);
  }

  async function maintenanceMiddleware(req, res, next) {
    try {
      if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
      if (/^\/api\/(auth|admin|app)\//.test(req.path)) return next();
      const governance = await getSettings("governance");
      if (!governance.maintenanceMode) return next();
      const admin = await resolveAdmin(req).catch(() => null);
      if (admin?.role) return next();
      res.status(503).json({ error: governance.maintenanceMessage, code: "maintenance" });
    } catch {
      next();
    }
  }

  // ---------- routes ----------
  function adminRoute(permission, handler) {
    return async (req, res) => {
      res.setHeader("Cache-Control", "private, no-store");
      try {
        const admin = await resolveAdmin(req);
        if (!admin) return res.status(401).json({ error: "Sign in with your admin Google account.", code: "admin_signin" });
        if (!admin.role) return res.status(403).json({ error: `${admin.email} doesn't have admin access.`, code: "not_admin", email: admin.email });
        if (permission && !roleCan(admin.role, permission)) return res.status(403).json({ error: "Your admin role can't do this.", code: "forbidden" });
        // A custom header forces a CORS preflight, so other sites can't post here with the session cookie.
        if (!["GET", "HEAD"].includes(req.method) && req.get("x-admin-request") !== "1") return res.status(403).json({ error: "Missing admin request header." });
        await handler(req, res, admin);
      } catch (error) {
        const status = Number(error?.statusCode) || 500;
        if (status >= 500) console.warn(`[admin] ${req.method} ${req.path} failed:`, error instanceof Error ? error.message : error);
        const message = error instanceof Error ? error.message : "Request failed";
        res.status(status).json({ error: /relation .* does not exist/i.test(message) ? "The admin database migration (0008_admin_console) hasn't been applied yet." : message });
      }
    };
  }
  function userRoute(handler) {
    return async (req, res) => {
      res.setHeader("Cache-Control", "private, no-store");
      try {
        const session = await deps.session(req);
        if (!session?.user) return res.status(401).json({ error: "Sign in required" });
        await handler(req, res, session.user);
      } catch (error) {
        res.status(Number(error?.statusCode) || 500).json({ error: error instanceof Error ? error.message : "Request failed" });
      }
    };
  }
  const paging = (req, max = 100) => {
    const limit = Math.min(max, Math.max(1, int(req.query.limit, 50)));
    return { limit, offset: Math.max(0, int(req.query.offset, 0)) };
  };
  const days = (req) => [7, 30, 90].includes(int(req.query.days)) ? int(req.query.days) : 30;

  async function ticketThread(ticketId, { includeNotes }) {
    return json(`
SELECT COALESCE((SELECT json_build_object(
  'id', t.id, 'subject', t.subject, 'category', t.category, 'status', t.status, 'priority', t.priority, 'assignedTo', t.assigned_to,
  'createdAt', t.created_at, 'updatedAt', t.updated_at, 'lastMessageAt', t.last_message_at,
  'user', json_build_object('id', u.id, 'email', u.email, 'name', u.name, 'avatarUrl', u.avatar_url),
  'messages', COALESCE((SELECT json_agg(json_build_object('id', m.id, 'authorType', m.author_type, 'authorEmail', m.author_email, 'body', m.body, 'createdAt', m.created_at) ORDER BY m.created_at)
    FROM support_messages m WHERE m.ticket_id = t.id ${includeNotes ? "" : "AND m.author_type <> 'note'"}), '[]'::json)
) FROM support_tickets t JOIN app_users u ON u.id = t.user_id WHERE t.id = ${sqlString(ticketId)}), 'null'::json)::text;`);
  }

  function register(app) {
    // ----- public + user-facing -----
    app.get("/api/app/notice", async (_req, res) => {
      res.setHeader("Cache-Control", "no-store");
      try {
        res.json(await publicNotice());
      } catch {
        res.json({ announcement: null, maintenance: null, aiPaused: false });
      }
    });

    app.get("/api/billing/me", userRoute(async (_req, res, user) => {
      const [snapshot, plans] = await Promise.all([
        billingSnapshot(user.id),
        list(`SELECT id, name, description, price_cents AS "priceCents", monthly_tokens AS "monthlyTokens", features FROM billing_plans WHERE active ORDER BY sort, price_cents`),
      ]);
      res.json({ billing: snapshot, plans });
    }));

    app.get("/api/support/tickets", userRoute(async (_req, res, user) => {
      res.json({ tickets: await list(`
SELECT id, subject, category, status, created_at AS "createdAt", last_message_at AS "lastMessageAt",
  (SELECT author_type FROM support_messages m WHERE m.ticket_id = t.id AND m.author_type <> 'note' ORDER BY created_at DESC LIMIT 1) AS "lastAuthor"
FROM support_tickets t WHERE user_id = ${sqlString(user.id)} ORDER BY last_message_at DESC LIMIT 50`) });
    }));
    app.post("/api/support/tickets", userRoute(async (req, res, user) => {
      const subject = String(req.body?.subject || "").trim().slice(0, 160);
      const body = String(req.body?.body || "").trim().slice(0, 8000);
      const category = TICKET_CATEGORIES.includes(req.body?.category) ? req.body.category : "general";
      if (!subject || !body) throw adminError("Add a subject and describe the problem.");
      const open = Number(await runPsql(`SELECT count(*) FROM support_tickets WHERE user_id = ${sqlString(user.id)} AND status IN ('open','pending');`)) || 0;
      if (open >= 5) throw adminError("You have 5 open requests. Reply on one of those and we'll get to it.", 429);
      const id = `tkt_${crypto.randomBytes(8).toString("hex")}`;
      await runPsql(`
INSERT INTO support_tickets (id, user_id, subject, category) VALUES (${sqlString(id)}, ${sqlString(user.id)}, ${sqlString(subject)}, ${sqlString(category)});
INSERT INTO support_messages (ticket_id, author_type, author_email, body) VALUES (${sqlString(id)}, 'user', ${sqlString(user.email)}, ${sqlString(body)});`);
      res.status(201).json({ ticket: await ticketThread(id, { includeNotes: false }) });
    }));
    app.get("/api/support/tickets/:id", userRoute(async (req, res, user) => {
      const ticket = await ticketThread(req.params.id, { includeNotes: false });
      if (!ticket || ticket.user.id !== user.id) throw adminError("Request not found.", 404);
      res.json({ ticket });
    }));
    app.post("/api/support/tickets/:id/messages", userRoute(async (req, res, user) => {
      const ticket = await ticketThread(req.params.id, { includeNotes: false });
      if (!ticket || ticket.user.id !== user.id) throw adminError("Request not found.", 404);
      const body = String(req.body?.body || "").trim().slice(0, 8000);
      if (!body) throw adminError("Write a reply first.");
      await runPsql(`
INSERT INTO support_messages (ticket_id, author_type, author_email, body) VALUES (${sqlString(ticket.id)}, 'user', ${sqlString(user.email)}, ${sqlString(body)});
UPDATE support_tickets SET status = 'open', last_message_at = now(), updated_at = now() WHERE id = ${sqlString(ticket.id)};`);
      res.json({ ticket: await ticketThread(ticket.id, { includeNotes: false }) });
    }));

    // ----- admin: identity -----
    app.get("/api/admin/me", adminRoute(null, async (_req, res, admin) => {
      res.json({ admin: { id: admin.id, email: admin.email, name: admin.name, avatarUrl: admin.avatarUrl, role: admin.role, permissions: admin.permissions } });
    }));

    // ----- admin: overview -----
    app.get("/api/admin/overview", adminRoute("view", async (_req, res) => {
      const [totals, series, topUsers, signups, audit] = await Promise.all([
        json(`SELECT json_build_object(
  'users', (SELECT count(*) FROM app_users),
  'newUsers7d', (SELECT count(*) FROM app_users WHERE created_at > now() - interval '7 days'),
  'newUsersPrev7d', (SELECT count(*) FROM app_users WHERE created_at BETWEEN now() - interval '14 days' AND now() - interval '7 days'),
  'activeUsers7d', (SELECT count(*) FROM app_users WHERE last_seen_at > now() - interval '7 days'),
  'suspended', (SELECT count(*) FROM app_users WHERE status = 'suspended'),
  'paidSubscribers', (SELECT count(*) FROM billing_accounts a JOIN billing_plans p ON p.id = a.plan_id WHERE p.price_cents > 0 AND a.status = 'active'),
  'mrrCents', (SELECT COALESCE(SUM(p.price_cents), 0) FROM billing_accounts a JOIN billing_plans p ON p.id = a.plan_id WHERE a.status = 'active'),
  'tokens30d', (SELECT COALESCE(SUM(tokens_charged), 0) FROM ai_usage_events WHERE created_at > now() - interval '30 days'),
  'tokensPrev30d', (SELECT COALESCE(SUM(tokens_charged), 0) FROM ai_usage_events WHERE created_at BETWEEN now() - interval '60 days' AND now() - interval '30 days'),
  'cost30d', (SELECT COALESCE(SUM(cost_usd), 0) FROM ai_usage_events WHERE created_at > now() - interval '30 days'),
  'costPrev30d', (SELECT COALESCE(SUM(cost_usd), 0) FROM ai_usage_events WHERE created_at BETWEEN now() - interval '60 days' AND now() - interval '30 days'),
  'calls30d', (SELECT count(*) FROM ai_usage_events WHERE created_at > now() - interval '30 days'),
  'openTickets', (SELECT count(*) FROM support_tickets WHERE status IN ('open', 'pending')),
  'activeAgents', (SELECT count(*) FROM automation_agents WHERE status = 'active'),
  'uploads7d', (SELECT count(*) FROM automation_uploads WHERE created_at > now() - interval '7 days'),
  'jobsQueued', (SELECT count(*) FROM media_jobs WHERE status IN ('queued', 'running')) + (SELECT count(*) FROM creator_stage_jobs WHERE status IN ('queued', 'running')),
  'jobsFailed24h', (SELECT count(*) FROM media_jobs WHERE status = 'failed' AND updated_at > now() - interval '1 day') + (SELECT count(*) FROM creator_stage_jobs WHERE status = 'failed' AND updated_at > now() - interval '1 day')
)::text;`),
        list(`
SELECT to_char(d, 'YYYY-MM-DD') AS day,
  COALESCE((SELECT SUM(tokens_charged) FROM ai_usage_events WHERE created_at >= d AND created_at < d + interval '1 day'), 0) AS tokens,
  COALESCE((SELECT SUM(cost_usd) FROM ai_usage_events WHERE created_at >= d AND created_at < d + interval '1 day'), 0) AS cost,
  (SELECT count(*) FROM app_users WHERE created_at >= d AND created_at < d + interval '1 day') AS signups
FROM generate_series(date_trunc('day', now()) - interval '29 days', date_trunc('day', now()), interval '1 day') d ORDER BY d`),
        list(`
SELECT u.id, u.email, u.name, u.avatar_url AS "avatarUrl", SUM(e.tokens_charged) AS tokens, SUM(e.cost_usd) AS cost, count(*) AS calls
FROM ai_usage_events e JOIN app_users u ON u.id = e.user_id
WHERE e.created_at > now() - interval '30 days' GROUP BY u.id ORDER BY tokens DESC LIMIT 6`),
        list(`SELECT id, email, name, avatar_url AS "avatarUrl", created_at AS "createdAt" FROM app_users ORDER BY created_at DESC LIMIT 6`),
        list(`SELECT admin_email AS "adminEmail", action, target_type AS "targetType", target_id AS "targetId", created_at AS "createdAt" FROM admin_audit_log ORDER BY created_at DESC LIMIT 6`),
      ]);
      res.json({ totals, series, topUsers, signups, audit });
    }));

    // ----- admin: users -----
    app.get("/api/admin/users", adminRoute("view", async (req, res) => {
      const { limit, offset } = paging(req);
      const q = String(req.query.q || "").trim().toLowerCase();
      const status = ["active", "suspended"].includes(req.query.status) ? req.query.status : "";
      const plan = String(req.query.plan || "").trim();
      const sorts = { recent: "u.created_at DESC", active: "u.last_seen_at DESC NULLS LAST", usage: "tokens30d DESC", name: "lower(u.name)" };
      const order = sorts[req.query.sort] || sorts.recent;
      const where = [
        q ? `(lower(u.email) LIKE ${sqlString(`%${q}%`)} OR lower(u.name) LIKE ${sqlString(`%${q}%`)} OR u.id = ${sqlString(q)})` : "",
        status ? `u.status = ${sqlString(status)}` : "",
        plan ? `COALESCE(a.plan_id, 'free') = ${sqlString(plan)}` : "",
      ].filter(Boolean).join(" AND ") || "true";
      const from = `FROM app_users u LEFT JOIN billing_accounts a ON a.user_id = u.id LEFT JOIN billing_plans p ON p.id = a.plan_id WHERE ${where}`;
      const [users, total] = await Promise.all([
        list(`
SELECT u.id, u.email, u.name, u.avatar_url AS "avatarUrl", u.status, u.created_at AS "createdAt", u.last_seen_at AS "lastSeenAt",
  COALESCE(p.name, 'Free') AS "planName", COALESCE(a.plan_id, 'free') AS "planId", COALESCE(a.unlimited, false) AS unlimited,
  COALESCE(GREATEST(a.allowance_remaining, 0) + a.bonus_balance, NULL) AS balance,
  COALESCE((SELECT SUM(tokens_charged) FROM ai_usage_events e WHERE e.user_id = u.id AND e.created_at > now() - interval '30 days'), 0) AS tokens30d,
  (SELECT count(*) FROM youtube_accounts y WHERE y.user_id = u.id) AS channels
${from} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`),
        runPsql(`SELECT count(*) ${from};`),
      ]);
      res.json({ users, total: Number(total) || 0, limit, offset });
    }));

    app.get("/api/admin/users/:id", adminRoute("view", async (req, res) => {
      const id = String(req.params.id);
      const profile = await json(`SELECT COALESCE((SELECT json_build_object('id', id, 'email', email, 'name', name, 'avatarUrl', avatar_url, 'status', status, 'statusReason', status_reason, 'createdAt', created_at, 'lastSeenAt', last_seen_at) FROM app_users WHERE id = ${sqlString(id)}), 'null'::json)::text;`);
      if (!profile) throw adminError("User not found.", 404);
      const [billing, counts, channels, usageByDay, usageByFeature, ledger, tickets, agents] = await Promise.all([
        billingSnapshot(id),
        json(`SELECT json_build_object(
  'projects', (SELECT count(*) FROM creator_projects WHERE user_id = ${sqlString(id)}),
  'agents', (SELECT count(*) FROM automation_agents WHERE user_id = ${sqlString(id)}),
  'activeAgents', (SELECT count(*) FROM automation_agents WHERE user_id = ${sqlString(id)} AND status = 'active'),
  'uploads', (SELECT count(*) FROM automation_uploads WHERE user_id = ${sqlString(id)}),
  'jobs', (SELECT count(*) FROM creator_stage_jobs WHERE user_id = ${sqlString(id)}) + (SELECT count(*) FROM media_jobs WHERE user_id = ${sqlString(id)}),
  'sessions', (SELECT count(*) FROM app_sessions WHERE user_id = ${sqlString(id)} AND expires_at > now()),
  'tokens30d', (SELECT COALESCE(SUM(tokens_charged), 0) FROM ai_usage_events WHERE user_id = ${sqlString(id)} AND created_at > now() - interval '30 days'),
  'cost30d', (SELECT COALESCE(SUM(cost_usd), 0) FROM ai_usage_events WHERE user_id = ${sqlString(id)} AND created_at > now() - interval '30 days'),
  'tokensAllTime', (SELECT COALESCE(SUM(tokens_charged), 0) FROM ai_usage_events WHERE user_id = ${sqlString(id)})
)::text;`),
        list(`SELECT id, platform, channel_title AS title, channel_handle AS handle, thumbnail_url AS "thumbnailUrl", connected_at AS "connectedAt" FROM youtube_accounts WHERE user_id = ${sqlString(id)} ORDER BY connected_at DESC`),
        list(`
SELECT to_char(d, 'YYYY-MM-DD') AS day, COALESCE((SELECT SUM(tokens_charged) FROM ai_usage_events WHERE user_id = ${sqlString(id)} AND created_at >= d AND created_at < d + interval '1 day'), 0) AS tokens
FROM generate_series(date_trunc('day', now()) - interval '29 days', date_trunc('day', now()), interval '1 day') d ORDER BY d`),
        list(`SELECT feature, operation, SUM(tokens_charged) AS tokens, count(*) AS calls FROM ai_usage_events WHERE user_id = ${sqlString(id)} AND created_at > now() - interval '30 days' GROUP BY feature, operation ORDER BY tokens DESC LIMIT 8`),
        list(`SELECT id, kind, tokens, balance_after AS "balanceAfter", actor, note, created_at AS "createdAt" FROM token_ledger WHERE user_id = ${sqlString(id)} ORDER BY created_at DESC LIMIT 20`),
        list(`SELECT id, subject, status, priority, last_message_at AS "lastMessageAt" FROM support_tickets WHERE user_id = ${sqlString(id)} ORDER BY last_message_at DESC LIMIT 10`),
        list(`SELECT id, name, status, last_run_at AS "lastRunAt", next_run_at AS "nextRunAt" FROM automation_agents WHERE user_id = ${sqlString(id)} ORDER BY updated_at DESC LIMIT 20`),
      ]);
      res.json({ user: profile, billing, counts, channels, usageByDay, usageByFeature, ledger, tickets, agents });
    }));

    app.post("/api/admin/users/:id/status", adminRoute("users.manage", async (req, res, admin) => {
      const status = req.body?.status === "suspended" ? "suspended" : "active";
      const reason = String(req.body?.reason || "").trim().slice(0, 300);
      if (status === "suspended" && !reason) throw adminError("Add a reason; the user sees it when they try to sign in.");
      const email = await runPsql(`SELECT email FROM app_users WHERE id = ${sqlString(req.params.id)};`);
      if (!email) throw adminError("User not found.", 404);
      if (status === "suspended" && await adminRole(email)) throw adminError("Remove this person from the admin team before suspending them.", 409);
      await runPsql(`UPDATE app_users SET status = ${sqlString(status)}, status_reason = ${sqlString(status === "suspended" ? reason : "")}, updated_at = now() WHERE id = ${sqlString(req.params.id)};`);
      if (status === "suspended") await runPsql(`DELETE FROM app_sessions WHERE user_id = ${sqlString(req.params.id)};`);
      cache.users.delete(`status:${req.params.id}`);
      forget(req.params.id);
      await audit(admin, status === "suspended" ? "user.suspend" : "user.restore", "user", req.params.id, { email, reason }, req);
      res.json({ ok: true, status });
    }));

    app.post("/api/admin/users/:id/sessions/revoke", adminRoute("users.manage", async (req, res, admin) => {
      const count = await runPsql(`WITH d AS (DELETE FROM app_sessions WHERE user_id = ${sqlString(req.params.id)} RETURNING 1) SELECT count(*) FROM d;`);
      await audit(admin, "user.sessions_revoke", "user", req.params.id, { count: Number(count) || 0 }, req);
      res.json({ ok: true, revoked: Number(count) || 0 });
    }));

    app.post("/api/admin/users/:id/tokens", adminRoute("billing.manage", async (req, res, admin) => {
      const tokens = int(req.body?.tokens);
      const note = String(req.body?.note || "").trim().slice(0, 300);
      if (!note) throw adminError("Add a note so the ledger explains this change.");
      if (Math.abs(tokens) > 1000000000) throw adminError("That amount is too large.");
      const result = await adjustTokens(req.params.id, tokens, { kind: tokens > 0 ? "grant" : "revoke", actor: admin.email, note });
      await audit(admin, tokens > 0 ? "billing.grant_tokens" : "billing.revoke_tokens", "user", req.params.id, { tokens, note }, req);
      res.json({ ok: true, ...result });
    }));

    app.post("/api/admin/users/:id/plan", adminRoute("billing.manage", async (req, res, admin) => {
      const planId = String(req.body?.planId || "");
      await changePlan(req.params.id, planId, { actor: admin.email, resetAllowance: req.body?.resetAllowance !== false });
      await audit(admin, "billing.change_plan", "user", req.params.id, { planId, resetAllowance: req.body?.resetAllowance !== false }, req);
      res.json({ ok: true, billing: await billingSnapshot(req.params.id) });
    }));

    app.post("/api/admin/users/:id/billing", adminRoute("billing.manage", async (req, res, admin) => {
      await billingSnapshot(req.params.id);
      const sets = [];
      if (req.body?.unlimited !== undefined) sets.push(`unlimited = ${Boolean(req.body.unlimited)}`);
      if (req.body?.notes !== undefined) sets.push(`notes = ${sqlString(String(req.body.notes).slice(0, 1000))}`);
      if (["active", "past_due", "canceled"].includes(req.body?.status)) sets.push(`status = ${sqlString(req.body.status)}`);
      if (!sets.length) throw adminError("Nothing to change.");
      await runPsql(`UPDATE billing_accounts SET ${sets.join(", ")}, updated_at = now() WHERE user_id = ${sqlString(req.params.id)};`);
      forget(req.params.id);
      await audit(admin, "billing.update_account", "user", req.params.id, req.body || {}, req);
      res.json({ ok: true, billing: await billingSnapshot(req.params.id) });
    }));

    app.post("/api/admin/users/:id/agents/pause", adminRoute("users.manage", async (req, res, admin) => {
      const agentId = String(req.body?.agentId || "");
      const count = await runPsql(`WITH u AS (UPDATE automation_agents SET status = 'paused', updated_at = now() WHERE user_id = ${sqlString(req.params.id)} AND status = 'active' ${agentId ? `AND id = ${sqlString(agentId)}` : ""} RETURNING 1) SELECT count(*) FROM u;`);
      await audit(admin, "automation.pause", "user", req.params.id, { agentId: agentId || "all", count: Number(count) || 0 }, req);
      res.json({ ok: true, paused: Number(count) || 0 });
    }));

    // ----- admin: billing -----
    app.get("/api/admin/billing/plans", adminRoute("view", async (_req, res) => {
      res.json({ plans: await list(`
SELECT p.id, p.name, p.description, p.price_cents AS "priceCents", p.currency, p.monthly_tokens AS "monthlyTokens", p.features, p.is_default AS "isDefault", p.active, p.sort,
  (SELECT count(*) FROM billing_accounts a WHERE a.plan_id = p.id) AS subscribers
FROM billing_plans p ORDER BY p.sort, p.price_cents`) });
    }));
    app.post("/api/admin/billing/plans", adminRoute("billing.manage", async (req, res, admin) => {
      const body = req.body || {};
      const id = String(body.id || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
      const name = String(body.name || "").trim().slice(0, 60);
      if (!id || !name) throw adminError("A plan needs an id and a name.");
      const features = (Array.isArray(body.features) ? body.features : String(body.features || "").split("\n")).map((f) => String(f).trim()).filter(Boolean).slice(0, 12);
      const isDefault = Boolean(body.isDefault);
      await runPsql(`
${isDefault ? `UPDATE billing_plans SET is_default = false WHERE id <> ${sqlString(id)};` : ""}
INSERT INTO billing_plans (id, name, description, price_cents, monthly_tokens, features, is_default, active, sort, updated_at)
VALUES (${sqlString(id)}, ${sqlString(name)}, ${sqlString(String(body.description || "").slice(0, 200))}, ${Math.max(0, int(body.priceCents))}, ${Math.max(0, int(body.monthlyTokens))},
  ${jsonbLiteral(features)}, ${isDefault}, ${body.active !== false}, ${int(body.sort)}, now())
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, price_cents = EXCLUDED.price_cents, monthly_tokens = EXCLUDED.monthly_tokens,
  features = EXCLUDED.features, is_default = EXCLUDED.is_default, active = EXCLUDED.active, sort = EXCLUDED.sort, updated_at = now();`);
      const defaults = Number(await runPsql(`SELECT count(*) FROM billing_plans WHERE is_default AND active;`)) || 0;
      if (!defaults) throw adminError("Saved, but no active plan is the default for new users. Mark one as default.", 409);
      await audit(admin, "billing.save_plan", "plan", id, { name, priceCents: int(body.priceCents), monthlyTokens: int(body.monthlyTokens), active: body.active !== false, isDefault }, req);
      res.json({ ok: true });
    }));
    app.get("/api/admin/billing/ledger", adminRoute("view", async (req, res) => {
      const { limit, offset } = paging(req);
      const kind = String(req.query.kind || "");
      const where = [kind ? `l.kind = ${sqlString(kind)}` : "", req.query.userId ? `l.user_id = ${sqlString(req.query.userId)}` : ""].filter(Boolean).join(" AND ") || "true";
      res.json({ entries: await list(`
SELECT l.id, l.user_id AS "userId", u.email, u.name, l.kind, l.tokens, l.balance_after AS "balanceAfter", l.actor, l.note, l.created_at AS "createdAt"
FROM token_ledger l JOIN app_users u ON u.id = l.user_id WHERE ${where} ORDER BY l.created_at DESC LIMIT ${limit} OFFSET ${offset}`) });
    }));
    app.get("/api/admin/billing/summary", adminRoute("view", async (_req, res) => {
      res.json(await json(`SELECT json_build_object(
  'byPlan', COALESCE((SELECT json_agg(x ORDER BY x.sort) FROM (SELECT p.id, p.name, p.sort, p.price_cents AS "priceCents", count(a.user_id) AS subscribers, COALESCE(SUM(p.price_cents) FILTER (WHERE a.status = 'active'), 0) AS "mrrCents" FROM billing_plans p LEFT JOIN billing_accounts a ON a.plan_id = p.id GROUP BY p.id) x), '[]'::json),
  'granted30d', (SELECT COALESCE(SUM(tokens), 0) FROM token_ledger WHERE kind = 'grant' AND created_at > now() - interval '30 days'),
  'unlimitedAccounts', (SELECT count(*) FROM billing_accounts WHERE unlimited),
  'outOfTokens', (SELECT count(*) FROM billing_accounts WHERE NOT unlimited AND GREATEST(allowance_remaining, 0) + bonus_balance <= 0),
  'pastDue', (SELECT count(*) FROM billing_accounts WHERE status = 'past_due')
)::text;`));
    }));

    // ----- admin: usage -----
    app.get("/api/admin/usage", adminRoute("view", async (req, res) => {
      const window = `created_at > now() - interval '${days(req)} days'`;
      const [totals, series, byProvider, byModel, byFeature, topUsers] = await Promise.all([
        json(`SELECT json_build_object('tokens', COALESCE(SUM(tokens_charged), 0), 'cost', COALESCE(SUM(cost_usd), 0), 'calls', count(*),
  'inputTokens', COALESCE(SUM(input_tokens), 0), 'outputTokens', COALESCE(SUM(output_tokens), 0),
  'unattributedCost', COALESCE(SUM(cost_usd) FILTER (WHERE user_id IS NULL), 0),
  'estimatedShare', COALESCE(AVG(CASE WHEN cost_estimated THEN 1 ELSE 0 END), 0),
  'users', count(DISTINCT user_id))::text FROM ai_usage_events WHERE ${window};`),
        list(`
SELECT to_char(d, 'YYYY-MM-DD') AS day,
  COALESCE((SELECT SUM(tokens_charged) FROM ai_usage_events WHERE created_at >= d AND created_at < d + interval '1 day'), 0) AS tokens,
  COALESCE((SELECT SUM(cost_usd) FROM ai_usage_events WHERE created_at >= d AND created_at < d + interval '1 day'), 0) AS cost,
  (SELECT count(*) FROM ai_usage_events WHERE created_at >= d AND created_at < d + interval '1 day') AS calls
FROM generate_series(date_trunc('day', now()) - interval '${days(req) - 1} days', date_trunc('day', now()), interval '1 day') d ORDER BY d`),
        list(`SELECT provider, SUM(tokens_charged) AS tokens, SUM(cost_usd) AS cost, count(*) AS calls FROM ai_usage_events WHERE ${window} GROUP BY provider ORDER BY cost DESC`),
        list(`SELECT provider, model, operation, SUM(tokens_charged) AS tokens, SUM(cost_usd) AS cost, count(*) AS calls, SUM(input_tokens) AS "inputTokens", SUM(output_tokens) AS "outputTokens" FROM ai_usage_events WHERE ${window} GROUP BY provider, model, operation ORDER BY cost DESC LIMIT 15`),
        list(`SELECT feature, SUM(tokens_charged) AS tokens, SUM(cost_usd) AS cost, count(*) AS calls FROM ai_usage_events WHERE ${window} GROUP BY feature ORDER BY cost DESC LIMIT 15`),
        list(`SELECT u.id, u.email, u.name, u.avatar_url AS "avatarUrl", SUM(e.tokens_charged) AS tokens, SUM(e.cost_usd) AS cost, count(*) AS calls FROM ai_usage_events e JOIN app_users u ON u.id = e.user_id WHERE e.${window} GROUP BY u.id ORDER BY tokens DESC LIMIT 10`),
      ]);
      res.json({ days: days(req), totals, series, byProvider, byModel, byFeature, topUsers });
    }));
    app.get("/api/admin/usage/events", adminRoute("view", async (req, res) => {
      const { limit, offset } = paging(req);
      const where = [
        req.query.userId ? `e.user_id = ${sqlString(req.query.userId)}` : "",
        req.query.provider ? `e.provider = ${sqlString(req.query.provider)}` : "",
        req.query.unattributed === "1" ? "e.user_id IS NULL" : "",
      ].filter(Boolean).join(" AND ") || "true";
      res.json({ events: await list(`
SELECT e.id, e.user_id AS "userId", u.email, e.provider, e.model, e.operation, e.feature, e.input_tokens AS "inputTokens", e.output_tokens AS "outputTokens",
  e.cost_usd AS cost, e.cost_estimated AS "costEstimated", e.tokens_charged AS tokens, e.created_at AS "createdAt"
FROM ai_usage_events e LEFT JOIN app_users u ON u.id = e.user_id WHERE ${where} ORDER BY e.created_at DESC LIMIT ${limit} OFFSET ${offset}`) });
    }));

    // ----- admin: activity -----
    app.get("/api/admin/activity", adminRoute("view", async (req, res) => {
      const { limit } = paging(req, 150);
      const type = String(req.query.type || "");
      const userFilter = req.query.userId ? ` AND user_id = ${sqlString(req.query.userId)}` : "";
      const sources = {
        signup: `SELECT 'signup' AS type, id AS ref, id AS user_id, 'Joined AutoYT' AS title, '' AS detail, 'ok' AS status, created_at AS at FROM app_users WHERE true${userFilter.replace("user_id", "id")}`,
        upload: `SELECT 'upload', id, user_id, COALESCE(NULLIF(title, ''), movie_title, 'Upload'), youtube_url, status, created_at FROM automation_uploads WHERE true${userFilter}`,
        automation: `SELECT 'automation', r.id, a.user_id, a.name, left(r.message, 240), r.status, r.started_at FROM automation_runs r JOIN automation_agents a ON a.id = r.agent_id WHERE true${userFilter.replace("user_id", "a.user_id")}`,
        project: `SELECT 'project', id, user_id, COALESCE(NULLIF(title, ''), 'Untitled project'), stage, status, created_at FROM creator_projects WHERE true${userFilter}`,
        job: `SELECT 'job', id, user_id, stage, left(COALESCE(NULLIF(error, ''), message), 240), status, updated_at FROM creator_stage_jobs WHERE true${userFilter}`,
        media: `SELECT 'media', id::text, user_id, kind, left(COALESCE(error, message), 240), status, updated_at FROM media_jobs WHERE true${userFilter}`,
        ticket: `SELECT 'ticket', id, user_id, subject, category, status, created_at FROM support_tickets WHERE true${userFilter}`,
      };
      const chosen = sources[type] ? [sources[type]] : Object.values(sources);
      const items = await list(`
SELECT x.type, x.ref, x.user_id AS "userId", u.email, u.name, u.avatar_url AS "avatarUrl", x.title, x.detail, x.status, x.at
FROM (${chosen.map((sql) => `(${sql} ORDER BY 7 DESC LIMIT ${limit})`).join(" UNION ALL ")}) x(type, ref, user_id, title, detail, status, at)
LEFT JOIN app_users u ON u.id = x.user_id ORDER BY x.at DESC LIMIT ${limit}`);
      res.json({ items });
    }));
    app.post("/api/admin/jobs/:id/cancel", adminRoute("users.manage", async (req, res, admin) => {
      const count = await runPsql(`WITH c AS (UPDATE media_jobs SET status = 'cancelled', error = 'Cancelled by an admin', finished_at = now(), updated_at = now() WHERE id::text = ${sqlString(req.params.id)} AND status IN ('queued', 'running') RETURNING 1) SELECT count(*) FROM c;`);
      if (!Number(count)) throw adminError("That job isn't queued or running.", 409);
      await audit(admin, "job.cancel", "media_job", req.params.id, {}, req);
      res.json({ ok: true });
    }));

    // ----- admin: support -----
    app.get("/api/admin/support/tickets", adminRoute("view", async (req, res, admin) => {
      const { limit, offset } = paging(req);
      const status = String(req.query.status || "active");
      const where = status === "all" ? "true" : status === "active" ? "t.status IN ('open', 'pending')" : TICKET_STATUSES.includes(status) ? `t.status = ${sqlString(status)}` : "true";
      const mine = req.query.assigned === "me" ? ` AND t.assigned_to = ${sqlString(admin.email)}` : "";
      const [tickets, counts] = await Promise.all([
        list(`
SELECT t.id, t.subject, t.category, t.status, t.priority, t.assigned_to AS "assignedTo", t.created_at AS "createdAt", t.last_message_at AS "lastMessageAt",
  u.id AS "userId", u.email, u.name, u.avatar_url AS "avatarUrl",
  (SELECT author_type FROM support_messages m WHERE m.ticket_id = t.id AND m.author_type <> 'note' ORDER BY created_at DESC LIMIT 1) AS "lastAuthor"
FROM support_tickets t JOIN app_users u ON u.id = t.user_id WHERE ${where}${mine}
ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.last_message_at DESC LIMIT ${limit} OFFSET ${offset}`),
        json(`SELECT json_object_agg(status, n)::text FROM (SELECT status, count(*) AS n FROM support_tickets GROUP BY status) s;`, {}),
      ]);
      res.json({ tickets, counts: counts || {} });
    }));
    app.get("/api/admin/support/tickets/:id", adminRoute("view", async (req, res) => {
      const ticket = await ticketThread(req.params.id, { includeNotes: true });
      if (!ticket) throw adminError("Ticket not found.", 404);
      res.json({ ticket });
    }));
    app.post("/api/admin/support/tickets/:id/messages", adminRoute("support.manage", async (req, res, admin) => {
      const body = String(req.body?.body || "").trim().slice(0, 8000);
      const note = Boolean(req.body?.internal);
      if (!body) throw adminError("Write a reply first.");
      const exists = await runPsql(`SELECT 1 FROM support_tickets WHERE id = ${sqlString(req.params.id)};`);
      if (!exists) throw adminError("Ticket not found.", 404);
      await runPsql(`
INSERT INTO support_messages (ticket_id, author_type, author_email, body) VALUES (${sqlString(req.params.id)}, ${note ? "'note'" : "'admin'"}, ${sqlString(admin.email)}, ${sqlString(body)});
UPDATE support_tickets SET ${note ? "" : "status = CASE WHEN status = 'open' THEN 'pending' ELSE status END, last_message_at = now(),"}
  assigned_to = CASE WHEN assigned_to = '' THEN ${sqlString(admin.email)} ELSE assigned_to END, updated_at = now() WHERE id = ${sqlString(req.params.id)};`);
      await audit(admin, note ? "support.note" : "support.reply", "ticket", req.params.id, {}, req);
      res.json({ ticket: await ticketThread(req.params.id, { includeNotes: true }) });
    }));
    app.post("/api/admin/support/tickets/:id", adminRoute("support.manage", async (req, res, admin) => {
      const sets = [];
      if (TICKET_STATUSES.includes(req.body?.status)) sets.push(`status = ${sqlString(req.body.status)}`);
      if (TICKET_PRIORITIES.includes(req.body?.priority)) sets.push(`priority = ${sqlString(req.body.priority)}`);
      if (typeof req.body?.assignedTo === "string") sets.push(`assigned_to = ${sqlString(req.body.assignedTo.trim().toLowerCase().slice(0, 200))}`);
      if (!sets.length) throw adminError("Nothing to change.");
      await runPsql(`UPDATE support_tickets SET ${sets.join(", ")}, updated_at = now() WHERE id = ${sqlString(req.params.id)};`);
      await audit(admin, "support.update", "ticket", req.params.id, req.body || {}, req);
      res.json({ ticket: await ticketThread(req.params.id, { includeNotes: true }) });
    }));

    // ----- admin: governance -----
    app.get("/api/admin/settings", adminRoute("view", async (_req, res) => {
      const [governance, billing] = await Promise.all([getSettings("governance"), getSettings("billing")]);
      res.json({ governance, billing, providers: PROVIDERS });
    }));
    app.put("/api/admin/settings/:key", adminRoute("settings.manage", async (req, res, admin) => {
      const key = String(req.params.key);
      const before = await getSettings(key);
      const saved = await saveSettings(key, req.body || {}, admin.email);
      const changed = Object.keys(saved).filter((k) => JSON.stringify(saved[k]) !== JSON.stringify(before[k]));
      await audit(admin, `settings.${key}`, "settings", key, { changed, after: Object.fromEntries(changed.map((k) => [k, saved[k]])) }, req);
      res.json({ [key]: saved });
    }));

    // ----- admin: team + audit -----
    app.get("/api/admin/team", adminRoute("view", async (_req, res) => {
      const members = await list(`SELECT lower(m.email) AS email, m.role, m.added_by AS "addedBy", m.created_at AS "createdAt", u.name, u.avatar_url AS "avatarUrl", u.last_seen_at AS "lastSeenAt" FROM admin_members m LEFT JOIN app_users u ON lower(u.email) = lower(m.email) ORDER BY m.created_at`);
      const ownerRows = [...owners()].map((email) => ({ email, role: "owner", source: "ADMIN_EMAILS" }));
      res.json({ owners: ownerRows, members: members.filter((m) => !owners().has(m.email)) });
    }));
    app.post("/api/admin/team", adminRoute("team.manage", async (req, res, admin) => {
      const email = String(req.body?.email || "").trim().toLowerCase();
      const role = String(req.body?.role || "");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw adminError("Enter a valid email address.");
      if (!["admin", "support", "viewer"].includes(role)) throw adminError("Pick admin, support or viewer. Owners are set with ADMIN_EMAILS.");
      if (owners().has(email)) throw adminError("That person is already an owner.", 409);
      await runPsql(`INSERT INTO admin_members (email, role, added_by) VALUES (${sqlString(email)}, ${sqlString(role)}, ${sqlString(admin.email)}) ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role;`);
      cache.members.at = 0;
      await audit(admin, "team.set_role", "admin", email, { role }, req);
      res.json({ ok: true });
    }));
    app.delete("/api/admin/team/:email", adminRoute("team.manage", async (req, res, admin) => {
      const email = String(req.params.email).toLowerCase();
      await runPsql(`DELETE FROM admin_members WHERE lower(email) = ${sqlString(email)};`);
      cache.members.at = 0;
      await audit(admin, "team.remove", "admin", email, {}, req);
      res.json({ ok: true });
    }));
    app.get("/api/admin/audit", adminRoute("view", async (req, res) => {
      const { limit, offset } = paging(req);
      const where = [req.query.admin ? `admin_email = ${sqlString(String(req.query.admin).toLowerCase())}` : "", req.query.targetId ? `target_id = ${sqlString(req.query.targetId)}` : ""].filter(Boolean).join(" AND ") || "true";
      res.json({ entries: await list(`SELECT id, admin_email AS "adminEmail", action, target_type AS "targetType", target_id AS "targetId", detail, ip, created_at AS "createdAt" FROM admin_audit_log WHERE ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`) });
    }));

    // ----- admin: system -----
    app.get("/api/admin/system", adminRoute("view", async (_req, res) => {
      const [queues, failures, external] = await Promise.all([
        list(`SELECT 'media' AS queue, kind, status, count(*) AS n FROM media_jobs WHERE updated_at > now() - interval '7 days' GROUP BY kind, status
UNION ALL SELECT 'creator', stage, status, count(*) FROM creator_stage_jobs WHERE updated_at > now() - interval '7 days' GROUP BY stage, status`),
        list(`(SELECT 'media' AS queue, id::text AS id, user_id AS "userId", kind, left(COALESCE(error, ''), 300) AS error, updated_at AS "updatedAt" FROM media_jobs WHERE status = 'failed' ORDER BY updated_at DESC LIMIT 8)
UNION ALL (SELECT 'creator', id, user_id, stage, left(error, 300), updated_at FROM creator_stage_jobs WHERE status = 'failed' ORDER BY updated_at DESC LIMIT 8)`),
        Promise.resolve(deps.systemStatus?.()).catch((error) => ({ error: error instanceof Error ? error.message : String(error) })),
      ]);
      const memory = process.memoryUsage();
      res.json({
        process: { uptimeSeconds: Math.round(process.uptime()), node: process.version, rssMb: Math.round(memory.rss / 1048576), heapMb: Math.round(memory.heapUsed / 1048576) },
        queues, failures: failures.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 10), ...(external || {}),
      });
    }));
  }

  installUsageHandlers({ guard, meter });

  return {
    register, usageMiddleware, maintenanceMiddleware, publicNotice, signupAllowed, userStatus, touch,
    billingSnapshot, adjustTokens, changePlan, getSettings, adminRole,
  };
}
