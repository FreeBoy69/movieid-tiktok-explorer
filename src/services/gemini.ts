import { GoogleGenAI } from "@google/genai";
import { MovieResult } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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

export async function rewriteTranscriptWithFramework(
  transcript: string, 
  phases: { timeRange: string, label: string, explanation: string }[]
): Promise<string> {
  const prompt = `Rewrite the following transcript according to the provided specific phase framework constraints.

SOURCE SCRIPT LENGTH: ~${transcript.length} characters.
CRITICAL INSTRUCTION: Your output MUST be substantially the exact same character length as the source transcript. Do not shorten, compress, or drastically expand. If the original is ${transcript.length} characters, your output's main content must be exactly around ${transcript.length} characters. 

IMPORTANT: Do NOT include the segment headers (e.g. "1. 0-5s:") in your character count. Only the actual rewritten script content should sum up to the target character count.

THE PACING FRAMEWORK TO USE:
${phases.map((p, i) => `${i + 1}. ${p.timeRange} [${p.label}]: ${p.explanation}`).join('\n')}

INSTRUCTIONS:
- You must break the output explicitly into these exact phases using headers like "1. 0-5s:" 
- Inside each phase, rewrite the dialogue / narration so it maps to the explanation provided.
- Maintain the original word count and character count roughly, adjusting vocabulary but not skipping overall detail.
- Do NOT output any conversational text or disclaimers. Just output the final script segmented by the phases.

TRANSCRIPT:
${transcript}`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        { role: "user", parts: [{ text: prompt }] }
      ]
    });
    return response.text || "Failed to generate rewrite.";
  } catch (err) {
    console.error("Rewrite error:", err);
    throw err;
  }
}
