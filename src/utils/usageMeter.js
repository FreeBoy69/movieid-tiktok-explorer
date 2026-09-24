import { AsyncLocalStorage } from "node:async_hooks";

// Attributes paid AI calls to the user who caused them.
//
// Provider clients cannot see the request, so the server runs every request (and
// every background job) inside a usage context. The clients call `guardUsage`
// before a paid call and `meterUsage` after it; the server installs the handlers
// that check balances and write the ledger. With no handlers installed (tests,
// scripts) both are no-ops, and a failing handler never breaks the AI call.

const storage = new AsyncLocalStorage();
let guardHandler = null;
let meterHandler = null;
const seen = new Map();

export function installUsageHandlers({ guard = null, meter = null } = {}) {
  guardHandler = guard;
  meterHandler = meter;
}

export function usageContext() {
  return storage.getStore() || null;
}

// `resolveUser` lets a request context look up its session only when a paid call
// actually happens, instead of on every request.
// The context object is used as-is so the caller can read what happened later
// (for example `context.blocked`).
export function runWithUsageContext(context, fn) {
  if (!("userId" in context)) context.userId = undefined;
  context.feature ||= "";
  return storage.run(context, fn);
}

export function withUsageUser(userId, feature, fn) {
  return storage.run({ userId: userId || null, feature: feature || "" }, fn);
}

export async function usageUserId(context = usageContext()) {
  if (!context) return null;
  if (context.userId !== undefined) return context.userId;
  if (!context.resolveUser) return null;
  context.userPromise ||= Promise.resolve().then(context.resolveUser).catch(() => null);
  context.userId = (await context.userPromise) || null;
  return context.userId;
}

export class UsageBlockedError extends Error {
  constructor(message, code = "insufficient_tokens", status = 402) {
    super(message);
    this.name = "UsageBlockedError";
    this.code = code;
    this.status = status;
    this.statusCode = status;
  }
}

export async function guardUsage(provider, details = {}) {
  if (!guardHandler) return;
  const context = usageContext();
  let userId = null;
  try {
    userId = await usageUserId(context);
  } catch {}
  const verdict = await Promise.resolve(guardHandler({ provider, userId, feature: context?.feature || "", ...details })).catch((error) => {
    console.warn("[usage] guard failed open:", error instanceof Error ? error.message : error);
    return null;
  });
  if (verdict?.blocked) {
    if (context) context.blocked = verdict;
    throw new UsageBlockedError(verdict.message, verdict.code, verdict.status || 402);
  }
}

// Provider usage objects differ; this reads the common shapes.
export function normalizeUsage(usage = {}) {
  const u = usage || {};
  const input = Number(u.prompt_tokens ?? u.input_tokens ?? u.promptTokenCount ?? u.promptTokens ?? 0) || 0;
  const output = Number(u.completion_tokens ?? u.output_tokens ?? u.candidatesTokenCount ?? u.completionTokens ?? 0) || 0;
  const thoughts = Number(u.thoughtsTokenCount ?? 0) || 0;
  const cost = Number(u.cost ?? u.total_cost ?? NaN);
  return { inputTokens: input, outputTokens: output + thoughts, costUsd: Number.isFinite(cost) ? cost : null };
}

// A finished video job can be polled more than once; charge each generation once.
function alreadyMetered(ref) {
  if (!ref) return false;
  const now = Date.now();
  if (seen.size > 5000) for (const [key, at] of seen) if (now - at > 6 * 3600000) seen.delete(key);
  if (seen.has(ref)) return true;
  seen.set(ref, now);
  return false;
}

export function meterUsage(event) {
  if (!meterHandler || !event) return;
  const context = usageContext();
  const ref = event.ref ? `${event.provider}:${event.ref}` : "";
  const usage = event.usage ? normalizeUsage(event.usage) : { inputTokens: 0, outputTokens: 0, costUsd: null };
  if (!usage.inputTokens && !usage.outputTokens && usage.costUsd == null && !event.costUsd && !event.units) return;
  if (alreadyMetered(ref)) return;
  Promise.resolve()
    .then(() => usageUserId(context))
    .then((userId) => meterHandler({
      userId,
      feature: context?.feature || "",
      provider: event.provider,
      model: String(event.model || ""),
      operation: event.operation || "chat",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: event.costUsd ?? usage.costUsd,
      units: event.units || 0,
      ref,
    }))
    .catch((error) => console.warn("[usage] meter failed:", error instanceof Error ? error.message : error));
}
