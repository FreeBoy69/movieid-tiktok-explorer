import { writeFileSync } from 'fs';
import { rewriteTranscriptWithFramework } from './src/services/gemini.js';

const phases = [
  { timeRange: "0-5s", label: "Hook", explanation: "Grabs attention immediately." }
];

async function run() {
  try {
     const res = await rewriteTranscriptWithFramework("This is a short test of the system. I hope it works well and keeps it same length.", phases);
     console.log("RESULT:", res);
  } catch (e) {
     console.error("ERR:", e);
  }
}
run();
