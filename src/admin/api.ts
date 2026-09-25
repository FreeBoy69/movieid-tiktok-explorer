import { tokensToCredits } from "../utils/credits.js";

// Admin API client. Writes carry x-admin-request so the server can refuse
// cross-site form posts that ride on the session cookie.
export class AdminApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code = "") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function adminFetch<T = any>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = options.method || "GET";
  const response = await fetch(path, {
    method,
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      ...(method === "GET" ? {} : { "x-admin-request": "1" }),
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new AdminApiError(data?.error || `Request failed (${response.status})`, response.status, data?.code || "");
  return data as T;
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat("en-US");

export const fmt = {
  tokens: (value: unknown) => compact.format(Number(value) || 0),
  credits: (value: unknown) => compact.format(tokensToCredits(value)),
  number: (value: unknown) => whole.format(Number(value) || 0),
  usd(value: unknown) {
    const n = Number(value) || 0;
    if (n > 0 && n < 0.01) return `$${n.toFixed(4)}`;
    return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  },
  cents: (value: unknown) => `$${((Number(value) || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`,
  date: (value: unknown) => (value ? new Date(String(value)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"),
  dateTime: (value: unknown) => (value ? new Date(String(value)).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"),
  ago(value: unknown) {
    if (!value) return "Never";
    const seconds = Math.round((Date.now() - new Date(String(value)).getTime()) / 1000);
    if (seconds < 60) return "Just now";
    const units: Array<[number, string]> = [[60, "m"], [3600, "h"], [86400, "d"], [2592000, "mo"], [31536000, "y"]];
    let label = "";
    for (let i = units.length - 1; i >= 0; i--) {
      if (seconds >= units[i][0]) {
        label = `${Math.floor(seconds / units[i][0])}${units[i][1]} ago`;
        break;
      }
    }
    return label;
  },
  // Percentage change against the previous window; null when there's no base.
  delta(current: unknown, previous: unknown) {
    const c = Number(current) || 0;
    const p = Number(previous) || 0;
    if (!p) return null;
    return ((c - p) / p) * 100;
  },
};

// Keep provider names readable in billing views while retaining their stable
// machine values for filtering and API queries.
export const PROVIDER_LABELS: Record<string, string> = {
  openrouter: "OpenRouter",
  videorouter: "Video Router",
  deepseek: "DeepSeek",
  gemini: "Gemini",
  dashscope: "DashScope",
  runway: "Runway",
};

export const PROVIDER_VALUES = ["openrouter", "videorouter", "deepseek", "gemini", "dashscope", "runway"];

export const providerLabel = (value: unknown) => {
  const key = String(value || "").trim();
  return PROVIDER_LABELS[key] || (key ? key.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Unknown provider");
};

export const providerChoices = (extra: Iterable<unknown> = []) => [...new Set([...PROVIDER_VALUES, ...Array.from(extra, (value) => String(value || "").trim()).filter(Boolean)])]
  .map((value) => ({ value, label: providerLabel(value) }));

export type AdminIdentity = { id: string; email: string; name: string; avatarUrl: string; role: "owner" | "admin" | "support" | "viewer"; permissions: string[] };

export const can = (admin: AdminIdentity | null, permission: string) => Boolean(admin?.permissions.includes(permission));
