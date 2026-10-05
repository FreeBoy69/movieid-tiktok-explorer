// Business insights for the admin console: revenue (MRR, ARR, movements, churn,
// LTV), growth (signups, actives, funnel, cohorts), unit economics (cost,
// margin, providers, peak hours) and operations (jobs, support, automation).
//
// SQL lives in insightsQueries(); the derived ratios live in deriveInsights(),
// a pure function so the arithmetic is unit-tested without a database.
//
// Definitions (shown to admins in the UI):
// - MRR counts active accounts on a paid plan that are actually billed: a
//   payment provider other than "manual", or a paid-through date in the
//   future. Annual plans count annual price / 12. Manually granted paid plans
//   are reported separately as "comped".
// - MRR history and movements are rebuilt from paid plan orders: an order
//   covers its month (or year) from the day it was paid. Accounts billed
//   outside the order table only appear in current MRR.

export const INSIGHT_WINDOWS = [7, 30, 90, 365];
export const windowDays = (value) => {
  const n = Math.round(Number(value) || 30);
  return INSIGHT_WINDOWS.includes(n) ? n : 30;
};

// Monthly value of one billed account, in cents.
const MONTHLY_CENTS = `CASE WHEN a.subscription_interval = 'year' AND p.annual_price_cents > 0 THEN p.annual_price_cents / 12.0 ELSE p.price_cents END`;
const BILLED = `(a.payment_provider <> 'manual' OR a.subscription_paid_through > now())`;
const PAID_ACCOUNT = `a.status = 'active' AND p.price_cents > 0`;

export function insightsQueries(days, { ordersReady = true } = {}) {
  const d = windowDays(days);
  const bucket = d > 90 ? "week" : "day";
  const series = (from = `${d} days`) =>
    `generate_series(date_trunc('${bucket}', now() - interval '${from}') + interval '1 ${bucket}', date_trunc('${bucket}', now()), interval '1 ${bucket}')`;
  const orders = (sql, empty = "SELECT NULL WHERE false") => (ordersReady ? sql : empty);

  return {
    bucket,
    days: d,
    totals: `SELECT json_build_object(
  'users', (SELECT count(*) FROM app_users),
  'newUsers', (SELECT count(*) FROM app_users WHERE created_at > now() - interval '${d} days'),
  'newUsersPrev', (SELECT count(*) FROM app_users WHERE created_at BETWEEN now() - interval '${d * 2} days' AND now() - interval '${d} days'),
  'suspended', (SELECT count(*) FROM app_users WHERE status = 'suspended'),
  'dau', (SELECT count(*) FROM app_users WHERE last_seen_at > now() - interval '1 day'),
  'wau', (SELECT count(*) FROM app_users WHERE last_seen_at > now() - interval '7 days'),
  'mau', (SELECT count(*) FROM app_users WHERE last_seen_at > now() - interval '30 days'),
  'aiUsers', (SELECT count(DISTINCT user_id) FROM ai_usage_events WHERE user_id IS NOT NULL AND created_at > now() - interval '${d} days'),
  'aiUsersPrev', (SELECT count(DISTINCT user_id) FROM ai_usage_events WHERE user_id IS NOT NULL AND created_at BETWEEN now() - interval '${d * 2} days' AND now() - interval '${d} days'),
  'mrrCents', (SELECT COALESCE(round(SUM(${MONTHLY_CENTS})), 0) FROM billing_accounts a JOIN billing_plans p ON p.id = a.plan_id WHERE ${PAID_ACCOUNT} AND ${BILLED}),
  'payingAccounts', (SELECT count(*) FROM billing_accounts a JOIN billing_plans p ON p.id = a.plan_id WHERE ${PAID_ACCOUNT} AND ${BILLED}),
  'annualAccounts', (SELECT count(*) FROM billing_accounts a JOIN billing_plans p ON p.id = a.plan_id WHERE ${PAID_ACCOUNT} AND ${BILLED} AND a.subscription_interval = 'year'),
  'compedAccounts', (SELECT count(*) FROM billing_accounts a JOIN billing_plans p ON p.id = a.plan_id WHERE ${PAID_ACCOUNT} AND NOT ${BILLED}),
  'compedCents', (SELECT COALESCE(round(SUM(${MONTHLY_CENTS})), 0) FROM billing_accounts a JOIN billing_plans p ON p.id = a.plan_id WHERE ${PAID_ACCOUNT} AND NOT ${BILLED}),
  'pastDue', (SELECT count(*) FROM billing_accounts WHERE status = 'past_due'),
  'unlimitedAccounts', (SELECT count(*) FROM billing_accounts WHERE unlimited),
  'outOfCredits', (SELECT count(*) FROM billing_accounts WHERE NOT unlimited AND GREATEST(allowance_remaining, 0) + bonus_balance <= 0),
  'renewals30d', (SELECT count(*) FROM billing_accounts a JOIN billing_plans p ON p.id = a.plan_id WHERE ${PAID_ACCOUNT} AND a.subscription_paid_through BETWEEN now() AND now() + interval '30 days'),
  'collectedCents', ${orders(`(SELECT COALESCE(SUM(amount_cents), 0) FROM billing_orders WHERE status = 'paid' AND paid_at > now() - interval '${d} days')`, "0")},
  'collectedPrevCents', ${orders(`(SELECT COALESCE(SUM(amount_cents), 0) FROM billing_orders WHERE status = 'paid' AND paid_at BETWEEN now() - interval '${d * 2} days' AND now() - interval '${d} days')`, "0")},
  'refundedCents', ${orders(`(SELECT COALESCE(SUM(amount_cents), 0) FROM billing_orders WHERE status = 'refunded' AND updated_at > now() - interval '${d} days')`, "0")},
  'payments', ${orders(`(SELECT count(*) FROM billing_orders WHERE status = 'paid' AND paid_at > now() - interval '${d} days')`, "0")},
  'failedPayments', ${orders(`(SELECT count(*) FROM billing_orders WHERE status = 'failed' AND created_at > now() - interval '${d} days')`, "0")},
  'everPaid', ${orders(`(SELECT count(DISTINCT user_id) FROM billing_orders WHERE status = 'paid')`, "0")},
  'cost', (SELECT COALESCE(SUM(cost_usd), 0) FROM ai_usage_events WHERE created_at > now() - interval '${d} days'),
  'costPrev', (SELECT COALESCE(SUM(cost_usd), 0) FROM ai_usage_events WHERE created_at BETWEEN now() - interval '${d * 2} days' AND now() - interval '${d} days'),
  'credits', (SELECT COALESCE(SUM(tokens_charged), 0) FROM ai_usage_events WHERE created_at > now() - interval '${d} days'),
  'creditsPrev', (SELECT COALESCE(SUM(tokens_charged), 0) FROM ai_usage_events WHERE created_at BETWEEN now() - interval '${d * 2} days' AND now() - interval '${d} days'),
  'calls', (SELECT count(*) FROM ai_usage_events WHERE created_at > now() - interval '${d} days'),
  'callsPrev', (SELECT count(*) FROM ai_usage_events WHERE created_at BETWEEN now() - interval '${d * 2} days' AND now() - interval '${d} days'),
  'granted', (SELECT COALESCE(SUM(tokens), 0) FROM token_ledger WHERE kind = 'grant' AND created_at > now() - interval '${d} days'),
  'openTickets', (SELECT count(*) FROM support_tickets WHERE status IN ('open', 'pending')),
  'ticketsCreated', (SELECT count(*) FROM support_tickets WHERE created_at > now() - interval '${d} days'),
  'activeAgents', (SELECT count(*) FROM automation_agents WHERE status = 'active'),
  'uploads', (SELECT count(*) FROM automation_uploads WHERE created_at > now() - interval '${d} days'),
  'jobsQueued', (SELECT count(*) FROM media_jobs WHERE status IN ('queued', 'running')) + (SELECT count(*) FROM creator_stage_jobs WHERE status IN ('queued', 'running')),
  'jobsFailed24h', (SELECT count(*) FROM media_jobs WHERE status = 'failed' AND updated_at > now() - interval '1 day') + (SELECT count(*) FROM creator_stage_jobs WHERE status = 'failed' AND updated_at > now() - interval '1 day')
)::text;`,

    // One row per day (or week for a year window). Each measure is grouped once
    // and joined to the calendar, never queried per bucket.
    series: `
WITH cal AS (SELECT b FROM ${series()} b),
usage AS (SELECT date_trunc('${bucket}', created_at) b, SUM(tokens_charged) credits, SUM(cost_usd) cost, count(*) calls, count(DISTINCT user_id) active
  FROM ai_usage_events WHERE created_at > now() - interval '${d + 7} days' GROUP BY 1),
signups AS (SELECT date_trunc('${bucket}', created_at) b, count(*) n FROM app_users WHERE created_at > now() - interval '${d + 7} days' GROUP BY 1),
cash AS (${orders(`SELECT date_trunc('${bucket}', paid_at) b, SUM(amount_cents) FILTER (WHERE kind = 'plan') plan, SUM(amount_cents) FILTER (WHERE kind = 'credits') credits
  FROM billing_orders WHERE status = 'paid' AND paid_at > now() - interval '${d + 7} days' GROUP BY 1`, "SELECT NULL::timestamptz b, 0::bigint plan, 0::bigint credits WHERE false")}),
jobs AS (SELECT date_trunc('${bucket}', updated_at) b, count(*) FILTER (WHERE status = 'completed') done, count(*) FILTER (WHERE status = 'failed') failed
  FROM (SELECT updated_at, status FROM media_jobs WHERE updated_at > now() - interval '${d + 7} days'
        UNION ALL SELECT updated_at, status FROM creator_stage_jobs WHERE updated_at > now() - interval '${d + 7} days') j GROUP BY 1),
tickets AS (SELECT date_trunc('${bucket}', created_at) b, count(*) n FROM support_tickets WHERE created_at > now() - interval '${d + 7} days' GROUP BY 1),
uploads AS (SELECT date_trunc('${bucket}', created_at) b, count(*) n FROM automation_uploads WHERE created_at > now() - interval '${d + 7} days' GROUP BY 1)
SELECT to_char(cal.b, 'YYYY-MM-DD') AS day,
  COALESCE(usage.credits, 0) AS credits, COALESCE(usage.cost, 0) AS cost, COALESCE(usage.calls, 0) AS calls, COALESCE(usage.active, 0) AS active,
  COALESCE(signups.n, 0) AS signups, COALESCE(cash.plan, 0) AS "planCents", COALESCE(cash.credits, 0) AS "creditCents",
  COALESCE(jobs.done, 0) AS "jobsDone", COALESCE(jobs.failed, 0) AS "jobsFailed", COALESCE(tickets.n, 0) AS tickets, COALESCE(uploads.n, 0) AS uploads,
  (SELECT count(*) FROM app_users WHERE created_at < cal.b + interval '1 ${bucket}') AS "usersTotal"
FROM cal LEFT JOIN usage USING (b) LEFT JOIN signups USING (b) LEFT JOIN cash USING (b) LEFT JOIN jobs USING (b) LEFT JOIN tickets USING (b) LEFT JOIN uploads USING (b)
ORDER BY cal.b`,

    // Spend per provider per bucket, for a stacked chart (the client folds the tail into "Other").
    providerSeries: `
SELECT to_char(date_trunc('${bucket}', created_at), 'YYYY-MM-DD') AS day, provider, SUM(cost_usd) AS cost, SUM(tokens_charged) AS credits
FROM ai_usage_events WHERE created_at > date_trunc('${bucket}', now() - interval '${d} days') + interval '1 ${bucket}'
GROUP BY 1, 2 ORDER BY 1`,

    // When people use the product, in UTC: calls per weekday (0 = Sunday) and hour.
    heatmap: `
SELECT extract(dow FROM created_at)::int AS dow, extract(hour FROM created_at)::int AS hour, count(*) AS calls
FROM ai_usage_events WHERE created_at > now() - interval '${Math.max(d, 7)} days' GROUP BY 1, 2`,

    // Subscriptions covered at each of the last 13 month ends (the current month
    // uses now), from paid plan orders. deriveInsights() turns them into MRR
    // history and new / expansion / contraction / churn movements.
    coverage: orders(`
WITH points AS (
  SELECT LEAST(date_trunc('month', now()) - make_interval(months => g) + interval '1 month' - interval '1 second', now()) AS at
  FROM generate_series(0, 12) g
)
SELECT to_char(points.at, 'YYYY-MM') AS month, o.user_id AS "userId",
  CASE WHEN o."interval" = 'year' THEN o.amount_cents / 12.0 ELSE o.amount_cents END AS cents, o.plan_id AS "planId"
FROM points
JOIN LATERAL (
  SELECT DISTINCT ON (user_id) user_id, amount_cents, "interval", plan_id
  FROM billing_orders
  WHERE status = 'paid' AND kind = 'plan' AND paid_at <= points.at
    AND paid_at + CASE WHEN "interval" = 'year' THEN interval '1 year' ELSE interval '1 month' END > points.at
  ORDER BY user_id, paid_at DESC
) o ON true`, "SELECT NULL::text AS month, NULL::text AS \"userId\", 0 AS cents, NULL::text AS \"planId\" WHERE false"),

    // Cash collected per calendar month for a year, by kind, plus refunds.
    cashMonths: orders(`
SELECT to_char(m, 'YYYY-MM') AS month,
  COALESCE((SELECT SUM(amount_cents) FROM billing_orders WHERE status = 'paid' AND kind = 'plan' AND paid_at >= m AND paid_at < m + interval '1 month'), 0) AS "planCents",
  COALESCE((SELECT SUM(amount_cents) FROM billing_orders WHERE status = 'paid' AND kind = 'credits' AND paid_at >= m AND paid_at < m + interval '1 month'), 0) AS "creditCents",
  COALESCE((SELECT SUM(amount_cents) FROM billing_orders WHERE status = 'refunded' AND updated_at >= m AND updated_at < m + interval '1 month'), 0) AS "refundedCents",
  COALESCE((SELECT SUM(cost_usd) FROM ai_usage_events WHERE created_at >= m AND created_at < m + interval '1 month'), 0) AS cost
FROM generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') m ORDER BY m`,
      `SELECT to_char(m, 'YYYY-MM') AS month, 0 AS "planCents", 0 AS "creditCents", 0 AS "refundedCents",
  COALESCE((SELECT SUM(cost_usd) FROM ai_usage_events WHERE created_at >= m AND created_at < m + interval '1 month'), 0) AS cost
FROM generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') m ORDER BY m`),

    planMix: `
SELECT p.id, p.name, p.sort, p.price_cents AS "priceCents", count(a.user_id) AS accounts,
  count(a.user_id) FILTER (WHERE ${PAID_ACCOUNT} AND ${BILLED}) AS paying,
  count(a.user_id) FILTER (WHERE ${PAID_ACCOUNT} AND ${BILLED} AND a.subscription_interval = 'year') AS annual,
  COALESCE(round(SUM(${MONTHLY_CENTS}) FILTER (WHERE ${PAID_ACCOUNT} AND ${BILLED})), 0) AS "mrrCents"
FROM billing_plans p LEFT JOIN billing_accounts a ON a.plan_id = p.id GROUP BY p.id ORDER BY p.sort`,

    // People who signed up in the window: how far each got.
    funnel: `
WITH cohort AS (SELECT id, created_at FROM app_users WHERE created_at > now() - interval '${d} days'),
used AS (SELECT user_id, count(DISTINCT date_trunc('day', created_at)) active_days FROM ai_usage_events WHERE user_id IN (SELECT id FROM cohort) GROUP BY 1)
SELECT json_build_object(
  'signedUp', (SELECT count(*) FROM cohort),
  'usedAi', (SELECT count(*) FROM used),
  'returned', (SELECT count(*) FROM used WHERE active_days >= 3),
  'paid', (SELECT count(*) FROM cohort c WHERE EXISTS (
      SELECT 1 FROM billing_accounts a JOIN billing_plans p ON p.id = a.plan_id WHERE a.user_id = c.id AND ${PAID_ACCOUNT} AND ${BILLED})
    ${ordersReady ? "OR EXISTS (SELECT 1 FROM billing_orders o WHERE o.user_id = c.id AND o.status = 'paid')" : ""}),
  'activatedIn7d', (SELECT count(*) FROM cohort c WHERE EXISTS (SELECT 1 FROM ai_usage_events e WHERE e.user_id = c.id AND e.created_at < c.created_at + interval '7 days'))
)::text;`,

    // Weekly signup cohorts (last 8 weeks): share of each cohort using AI in each later week.
    cohorts: `
WITH cohort AS (
  SELECT id, date_trunc('week', created_at) AS week FROM app_users WHERE created_at >= date_trunc('week', now()) - interval '7 weeks'
),
activity AS (
  SELECT DISTINCT user_id, date_trunc('week', created_at) AS week FROM ai_usage_events
  WHERE user_id IN (SELECT id FROM cohort) AND created_at >= date_trunc('week', now()) - interval '7 weeks'
),
weeks AS (SELECT week, count(*) AS size FROM cohort GROUP BY week)
SELECT to_char(w.week, 'YYYY-MM-DD') AS week, w.size,
  COALESCE((SELECT json_object_agg(x.k, x.n) FROM (
    SELECT ((extract(epoch FROM a.week - w.week) / 604800)::int)::text AS k, count(DISTINCT a.user_id) AS n
    FROM activity a JOIN cohort c ON c.id = a.user_id AND c.week = w.week
    WHERE a.week >= w.week GROUP BY 1) x), '{}'::json) AS active
FROM weeks w ORDER BY w.week`,

    topFeatures: `
SELECT feature, SUM(cost_usd) AS cost, SUM(tokens_charged) AS credits, count(*) AS calls, count(DISTINCT user_id) AS users
FROM ai_usage_events WHERE created_at > now() - interval '${d} days' GROUP BY feature ORDER BY cost DESC LIMIT 8`,

    topCustomers: orders(`
SELECT u.id, u.email, u.name, u.avatar_url AS "avatarUrl", SUM(o.amount_cents) AS "paidCents", count(*) AS payments, max(o.paid_at) AS "lastPaidAt",
  COALESCE((SELECT SUM(cost_usd) FROM ai_usage_events e WHERE e.user_id = u.id AND e.created_at > now() - interval '${d} days'), 0) AS cost
FROM billing_orders o JOIN app_users u ON u.id = o.user_id WHERE o.status = 'paid' GROUP BY u.id ORDER BY "paidCents" DESC LIMIT 8`, "SELECT NULL WHERE false"),

    support: `SELECT json_build_object(
  'byStatus', COALESCE((SELECT json_object_agg(status, n) FROM (SELECT status, count(*) n FROM support_tickets GROUP BY status) s), '{}'::json),
  'byCategory', COALESCE((SELECT json_agg(x ORDER BY x.n DESC) FROM (SELECT category, count(*) n FROM support_tickets WHERE created_at > now() - interval '${d} days' GROUP BY category) x), '[]'::json),
  'medianFirstReplyHours', (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY h) FROM (
      SELECT extract(epoch FROM (SELECT min(m.created_at) FROM support_messages m WHERE m.ticket_id = t.id AND m.author_type = 'admin') - t.created_at) / 3600 AS h
      FROM support_tickets t WHERE t.created_at > now() - interval '${d} days') r WHERE h IS NOT NULL),
  'unanswered', (SELECT count(*) FROM support_tickets t WHERE t.status IN ('open', 'pending') AND NOT EXISTS (SELECT 1 FROM support_messages m WHERE m.ticket_id = t.id AND m.author_type = 'admin'))
)::text;`,
  };
}

const num = (value) => Number(value) || 0;
const round = (value, places = 1) => {
  const f = 10 ** places;
  return Math.round(value * f) / f;
};

// Pure arithmetic over the query results. Every ratio returns null when its
// base is zero so the UI shows "—" instead of a misleading 0% or infinity.
export function deriveInsights(raw) {
  const t = Object.fromEntries(Object.entries(raw.totals || {}).map(([k, v]) => [k, num(v)]));
  const mrr = t.mrrCents;
  const paying = t.payingAccounts;

  // MRR history and movements from order coverage.
  const months = [...new Set((raw.coverage || []).map((row) => row.month))].sort();
  const byMonth = new Map(months.map((m) => [m, new Map()]));
  for (const row of raw.coverage || []) byMonth.get(row.month)?.set(row.userId, num(row.cents));
  const history = [];
  for (let i = 0; i < months.length; i++) {
    const now = byMonth.get(months[i]);
    const before = i ? byMonth.get(months[i - 1]) : null;
    const total = [...now.values()].reduce((a, b) => a + b, 0);
    const move = { new: 0, expansion: 0, contraction: 0, churned: 0, newCount: 0, churnedCount: 0 };
    if (before) {
      for (const [user, cents] of now) {
        if (!before.has(user)) {
          move.new += cents;
          move.newCount++;
        } else if (cents > before.get(user)) move.expansion += cents - before.get(user);
        else if (cents < before.get(user)) move.contraction += before.get(user) - cents;
      }
      for (const [user, cents] of before)
        if (!now.has(user)) {
          move.churned += cents;
          move.churnedCount++;
        }
    }
    const startCents = before ? [...before.values()].reduce((a, b) => a + b, 0) : 0;
    history.push({
      month: months[i],
      mrrCents: Math.round(total),
      subscribers: now.size,
      ...Object.fromEntries(Object.entries(move).map(([k, v]) => [k, Math.round(v)])),
      logoChurn: before && before.size ? round((move.churnedCount / before.size) * 100) : null,
      netRetention: startCents ? round(((startCents + move.expansion - move.contraction - move.churned) / startCents) * 100) : null,
    });
  }
  // The newest point is the month in progress; rates come from the last full month.
  const lastFull = history.length >= 2 ? history[history.length - 2] : null;
  const churnRate = lastFull?.logoChurn ?? null;
  const arpa = paying ? mrr / paying : 0;
  const ltvCents = churnRate && churnRate > 0 ? Math.round(arpa / (churnRate / 100)) : null;
  const recent = history.slice(-3);
  const gained = recent.reduce((s, h) => s + h.new + h.expansion, 0);
  const lost = recent.reduce((s, h) => s + h.churned + h.contraction, 0);

  const collectedUsd = t.collectedCents / 100;
  const marginPct = collectedUsd ? round(((collectedUsd - t.cost) / collectedUsd) * 100) : null;
  const pct = (a, b) => (b ? round((a / b) * 100) : null);

  // Fold providers beyond the top four (by window spend) into "Other".
  const totalsByProvider = new Map();
  for (const row of raw.providerSeries || []) totalsByProvider.set(row.provider, (totalsByProvider.get(row.provider) || 0) + num(row.cost));
  const ranked = [...totalsByProvider.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
  const keep = ranked.slice(0, ranked.length > 5 ? 4 : 5);
  const providers = [...keep, ...(ranked.length > keep.length ? ["other"] : [])];
  const providerDays = new Map();
  for (const row of raw.providerSeries || []) {
    const key = keep.includes(row.provider) ? row.provider : "other";
    const day = providerDays.get(row.day) || {};
    day[key] = (day[key] || 0) + num(row.cost);
    providerDays.set(row.day, day);
  }
  const providerSeries = (raw.series || []).map((row) => ({ day: row.day, values: providers.map((p) => providerDays.get(row.day)?.[p] || 0) }));

  const heat = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const row of raw.heatmap || []) if (heat[row.dow]) heat[row.dow][row.hour] = num(row.calls);

  return {
    revenue: {
      mrrCents: mrr,
      arrCents: mrr * 12,
      payingAccounts: paying,
      annualAccounts: t.annualAccounts,
      arpaCents: Math.round(arpa),
      compedAccounts: t.compedAccounts,
      compedCents: t.compedCents,
      collectedCents: t.collectedCents,
      collectedPrevCents: t.collectedPrevCents,
      refundedCents: t.refundedCents,
      payments: t.payments,
      failedPayments: t.failedPayments,
      paymentSuccessRate: pct(t.payments, t.payments + t.failedPayments),
      pastDue: t.pastDue,
      renewals30d: t.renewals30d,
      churnRate,
      netRetention: lastFull?.netRetention ?? null,
      ltvCents,
      quickRatio: lost ? round(gained / lost, 2) : null,
      paidConversion: pct(paying, t.users),
      everPaid: t.everPaid,
      history,
    },
    growth: {
      users: t.users,
      newUsers: t.newUsers,
      newUsersPrev: t.newUsersPrev,
      suspended: t.suspended,
      dau: t.dau,
      wau: t.wau,
      mau: t.mau,
      stickiness: pct(t.dau, t.mau),
      aiUsers: t.aiUsers,
      aiUsersPrev: t.aiUsersPrev,
    },
    economics: {
      cost: t.cost,
      costPrev: t.costPrev,
      credits: t.credits,
      creditsPrev: t.creditsPrev,
      calls: t.calls,
      callsPrev: t.callsPrev,
      granted: t.granted,
      marginPct,
      grossProfitUsd: collectedUsd - t.cost,
      costPerActiveUser: t.aiUsers ? t.cost / t.aiUsers : null,
      costPerPayingAccount: paying ? t.cost / paying : null,
      revenuePerCall: t.calls ? collectedUsd / t.calls : null,
      outOfCredits: t.outOfCredits,
      unlimitedAccounts: t.unlimitedAccounts,
      providers,
      providerSeries,
      heatmap: heat,
    },
    operations: {
      openTickets: t.openTickets,
      ticketsCreated: t.ticketsCreated,
      activeAgents: t.activeAgents,
      uploads: t.uploads,
      jobsQueued: t.jobsQueued,
      jobsFailed24h: t.jobsFailed24h,
    },
  };
}
