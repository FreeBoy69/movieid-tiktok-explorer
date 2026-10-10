import { createClient, type LingCodeClient } from "lingcode-js";

type Interval = "month" | "year";
type PlanSelection = { kind: "plan"; planId: string; interval: Interval };
type PackSelection = { kind: "pack"; packId: string };
type Selection = PlanSelection | PackSelection;
const SELECTION_KEY = "autoyt-billing-selection";
let clientPromise: Promise<LingCodeClient> | null = null;

async function cloud() {
  clientPromise ||= fetch("/api/billing/lingbase/config", { cache: "no-store" })
    .then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "LingBase payments are unavailable.");
      const client = createClient(data.url, data.anonKey);
      await client.ready;
      return client;
    }).catch((error) => { clientPromise = null; throw error; });
  return clientPromise;
}

function selectedPurchase(): Selection | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(SELECTION_KEY) || "null");
    if (value?.kind === "pack" && typeof value.packId === "string") return value;
    if (value?.kind === "plan" && ["creator", "pro", "studio"].includes(value.planId) && ["month", "year"].includes(value.interval)) return value;
    // Legacy shape from before packs.
    if (value && ["creator", "pro", "studio"].includes(value.planId) && ["month", "year"].includes(value.interval)) {
      return { kind: "plan", planId: value.planId, interval: value.interval };
    }
    return null;
  } catch { return null; }
}

async function post(path: string, token: string, body: Record<string, unknown> = {}) {
  const response = await fetch(path, {
    method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { "content-type": "application/json", "x-billing-request": "1", "x-lingbase-session": token },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || "LingBase payments are unavailable."), { code: data.code });
  return data;
}

// The SDK keeps a stored session after its JWT expires; treat that as signed out.
function tokenExpired(token: string) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp === "number" && payload.exp * 1000 <= Date.now() + 30_000;
  } catch { return false; }
}

async function ensureLingbaseSession(autoEmail: string, selection: Selection, reconnect = false): Promise<string> {
  const client = await cloud();
  const lingUser = client.auth.getUser();
  const token = client.auth.getToken();
  if (reconnect || !token || tokenExpired(token) || lingUser?.email?.trim().toLowerCase() !== autoEmail.trim().toLowerCase()) {
    sessionStorage.setItem(SELECTION_KEY, JSON.stringify(selection));
    if (token) await client.auth.signOut();
    const returnUrl = new URL(window.location.href);
    returnUrl.searchParams.set("billing_connect", "1");
    client.auth.signInWithOAuth("google", { redirectTo: returnUrl.toString() });
    throw Object.assign(new Error("Connecting LingCloud…"), { code: "lingbase_connect" });
  }
  sessionStorage.removeItem(SELECTION_KEY);
  return token;
}

export type CheckoutSession = { sessionId: string; clientSecret: string; publishableKey: string; stripeAccount: string };

export async function startLingbaseCheckout(selection: Selection, autoEmail: string): Promise<CheckoutSession> {
  const token = await ensureLingbaseSession(autoEmail, selection);
  const body = selection.kind === "pack"
    ? { packId: selection.packId }
    : { planId: selection.planId, interval: selection.interval };
  const data = await post("/api/billing/lingbase/checkout", token, body).catch(async (error) => {
    if (error?.code !== "lingbase_session_expired") throw error;
    return ensureLingbaseSession(autoEmail, selection, true) as never;
  });
  const session = {
    sessionId: String(data.sessionId || ""),
    clientSecret: String(data.clientSecret || ""),
    publishableKey: String(data.publishableKey || ""),
    stripeAccount: String(data.stripeAccount || ""),
  };
  if (!session.clientSecret.includes("_secret_") || !session.publishableKey.startsWith("pk_") || !session.stripeAccount.startsWith("acct_")) {
    throw new Error("Checkout could not start.");
  }
  return session;
}

export async function chooseLingbasePlan(planId: string, interval: Interval, autoEmail: string) {
  return startLingbaseCheckout({ kind: "plan", planId, interval }, autoEmail);
}

export async function chooseLingbasePack(packId: string, autoEmail: string) {
  return startLingbaseCheckout({ kind: "pack", packId }, autoEmail);
}

export async function continueLingbaseCheckout(autoEmail: string) {
  const selection = selectedPurchase();
  if (!selection) throw new Error("Choose a plan or credit bundle to continue.");
  return startLingbaseCheckout(selection, autoEmail);
}

export async function syncLingbasePayments() {
  const client = await cloud();
  const token = client.auth.getToken();
  if (!token) return null;
  return post("/api/billing/lingbase/sync", token);
}

export async function openLingbasePortal() {
  const client = await cloud();
  const token = client.auth.getToken();
  if (!token) throw new Error("Connect LingCloud to manage your subscription.");
  const data = await post("/api/billing/lingbase/portal", token);
  const url = new URL(data.portalUrl);
  if (url.hostname !== "billing.stripe.com" || url.protocol !== "https:") throw new Error("Unexpected billing portal destination.");
  window.location.assign(url.toString());
}
