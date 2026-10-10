// Agent auto-remake: settings an agent uses to re-voice (and optionally swap
// an avatar into) every video before it posts. Shared by the server run and
// the agent setup UI.
import { AVATAR_LAYOUTS, AVATAR_PROVIDERS } from "./avatarRemake.js";

export const MAX_REMAKE_FACES = 4;
export const REMAKE_FAILURE_MODES = ["skip", "original"];

export const DEFAULT_AGENT_REMAKE = Object.freeze({
  enabled: false,
  profileId: "",
  rewrite: true,
  narrationStyleId: "",
  keepBackground: true,
  backgroundVolume: 0.35,
  captions: false,
  onFailure: "skip",
  rightsConfirmed: false,
  voiceConsentConfirmed: false,
  avatar: Object.freeze({ enabled: false, faces: [], layout: "split", provider: "preview" }),
});

const FACE_ID = /^face_[a-z0-9-]{6,64}$/;
const FACE_EXT = [".jpg", ".jpeg", ".png", ".webp"];

export function normalizeRemakeFace(raw) {
  const id = String(raw?.id || "");
  if (!FACE_ID.test(id)) return null;
  const ext = FACE_EXT.includes(String(raw?.ext || "").toLowerCase()) ? String(raw.ext).toLowerCase() : ".jpg";
  return { id, ext, name: String(raw?.name || "Avatar").slice(0, 80) };
}

export function normalizeAgentRemake(raw = {}) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const a = r.avatar && typeof r.avatar === "object" ? r.avatar : {};
  const faces = (Array.isArray(a.faces) ? a.faces : []).map(normalizeRemakeFace).filter(Boolean);
  const unique = faces.filter((face, index) => faces.findIndex((other) => other.id === face.id) === index).slice(0, MAX_REMAKE_FACES);
  const volume = Number(r.backgroundVolume);
  return {
    enabled: r.enabled === true,
    profileId: String(r.profileId || "").trim().slice(0, 200),
    rewrite: r.rewrite !== false,
    narrationStyleId: String(r.narrationStyleId || "").trim().slice(0, 120),
    keepBackground: r.keepBackground !== false,
    backgroundVolume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : DEFAULT_AGENT_REMAKE.backgroundVolume,
    captions: r.captions === true,
    onFailure: REMAKE_FAILURE_MODES.includes(r.onFailure) ? r.onFailure : "skip",
    rightsConfirmed: r.rightsConfirmed === true,
    voiceConsentConfirmed: r.voiceConsentConfirmed === true,
    avatar: {
      enabled: a.enabled === true,
      faces: unique,
      layout: AVATAR_LAYOUTS.includes(a.layout) ? a.layout : "split",
      provider: AVATAR_PROVIDERS.includes(a.provider) ? a.provider : "preview",
    },
  };
}

// Why an enabled remake can't run yet, or "" when it can. The run checks this
// before spending anything; the setup screen shows the same sentence.
export function remakeBlocker(remake, providers = {}) {
  const r = normalizeAgentRemake(remake);
  if (!r.enabled) return "";
  if (!r.profileId) return "Choose the voice the agent should narrate in.";
  if (!r.rightsConfirmed) return "Confirm you have the right to edit the videos this agent posts.";
  if (!r.voiceConsentConfirmed) return "Confirm you own the voice or have the speaker's consent.";
  if (r.avatar.enabled) {
    if (!r.avatar.faces.length) return "Add at least one avatar photo, or switch avatar mode off.";
    if (providers[r.avatar.provider] && !providers[r.avatar.provider].available) return "That avatar engine isn't set up on the server. Choose another engine.";
  }
  return "";
}

// Avatars take turns: each new upload uses the next photo in the list.
export function pickRemakeFace(remake, uploadsSoFar = 0) {
  const faces = normalizeAgentRemake(remake).avatar.faces;
  if (!faces.length) return null;
  const n = Math.max(0, Math.floor(Number(uploadsSoFar) || 0));
  return faces[n % faces.length];
}

// The two Voice Studio job requests a remake makes: the voiceover, then (with
// avatar mode on) the avatar swap on top of it. Captions go on the last step.
export function remakeJobBodies(remake, { seedJobId = "", narrationStyle = null, sourceTitle = "" } = {}) {
  const r = normalizeAgentRemake(remake);
  const subtitles = { enabled: r.captions };
  const voiceover = {
    action: "process",
    mode: "voiceover",
    profileId: r.profileId,
    profileName: `${sourceTitle || "Agent"} narrator`.slice(0, 100),
    rewrite: r.rewrite,
    narrationStyle: narrationStyle || undefined,
    preserveBackground: r.keepBackground,
    backgroundVolume: r.backgroundVolume,
    preserveCharacterVoices: false,
    preserveDialogue: true,
    requireSourceVoiceClone: false,
    rightsConfirmed: r.rightsConfirmed,
    voiceConsentConfirmed: r.voiceConsentConfirmed,
    renderJobId: seedJobId,
    subtitles: r.avatar.enabled ? { enabled: false } : subtitles,
  };
  const avatar = r.avatar.enabled
    ? {
        action: "process",
        mode: "avatar",
        rightsConfirmed: r.rightsConfirmed,
        voiceConsentConfirmed: r.voiceConsentConfirmed,
        avatarRemake: { layout: r.avatar.layout, provider: r.avatar.provider },
        subtitles,
      }
    : null;
  return { voiceover, avatar };
}

// Old /voiceover links and background-job shortcuts hand a video to an agent's Remake tab. Kept here,
// apart from the Remake tab itself, so the app shell can hand off without loading the whole studio.
export const REMAKE_HANDOFF_KEY = "autoyt-remake-upload";
/** @param {string | undefined} agentId @param {string | undefined} uploadId */
export function handOffRemakeUpload(agentId, uploadId) {
  if (!agentId || !uploadId) return;
  try {
    window.sessionStorage.setItem(REMAKE_HANDOFF_KEY, JSON.stringify({ agentId, uploadId, at: Date.now() }));
  } catch {}
}
