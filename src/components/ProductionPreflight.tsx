import { Check, CircleAlert, Loader2, RotateCcw } from "lucide-react";
import "./ProductionPreflight.css";

export type ProductionReview = {
  status: "blocked" | "needs_review" | "ready";
  score: number;
  checks: Array<{ id: string; label: string; status: "pass" | "warn" | "blocked"; detail: string }>;
};

export function ProductionPreflight({ review, busy, onCheck }: { review?: ProductionReview | null; busy: boolean; onCheck: () => void }) {
  const pending = review?.checks.filter((item) => item.status !== "pass") || [];
  const passed = review?.checks.filter((item) => item.status === "pass") || [];
  const status = !review ? "Not checked" : review.status === "ready" ? "Ready" : review.status === "needs_review" ? "Review suggested" : "Needs work";

  return (
    <section className="maker-preflight" aria-label="Production preflight">
      <div className="maker-preflight-head">
        <div className="maker-preflight-heading">
          <span className="maker-preflight-label">Production check</span>
          <div className="maker-preflight-title">
            <strong>{status}</strong>
            {review && <span className={`maker-preflight-state is-${review.status}`}>{passed.length}/{review.checks.length} passed</span>}
          </div>
        </div>
        <button type="button" className="maker-preflight-action" onClick={onCheck} disabled={busy} aria-label={review ? "Check production again" : "Check production"}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />}
          <span>{busy ? "Checking" : review ? "Recheck" : "Check"}</span>
        </button>
      </div>
      {!review && <p className="maker-preflight-empty">Check the project before the final render.</p>}
      {pending.length > 0 && (
        <ul className="maker-preflight-issues">
          {pending.map((item) => (
            <li key={item.id} className={`is-${item.status}`}>
              <CircleAlert size={15} aria-hidden="true" />
              <div><strong>{item.label}</strong><span>{item.detail}</span></div>
            </li>
          ))}
        </ul>
      )}
      {review?.status === "ready" && <p className="maker-preflight-ready"><Check size={15} /> All production checks passed.</p>}
      {passed.length > 0 && pending.length > 0 && (
        <details className="maker-preflight-passed">
          <summary>{passed.length} passed checks</summary>
          <ul>{passed.map((item) => <li key={item.id}><Check size={13} /> {item.label}</li>)}</ul>
        </details>
      )}
    </section>
  );
}
