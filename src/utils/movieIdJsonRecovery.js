function recoverStringField(raw, names) {
  for (const name of names) {
    const match = raw.match(new RegExp(`"?${name}"?\\s*:\\s*"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)`, "i"));
    if (match?.[1])
      return match[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\").trim();
  }
  return "";
}

function recoverNumberField(raw, names) {
  for (const name of names) {
    const match = raw.match(new RegExp(`"?${name}"?\\s*:\\s*"?([0-9]+(?:\\.[0-9]+)?)`, "i"));
    if (match?.[1])
      return Number(match[1]);
  }
  return 0;
}

export function recoverCompactMovieIdJson(text, fallback = {}) {
  const raw = String(text || "").trim();
  if (!raw)
    return fallback;
  try {
    return JSON.parse(raw);
  }
  catch {
    const title = recoverStringField(raw, ["title", "bestTitle", "sourceTitle"]);
    if (!title)
      return fallback;
    return {
      ...fallback,
      title,
      year: recoverStringField(raw, ["year"]).match(/\d{4}/)?.[0] || "",
      mediaType: recoverStringField(raw, ["mediaType"]),
      genre: recoverStringField(raw, ["genre"]),
      confidence: recoverNumberField(raw, ["confidence"]) || Number(fallback.confidence || 0.7),
      summary: recoverStringField(raw, ["summary"]) || String(fallback.summary || ""),
      evidence: {
        ...(fallback.evidence || {}),
        reasoning: raw.slice(0, 1200),
      },
    };
  }
}
