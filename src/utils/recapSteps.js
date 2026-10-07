// Movie to Recap's steps, shared by the server (which stamps when each starts and ends) and the progress
// screen (which shows elapsed time, a countdown, and each step's time). A recap's progress runs 0..1:
// the analysis phase ends at 0.75 with the script waiting for review, the render phase runs to 1.
// Time estimates come from real runs (a 2 h 25 min AV1 film into a 10-minute recap took about 70 minutes
// of work) and scale with the film's length and the recap's; once a step is under way, its own progress
// takes over (see stepEta).

export const RECAP_STEPS = [
  { id: "download", label: "Download", phase: "analyze", from: 0, until: 0.16 },
  { id: "transcribe", label: "Transcribe", phase: "analyze", from: 0.16, until: 0.42 },
  { id: "frames", label: "Sample scenes", phase: "analyze", from: 0.42, until: 0.45 },
  { id: "watch", label: "Watch the film", phase: "analyze", from: 0.45, until: 0.7 },
  { id: "write", label: "Write the script", phase: "analyze", from: 0.7, until: 0.75 },
  { id: "narrate", label: "Narrate", phase: "render", from: 0.75, until: 0.83 },
  { id: "plan", label: "Match footage", phase: "render", from: 0.83, until: 0.85 },
  { id: "cut", label: "Cut and mix", phase: "render", from: 0.85, until: 0.97 },
  { id: "deliver", label: "Deliver", phase: "render", from: 0.97, until: 1.0001 },
];

/** The step a progress value falls in. */
export function stepAt(progress) {
  const p = Math.max(0, Math.min(1, Number(progress) || 0));
  return RECAP_STEPS.find((step) => p < step.until) || RECAP_STEPS[RECAP_STEPS.length - 1];
}

/** How far through its own step a progress value is (0..1). */
export function stepFraction(progress) {
  const step = stepAt(progress);
  return Math.max(0, Math.min(1, ((Number(progress) || 0) - step.from) / (step.until - step.from)));
}

/** Expected seconds for each step, from the film's length (seconds) and the recap's options. */
export function stepEstimates({ filmSeconds = 6000, longMinutes = 12, shortSeconds = 75, formats = ["long"] } = {}) {
  const film = Math.max(600, Number(filmSeconds) || 6000);
  const narration = (formats.includes("long") ? longMinutes * 60 : 0) + (formats.includes("short") ? shortSeconds : 0);
  return {
    download: 150,
    transcribe: film * 0.055,
    frames: film * 0.17,
    watch: film * 0.053,
    write: 150,
    narrate: narration * 0.6 + 30,
    plan: 90 + narration * 0.15,
    cut: narration * 1.6 + 60,
    deliver: 60,
  };
}

/**
 * Seconds left in the current step: the estimate at first, then what its own progress implies once it is
 * a little way in (blended, so a slow start doesn't swing the countdown wildly).
 */
export function stepEta(step, fraction, elapsedSeconds, estimate) {
  const planned = Math.max(0, estimate - elapsedSeconds);
  if (fraction < 0.08 || elapsedSeconds < 20) return planned;
  const observed = (elapsedSeconds * (1 - fraction)) / fraction;
  const weight = Math.min(0.85, fraction * 1.5);
  return Math.max(0, observed * weight + planned * (1 - weight));
}

/** Seconds left in this phase: the rest of the current step plus every later step of the same phase. */
export function phaseEta(progress, stepElapsedSeconds, estimates) {
  const step = stepAt(progress);
  let left = stepEta(step, stepFraction(progress), stepElapsedSeconds, estimates[step.id] || 60);
  for (const later of RECAP_STEPS) if (later.from >= step.until && later.phase === step.phase) left += estimates[later.id] || 60;
  return left;
}

// How fast narration plays, shared by the script writer (its word budget) and the storyboard (its length
// meter). Measured on a finished recap: Kokoro at the brisk pace with pauses trimmed ran 212 words a
// minute, so the voice itself speaks about 193, and each pace speeds that up.
export const RECAP_PACE = { natural: 1, brisk: 1.1, fast: 1.2 };
export const NARRATION_WPM = 193;
export const LINE_PAUSE = 0.12;
/** Words a minute of finished narration at a pace. */
export const narrationWpm = (pace = "brisk") => NARRATION_WPM * (RECAP_PACE[pace] || RECAP_PACE.brisk);
