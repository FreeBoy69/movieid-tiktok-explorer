import { openRouterDecision } from "./openRouterClient.js";

const MAX_ITEMS = 10;
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

/**
 * Re-rank a small, already-eligible list with Jev's bounded rubric. Any
 * provider/schema/low-confidence issue leaves the deterministic ordering intact.
 * @param {Array<any>} items
 * @param {{ context?: any, describe?: (item: any) => any, rubric?: string, scoreField?: string, minimumConfidence?: number, decision?: (input: any) => Promise<any> }} [options]
 */
export async function rerankWithJev(items = [], { context = {}, describe = (item) => item, rubric, scoreField = "jevScore", minimumConfidence = 0.55, decision = openRouterDecision } = {}) {
  const input = Array.isArray(items) ? items : [];
  const candidates = input.slice(0, MAX_ITEMS);
  if (candidates.length < 2 || typeof rubric !== "string" || !rubric.trim()) return input;
  try {
    const questions = Object.fromEntries(candidates.map((item, index) => [`item_${index}`, {
      type: "score",
      instructions: `Rate candidate ${index + 1} for the stated task using only the provided state.`,
      criteria: ["Poor fit", "Weak fit", "Plausible fit", "Strong fit", "Excellent fit"],
    }]));
    const state = {
      task: String(rubric).slice(0, 800),
      context,
      candidates: candidates.map((item, index) => ({ id: `item_${index}`, ...describe(item) })),
    };
    const response = await decision({ state, questions });
    const answers = response?.answers;
    if (!answers || typeof answers !== "object") return input;
    const scored = candidates.map((item, index) => {
      const answer = answers[`item_${index}`];
      const confidence = clamp(answer?.confidence ?? 0, 0, 1);
      const score = clamp(answer?.score ?? -1, 0, 4);
      return { item, index, confidence, score, usable: confidence >= minimumConfidence && Number.isFinite(Number(answer?.score)) };
    });
    if (scored.length < 2 || scored.some((row) => !row.usable)) return input;
    const reordered = scored.sort((a, b) => b.score - a.score || b.confidence - a.confidence || a.index - b.index);
    return [
      ...reordered.map((row) => ({ ...row.item, [scoreField]: Math.round((row.score / 4) * 100), jevConfidence: Math.round(row.confidence * 100) })),
      ...input.slice(candidates.length),
    ];
  } catch (error) {
    if (error?.name !== "UsageBlockedError") console.warn("[jev] ranking advisory unavailable:", error instanceof Error ? error.message : error);
    return input;
  }
}

/** Recovery is advisory only; existing retry limits and hard failure policy remain in force. */
export async function recommendAutomationRecovery(errorText, decision = openRouterDecision) {
  const text = String(errorText || "").slice(0, 1600);
  if (!text) return null;
  try {
    const response = await decision({
      state: { failure: text },
      questions: {
        recovery: {
          type: "choice",
          instructions: "Which recovery path is most appropriate for this automation failure? Do not suggest repeating a permanent configuration or permission failure.",
          criteria: {
            retry: "The failure appears transient and a bounded retry of the same operation is reasonable.",
            fallback: "The primary service or model failed; try an already-configured fallback if one exists.",
            pause: "The failure needs user/admin attention, or retrying risks repeated failure or side effects.",
          },
        },
      },
    });
    const answer = response?.answers?.recovery;
    const confidence = clamp(answer?.confidence ?? 0, 0, 1);
    return ["retry", "fallback", "pause"].includes(answer?.choice) ? { action: answer.choice, confidence } : null;
  } catch (error) {
    if (error?.name !== "UsageBlockedError") console.warn("[jev] recovery advisory unavailable:", error instanceof Error ? error.message : error);
    return null;
  }
}

/** Adds a non-blocking next-step hint to deterministic drama preflight results. */
export async function triageDramaPreflight(review, decision = openRouterDecision) {
  if (!review || review.status === "ready") return null;
  try {
    const response = await decision({
      state: {
        status: review.status,
        score: review.score,
        checks: (review.checks || []).map(({ id, label, status, detail }) => ({ id, label, status, detail: String(detail || "").slice(0, 180) })),
      },
      questions: {
        next_step: {
          type: "choice",
          instructions: "Choose the most useful next step for a drama production preflight. This is guidance only; deterministic blockers remain authoritative.",
          criteria: {
            prepare_assets: "Required storyboards, dialogue tracks, cast references, or scene clips are missing or stale; generate or refresh those assets first.",
            inspect_continuity: "The asset set exists, but cast or scene continuity needs human inspection before final rendering.",
            review_settings: "Delivery settings such as aspect ratio or subtitles need attention.",
            human_review: "The preflight is ambiguous or should be reviewed by a person before expensive rendering.",
          },
        },
      },
    });
    const answer = response?.answers?.next_step;
    const confidence = clamp(answer?.confidence ?? 0, 0, 1);
    if (confidence < 0.6) return null;
    return ["prepare_assets", "inspect_continuity", "review_settings", "human_review"].includes(answer?.choice)
      ? { action: answer.choice, confidence }
      : null;
  } catch (error) {
    if (error?.name !== "UsageBlockedError") console.warn("[jev] drama preflight advisory unavailable:", error instanceof Error ? error.message : error);
    return null;
  }
}
