import crypto from "node:crypto";
import { installUsageHandlers, runWithUsageContext } from "../src/utils/usageMeter.js";
import { createPriceCatalog, resolveModelRate } from "./providerPrices.js";
import { TOKENS_PER_CREDIT, creditsToTokens, tokensToCredits } from "../src/utils/credits.js";
import { CREDIT_PACKS, creditPack, createPaystackClient, paystackConfigured, validPaystackWebhook, verifiedPaystackPayment } from "./paystackBilling.js";

// Admin console: credit billing, AI usage metering, user governance, support and
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
    // Exact model ids that may not be called. Features with a fallback model switch to it.
    blockedModels: [],
    announcement: { active: false, tone: "info", text: "" },
  },
  billing: {
    // Tokens measure provider cost: tokensPerUsd tokens = $1 of what providers charge us.
    // A call to a cheap model uses few tokens, an expensive one many.
    tokensPerUsd: 1000000,
    // Profit lives in plan prices: price = provider cost of the plan's tokens × (1 + margin).
    profitMarginPercent: 50,
    // How auto prices are rounded up: "ninety_nine" ($12.99), "whole" ($13), "cents" ($12.01).
    priceRounding: "ninety_nine",
    // Fallback per-token prices when neither the provider nor the price list has one.
    inputUsdPer1M: 0.5,
    outputUsdPer1M: 2,
    // Charged per unit when a provider reports neither tokens nor cost and no per-call price is known.
    flatTokens: { image: 60000, video: 750000, speech: 3000, music: 150000, transcription: 5000, default: 10000 },
    // Admin price overrides per model: { "gemini-3.7-flash": { inputPer1M, outputPer1M, perCall } }.
    modelPrices: {},
    // Optional extra charge on specific models, e.g. { "minimax/hailuo-3": 1.2 }.
    modelMultipliers: {},
    paymentProvider: "manual",
  },
  support: {
    cannedReplies: [],
    signature: "",
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
      blockedModels: [...new Set((Array.isArray(input.blockedModels) ? input.blockedModels : []).map((m) => String(m).trim().slice(0, 160)).filter(Boolean))].slice(0, 100),
      announcement: {
        active: Boolean(announcement.active),
        tone: ["info", "warning", "success"].includes(announcement.tone) ? announcement.tone : "info",
        text: String(announcement.text || "").trim().slice(0, 280),
      },
    };
  }
  if (key === "support") {
    const replies = Array.isArray(input.cannedReplies) ? input.cannedReplies : [];
    return {
      cannedReplies: replies
        .map((r, i) => ({ id: String(r?.id || `reply_${i}`).slice(0, 40), title: String(r?.title || "").trim().slice(0, 80), body: String(r?.body || "").trim().slice(0, 4000) }))
        .filter((r) => r.title && r.body)
        .slice(0, 50),
      signature: String(input.signature || "").trim().slice(0, 500),
    };
  }
  const flat = input.flatTokens && typeof input.flatTokens === "object" ? input.flatTokens : {};
  const multipliers = input.modelMultipliers && typeof input.modelMultipliers === "object" ? input.modelMultipliers : {};
  const prices = input.modelPrices && typeof input.modelPrices === "object" ? input.modelPrices : {};
  const rate = (value) => (value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : clampNumber(value, 0, 0, 100000));
  return {
    tokensPerUsd: Math.round(clampNumber(input.tokensPerUsd, base.tokensPerUsd, 1000, 100000000)),
    profitMarginPercent: clampNumber(input.profitMarginPercent, base.profitMarginPercent, 0, 1000),
    priceRounding: ["ninety_nine", "whole", "cents"].includes(input.priceRounding) ? input.priceRounding : base.priceRounding,
    inputUsdPer1M: clampNumber(input.inputUsdPer1M, base.inputUsdPer1M, 0, 1000),
    outputUsdPer1M: clampNumber(input.outputUsdPer1M, base.outputUsdPer1M, 0, 1000),
    flatTokens: Object.fromEntries(Object.entries(base.flatTokens).map(([op, tokens]) => [op, Math.round(clampNumber(flat[op], tokens, 0, 1000000000))])),
    modelPrices: Object.fromEntries(Object.entries(prices)
      .map(([model, p]) => [String(model).trim().slice(0, 160), { inputPer1M: rate(p?.inputPer1M), outputPer1M: rate(p?.outputPer1M), perCall: rate(p?.perCall) }])
      .filter(([model, p]) => model && (p.inputPer1M !== null || p.outputPer1M !== null || p.perCall !== null))
      .slice(0, 300)),
    modelMultipliers: Object.fromEntries(Object.entries(multipliers)
      .map(([model, value]) => [String(model).trim().slice(0, 160), clampNumber(value, 1, 0, 50)])
      .filter(([model, value]) => model && value !== 1)
      .slice(0, 200)),
    paymentProvider: ["manual", "paystack"].includes(input.paymentProvider) ? input.paymentProvider : base.paymentProvider,
  };
}

// A plan's price from its token allowance: what those tokens cost at provider
// prices, plus the profit margin, rounded up. Rounding only ever adds profit.
export function planPrice(monthlyTokens, billing = DEFAULT_SETTINGS.billing, marginPercent = null) {
  const margin = marginPercent === null || marginPercent === undefined || marginPercent === "" ? billing.profitMarginPercent : Number(marginPercent);
  const costCents = (Math.max(0, Number(monthlyTokens) || 0) / billing.tokensPerUsd) * 100;
  const raw = costCents * (1 + margin / 100);
  let priceCents = 0;
  if (raw > 0) {
    if (billing.priceRounding === "cents") priceCents = Math.ceil(raw - 1e-9);
    else if (billing.priceRounding === "whole") priceCents = Math.ceil(raw / 100 - 1e-9) * 100;
    else {
      priceCents = Math.ceil(raw / 100 - 1e-9) * 100 - 1;
      if (priceCents < raw) priceCents += 100;
    }
  }
  return { costCents: Math.round(costCents * 100) / 100, priceCents, profitCents: Math.round((priceCents - costCents) * 100) / 100, marginPercent: margin };
}

// What a plan earns if every token is used: provider cost, price, profit.
export function planEconomics(plan, billing = DEFAULT_SETTINGS.billing) {
  const margin = plan.marginPercent === null || plan.marginPercent === undefined ? null : Number(plan.marginPercent);
  const suggested = planPrice(plan.monthlyTokens, billing, margin);
  const costCents = suggested.costCents;
  const priceCents = Number(plan.priceCents) || 0;
  return {
    costCents,
    suggestedPriceCents: suggested.priceCents,
    marginPercent: suggested.marginPercent,
    profitCents: Math.round((priceCents - costCents) * 100) / 100,
    effectiveMarginPercent: costCents > 0 ? Math.round(((priceCents - costCents) / costCents) * 1000) / 10 : null,
  };
}

// Converts one metered call into AutoYT tokens at its real provider cost:
// the cost the provider reported, else the model's price (override or live
// price list), else fallback rates. `rate` comes from resolveModelRate().
export function priceUsage(event, billing = DEFAULT_SETTINGS.billing, rate = null) {
  const inputTokens = Math.max(0, Number(event.inputTokens) || 0);
  const outputTokens = Math.max(0, Number(event.outputTokens) || 0);
  const units = Math.max(0, Number(event.units) || 0);
  const reported = Number(event.costUsd);
  const multiplier = Number(billing.modelMultipliers?.[event.model] ?? 1);
  const scale = Number.isFinite(multiplier) && multiplier >= 0 ? multiplier : 1;
  let costUsd;
  let estimated = true;
  let source = "fallback";
  if (Number.isFinite(reported) && reported > 0) {
    costUsd = reported;
    estimated = false;
    source = "provider";
  } else if (inputTokens || outputTokens) {
    const inRate = rate?.inputPer1M ?? billing.inputUsdPer1M;
    const outRate = rate?.outputPer1M ?? billing.outputUsdPer1M;
    costUsd = (inputTokens * inRate + outputTokens * outRate) / 1e6;
    if (rate && (rate.inputPer1M !== null || rate.outputPer1M !== null)) source = rate.source;
  } else if (rate?.perCall !== null && rate?.perCall !== undefined) {
    costUsd = Math.max(1, units) * rate.perCall;
    source = rate.source;
  } else {
    const perUnit = billing.flatTokens[event.operation] ?? billing.flatTokens.default;
    costUsd = (units * perUnit) / billing.tokensPerUsd;
  }
  return { tokens: Math.ceil(costUsd * billing.tokensPerUsd * scale), costUsd, estimated, source };
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
  const catalog = deps.priceCatalog === undefined ? createPriceCatalog() : deps.priceCatalog;
  const paystack = createPaystackClient(env, deps.fetch || fetch);
  async function modelRate(model, billing) {
    const hit = catalog && model ? await catalog.lookup(model).catch(() => null) : null;
    return resolveModelRate(model, billing.modelPrices, hit);
  }
  const int = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback);

  async function json(sql, fallback = null) {
    const out = await runPsql(sql);
    return out ? JSON.parse(out) : fallback;
  }
  const list = (sql) => json(`SELECT COALESCE(json_agg(t), '[]'::json)::text FROM (${sql}) t;`, []);
  const paymentSchemaReady = async () => (await runPsql("SELECT to_regclass('billing_orders') IS NOT NULL;")).trim() === "t";

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
  WHERE a.user_id = ${sqlString(userId)} AND a.period_end <= now() AND (p.price_cents = 0 OR a.payment_provider = 'manual') FOR UPDATE OF a
), renewed AS (
  UPDATE billing_accounts a SET allowance_remaining = due.monthly_tokens, period_start = now(), period_end = now() + interval '1 month', updated_at = now()
  FROM due WHERE a.user_id = due.user_id
  RETURNING a.user_id, due.monthly_tokens, GREATEST(a.allowance_remaining, 0) + a.bonus_balance AS balance
)
INSERT INTO token_ledger (user_id, kind, tokens, balance_after, note)
SELECT user_id, 'allowance_reset', monthly_tokens, balance, 'Monthly allowance renewed' FROM renewed;
UPDATE billing_accounts a SET allowance_remaining = 0, status = 'past_due', updated_at = now()
FROM billing_plans p WHERE a.user_id = ${sqlString(userId)} AND a.plan_id = p.id
  AND p.price_cents > 0 AND a.payment_provider = 'paystack' AND a.period_end <= now() AND a.status = 'active';`;
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
    if (snapshot) {
      snapshot.tokensPerCredit = TOKENS_PER_CREDIT;
      snapshot.monthlyCredits = tokensToCredits(snapshot.monthlyTokens);
      snapshot.allowanceCredits = tokensToCredits(snapshot.allowanceRemaining);
      snapshot.bonusCredits = tokensToCredits(snapshot.bonusBalance);
      snapshot.balanceCredits = tokensToCredits(snapshot.balance);
      snapshot.periodUsedCredits = tokensToCredits(snapshot.periodUsed);
    }
    if (snapshot) cache.users.set(userId, { at: Date.now(), snapshot });
    return snapshot;
  }
  async function cachedSnapshot(userId) {
    const hit = cache.users.get(userId);
    if (hit && Date.now() - hit.at < 10000) return hit.snapshot;
    return billingSnapshot(userId);
  }
  const forget = (userId) => cache.users.delete(userId);

  async function guard({ provider, userId, model }) {
    const governance = await getSettings("governance");
    if (!governance.aiEnabled)
      return { blocked: true, status: 503, code: "ai_paused", message: "AI generation is paused for maintenance. Try again shortly." };
    if (governance.disabledProviders.includes(provider))
      return { blocked: true, status: 503, code: "provider_paused", message: `The ${provider} provider is paused. Try again shortly.` };
    if (model && governance.blockedModels.includes(String(model)))
      return { blocked: true, status: 503, code: "model_paused", message: `The ${model} model is turned off. Try again shortly.` };
    if (!userId) return null;
    const snapshot = await cachedSnapshot(userId);
    if (!snapshot) return null;
    if (snapshot.userStatus === "suspended")
      return { blocked: true, status: 403, code: "account_suspended", message: "This account is suspended. Contact support to restore access." };
    if (snapshot.unlimited || snapshot.balance > 0) return null;
    return {
      blocked: true, status: 402, code: "insufficient_tokens",
      message: `You've used all your AutoYT credits for this period. They renew ${new Date(snapshot.periodEnd).toDateString()}, or upgrade your plan for more.`,
    };
  }

  async function meter(event) {
    const billing = await getSettings("billing");
    // Look up the model's price only when the provider didn't report the cost.
    const reported = Number(event.costUsd) > 0;
    const price = priceUsage(event, billing, reported ? null : await modelRate(event.model, billing));
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
  bonus_balance = CASE WHEN cur.unlimited THEN a.bonus_balance ELSE GREATEST(cur.bonus_balance - GREATEST(${price.tokens} - GREATEST(cur.allowance_remaining, 0), 0), 0) END,
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

  async function paymentOrder(reference) {
    return json(`SELECT COALESCE((SELECT row_to_json(o) FROM (
      SELECT b.reference, b.user_id AS "userId", b.kind, b.plan_id AS "planId", b.credits_tokens AS "creditsTokens",
        b.amount_cents AS "amountCents", b.currency, b.status, u.email
      FROM billing_orders b JOIN app_users u ON u.id = b.user_id WHERE b.reference = ${sqlString(reference)}
    ) o), 'null'::json)::text;`);
  }

  async function settlePaystack(reference) {
    const order = await paymentOrder(reference);
    if (!order) throw adminError("Payment order not found.", 404);
    if (order.status === "paid") return order;
    if (order.status !== "pending") throw adminError("This payment order is closed.", 409);
    const transaction = await paystack.verify(reference);
    if (!verifiedPaystackPayment(transaction, order, order.email)) throw adminError("Payment has not been confirmed yet.", 409);
    const providerId = String(transaction.id || "");
    const granted = Number(await runPsql(`
WITH claimed AS (
  UPDATE billing_orders SET status = 'paid', provider_payment_id = ${sqlString(providerId)}, paid_at = now(), updated_at = now()
  WHERE reference = ${sqlString(reference)} AND status = 'pending' RETURNING *
), updated AS (
  UPDATE billing_accounts a SET
    plan_id = CASE WHEN c.kind = 'plan' THEN c.plan_id ELSE a.plan_id END,
    allowance_remaining = CASE WHEN c.kind = 'plan' THEN p.monthly_tokens ELSE a.allowance_remaining END,
    bonus_balance = GREATEST(a.bonus_balance, 0) + CASE WHEN c.kind = 'credits' THEN c.credits_tokens ELSE 0 END,
    period_start = CASE WHEN c.kind = 'plan' THEN now() ELSE a.period_start END,
    period_end = CASE WHEN c.kind = 'plan' THEN now() + interval '1 month' ELSE a.period_end END,
    status = CASE WHEN c.kind = 'plan' THEN 'active' ELSE a.status END,
    payment_provider = CASE WHEN c.kind = 'plan' THEN 'paystack' ELSE a.payment_provider END,
    payment_ref = CASE WHEN c.kind = 'plan' THEN c.reference ELSE a.payment_ref END,
    updated_at = now()
  FROM claimed c LEFT JOIN billing_plans p ON p.id = c.plan_id
  WHERE a.user_id = c.user_id
  RETURNING a.user_id, a.allowance_remaining, a.bonus_balance
), ledger AS (
  INSERT INTO token_ledger (user_id, kind, tokens, balance_after, actor, note, reference)
  SELECT u.user_id, CASE WHEN c.kind = 'plan' THEN 'plan_purchase' ELSE 'credit_purchase' END,
    CASE WHEN c.kind = 'plan' THEN p.monthly_tokens ELSE c.credits_tokens END,
    GREATEST(u.allowance_remaining, 0) + u.bonus_balance, 'paystack',
    CASE WHEN c.kind = 'plan' THEN 'Plan payment verified' ELSE 'Credit pack payment verified' END, c.reference
  FROM updated u JOIN claimed c ON c.user_id = u.user_id LEFT JOIN billing_plans p ON p.id = c.plan_id
  RETURNING 1
)
SELECT count(*) FROM ledger;`)) || 0;
    if (granted) forget(order.userId);
    return paymentOrder(reference);
  }

  // Keeps every auto-priced plan at provider cost of its tokens + margin.
  async function recalcAutoPlans() {
    const billing = await getSettings("billing");
    const plans = await list(`SELECT id, monthly_tokens AS "monthlyTokens", margin_percent AS "marginPercent", price_cents AS "priceCents" FROM billing_plans WHERE price_mode = 'auto'`);
    const changes = plans
      .map((p) => ({ id: p.id, from: int(p.priceCents), to: planPrice(p.monthlyTokens, billing, p.marginPercent === null ? null : Number(p.marginPercent)).priceCents }))
      .filter((c) => c.from !== c.to);
    if (changes.length)
      await runPsql(changes.map((c) => `UPDATE billing_plans SET price_cents = ${c.to}, updated_at = now() WHERE id = ${sqlString(c.id)};`).join("\n"));
    return changes;
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
      if (/^\/api\/(auth|admin|app)\//.test(req.path) || req.path === "/api/billing/paystack/webhook") return next();
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
      const [snapshot, plans, billing] = await Promise.all([
        billingSnapshot(user.id),
        list(`SELECT id, name, description, price_cents AS "priceCents", monthly_tokens AS "monthlyTokens", features FROM billing_plans WHERE active ORDER BY sort, price_cents`),
        getSettings("billing"),
      ]);
      res.json({ billing: snapshot, plans, payment: { provider: "paystack", available: paystackConfigured(env) && await paymentSchemaReady(), testMode: String(env.PAYSTACK_SECRET_KEY || "").startsWith("sk_test_"), packs: CREDIT_PACKS }, pricing: { tokensPerCredit: TOKENS_PER_CREDIT, tokensPerUsd: billing.tokensPerUsd, flatTokens: billing.flatTokens } });
    }));

    app.post("/api/billing/checkout", userRoute(async (req, res, user) => {
      if (req.get("x-billing-request") !== "1") throw adminError("Missing billing request header.", 403);
      if (!paystackConfigured(env)) throw adminError("Payments are not available yet.", 503);
      if (!await paymentSchemaReady()) throw adminError("Payments are being set up. Please try again later.", 503);
      const kind = String(req.body?.kind || "");
      let planId = null;
      let creditsTokens = 0;
      let amountCents = 0;
      if (kind === "plan") {
        const plan = await json(`SELECT COALESCE((SELECT row_to_json(p) FROM billing_plans p WHERE p.id = ${sqlString(String(req.body?.planId || ""))} AND p.active AND p.price_cents > 0), 'null'::json)::text;`);
        if (!plan) throw adminError("That paid plan is not available.");
        planId = plan.id;
        amountCents = Number(plan.price_cents);
      } else if (kind === "credits") {
        const pack = creditPack(String(req.body?.packId || ""));
        if (!pack) throw adminError("Choose an available credit pack.");
        creditsTokens = pack.creditsTokens;
        amountCents = pack.priceCents;
      } else throw adminError("Choose a plan or credit pack.");
      await billingSnapshot(user.id);
      const reference = `ayt_${crypto.randomBytes(12).toString("hex")}`;
      await runPsql(`INSERT INTO billing_orders (reference, user_id, kind, plan_id, credits_tokens, amount_cents, currency)
VALUES (${sqlString(reference)}, ${sqlString(user.id)}, ${sqlString(kind)}, ${planId ? sqlString(planId) : "NULL"}, ${creditsTokens}, ${amountCents}, 'USD');`);
      const origin = String(env.APP_PUBLIC_URL || "https://autoyt.cc").replace(/\/$/, "");
      const callback = new URL(origin);
      if (callback.protocol !== "https:") throw adminError("The payment return URL must use HTTPS.", 503);
      callback.searchParams.set("billing_reference", reference);
      const initialized = await paystack.initialize({ email: user.email, amount: amountCents, currency: "USD", reference, callback_url: callback.toString(), metadata: { user_id: user.id, kind, plan_id: planId || undefined } });
      if (!initialized?.authorization_url || initialized.reference !== reference) throw adminError("Paystack did not return a valid checkout link.", 502);
      if (new URL(initialized.authorization_url).origin !== "https://checkout.paystack.com") throw adminError("Paystack returned an unexpected checkout link.", 502);
      res.status(201).json({ reference, authorizationUrl: initialized.authorization_url });
    }));

    app.get("/api/billing/checkout/verify", userRoute(async (req, res, user) => {
      const reference = String(req.query.reference || "");
      if (!/^ayt_[a-f0-9]{24}$/.test(reference)) throw adminError("Invalid payment reference.");
      const order = await paymentOrder(reference);
      if (!order || order.userId !== user.id) throw adminError("Payment order not found.", 404);
      if (order.status === "pending") await settlePaystack(reference);
      res.json({ order: await paymentOrder(reference), billing: await billingSnapshot(user.id) });
    }));

    app.post("/api/billing/paystack/webhook", async (req, res) => {
      const secret = String(env.PAYSTACK_SECRET_KEY || "").trim();
      if (!validPaystackWebhook(req.rawBody, req.get("x-paystack-signature"), secret)) return res.sendStatus(401);
      if (req.body?.event !== "charge.success") return res.sendStatus(200);
      const reference = String(req.body?.data?.reference || "");
      if (!/^ayt_[a-f0-9]{24}$/.test(reference)) return res.sendStatus(200);
      try {
        await settlePaystack(reference);
        res.sendStatus(200);
      } catch (error) {
        console.warn("[billing] Paystack webhook settlement failed:", error instanceof Error ? error.message : error);
        res.sendStatus(503);
      }
    });

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
  'tokensAllTime', (SELECT COALESCE(SUM(tokens_charged), 0) FROM ai_usage_events WHERE user_id = ${sqlString(id)}),
  'costAllTime', (SELECT COALESCE(SUM(cost_usd), 0) FROM ai_usage_events WHERE user_id = ${sqlString(id)}),
  'calls30d', (SELECT count(*) FROM ai_usage_events WHERE user_id = ${sqlString(id)} AND created_at > now() - interval '30 days'),
  'lastAiAt', (SELECT MAX(created_at) FROM ai_usage_events WHERE user_id = ${sqlString(id)}),
  'uploads30d', (SELECT count(*) FROM automation_uploads WHERE user_id = ${sqlString(id)} AND created_at > now() - interval '30 days'),
  'views', (SELECT COALESCE(SUM(NULLIF(metrics->'publicStats'->>'viewCount', '')::bigint), 0) FROM automation_uploads WHERE user_id = ${sqlString(id)}),
  'likes', (SELECT COALESCE(SUM(NULLIF(metrics->'publicStats'->>'likeCount', '')::bigint), 0) FROM automation_uploads WHERE user_id = ${sqlString(id)}),
  'failedJobs7d', (SELECT count(*) FROM creator_stage_jobs WHERE user_id = ${sqlString(id)} AND status = 'failed' AND updated_at > now() - interval '7 days') + (SELECT count(*) FROM media_jobs WHERE user_id = ${sqlString(id)} AND status = 'failed' AND updated_at > now() - interval '7 days'),
  'styles', (SELECT count(*) FROM channel_styles WHERE user_id = ${sqlString(id)}),
  'playlists', (SELECT count(*) FROM saved_tiktok_playlists WHERE user_id = ${sqlString(id)}),
  'competitors', (SELECT count(*) FROM tracked_youtube_competitors WHERE user_id = ${sqlString(id)}),
  'openTickets', (SELECT count(*) FROM support_tickets WHERE user_id = ${sqlString(id)} AND status IN ('open', 'pending')),
  'adminActions', (SELECT count(*) FROM admin_audit_log WHERE target_type = 'user' AND target_id = ${sqlString(id)})
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

    // Everything one user has spent, over a chosen window.
    app.get("/api/admin/users/:id/usage", adminRoute("view", async (req, res) => {
      const id = sqlString(req.params.id);
      const provider = String(req.query.provider || "").trim();
      const providerClause = provider ? ` AND provider = ${sqlString(provider)}` : "";
      const window = `user_id = ${id} AND created_at > now() - interval '${days(req)} days'${providerClause}`;
      const [totals, allTime, series, byProvider, byModel, byOperation, byFeature] = await Promise.all([
        json(`SELECT json_build_object('tokens', COALESCE(SUM(tokens_charged), 0), 'cost', COALESCE(SUM(cost_usd), 0), 'calls', count(*),
  'inputTokens', COALESCE(SUM(input_tokens), 0), 'outputTokens', COALESCE(SUM(output_tokens), 0),
  'estimatedShare', COALESCE(AVG(CASE WHEN cost_estimated THEN 1 ELSE 0 END), 0),
  'activeDays', count(DISTINCT date_trunc('day', created_at)))::text FROM ai_usage_events WHERE ${window};`),
        json(`SELECT json_build_object('tokens', COALESCE(SUM(tokens_charged), 0), 'cost', COALESCE(SUM(cost_usd), 0), 'calls', count(*),
  'firstAt', MIN(created_at), 'lastAt', MAX(created_at))::text FROM ai_usage_events WHERE user_id = ${id}${providerClause};`),
        list(`
SELECT to_char(d, 'YYYY-MM-DD') AS day,
  COALESCE(SUM(e.tokens_charged), 0) AS tokens, COALESCE(SUM(e.cost_usd), 0) AS cost, count(e.id) AS calls
FROM generate_series(date_trunc('day', now()) - interval '${days(req) - 1} days', date_trunc('day', now()), interval '1 day') d
LEFT JOIN ai_usage_events e ON e.user_id = ${id} AND e.created_at >= d AND e.created_at < d + interval '1 day'${provider ? ` AND e.provider = ${sqlString(provider)}` : ""}
GROUP BY d ORDER BY d`),
        list(`SELECT provider, SUM(tokens_charged) AS tokens, SUM(cost_usd) AS cost, count(*) AS calls FROM ai_usage_events WHERE ${window} GROUP BY provider ORDER BY tokens DESC`),
        list(`SELECT provider, model, SUM(tokens_charged) AS tokens, SUM(cost_usd) AS cost, count(*) AS calls, SUM(input_tokens) AS "inputTokens", SUM(output_tokens) AS "outputTokens" FROM ai_usage_events WHERE ${window} GROUP BY provider, model ORDER BY tokens DESC LIMIT 20`),
        list(`SELECT operation, SUM(tokens_charged) AS tokens, SUM(cost_usd) AS cost, count(*) AS calls FROM ai_usage_events WHERE ${window} GROUP BY operation ORDER BY tokens DESC`),
        list(`SELECT feature, SUM(tokens_charged) AS tokens, SUM(cost_usd) AS cost, count(*) AS calls FROM ai_usage_events WHERE ${window} GROUP BY feature ORDER BY tokens DESC LIMIT 20`),
      ]);
      res.json({ days: days(req), provider: provider || null, totals, allTime, series, byProvider, byModel, byOperation, byFeature });
    }));

    // What the user has made: projects, jobs, automation, uploads and research.
    app.get("/api/admin/users/:id/content", adminRoute("view", async (req, res) => {
      const id = sqlString(req.params.id);
      const [projects, stageJobs, mediaJobs, agents, uploads, uploadsByDay, styles, playlists, competitors, research, chats] = await Promise.all([
        list(`SELECT id, title, stage, status, source_type AS "sourceType", archived_at AS "archivedAt", created_at AS "createdAt", updated_at AS "updatedAt" FROM creator_projects WHERE user_id = ${id} ORDER BY updated_at DESC LIMIT 60`),
        list(`SELECT j.id, j.stage, j.status, j.progress, left(j.error, 300) AS error, j.message, j.created_at AS "createdAt", j.updated_at AS "updatedAt", p.title AS "projectTitle" FROM creator_stage_jobs j LEFT JOIN creator_projects p ON p.id = j.project_id WHERE j.user_id = ${id} ORDER BY j.created_at DESC LIMIT 50`),
        list(`SELECT id::text AS id, kind, status, attempts, left(COALESCE(error, ''), 300) AS error, message, created_at AS "createdAt", finished_at AS "finishedAt" FROM media_jobs WHERE user_id = ${id} ORDER BY created_at DESC LIMIT 50`),
        list(`
SELECT a.id, a.name, a.status, a.source_type AS "sourceType", a.source_url AS "sourceUrl", a.last_run_at AS "lastRunAt", a.next_run_at AS "nextRunAt", a.created_at AS "createdAt",
  y.channel_title AS channel,
  (SELECT count(*) FROM automation_uploads u WHERE u.agent_id = a.id) AS uploads,
  (SELECT COALESCE(SUM(NULLIF(u.metrics->'publicStats'->>'viewCount', '')::bigint), 0) FROM automation_uploads u WHERE u.agent_id = a.id) AS views,
  (SELECT r.status FROM automation_runs r WHERE r.agent_id = a.id ORDER BY r.started_at DESC LIMIT 1) AS "lastRunStatus",
  (SELECT left(r.message, 200) FROM automation_runs r WHERE r.agent_id = a.id ORDER BY r.started_at DESC LIMIT 1) AS "lastRunMessage",
  (SELECT count(*) FROM automation_runs r WHERE r.agent_id = a.id AND r.status = 'failed' AND r.started_at > now() - interval '7 days') AS "failures7d"
FROM automation_agents a LEFT JOIN youtube_accounts y ON y.id = a.youtube_account_id WHERE a.user_id = ${id} ORDER BY a.updated_at DESC`),
        list(`
SELECT u.id, COALESCE(NULLIF(u.title, ''), u.movie_title) AS title, u.youtube_url AS url, u.status, u.genre, u.created_at AS "createdAt", u.schedule_at AS "scheduleAt",
  a.name AS agent, COALESCE(u.metrics->>'uploadVia', '') AS via,
  COALESCE(NULLIF(u.metrics->'publicStats'->>'viewCount', '')::bigint, 0) AS views,
  COALESCE(NULLIF(u.metrics->'publicStats'->>'likeCount', '')::bigint, 0) AS likes,
  COALESCE(NULLIF(u.metrics->'publicStats'->>'commentCount', '')::bigint, 0) AS comments
FROM automation_uploads u LEFT JOIN automation_agents a ON a.id = u.agent_id WHERE u.user_id = ${id} ORDER BY u.created_at DESC LIMIT 60`),
        list(`
SELECT to_char(d, 'YYYY-MM-DD') AS day, count(u.id) AS uploads
FROM generate_series(date_trunc('day', now()) - interval '29 days', date_trunc('day', now()), interval '1 day') d
LEFT JOIN automation_uploads u ON u.user_id = ${id} AND u.created_at >= d AND u.created_at < d + interval '1 day'
GROUP BY d ORDER BY d`),
        list(`SELECT id, name, niche, sub_niche AS "subNiche", status, source_url AS "sourceUrl", created_at AS "createdAt" FROM channel_styles WHERE user_id = ${id} ORDER BY updated_at DESC LIMIT 30`),
        list(`SELECT id, slug, analyzed_url AS url, saved_at AS "savedAt", COALESCE(jsonb_array_length(playlist->'videos'), 0) AS videos FROM saved_tiktok_playlists WHERE user_id = ${id} ORDER BY saved_at DESC LIMIT 30`),
        list(`SELECT id, channel_title AS title, channel_url AS url, niche, score, last_checked_at AS "lastCheckedAt" FROM tracked_youtube_competitors WHERE user_id = ${id} ORDER BY score DESC LIMIT 30`),
        list(`SELECT id, name, updated_at AS "updatedAt" FROM creator_research_collections WHERE user_id = ${id} ORDER BY updated_at DESC LIMIT 30`),
        json(`SELECT json_build_object('chats', count(*), 'messages', COALESCE(SUM(message_count), 0), 'lastAt', MAX(updated_at))::text FROM automation_agent_chats WHERE user_id = ${id};`),
      ]);
      const stats = uploads.reduce((sum, u) => ({ views: sum.views + Number(u.views), likes: sum.likes + Number(u.likes), comments: sum.comments + Number(u.comments) }), { views: 0, likes: 0, comments: 0 });
      res.json({ projects, stageJobs, mediaJobs, agents, uploads, uploadsByDay, styles, playlists, competitors, research, chats, recentUploadStats: stats });
    }));

    app.get("/api/admin/users/:id/sessions", adminRoute("view", async (req, res) => {
      res.json({ sessions: await list(`SELECT id, created_at AS "createdAt", updated_at AS "updatedAt", expires_at AS "expiresAt", active_youtube_account_id AS "activeAccountId", expires_at > now() AS active FROM app_sessions WHERE user_id = ${sqlString(req.params.id)} ORDER BY updated_at DESC LIMIT 50`) });
    }));
    app.post("/api/admin/users/:id/sessions/:sessionId/revoke", adminRoute("users.manage", async (req, res, admin) => {
      await runPsql(`DELETE FROM app_sessions WHERE id = ${sqlString(req.params.sessionId)} AND user_id = ${sqlString(req.params.id)};`);
      await audit(admin, "user.session_revoke", "user", req.params.id, { sessionId: String(req.params.sessionId).slice(0, 12) }, req);
      res.json({ ok: true });
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
      const tokens = req.body?.credits !== undefined ? creditsToTokens(req.body.credits) : int(req.body?.tokens);
      const note = String(req.body?.note || "").trim().slice(0, 300);
      if (!note) throw adminError("Add a note so the ledger explains this change.");
      if (Math.abs(tokens) > 1000000000) throw adminError("That amount is too large.");
      const result = await adjustTokens(req.params.id, tokens, { kind: tokens > 0 ? "grant" : "revoke", actor: admin.email, note });
      await audit(admin, tokens > 0 ? "billing.grant_credits" : "billing.revoke_credits", "user", req.params.id, { credits: tokensToCredits(tokens), tokens, note }, req);
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
      const billing = await getSettings("billing");
      const [plans, usage] = await Promise.all([list(`
SELECT p.id, p.name, p.description, p.price_cents AS "priceCents", p.currency, p.monthly_tokens AS "monthlyTokens", p.features, p.is_default AS "isDefault", p.active, p.sort,
  p.price_mode AS "priceMode", p.margin_percent AS "marginPercent",
  (SELECT count(*) FROM billing_accounts a WHERE a.plan_id = p.id) AS subscribers
FROM billing_plans p ORDER BY p.sort, p.price_cents`), list(`
SELECT a.plan_id AS "planId", COALESCE(SUM(e.cost_usd), 0) AS "providerCostUsd",
  count(*) AS calls, count(*) FILTER (WHERE e.cost_estimated) AS "estimatedCalls"
FROM ai_usage_events e JOIN billing_accounts a ON a.user_id = e.user_id
WHERE e.created_at >= now() - interval '30 days'
GROUP BY a.plan_id`) ]);
      const byPlan = new Map(usage.map((row) => [row.planId, row]));
      res.json({ plans: plans.map((p) => ({ ...p, economics: planEconomics(p, billing), usage30d: byPlan.get(p.id) || { providerCostUsd: 0, calls: 0, estimatedCalls: 0 } })) });
    }));
    app.post("/api/admin/billing/plans", adminRoute("billing.manage", async (req, res, admin) => {
      const body = req.body || {};
      const id = String(body.id || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
      const name = String(body.name || "").trim().slice(0, 60);
      if (!id || !name) throw adminError("A plan needs an id and a name.");
      const features = (Array.isArray(body.features) ? body.features : String(body.features || "").split("\n")).map((f) => String(f).trim()).filter(Boolean).slice(0, 12);
      if (["new", "prices"].includes(id)) throw adminError(`"${id}" is reserved. Pick another plan id.`);
      const isDefault = Boolean(body.isDefault);
      const priceMode = body.priceMode === "manual" ? "manual" : "auto";
      const margin = body.marginPercent === null || body.marginPercent === undefined || body.marginPercent === "" ? null : Math.min(1000, Math.max(0, Number(body.marginPercent) || 0));
      const monthlyTokens = body.monthlyCredits !== undefined ? creditsToTokens(body.monthlyCredits) : Math.max(0, int(body.monthlyTokens));
      const priceCents = priceMode === "auto" ? planPrice(monthlyTokens, await getSettings("billing"), margin).priceCents : Math.max(0, int(body.priceCents));
      await runPsql(`
${isDefault ? `UPDATE billing_plans SET is_default = false WHERE id <> ${sqlString(id)};` : ""}
INSERT INTO billing_plans (id, name, description, price_cents, monthly_tokens, features, is_default, active, sort, price_mode, margin_percent, updated_at)
VALUES (${sqlString(id)}, ${sqlString(name)}, ${sqlString(String(body.description || "").slice(0, 200))}, ${priceCents}, ${monthlyTokens},
  ${jsonbLiteral(features)}, ${isDefault}, ${body.active !== false}, ${int(body.sort)}, ${sqlString(priceMode)}, ${margin === null ? "NULL" : margin}, now())
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, price_cents = EXCLUDED.price_cents, monthly_tokens = EXCLUDED.monthly_tokens,
  features = EXCLUDED.features, is_default = EXCLUDED.is_default, active = EXCLUDED.active, sort = EXCLUDED.sort,
  price_mode = EXCLUDED.price_mode, margin_percent = EXCLUDED.margin_percent, updated_at = now();`);
      const defaults = Number(await runPsql(`SELECT count(*) FROM billing_plans WHERE is_default AND active;`)) || 0;
      if (!defaults) throw adminError("Saved, but no active plan is the default for new users. Mark one as default.", 409);
      await audit(admin, "billing.save_plan", "plan", id, { name, priceMode, priceCents, marginPercent: margin, monthlyCredits: tokensToCredits(monthlyTokens), monthlyTokens, active: body.active !== false, isDefault }, req);
      res.json({ ok: true, priceCents });
    }));
    app.get("/api/admin/billing/ledger", adminRoute("view", async (req, res) => {
      const { limit, offset } = paging(req);
      const kind = String(req.query.kind || "");
      const where = [kind ? `l.kind = ${sqlString(kind)}` : "", req.query.userId ? `l.user_id = ${sqlString(req.query.userId)}` : ""].filter(Boolean).join(" AND ") || "true";
      res.json({ entries: await list(`
SELECT l.id, l.user_id AS "userId", u.email, u.name, l.kind, l.tokens, l.balance_after AS "balanceAfter", l.actor, l.note, l.created_at AS "createdAt"
FROM token_ledger l JOIN app_users u ON u.id = l.user_id WHERE ${where} ORDER BY l.created_at DESC LIMIT ${limit} OFFSET ${offset}`) });
    }));
    app.get("/api/admin/billing/orders", adminRoute("view", async (req, res) => {
      if (!await paymentSchemaReady()) return res.json({ orders: [] });
      const { limit, offset } = paging(req);
      const status = ["pending", "paid", "failed", "refunded"].includes(req.query.status) ? String(req.query.status) : "";
      res.json({ orders: await list(`
SELECT b.reference, b.user_id AS "userId", u.email, u.name, b.kind, p.name AS "planName",
  b.credits_tokens AS "creditsTokens", b.amount_cents AS "amountCents", b.currency, b.status,
  b.created_at AS "createdAt", b.paid_at AS "paidAt"
FROM billing_orders b JOIN app_users u ON u.id = b.user_id LEFT JOIN billing_plans p ON p.id = b.plan_id
WHERE ${status ? `b.status = ${sqlString(status)}` : "true"}
ORDER BY b.created_at DESC LIMIT ${limit} OFFSET ${offset}`) });
    }));
    app.get("/api/admin/billing/summary", adminRoute("view", async (_req, res) => {
      const ordersReady = await paymentSchemaReady();
      res.json(await json(`SELECT json_build_object(
  'byPlan', COALESCE((SELECT json_agg(x ORDER BY x.sort) FROM (SELECT p.id, p.name, p.sort, p.price_cents AS "priceCents", count(a.user_id) AS subscribers, COALESCE(SUM(p.price_cents) FILTER (WHERE a.status = 'active'), 0) AS "mrrCents" FROM billing_plans p LEFT JOIN billing_accounts a ON a.plan_id = p.id GROUP BY p.id) x), '[]'::json),
  'collected30dCents', ${ordersReady ? "(SELECT COALESCE(SUM(amount_cents), 0) FROM billing_orders WHERE status = 'paid' AND paid_at > now() - interval '30 days')" : "0"},
  'payments30d', ${ordersReady ? "(SELECT count(*) FROM billing_orders WHERE status = 'paid' AND paid_at > now() - interval '30 days')" : "0"},
  'providerCost30dUsd', (SELECT COALESCE(SUM(cost_usd), 0) FROM ai_usage_events WHERE created_at > now() - interval '30 days'),
  'estimatedProviderCost30dUsd', (SELECT COALESCE(SUM(cost_usd), 0) FROM ai_usage_events WHERE cost_estimated AND created_at > now() - interval '30 days'),
  'granted30d', (SELECT COALESCE(SUM(tokens), 0) FROM token_ledger WHERE kind = 'grant' AND created_at > now() - interval '30 days'),
  'unlimitedAccounts', (SELECT count(*) FROM billing_accounts WHERE unlimited),
  'outOfTokens', (SELECT count(*) FROM billing_accounts WHERE NOT unlimited AND GREATEST(allowance_remaining, 0) + bonus_balance <= 0),
  'pastDue', (SELECT count(*) FROM billing_accounts WHERE status = 'past_due')
)::text;`));
    }));

    // ----- admin: usage -----
    app.get("/api/admin/usage", adminRoute("view", async (req, res) => {
      const provider = String(req.query.provider || "").trim();
      const providerClause = provider ? ` AND provider = ${sqlString(provider)}` : "";
      const window = `created_at > now() - interval '${days(req)} days'${providerClause}`;
      const [totals, series, byProvider, byModel, byFeature, topUsers] = await Promise.all([
        json(`SELECT json_build_object('tokens', COALESCE(SUM(tokens_charged), 0), 'cost', COALESCE(SUM(cost_usd), 0), 'calls', count(*),
  'inputTokens', COALESCE(SUM(input_tokens), 0), 'outputTokens', COALESCE(SUM(output_tokens), 0),
  'unattributedCost', COALESCE(SUM(cost_usd) FILTER (WHERE user_id IS NULL), 0),
  'estimatedShare', COALESCE(AVG(CASE WHEN cost_estimated THEN 1 ELSE 0 END), 0),
  'users', count(DISTINCT user_id))::text FROM ai_usage_events WHERE ${window};`),
        list(`
SELECT to_char(d, 'YYYY-MM-DD') AS day,
  COALESCE((SELECT SUM(tokens_charged) FROM ai_usage_events WHERE created_at >= d AND created_at < d + interval '1 day'${providerClause}), 0) AS tokens,
  COALESCE((SELECT SUM(cost_usd) FROM ai_usage_events WHERE created_at >= d AND created_at < d + interval '1 day'${providerClause}), 0) AS cost,
  (SELECT count(*) FROM ai_usage_events WHERE created_at >= d AND created_at < d + interval '1 day'${providerClause}) AS calls
FROM generate_series(date_trunc('day', now()) - interval '${days(req) - 1} days', date_trunc('day', now()), interval '1 day') d ORDER BY d`),
        list(`SELECT provider, SUM(tokens_charged) AS tokens, SUM(cost_usd) AS cost, count(*) AS calls FROM ai_usage_events WHERE ${window} GROUP BY provider ORDER BY cost DESC`),
        list(`SELECT provider, model, operation, SUM(tokens_charged) AS tokens, SUM(cost_usd) AS cost, count(*) AS calls, SUM(input_tokens) AS "inputTokens", SUM(output_tokens) AS "outputTokens" FROM ai_usage_events WHERE ${window} GROUP BY provider, model, operation ORDER BY cost DESC LIMIT 15`),
        list(`SELECT feature, SUM(tokens_charged) AS tokens, SUM(cost_usd) AS cost, count(*) AS calls FROM ai_usage_events WHERE ${window} GROUP BY feature ORDER BY cost DESC LIMIT 15`),
        list(`SELECT u.id, u.email, u.name, u.avatar_url AS "avatarUrl", SUM(e.tokens_charged) AS tokens, SUM(e.cost_usd) AS cost, count(*) AS calls FROM ai_usage_events e JOIN app_users u ON u.id = e.user_id WHERE e.${window} GROUP BY u.id ORDER BY tokens DESC LIMIT 10`),
      ]);
      res.json({ days: days(req), provider: provider || null, totals, series, byProvider, byModel, byFeature, topUsers });
    }));
    app.get("/api/admin/usage/events", adminRoute("view", async (req, res) => {
      const { limit, offset } = paging(req);
      const where = [
        req.query.userId ? `e.user_id = ${sqlString(req.query.userId)}` : "",
        req.query.provider ? `e.provider = ${sqlString(req.query.provider)}` : "",
        req.query.model ? `e.model = ${sqlString(req.query.model)}` : "",
        req.query.feature ? `e.feature = ${sqlString(req.query.feature)}` : "",
        req.query.operation ? `e.operation = ${sqlString(req.query.operation)}` : "",
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
      const uid = sqlString(ticket.user.id);
      // What support needs at a glance: plan, balance, recent spend, recent failures, history.
      const [billing, context, failures, otherTickets] = await Promise.all([
        billingSnapshot(ticket.user.id).catch(() => null),
        json(`SELECT json_build_object(
  'tokens7d', (SELECT COALESCE(SUM(tokens_charged), 0) FROM ai_usage_events WHERE user_id = ${uid} AND created_at > now() - interval '7 days'),
  'calls7d', (SELECT count(*) FROM ai_usage_events WHERE user_id = ${uid} AND created_at > now() - interval '7 days'),
  'uploads7d', (SELECT count(*) FROM automation_uploads WHERE user_id = ${uid} AND created_at > now() - interval '7 days'),
  'activeAgents', (SELECT count(*) FROM automation_agents WHERE user_id = ${uid} AND status = 'active'),
  'lastSeenAt', (SELECT last_seen_at FROM app_users WHERE id = ${uid}),
  'joinedAt', (SELECT created_at FROM app_users WHERE id = ${uid}),
  'status', (SELECT status FROM app_users WHERE id = ${uid})
)::text;`),
        list(`(SELECT 'job' AS type, id, stage AS kind, left(error, 200) AS error, updated_at AS "at" FROM creator_stage_jobs WHERE user_id = ${uid} AND status = 'failed' ORDER BY updated_at DESC LIMIT 5)
UNION ALL (SELECT 'media', id::text, kind, left(COALESCE(error, ''), 200), updated_at FROM media_jobs WHERE user_id = ${uid} AND status = 'failed' ORDER BY updated_at DESC LIMIT 5)`),
        list(`SELECT id, subject, status, last_message_at AS "lastMessageAt" FROM support_tickets WHERE user_id = ${uid} AND id <> ${sqlString(ticket.id)} ORDER BY last_message_at DESC LIMIT 8`),
      ]);
      res.json({ ticket, context: { billing, ...context, failures: failures.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 6), otherTickets } });
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
      const [governance, billing, support] = await Promise.all([getSettings("governance"), getSettings("billing"), getSettings("support")]);
      res.json({ governance, billing, support, providers: PROVIDERS });
    }));
    app.put("/api/admin/settings/:key", adminRoute("settings.manage", async (req, res, admin) => {
      const key = String(req.params.key);
      const before = await getSettings(key);
      const saved = await saveSettings(key, req.body || {}, admin.email);
      const changed = Object.keys(saved).filter((k) => JSON.stringify(saved[k]) !== JSON.stringify(before[k]));
      // Token value, margin or rounding changes reprice every auto-priced plan.
      const repriced = key === "billing" ? await recalcAutoPlans() : [];
      await audit(admin, `settings.${key}`, "settings", key, { changed, after: Object.fromEntries(changed.map((k) => [k, saved[k]])), repriced }, req);
      res.json({ [key]: saved, repriced });
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
      if (!["admin", "support", "viewer"].includes(role)) throw adminError("Pick admin, support or viewer. Super admins are set with ADMIN_EMAILS.");
      if (owners().has(email)) throw adminError("That person is already a super admin.", 409);
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

    // ----- admin: provider prices -----
    // Every model users have called, what it really cost, and the price we charge for it.
    app.get("/api/admin/billing/provider-prices", adminRoute("view", async (_req, res) => {
      const billing = await getSettings("billing");
      const seen = await list(`
SELECT provider, model, count(*) AS calls,
  SUM(input_tokens) AS "inputTokens", SUM(output_tokens) AS "outputTokens", SUM(cost_usd) AS cost,
  SUM(cost_usd) FILTER (WHERE NOT cost_estimated) AS "reportedCost",
  SUM(input_tokens) FILTER (WHERE NOT cost_estimated) AS "reportedIn", SUM(output_tokens) FILTER (WHERE NOT cost_estimated) AS "reportedOut",
  count(*) FILTER (WHERE NOT cost_estimated) AS "reportedCalls", MAX(created_at) AS "lastAt"
FROM ai_usage_events WHERE created_at > now() - interval '90 days' GROUP BY provider, model ORDER BY cost DESC LIMIT 200`);
      const models = new Map(seen.map((r) => [r.model, r]));
      for (const model of Object.keys(billing.modelPrices || {})) if (!models.has(model)) models.set(model, { provider: "", model, calls: 0 });
      const rows = await Promise.all([...models.values()].map(async (row) => {
        const hit = catalog && row.model ? await catalog.lookup(row.model).catch(() => null) : null;
        return {
          ...row,
          catalog: hit ? { id: hit.id, inputPer1M: hit.inputPer1M, outputPer1M: hit.outputPer1M, perCall: hit.perCall } : null,
          override: billing.modelPrices?.[row.model] || null,
          multiplier: billing.modelMultipliers?.[row.model] ?? 1,
          effective: resolveModelRate(row.model, billing.modelPrices, hit),
        };
      }));
      res.json({ models: rows, catalog: catalog?.status() || null, fallback: { inputPer1M: billing.inputUsdPer1M, outputPer1M: billing.outputUsdPer1M }, tokensPerUsd: billing.tokensPerUsd });
    }));
    app.post("/api/admin/billing/provider-prices/refresh", adminRoute("settings.manage", async (_req, res) => {
      if (!catalog) throw adminError("The price list is turned off on this server.");
      await catalog.load(true);
      res.json({ catalog: catalog.status() });
    }));

    // ----- admin: plan pages -----
    app.get("/api/admin/billing/plans/:id", adminRoute("view", async (req, res) => {
      const id = sqlString(req.params.id);
      const plan = await json(`SELECT COALESCE((SELECT json_build_object('id', id, 'name', name, 'description', description, 'priceCents', price_cents, 'monthlyTokens', monthly_tokens,
  'features', features, 'isDefault', is_default, 'active', active, 'sort', sort, 'createdAt', created_at, 'updatedAt', updated_at,
  'priceMode', price_mode, 'marginPercent', margin_percent) FROM billing_plans WHERE id = ${id}), 'null'::json)::text;`);
      if (!plan) throw adminError("Plan not found.", 404);
      plan.economics = planEconomics(plan, await getSettings("billing"));
      const members = `SELECT user_id FROM billing_accounts WHERE plan_id = ${id}`;
      const [stats, series, topUsers, changes] = await Promise.all([
        json(`SELECT json_build_object(
  'subscribers', (SELECT count(*) FROM billing_accounts WHERE plan_id = ${id}),
  'active', (SELECT count(*) FROM billing_accounts WHERE plan_id = ${id} AND status = 'active'),
  'pastDue', (SELECT count(*) FROM billing_accounts WHERE plan_id = ${id} AND status = 'past_due'),
  'canceled', (SELECT count(*) FROM billing_accounts WHERE plan_id = ${id} AND status = 'canceled'),
  'unlimited', (SELECT count(*) FROM billing_accounts WHERE plan_id = ${id} AND unlimited),
  'outOfTokens', (SELECT count(*) FROM billing_accounts WHERE plan_id = ${id} AND NOT unlimited AND GREATEST(allowance_remaining, 0) + bonus_balance <= 0),
  'tokens30d', (SELECT COALESCE(SUM(tokens_charged), 0) FROM ai_usage_events WHERE user_id IN (${members}) AND created_at > now() - interval '30 days'),
  'cost30d', (SELECT COALESCE(SUM(cost_usd), 0) FROM ai_usage_events WHERE user_id IN (${members}) AND created_at > now() - interval '30 days'),
  'activeUsers30d', (SELECT count(DISTINCT user_id) FROM ai_usage_events WHERE user_id IN (${members}) AND created_at > now() - interval '30 days'),
  'joined30d', (SELECT count(*) FROM token_ledger WHERE kind = 'plan_change' AND reference = ${id} AND created_at > now() - interval '30 days')
)::text;`),
        list(`
SELECT to_char(d, 'YYYY-MM-DD') AS day, COALESCE(SUM(e.tokens_charged), 0) AS tokens, COALESCE(SUM(e.cost_usd), 0) AS cost
FROM generate_series(date_trunc('day', now()) - interval '29 days', date_trunc('day', now()), interval '1 day') d
LEFT JOIN ai_usage_events e ON e.user_id IN (${members}) AND e.created_at >= d AND e.created_at < d + interval '1 day'
GROUP BY d ORDER BY d`),
        list(`SELECT u.id, u.email, u.name, u.avatar_url AS "avatarUrl", SUM(e.tokens_charged) AS tokens, SUM(e.cost_usd) AS cost FROM ai_usage_events e JOIN app_users u ON u.id = e.user_id WHERE e.user_id IN (${members}) AND e.created_at > now() - interval '30 days' GROUP BY u.id ORDER BY tokens DESC LIMIT 8`),
        list(`SELECT l.id, l.user_id AS "userId", u.email, u.name, l.actor, l.note, l.created_at AS "createdAt" FROM token_ledger l JOIN app_users u ON u.id = l.user_id WHERE l.kind = 'plan_change' AND l.reference = ${id} ORDER BY l.created_at DESC LIMIT 15`),
      ]);
      res.json({ plan, stats, series, topUsers, changes });
    }));
    app.get("/api/admin/billing/plans/:id/subscribers", adminRoute("view", async (req, res) => {
      const { limit, offset } = paging(req);
      const status = ["active", "past_due", "canceled"].includes(req.query.status) ? `AND a.status = ${sqlString(req.query.status)}` : "";
      const filter = req.query.filter === "out" ? "AND NOT a.unlimited AND GREATEST(a.allowance_remaining, 0) + a.bonus_balance <= 0" : req.query.filter === "unlimited" ? "AND a.unlimited" : "";
      res.json({ subscribers: await list(`
SELECT u.id, u.email, u.name, u.avatar_url AS "avatarUrl", u.status AS "userStatus", a.status, a.unlimited, a.period_end AS "periodEnd",
  GREATEST(a.allowance_remaining, 0) + a.bonus_balance AS balance, u.last_seen_at AS "lastSeenAt",
  COALESCE((SELECT SUM(tokens_charged) FROM ai_usage_events e WHERE e.user_id = u.id AND e.created_at >= a.period_start), 0) AS "periodUsed"
FROM billing_accounts a JOIN app_users u ON u.id = a.user_id
WHERE a.plan_id = ${sqlString(req.params.id)} ${status} ${filter} ORDER BY u.last_seen_at DESC NULLS LAST LIMIT ${limit} OFFSET ${offset}`) });
    }));
    // Acts on every account on the plan: grant tokens, or move them to another plan.
    app.post("/api/admin/billing/plans/:id/bulk", adminRoute("billing.manage", async (req, res, admin) => {
      const id = sqlString(req.params.id);
      const action = String(req.body?.action || "");
      const note = String(req.body?.note || "").trim().slice(0, 300);
      if (!note) throw adminError("Add a note; it goes in every affected ledger entry.");
      let affected = 0;
      let tokens = 0;
      if (action === "grant") {
        tokens = req.body?.credits !== undefined ? creditsToTokens(req.body.credits) : int(req.body?.tokens);
        if (!tokens || Math.abs(tokens) > 1000000000) throw adminError("Enter a credit amount.");
        affected = Number(await runPsql(`
WITH upd AS (
  UPDATE billing_accounts SET bonus_balance = bonus_balance + ${tokens}, updated_at = now() WHERE plan_id = ${id}
  RETURNING user_id, GREATEST(allowance_remaining, 0) + bonus_balance AS balance
), led AS (
  INSERT INTO token_ledger (user_id, kind, tokens, balance_after, actor, note, reference)
  SELECT user_id, ${tokens > 0 ? "'grant'" : "'revoke'"}, ${tokens}, balance, ${sqlString(admin.email)}, ${sqlString(note)}, ${id} FROM upd RETURNING 1
) SELECT count(*) FROM led;`)) || 0;
      } else if (action === "move") {
        const target = await json(`SELECT COALESCE((SELECT row_to_json(p) FROM billing_plans p WHERE id = ${sqlString(req.body?.toPlanId)}), 'null'::json)::text;`);
        if (!target) throw adminError("Pick the plan to move them to.", 404);
        if (target.id === req.params.id) throw adminError("They're already on that plan.");
        affected = Number(await runPsql(`
WITH upd AS (
  UPDATE billing_accounts SET plan_id = ${sqlString(target.id)}, allowance_remaining = ${int(target.monthly_tokens)}, period_start = now(), period_end = now() + interval '1 month', updated_at = now()
  WHERE plan_id = ${id} RETURNING user_id, GREATEST(allowance_remaining, 0) + bonus_balance AS balance
), led AS (
  INSERT INTO token_ledger (user_id, kind, tokens, balance_after, actor, note, reference)
  SELECT user_id, 'plan_change', ${int(target.monthly_tokens)}, balance, ${sqlString(admin.email)}, ${sqlString(`Plan set to ${target.name}: ${note}`)}, ${sqlString(target.id)} FROM upd RETURNING 1
) SELECT count(*) FROM led;`)) || 0;
      } else throw adminError("Unknown bulk action.");
      cache.users.clear();
      await audit(admin, `billing.bulk_${action}`, "plan", req.params.id, { affected, note, credits: req.body?.credits, tokens, toPlanId: req.body?.toPlanId }, req);
      res.json({ ok: true, affected });
    }));

    // ----- admin: usage breakdown for one provider, model or feature -----
    app.get("/api/admin/usage/breakdown", adminRoute("view", async (req, res) => {
      const dims = { provider: "provider", model: "model", feature: "feature", operation: "operation" };
      const column = dims[req.query.dim];
      if (!column) throw adminError("Pick provider, model, feature or operation.");
      const value = String(req.query.value || "");
      const where = `${column} = ${sqlString(value)} AND created_at > now() - interval '${days(req)} days'`;
      const [totals, series, byModel, byFeature, byUser, byProvider, byOperation] = await Promise.all([
        json(`SELECT json_build_object('tokens', COALESCE(SUM(tokens_charged), 0), 'cost', COALESCE(SUM(cost_usd), 0), 'calls', count(*),
  'inputTokens', COALESCE(SUM(input_tokens), 0), 'outputTokens', COALESCE(SUM(output_tokens), 0), 'users', count(DISTINCT user_id),
  'estimatedShare', COALESCE(AVG(CASE WHEN cost_estimated THEN 1 ELSE 0 END), 0), 'avgCost', COALESCE(AVG(cost_usd), 0),
  'firstAt', MIN(created_at), 'lastAt', MAX(created_at))::text FROM ai_usage_events WHERE ${where};`),
        list(`
SELECT to_char(d, 'YYYY-MM-DD') AS day, COALESCE(SUM(e.tokens_charged), 0) AS tokens, COALESCE(SUM(e.cost_usd), 0) AS cost, count(e.id) AS calls
FROM generate_series(date_trunc('day', now()) - interval '${days(req) - 1} days', date_trunc('day', now()), interval '1 day') d
LEFT JOIN ai_usage_events e ON e.${column} = ${sqlString(value)} AND e.created_at >= d AND e.created_at < d + interval '1 day'
GROUP BY d ORDER BY d`),
        list(`SELECT provider, model, SUM(tokens_charged) AS tokens, SUM(cost_usd) AS cost, count(*) AS calls FROM ai_usage_events WHERE ${where} GROUP BY provider, model ORDER BY cost DESC LIMIT 15`),
        list(`SELECT feature, SUM(tokens_charged) AS tokens, SUM(cost_usd) AS cost, count(*) AS calls FROM ai_usage_events WHERE ${where} GROUP BY feature ORDER BY cost DESC LIMIT 15`),
        list(`SELECT u.id, u.email, u.name, u.avatar_url AS "avatarUrl", SUM(e.tokens_charged) AS tokens, SUM(e.cost_usd) AS cost, count(*) AS calls FROM ai_usage_events e JOIN app_users u ON u.id = e.user_id WHERE e.${column} = ${sqlString(value)} AND e.created_at > now() - interval '${days(req)} days' GROUP BY u.id ORDER BY tokens DESC LIMIT 15`),
        list(`SELECT provider, SUM(tokens_charged) AS tokens, SUM(cost_usd) AS cost, count(*) AS calls FROM ai_usage_events WHERE ${where} GROUP BY provider ORDER BY cost DESC`),
        list(`SELECT operation, SUM(tokens_charged) AS tokens, SUM(cost_usd) AS cost, count(*) AS calls FROM ai_usage_events WHERE ${where} GROUP BY operation ORDER BY cost DESC`),
      ]);
      res.json({ dim: req.query.dim, value, days: days(req), totals, series, byModel, byFeature, byUser, byProvider, byOperation });
    }));

    // ----- admin: one activity item, with its full record -----
    const ACTIVITY_TABLES = {
      upload: { table: "automation_uploads", key: "id" },
      automation: { table: "automation_runs", key: "id" },
      project: { table: "creator_projects", key: "id" },
      job: { table: "creator_stage_jobs", key: "id" },
      media: { table: "media_jobs", key: "id::text" },
      ticket: { table: "support_tickets", key: "id" },
    };
    app.get("/api/admin/activity/:type/:ref", adminRoute("view", async (req, res) => {
      const source = ACTIVITY_TABLES[req.params.type];
      if (!source) throw adminError("Unknown activity type.", 404);
      // Large JSON (transcripts, generated outputs) is cut so the page stays fast.
      const row = await json(`SELECT COALESCE((SELECT to_jsonb(t) FROM ${source.table} t WHERE ${source.key} = ${sqlString(req.params.ref)} LIMIT 1), 'null'::jsonb)::text;`);
      if (!row) throw adminError("That item no longer exists.", 404);
      let userId = row.user_id || "";
      let agent = null;
      if (req.params.type === "automation") {
        agent = await json(`SELECT COALESCE((SELECT json_build_object('id', id, 'name', name, 'status', status, 'userId', user_id) FROM automation_agents WHERE id = ${sqlString(row.agent_id)}), 'null'::json)::text;`);
        userId = agent?.userId || "";
      } else if (req.params.type === "upload" && row.agent_id) {
        agent = await json(`SELECT COALESCE((SELECT json_build_object('id', id, 'name', name, 'status', status) FROM automation_agents WHERE id = ${sqlString(row.agent_id)}), 'null'::json)::text;`);
      }
      const user = userId ? await json(`SELECT COALESCE((SELECT json_build_object('id', id, 'email', email, 'name', name, 'avatarUrl', avatar_url) FROM app_users WHERE id = ${sqlString(userId)}), 'null'::json)::text;`) : null;
      const trim = (value, depth = 0) => {
        if (typeof value === "string") return value.length > 4000 ? `${value.slice(0, 4000)}… (${value.length - 4000} more characters)` : value;
        if (Array.isArray(value)) return value.length > 60 ? [...value.slice(0, 60).map((v) => trim(v, depth + 1)), `… ${value.length - 60} more items`] : value.map((v) => trim(v, depth + 1));
        if (value && typeof value === "object") return depth > 6 ? "{…}" : Object.fromEntries(Object.entries(value).map(([k, v]) => [k, /token|secret|api_key|password/i.test(k) ? "[hidden]" : trim(v, depth + 1)]));
        return value;
      };
      res.json({ type: req.params.type, ref: req.params.ref, record: trim(row), user, agent });
    }));
    app.post("/api/admin/jobs/:id/retry", adminRoute("users.manage", async (req, res, admin) => {
      const count = await runPsql(`WITH r AS (UPDATE media_jobs SET status = 'queued', attempts = 0, error = NULL, leased_until = NULL, worker_id = NULL, finished_at = NULL, progress = 0, message = 'Retried by an admin', updated_at = now()
WHERE id::text = ${sqlString(req.params.id)} AND status IN ('failed', 'cancelled') RETURNING 1) SELECT count(*) FROM r;`);
      if (!Number(count)) throw adminError("Only failed or cancelled jobs can be retried.", 409);
      await audit(admin, "job.retry", "media_job", req.params.id, {}, req);
      res.json({ ok: true });
    }));
    app.post("/api/admin/creator-jobs/:id/:action", adminRoute("users.manage", async (req, res, admin) => {
      const action = req.params.action;
      let sql;
      if (action === "retry") sql = `UPDATE creator_stage_jobs SET status = 'queued', error = '', progress = 0, message = 'Retried by an admin', updated_at = now() WHERE id = ${sqlString(req.params.id)} AND status = 'failed' RETURNING 1`;
      // The worker's heartbeat sees the status change and aborts the run.
      else if (action === "cancel") sql = `UPDATE creator_stage_jobs SET status = 'failed', error = 'Cancelled by an admin', updated_at = now() WHERE id = ${sqlString(req.params.id)} AND status IN ('queued', 'running') RETURNING 1`;
      else throw adminError("Unknown action.", 404);
      let count;
      try {
        count = await runPsql(`WITH r AS (${sql}) SELECT count(*) FROM r;`);
      } catch (error) {
        if (/duplicate key|unique/i.test(String(error?.message))) throw adminError("That stage is already running again for this project.", 409);
        throw error;
      }
      if (!Number(count)) throw adminError(action === "retry" ? "Only failed jobs can be retried." : "That job isn't queued or running.", 409);
      await audit(admin, `creator_job.${action}`, "creator_job", req.params.id, {}, req);
      res.json({ ok: true });
    }));

    // ----- admin: job queues -----
    app.get("/api/admin/queues/:queue", adminRoute("view", async (req, res) => {
      const { limit, offset } = paging(req);
      const status = String(req.query.status || "");
      const kind = String(req.query.kind || "");
      if (req.params.queue === "media") {
        const where = [kind ? `m.kind = ${sqlString(kind)}` : "", status ? `m.status = ${sqlString(status)}` : ""].filter(Boolean).join(" AND ") || "true";
        const [jobs, counts] = await Promise.all([
          list(`SELECT m.id::text AS id, m.kind, m.status, m.attempts, m.max_attempts AS "maxAttempts", left(COALESCE(m.error, ''), 300) AS error, m.message, m.progress, m.worker_id AS "workerId",
  m.created_at AS "createdAt", m.started_at AS "startedAt", m.finished_at AS "finishedAt", u.id AS "userId", u.email, u.name
FROM media_jobs m LEFT JOIN app_users u ON u.id = m.user_id WHERE ${where} ORDER BY m.created_at DESC LIMIT ${limit} OFFSET ${offset}`),
          json(`SELECT COALESCE(json_object_agg(status, n), '{}'::json)::text FROM (SELECT status, count(*) AS n FROM media_jobs WHERE ${kind ? `kind = ${sqlString(kind)}` : "true"} GROUP BY status) s;`, {}),
        ]);
        return res.json({ queue: "media", jobs, counts });
      }
      if (req.params.queue === "creator") {
        const where = [kind ? `j.stage = ${sqlString(kind)}` : "", status ? `j.status = ${sqlString(status)}` : ""].filter(Boolean).join(" AND ") || "true";
        const [jobs, counts] = await Promise.all([
          list(`SELECT j.id, j.stage AS kind, j.status, j.progress, left(j.error, 300) AS error, j.message, j.created_at AS "createdAt", j.updated_at AS "updatedAt",
  p.title AS "projectTitle", u.id AS "userId", u.email, u.name
FROM creator_stage_jobs j LEFT JOIN app_users u ON u.id = j.user_id LEFT JOIN creator_projects p ON p.id = j.project_id WHERE ${where} ORDER BY j.created_at DESC LIMIT ${limit} OFFSET ${offset}`),
          json(`SELECT COALESCE(json_object_agg(status, n), '{}'::json)::text FROM (SELECT status, count(*) AS n FROM creator_stage_jobs WHERE ${kind ? `stage = ${sqlString(kind)}` : "true"} GROUP BY status) s;`, {}),
        ]);
        return res.json({ queue: "creator", jobs, counts });
      }
      throw adminError("Unknown queue.", 404);
    }));
    app.post("/api/admin/queues/:queue/bulk", adminRoute("users.manage", async (req, res, admin) => {
      const action = String(req.body?.action || "");
      const kind = String(req.body?.kind || "");
      const table = req.params.queue === "media" ? "media_jobs" : req.params.queue === "creator" ? "creator_stage_jobs" : "";
      if (!table) throw adminError("Unknown queue.", 404);
      const kindCol = table === "media_jobs" ? "kind" : "stage";
      const kindFilter = kind ? `AND ${kindCol} = ${sqlString(kind)}` : "";
      let sql;
      if (action === "retry_failed" && table === "media_jobs") sql = `UPDATE media_jobs SET status = 'queued', attempts = 0, error = NULL, leased_until = NULL, worker_id = NULL, finished_at = NULL, progress = 0, message = 'Retried by an admin', updated_at = now() WHERE status = 'failed' AND updated_at > now() - interval '7 days' ${kindFilter} RETURNING 1`;
      else if (action === "cancel_queued" && table === "media_jobs") sql = `UPDATE media_jobs SET status = 'cancelled', error = 'Cancelled by an admin', finished_at = now(), updated_at = now() WHERE status = 'queued' ${kindFilter} RETURNING 1`;
      else if (action === "cancel_queued") sql = `UPDATE creator_stage_jobs SET status = 'failed', error = 'Cancelled by an admin', updated_at = now() WHERE status = 'queued' ${kindFilter} RETURNING 1`;
      else throw adminError("That action isn't available for this queue.");
      const affected = Number(await runPsql(`WITH r AS (${sql}) SELECT count(*) FROM r;`)) || 0;
      await audit(admin, `queue.${action}`, "queue", `${req.params.queue}${kind ? `:${kind}` : ""}`, { affected }, req);
      res.json({ ok: true, affected });
    }));

    // ----- admin: one team member -----
    app.get("/api/admin/team/:email", adminRoute("view", async (req, res) => {
      const email = String(req.params.email).toLowerCase();
      const role = await adminRole(email);
      const member = await json(`SELECT COALESCE((SELECT json_build_object('email', lower(m.email), 'role', m.role, 'addedBy', m.added_by, 'createdAt', m.created_at) FROM admin_members m WHERE lower(m.email) = ${sqlString(email)}), 'null'::json)::text;`);
      if (!role && !member) throw adminError("That person isn't on the admin team.", 404);
      const [user, stats, byAction, recent] = await Promise.all([
        json(`SELECT COALESCE((SELECT json_build_object('id', id, 'name', name, 'avatarUrl', avatar_url, 'lastSeenAt', last_seen_at, 'createdAt', created_at) FROM app_users WHERE lower(email) = ${sqlString(email)} LIMIT 1), 'null'::json)::text;`),
        json(`SELECT json_build_object('total', count(*), 'last30d', count(*) FILTER (WHERE created_at > now() - interval '30 days'), 'lastAt', MAX(created_at),
  'tokensGranted', COALESCE(SUM((detail->>'tokens')::bigint) FILTER (WHERE action = 'billing.grant_tokens'), 0),
  'suspensions', count(*) FILTER (WHERE action = 'user.suspend'), 'replies', count(*) FILTER (WHERE action = 'support.reply'))::text FROM admin_audit_log WHERE admin_email = ${sqlString(email)};`),
        list(`SELECT action, count(*) AS n FROM admin_audit_log WHERE admin_email = ${sqlString(email)} GROUP BY action ORDER BY n DESC LIMIT 15`),
        list(`SELECT id, action, target_type AS "targetType", target_id AS "targetId", detail, created_at AS "createdAt" FROM admin_audit_log WHERE admin_email = ${sqlString(email)} ORDER BY created_at DESC LIMIT 40`),
      ]);
      res.json({ email, role: role || member?.role || "", source: owners().has(email) ? "ADMIN_EMAILS" : "team", member, user, stats, byAction, recent });
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
    billingSnapshot, adjustTokens, changePlan, getSettings, adminRole, recalcAutoPlans,
  };
}
