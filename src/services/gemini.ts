import { GoogleGenAI, Type } from "@google/genai";
import { MovieResult } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function identifyMovie(file: File): Promise<MovieResult> {
  // Convert file to base64
  const base64Data = await fileToBase64(file);
  
  const prompt = `Analyze this video clip and identify the movie it is from.
  Follow this process:
  1. LISTEN: Transcribe key narration, dialogue, or quotes.
  2. LOOK: Identify actors, setting, costumes, and key visual markers.
  3. SEARCH: Use the search tool to find the exact movie. Specifically look for:
     - The official title and exactly 4-digit release year (e.g. "2022"). Never write a paragraph for the year.
     - The director.
     - A short summary.
  4. CONTENT ANALYSIS: Extract useful creator/research notes:
     - A transcript excerpt or concise transcript of the clip.
     - The opening hook, content style, and content structure.
     - The likely content niche based on trending YouTube Shorts and TikTok niches in 2026.
     - Audience and opportunity notes for similar content.
  5. REVERSE ENGINEER VIDEO FRAMEWORK (CLIMAX LINE):
     - Analyze the script using a dynamic "Climax Line" framework. DO NOT lock into a rigid 5-step rule if the video has a custom pacing, instead recognize the video's custom formula phases!
     - Create a custom name for this video's climax framework.
     - For each phase you identify, output its precise Time Range (e.g. 0-4s, 5-15s), a descriptive Label (e.g. Action Hook, Suspense Build), and an Explanation of how it advances the narrative.
     - Script Standards & Generation: Validate if the content adheres to your standard single-line narrative with no summarizing spoilers. Then, based on the video context, dynamically write a "Draft Script" and a "Final Script" for a potential recap video. The scripts MUST follow these exact rules:
       1. Max 1,000 characters. Use original character names.
       2. No background, awards, or starring role info. Just scene action.
       3. No 1-3 sentences that completely summarize the entire plot.
       4. Single-line narrative, max 3 characters.
       5. The opening must have a dynamic or static highlight hook, matching the Climax Line's beginning phase.
     - Visual Content Style: Describe the Editing Pacing (fast cuts, zoom-ins), Visual Identity (fonts, lighting, colors), and Production Style (Cinematic, Talking Head, Gameplay overlay).
     - Content Formula: The expected Content Pillars for this creator, and the "Why" Factor (Emotional trigger: social currency, utility, high emotion).

  Do not return poster/image URLs. Posters and movie metadata are resolved only through TMDB after identification.
  Return the result in JSON format.`;

  let jsonStr = "{}";
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: file.type,
                data: base64Data
              }
            }
          ]
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            year: { type: Type.STRING, description: "Exactly 4 digits, e.g. '2022'" },
            director: { type: Type.STRING },
            confidence: { type: Type.NUMBER },
            evidence: {
              type: Type.OBJECT,
              properties: {
                audio: { type: Type.STRING },
                visual: { type: Type.STRING },
                reasoning: { type: Type.STRING }
              },
              required: ["audio", "visual", "reasoning"]
            },
            transcript: {
              type: Type.OBJECT,
              properties: {
                excerpt: { type: Type.STRING },
                fullText: { type: Type.STRING },
                hooks: { type: Type.ARRAY, items: { type: Type.STRING } },
                contentStyle: { type: Type.ARRAY, items: { type: Type.STRING } },
                structure: { type: Type.ARRAY, items: { type: Type.STRING } }
              }
            },
            contentNiche: {
              type: Type.OBJECT,
              properties: {
                primary: { type: Type.STRING },
                secondary: { type: Type.ARRAY, items: { type: Type.STRING } },
                platforms: { type: Type.ARRAY, items: { type: Type.STRING } },
                rationale: { type: Type.STRING },
                audience: { type: Type.STRING },
                opportunities: { type: Type.ARRAY, items: { type: Type.STRING } }
              }
            },
            videoAnalysis: {
              type: Type.OBJECT,
              properties: {
                framework: {
                  type: Type.OBJECT,
                  properties: {
                    climaxLine: {
                      type: Type.OBJECT,
                      properties: {
                        name: { type: Type.STRING },
                        description: { type: Type.STRING },
                        phases: {
                          type: Type.ARRAY,
                          items: {
                            type: Type.OBJECT,
                            properties: {
                              timeRange: { type: Type.STRING },
                              label: { type: Type.STRING },
                              explanation: { type: Type.STRING }
                            },
                            required: ["timeRange", "label", "explanation"]
                          }
                        }
                      }
                    },
                    scriptStandards: {
                      type: Type.OBJECT,
                      properties: {
                        followsRules: { type: Type.BOOLEAN },
                        notes: { type: Type.STRING },
                        draftScript: { type: Type.STRING },
                        finalScript: { type: Type.STRING }
                      }
                    }
                  }
                },
                visualStyle: {
                  type: Type.OBJECT,
                  properties: {
                    editingPacing: { type: Type.STRING },
                    visualIdentity: { type: Type.STRING },
                    productionStyle: { type: Type.STRING }
                  }
                },
                formula: {
                  type: Type.OBJECT,
                  properties: {
                    pillars: { type: Type.ARRAY, items: { type: Type.STRING } },
                    whyFactor: { type: Type.STRING }
                  }
                }
              }
            },
            summary: { type: Type.STRING }
          },
          required: ["title", "confidence", "evidence", "summary"]
        },
        tools: [{ googleSearch: {} }]
      }
    });
    jsonStr = response.text?.trim() || "{}";
  } catch (apiError) {
    console.error("Gemini API call failed:", apiError);
    throw new Error(`Gemini API failed: ${apiError instanceof Error ? apiError.message : String(apiError)}`);
  }

  try {
    const result = JSON.parse(jsonStr) as MovieResult;
    return await enrichMoviePoster(result);
  } catch (e) {
    console.error("Failed to parse Gemini response", jsonStr);
    throw new Error("Failed to identify movie. Please try again.");
  }
}

async function enrichMoviePoster(result: MovieResult): Promise<MovieResult> {
  const title = result.title?.trim();
  if (!title) return result;
  try {
    const params = new URLSearchParams({ title });
    if (result.year) {
      const yearMatch = result.year.match(/\d{4}/);
      if (yearMatch) params.set("year", yearMatch[0]);
    }
    const response = await fetch(`/api/movie/poster?${params.toString()}`);
    if (!response.ok) return result;
    const data = (await response.json()) as {
      posterUrl?: string;
      imdbUrl?: string;
      backdropUrl?: string;
      tmdbUrl?: string;
      id?: number;
      mediaType?: "movie" | "tv";
      title?: string;
      originalTitle?: string;
      overview?: string;
      tagline?: string;
      releaseDate?: string;
      runtime?: number | null;
      genres?: string[];
      rating?: number | null;
      voteCount?: number;
      status?: string;
      language?: string;
      countries?: string[];
      director?: string;
      cast?: Array<{ name: string; character?: string; profileUrl?: string }>;
    };
    return {
      ...result,
      title: data.title || result.title,
      year: data.releaseDate?.slice(0, 4) || result.year,
      director: data.director || result.director,
      // Poster links are intentionally TMDB-only. Never fall back to Gemini-provided URLs.
      posterUrl: data.posterUrl || "",
      imdbUrl: data.imdbUrl || result.imdbUrl,
      tmdb: data.id
        ? {
            id: data.id,
            mediaType: data.mediaType,
            title: data.title || result.title,
            originalTitle: data.originalTitle,
            overview: data.overview,
            tagline: data.tagline,
            releaseDate: data.releaseDate,
            runtime: data.runtime ?? undefined,
            genres: data.genres,
            rating: data.rating ?? undefined,
            voteCount: data.voteCount,
            status: data.status,
            language: data.language,
            countries: data.countries,
            tmdbUrl: data.tmdbUrl,
            backdropUrl: data.backdropUrl,
            cast: data.cast,
            director: data.director,
          }
        : undefined,
    };
  } catch {
    return { ...result, posterUrl: "" };
  }
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const base64String = reader.result?.toString().split(',')[1];
      if (base64String) resolve(base64String);
      else reject(new Error("Failed to convert file to base64"));
    };
    reader.onerror = error => reject(error);
  });
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
