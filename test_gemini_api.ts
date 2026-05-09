import { GoogleGenAI } from "@google/genai";
import fs from "fs";

async function run() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const fileData = fs.readFileSync("temp_video_1777061520406.mp4.part"); // 3.8MB video
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
      config: { tools: [{ googleSearch: {} }] }
    });
    console.log("Success!");
    console.log(response.text?.slice(0, 50));
  } catch (e) {
    console.error("FAILED to generate content:", e.message || e);
  }
}
run();
