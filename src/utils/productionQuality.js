// Fast, provider-neutral preflight checks. Media-specific validation still
// happens during render (ffprobe); this catches incomplete plans before cost is
// incurred and gives every surface the same language for approval gates.
import { productionProfile } from "./productionProfiles.js";
import { speakerName } from "./dramaTemplates.js";

const check = (id, label, ok, detail, { blocking = true } = {}) => ({ id, label, status: ok ? "pass" : blocking ? "blocked" : "warn", detail });

export function evaluateCreatorQuality(project, requestedProfile = "") {
  const outputs = project?.outputs || {};
  const settings = project?.metadata?.settings || {};
  const profile = productionProfile(requestedProfile || settings.productionProfile || settings.aspect || "16:9");
  const scenes = Array.isArray(outputs.visualPlan?.scenes) ? outputs.visualPlan.scenes : [];
  const script = String(outputs.script?.draft || "").trim();
  const voice = outputs.voiceover || {};
  const hasVoice = Boolean(voice.asset || voice.duration || voice.segments?.length);
  const hasMusic = settings.musicPolicy === "none" || Boolean(outputs.soundtrack?.asset);
  const checks = [
    check("script", "Script", Boolean(script), script ? "Narration is ready." : "Save a narration script first."),
    check("voiceover", "Voiceover", hasVoice, hasVoice ? "A narration track is available." : "Generate or import narration first."),
    check("scenes", "Scene plan", scenes.length > 0, scenes.length ? `${scenes.length} scenes planned.` : "Create a visual scene plan first."),
    check("scene-assets", "Scene assets", scenes.length > 0 && scenes.every((scene) => scene?.asset), scenes.length && scenes.every((scene) => scene?.asset) ? "Every scene has a visual asset." : "Generate every scene asset before export."),
    check("music", "Soundtrack", hasMusic, hasMusic ? settings.musicPolicy === "none" ? "Export is configured without music." : "A soundtrack is available." : "Import a licensed soundtrack or choose no music.", { blocking: true }),
    check("rights", "Rights", Boolean(settings.rightsConfirmed), settings.rightsConfirmed ? "Rights and provenance are confirmed." : "Confirm rights and provenance before export."),
    check("profile", "Delivery profile", settings.aspect === profile.aspect || !settings.aspect, `${profile.name} · ${profile.label}`, { blocking: false }),
    check("stale", "Fresh outputs", !Object.values(outputs).some((value) => value?.stale), "One or more outputs are stale; regenerate them before export.", { blocking: false }),
  ];
  const blocked = checks.filter((item) => item.status === "blocked");
  const warnings = checks.filter((item) => item.status === "warn");
  const passed = checks.filter((item) => item.status === "pass");
  return {
    profile,
    checks,
    score: Math.round((passed.length / checks.length) * 100),
    status: blocked.length ? "blocked" : warnings.length ? "needs_review" : "ready",
    blockers: blocked.map((item) => item.detail),
    warnings: warnings.map((item) => item.detail),
    reviewedAt: Date.now(),
  };
}

export function summarizeQuality(review) {
  if (!review) return "No preflight review yet.";
  if (review.status === "ready") return `Ready to render · ${review.score}% preflight score`;
  if (review.status === "needs_review") return `Review ${review.warnings?.length || 0} warning${review.warnings?.length === 1 ? "" : "s"} before rendering`;
  return `${review.blockers?.length || 1} blocker${review.blockers?.length === 1 ? "" : "s"} before rendering`;
}

// Drama has a different asset graph from Create Video: every scene must carry
// its board, dialogue track, and generated clip before the final cut can be
// assembled. Keeping this check here gives both editors and the chat agent the
// same approval language without coupling it to a video provider.
export function evaluateDramaQuality(episode, series, aspect = "9:16", view = null) {
  const production = episode?.metadata?.production || {};
  const settings = production.settings || {};
  const scenes = Array.isArray(production.script?.scenes) ? production.script.scenes : [];
  const sceneState = view?.scenes || production.scenes || {};
  const cast = Array.isArray(series?.metadata?.drama?.cast) ? series.metadata.drama.cast : [];
  const voices = series?.metadata?.drama?.voices || {};
  const characters = series?.metadata?.production?.characters || {};
  const hasBoards = scenes.length > 0 && scenes.every((scene) => sceneState[scene.id]?.board?.asset && !sceneState[scene.id]?.board?.stale);
  const hasVoices = scenes.length > 0 && scenes.every((scene) => sceneState[scene.id]?.voice?.asset && !sceneState[scene.id]?.voice?.stale);
  const hasClips = scenes.length > 0 && scenes.every((scene) => sceneState[scene.id]?.clip?.asset && !sceneState[scene.id]?.clip?.stale);
  const checks = [
    check("screenplay", "Screenplay", scenes.length > 0, scenes.length ? `${scenes.length} scenes written.` : "Write the screenplay before rendering."),
    check("cast", "Cast continuity", cast.length === 0 || cast.every((character) => character.id && characters[character.id]?.locked), "Lock an identity sheet for every cast member."),
    check("voices", "Dialogue voices", cast.length === 0 || cast.every((character) => voices[speakerName(character.name)]), "Assign a voice to every character before rendering dialogue."),
    check("boards", "Storyboards", hasBoards, "Generate or refresh every scene storyboard."),
    check("dialogue", "Dialogue tracks", hasVoices, "Generate or refresh every scene dialogue track."),
    check("clips", "Scene clips", hasClips, "Render every scene clip, then rerender stale clips."),
    check("aspect", "Scene format", Boolean(aspect), `${aspect} delivery is selected.`, { blocking: false }),
    check("subtitles", "Subtitle policy", settings.subtitles !== undefined, settings.subtitles ? "Subtitles will be burned in." : "Subtitles are disabled.", { blocking: false }),
  ];
  const blocked = checks.filter((item) => item.status === "blocked");
  const warnings = checks.filter((item) => item.status === "warn");
  const passed = checks.filter((item) => item.status === "pass");
  return {
    profile: productionProfile(aspect),
    checks,
    score: Math.round((passed.length / checks.length) * 100),
    status: blocked.length ? "blocked" : warnings.length ? "needs_review" : "ready",
    blockers: blocked.map((item) => item.detail),
    warnings: warnings.map((item) => item.detail),
    reviewedAt: Date.now(),
  };
}
