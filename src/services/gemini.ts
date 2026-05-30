import { MovieResult } from "../types";

export async function identifyMovieFromLink(url: string, candidateUrls: string[] = [], options: { skipCache?: boolean } = {}): Promise<MovieResult> {
  const response = await fetch("/api/movie/identify-link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, candidateUrls, skipCache: options.skipCache === true }),
  });
  const data = (await response.json().catch(() => ({}))) as {
    result?: MovieResult;
    error?: string;
    details?: string;
  };
  if (!response.ok) {
    throw new Error(data.details || data.error || "Failed to identify movie from link.");
  }
  if (!data.result?.title) {
    throw new Error("Failed to identify movie. Please try again.");
  }
  return data.result;
}

export async function identifyMovie(file: File): Promise<MovieResult> {
  const mimeType = file.type || "video/mp4";
  const response = await fetch("/api/movie/identify-file", {
    method: "POST",
    headers: { "Content-Type": mimeType },
    body: file,
  });
  const data = (await response.json().catch(() => ({}))) as {
    result?: MovieResult;
    error?: string;
    details?: string;
  };
  if (!response.ok) {
    throw new Error(data.details || data.error || "Failed to identify movie from uploaded file.");
  }
  if (!data.result?.title) {
    throw new Error("Failed to identify movie. Please try again.");
  }
  return data.result;
}
