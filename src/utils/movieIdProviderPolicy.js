export function movieIdShouldUseQwenFallback(error) {
  const message = String(error?.message || error || "");
  return /\b(401|403|429|500|502|503|504)\b|PERMISSION_DENIED|RESOURCE_EXHAUSTED|TooManyRequests|Forbidden|quota|credit|billing|rate.?limit|denied access|overloaded|unavailable/i.test(message);
}

export function qwenMovieIdVideoReference(fileBuffer, mimeType = "video/mp4", source = {}, maxDataUriBytes = 19 * 1024 * 1024) {
  const bytes = Number(fileBuffer?.byteLength ?? fileBuffer?.length ?? 0);
  const dataUriBytes = Math.ceil(bytes / 3) * 4 + `data:${mimeType};base64,`.length;
  const sourceUrl = String(source.normalizedUrl || source.sourceUrl || source.url || "").trim();
  if (sourceUrl && /^https?:\/\//i.test(sourceUrl) && dataUriBytes > maxDataUriBytes)
    return sourceUrl;
  return `data:${mimeType};base64,${Buffer.from(fileBuffer || []).toString("base64")}`;
}
