import { GoogleGenAI, Type } from "@google/genai";
import fs from "fs";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function run() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const fileData = fs.readFileSync("tiktok_test.mp4");
  const base64Data = fileData.toString("base64");

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{
        parts: [
          { text: "Analyze this video." },
          { inlineData: { mimeType: "video/mp4", data: base64Data } }
        ]
      }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            year: { type: Type.STRING },
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
            summary: { type: Type.STRING }
          },
          required: ["title", "confidence", "evidence", "summary"]
        },
        tools: [{ googleSearch: {} }]
      }
    });
    console.log("Success! Text:", response.text);
  } catch (e) {
    console.error("FAILED to generate content:", e.message || e);
  }
}
run();
