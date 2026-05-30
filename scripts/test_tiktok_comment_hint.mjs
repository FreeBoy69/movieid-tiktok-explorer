import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { findMovieTitleFromCommentThreads, parseMovieTitleFromReply } from "../src/utils/movieCommentHints.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const url = process.argv[2] || "";

if (!url) {
  console.error("Usage: node scripts/test_tiktok_comment_hint.mjs <tiktok-url>");
  process.exit(1);
}

function runCommentsScript(targetUrl) {
  const scriptPath = path.join(__dirname, "tiktok_comments.py");
  const python = process.env.PYTHON_PATH || "python3";
  return new Promise((resolve, reject) => {
    const child = spawn(python, [scriptPath], {
      cwd: path.join(__dirname, ".."),
      env: { ...process.env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      try {
        const data = JSON.parse(stdout || "{}");
        if (data.error) reject(new Error(data.error));
        else if (!Array.isArray(data.threads)) reject(new Error(stderr || stdout || `exit ${code}`));
        else resolve(data);
      } catch (error) {
        reject(new Error(stderr || stdout || String(error)));
      }
    });
    child.stdin.write(JSON.stringify({ url: targetUrl, commentLimit: 40, replyLimit: 12 }));
    child.stdin.end();
  });
}

const payload = await runCommentsScript(url);
const nameRequests = payload.threads.filter((thread) =>
  /movie|anime|name|title|source|sauce/i.test(String(thread.text || "")),
);

const hint = findMovieTitleFromCommentThreads(payload.threads, {
  videoAuthorUniqueId: payload.authorUniqueId || "",
  minConfidence: 0.85,
});

const parsedReplies = [];
for (const thread of payload.threads) {
  for (const reply of thread.replies || []) {
    const parsed = parseMovieTitleFromReply(reply.text || "");
    if (parsed) {
      parsedReplies.push({
        thread: thread.text,
        reply: reply.text,
        author: reply.authorUniqueId,
        likes: reply.likeCount,
        parsed,
      });
    }
  }
}

console.log(JSON.stringify({
  url,
  videoId: payload.videoId,
  authorUniqueId: payload.authorUniqueId,
  threadCount: payload.threads.length,
  nameRequestThreads: nameRequests.map((thread) => ({
    text: thread.text,
    replies: (thread.replies || []).map((reply) => ({
      text: reply.text,
      author: reply.authorUniqueId,
      likes: reply.likeCount,
    })),
  })),
  parsedReplies,
  selectedHint: hint,
}, null, 2));
