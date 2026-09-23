import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isVoiceReady, loadVoiceProfiles, VOICE_NAME_OVERRIDES_KEY, VOICE_PROFILES_ROUTE, voiceLabel } from "./voiceProfiles";

describe("shared voice profiles", () => {
  beforeEach(() => {
    // Node's built-in localStorage shadows jsdom's, so provide a plain store.
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      clear: () => store.clear(),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("loads cloned and preset voices from the TTS route with TTS names", async () => {
    window.localStorage.setItem(VOICE_NAME_OVERRIDES_KEY, JSON.stringify({ c1: "My narrator" }));
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      profiles: [
        { id: "c1", name: "clone-raw", voiceType: "cloned", sampleCount: 2 },
        { id: "c2", name: "Empty clone", voiceType: "cloned", sampleCount: 0 },
        { id: "p1", name: "Prime", voiceType: "preset" },
      ],
    })));
    vi.stubGlobal("fetch", fetchMock);
    const { profiles, error } = await loadVoiceProfiles();
    expect(fetchMock).toHaveBeenCalledWith(VOICE_PROFILES_ROUTE, expect.anything());
    expect(error).toBe("");
    expect(profiles.map((voice) => voice.name)).toEqual(["My narrator", "Empty clone", "Prime"]);
    expect(profiles.map(isVoiceReady)).toEqual([true, false, true]);
    expect(voiceLabel(profiles[0])).toBe("My narrator · cloned");
    expect(voiceLabel(profiles[1])).toMatch(/needs a sample/);
  });

  it("reports the service error instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: false, error: "fetch failed" }), { status: 503 })));
    expect(await loadVoiceProfiles()).toEqual({ profiles: [], error: "fetch failed" });
  });
});
