const MOOD_RULES = [
    { id: "upbeat", label: "Upbeat", terms: ["upbeat", "happy", "joy", "fun", "celebrat", "win", "exciting", "success", "laugh", "dance", "party", "bright"] },
    { id: "sad", label: "Sad", terms: ["sad", "loss", "lost", "cry", "tears", "grief", "heartbreak", "lonely", "goodbye", "tragic", "sorrow"] },
    { id: "dramatic", label: "Dramatic", terms: ["dramatic", "danger", "threat", "battle", "war", "revenge", "shocking", "mystery", "crime", "escape", "dark"] },
    { id: "calm", label: "Calm", terms: ["calm", "peace", "relax", "quiet", "gentle", "beautiful", "nature", "sleep", "soft", "meditat"] },
    { id: "inspiring", label: "Inspiring", terms: ["inspir", "motiv", "dream", "journey", "hope", "brave", "believe", "overcome", "growth", "learn"] },
];

export function inferMusicMood(text = "") {
    const normalized = String(text).toLowerCase();
    const scores = MOOD_RULES.map((mood) => ({ ...mood, score: mood.terms.reduce((total, term) => total + (normalized.includes(term) ? 1 : 0), 0) }));
    scores.sort((a, b) => b.score - a.score);
    const winner = scores[0];
    return { id: winner?.score ? winner.id : "cinematic", label: winner?.score ? winner.label : "Cinematic", confidence: winner?.score ? Math.min(1, winner.score / 3) : 0, query: winner?.score ? `${winner.id} instrumental background music` : "cinematic instrumental background music", suggestions: ["upbeat", "calm", "dramatic", "sad", "inspiring"] };
}

export function normalizeOpenverseTrack(track) {
    if (!track || typeof track !== "object" || !track.url || !track.foreign_landing_url) return null;
    const license = String(track.license || "").toLowerCase();
    if (!['cc0', 'by'].includes(license)) return null;
    return {
        id: String(track.id || track.url),
        title: String(track.title || "Untitled track").trim(),
        creator: String(track.creator || "Unknown creator").trim(),
        provider: String(track.provider || track.source || "Openverse").trim(),
        url: String(track.url),
        previewUrl: String(track.url),
        landingUrl: String(track.foreign_landing_url),
        license: license.toUpperCase() === "CC0" ? "CC0" : "CC BY",
        licenseUrl: String(track.license_url || (license === "cc0" ? "https://creativecommons.org/publicdomain/zero/1.0/" : "https://creativecommons.org/licenses/by/4.0/")),
        attribution: String(track.attribution || `"${track.title || "Untitled track"}" by ${track.creator || "Unknown creator"} is licensed under ${license.toUpperCase() === "CC0" ? "CC0" : "CC BY"}.`),
        durationSeconds: track.duration ? Math.round(Number(track.duration) / 1000) : null,
        tags: Array.isArray(track.tags) ? track.tags.map((tag) => typeof tag === "string" ? tag : tag?.name).filter(Boolean).slice(0, 8) : [],
    };
}

export function pixabayMusicSearchUrl(query = "") {
    return `https://pixabay.com/music/search/${encodeURIComponent(String(query).trim().replace(/\s+/g, "-"))}/`;
}
