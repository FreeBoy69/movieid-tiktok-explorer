import { describe, expect, it } from "vitest";
import { normalizeAgentRemake, pickRemakeFace, remakeBlocker, remakeJobBodies } from "./agentRemake.js";

const ready = {
  enabled: true,
  profileId: "voice_1",
  rightsConfirmed: true,
  voiceConsentConfirmed: true,
};
const face = (n: number) => ({ id: `face_00000${n}aa`, ext: ".png", name: `Face ${n}` });

describe("agent remake settings", () => {
  it("defaults to off with safe values and drops junk", () => {
    expect(normalizeAgentRemake(undefined)).toMatchObject({ enabled: false, rewrite: true, keepBackground: true, captions: false, onFailure: "skip", avatar: { enabled: false, faces: [], layout: "split", provider: "preview" } });
    const r = normalizeAgentRemake({ enabled: "yes", backgroundVolume: 7, onFailure: "explode", avatar: { enabled: true, layout: "weird", provider: "nope", faces: [face(1), face(1), { id: "../etc", ext: ".sh" }, face(2), face(3), face(4), face(5)] } });
    expect(r.enabled).toBe(false);
    expect(r.backgroundVolume).toBe(1);
    expect(r.onFailure).toBe("skip");
    expect(r.avatar).toMatchObject({ enabled: true, layout: "split", provider: "preview" });
    expect(r.avatar.faces.map((f) => f.name)).toEqual(["Face 1", "Face 2", "Face 3", "Face 4"]);
  });

  it("names exactly what is missing before an enabled remake can run", () => {
    expect(remakeBlocker({ enabled: false })).toBe("");
    expect(remakeBlocker({ enabled: true })).toMatch(/Choose the voice/);
    expect(remakeBlocker({ ...ready, rightsConfirmed: false })).toMatch(/right to edit/);
    expect(remakeBlocker({ ...ready, voiceConsentConfirmed: false })).toMatch(/consent/);
    expect(remakeBlocker(ready)).toBe("");
    expect(remakeBlocker({ ...ready, avatar: { enabled: true } })).toMatch(/avatar photo/);
    expect(remakeBlocker({ ...ready, avatar: { enabled: true, faces: [face(1)], provider: "heygen" } }, { heygen: { available: false } })).toMatch(/isn't set up/);
    expect(remakeBlocker({ ...ready, avatar: { enabled: true, faces: [face(1)], provider: "heygen" } }, { heygen: { available: true } })).toBe("");
  });

  it("rotates avatars across uploads", () => {
    const r = { avatar: { enabled: true, faces: [face(1), face(2), face(3)] } };
    expect([0, 1, 2, 3, 4].map((n) => pickRemakeFace(r, n)?.name)).toEqual(["Face 1", "Face 2", "Face 3", "Face 1", "Face 2"]);
    expect(pickRemakeFace({}, 3)).toBeNull();
  });

  it("builds the voiceover job, and the avatar job only when avatar mode is on", () => {
    const off = remakeJobBodies({ ...ready, captions: true, rewrite: false }, { seedJobId: "voicejob_seed", sourceTitle: "Heist" });
    expect(off.avatar).toBeNull();
    expect(off.voiceover).toMatchObject({ action: "process", mode: "voiceover", profileId: "voice_1", rewrite: false, renderJobId: "voicejob_seed", rightsConfirmed: true, voiceConsentConfirmed: true, subtitles: { enabled: true }, profileName: "Heist narrator" });
    const on = remakeJobBodies({ ...ready, captions: true, avatar: { enabled: true, faces: [face(1)], layout: "smart", provider: "openrouter" } }, { seedJobId: "s" });
    // Captions are burned once, on the final avatar render.
    expect(on.voiceover.subtitles).toEqual({ enabled: false });
    expect(on.avatar).toMatchObject({ action: "process", mode: "avatar", avatarRemake: { layout: "smart", provider: "openrouter" }, subtitles: { enabled: true } });
  });
});
