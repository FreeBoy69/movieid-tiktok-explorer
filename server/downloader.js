// Downloader: routes under /api/downloader, moved out of server.js along with the
// helpers only they use. Everything else they need comes in through `deps`.
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import crypto from "crypto";

export function registerDownloader(app, deps) {
  const {
    __dirname,
    normalizeDownloaderInfo,
    resolvePythonExecutable,
    runYtDlpJson,
    runtimeTmpRoot,
    validDownloaderUrl,
  } = deps;

  function runDownloaderJob(url, mode, formatId, outputTemplate, formatHasAudio = false) {
      const python = resolvePythonExecutable("-m").cmd;
      const safeFormat = /^[A-Za-z0-9._-]+$/.test(formatId) ? formatId : "";
      if (!safeFormat)
          return Promise.reject(new Error("Select a valid quality."));
      const args = ["-m", "yt_dlp", "--no-playlist", "--no-check-certificate", "--force-overwrites"];
      if (mode === "audio")
          args.push("-f", safeFormat, "-x", "--audio-format", "mp3", "--audio-quality", "0");
      else if (mode === "video")
          args.push("-f", safeFormat);
      else if (formatHasAudio)
          args.push("-f", safeFormat, "--merge-output-format", "mp4");
      else
          args.push("-f", `${safeFormat}+bestaudio/${safeFormat}`, "--merge-output-format", "mp4");
      args.push("-o", outputTemplate, url);
      return new Promise((resolve, reject) => {
          const child = spawn(python, args, { cwd: __dirname, env: { ...process.env }, windowsHide: true });
          let stderr = "";
          const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { } }, 600000);
          child.stderr.setEncoding("utf8");
          child.stderr.on("data", (chunk) => { stderr += chunk; });
          child.on("error", (error) => { clearTimeout(timer); reject(error); });
          child.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(stderr || `Download failed (${code})`)); });
      });
  }

      app.post("/api/downloader/inspect", async (req, res) => {
          const url = await validDownloaderUrl(req.body?.url);
          if (!url)
              return res.status(400).json({ error: "Enter a valid video URL." });
          try {
              res.json(normalizeDownloaderInfo(await runYtDlpJson(url)));
          }
          catch (error) {
              console.error("Downloader inspection failed:", error);
              res.status(500).json({ error: error instanceof Error ? error.message : "Could not inspect this video." });
          }
      });
      app.post("/api/downloader/download", async (req, res) => {
          const url = await validDownloaderUrl(req.body?.url);
          const mode = ["combined", "video", "audio"].includes(req.body?.mode) ? req.body.mode : "combined";
          const formatId = String(req.body?.formatId || "");
          const formatHasAudio = req.body?.formatHasAudio === true;
          if (!url)
              return res.status(400).json({ error: "Enter a valid video URL." });
          // The hosted app directory is read-only, and the remote media worker only
          // returns files written under the temp root, so downloads land there.
          const downloadDir = path.join(runtimeTmpRoot, "downloads");
          fs.mkdirSync(downloadDir, { recursive: true });
          const base = path.join(downloadDir, `media_download_${crypto.randomUUID()}`);
          try {
              await runDownloaderJob(url, mode, formatId, `${base}.%(ext)s`, formatHasAudio);
              const file = fs.readdirSync(downloadDir).map((name) => path.join(downloadDir, name)).find((candidate) => candidate.startsWith(`${base}.`) && fs.statSync(candidate).isFile());
              if (!file)
                  throw new Error("The downloaded file could not be found.");
              const extension = path.extname(file) || (mode === "audio" ? ".mp3" : ".mp4");
              res.download(file, `AutoYT-download${extension}`, () => {
                  try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch { }
              });
          }
          catch (error) {
              try {
                  for (const name of fs.readdirSync(downloadDir)) {
                      const candidate = path.join(downloadDir, name);
                      if (candidate.startsWith(`${base}.`)) fs.unlinkSync(candidate);
                  }
              }
              catch { }
              console.error("Downloader job failed:", error);
              if (!res.headersSent)
                  res.status(500).json({ error: error instanceof Error ? error.message : "Download failed." });
          }
      });
}
