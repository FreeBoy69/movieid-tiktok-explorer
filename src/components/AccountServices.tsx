import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import  { ArrowLeft, CircleCheck, Info, Loader2, Megaphone, Plus, TriangleAlert, Wallet, X } from "lucide-react";
import { toast } from "../utils/toast";
import { tokensToCredits } from "../utils/credits";
import { chooseLingbasePack, chooseLingbasePlan, continueLingbaseCheckout, openLingbasePortal, syncLingbasePayments, type CheckoutSession } from "../utils/lingbasePayments";
import { purchasesAllowed } from "../native/platform";
import "./AccountServices.css";
import { Dialog } from "./ui/Dialog";
import { Meter, Segmented } from "./ui/controls";

// User-facing pieces of billing, governance and support: the credit balance in the
// account menu, the Help & support dialog, the site-wide notice banner, and the
// toast shown when the server blocks an AI call.

type Theme = "light" | "dark";
export type Billing = { planId: string; planName: string; status: string; monthlyTokens: number; balance: number; allowanceRemaining: number; bonusBalance: number; unlimited: boolean; periodEnd: string; periodUsed: number; subscriptionInterval?: string };
type Pack = { id: string; name: string; credits: number; priceCents: number; blurb?: string; available: boolean };
export type BillingOffer = { billing: Billing; plans: Array<{ id: string; name: string; description: string; priceCents: number; annualPriceCents: number; monthlyTokens: number; features?: string[] }>; payment: { available: boolean; provider: string; testMode: boolean; packs: Pack[]; packsRequirePlan?: boolean } };
type Ticket = { id: string; subject: string; category: string; status: string; lastMessageAt: string; lastAuthor?: string };
type Thread = Ticket & { messages: Array<{ id: string; authorType: "user" | "admin"; body: string; createdAt: string }> };

const STATUS_LABEL: Record<string, string> = { open: "Open", pending: "Replied", resolved: "Resolved", closed: "Closed" };
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });
const money = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

// The iOS and Android apps may not point people at web purchases (App Store 3.1.1,
// Google Play payments policy), so their notices drop the buying prompts.
function storeSafeNotice(code: string, message: string): string {
  if (purchasesAllowed()) return message;
  if (code === "subscription_required") return "This account doesn't have an active plan, so creating is unavailable.";
  if (code === "billing_verification_required") return "Your plan status needs a refresh. Try again in a moment.";
  return message.replace(/,? or upgrade your plan for more\.?$/i, ".");
}

const BLOCK_CODES = new Set(["insufficient_tokens", "insufficient_credits", "subscription_required", "billing_verification_required", "account_suspended", "ai_paused", "provider_paused", "billing_unavailable", "maintenance"]);
let installed = false;
export function installUsageNotices() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await original(...args);
    if ([402, 403, 503].includes(response.status)) {
      const url = typeof args[0] === "string" ? args[0] : args[0] instanceof URL ? args[0].href : args[0].url;
      if (/\/api\//.test(url) && !/\/api\/admin\//.test(url)) {
        response.clone().json().then((data) => {
          if (!BLOCK_CODES.has(data?.code)) return;
          const outOfCredits = data.code === "insufficient_tokens" || data.code === "insufficient_credits";
          const title = outOfCredits ? "Out of credits" : data.code === "subscription_required" ? "Choose a plan" : data.code === "account_suspended" ? "Account suspended" : "Paused";
          const store = !purchasesAllowed();
          toast.error(storeSafeNotice(data.code, data.error), {
            title: store && data.code === "subscription_required" ? "No active plan" : title,
            action: store && data.code !== "account_suspended"
              ? undefined
              : outOfCredits
              ? { label: "Buy credits", onClick: () => window.dispatchEvent(new CustomEvent("autoyt-open-billing", { detail: { tab: "packs" } })) }
              : data.code === "subscription_required"
                ? { label: "View plans", onClick: () => window.dispatchEvent(new CustomEvent("autoyt-open-billing", { detail: { tab: "plans" } })) }
                : data.code === "account_suspended"
                  ? { label: "Contact support", onClick: () => window.dispatchEvent(new CustomEvent("autoyt-open-support")) }
                  : undefined,
          });
          if (outOfCredits || data.code === "subscription_required") window.dispatchEvent(new CustomEvent("autoyt-billing-changed"));
        }).catch(() => {});
      }
    }
    return response;
  };
}

/** Opens Credits & plans from anywhere; BillingOnboarding owns the one dialog. */
export function openBilling(tab: "plans" | "packs" = "plans") {
  window.dispatchEvent(new CustomEvent("autoyt-open-billing", { detail: { tab } }));
}

export function TokenSummary({ email = "" }: { theme?: Theme; email?: string }) {
  const [offer, setOffer] = useState<BillingOffer | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => syncLingbasePayments().catch(() => null).then(() => fetch("/api/billing/me", { cache: "no-store" }))
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => { if (alive) { setOffer(data); setFailed(false); } })
      .catch(() => { if (alive) setFailed(true); });
    void load();
    window.addEventListener("autoyt-billing-changed", load);
    return () => {
      alive = false;
      window.removeEventListener("autoyt-billing-changed", load);
    };
  }, [email]);
  if (failed) return null;
  if (!offer) {
    return (
      <div className="as-tokens" aria-busy="true">
        <span className="as-tokens-row"><span>Credits</span><Loader2 size={13} className="ui-spin" aria-hidden="true" /></span>
        <Meter className="as-meter" value={0} label="Credits loading" />
      </div>
    );
  }
  const billing = offer.billing;
  const total = Math.max(1, billing.monthlyTokens + Math.max(0, billing.bonusBalance));
  const left = Math.max(0, billing.balance);
  const pct = billing.unlimited ? 100 : Math.min(100, (left / total) * 100);
  const low = !billing.unlimited && pct < 10;
  return (
    <div className="as-tokens">
      <span className="as-tokens-row">
        <span>{billing.planId === "pending" ? "Plan required" : `${billing.planName} plan`}</span>
        <strong className={low ? "is-low" : undefined}>{billing.unlimited ? "Unlimited" : `${compact.format(tokensToCredits(left))} credits left`}</strong>
      </span>
      <Meter className="as-meter" value={pct / 100} low={low} label="Credits left this period" />
      {!billing.unlimited && billing.status === "active" ? <small>Allowance renews {new Date(billing.periodEnd).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</small> : null}
      {purchasesAllowed() ? <button type="button" className="as-billing-open" onClick={() => openBilling(low ? "packs" : "plans")}>Credits & plans</button> : null}
    </div>
  );
}

// Always mounted for signed-in users: opens itself while no plan is chosen, and is
// the one Credits & plans dialog every openBilling() call opens.
export function BillingOnboarding({ theme, email }: { theme: Theme; email: string }) {
  const [offer, setOffer] = useState<BillingOffer | null>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"plans" | "packs">("plans");
  useEffect(() => {
    if (!email || !purchasesAllowed()) return;
    let active = true;
    const load = async () => {
      await syncLingbasePayments().catch(() => null);
      const response = await fetch("/api/billing/me", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      if (!active || !data?.billing) return;
      setOffer(data);
      if (data.billing.planId === "pending") setOpen(true);
    };
    const onVisible = () => { if (document.visibilityState === "visible") void load().catch(() => {}); };
    const onChanged = () => void load().catch(() => {});
    const onOpen = (event: Event) => {
      const requested = (event as CustomEvent).detail?.tab;
      if (requested === "packs" || requested === "plans") setTab(requested);
      setOpen(true);
      void load().catch(() => {});
    };
    void load().catch(() => {});
    const timer = window.setInterval(() => void load().catch(() => {}), 5 * 60 * 1000);
    window.addEventListener("focus", onVisible);
    window.addEventListener("autoyt-billing-changed", onChanged);
    window.addEventListener("autoyt-open-billing", onOpen as EventListener);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("autoyt-billing-changed", onChanged);
      window.removeEventListener("autoyt-open-billing", onOpen as EventListener);
    };
  }, [email]);
  return offer ? <BillingDialog open={open} onClose={() => setOpen(false)} theme={theme} offer={offer} email={email} initialTab={tab} onOffer={setOffer} /> : null;
}

export function BillingReturnVerifier({ email = "" }: { email?: string }) {
  useEffect(() => {
    if (!email) return;
    const url = new URL(window.location.href);
    if (url.searchParams.has("billing_cancel")) {
      url.searchParams.delete("billing_cancel");
      url.searchParams.delete("checkout");
      window.history.replaceState(window.history.state, "", url.toString());
      toast.info("Checkout canceled. No charge was made.");
    }
    if (url.searchParams.has("billing_connect")) {
      void continueLingbaseCheckout(email)
        .then((session) => {
          pendingEmbeddedCheckout = session;
          window.dispatchEvent(new CustomEvent("autoyt-open-billing", { detail: { tab: "plans", checkout: session } }));
        })
        .catch((error) => {
          if ((error as { code?: string })?.code === "lingbase_connect") return;
          toast.error(error instanceof Error ? error.message : "Could not connect LingCloud payments.");
        })
        .finally(() => {
          const current = new URL(window.location.href);
          current.searchParams.delete("billing_connect");
          window.history.replaceState(window.history.state, "", current.toString());
        });
      return;
    }
    if (url.searchParams.has("billing_return")) {
      url.searchParams.delete("billing_return");
      url.searchParams.delete("checkout");
      window.history.replaceState(window.history.state, "", url.toString());
      const verify = async () => {
        for (let attempt = 0; attempt < 5; attempt++) {
          const result = await syncLingbasePayments();
          if (result?.credited > 0 || result?.billing?.status === "active") {
            window.dispatchEvent(new CustomEvent("autoyt-billing-changed"));
            toast.success("Payment confirmed. Your credits are ready.");
            return;
          }
          await new Promise((resolve) => window.setTimeout(resolve, (attempt + 1) * 1500));
        }
        toast.info("Payment is processing. Your credits will appear as soon as LingBase confirms it.");
      };
      void verify().catch((error) => toast.error(error instanceof Error ? error.message : "Payment verification is temporarily unavailable."));
      return;
    }
    const reference = url.searchParams.get("billing_reference");
    if (!reference) return;
    if (!/^ayt_[a-f0-9]{24}$/.test(reference)) {
      url.searchParams.delete("billing_reference");
      window.history.replaceState(window.history.state, "", url.toString());
      return;
    }
    fetch(`/api/billing/checkout/verify?reference=${encodeURIComponent(reference)}`, { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Payment is still being confirmed.");
        url.searchParams.delete("billing_reference");
        window.history.replaceState(window.history.state, "", url.toString());
        toast.success("Payment confirmed. Your credits are ready.");
        window.dispatchEvent(new CustomEvent("autoyt-billing-changed"));
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : "Payment is still being confirmed."));
  }, [email]);
  return null;
}

let pendingEmbeddedCheckout: CheckoutSession | null = null;

function EmbeddedCheckout({ session, onPaid }: { session: CheckoutSession; onPaid: () => void }) {
  const slot = useRef<HTMLDivElement>(null);
  const onPaidRef = useRef(onPaid);
  onPaidRef.current = onPaid;
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    let checkout: { destroy: () => void } | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const { loadStripe } = await import("@stripe/stripe-js");
        const stripe = await loadStripe(session.publishableKey, { stripeAccount: session.stripeAccount });
        if (!stripe || cancelled) throw new Error("Stripe did not load.");
        const page = await stripe.createEmbeddedCheckoutPage({
          fetchClientSecret: async () => session.clientSecret,
          onComplete: () => onPaidRef.current(),
        });
        if (cancelled || !slot.current) {
          page.destroy();
          return;
        }
        checkout = page;
        page.mount(slot.current);
        setPhase("ready");
      } catch {
        if (!cancelled) setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
      checkout?.destroy();
    };
  }, [session.clientSecret, session.publishableKey, session.stripeAccount]);
  if (phase === "error") {
    return (
      <div className="as-billing-pay">
        <h3>Card form did not load</h3>
        <p>Go back and choose the plan again. Card details stay in this window.</p>
      </div>
    );
  }
  return (
    <>
      {phase === "loading" ? <p className="as-billing-embed-status"><Loader2 className="ui-spin" size={18} aria-hidden="true" /> Loading secure checkout</p> : null}
      <div className="as-billing-embed-clip">
        <div ref={slot} className="as-billing-embed" aria-label="Secure checkout form" />
      </div>
    </>
  );
}

function BillingDialog({ open, onClose, theme, offer, email, initialTab = "plans", onOffer }: {
  open: boolean; onClose: () => void; theme: Theme; offer: BillingOffer; email: string; initialTab?: "plans" | "packs";
  onOffer?: (offer: BillingOffer) => void;
}) {
  const [tab, setTab] = useState<"plans" | "packs">(initialTab);
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [checkout, setCheckout] = useState<CheckoutSession | null>(null);
  const baselineBalance = useRef(offer.billing.balance);
  const finishCheckout = useCallback(() => {
    setCheckout(null);
    window.dispatchEvent(new CustomEvent("autoyt-billing-changed"));
    toast.success("Payment confirmed. Your credits are ready.");
  }, []);
  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    baselineBalance.current = offer.billing.balance;
    if (pendingEmbeddedCheckout) {
      setCheckout(pendingEmbeddedCheckout);
      pendingEmbeddedCheckout = null;
    }
  }, [open, initialTab, offer.billing.balance]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") (checkout ? setCheckout(null) : onClose()); };
    const onExternal = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      if (detail.tab === "packs" || detail.tab === "plans") setTab(detail.tab);
      if (detail.checkout?.clientSecret) {
        pendingEmbeddedCheckout = null;
        setCheckout(detail.checkout);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("autoyt-open-billing", onExternal as EventListener);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("autoyt-open-billing", onExternal as EventListener);
    };
  }, [open, onClose, checkout]);

  useEffect(() => {
    if (!checkout || !open) return;
    let stopped = false;
    const poll = async () => {
      for (let attempt = 0; attempt < 48 && !stopped; attempt++) {
        await new Promise((resolve) => window.setTimeout(resolve, 2500));
        try {
          const result = await syncLingbasePayments();
          if (stopped) return;
          if (result?.credited > 0 || (result?.billing && result.billing.balance > baselineBalance.current)) {
            if (result.billing && onOffer) onOffer({ ...offer, billing: result.billing });
            finishCheckout();
            return;
          }
        } catch {}
      }
    };
    void poll();
    return () => { stopped = true; };
  }, [checkout, open, offer, onOffer, finishCheckout]);

  const beginCheckout = async (label: string, run: () => Promise<CheckoutSession>) => {
    setBusy(label);
    setError("");
    try {
      setCheckout(await run());
    } catch (cause) {
      if ((cause as { code?: string })?.code === "lingbase_connect") return;
      setError(cause instanceof Error ? cause.message : "Checkout could not start.");
    } finally {
      setBusy("");
    }
  };

  if (!open) return null;
  const plans = offer.plans.filter((plan) => plan.priceCents > 0);
  const packs = offer.payment.packs || [];
  const hasPlan = offer.billing.status === "active" && offer.billing.planId !== "pending";

  return createPortal(
    <div className="as-overlay as-billing-overlay" data-theme={theme} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={`as-dialog as-billing-dialog${checkout ? " is-checkout" : ""}`} role="dialog" aria-modal="true" aria-label={checkout ? "Secure checkout" : "Credits and plans"}>
        {checkout ? null : (
          <header className="as-dialog-head">
            <Wallet size={18} className="as-head-icon" aria-hidden="true" />
            <h2>Credits & plans</h2>
            <button type="button" className="ui-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
          </header>
        )}
        {checkout ? (
          <div className="as-dialog-body as-billing-checkout">
            <div className="as-checkout-main">
              <div className="as-checkout-bar">
                <button type="button" className="ui-icon-btn" onClick={() => setCheckout(null)} aria-label="Back"><ArrowLeft size={18} /></button>
                <button type="button" className="ui-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
              </div>
              <div className="as-checkout-scroll">
                <EmbeddedCheckout session={checkout} onPaid={finishCheckout} />
              </div>
            </div>
            <aside className="as-checkout-aside">
              <figure className="as-checkout-photo">
                <img src="/brand/checkout-panel.jpg" alt="" />
                <figcaption>
                  <strong>Every studio, one account</strong>
                  <span>Video, image, voice, and research. Stripe charges the card. Credits show up when the payment clears.</span>
                </figcaption>
              </figure>
            </aside>
          </div>
        ) : (
        <div className="as-dialog-body as-billing-body">
            <div className="as-billing-intro">
              <h3>{hasPlan ? "Manage credits" : "Pick the plan that fits your work"}</h3>
              <p>{hasPlan ? "Your monthly allowance renews with your plan. Buy a credit bundle any time you need more." : "Every plan includes the full workspace. Pay in this window. Credits appear after Stripe confirms the payment."}</p>
            </div>
            <div className="as-billing-controls">
              <Segmented
                label="Billing options"
                value={tab}
                onChange={(next) => setTab(next as "plans" | "packs")}
                options={[
                  { value: "plans", label: "Plans" },
                  { value: "packs", label: "Credit bundles" },
                ]}
              />
              {tab === "plans" ? (
                <Segmented
                  label="Billing period"
                  className="as-billing-period"
                  value={interval}
                  onChange={(next) => setInterval(next as "month" | "year")}
                  options={[
                    { value: "month", label: "Monthly" },
                    { value: "year", label: <>Annual <em>save ~10%</em></> },
                  ]}
                />
              ) : null}
            </div>
            {!offer.payment.available ? <p className="as-error">Checkout is temporarily unavailable. No payment will be taken.</p> : null}
            {error ? <p className="as-error" role="alert">{error}</p> : null}

            {tab === "plans" ? (
              <div className="as-billing-options">
                {plans.map((plan, index) => {
                  const monthly = interval === "year" ? plan.annualPriceCents / 12 : plan.priceCents;
                  const featured = index === 1;
                  const current = hasPlan && offer.billing.planId === plan.id;
                  const label = `Subscribe to ${plan.name}`;
                  const credits = tokensToCredits(plan.monthlyTokens).toLocaleString();
                  return (
                    <article className={`as-billing-option${featured ? " is-featured" : ""}`} key={plan.id}>
                      <div className="as-billing-plan-head">
                        <span className="as-billing-mark" aria-hidden="true">{plan.name.slice(0, 1)}</span>
                        <div className="as-billing-plan-title">
                          <strong>{plan.name}{featured ? <span className="as-billing-badge">Most chosen</span> : null}</strong>
                          <small>{plan.description}</small>
                        </div>
                      </div>
                      <div className="as-billing-hero">
                        <b>{credits}</b>
                        <span>credits / month</span>
                      </div>
                      <div className="as-billing-price">
                        <b>{money(Math.round(monthly))}</b>
                        <span>/ month</span>
                      </div>
                      {interval === "year" ? <small className="as-billing-billed">{money(plan.annualPriceCents)} billed annually</small> : <small className="as-billing-billed">Billed monthly · cancel anytime</small>}
                      <div className="as-billing-features">
                        <span className="as-billing-features-label">Includes</span>
                        {(plan.features || []).map((feature) => <span key={feature}><CircleCheck size={16} aria-hidden="true" />{feature}</span>)}
                      </div>
                      <button type="button" className="as-billing-choose" disabled={!offer.payment.available || Boolean(busy)} onClick={() => void beginCheckout(label, () => chooseLingbasePlan(plan.id, interval, email))}>
                        {busy === label ? "Preparing checkout…" : current ? "Current plan" : `Continue with ${plan.name}`}
                      </button>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="as-billing-packs">
                {!hasPlan || offer.payment.packsRequirePlan ? (
                  <div className="as-billing-empty">
                    <p>Credit bundles unlock after you activate a paid plan. Bundles add bonus credits on top of your monthly allowance.</p>
                    <button type="button" className="as-billing-choose" onClick={() => setTab("plans")}>View plans</button>
                  </div>
                ) : packs.length === 0 ? (
                  <div className="as-billing-empty"><p>Credit bundles will appear here once they are published in LingCloud Payments.</p></div>
                ) : (
                  <div className="as-billing-options as-billing-pack-grid">
                    {packs.map((pack, index) => {
                      const label = `Buy ${pack.name} bundle`;
                      const featured = index === 1;
                      return (
                        <article className={`as-billing-option${featured ? " is-featured" : ""}`} key={pack.id}>
                          <div className="as-billing-plan-head">
                            <span className="as-billing-mark" aria-hidden="true">{pack.name.slice(0, 1)}</span>
                            <div className="as-billing-plan-title">
                              <strong>{pack.name}{featured ? <span className="as-billing-badge">Most chosen</span> : null}</strong>
                              <small>{pack.blurb || "Bonus credits that spend after your monthly allowance"}</small>
                            </div>
                          </div>
                          <div className="as-billing-hero">
                            <b>{pack.credits.toLocaleString()}</b>
                            <span>bonus credits</span>
                          </div>
                          <div className="as-billing-price">
                            <b>{money(pack.priceCents)}</b>
                            <span>one-time</span>
                          </div>
                          <button type="button" className="as-billing-choose" disabled={!offer.payment.available || !pack.available || Boolean(busy)} onClick={() => void beginCheckout(label, () => chooseLingbasePack(pack.id, email))}>
                            {!pack.available ? "Coming soon" : busy === label ? "Preparing checkout…" : `Buy ${pack.name}`}
                          </button>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {hasPlan ? <button type="button" className="as-billing-manage" onClick={() => void openLingbasePortal().catch((cause) => setError(cause instanceof Error ? cause.message : "Billing portal unavailable."))}>Manage subscription</button> : null}
            <small className="as-muted">Payments are processed by Stripe through LingBase. Credits are added only after payment is confirmed.</small>
          </div>
        )}
      </section>
    </div>, document.body,
  );
}

// ---------- site notice ----------
export function SiteNotice({ theme }: { theme: Theme }) {
  const [notice, setNotice] = useState<{ announcement: { tone: string; text: string } | null; maintenance: { message: string } | null } | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return window.sessionStorage.getItem("autoyt-notice-dismissed") || "";
    } catch {
      return "";
    }
  });
  useEffect(() => {
    let alive = true;
    const load = () => fetch("/api/app/notice", { cache: "no-store" }).then((r) => r.json()).then((data) => alive && setNotice(data)).catch(() => {});
    void load();
    const timer = window.setInterval(load, 5 * 60 * 1000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);
  if (notice?.maintenance) {
    return (
      <div className="as-notice is-warning" data-theme={theme} role="status">
        <TriangleAlert size={15} aria-hidden="true" />
        <span>{notice.maintenance.message}</span>
      </div>
    );
  }
  const a = notice?.announcement;
  if (!a || dismissed === a.text) return null;
  return (
    <div className={`as-notice is-${a.tone}`} data-theme={theme} role="status">
      {a.tone === "warning" ? <TriangleAlert size={15} aria-hidden="true" /> : a.tone === "success" ? <Megaphone size={15} aria-hidden="true" /> : <Info size={15} aria-hidden="true" />}
      <span>{a.text}</span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          setDismissed(a.text);
          try {
            window.sessionStorage.setItem("autoyt-notice-dismissed", a.text);
          } catch {}
        }}
      >
        <X size={14} />
      </button>
    </div>
  );
}

// ---------- support ----------
export function SupportDialog({ open, onClose, theme }: { open: boolean; onClose: () => void; theme: Theme }) {
  const [view, setView] = useState<"list" | "new" | string>("list");
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [form, setForm] = useState({ subject: "", category: "general", body: "" });
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadTickets = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/support/tickets", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Couldn't load your requests.");
      setTickets(data.tickets);
      if (!data.tickets.length) setView("new");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load your requests.");
      setTickets([]);
    }
  }, []);
  useEffect(() => {
    if (!open) return;
    setView("list");
    setTickets(null);
    void loadTickets();
  }, [open, loadTickets]);
  useEffect(() => {
    if (!open || view === "list" || view === "new") return;
    setThread(null);
    fetch(`/api/support/tickets/${encodeURIComponent(view)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => setThread(data.ticket || null))
      .catch(() => setError("Couldn't open this request."));
  }, [open, view]);

  const post = async (url: string, body: unknown) => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Couldn't send that. Try again.");
      return data.ticket as Thread;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send that. Try again.");
      return null;
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  const isThread = view !== "list" && view !== "new";
  return (
    <Dialog title={view === "new" ? "New request" : isThread ? thread?.subject || "Request" : "Help & support"} size="md" onClose={onClose}>
      <div className="as-scope" data-theme={theme}>
        {view !== "list" && (tickets?.length || isThread) ? (
          <button type="button" className="ui-btn as-back" onClick={() => setView("list")}><ArrowLeft size={15} aria-hidden="true" /> Your requests</button>
        ) : null}
          {error ? <p className="as-error" role="alert">{error}</p> : null}
          {view === "list" ? (
            tickets === null ? <p className="as-muted as-center"><Loader2 size={16} className="ui-spin" aria-hidden="true" /> Loading…</p> : (
              <>
                <button type="button" className="as-new" onClick={() => setView("new")}><Plus size={16} aria-hidden="true" /> New request</button>
                <ul className="as-tickets">
                  {tickets.map((t) => (
                    <li key={t.id}>
                      <button type="button" onClick={() => setView(t.id)}>
                        <span>
                          <strong>{t.subject}</strong>
                          <small>{t.lastAuthor === "admin" ? "Support replied" : "Waiting for support"} · {new Date(t.lastMessageAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</small>
                        </span>
                        <span className={`as-status is-${t.status}`}>{STATUS_LABEL[t.status] || t.status}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )
          ) : view === "new" ? (
            <form
              className="as-form"
              onSubmit={async (event) => {
                event.preventDefault();
                const ticket = await post("/api/support/tickets", form);
                if (ticket) {
                  toast.success("Request sent. We'll reply here and you'll see it in Help & support.");
                  setForm({ subject: "", category: "general", body: "" });
                  await loadTickets();
                  setView(ticket.id);
                }
              }}
            >
              <label>Topic
                <select className="ui-select" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
                  <option value="general">General question</option>
                  <option value="billing">Billing and credits</option>
                  <option value="bug">Something's broken</option>
                  <option value="account">My account</option>
                  <option value="feature">Feature idea</option>
                </select>
              </label>
              <label>Subject
                <input className="ui-input" value={form.subject} maxLength={160} onChange={(event) => setForm({ ...form, subject: event.target.value })} placeholder="e.g. My video export stopped at 85%" required />
              </label>
              <label>What happened?
                <textarea className="ui-textarea" rows={5} value={form.body} maxLength={8000} onChange={(event) => setForm({ ...form, body: event.target.value })} placeholder="What you were doing, what you expected, and what you saw instead." required />
              </label>
              <button type="submit" className="ui-btn is-primary" disabled={busy || !form.subject.trim() || !form.body.trim()}>{busy ? <Loader2 size={15} className="ui-spin" aria-hidden="true" /> : null} Send request</button>
            </form>
          ) : !thread ? <p className="as-muted as-center"><Loader2 size={16} className="ui-spin" aria-hidden="true" /> Loading…</p> : (
            <>
              <ol className="as-thread">
                {thread.messages.map((m) => (
                  <li key={m.id} className={`is-${m.authorType}`}>
                    <small>{m.authorType === "admin" ? "AutoYT support" : "You"} · {new Date(m.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</small>
                    <p>{m.body}</p>
                  </li>
                ))}
              </ol>
              <form
                className="as-form"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const ticket = await post(`/api/support/tickets/${thread.id}/messages`, { body: reply });
                  if (ticket) {
                    setThread(ticket);
                    setReply("");
                  }
                }}
              >
                <textarea className="ui-textarea" rows={3} value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Add a reply" aria-label="Reply" />
                <button type="submit" className="ui-btn is-primary" disabled={busy || !reply.trim()}>{busy ? <Loader2 size={15} className="ui-spin" aria-hidden="true" /> : null} Send</button>
              </form>
            </>
          )}
      </div>
    </Dialog>
  );
}

/** In-app account deletion (App Store 5.1.1(v)); the server side is POST /api/account/delete. */
export function DeleteAccountDialog({ open, onClose, theme }: { open: boolean; onClose: () => void; theme: Theme }) {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [subscriptionWarning, setSubscriptionWarning] = useState("");
  useEffect(() => {
    if (!open) return;
    setConfirm("");
    setError("");
    setSubscriptionWarning("");
  }, [open]);
  if (!open) return null;
  const ready = confirm.trim().toUpperCase() === "DELETE";
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/account/delete", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: "DELETE", acknowledgeSubscription: Boolean(subscriptionWarning) }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 409 && data.code === "subscription_active") {
        setSubscriptionWarning(data.error);
        return;
      }
      if (!response.ok) throw new Error(data.error || "Couldn't delete your account. Try again or contact support.");
      toast.success("Your account and its data were deleted.");
      window.setTimeout(() => window.location.assign("/"), 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete your account. Try again or contact support.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title="Delete account" size="sm" dismissible={!busy} onClose={() => !busy && onClose()}>
      <div className="as-scope as-delete" data-theme={theme}>
          <p className="as-delete-lede">This permanently deletes your AutoYT account and everything in it: projects, renders, agents, connected channels, voices, and history. It can't be undone.</p>
          <p className="as-muted">Records of past payments are kept as required for tax and refunds, without your name or email.</p>
          {subscriptionWarning ? <p className="as-delete-warning" role="alert"><TriangleAlert size={16} aria-hidden="true" /> {subscriptionWarning}</p> : null}
          {error ? <p className="as-error" role="alert">{error}</p> : null}
          <form className="as-form" onSubmit={(event) => { event.preventDefault(); if (ready && !busy) void submit(); }}>
            <label>Type DELETE to confirm
              <input className="ui-input" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="DELETE" aria-describedby="as-delete-title" />
            </label>
            <div className="as-delete-actions">
              <button type="button" className="ui-btn" onClick={onClose} disabled={busy}>Cancel</button>
              <button type="submit" className="ui-btn is-danger" disabled={!ready || busy}>
                {busy ? <Loader2 size={15} className="ui-spin" aria-hidden="true" /> : null}
                {subscriptionWarning ? "Delete anyway" : "Delete account"}
              </button>
            </div>
          </form>
      </div>
    </Dialog>
  );
}
