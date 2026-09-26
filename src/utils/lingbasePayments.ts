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
  if (!response.ok) throw new Error(data.error || "LingBase payments are unavailable.");
  return data;
}

async function ensureLingbaseSession(autoEmail: string, selection: Selection): Promise<string> {
  const client = await cloud();
  const lingUser = client.auth.getUser();
  const token = client.auth.getToken();
  if (!token || lingUser?.email?.trim().toLowerCase() !== autoEmail.trim().toLowerCase()) {
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

export async function startLingbaseCheckout(selection: Selection, autoEmail: string): Promise<{ checkoutUrl: string; sessionId: string }> {
  const token = await ensureLingbaseSession(autoEmail, selection);
  const body = selection.kind === "pack"
    ? { packId: selection.packId }
    : { planId: selection.planId, interval: selection.interval };
  const data = await post("/api/billing/lingbase/checkout", token, body);
  const url = new URL(data.checkoutUrl);
  if (url.hostname !== "checkout.stripe.com" || url.protocol !== "https:") throw new Error("Unexpected checkout destination.");
  return { checkoutUrl: url.toString(), sessionId: String(data.sessionId || "") };
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
