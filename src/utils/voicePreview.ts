// One shared preview <audio> for every quick "play this voice/line" button
// (VoicePicker rows, Drama cast lines). It joins AudioPlayer's one-at-a-time
// rule, so a preview pauses any player and any player pauses the preview, and
// every button showing a preview sees the same state.
import { useEffect, useSyncExternalStore } from "react";
import { claimPlayback } from "../components/AudioPlayer";

export type PreviewStatus = "loading" | "playing" | "error";
type State = { key: string; status: PreviewStatus } | null;

let audio: HTMLAudioElement | null = null;
let state: State = null;
const listeners = new Set<() => void>();
const set = (next: State) => {
  state = next;
  listeners.forEach((listener) => listener());
};

export const voicePreviewUrl = (voiceId: string) => `/api/voicebox/profiles/${encodeURIComponent(voiceId)}/preview`;

export function stopPreview() {
  audio?.pause();
  set(null);
}

/** Plays `src` under `key`, or stops it if that key is already playing. */
export async function togglePreview(key: string, src: string) {
  if (state?.key === key && state.status !== "error") return stopPreview();
  audio ??= new Audio();
  const el = audio;
  el.pause();
  set({ key, status: "loading" });
  el.src = src;
  el.onplaying = () => state?.key === key && set({ key, status: "playing" });
  el.onended = () => state?.key === key && set(null);
  // Another player claimed playback (or the user paused): clear the button.
  el.onpause = () => state?.key === key && state.status === "playing" && set(null);
  el.onerror = () => state?.key === key && set({ key, status: "error" });
  try {
    claimPlayback(el);
    await el.play();
  } catch (error) {
    if ((error as Error)?.name !== "AbortError" && state?.key === key) set({ key, status: "error" });
  }
}

/** Current preview state; stops this component's preview when it unmounts. */
export function usePreview() {
  const current = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
  useEffect(() => () => {
    if (state) stopPreview();
  }, []);
  return { state: current, toggle: togglePreview, stop: stopPreview };
}
