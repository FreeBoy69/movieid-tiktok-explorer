import { describe, expect, it } from "vitest";
import { inferMusicMood, normalizeOpenverseTrack, pixabayMusicSearchUrl } from "./royaltyFreeMusic.js";

describe("royalty-free music helpers", () => {
    it("infers a soundtrack mood from the prepared narration", () => {
        expect(inferMusicMood("After years of loss, she says goodbye through tears.")).toMatchObject({ id: "sad", query: "sad instrumental" });
        expect(inferMusicMood("They celebrate a joyful win and dance all night.")).toMatchObject({ id: "upbeat", query: "upbeat instrumental" });
        expect(inferMusicMood("A story about a quiet beautiful nature journey.")).toMatchObject({ id: "calm", query: "calm instrumental" });
        expect(inferMusicMood("")).toMatchObject({ id: "cinematic", query: "cinematic instrumental" });
    });

    it("keeps only reusable CC0 and CC BY tracks with attribution", () => {
        const source = { id: "1", title: "Open Sky", creator: "A Creator", provider: "jamendo", url: "https://prod-1.storage.jamendo.com/track.mp3", foreign_landing_url: "https://www.jamendo.com/track/1", license: "by", license_url: "https://creativecommons.org/licenses/by/4.0/" };
        expect(normalizeOpenverseTrack(source)).toMatchObject({ title: "Open Sky", license: "CC BY", creator: "A Creator" });
        expect(normalizeOpenverseTrack({ ...source, license: "by-nc-sa" })).toBeNull();
    });

    it("creates a stable Pixabay mood search link", () => {
        expect(pixabayMusicSearchUrl("upbeat instrumental")).toBe("https://pixabay.com/music/search/upbeat-instrumental/");
    });
});
