// One voice list for every surface: Text to Speech, Create Video, and Styles all
// read /api/voicebox/profiles, so a voice cloned or renamed in TTS shows up
// everywhere with the same name and readiness.

export type VoiceProfile = {
  id: string;
  name: string;
  description?: string;
  language?: string;
  voiceType?: string;
  defaultEngine?: string;
  presetEngine?: string;
  sampleCount?: number;
};

export const VOICE_PROFILES_ROUTE = "/api/voicebox/profiles";
export const VOICE_NAME_OVERRIDES_KEY = "autoyt-tts-voice-names";

/** A cloned voice needs at least one reference sample before it can speak. */
export function isVoiceReady(voice?: VoiceProfile | null) {
  if (!voice) return false;
  return voice.voiceType !== "cloned" || Number(voice.sampleCount || 0) > 0;
}

export function readVoiceNameOverrides(): Record<string, string> {
  try {
    const stored = window.localStorage.getItem(VOICE_NAME_OVERRIDES_KEY);
    const parsed = stored ? JSON.parse(stored) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function voiceLabel(voice: VoiceProfile) {
  if (voice.voiceType !== "cloned") return voice.name;
  return isVoiceReady(voice) ? `${voice.name} · cloned` : `${voice.name} · cloned, needs a sample`;
}

/** Fetches voices from the shared route and applies the names users set in TTS. */
export async function loadVoiceProfiles(signal?: AbortSignal): Promise<{ profiles: VoiceProfile[]; error: string }> {
  try {
    const response = await fetch(VOICE_PROFILES_ROUTE, { signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.success === false)
      return { profiles: [], error: data?.error || "Voice service is unavailable." };
    const overrides = readVoiceNameOverrides();
    const profiles = (Array.isArray(data.profiles) ? data.profiles : []).map((voice: VoiceProfile) => ({
      ...voice,
      name: overrides[voice.id] || voice.name,
    }));
    return { profiles, error: "" };
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    return { profiles: [], error: "Voice service is unavailable." };
  }
}
