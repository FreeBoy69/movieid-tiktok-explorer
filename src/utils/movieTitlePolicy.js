export function preferredMalDisplayTitle(node = {}, fallbackTitle = "") {
  return String(node?.alternative_titles?.en || node?.title || fallbackTitle || "").trim();
}

export function preferEnglishAnimeResultTitle(result = {}) {
  const englishTitle = String(result?.mal?.englishTitle || "").trim();
  if (!englishTitle)
    return result;
  return {
    ...result,
    title: englishTitle,
  };
}
