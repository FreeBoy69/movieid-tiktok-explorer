import dotenv from "dotenv";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { execSync, spawn } from "child_process";
import fs from "fs";
import cors from "cors";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import crypto from "crypto";
import { GoogleGenAI, Type } from "@google/genai";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = process.cwd();
dotenv.config({ path: path.join(projectRoot, ".env") });
dotenv.config({ path: path.join(projectRoot, ".env.local"), override: true });
dotenv.config({ path: path.join(__dirname, ".env"), override: true });
dotenv.config({ path: path.join(__dirname, ".env.local"), override: true });
function readEnvValueFromFile(filePath, name) {
    try {
        const text = fs.readFileSync(filePath, "utf8");
        const line = text
            .split(/\r?\n/)
            .find((row) => row.replace(/^\uFEFF/, "").trimStart().startsWith(`${name}=`));
        if (!line)
            return "";
        return line
            .replace(/^\uFEFF/, "")
            .trim()
            .slice(name.length + 1)
            .trim()
            .replace(/^['"]|['"]$/g, "");
    }
    catch {
        return "";
    }
}
const appEnvDatabaseUrl = readEnvValueFromFile(path.join(__dirname, ".env.local"), "DATABASE_URL") ||
    readEnvValueFromFile(path.join(__dirname, ".env"), "DATABASE_URL");
if (appEnvDatabaseUrl)
    process.env.DATABASE_URL = appEnvDatabaseUrl;
function normalizeExecutablePath(p) {
    return p.replace(/^["']|["']$/g, "").trim();
}
/** python.org installs under %LocalAppData%\Programs\Python � visible even when `python` is not on PATH for the Node process. */
function findPythonWindowsUserInstall() {
    const found = [];
    const tryDir = (base) => {
        if (!base || !fs.existsSync(base))
            return;
        try {
            for (const name of fs.readdirSync(base)) {
                if (!/^python\d/i.test(name))
                    continue;
                const exe = path.join(base, name, "python.exe");
                if (fs.existsSync(exe))
                    found.push(exe);
            }
        }
        catch {
            /* ignore */
        }
    };
    if (process.env.LOCALAPPDATA) {
        tryDir(path.join(process.env.LOCALAPPDATA, "Programs", "Python"));
    }
    if (process.env.PROGRAMFILES) {
        tryDir(path.join(process.env.PROGRAMFILES, "Python"));
    }
    if (!found.length)
        return null;
    found.sort();
    return found[found.length - 1] ?? null;
}
/** Prefer a real python.exe. Avoid `py -3`: it often targets a stale C:\\Python312\\python.exe and mishandles paths with `&`. */
function resolvePythonExecutable(scriptPath) {
    const args = [scriptPath];
    const fromEnv = process.env.PYTHON_PATH
        ? normalizeExecutablePath(process.env.PYTHON_PATH)
        : "";
    if (fromEnv && fs.existsSync(fromEnv)) {
        return { cmd: fromEnv, args };
    }
    if (process.platform === "win32") {
        const userPy = findPythonWindowsUserInstall();
        if (userPy) {
            return { cmd: userPy, args };
        }
        const whereExe = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "where.exe");
        for (const name of ["python", "python3"]) {
            try {
                const out = execSync(`"${whereExe}" ${name}`, {
                    encoding: "utf-8",
                    windowsHide: true,
                }).trim();
                const first = out
                    .split(/\r?\n/)
                    .map((line) => line.trim())
                    .find((line) => line.length > 0 && !/^INFO:/i.test(line));
                if (first && fs.existsSync(first)) {
                    return { cmd: first, args };
                }
            }
            catch {
                /* try next */
            }
        }
        return { cmd: "py", args: ["-3", ...args] };
    }
    for (const altPython of ["/opt/alt/python312/bin/python3", "/opt/alt/python311/bin/python3", "/opt/alt/python310/bin/python3"]) {
        if (fs.existsSync(altPython))
            return { cmd: altPython, args };
    }
    return { cmd: "python3", args };
}
function runTikTokListScript(url, count, seedVideoUrl) {
    const scriptPath = path.join(__dirname, "scripts", "tiktok_list.py");
    const { cmd, args } = resolvePythonExecutable(scriptPath);
    // Hard cap so a stuck Playwright session can't hang /api/tiktok/list forever.
    // Matches tiktok-rewriter's 180s ceiling on analyze_playlist plus buffer for yt-dlp fallback.
    const timeoutMs = Math.min(Math.max(Number(process.env.TIKTOK_LIST_TIMEOUT_MS) || 240000, 30000), 600000);
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, {
            cwd: __dirname,
            env: { ...process.env },
            windowsHide: true,
        });
        let stdout = "";
        let stderr = "";
        let killedByTimeout = false;
        const killTimer = setTimeout(() => {
            killedByTimeout = true;
            try {
                child.kill("SIGKILL");
            }
            catch {
                /* already dead */
            }
        }, timeoutMs);
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk;
        });
        child.on("error", (err) => {
            clearTimeout(killTimer);
            const hint = process.platform === "win32"
                ? " Set PYTHON_PATH in .env.local to the full path of python.exe (py launcher often targets a missing install)."
                : "";
            reject(new Error(`${err instanceof Error ? err.message : String(err)}${hint}`));
        });
        child.on("close", (code) => {
            clearTimeout(killTimer);
            if (killedByTimeout) {
                reject(new Error(`TikTok listing timed out after ${Math.round(timeoutMs / 1000)}s. Playwright likely hung during session init � set TIKTOK_MS_TOKEN or raise TIKTOK_LIST_TIMEOUT_MS.`));
                return;
            }
            try {
                const data = JSON.parse(stdout || "{}");
                if (data.error) {
                    reject(new Error(data.error));
                    return;
                }
                if (!Array.isArray(data.videos)) {
                    reject(new Error(stderr || stdout || `TikTok listing failed (exit ${code})`));
                    return;
                }
                resolve(data);
            }
            catch {
                reject(new Error(stderr || stdout || `TikTok listing failed (exit ${code})`));
            }
        });
        child.stdin.write(JSON.stringify({ url, count, seedVideoUrl: seedVideoUrl || "" }));
        child.stdin.end();
    });
}
function tmdbImage(pathName, size = "w500") {
    return pathName ? `https://image.tmdb.org/t/p/${size}${pathName}` : "";
}
function tiktokCookieHeader() {
    const raw = (process.env.TIKTOK_COOKIE_HEADER || process.env.TIKTOK_COOKIES || "").trim();
    if (raw)
        return raw;
    const msToken = (process.env.TIKTOK_MS_TOKEN || "").trim();
    return msToken ? `msToken=${msToken}; ms_token=${msToken}` : "";
}
function runYtDlpDownload(url, outputPath) {
    const python = resolvePythonExecutable("-m").cmd;
    const timeoutMs = Math.min(Math.max(Number(process.env.TIKTOK_DOWNLOAD_TIMEOUT_MS) || 180000, 30000), 600000);
    const minHeight = tiktokDownloadMinHeight();
    const preferredHeight = tiktokDownloadPreferredHeight();
    const args = [
        "-m",
        "yt_dlp",
        "-S",
        `res:${Math.max(preferredHeight, minHeight)},ext:mp4:m4a`,
        "-f",
        `bv*[height>=${minHeight}][format_id!*=download][ext=mp4]+ba[ext=m4a]/b[height>=${minHeight}][format_id!*=download][ext=mp4]/bv*[height>=${minHeight}][format_id!*=download]+ba/bv*[format_id!*=download][ext=mp4]+ba[ext=m4a]/b[format_id!*=download][ext=mp4]/bv*[format_id!*=download]+ba`,
        "--merge-output-format",
        "mp4",
        "--no-check-certificate",
        "--force-overwrites",
        "--no-playlist",
        "--extractor-args",
        "tiktok:api_hostname=api16-normal-c-useast1a.tiktokv.com",
    ];
    const cookieFile = (process.env.TIKTOK_YTDLP_COOKIES_FILE || "").trim();
    if (cookieFile) {
        args.push("--cookies", cookieFile);
    }
    const cookie = tiktokCookieHeader();
    if (cookie) {
        args.push("--add-header", `Cookie: ${cookie}`);
    }
    args.push("-o", outputPath, url);
    return new Promise((resolve, reject) => {
        const child = spawn(python, args, {
            cwd: __dirname,
            env: { ...process.env },
            windowsHide: true,
        });
        let stderr = "";
        let stdout = "";
        let killedByTimeout = false;
        const timer = setTimeout(() => {
            killedByTimeout = true;
            try {
                child.kill("SIGKILL");
            }
            catch {
                /* already dead */
            }
        }, timeoutMs);
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk;
        });
        child.on("error", (err) => {
            clearTimeout(timer);
            reject(err);
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            if (killedByTimeout) {
                reject(new Error(`yt-dlp download timed out after ${Math.round(timeoutMs / 1000)}s`));
                return;
            }
            if (code !== 0) {
                reject(new Error(stderr || stdout || `yt-dlp exited with code ${code}`));
                return;
            }
            resolve();
        });
    });
}
function runYtDlpWithArgs(args, timeoutMs) {
    const python = resolvePythonExecutable("-m").cmd;
    return new Promise((resolve, reject) => {
        const child = spawn(python, args, { cwd: __dirname, env: { ...process.env }, windowsHide: true });
        let stderr = "";
        let stdout = "";
        let killedByTimeout = false;
        const timer = setTimeout(() => {
            killedByTimeout = true;
            try {
                child.kill("SIGKILL");
            }
            catch {
                /* already dead */
            }
        }, timeoutMs);
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk;
        });
        child.on("error", (err) => {
            clearTimeout(timer);
            reject(err);
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            if (killedByTimeout) {
                reject(new Error(`yt-dlp download timed out after ${Math.round(timeoutMs / 1000)}s`));
                return;
            }
            if (code !== 0) {
                reject(new Error(stderr || stdout || `yt-dlp exited with code ${code}`));
                return;
            }
            resolve();
        });
    });
}
function cleanYtDlpMessage(message) {
    return String(message || "")
        .replace(/Deprecated Feature:[^\n]*\n?/gi, "")
        .replace(/Support for Python version[^\n]*\n?/gi, "")
        .replace(/\s+/g, " ")
        .trim();
}
async function runYtDlpSocialDownload(url, outputPath) {
    const timeoutMs = Math.min(Math.max(Number(process.env.SOCIAL_DOWNLOAD_TIMEOUT_MS || process.env.TIKTOK_DOWNLOAD_TIMEOUT_MS) || 180000, 30000), 900000);
    const cookieFile = (process.env.YTDLP_COOKIES_FILE || process.env.YOUTUBE_YTDLP_COOKIES_FILE || process.env.TIKTOK_YTDLP_COOKIES_FILE || "").trim();
    const isYouTube = /(?:youtube\.com|youtu\.be)/i.test(url);
    const baseArgs = [
        "-m",
        "yt_dlp",
        "--no-check-certificate",
        "--force-overwrites",
        "--no-playlist",
        "--force-ipv4",
        "--user-agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    ];
    if (cookieFile) {
        baseArgs.push("--cookies", cookieFile);
    }
    const attempts = isYouTube
        ? [
            {
                name: "youtube-web-creator",
                args: [
                    ...baseArgs,
                    "--extractor-args",
                    "youtube:player_client=web_creator,mweb,default,-ios",
                    "-f",
                    "b[height<=720][ext=mp4]/18/bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720]/b",
                    "--merge-output-format",
                    "mp4",
                    "-o",
                    outputPath,
                    url,
                ],
            },
            {
                name: "youtube-tv-embedded",
                args: [
                    ...baseArgs,
                    "--extractor-args",
                    "youtube:player_client=tv_embedded,web_creator,mweb",
                    "-f",
                    "b[height<=720][ext=mp4]/18/bv*[height<=720]+ba/b[height<=720]/b",
                    "--merge-output-format",
                    "mp4",
                    "-o",
                    outputPath,
                    url,
                ],
            },
            {
                name: "youtube-hls",
                args: [
                    ...baseArgs,
                    "--extractor-args",
                    "youtube:player_client=web_safari,mweb",
                    "-S",
                    "proto:m3u8,res:720,ext:mp4:m4a",
                    "-f",
                    "b[height<=720][ext=mp4]/18/b[height<=720]/bv*[height<=720]+ba/b",
                    "--merge-output-format",
                    "mp4",
                    "-o",
                    outputPath,
                    url,
                ],
            },
        ]
        : [
            {
                name: "generic",
                args: [
                    ...baseArgs,
                    "-f",
                    "bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/best[ext=mp4][height<=720]/best[height<=720]/best",
                    "--merge-output-format",
                    "mp4",
                    "-o",
                    outputPath,
                    url,
                ],
            },
        ];
    const errors = [];
    for (const attempt of attempts) {
        try {
            if (fs.existsSync(outputPath))
                fs.unlinkSync(outputPath);
            await runYtDlpWithArgs(attempt.args, timeoutMs);
            return attempt.name;
        }
        catch (error) {
            errors.push(`${attempt.name}: ${cleanYtDlpMessage(error instanceof Error ? error.message : String(error))}`);
        }
    }
    const blocked = errors.join(" | ");
    if (isYouTube && /403|Forbidden|SABR|missing a url/i.test(blocked)) {
        throw new Error("YouTube blocked this server download. Try a public/unlisted video, or configure a YouTube cookies file on the server for yt-dlp. Details: " + blocked);
    }
    throw new Error(blocked || "yt-dlp could not download this video.");
}
function tikTokDownloadTimeoutMs() {
    return Math.min(Math.max(Number(process.env.TIKTOK_DOWNLOAD_TIMEOUT_MS) || 180000, 30000), 600000);
}
function tiktokDownloadMinHeight() {
    return Math.min(Math.max(Number(process.env.TIKTOK_DOWNLOAD_MIN_HEIGHT) || 720, 240), 2160);
}
function tiktokDownloadPreferredHeight() {
    return Math.min(Math.max(Number(process.env.TIKTOK_DOWNLOAD_PREFERRED_HEIGHT) || 1080, tiktokDownloadMinHeight()), 2160);
}
function tikTokDownloadMaxBytes() {
    return Math.min(Math.max(Number(process.env.TIKTOK_DOWNLOAD_MAX_BYTES) || 300 * 1024 * 1024, 5 * 1024 * 1024), 750 * 1024 * 1024);
}
function tiktokAllowWatermarkFallback() {
    return (process.env.TIKTOK_ALLOW_WATERMARK_FALLBACK || "").trim().toLowerCase() === "1";
}
function isTikTokPhotoModeDownloadError(message) {
    return /TikTok.*only images are available|only images are available|requested format is not available/i.test(String(message || ""));
}
function runYtDlpDumpJson(url) {
    const python = resolvePythonExecutable("-m").cmd;
    const timeoutMs = Math.min(Math.max(Number(process.env.TIKTOK_DOWNLOAD_TIMEOUT_MS) || 180000, 30000), 600000);
    const args = ["-m", "yt_dlp", "--dump-single-json", "--skip-download", "--no-playlist"];
    const cookieFile = (process.env.TIKTOK_YTDLP_COOKIES_FILE || "").trim();
    if (cookieFile)
        args.push("--cookies", cookieFile);
    const cookie = tiktokCookieHeader();
    if (cookie)
        args.push("--add-header", `Cookie: ${cookie}`);
    args.push(url);
    return new Promise((resolve, reject) => {
        const child = spawn(python, args, { cwd: __dirname, env: { ...process.env }, windowsHide: true });
        let stdout = "";
        let stderr = "";
        let killedByTimeout = false;
        const timer = setTimeout(() => {
            killedByTimeout = true;
            try {
                child.kill("SIGKILL");
            }
            catch {
                /* already dead */
            }
        }, timeoutMs);
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk;
        });
        child.on("error", (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            if (killedByTimeout) {
                reject(new Error("yt-dlp metadata timed out."));
                return;
            }
            if (code !== 0) {
                reject(new Error(cleanYtDlpMessage(stderr || stdout || `yt-dlp exited ${code}`)));
                return;
            }
            try {
                resolve(JSON.parse(stdout || "{}"));
            }
            catch {
                reject(new Error("yt-dlp returned invalid metadata."));
            }
        });
    });
}
function extractTikTokVideoProbe(meta) {
    const toNumber = (value) => {
        const n = Number(value);
        return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
    };
    const candidates = [
        meta,
        ...(Array.isArray(meta?.requested_downloads) ? meta.requested_downloads : []),
        ...(Array.isArray(meta?.formats) ? meta.formats : []),
    ]
        .map((item) => ({
        width: toNumber(item?.width),
        height: toNumber(item?.height),
        durationSeconds: toNumber(item?.duration) || toNumber(meta?.duration),
        bitrate: toNumber(item?.tbr) || toNumber(item?.abr) || toNumber(item?.vbr),
    }))
        .filter((item) => item.width && item.height)
        .sort((a, b) => b.height - a.height || b.width - a.width || b.bitrate - a.bitrate);
    const best = candidates[0] || null;
    if (!best)
        return {
            width: 0,
            height: 0,
            durationSeconds: toNumber(meta?.duration),
        };
    return {
        width: best.width,
        height: best.height,
        durationSeconds: best.durationSeconds || toNumber(meta?.duration),
    };
}
function tiktokDimensionProbeLimit() {
    return Math.min(Math.max(Number(process.env.TIKTOK_DIMENSION_PROBE_LIMIT) || 50, 1), 100);
}
function normalizeTikTokProbeUrl(video) {
    const rawUrl = String(video?.playUrl || video?.url || video?.webpageUrl || "").trim();
    if (/^https?:\/\//i.test(rawUrl))
        return rawUrl;
    const id = String(video?.id || "").trim();
    const handle = String(video?.authorHandle || video?.uploaderId || video?.author || "").replace(/^@+/, "").trim();
    if (id && handle)
        return `https://www.tiktok.com/@${handle}/video/${id}`;
    return "";
}
function runFfmpeg(args, timeoutMs = 180000) {
    const ffmpeg = (process.env.FFMPEG_PATH || "ffmpeg").trim();
    return new Promise((resolve, reject) => {
        const child = spawn(ffmpeg, args, { cwd: __dirname, env: { ...process.env }, windowsHide: true });
        let stderr = "";
        let killedByTimeout = false;
        const timer = setTimeout(() => {
            killedByTimeout = true;
            try {
                child.kill("SIGKILL");
            }
            catch {
                /* already dead */
            }
        }, timeoutMs);
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk) => {
            stderr += chunk;
        });
        child.on("error", (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            if (killedByTimeout) {
                reject(new Error("ffmpeg timed out."));
                return;
            }
            if (code !== 0) {
                reject(new Error(stderr || `ffmpeg exited ${code}`));
                return;
            }
            resolve();
        });
    });
}
async function runTikTokPhotoModeVideo(url, outputPath) {
    const meta = await runYtDlpDumpJson(url);
    const imageUrl = [
        meta?.thumbnail,
        ...(Array.isArray(meta?.thumbnails) ? meta.thumbnails.map((item) => item?.url) : []),
    ].find((value) => /^https?:\/\//i.test(String(value || "")));
    const audioUrl = [
        meta?.url,
        ...(Array.isArray(meta?.formats) ? meta.formats.filter((item) => item?.vcodec === "none").map((item) => item?.url) : []),
    ].find((value) => /^https?:\/\//i.test(String(value || "")));
    if (!imageUrl)
        throw new Error("TikTok photo-mode metadata had no usable image.");
    const dir = path.dirname(outputPath);
    const prefix = path.basename(outputPath, path.extname(outputPath));
    const imagePath = path.join(dir, `${prefix}.photo.jpg`);
    const audioPath = path.join(dir, `${prefix}.photo.mp3`);
    await downloadUrlToFile(imageUrl, imagePath);
    const duration = Math.min(Math.max(Number(meta?.duration) || 10, 5), 180);
    const filter = "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,format=yuv420p";
    if (audioUrl) {
        await downloadUrlToFile(audioUrl, audioPath);
        await runFfmpeg([
            "-y",
            "-loop",
            "1",
            "-framerate",
            "30",
            "-i",
            imagePath,
            "-i",
            audioPath,
            "-t",
            String(duration),
            "-vf",
            filter,
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-shortest",
            outputPath,
        ]);
    }
    else {
        await runFfmpeg([
            "-y",
            "-loop",
            "1",
            "-framerate",
            "30",
            "-i",
            imagePath,
            "-t",
            String(duration),
            "-vf",
            filter,
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-an",
            outputPath,
        ]);
    }
}
async function downloadUrlToFile(fileUrl, outputPath) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), tikTokDownloadTimeoutMs());
    try {
        const headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            Referer: "https://www.tiktok.com/",
            Accept: "video/mp4,video/*,*/*;q=0.8",
            Origin: "https://www.tiktok.com",
        };
        const cookie = tiktokCookieHeader();
        if (cookie)
            headers.Cookie = cookie;
        const response = await fetch(fileUrl, {
            redirect: "follow",
            signal: controller.signal,
            headers,
        });
        if (!response.ok) {
            throw new Error(`media download returned HTTP ${response.status}`);
        }
        const maxBytes = tikTokDownloadMaxBytes();
        const contentLength = Number(response.headers.get("content-length") || "0");
        if (contentLength && contentLength > maxBytes) {
            throw new Error(`media is too large (${Math.round(contentLength / 1024 / 1024)}MB; limit ${Math.round(maxBytes / 1024 / 1024)}MB)`);
        }
        if (!response.body) {
            throw new Error("media response had no body");
        }
        let written = 0;
        const guard = new TransformStream({
            transform(chunk, controller) {
                written += chunk.byteLength;
                if (written > maxBytes) {
                    controller.error(new Error(`media exceeded ${Math.round(maxBytes / 1024 / 1024)}MB limit`));
                    return;
                }
                controller.enqueue(chunk);
            },
        });
        await pipeline(Readable.fromWeb(response.body.pipeThrough(guard)), fs.createWriteStream(outputPath));
    }
    finally {
        clearTimeout(timer);
    }
}
function probeVideoDimensions(filePath) {
    const ffprobe = (process.env.FFPROBE_PATH || "ffprobe").trim();
    return new Promise((resolve) => {
        const fallback = () => resolve(probeMp4TrackHeaderDimensions(filePath));
        const child = spawn(ffprobe, [
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "json",
            filePath,
        ], { cwd: __dirname, env: { ...process.env }, windowsHide: true });
        let stdout = "";
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
        });
        child.on("error", fallback);
        child.on("close", (code) => {
            if (code !== 0) {
                fallback();
                return;
            }
            try {
                const parsed = JSON.parse(stdout || "{}");
                const stream = Array.isArray(parsed.streams) ? parsed.streams[0] : null;
                const width = Number(stream?.width || 0);
                const height = Number(stream?.height || 0);
                resolve(width && height ? { width, height } : probeMp4TrackHeaderDimensions(filePath));
            }
            catch {
                fallback();
            }
        });
    });
}
function probeVideoAudio(filePath) {
    const ffprobe = (process.env.FFPROBE_PATH || "ffprobe").trim();
    const timeoutMs = Math.min(Math.max(Number(process.env.FFPROBE_AUDIO_TIMEOUT_MS) || 30000, 5000), 120000);
    return new Promise((resolve) => {
        const child = spawn(ffprobe, [
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=codec_type,codec_name",
            "-of",
            "json",
            filePath,
        ], { cwd: __dirname, env: { ...process.env }, windowsHide: true });
        let stdout = "";
        let settled = false;
        let timer = null;
        const finish = (value) => {
            if (settled)
                return;
            settled = true;
            if (timer)
                clearTimeout(timer);
            resolve(value);
        };
        const fallback = (error = "") => {
            const hasAudio = probeMp4AudioTrack(filePath);
            finish({ hasAudio, codec: hasAudio ? "mp4-audio-track" : "", error: hasAudio ? "" : error });
        };
        timer = setTimeout(() => {
            try {
                child.kill("SIGKILL");
            }
            catch {
                /* already closed */
            }
            fallback("Audio probe timed out");
        }, timeoutMs);
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
        });
        child.on("error", (error) => {
            fallback(error instanceof Error ? error.message : String(error));
        });
        child.on("close", (code) => {
            if (settled)
                return;
            if (code !== 0) {
                fallback(`Audio probe exited ${code}`);
                return;
            }
            try {
                const parsed = JSON.parse(stdout || "{}");
                const stream = Array.isArray(parsed.streams) ? parsed.streams[0] : null;
                const codec = String(stream?.codec_name || "").trim();
                finish({ hasAudio: !!codec, codec });
            }
            catch {
                fallback("Audio probe returned invalid metadata");
            }
        });
    });
}
function probeMp4AudioTrack(filePath) {
    try {
        const buffer = fs.readFileSync(filePath);
        for (let index = 4; index < buffer.length - 20; index += 1) {
            if (buffer.toString("ascii", index, index + 4) === "hdlr" && buffer.toString("ascii", index + 12, index + 16) === "soun") {
                return true;
            }
        }
        const haystack = buffer.toString("ascii", 0, Math.min(buffer.length, 2 * 1024 * 1024));
        return /\b(mp4a|Opus|alac|ac-3|ec-3)\b/.test(haystack);
    }
    catch {
        return false;
    }
}
async function assertVideoHasAudio(filePath, label = "Video") {
    const audio = await probeVideoAudio(filePath);
    if (!audio?.hasAudio) {
        const suffix = audio?.error ? ` (${audio.error})` : "";
        throw new Error(`${label} has no confirmed audio track${suffix}.`);
    }
    return audio;
}
function uploadAudioProbePath() {
    const dir = path.join(__dirname, "tmp", "upload-audio-probes");
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `upload_audio_${crypto.randomUUID()}_${Date.now()}.mp4`);
}
async function assertUploadBufferHasAudio(videoBuffer, mimeType) {
    const contentType = String(mimeType || "").toLowerCase();
    if (contentType && !contentType.startsWith("video/") && contentType !== "application/octet-stream")
        return;
    const filePath = uploadAudioProbePath();
    try {
        fs.writeFileSync(filePath, videoBuffer);
        await assertVideoHasAudio(filePath, "Upload video");
    }
    finally {
        try {
            fs.unlinkSync(filePath);
        }
        catch {
            /* best-effort cleanup */
        }
    }
}
function probeMp4TrackHeaderDimensions(filePath) {
    try {
        const buffer = fs.readFileSync(filePath);
        let best = null;
        for (let index = 4; index < buffer.length - 96; index += 1) {
            if (buffer.toString("ascii", index, index + 4) !== "tkhd")
                continue;
            const boxStart = index - 4;
            const boxSize = buffer.readUInt32BE(boxStart);
            if (boxSize < 84 || boxStart + boxSize > buffer.length)
                continue;
            const version = buffer[index + 4];
            const widthOffset = index + 4 + (version === 1 ? 88 : 76);
            const heightOffset = widthOffset + 4;
            if (heightOffset + 4 > boxStart + boxSize)
                continue;
            const width = Math.round(buffer.readUInt32BE(widthOffset) / 65536);
            const height = Math.round(buffer.readUInt32BE(heightOffset) / 65536);
            if (width < 120 || height < 120 || width > 8192 || height > 8192)
                continue;
            if (!best || height > best.height)
                best = { width, height };
        }
        return best;
    }
    catch {
        return null;
    }
}
function normalizeTikTokMediaCandidate(value) {
    if (typeof value !== "string")
        return "";
    const trimmed = value.trim().replace(/\\u0026/g, "&");
    if (!/^https?:\/\//i.test(trimmed))
        return "";
    if (/tiktok\.com\/@|\/video\/\d+/i.test(trimmed))
        return "";
    return trimmed;
}
function tiktokCandidateQualityScore(value) {
    const raw = decodeURIComponent(String(value || "")).toLowerCase();
    let score = 0;
    for (const match of raw.matchAll(/(?:^|[^0-9])([1-9]\d{2,3})p(?:[^0-9]|$)/g)) {
        score = Math.max(score, Number(match[1]) * 100000);
    }
    for (const match of raw.matchAll(/(?:height|h|play_height|video_height)[=_-]?([1-9]\d{2,3})/g)) {
        score = Math.max(score, Number(match[1]) * 100000);
    }
    for (const match of raw.matchAll(/(?:br|bitrate|bit_rate|bps)[=_-]?(\d{4,9})/g)) {
        score += Math.min(Number(match[1]) || 0, 100000000);
    }
    if (/bytevc2|h265|hevc|hdr|uhd|fhd|1080/.test(raw))
        score += 50000;
    if (/720p|height[=_-]?720/.test(raw))
        score += 1000;
    if (/540p|480p|360p|lowbr|lowest/.test(raw))
        score -= 50000;
    return score;
}
function orderedUniqueTikTokCandidates(values, includeWatermarked = false) {
    const seen = new Set();
    const normalized = values
        .flat()
        .map(normalizeTikTokMediaCandidate)
        .filter(Boolean)
        .filter((value) => {
        if (seen.has(value))
            return false;
        seen.add(value);
            return true;
    });
    const sortByQuality = (items) => [...items].sort((a, b) => tiktokCandidateQualityScore(b) - tiktokCandidateQualityScore(a));
    const clean = sortByQuality(normalized.filter((value) => !/watermark|wmplay|download/i.test(value)));
    const watermarked = sortByQuality(normalized.filter((value) => /watermark|wmplay|download/i.test(value)));
    return includeWatermarked ? [...clean, ...watermarked] : clean;
}
async function runDirectTikTokMediaDownload(candidateUrls, outputPath) {
    const candidates = orderedUniqueTikTokCandidates(candidateUrls, tiktokAllowWatermarkFallback());
    if (!candidates.length)
        throw new Error("No direct clean playback URL candidates");
    const minHeight = tiktokDownloadMinHeight();
    const errors = [];
    for (const candidate of candidates.slice(0, 8)) {
        try {
            await downloadUrlToFile(candidate, outputPath);
            const dimensions = await probeVideoDimensions(outputPath);
            if (dimensions && dimensions.height < minHeight) {
                throw new Error(`downloaded ${dimensions.width}x${dimensions.height}, expected at least ${minHeight}p`);
            }
            return candidate;
        }
        catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
            try {
                if (fs.existsSync(outputPath))
                    fs.unlinkSync(outputPath);
            }
            catch {
                /* continue */
            }
        }
    }
    throw new Error(`Direct playback candidates failed: ${errors.join(" | ")}`);
}
async function runTikwmDownload(url, outputPath) {
    const endpoint = (process.env.TIKWM_API_URL || "https://www.tikwm.com/api/").trim();
    const apiUrl = new URL(endpoint);
    apiUrl.searchParams.set("url", url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(tikTokDownloadTimeoutMs(), 90000));
    try {
        const response = await fetch(apiUrl, {
            signal: controller.signal,
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
                Accept: "application/json,text/plain,*/*",
            },
        });
        if (!response.ok) {
            throw new Error(`TikWM returned HTTP ${response.status}`);
        }
        const data = await response.json();
        if (data?.code !== 0 || !data?.data) {
            throw new Error(data?.msg || "TikWM did not return video metadata");
        }
        const mediaCandidates = [data.data.hdplay, data.data.play, data.data.nowm, data.data.no_watermark];
        if (tiktokAllowWatermarkFallback()) {
            mediaCandidates.push(data.data.wmplay);
        }
        const mediaUrl = mediaCandidates
            .map((value) => (typeof value === "string" ? value.trim() : ""))
            .find((value) => /^https?:\/\//i.test(value));
        if (!mediaUrl) {
            throw new Error("TikWM returned no playable MP4 URL");
        }
        await downloadUrlToFile(mediaUrl, outputPath);
        const dimensions = await probeVideoDimensions(outputPath);
        const minHeight = tiktokDownloadMinHeight();
        if (dimensions && dimensions.height < minHeight) {
            throw new Error(`TikWM returned ${dimensions.width}x${dimensions.height}, expected at least ${minHeight}p`);
        }
    }
    finally {
        clearTimeout(timer);
    }
}
async function runTikTokDownload(url, outputPath, candidateUrls = [], options = {}) {
    const errors = [];
    if (options.skipDirect !== true) {
        try {
            const used = await runDirectTikTokMediaDownload(candidateUrls, outputPath);
            return `direct-clean-playback:${new URL(used).hostname}`;
        }
        catch (error) {
            errors.push(`direct playback: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    if (options.skipTikwm !== true && (process.env.TIKTOK_DISABLE_TIKWM_FALLBACK || "").toLowerCase() !== "1") {
        try {
            await runTikwmDownload(url, outputPath);
            return "tikwm-no-watermark";
        }
        catch (error) {
            errors.push(`TikWM: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    try {
        await runYtDlpDownload(url, outputPath);
        const dimensions = await probeVideoDimensions(outputPath);
        const minHeight = tiktokDownloadMinHeight();
        if (dimensions && dimensions.height < minHeight) {
            throw new Error(`yt-dlp returned ${dimensions.width}x${dimensions.height}, expected at least ${minHeight}p`);
        }
        return "yt-dlp-clean-hd";
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (isTikTokPhotoModeDownloadError(message)) {
            try {
                await runTikTokPhotoModeVideo(url, outputPath);
                return "yt-dlp-photo-mode-video";
            }
            catch (photoError) {
                throw new Error(`TikTok exposed this recap as photo/slideshow mode, so AutoYT tried to rebuild it as a video from the manga page and audio but failed: ${photoError instanceof Error ? photoError.message : String(photoError)}`);
            }
        }
        errors.push(`yt-dlp clean HD: ${message}`);
    }
    throw new Error(`${errors.join("\n")}\nNo clean ${tiktokDownloadMinHeight()}p TikTok source was available for this video.`);
}
function tiktokVideoCacheDir() {
    const dir = path.join(__dirname, "tmp", "tiktok-videos");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}
function cleanupTikTokVideoCache() {
    const maxAgeMs = Math.min(Math.max(Number(process.env.TIKTOK_VIDEO_CACHE_MAX_AGE_MS) || 30 * 60 * 1000, 60 * 1000), 24 * 60 * 60 * 1000);
    const now = Date.now();
    try {
        for (const entry of fs.readdirSync(tiktokVideoCacheDir())) {
            if (!/^tiktok_[a-f0-9-]+_\d+\.mp4$/i.test(entry))
                continue;
            const filePath = path.join(tiktokVideoCacheDir(), entry);
            const stat = fs.statSync(filePath);
            if (now - stat.mtimeMs > maxAgeMs) {
                fs.unlinkSync(filePath);
            }
        }
    }
    catch {
        /* best-effort cache cleanup */
    }
}
function makeTikTokVideoCachePath() {
    cleanupTikTokVideoCache();
    return path.join(tiktokVideoCacheDir(), `tiktok_${crypto.randomUUID()}_${Date.now()}.mp4`);
}
function makeLinkAnalysisVideoPath() {
    const dir = path.join(__dirname, "tmp", "link-analysis");
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `link_${crypto.randomUUID()}_${Date.now()}.mp4`);
}
function resolveDownloadedOutput(outputPath) {
    if (fs.existsSync(outputPath))
        return outputPath;
    const dir = path.dirname(outputPath);
    const prefix = path.basename(outputPath, path.extname(outputPath));
    const candidates = fs.readdirSync(dir)
        .filter((name) => name === path.basename(outputPath) || name.startsWith(`${prefix}.`))
        .map((name) => {
        const fullPath = path.join(dir, name);
        const stat = fs.statSync(fullPath);
        const ext = path.extname(name).toLowerCase();
        const score = [".mp4", ".webm", ".mov", ".mkv"].includes(ext) ? 2 : ext === ".m4a" ? 0 : 1;
        return { fullPath, stat, score };
    })
        .filter((item) => item.stat.isFile())
        .sort((a, b) => b.score - a.score || b.stat.size - a.stat.size);
    return candidates[0]?.fullPath || outputPath;
}
function cleanupDownloadArtifacts(outputPath) {
    const dir = path.dirname(outputPath);
    const prefix = path.basename(outputPath, path.extname(outputPath));
    for (const name of fs.readdirSync(dir)) {
        if (name === path.basename(outputPath) || name.startsWith(`${prefix}.`)) {
            try {
                fs.unlinkSync(path.join(dir, name));
            }
            catch {
                /* best-effort cleanup */
            }
        }
    }
}
function isTikTokVideoCacheName(name) {
    return /^tiktok_[a-f0-9-]+_\d+\.mp4$/i.test(name);
}
function tmdbAuthHeaders() {
    const bearer = (process.env.TMDB_READ_ACCESS_TOKEN || process.env.TMDB_ACCESS_TOKEN || "")
        .replace(/^["']|["']$/g, "")
        .trim();
    return bearer ? { Authorization: `Bearer ${bearer}` } : {};
}
function tmdbApiKey() {
    return (process.env.TMDB_API_KEY || "").replace(/^["']|["']$/g, "").trim();
}
function malClientId() {
    return (process.env.MAL_CLIENT_ID || process.env.MYANIMELIST_CLIENT_ID || "")
        .replace(/^["']|["']$/g, "")
        .trim();
}
async function fetchTmdbJson(pathName, params = {}) {
    const apiKey = tmdbApiKey();
    const headers = tmdbAuthHeaders();
    if (!apiKey && !("Authorization" in headers)) {
        throw new Error("TMDB_API_KEY or TMDB_READ_ACCESS_TOKEN is not configured");
    }
    const url = new URL(`https://api.themoviedb.org/3/${pathName.replace(/^\/+/, "")}`);
    Object.entries(params).forEach(([key, value]) => {
        if (value)
            url.searchParams.set(key, value);
    });
    if (apiKey)
        url.searchParams.set("api_key", apiKey);
    const response = await fetch(url, { headers });
    if (!response.ok) {
        throw new Error(`TMDB request failed (${response.status})`);
    }
    return (await response.json());
}
async function fetchMalJson(pathName, params = {}) {
    const clientId = malClientId();
    if (!clientId) {
        throw new Error("MAL_CLIENT_ID is not configured");
    }
    const url = new URL(`https://api.myanimelist.net/v2/${pathName.replace(/^\/+/, "")}`);
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "")
            url.searchParams.set(key, String(value));
    });
    const response = await fetch(url, {
        headers: {
            Accept: "application/json",
            "X-MAL-CLIENT-ID": clientId,
        },
    });
    if (!response.ok) {
        throw new Error(`MyAnimeList request failed (${response.status})`);
    }
    return (await response.json());
}
function tmdbResultTitle(result) {
    return result.title || result.name || "";
}
function tmdbResultDate(result) {
    return result.release_date || result.first_air_date || "";
}
function chooseTmdbTitle(results, title, year) {
    const wantedYear = (year || "").match(/\d{4}/)?.[0] || "";
    const normalizedTitle = title.trim().toLowerCase();
    const withPosters = results.filter((r) => r.poster_path && (r.media_type === "movie" || r.media_type === "tv"));
    if (!withPosters.length)
        return null;
    return (withPosters.find((r) => {
        const resultYear = tmdbResultDate(r).slice(0, 4);
        return tmdbResultTitle(r).trim().toLowerCase() === normalizedTitle && (!wantedYear || resultYear === wantedYear);
    }) ||
        withPosters.find((r) => !wantedYear || tmdbResultDate(r).slice(0, 4) === wantedYear) ||
        withPosters.sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0) || (b.popularity || 0) - (a.popularity || 0))[0] ||
        null);
}
function malPictureUrl(picture) {
    return picture?.large || picture?.medium || "";
}
function normalizeMediaHint(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/[_-]+/g, " ")
        .trim();
}
function looksLikeAnimeOrManga(result) {
    const haystack = [
        result?.title,
        result?.genre,
        result?.mediaType,
        result?.summary,
        result?.evidence?.audio,
        result?.evidence?.visual,
        result?.evidence?.reasoning,
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
    return /\b(anime|manga|manhwa|manhua|webtoon|toon|donghua|light novel|comic recap|manga recap|manhwa recap)\b/.test(haystack);
}
function malSearchOrder(result) {
    const hint = normalizeMediaHint(result?.mediaType || result?.genre);
    if (/\b(manga|manhwa|manhua|webtoon|comic|light novel)\b/.test(hint))
        return ["manga", "anime"];
    if (/\b(anime|donghua|ova|ona)\b/.test(hint))
        return ["anime", "manga"];
    return looksLikeAnimeOrManga(result) ? ["manga", "anime"] : ["anime", "manga"];
}
function titleScore(candidate, title, year) {
    const wanted = String(title || "").trim().toLowerCase();
    const wantedYear = String(year || "").match(/\d{4}/)?.[0] || "";
    const node = candidate?.node || candidate || {};
    const titles = [
        node.title,
        node.alternative_titles?.en,
        node.alternative_titles?.ja,
        ...(node.alternative_titles?.synonyms || []),
    ]
        .filter(Boolean)
        .map((value) => String(value).trim().toLowerCase());
    const startsAt = String(node.start_date || "");
    let score = Number(node.mean || 0);
    if (titles.some((value) => value === wanted))
        score += 20;
    if (titles.some((value) => value.includes(wanted) || wanted.includes(value)))
        score += 8;
    if (wantedYear && startsAt.startsWith(wantedYear))
        score += 6;
    if (node.main_picture)
        score += 2;
    return score;
}
async function searchMalTitle(result) {
    const title = String(result?.title || "").trim();
    if (!title || !malClientId())
        return null;
    const year = String(result?.year || "").match(/\d{4}/)?.[0] || "";
    const fields = "id,title,main_picture,alternative_titles,start_date,synopsis,genres,mean,media_type,status,num_episodes,num_chapters,num_volumes";
    for (const type of malSearchOrder(result)) {
        try {
            const data = await fetchMalJson(type, { q: title, limit: 5, fields });
            const candidates = Array.isArray(data?.data) ? data.data : [];
            if (!candidates.length)
                continue;
            const match = [...candidates].sort((a, b) => titleScore(b, title, year) - titleScore(a, title, year))[0];
            if (match?.node)
                return { type, node: match.node };
        }
        catch {
            /* keep TMDB-only behavior if MAL is unavailable */
        }
    }
    return null;
}
async function enrichServerMalResult(result) {
    const match = await searchMalTitle(result);
    if (!match)
        return result;
    const { type, node } = match;
    const startYear = String(node.start_date || "").slice(0, 4);
    const genres = (node.genres || []).map((genre) => genre.name).filter(Boolean);
    const posterUrl = malPictureUrl(node.main_picture);
    return {
        ...result,
        title: node.title || result.title,
        year: startYear || result.year,
        posterUrl: result.posterUrl || posterUrl,
        genre: result.genre || genres[0] || "",
        summary: result.summary || node.synopsis || "",
        mediaType: result.mediaType || (type === "manga" ? "manga" : "anime"),
        mal: {
            id: node.id,
            type,
            mediaType: node.media_type || type,
            title: node.title || result.title,
            originalTitle: node.alternative_titles?.ja || "",
            englishTitle: node.alternative_titles?.en || "",
            synonyms: node.alternative_titles?.synonyms || [],
            synopsis: node.synopsis || "",
            genres,
            startDate: node.start_date || "",
            score: typeof node.mean === "number" ? node.mean : null,
            status: node.status || "",
            episodes: node.num_episodes || null,
            chapters: node.num_chapters || null,
            volumes: node.num_volumes || null,
            url: `https://myanimelist.net/${type}/${node.id}`,
            imageUrl: posterUrl,
        },
    };
}
function normalizePlaylistListUrl(u) {
    if (!u || typeof u !== "string")
        return "";
    const clean = u.trim().split("#")[0];
    try {
        const parsed = new URL(clean.startsWith("//") ? `https:${clean}` : clean);
        if (/tiktok\.com$/i.test(parsed.hostname.replace(/^www\./i, "")) && parsed.pathname.replace(/\/+$/, "").toLowerCase() === "/search") {
            const query = String(parsed.searchParams.get("q") || parsed.searchParams.get("keyword") || "").trim().toLowerCase();
            return query ? `https://www.tiktok.com/search?q=${encodeURIComponent(query)}` : "https://www.tiktok.com/search";
        }
    }
    catch {
        // Fall through to the generic path normalizer.
    }
    return clean.split("?")[0].replace(/\/+$/, "").toLowerCase();
}
function slugifySavedPlaylistTitle(title) {
    const slug = (title || "playlist")
        .toLowerCase()
        .replace(/['"]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 70);
    return slug || "playlist";
}
function slugifySavedPost(video) {
    const handle = (video?.authorHandle || video?.author || "post").replace(/^@/, "");
    const title = video?.title || "video";
    const id = video?.id ? `-${video.id}` : "";
    return slugifySavedPlaylistTitle(`${handle}-${title}${id}`);
}
function savedSlugForRecord(row) {
    const analyzed = (row.analyzedUrl || row.key || "").trim();
    const profile = analyzed.match(/tiktok\.com\/@([^/?#]+)/i)?.[1];
    if (profile && !/\/collection\/|\/video\//i.test(analyzed)) {
        return slugifySavedPlaylistTitle(profile.replace(/^@/, ""));
    }
    return slugifySavedPlaylistTitle(savedPlaylistDisplayTitle(row));
}
function tiktokHandleFromUrl(rawUrl) {
    return String(rawUrl || "").match(/tiktok\.com\/@([^/?#\s]+)/i)?.[1]?.replace(/^@/, "").toLowerCase() || "";
}
function titleFromSlugSegment(segment) {
    const decoded = decodeURIComponent(String(segment || "").replace(/\+/g, " "));
    const withoutId = decoded.replace(/[-_\s]*\d{8,30}$/g, "");
    const cleaned = withoutId
        .replace(/[-_]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (!cleaned)
        return "";
    return cleaned.replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function tiktokCollectionTitleFromUrl(rawUrl) {
    const match = String(rawUrl || "").match(/\/(?:collection|collections|playlist|playlists?|mix)\/([^/?#]+)/i);
    return titleFromSlugSegment(match?.[1] || "");
}
function tiktokSearchTitleFromUrl(rawUrl) {
    try {
        const parsed = new URL(String(rawUrl || "").startsWith("//") ? `https:${rawUrl}` : String(rawUrl || ""));
        if (parsed.pathname.replace(/\/+$/, "").toLowerCase() !== "/search")
            return "";
        const query = String(parsed.searchParams.get("q") || parsed.searchParams.get("keyword") || "").trim();
        return query ? `Search: ${query}` : "";
    }
    catch {
        const match = String(rawUrl || "").match(/[?&](?:q|keyword)=([^&]+)/i);
        return match?.[1] ? `Search: ${decodeURIComponent(match[1].replace(/\+/g, " "))}` : "";
    }
}
function savedPlaylistDisplayTitle(row) {
    const playlist = row?.playlist || {};
    const analyzed = row?.analyzedUrl || row?.key || "";
    const key = row?.key || "";
    const handle = tiktokHandleFromUrl(analyzed || key);
    const searchTitle = tiktokSearchTitleFromUrl(analyzed) || tiktokSearchTitleFromUrl(key);
    if (searchTitle)
        return searchTitle;
    const collectionTitle = tiktokCollectionTitleFromUrl(analyzed) || tiktokCollectionTitleFromUrl(key);
    if (collectionTitle)
        return collectionTitle;
    const title = String(playlist.title || "").trim();
    const titleLooksLikeHandle = handle && title.replace(/^@/, "").toLowerCase() === handle;
    const slugTitle = row?.slug ? titleFromSlugSegment(row.slug) : "";
    if (slugTitle && (!handle || slugTitle.replace(/\s+/g, "").toLowerCase() !== handle))
        return slugTitle;
    if (title && !titleLooksLikeHandle)
        return title;
    if (/\/collection(?:\/|$)/i.test(String(analyzed || key)))
        return "Saved collection";
    if (handle)
        return `@${handle}`;
    return "Saved playlist";
}
function isExpiredTikTokSignedUrl(value) {
    if (!value || typeof value !== "string")
        return false;
    try {
        const parsed = new URL(value);
        if (!/tiktokcdn/i.test(parsed.hostname))
            return false;
        const expires = Number(parsed.searchParams.get("x-expires") || 0);
        return expires > 0 && expires * 1000 < Date.now();
    }
    catch {
        return false;
    }
}
function freshTikTokCover(value) {
    return isExpiredTikTokSignedUrl(value) ? "" : String(value || "");
}
function normalizeTikTokPlaylistForStorage(playlist) {
    if (!playlist || typeof playlist !== "object")
        return playlist;
    const videos = Array.isArray(playlist.videos) ? playlist.videos : [];
    return {
        ...playlist,
        videos: videos.map((video) => ({
            ...video,
            dynamicCover: freshTikTokCover(video?.dynamicCover),
            durationSeconds: Math.max(0, Math.round(Number(video?.durationSeconds) || 0)),
            width: Math.max(0, Math.round(Number(video?.width) || 0)),
            height: Math.max(0, Math.round(Number(video?.height) || 0)),
        })),
    };
}
function tikTokSeedVideoUrlFromPlaylist(playlist) {
    const videos = Array.isArray(playlist?.videos) ? playlist.videos : [];
    for (const video of videos) {
        const playUrl = String(video?.playUrl || "").trim();
        if (/tiktok\.com\/@[^/]+\/video\/\d+/i.test(playUrl))
            return playUrl;
        const handle = String(video?.authorHandle || video?.uploaderId || "").replace(/^@/, "").trim();
        const id = String(video?.id || "").trim();
        if (handle && id)
            return `https://www.tiktok.com/@${handle}/video/${id}`;
    }
    return "";
}
function mergeTikTokPlaylistsForStorage(previous, next, limit = 10000) {
    const oldPlaylist = normalizeTikTokPlaylistForStorage(previous || {});
    const newPlaylist = normalizeTikTokPlaylistForStorage(next || {});
    const merged = new Map();
    const keyForVideo = (video) => String(video?.id || video?.playUrl || video?.title || "").trim();
    for (const video of Array.isArray(oldPlaylist?.videos) ? oldPlaylist.videos : []) {
        const key = keyForVideo(video);
        if (key)
            merged.set(key, video);
    }
    for (const video of Array.isArray(newPlaylist?.videos) ? newPlaylist.videos : []) {
        const key = keyForVideo(video);
        if (!key)
            continue;
        const existing = merged.get(key) || {};
        const incomingCover = freshTikTokCover(video?.dynamicCover);
        merged.set(key, {
            ...existing,
            ...video,
            dynamicCover: incomingCover || freshTikTokCover(existing.dynamicCover),
            stats: {
                ...(existing.stats || {}),
                ...(video.stats || {}),
            },
            cleanPlaybackUrls: Array.from(new Set([
                ...((Array.isArray(video.cleanPlaybackUrls) ? video.cleanPlaybackUrls : []) || []),
                ...((Array.isArray(existing.cleanPlaybackUrls) ? existing.cleanPlaybackUrls : []) || []),
            ].filter(Boolean))).slice(0, 10),
        });
    }
    return {
        ...oldPlaylist,
        ...newPlaylist,
        title: newPlaylist.title || oldPlaylist.title || "Saved playlist",
        author: newPlaylist.author || oldPlaylist.author || "",
        videos: Array.from(merged.values()).slice(0, limit),
    };
}
function savedPlaylistSlugCandidates(row) {
    const candidates = new Set();
    const add = (value) => {
        const slug = slugifySavedPlaylistTitle(value || "");
        if (slug)
            candidates.add(slug);
    };
    const analyzed = row?.analyzedUrl || "";
    const key = row?.key || "";
    const handle = tiktokHandleFromUrl(analyzed || key);
    const collectionTitle = tiktokCollectionTitleFromUrl(analyzed) || tiktokCollectionTitleFromUrl(key);
    add(row?.slug);
    add(savedSlugForRecord(row));
    add(savedPlaylistDisplayTitle(row));
    add(collectionTitle);
    if (handle && collectionTitle)
        add(`${handle} ${collectionTitle}`);
    add(analyzed);
    add(key);
    return [...candidates];
}
async function savedPlaylistFallbackForTikTokUrl(userId, rawUrl, limit) {
    if (!postgresConfigured())
        return null;
    const requestedKey = normalizePlaylistListUrl(rawUrl);
    const requestedHandle = tiktokHandleFromUrl(rawUrl);
    const requestedCollectionTitle = tiktokCollectionTitleFromUrl(rawUrl);
    const requestedIsCollection = /\/(?:collection|collections|playlist|playlists?|mix)\//i.test(String(rawUrl || ""));
    const records = await listSavedPlaylistRecords(userId);
    const candidates = records
        .filter((record) => record?.playlist?.videos?.length)
        .map((record) => {
        const key = normalizePlaylistListUrl(record.key || "");
        const analyzed = normalizePlaylistListUrl(record.analyzedUrl || "");
        const title = String(record.playlist?.title || record.slug || "").toLowerCase();
        const recordHandle = tiktokHandleFromUrl(record.analyzedUrl || record.key || "");
        const recordCollectionTitle = tiktokCollectionTitleFromUrl(record.analyzedUrl || record.key || "");
        let score = 0;
        if (requestedKey && (key === requestedKey || analyzed === requestedKey))
            score += 100;
        const collectionTitleMatches = requestedCollectionTitle && recordCollectionTitle &&
            slugifySavedPlaylistTitle(recordCollectionTitle) === slugifySavedPlaylistTitle(requestedCollectionTitle);
        if (requestedIsCollection) {
            if (collectionTitleMatches && (!requestedHandle || recordHandle === requestedHandle))
                score += 80;
        }
        else {
            if (requestedHandle && recordHandle === requestedHandle)
                score += 60;
            if (requestedHandle && title.includes(requestedHandle))
                score += 35;
        }
        return { record, score };
    })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || Number(b.record.savedAt || 0) - Number(a.record.savedAt || 0));
    const found = candidates[0]?.record;
    if (!found)
        return null;
    const playlist = found.playlist || {};
    return {
        ...playlist,
        title: savedPlaylistDisplayTitle(found),
        author: playlist.author || requestedHandle || "",
        videos: (playlist.videos || []).slice(0, limit),
        source: "saved-playlist-cache",
        savedAt: found.savedAt,
        analyzedUrl: found.analyzedUrl,
    };
}
function postgresConfigured() {
    return !!(process.env.DATABASE_URL ||
        process.env.PGHOST ||
        process.env.PGUSER ||
        process.env.PGDATABASE ||
        process.env.PGPASSWORD);
}
async function startManagedPostgresIfConfigured() {
    const dataDir = process.env.MOVIEID_MANAGED_PG_DATA_DIR
        ? normalizeExecutablePath(process.env.MOVIEID_MANAGED_PG_DATA_DIR)
        : "";
    if (!dataDir)
        return;
    const pgCtl = process.env.PG_CTL_PATH
        ? normalizeExecutablePath(process.env.PG_CTL_PATH)
        : "C:\\Program Files\\PostgreSQL\\17\\bin\\pg_ctl.exe";
    if (!fs.existsSync(pgCtl) || !fs.existsSync(path.join(dataDir, "PG_VERSION")))
        return;
    const logFile = process.env.MOVIEID_MANAGED_PG_LOG
        ? normalizeExecutablePath(process.env.MOVIEID_MANAGED_PG_LOG)
        : path.join(path.dirname(dataDir), "postgres17.log");
    await new Promise((resolve) => {
        const status = spawn(pgCtl, ["status", "-D", dataDir], { windowsHide: true });
        let output = "";
        status.stdout.setEncoding("utf8");
        status.stderr.setEncoding("utf8");
        status.stdout.on("data", (chunk) => (output += chunk));
        status.stderr.on("data", (chunk) => (output += chunk));
        status.on("close", () => {
            if (/server is running/i.test(output)) {
                resolve();
                return;
            }
            const starter = spawn(pgCtl, ["start", "-D", dataDir, "-l", logFile, "-w"], { windowsHide: true });
            starter.on("close", () => resolve());
            starter.on("error", () => resolve());
        });
        status.on("error", () => resolve());
    });
}
function resolvePsqlExecutable() {
    const fromEnv = process.env.PSQL_PATH ? normalizeExecutablePath(process.env.PSQL_PATH) : "";
    if (fromEnv && fs.existsSync(fromEnv))
        return fromEnv;
    const candidates = [
        "psql",
        "C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe",
        "C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe",
        "C:\\Program Files\\PostgreSQL\\16\\bin\\psql.exe",
    ];
    return candidates.find((candidate) => candidate === "psql" || fs.existsSync(candidate)) || "psql";
}
function sqlString(value) {
    return `'${String(value ?? "").replace(/'/g, "''")}'`;
}
function jsonbLiteral(value) {
    return `${sqlString(JSON.stringify(value ?? null))}::jsonb`;
}
function sqlNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? String(n) : "0";
}
function loadNicheSeedEntries() {
    const seedPath = path.join(__dirname, "data", "premium-niche-library.json");
    try {
        return JSON.parse(fs.readFileSync(seedPath, "utf8"));
    }
    catch (error) {
        console.warn("Niche seed data unavailable:", error instanceof Error ? error.message : error);
        return [];
    }
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
let psqlQueue = Promise.resolve();
function isTransientSpawnError(error) {
    const message = String(error?.code || error?.message || error || "");
    return /EAGAIN|resource temporarily unavailable|spawn/i.test(message);
}
async function runPsql(sql) {
    const task = psqlQueue.then(() => runPsqlWithRetry(sql));
    psqlQueue = task.catch(() => null);
    return task;
}
async function runPsqlWithRetry(sql) {
    const delays = [0, 350, 900, 1800, 3500];
    let lastError = null;
    for (let attempt = 0; attempt < delays.length; attempt++) {
        if (delays[attempt])
            await sleep(delays[attempt]);
        try {
            return await runPsqlOnce(sql);
        }
        catch (error) {
            lastError = error;
            if (!isTransientSpawnError(error) || attempt === delays.length - 1)
                break;
        }
    }
    throw lastError;
}
async function runPsqlOnce(sql) {
    if (!postgresConfigured()) {
        throw new Error("PostgreSQL is running, but DATABASE_URL/PG credentials are not configured. Add DATABASE_URL to .env.local.");
    }
    const args = ["-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1"];
    if (process.env.DATABASE_URL)
        args.push(process.env.DATABASE_URL);
    return new Promise((resolve, reject) => {
        const child = spawn(resolvePsqlExecutable(), args, {
            cwd: __dirname,
            env: { ...process.env },
            windowsHide: true,
        });
        let settled = false;
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk;
        });
        child.on("error", (error) => {
            if (settled)
                return;
            settled = true;
            reject(error);
        });
        child.on("close", (code) => {
            if (settled)
                return;
            settled = true;
            if (code !== 0) {
                reject(new Error(stderr.trim() || `psql exited with code ${code}`));
                return;
            }
            resolve(stdout.trim());
        });
        child.stdin.end(sql);
    });
}
async function ensureSavedPlaylistSchema() {
    if (!postgresConfigured())
        return;
    await runPsql(`
CREATE TABLE IF NOT EXISTS saved_tiktok_playlists (
  id text PRIMARY KEY,
  user_id text,
  key text NOT NULL,
  slug text NOT NULL,
  analyzed_url text NOT NULL,
  playlist jsonb NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE saved_tiktok_playlists ADD COLUMN IF NOT EXISTS id text;
ALTER TABLE saved_tiktok_playlists ADD COLUMN IF NOT EXISTS user_id text;
ALTER TABLE saved_tiktok_playlists ADD COLUMN IF NOT EXISTS key text;
CREATE TABLE IF NOT EXISTS auth_users (
  id text PRIMARY KEY,
  google_sub text UNIQUE NOT NULL,
  email text NOT NULL,
  name text NOT NULL,
  avatar_url text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
UPDATE saved_tiktok_playlists
SET user_id = (
  SELECT id FROM auth_users
  WHERE lower(email) = lower('evanslockwood69@gmail.com')
  ORDER BY created_at ASC
  LIMIT 1
)
WHERE COALESCE(user_id, '') = ''
  AND EXISTS (
    SELECT 1 FROM auth_users
    WHERE lower(email) = lower('evanslockwood69@gmail.com')
  );
UPDATE saved_tiktok_playlists
SET id = 'spl_' || substr(md5(COALESCE(user_id, '') || ':' || COALESCE(key, '')), 1, 28)
WHERE COALESCE(id, '') = '';
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'saved_tiktok_playlists'::regclass
      AND contype = 'p'
  ) THEN
    ALTER TABLE saved_tiktok_playlists DROP CONSTRAINT saved_tiktok_playlists_pkey;
  END IF;
END $$;
ALTER TABLE saved_tiktok_playlists ADD CONSTRAINT saved_tiktok_playlists_pkey PRIMARY KEY (id);
CREATE INDEX IF NOT EXISTS saved_tiktok_playlists_slug_idx ON saved_tiktok_playlists(slug);
CREATE INDEX IF NOT EXISTS saved_tiktok_playlists_saved_at_idx ON saved_tiktok_playlists(saved_at DESC);
CREATE INDEX IF NOT EXISTS saved_tiktok_playlists_user_idx ON saved_tiktok_playlists(user_id, saved_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS saved_tiktok_playlists_user_key_idx ON saved_tiktok_playlists(user_id, key) WHERE COALESCE(user_id, '') <> '';
CREATE TABLE IF NOT EXISTS auth_users (
  id text PRIMARY KEY,
  google_sub text UNIQUE NOT NULL,
  email text NOT NULL,
  name text NOT NULL,
  avatar_url text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  active_youtube_account_id text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expires_idx ON auth_sessions(expires_at);
CREATE TABLE IF NOT EXISTS youtube_accounts (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  google_sub text NOT NULL,
  email text NOT NULL,
  channel_id text NOT NULL,
  channel_title text NOT NULL,
  channel_handle text NOT NULL DEFAULT '',
  thumbnail_url text NOT NULL DEFAULT '',
  uploads_playlist_id text NOT NULL DEFAULT '',
  access_token text NOT NULL,
  refresh_token text NOT NULL DEFAULT '',
  token_expires_at timestamptz NOT NULL DEFAULT now(),
  scope text NOT NULL DEFAULT '',
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, channel_id)
);
CREATE INDEX IF NOT EXISTS youtube_accounts_user_idx ON youtube_accounts(user_id);
CREATE TABLE IF NOT EXISTS automation_agents (
  id text PRIMARY KEY,
  slug text NOT NULL DEFAULT '',
  user_id text NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  youtube_account_id text NOT NULL REFERENCES youtube_accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'paused',
  source_type text NOT NULL DEFAULT 'saved_playlist',
  source_key text NOT NULL DEFAULT '',
  source_url text NOT NULL DEFAULT '',
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS automation_agents_user_idx ON automation_agents(user_id);
ALTER TABLE automation_agents ADD COLUMN IF NOT EXISTS slug text NOT NULL DEFAULT '';
UPDATE automation_agents
SET slug = trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')) || '-' || substr(md5(id), 1, 8)
WHERE slug = '';
CREATE UNIQUE INDEX IF NOT EXISTS automation_agents_slug_unique_idx ON automation_agents(slug) WHERE slug <> '';
CREATE INDEX IF NOT EXISTS automation_agents_next_run_idx ON automation_agents(status, next_run_at);
CREATE TABLE IF NOT EXISTS automation_runs (
  id text PRIMARY KEY,
  agent_id text NOT NULL REFERENCES automation_agents(id) ON DELETE CASCADE,
  status text NOT NULL,
  message text NOT NULL DEFAULT '',
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS automation_runs_agent_idx ON automation_runs(agent_id, started_at DESC);
CREATE TABLE IF NOT EXISTS automation_uploads (
  id text PRIMARY KEY,
  agent_id text NOT NULL REFERENCES automation_agents(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  youtube_account_id text NOT NULL REFERENCES youtube_accounts(id) ON DELETE CASCADE,
  youtube_video_id text NOT NULL DEFAULT '',
  youtube_url text NOT NULL DEFAULT '',
  source_url text NOT NULL,
  source_video_id text NOT NULL DEFAULT '',
  source_author text NOT NULL DEFAULT '',
  movie_key text NOT NULL DEFAULT '',
  movie_title text NOT NULL DEFAULT '',
  movie_year text NOT NULL DEFAULT '',
  genre text NOT NULL DEFAULT '',
  micro_niche text NOT NULL DEFAULT '',
  title text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  schedule_at timestamptz,
  status text NOT NULL DEFAULT 'uploaded',
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS automation_uploads_agent_idx ON automation_uploads(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS automation_uploads_source_idx ON automation_uploads(agent_id, source_video_id);
CREATE INDEX IF NOT EXISTS automation_uploads_movie_idx ON automation_uploads(youtube_account_id, movie_key);
CREATE TABLE IF NOT EXISTS automation_source_claims (
  agent_id text NOT NULL REFERENCES automation_agents(id) ON DELETE CASCADE,
  source_key text NOT NULL,
  run_id text NOT NULL DEFAULT '',
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(agent_id, source_key)
);
CREATE INDEX IF NOT EXISTS automation_source_claims_claimed_idx ON automation_source_claims(claimed_at DESC);
CREATE TABLE IF NOT EXISTS automation_performance_snapshots (
  id text PRIMARY KEY,
  upload_id text NOT NULL REFERENCES automation_uploads(id) ON DELETE CASCADE,
  youtube_video_id text NOT NULL,
  views bigint NOT NULL DEFAULT 0,
  likes bigint NOT NULL DEFAULT 0,
  comments bigint NOT NULL DEFAULT 0,
  captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS automation_snapshots_upload_idx ON automation_performance_snapshots(upload_id, captured_at DESC);
CREATE TABLE IF NOT EXISTS automation_comment_replies (
  id text PRIMARY KEY,
  upload_id text NOT NULL REFERENCES automation_uploads(id) ON DELETE CASCADE,
  comment_id text NOT NULL,
  reply_id text NOT NULL DEFAULT '',
  reply_text text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(upload_id, comment_id)
);
CREATE INDEX IF NOT EXISTS automation_comment_replies_upload_idx ON automation_comment_replies(upload_id, created_at DESC);
CREATE TABLE IF NOT EXISTS channel_comment_replies (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  youtube_account_id text NOT NULL REFERENCES youtube_accounts(id) ON DELETE CASCADE,
  video_id text NOT NULL DEFAULT '',
  video_title text NOT NULL DEFAULT '',
  comment_id text NOT NULL,
  reply_id text NOT NULL DEFAULT '',
  reply_text text NOT NULL DEFAULT '',
  reply_type text NOT NULL DEFAULT 'ai_engagement',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(youtube_account_id, comment_id)
);
CREATE INDEX IF NOT EXISTS channel_comment_replies_account_idx ON channel_comment_replies(youtube_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS channel_comment_replies_video_idx ON channel_comment_replies(video_id, created_at DESC);
CREATE TABLE IF NOT EXISTS movie_identification_cache (
  id text PRIMARY KEY,
  source_type text NOT NULL DEFAULT '',
  tiktok_video_id text NOT NULL DEFAULT '',
  youtube_video_id text NOT NULL DEFAULT '',
  normalized_url text NOT NULL DEFAULT '',
  file_hash text NOT NULL DEFAULT '',
  detected_title text NOT NULL DEFAULT '',
  detected_year text NOT NULL DEFAULT '',
  tmdb_id text NOT NULL DEFAULT '',
  tmdb_media_type text NOT NULL DEFAULT '',
  mal_id text NOT NULL DEFAULT '',
  mal_media_type text NOT NULL DEFAULT '',
  confidence double precision NOT NULL DEFAULT 0,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS movie_identification_cache_tiktok_idx ON movie_identification_cache(tiktok_video_id) WHERE tiktok_video_id <> '';
CREATE UNIQUE INDEX IF NOT EXISTS movie_identification_cache_youtube_idx ON movie_identification_cache(youtube_video_id) WHERE youtube_video_id <> '';
CREATE UNIQUE INDEX IF NOT EXISTS movie_identification_cache_url_idx ON movie_identification_cache(normalized_url) WHERE normalized_url <> '';
CREATE UNIQUE INDEX IF NOT EXISTS movie_identification_cache_file_hash_idx ON movie_identification_cache(file_hash) WHERE file_hash <> '';
CREATE INDEX IF NOT EXISTS movie_identification_cache_title_idx ON movie_identification_cache(lower(detected_title), detected_year);
CREATE INDEX IF NOT EXISTS movie_identification_cache_tmdb_idx ON movie_identification_cache(tmdb_id, tmdb_media_type);
CREATE INDEX IF NOT EXISTS movie_identification_cache_mal_idx ON movie_identification_cache(mal_id, mal_media_type);
CREATE INDEX IF NOT EXISTS movie_identification_cache_expires_idx ON movie_identification_cache(expires_at);
CREATE TABLE IF NOT EXISTS niche_library (
  id text PRIMARY KEY,
  macro_niche text NOT NULL,
  sub_niche text NOT NULL,
  msn text NOT NULL,
  faceless_formats jsonb NOT NULL DEFAULT '[]'::jsonb,
  target_countries jsonb NOT NULL DEFAULT '[]'::jsonb,
  geo_tier text NOT NULL DEFAULT '',
  cpm_tier text NOT NULL DEFAULT '',
  rpm_range text NOT NULL DEFAULT '',
  competition text NOT NULL DEFAULT '',
  audience_value text NOT NULL DEFAULT '',
  trend_score integer NOT NULL DEFAULT 0,
  monetization_stack jsonb NOT NULL DEFAULT '[]'::jsonb,
  creator_fit text NOT NULL DEFAULT '',
  acquisition_queries jsonb NOT NULL DEFAULT '[]'::jsonb,
  channel_angles jsonb NOT NULL DEFAULT '[]'::jsonb,
  hook_patterns jsonb NOT NULL DEFAULT '[]'::jsonb,
  seed_keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
  risk_notes text NOT NULL DEFAULT '',
  source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS niche_library_macro_idx ON niche_library(macro_niche);
CREATE INDEX IF NOT EXISTS niche_library_score_idx ON niche_library(trend_score DESC);
`);
    await seedNicheLibrary();
}
async function seedNicheLibrary() {
    if (!postgresConfigured())
        return;
    const entries = loadNicheSeedEntries();
    if (!Array.isArray(entries) || !entries.length)
        return;
    const values = entries
        .filter((entry) => entry?.id && entry?.macroNiche && entry?.msn)
        .map((entry) => `(
${sqlString(entry.id)},
${sqlString(entry.macroNiche)},
${sqlString(entry.subNiche)},
${sqlString(entry.msn)},
${jsonbLiteral(entry.facelessFormats || [])},
${jsonbLiteral(entry.targetCountries || [])},
${sqlString(entry.geoTier)},
${sqlString(entry.cpmTier)},
${sqlString(entry.rpmRange)},
${sqlString(entry.competition)},
${sqlString(entry.audienceValue)},
${sqlNumber(entry.trendScore)},
${jsonbLiteral(entry.monetizationStack || [])},
${sqlString(entry.creatorFit)},
${jsonbLiteral(entry.acquisitionQueries || [])},
${jsonbLiteral(entry.channelAngles || [])},
${jsonbLiteral(entry.hookPatterns || [])},
${jsonbLiteral(entry.seedKeywords || [])},
${sqlString(entry.riskNotes)},
${jsonbLiteral(entry.sourceRefs || [])}
)`)
        .join(",\n");
    if (!values)
        return;
    await runPsql(`
INSERT INTO niche_library (
  id, macro_niche, sub_niche, msn, faceless_formats, target_countries, geo_tier, cpm_tier,
  rpm_range, competition, audience_value, trend_score, monetization_stack, creator_fit,
  acquisition_queries, channel_angles, hook_patterns, seed_keywords, risk_notes, source_refs
)
VALUES ${values}
ON CONFLICT (id) DO UPDATE SET
  macro_niche = EXCLUDED.macro_niche,
  sub_niche = EXCLUDED.sub_niche,
  msn = EXCLUDED.msn,
  faceless_formats = EXCLUDED.faceless_formats,
  target_countries = EXCLUDED.target_countries,
  geo_tier = EXCLUDED.geo_tier,
  cpm_tier = EXCLUDED.cpm_tier,
  rpm_range = EXCLUDED.rpm_range,
  competition = EXCLUDED.competition,
  audience_value = EXCLUDED.audience_value,
  trend_score = EXCLUDED.trend_score,
  monetization_stack = EXCLUDED.monetization_stack,
  creator_fit = EXCLUDED.creator_fit,
  acquisition_queries = EXCLUDED.acquisition_queries,
  channel_angles = EXCLUDED.channel_angles,
  hook_patterns = EXCLUDED.hook_patterns,
  seed_keywords = EXCLUDED.seed_keywords,
  risk_notes = EXCLUDED.risk_notes,
  source_refs = EXCLUDED.source_refs,
  updated_at = now();
`);
}
async function listNicheLibraryEntries() {
    const seed = loadNicheSeedEntries();
    if (!postgresConfigured()) {
        return seed;
    }
    await seedNicheLibrary().catch((error) => console.warn("Niche library refresh seed failed:", error instanceof Error ? error.message : error));
    const out = await runPsql(`
SELECT COALESCE(json_agg(json_build_object(
  'id', id,
  'macroNiche', macro_niche,
  'subNiche', sub_niche,
  'msn', msn,
  'facelessFormats', faceless_formats,
  'targetCountries', target_countries,
  'geoTier', geo_tier,
  'cpmTier', cpm_tier,
  'rpmRange', rpm_range,
  'competition', competition,
  'audienceValue', audience_value,
  'trendScore', trend_score,
  'monetizationStack', monetization_stack,
  'creatorFit', creator_fit,
  'acquisitionQueries', acquisition_queries,
  'channelAngles', channel_angles,
  'hookPatterns', hook_patterns,
  'seedKeywords', seed_keywords,
  'riskNotes', risk_notes,
  'sourceRefs', source_refs
) ORDER BY trend_score DESC, macro_niche, sub_niche), '[]'::json)
FROM niche_library;
`);
    const rows = JSON.parse(out || "[]");
    if (Array.isArray(rows) && rows.length) {
        const seedById = new Map(seed.map((entry) => [entry.id, entry]));
        return rows.map((row) => {
            const seedEntry = seedById.get(row.id);
            return seedEntry ? { ...row, macroNiche: seedEntry.macroNiche, subNiche: seedEntry.subNiche } : row;
        });
    }
    if (Array.isArray(seed) && seed.length) {
        await seedNicheLibrary().catch((error) => console.warn("Niche library on-demand seed failed:", error instanceof Error ? error.message : error));
        return seed;
    }
    return rows;
}
function buildNicheHierarchy(entries) {
    const macroMap = new Map();
    for (const entry of Array.isArray(entries) ? entries : []) {
        const macroName = String(entry?.macroNiche || "Unsorted").trim() || "Unsorted";
        const subName = String(entry?.subNiche || "General").trim() || "General";
        if (!macroMap.has(macroName)) {
            macroMap.set(macroName, {
                name: macroName,
                msnCount: 0,
                bestScore: 0,
                subNiches: new Map(),
            });
        }
        const macro = macroMap.get(macroName);
        macro.msnCount += 1;
        macro.bestScore = Math.max(macro.bestScore, Number(entry?.trendScore || 0));
        if (!macro.subNiches.has(subName)) {
            macro.subNiches.set(subName, {
                name: subName,
                msnCount: 0,
                bestScore: 0,
                topRpmRange: "",
                msns: [],
            });
        }
        const sub = macro.subNiches.get(subName);
        sub.msnCount += 1;
        sub.bestScore = Math.max(sub.bestScore, Number(entry?.trendScore || 0));
        if (!sub.topRpmRange || Number(entry?.trendScore || 0) >= sub.bestScore) {
            sub.topRpmRange = entry?.rpmRange || sub.topRpmRange || "";
        }
        sub.msns.push(entry);
    }
    return Array.from(macroMap.values())
        .map((macro) => ({
        name: macro.name,
        msnCount: macro.msnCount,
        bestScore: macro.bestScore,
        subNicheCount: macro.subNiches.size,
        subNiches: Array.from(macro.subNiches.values())
            .map((sub) => ({
            ...sub,
            msns: sub.msns.sort((a, b) => Number(b.trendScore || 0) - Number(a.trendScore || 0)),
        }))
            .sort((a, b) => b.bestScore - a.bestScore || a.name.localeCompare(b.name)),
    }))
        .sort((a, b) => b.bestScore - a.bestScore || a.name.localeCompare(b.name));
}
function savedPlaylistSummaryFromRecord(row) {
    const playlist = row.playlist || {};
    const videos = Array.isArray(playlist.videos) ? playlist.videos : [];
    const first = videos[0] || {};
    return {
        key: row.key,
        slug: row.slug || savedSlugForRecord(row),
        analyzedUrl: row.analyzedUrl || row.key,
        title: savedPlaylistDisplayTitle(row),
        videoCount: videos.length,
        savedAt: row.savedAt || 0,
        thumb: freshTikTokCover(first.dynamicCover),
    };
}
function savedPlaylistDbId(userId, key) {
    return `spl_${crypto.createHash("sha1").update(`${userId || ""}:${key || ""}`).digest("hex").slice(0, 28)}`;
}
async function listSavedPlaylistRecords(userId) {
    const out = await runPsql(`
SELECT COALESCE(json_agg(json_build_object(
  'key', key,
  'slug', slug,
  'analyzedUrl', analyzed_url,
  'playlist', playlist,
  'savedAt', FLOOR(EXTRACT(EPOCH FROM saved_at) * 1000)::bigint
) ORDER BY saved_at DESC), '[]'::json)
FROM saved_tiktok_playlists
WHERE user_id = ${sqlString(userId)};
`);
    return JSON.parse(out || "[]");
}
async function getSavedPlaylistRecordByKey(userId, rawUrl) {
    const key = normalizePlaylistListUrl(rawUrl);
    if (!key)
        return null;
    const out = await runPsql(`
SELECT COALESCE((
  SELECT json_build_object(
    'key', key,
    'slug', slug,
    'analyzedUrl', analyzed_url,
    'playlist', playlist,
    'savedAt', FLOOR(EXTRACT(EPOCH FROM saved_at) * 1000)::bigint
  )
  FROM saved_tiktok_playlists
  WHERE user_id = ${sqlString(userId)}
    AND key = ${sqlString(key)}
), 'null'::json);
`);
    return JSON.parse(out || "null");
}
async function getSavedPlaylistRecordBySlug(userId, slug) {
    const wanted = slugifySavedPlaylistTitle(slug);
    if (!wanted)
        return null;
    const out = await runPsql(`
SELECT COALESCE((
  SELECT json_build_object(
    'key', key,
    'slug', slug,
    'analyzedUrl', analyzed_url,
    'playlist', playlist,
    'savedAt', FLOOR(EXTRACT(EPOCH FROM saved_at) * 1000)::bigint
  )
  FROM saved_tiktok_playlists
  WHERE user_id = ${sqlString(userId)}
    AND slug = ${sqlString(wanted)}
  ORDER BY saved_at DESC
  LIMIT 1
), 'null'::json);
`);
    const exact = JSON.parse(out || "null");
    if (exact?.playlist?.videos?.length)
        return exact;
    const records = await listSavedPlaylistRecords(userId);
    const match = records.find((record) => savedPlaylistSlugCandidates(record).includes(wanted));
    return match || null;
}
async function saveTikTokPlaylistToDb(userId, rawUrl, playlist, analyzedUrl) {
    const key = normalizePlaylistListUrl(rawUrl);
    if (!key || !playlist?.videos?.length)
        throw new Error("Cannot save an empty playlist");
    let normalizedPlaylist = normalizeTikTokPlaylistForStorage(playlist);
    const existingOut = await runPsql(`
SELECT COALESCE((
  SELECT playlist
  FROM saved_tiktok_playlists
  WHERE user_id = ${sqlString(userId)}
    AND key = ${sqlString(key)}
  LIMIT 1
), 'null'::jsonb);
`);
    const existingPlaylist = JSON.parse(existingOut || "null");
    if (existingPlaylist?.videos?.length) {
        normalizedPlaylist = mergeTikTokPlaylistsForStorage(existingPlaylist, normalizedPlaylist);
    }
    const id = savedPlaylistDbId(userId, key);
    const record = {
        key,
        analyzedUrl: (analyzedUrl || rawUrl).trim(),
        playlist: normalizedPlaylist,
    };
    const slug = savedSlugForRecord(record);
    const updated = await runPsql(`
UPDATE saved_tiktok_playlists
SET
  id = COALESCE(NULLIF(id, ''), ${sqlString(id)}),
  slug = ${sqlString(slug)},
  analyzed_url = ${sqlString(record.analyzedUrl)},
  playlist = ${jsonbLiteral(normalizedPlaylist)},
  updated_at = now()
WHERE user_id = ${sqlString(userId)}
  AND key = ${sqlString(key)}
RETURNING json_build_object(
  'key', key,
  'slug', slug,
  'analyzedUrl', analyzed_url,
  'playlist', playlist,
  'savedAt', FLOOR(EXTRACT(EPOCH FROM saved_at) * 1000)::bigint
);
`);
    if (updated && updated !== "null")
        return JSON.parse(updated);
    const out = await runPsql(`
INSERT INTO saved_tiktok_playlists (id, user_id, key, slug, analyzed_url, playlist, saved_at, updated_at)
VALUES (${sqlString(id)}, ${sqlString(userId)}, ${sqlString(key)}, ${sqlString(slug)}, ${sqlString(record.analyzedUrl)}, ${jsonbLiteral(normalizedPlaylist)}, now(), now())
ON CONFLICT (id) DO UPDATE SET
  user_id = EXCLUDED.user_id,
  key = EXCLUDED.key,
  slug = EXCLUDED.slug,
  analyzed_url = EXCLUDED.analyzed_url,
  playlist = EXCLUDED.playlist,
  updated_at = now()
RETURNING json_build_object(
  'key', key,
  'slug', slug,
  'analyzedUrl', analyzed_url,
  'playlist', playlist,
  'savedAt', FLOOR(EXTRACT(EPOCH FROM saved_at) * 1000)::bigint
);
`);
    return JSON.parse(out || "null");
}
async function deleteSavedPlaylistFromDb(userId, key) {
    const normalized = normalizePlaylistListUrl(key);
    if (!normalized)
        return;
    await runPsql(`DELETE FROM saved_tiktok_playlists WHERE user_id = ${sqlString(userId)} AND key = ${sqlString(normalized)};`);
}
function normalizeAutomationSettings(input = {}) {
    const settings = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const maxPostsPerDay = Math.min(Math.max(Number(settings.maxPostsPerDay) || 1, 1), 12);
    const scheduleTimes = Array.isArray(settings.scheduleTimes)
        ? settings.scheduleTimes.map(normalizeScheduleTime).filter(Boolean).slice(0, maxPostsPerDay)
        : [];
    const sideChannels = Array.isArray(settings.sideChannels)
        ? settings.sideChannels.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 12)
        : [];
    return {
        maxPostsPerDay,
        scheduleTimes: scheduleTimes.length ? scheduleTimes : ["09:00"],
        timezone: String(settings.timezone || "Africa/Nairobi").slice(0, 64),
        publishMode: ["schedule", "private", "unlisted"].includes(String(settings.publishMode || "")) ? String(settings.publishMode) : "schedule",
        searchDepth: Math.min(Math.max(Number(settings.searchDepth) || 50, 1), 5000),
        sourcePriority: ["views", "oldest"].includes(String(settings.sourcePriority || "")) ? String(settings.sourcePriority) : "views",
        movieIdEnabled: settings.movieIdEnabled !== false,
        includeSideChannels: settings.includeSideChannels === true,
        sideChannels,
        microNicheGoal: String(settings.microNicheGoal || "").trim().slice(0, 500),
        genreFocus: String(settings.genreFocus || "").trim().slice(0, 160),
        titleStyle: String(settings.titleStyle || "viral-curiosity").trim().slice(0, 80),
        madeForKids: settings.madeForKids === true,
        categoryId: String(settings.categoryId || "24").trim().slice(0, 8),
        targetPlaylistMode: ["none", "existing", "create", "auto"].includes(String(settings.targetPlaylistMode || ""))
            ? String(settings.targetPlaylistMode)
            : settings.targetPlaylistId
                ? "existing"
                : settings.targetPlaylistTitle
                    ? "create"
                    : "none",
        targetPlaylistId: String(settings.targetPlaylistId || "").trim().slice(0, 160),
        targetPlaylistTitle: String(settings.targetPlaylistTitle || "").trim().slice(0, 160),
        createTargetPlaylist: settings.createTargetPlaylist === true,
        autoCreatePlaylists: settings.autoCreatePlaylists === true,
        avoidMovieRepeats: settings.avoidMovieRepeats !== false,
        performanceCheckHours: Math.min(Math.max(Number(settings.performanceCheckHours) || 3, 1), 24),
        stagnationWindowHours: Math.min(Math.max(Number(settings.stagnationWindowHours) || 12, 3), 168),
        minViewDeltaPercent: Math.min(Math.max(Number(settings.minViewDeltaPercent) || 5, 0), 100),
        scheduleLeadMinutes: Math.min(Math.max(Number(settings.scheduleLeadMinutes) || 120, 15), 1440),
        communityManagementEnabled: settings.communityManagementEnabled !== false,
        aiEngagementRepliesEnabled: settings.aiEngagementRepliesEnabled !== false,
        maxCommentRepliesPerCheck: Math.min(Math.max(Number(settings.maxCommentRepliesPerCheck) || 5, 1), 25),
        commentReplyTone: String(settings.commentReplyTone || "warm-curious").trim().slice(0, 80),
        commentReplyInstructions: String(settings.commentReplyInstructions || "").trim().slice(0, 500),
        compilationEnabled: settings.compilationEnabled === true,
        compilationMinMinutes: Math.min(Math.max(Number(settings.compilationMinMinutes) || 30, 1), 240),
        compilationMaxMinutes: Math.min(Math.max(Number(settings.compilationMaxMinutes) || 40, 1), 300),
        compilationMaxClips: Math.min(Math.max(Number(settings.compilationMaxClips) || 80, 1), 300),
        compilationTitle: String(settings.compilationTitle || "").trim().slice(0, 100),
        compilationDescription: String(settings.compilationDescription || "").trim().slice(0, 5000),
        compilationLayout: ["vertical", "landscape"].includes(String(settings.compilationLayout || "")) ? String(settings.compilationLayout) : "vertical",
        rightsConfirmed: settings.rightsConfirmed === true,
    };
}
function normalizeScheduleTime(value) {
    const raw = String(value || "").trim().toLowerCase().replace(/\./g, "");
    const match = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
    if (!match)
        return "";
    let hour = Number(match[1]);
    const minute = Number(match[2] || 0);
    const meridiem = match[3] || "";
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59)
        return "";
    if (meridiem) {
        if (hour < 1 || hour > 12)
            return "";
        if (hour === 12)
            hour = 0;
        if (meridiem === "pm")
            hour += 12;
    }
    else if (hour < 0 || hour > 23) {
        return "";
    }
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
function normalizeAutomationAgentPayload(body = {}) {
    const sourceType = ["saved_playlist", "saved_channel", "custom_url"].includes(String(body.sourceType || "")) ? String(body.sourceType) : "saved_playlist";
    return {
        id: String(body.id || "").trim(),
        youtubeAccountId: String(body.youtubeAccountId || "").trim(),
        name: String(body.name || "MSN Agent").trim().slice(0, 120),
        status: ["active", "paused"].includes(String(body.status || "")) ? String(body.status) : "paused",
        sourceType,
        sourceKey: String(body.sourceKey || "").trim(),
        sourceUrl: String(body.sourceUrl || "").trim(),
        settings: normalizeAutomationSettings(body.settings || {}),
    };
}
function automationAgentFromRow(row) {
    return row || null;
}
function slugifyAutomationAgentName(name) {
    const slug = String(name || "agent")
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 70);
    return slug || "agent";
}
async function automationAgentSlugForSave(id, name) {
    if (id) {
        const existing = await runPsql(`SELECT COALESCE((SELECT slug FROM automation_agents WHERE id = ${sqlString(id)} AND slug <> '' LIMIT 1), '');`);
        if (existing)
            return existing;
    }
    const base = slugifyAutomationAgentName(name);
    for (let i = 0; i < 12; i++) {
        const suffix = i === 0 ? crypto.randomUUID().slice(0, 8) : crypto.randomUUID().slice(0, 10);
        const slug = `${base}-${suffix}`;
        const count = await runPsql(`SELECT COUNT(*) FROM automation_agents WHERE slug = ${sqlString(slug)};`);
        if (Number(count || 0) === 0)
            return slug;
    }
    return `${base}-${Date.now().toString(36)}`;
}
async function listAutomationAgents(userId) {
    const out = await runPsql(`
SELECT COALESCE(json_agg(json_build_object(
  'id', a.id,
  'slug', a.slug,
  'youtubeAccountId', a.youtube_account_id,
  'name', a.name,
  'status', a.status,
  'sourceType', a.source_type,
  'sourceKey', a.source_key,
  'sourceUrl', a.source_url,
  'settings', a.settings,
  'lastRunAt', CASE WHEN a.last_run_at IS NULL THEN NULL ELSE FLOOR(EXTRACT(EPOCH FROM a.last_run_at) * 1000)::bigint END,
  'nextRunAt', CASE WHEN a.next_run_at IS NULL THEN NULL ELSE FLOOR(EXTRACT(EPOCH FROM a.next_run_at) * 1000)::bigint END,
  'createdAt', FLOOR(EXTRACT(EPOCH FROM a.created_at) * 1000)::bigint,
  'channelTitle', y.channel_title,
  'channelHandle', y.channel_handle,
  'channelThumbnailUrl', y.thumbnail_url,
  'uploadCount', (SELECT COUNT(*) FROM automation_uploads u WHERE u.agent_id = a.id),
  'lastUpload', (SELECT json_build_object('title', u.title, 'movieTitle', u.movie_title, 'youtubeUrl', u.youtube_url, 'createdAt', FLOOR(EXTRACT(EPOCH FROM u.created_at) * 1000)::bigint) FROM automation_uploads u WHERE u.agent_id = a.id ORDER BY u.created_at DESC LIMIT 1)
) ORDER BY a.created_at DESC), '[]'::json)
FROM automation_agents a
JOIN youtube_accounts y ON y.id = a.youtube_account_id
WHERE a.user_id = ${sqlString(userId)};
`);
    return JSON.parse(out || "[]");
}
async function getAutomationAgent(userId, agentId) {
    const out = await runPsql(`
SELECT COALESCE((
  SELECT json_build_object(
    'id', a.id,
    'slug', a.slug,
    'userId', a.user_id,
    'youtubeAccountId', a.youtube_account_id,
    'name', a.name,
    'status', a.status,
    'sourceType', a.source_type,
    'sourceKey', a.source_key,
    'sourceUrl', a.source_url,
    'settings', a.settings,
    'lastRunAt', CASE WHEN a.last_run_at IS NULL THEN NULL ELSE FLOOR(EXTRACT(EPOCH FROM a.last_run_at) * 1000)::bigint END,
    'nextRunAt', CASE WHEN a.next_run_at IS NULL THEN NULL ELSE FLOOR(EXTRACT(EPOCH FROM a.next_run_at) * 1000)::bigint END,
    'createdAt', FLOOR(EXTRACT(EPOCH FROM a.created_at) * 1000)::bigint
  )
  FROM automation_agents a
  WHERE a.user_id = ${sqlString(userId)}
    AND (a.id = ${sqlString(agentId)} OR a.slug = ${sqlString(agentId)})
  LIMIT 1
), 'null'::json);
`);
    return automationAgentFromRow(JSON.parse(out || "null"));
}
function nextAutomationPublishAt(settings, fromDate = new Date(), includeLead = true) {
    const normalized = normalizeAutomationSettings(settings);
    const times = normalized.scheduleTimes.slice().sort();
    const leadMs = includeLead ? normalized.scheduleLeadMinutes * 60_000 : 0;
    const base = new Date(fromDate.getTime() + 60_000 + leadMs);
    const offsetMs = 3 * 3600_000;
    const localBase = new Date(base.getTime() + offsetMs);
    const year = localBase.getUTCFullYear();
    const month = localBase.getUTCMonth();
    const date = localBase.getUTCDate();
    for (let day = 0; day < 14; day++) {
        for (const time of times) {
            const [hour, minute] = time.split(":").map(Number);
            const candidate = new Date(Date.UTC(year, month, date + day, hour, minute, 0, 0) - offsetMs);
            if (candidate.getTime() > base.getTime())
                return candidate;
        }
    }
    return new Date(base.getTime() + 24 * 3600_000);
}
function automationRunAtForPublish(settings, publishAt) {
    const normalized = normalizeAutomationSettings(settings);
    return new Date(new Date(publishAt).getTime() - normalized.scheduleLeadMinutes * 60_000);
}
function nextAutomationRunAt(settings, fromDate = new Date()) {
    return automationRunAtForPublish(settings, nextAutomationPublishAt(settings, fromDate));
}
function scheduleMinuteKey(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
        return "";
    date.setUTCSeconds(0, 0);
    return date.toISOString();
}
async function getAutomationDbScheduleMinutes(accountId) {
    const out = await runPsql(`
SELECT COALESCE(json_agg(to_char(date_trunc('minute', u.schedule_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')), '[]'::json)
FROM automation_uploads u
JOIN youtube_accounts upload_account ON upload_account.id = u.youtube_account_id
JOIN youtube_accounts selected_account ON selected_account.id = ${sqlString(accountId)}
WHERE upload_account.channel_id = selected_account.channel_id
  AND u.schedule_at IS NOT NULL
  AND u.schedule_at > now() - interval '1 day';
`);
    return JSON.parse(out || "[]").map(scheduleMinuteKey).filter(Boolean);
}
async function getYouTubeScheduledVideoMinutes(account) {
    if (!account?.uploadsPlaylistId || !account?.accessToken)
        return [];
    const ids = [];
    let pageToken = "";
    for (let page = 0; page < 3; page++) {
        const uploadsUrl = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
        uploadsUrl.searchParams.set("part", "contentDetails");
        uploadsUrl.searchParams.set("playlistId", account.uploadsPlaylistId);
        uploadsUrl.searchParams.set("maxResults", "50");
        if (pageToken)
            uploadsUrl.searchParams.set("pageToken", pageToken);
        const uploads = await fetchJsonWithAuth(uploadsUrl, account.accessToken);
        ids.push(...(uploads.items || []).map((item) => item.contentDetails?.videoId).filter(Boolean));
        pageToken = uploads.nextPageToken || "";
        if (!pageToken)
            break;
    }
    const minutes = [];
    for (let index = 0; index < ids.length; index += 50) {
        const videosUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
        videosUrl.searchParams.set("part", "status");
        videosUrl.searchParams.set("id", ids.slice(index, index + 50).join(","));
        const videos = await fetchJsonWithAuth(videosUrl, account.accessToken);
        for (const video of videos.items || []) {
            const publishAt = video.status?.publishAt;
            if (publishAt && new Date(publishAt).getTime() > Date.now() - 24 * 3600_000) {
                minutes.push(scheduleMinuteKey(publishAt));
            }
        }
    }
    return minutes.filter(Boolean);
}
async function getOccupiedAutomationScheduleMinutes(account) {
    const minutes = new Set(await getAutomationDbScheduleMinutes(account.id));
    try {
        const youtubeMinutes = await getYouTubeScheduledVideoMinutes(account);
        youtubeMinutes.forEach((minute) => minutes.add(minute));
    }
    catch (error) {
        console.warn("Could not check YouTube scheduled videos:", error instanceof Error ? error.message : error);
    }
    return minutes;
}
async function nextAvailableAutomationPublishAt(settings, account, fromDate = new Date()) {
    const occupied = await getOccupiedAutomationScheduleMinutes(account);
    let cursor = new Date(fromDate);
    for (let attempt = 0; attempt < 60; attempt++) {
        const candidate = nextAutomationPublishAt(settings, cursor);
        if (!occupied.has(scheduleMinuteKey(candidate)))
            return candidate;
        cursor = new Date(candidate.getTime() + 60_000);
    }
    return nextAutomationPublishAt(settings, cursor);
}
async function upsertAutomationAgent(userId, payload) {
    if (!payload.youtubeAccountId)
        throw new Error("Choose a YouTube channel for this agent.");
    if (!payload.sourceUrl && !payload.sourceKey)
        throw new Error("Choose a saved TikTok source or paste a source URL.");
    if (!payload.settings.rightsConfirmed)
        throw new Error("Confirm that this agent will only upload content you have rights to use.");
    const account = await getYouTubeAccount(userId, payload.youtubeAccountId);
    if (!account)
        throw new Error("YouTube account not found for this workspace.");
    const id = payload.id || `agt_${crypto.randomUUID()}`;
    if (payload.id) {
        const existingOwner = await runPsql(`SELECT COALESCE((SELECT user_id FROM automation_agents WHERE id = ${sqlString(id)} LIMIT 1), '');`);
        if (existingOwner && existingOwner !== userId)
            throw new Error("Automation agent not found.");
    }
    const slug = await automationAgentSlugForSave(id, payload.name);
    const nextRun = nextAutomationRunAt(payload.settings);
    const out = await runPsql(`
INSERT INTO automation_agents (
  id, slug, user_id, youtube_account_id, name, status, source_type, source_key, source_url, settings, next_run_at, created_at, updated_at
)
VALUES (
  ${sqlString(id)}, ${sqlString(slug)}, ${sqlString(userId)}, ${sqlString(payload.youtubeAccountId)}, ${sqlString(payload.name || "MSN Agent")},
  ${sqlString(payload.status)}, ${sqlString(payload.sourceType)}, ${sqlString(payload.sourceKey)}, ${sqlString(payload.sourceUrl)},
  ${jsonbLiteral(payload.settings)}, ${sqlString(nextRun.toISOString())}::timestamptz, now(), now()
)
ON CONFLICT (id) DO UPDATE SET
  slug = COALESCE(NULLIF(automation_agents.slug, ''), EXCLUDED.slug),
  user_id = EXCLUDED.user_id,
  youtube_account_id = EXCLUDED.youtube_account_id,
  name = EXCLUDED.name,
  status = EXCLUDED.status,
  source_type = EXCLUDED.source_type,
  source_key = EXCLUDED.source_key,
  source_url = EXCLUDED.source_url,
  settings = EXCLUDED.settings,
  next_run_at = EXCLUDED.next_run_at,
  updated_at = now()
RETURNING json_build_object(
  'id', id, 'slug', slug, 'youtubeAccountId', youtube_account_id, 'name', name, 'status', status,
  'sourceType', source_type, 'sourceKey', source_key, 'sourceUrl', source_url, 'settings', settings,
  'nextRunAt', FLOOR(EXTRACT(EPOCH FROM next_run_at) * 1000)::bigint
);
`);
    return JSON.parse(out || "null");
}
async function deleteAutomationAgent(userId, agentId) {
    const out = await runPsql(`
WITH target AS (
  SELECT a.id
  FROM automation_agents a
  WHERE a.user_id = ${sqlString(userId)}
    AND (a.id = ${sqlString(agentId)} OR a.slug = ${sqlString(agentId)})
  LIMIT 1
),
deleted AS (
  DELETE FROM automation_agents
  WHERE id IN (SELECT id FROM target)
  RETURNING id
)
SELECT COALESCE((SELECT id FROM deleted LIMIT 1), '');
`);
    return String(out || "").trim();
}
async function listAutomationRuns(agentId) {
    const out = await runPsql(`
SELECT COALESCE(json_agg(json_build_object(
  'id', id,
  'status', status,
  'message', message,
  'details', details,
  'startedAt', FLOOR(EXTRACT(EPOCH FROM started_at) * 1000)::bigint,
  'finishedAt', CASE WHEN finished_at IS NULL THEN NULL ELSE FLOOR(EXTRACT(EPOCH FROM finished_at) * 1000)::bigint END
) ORDER BY started_at DESC), '[]'::json)
FROM (
  SELECT * FROM automation_runs WHERE agent_id = ${sqlString(agentId)} ORDER BY started_at DESC LIMIT 20
) r;
`);
    return JSON.parse(out || "[]");
}
async function listAutomationUploads(agentId) {
    const out = await runPsql(`
SELECT COALESCE(json_agg(json_build_object(
  'id', id,
  'youtubeVideoId', youtube_video_id,
  'youtubeUrl', youtube_url,
  'sourceUrl', source_url,
  'sourceVideoId', source_video_id,
  'sourceAuthor', source_author,
  'movieTitle', movie_title,
  'movieYear', movie_year,
  'genre', genre,
  'microNiche', micro_niche,
  'title', title,
  'scheduleAt', CASE WHEN schedule_at IS NULL THEN NULL ELSE FLOOR(EXTRACT(EPOCH FROM schedule_at) * 1000)::bigint END,
  'status', status,
  'metrics', metrics,
  'commentReplyStats', (
    SELECT json_build_object(
      'total', COUNT(*),
      'movieName', COUNT(*) FILTER (WHERE reply_text ILIKE 'Movie:%'),
      'aiEngagement', COUNT(*) FILTER (WHERE reply_text NOT ILIKE 'Movie:%'),
      'lastReplyAt', CASE WHEN MAX(created_at) IS NULL THEN NULL ELSE FLOOR(EXTRACT(EPOCH FROM MAX(created_at)) * 1000)::bigint END
    )
    FROM automation_comment_replies r
    WHERE r.upload_id = u.id
  ),
  'description', description,
  'createdAt', FLOOR(EXTRACT(EPOCH FROM created_at) * 1000)::bigint
) ORDER BY created_at DESC), '[]'::json)
FROM (
  SELECT * FROM automation_uploads WHERE agent_id = ${sqlString(agentId)} ORDER BY created_at DESC LIMIT 50
) u;
`);
    return JSON.parse(out || "[]");
}
async function getAutomationUploadForUser(userId, uploadId) {
    const out = await runPsql(`
SELECT COALESCE((
  SELECT json_build_object(
    'id', u.id,
    'agentId', u.agent_id,
    'userId', u.user_id,
    'youtubeAccountId', u.youtube_account_id,
    'youtubeVideoId', u.youtube_video_id,
    'youtubeUrl', u.youtube_url,
    'sourceUrl', u.source_url,
    'sourceVideoId', u.source_video_id,
    'sourceAuthor', u.source_author,
    'movieKey', u.movie_key,
    'movieTitle', u.movie_title,
    'movieYear', u.movie_year,
    'genre', u.genre,
    'microNiche', u.micro_niche,
    'title', u.title,
    'description', u.description,
    'status', u.status,
    'metrics', u.metrics,
    'createdAt', FLOOR(EXTRACT(EPOCH FROM u.created_at) * 1000)::bigint
  )
  FROM automation_uploads u
  JOIN automation_agents a ON a.id = u.agent_id
  WHERE u.id = ${sqlString(uploadId)}
    AND u.user_id = ${sqlString(userId)}
    AND a.user_id = ${sqlString(userId)}
  LIMIT 1
), 'null'::json);
`);
    return JSON.parse(out || "null");
}
async function reuploadAutomationUpload(userId, uploadId) {
    const original = await getAutomationUploadForUser(userId, uploadId);
    if (!original)
        throw new Error("Automation upload not found.");
    if (!original.sourceUrl)
        throw new Error("Original source URL is missing.");
    const agent = await getAutomationAgent(userId, original.agentId);
    if (!agent)
        throw new Error("Automation agent not found.");
    const settings = normalizeAutomationSettings(agent.settings || {});
    const account = await usableYouTubeAccount(userId, original.youtubeAccountId);
    let tempFile = "";
    try {
        let candidateUrls = [];
        try {
            const sourceVideos = await loadAgentSourceVideos(agent);
            const sourceVideo = sourceVideos.find((video) => String(video.id || "") === String(original.sourceVideoId || "") || String(video.playUrl || "") === String(original.sourceUrl || ""));
            candidateUrls = sourceVideo?.cleanPlaybackUrls || [];
        }
        catch {
            candidateUrls = [];
        }
        tempFile = makeTikTokVideoCachePath();
        const downloader = await runTikTokDownloadWithAudioRetry({
            playUrl: original.sourceUrl,
            sourceUrl: original.sourceUrl,
            cleanPlaybackUrls: candidateUrls,
        }, tempFile);
        const videoBuffer = fs.readFileSync(tempFile);
        const upload = await uploadYouTubeVideo(account, {
            title: `${original.title || "Automation upload"} (HD test)`.slice(0, 100),
            description: original.description || "",
            tags: [],
            privacyStatus: "private",
            categoryId: settings.categoryId,
            madeForKids: settings.madeForKids,
        }, videoBuffer, "video/mp4");
        const newUploadId = `upl_${crypto.randomUUID()}`;
        const fileSize = fs.statSync(tempFile).size;
        await runPsql(`
INSERT INTO automation_uploads (
  id, agent_id, user_id, youtube_account_id, youtube_video_id, youtube_url, source_url, source_video_id, source_author,
  movie_key, movie_title, movie_year, genre, micro_niche, title, description, schedule_at, status, metrics, created_at, updated_at
)
VALUES (
  ${sqlString(newUploadId)}, ${sqlString(original.agentId)}, ${sqlString(userId)}, ${sqlString(account.id || original.youtubeAccountId)},
  ${sqlString(upload.id)}, ${sqlString(upload.url)}, ${sqlString(original.sourceUrl)}, ${sqlString(original.sourceVideoId)}, ${sqlString(original.sourceAuthor || "")},
  ${sqlString(original.movieKey || "")}, ${sqlString(original.movieTitle || "")}, ${sqlString(original.movieYear || "")}, ${sqlString(original.genre || "")},
  ${sqlString(original.microNiche || "")}, ${sqlString(`${original.title || "Automation upload"} (HD test)`.slice(0, 100))}, ${sqlString(original.description || "")},
  NULL, ${sqlString("hd_test")}, ${jsonbLiteral({ ...(original.metrics || {}), reuploadOf: original.id, reuploadDownloader: downloader, reuploadFileSize: fileSize })}, now(), now()
);
`);
        await captureAutomationPerformance(newUploadId, account, upload.id).catch(() => null);
        return { uploadId: newUploadId, youtubeVideoId: upload.id, youtubeUrl: upload.url, downloader, fileSize };
    }
    finally {
        if (tempFile) {
            try {
                fs.unlinkSync(tempFile);
            }
            catch {
                /* cache cleanup will catch it */
            }
        }
    }
}
function base64UrlEncode(input) {
    return Buffer.from(input).toString("base64url");
}
function base64UrlDecode(input) {
    return Buffer.from(input, "base64url").toString("utf8");
}
function authSecret() {
    return (process.env.AUTH_SECRET || process.env.SESSION_SECRET || "movieid-dev-session-secret").trim();
}
function signValue(value) {
    return crypto.createHmac("sha256", authSecret()).update(value).digest("base64url");
}
function signedValue(value) {
    return `${value}.${signValue(value)}`;
}
function verifySignedValue(raw) {
    const value = String(raw || "");
    const idx = value.lastIndexOf(".");
    if (idx <= 0)
        return "";
    const payload = value.slice(0, idx);
    const sig = value.slice(idx + 1);
    const expected = signValue(payload);
    try {
        if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
            return "";
    }
    catch {
        return "";
    }
    return payload;
}
function parseCookies(req) {
    const header = String(req.headers.cookie || "");
    const out = {};
    for (const part of header.split(";")) {
        const idx = part.indexOf("=");
        if (idx < 0)
            continue;
        const key = part.slice(0, idx).trim();
        const value = part.slice(idx + 1).trim();
        if (key)
            out[key] = decodeURIComponent(value);
    }
    return out;
}
function cookieOptions(extra = "") {
    const secure = (process.env.NODE_ENV || "").toLowerCase() === "production";
    return `HttpOnly; Path=/; SameSite=Lax${secure ? "; Secure" : ""}${extra ? `; ${extra}` : ""}`;
}
function setSessionCookie(res, sessionId) {
    res.setHeader("Set-Cookie", `movieid_session=${encodeURIComponent(signedValue(sessionId))}; ${cookieOptions("Max-Age=2592000")}`);
}
function clearSessionCookie(res) {
    res.setHeader("Set-Cookie", `movieid_session=; ${cookieOptions("Max-Age=0")}`);
}
function googleOAuthConfigured() {
    return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}
function publicAppUrl(req) {
    const configured = (process.env.APP_URL || process.env.PUBLIC_APP_URL || "").replace(/\/+$/, "");
    if (configured)
        return configured;
    const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
    return `${proto}://${req.headers.host}`;
}
function googleRedirectUri(req) {
    return `${publicAppUrl(req)}/api/auth/google/callback`;
}
const GOOGLE_SIGNIN_SCOPES = [
    "openid",
    "email",
    "profile",
];
const GOOGLE_YOUTUBE_SCOPES = [
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/yt-analytics.readonly",
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.force-ssl",
];
function googleOAuthScopesForMode(mode) {
    return mode === "connect" ? [...GOOGLE_SIGNIN_SCOPES, ...GOOGLE_YOUTUBE_SCOPES] : GOOGLE_SIGNIN_SCOPES;
}
function makeOAuthState(payload) {
    const body = base64UrlEncode(JSON.stringify({ ...payload, ts: Date.now(), nonce: crypto.randomUUID() }));
    return signedValue(body);
}
function readOAuthState(state) {
    const body = verifySignedValue(state);
    if (!body)
        throw new Error("Invalid OAuth state");
    const parsed = JSON.parse(base64UrlDecode(body));
    if (!parsed.ts || Date.now() - Number(parsed.ts) > 10 * 60 * 1000) {
        throw new Error("OAuth state expired");
    }
    return parsed;
}
async function fetchJsonWithAuth(url, accessToken) {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data?.error?.message || data?.error_description || `Google request failed (${response.status})`);
    }
    return data;
}
async function fetchGoogleWithAuth(url, accessToken, init = {}) {
    const headers = new Headers(init.headers || {});
    headers.set("Authorization", `Bearer ${accessToken}`);
    const response = await fetch(url, { ...init, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data?.error?.message || data?.error_description || `Google request failed (${response.status})`);
    }
    return data;
}
async function exchangeGoogleCode(req, code) {
    const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            code,
            client_id: process.env.GOOGLE_CLIENT_ID || "",
            client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
            redirect_uri: googleRedirectUri(req),
            grant_type: "authorization_code",
        }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data?.error_description || data?.error || `Google token exchange failed (${response.status})`);
    }
    return data;
}
async function fetchGoogleProfile(accessToken) {
    const data = await fetchJsonWithAuth("https://openidconnect.googleapis.com/v1/userinfo", accessToken);
    return {
        googleSub: String(data.sub || ""),
        email: String(data.email || ""),
        name: String(data.name || data.email || "Google user"),
        avatarUrl: String(data.picture || ""),
    };
}
async function fetchGoogleYouTubeChannels(accessToken) {
    const url = new URL("https://www.googleapis.com/youtube/v3/channels");
    url.searchParams.set("part", "snippet,statistics,contentDetails");
    url.searchParams.set("mine", "true");
    url.searchParams.set("maxResults", "50");
    const data = await fetchJsonWithAuth(url, accessToken);
    return (data.items || []).map((channel) => ({
        channelId: String(channel.id || ""),
        title: String(channel.snippet?.title || "YouTube channel"),
        handle: String(channel.snippet?.customUrl || ""),
        thumbnailUrl: String(channel.snippet?.thumbnails?.high?.url || channel.snippet?.thumbnails?.medium?.url || channel.snippet?.thumbnails?.default?.url || ""),
        uploadsPlaylistId: String(channel.contentDetails?.relatedPlaylists?.uploads || ""),
        stats: {
            viewCount: Number(channel.statistics?.viewCount || 0),
            subscriberCount: Number(channel.statistics?.subscriberCount || 0),
            videoCount: Number(channel.statistics?.videoCount || 0),
        },
    })).filter((channel) => channel.channelId);
}
async function upsertAuthUser(profile) {
    const id = `usr_${crypto.createHash("sha256").update(profile.googleSub).digest("hex").slice(0, 24)}`;
    const out = await runPsql(`
INSERT INTO auth_users (id, google_sub, email, name, avatar_url, created_at, updated_at)
VALUES (${sqlString(id)}, ${sqlString(profile.googleSub)}, ${sqlString(profile.email)}, ${sqlString(profile.name)}, ${sqlString(profile.avatarUrl)}, now(), now())
ON CONFLICT (google_sub) DO UPDATE SET
  email = EXCLUDED.email,
  name = EXCLUDED.name,
  avatar_url = EXCLUDED.avatar_url,
  updated_at = now()
RETURNING json_build_object('id', id, 'googleSub', google_sub, 'email', email, 'name', name, 'avatarUrl', avatar_url);
`);
    return JSON.parse(out || "null");
}
async function createAuthSession(userId) {
    const id = `ses_${crypto.randomUUID()}`;
    await runPsql(`
INSERT INTO auth_sessions (id, user_id, expires_at, created_at, updated_at)
VALUES (${sqlString(id)}, ${sqlString(userId)}, now() + interval '30 days', now(), now());
`);
    return id;
}
async function getSessionRecord(req) {
    const raw = parseCookies(req).movieid_session;
    const sessionId = verifySignedValue(raw || "");
    if (!sessionId)
        return null;
    const out = await runPsql(`
SELECT COALESCE((
  SELECT json_build_object(
    'id', s.id,
    'activeYoutubeAccountId', s.active_youtube_account_id,
    'user', json_build_object('id', u.id, 'email', u.email, 'name', u.name, 'avatarUrl', u.avatar_url)
  )
  FROM auth_sessions s
  JOIN auth_users u ON u.id = s.user_id
  WHERE s.id = ${sqlString(sessionId)} AND s.expires_at > now()
  LIMIT 1
), 'null'::json);
`);
    return JSON.parse(out || "null");
}
async function listYouTubeAccounts(userId) {
    const out = await runPsql(`
SELECT COALESCE(json_agg(json_build_object(
  'id', id,
  'email', email,
  'googleSub', google_sub,
  'channelId', channel_id,
  'channelTitle', channel_title,
  'channelHandle', channel_handle,
  'thumbnailUrl', thumbnail_url,
      'uploadsPlaylistId', uploads_playlist_id,
      'scope', scope,
      'connectedAt', FLOOR(EXTRACT(EPOCH FROM connected_at) * 1000)::bigint
) ORDER BY connected_at DESC), '[]'::json)
FROM youtube_accounts
WHERE user_id = ${sqlString(userId)};
`);
    return JSON.parse(out || "[]");
}
async function saveYouTubeAccounts(userId, profile, tokenData, channels) {
    const expiresAtMs = Date.now() + Math.max(Number(tokenData.expires_in || 3600) - 60, 60) * 1000;
    const saved = [];
    for (const channel of channels) {
        const id = `yta_${crypto.createHash("sha256").update(`${userId}:${channel.channelId}`).digest("hex").slice(0, 24)}`;
        const existing = await runPsql(`SELECT COALESCE((SELECT refresh_token FROM youtube_accounts WHERE id = ${sqlString(id)}), '');`);
        const refreshToken = tokenData.refresh_token || existing || "";
        const out = await runPsql(`
INSERT INTO youtube_accounts (
  id, user_id, google_sub, email, channel_id, channel_title, channel_handle, thumbnail_url, uploads_playlist_id,
  access_token, refresh_token, token_expires_at, scope, connected_at, updated_at
)
VALUES (
  ${sqlString(id)}, ${sqlString(userId)}, ${sqlString(profile.googleSub)}, ${sqlString(profile.email)},
  ${sqlString(channel.channelId)}, ${sqlString(channel.title)}, ${sqlString(channel.handle)}, ${sqlString(channel.thumbnailUrl)}, ${sqlString(channel.uploadsPlaylistId)},
  ${sqlString(tokenData.access_token)}, ${sqlString(refreshToken)}, to_timestamp(${sqlNumber(expiresAtMs)} / 1000.0), ${sqlString(tokenData.scope || "")}, now(), now()
)
ON CONFLICT (user_id, channel_id) DO UPDATE SET
  google_sub = EXCLUDED.google_sub,
  email = EXCLUDED.email,
  channel_title = EXCLUDED.channel_title,
  channel_handle = EXCLUDED.channel_handle,
  thumbnail_url = EXCLUDED.thumbnail_url,
  uploads_playlist_id = EXCLUDED.uploads_playlist_id,
  access_token = EXCLUDED.access_token,
  refresh_token = COALESCE(NULLIF(EXCLUDED.refresh_token, ''), youtube_accounts.refresh_token),
  token_expires_at = EXCLUDED.token_expires_at,
  scope = EXCLUDED.scope,
  updated_at = now()
RETURNING json_build_object('id', id, 'channelId', channel_id, 'channelTitle', channel_title, 'email', email);
`);
        saved.push(JSON.parse(out || "null"));
    }
    return saved.filter(Boolean);
}
async function getYouTubeAccount(userId, accountId) {
    const out = await runPsql(`
SELECT COALESCE((
  SELECT json_build_object(
    'id', id,
    'userId', user_id,
    'email', email,
    'googleSub', google_sub,
    'channelId', channel_id,
    'channelTitle', channel_title,
    'channelHandle', channel_handle,
    'thumbnailUrl', thumbnail_url,
      'uploadsPlaylistId', uploads_playlist_id,
      'accessToken', access_token,
      'refreshToken', refresh_token,
      'scope', scope,
      'tokenExpiresAt', FLOOR(EXTRACT(EPOCH FROM token_expires_at) * 1000)::bigint
  )
  FROM youtube_accounts
  WHERE id = ${sqlString(accountId)} AND user_id = ${sqlString(userId)}
  LIMIT 1
), 'null'::json);
`);
    return JSON.parse(out || "null");
}
async function refreshGoogleToken(account) {
    if (!account.refreshToken)
        throw new Error("This YouTube connection has no refresh token. Reconnect the account.");
    const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID || "",
            client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
            refresh_token: account.refreshToken,
            grant_type: "refresh_token",
        }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data?.error_description || data?.error || `Google token refresh failed (${response.status})`);
    }
    const expiresAtMs = Date.now() + Math.max(Number(data.expires_in || 3600) - 60, 60) * 1000;
    await runPsql(`
UPDATE youtube_accounts
SET access_token = ${sqlString(data.access_token)}, token_expires_at = to_timestamp(${sqlNumber(expiresAtMs)} / 1000.0), updated_at = now()
WHERE id = ${sqlString(account.id)};
`);
    return { ...account, accessToken: data.access_token, tokenExpiresAt: expiresAtMs };
}
async function usableYouTubeAccount(userId, accountId) {
    let account = await getYouTubeAccount(userId, accountId);
    if (!account)
        throw new Error("YouTube account not found");
    if (Number(account.tokenExpiresAt || 0) < Date.now() + 60_000) {
        account = await refreshGoogleToken(account);
    }
    return account;
}
function accountHasScope(account, scope) {
    return String(account?.scope || "").split(/\s+/).includes(scope);
}
function requireYouTubeScope(account, scope, label) {
    if (!accountHasScope(account, scope)) {
        const error = new Error(`${label} permission is missing. Reconnect Google from the account switcher to grant the new scope.`);
        error.statusCode = 403;
        throw error;
    }
}
async function currentAuthPayload(req) {
    if (!postgresConfigured()) {
        return { user: null, accounts: [], activeAccount: null, googleConfigured: googleOAuthConfigured(), dbConfigured: false };
    }
    const session = await getSessionRecord(req);
    if (!session?.user) {
        return { user: null, accounts: [], activeAccount: null, googleConfigured: googleOAuthConfigured(), dbConfigured: true };
    }
    const accounts = await listYouTubeAccounts(session.user.id);
    const activeAccount = accounts.find((account) => account.id === session.activeYoutubeAccountId) || accounts[0] || null;
    return { user: session.user, accounts, activeAccount, googleConfigured: googleOAuthConfigured(), dbConfigured: true };
}
function yyyyMmDd(date) {
    return date.toISOString().slice(0, 10);
}
function safeYouTubeTags(raw) {
    return String(raw || "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 25);
}
function safePrivacyStatus(raw) {
    const value = String(raw || "private").toLowerCase();
    return ["private", "unlisted", "public"].includes(value) ? value : "private";
}
function analyticsRowsToObjects(data) {
    const headers = (data.columnHeaders || []).map((header) => header.name);
    return (data.rows || []).map((row) => Object.fromEntries(row.map((value, index) => [headers[index] || `col${index}`, value])));
}
async function uploadYouTubeVideo(account, metadata, videoBuffer, mimeType) {
    requireYouTubeScope(account, "https://www.googleapis.com/auth/youtube.upload", "YouTube upload");
    if (!videoBuffer?.length) {
        throw new Error("Video file is required.");
    }
    const uploadContentType = mimeType && mimeType !== "application/octet-stream" ? mimeType : "video/mp4";
    await assertUploadBufferHasAudio(videoBuffer, uploadContentType);
    const initUrl = new URL("https://www.googleapis.com/upload/youtube/v3/videos");
    initUrl.searchParams.set("uploadType", "resumable");
    initUrl.searchParams.set("part", "snippet,status");
    const initResponse = await fetch(initUrl, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${account.accessToken}`,
            "Content-Type": "application/json; charset=UTF-8",
            "X-Upload-Content-Length": String(videoBuffer.length),
            "X-Upload-Content-Type": uploadContentType,
        },
        body: JSON.stringify({
            snippet: {
                title: metadata.title,
                description: metadata.description || "",
                tags: metadata.tags || [],
                categoryId: metadata.categoryId || "22",
            },
            status: {
                privacyStatus: metadata.publishAt ? "private" : safePrivacyStatus(metadata.privacyStatus),
                selfDeclaredMadeForKids: metadata.madeForKids === true,
                ...(metadata.publishAt ? { publishAt: metadata.publishAt } : {}),
            },
        }),
    });
    const location = initResponse.headers.get("location");
    if (!initResponse.ok || !location) {
        const data = await initResponse.json().catch(() => ({}));
        throw new Error(data?.error?.message || `Could not start YouTube upload (${initResponse.status})`);
    }
    const uploadResponse = await fetch(location, {
        method: "PUT",
        headers: {
            "Content-Length": String(videoBuffer.length),
            "Content-Type": uploadContentType,
        },
        body: videoBuffer,
    });
    const data = await uploadResponse.json().catch(() => ({}));
    if (!uploadResponse.ok) {
        throw new Error(data?.error?.message || `YouTube upload failed (${uploadResponse.status})`);
    }
    return {
        id: String(data.id || ""),
        url: data.id ? `https://www.youtube.com/watch?v=${data.id}` : "",
        title: data.snippet?.title || metadata.title,
        privacyStatus: data.status?.privacyStatus || safePrivacyStatus(metadata.privacyStatus),
        raw: data,
    };
}
async function uploadYouTubeVideoFromFile(account, metadata, filePath, mimeType = "video/mp4") {
    requireYouTubeScope(account, "https://www.googleapis.com/auth/youtube.upload", "YouTube upload");
    if (!filePath || !fs.existsSync(filePath))
        throw new Error("Compiled video file is missing.");
    await assertVideoHasAudio(filePath, "Compiled video");
    const stat = fs.statSync(filePath);
    if (!stat.size)
        throw new Error("Compiled video file is empty.");
    const maxBytes = Math.min(Math.max(Number(process.env.COMPILATION_MAX_UPLOAD_BYTES) || 3 * 1024 * 1024 * 1024, 50 * 1024 * 1024), 10 * 1024 * 1024 * 1024);
    if (stat.size > maxBytes)
        throw new Error(`Compiled video is too large (${Math.ceil(stat.size / 1024 / 1024)}MB). Increase COMPILATION_MAX_UPLOAD_BYTES if this is expected.`);
    const uploadContentType = mimeType && mimeType !== "application/octet-stream" ? mimeType : "video/mp4";
    const initUrl = new URL("https://www.googleapis.com/upload/youtube/v3/videos");
    initUrl.searchParams.set("uploadType", "resumable");
    initUrl.searchParams.set("part", "snippet,status");
    const initResponse = await fetch(initUrl, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${account.accessToken}`,
            "Content-Type": "application/json; charset=UTF-8",
            "X-Upload-Content-Length": String(stat.size),
            "X-Upload-Content-Type": uploadContentType,
        },
        body: JSON.stringify({
            snippet: {
                title: metadata.title,
                description: metadata.description || "",
                tags: metadata.tags || [],
                categoryId: metadata.categoryId || "22",
            },
            status: {
                privacyStatus: metadata.publishAt ? "private" : safePrivacyStatus(metadata.privacyStatus),
                selfDeclaredMadeForKids: metadata.madeForKids === true,
                ...(metadata.publishAt ? { publishAt: metadata.publishAt } : {}),
            },
        }),
    });
    const location = initResponse.headers.get("location");
    if (!initResponse.ok || !location) {
        const data = await initResponse.json().catch(() => ({}));
        throw new Error(data?.error?.message || `Could not start YouTube upload (${initResponse.status})`);
    }
    const uploadResponse = await fetch(location, {
        method: "PUT",
        headers: {
            "Content-Length": String(stat.size),
            "Content-Type": uploadContentType,
        },
        body: fs.createReadStream(filePath),
        duplex: "half",
    });
    const data = await uploadResponse.json().catch(() => ({}));
    if (!uploadResponse.ok)
        throw new Error(data?.error?.message || `YouTube upload failed (${uploadResponse.status})`);
    return {
        id: String(data.id || ""),
        url: data.id ? `https://www.youtube.com/watch?v=${data.id}` : "",
        title: data.snippet?.title || metadata.title,
        privacyStatus: data.status?.privacyStatus || safePrivacyStatus(metadata.privacyStatus),
        raw: data,
    };
}
async function listYouTubePlaylists(account) {
    requireYouTubeScope(account, "https://www.googleapis.com/auth/youtube.readonly", "YouTube playlists");
    const playlists = [];
    let pageToken = "";
    for (let page = 0; page < 5; page++) {
        const url = new URL("https://www.googleapis.com/youtube/v3/playlists");
        url.searchParams.set("part", "snippet,status,contentDetails");
        url.searchParams.set("mine", "true");
        url.searchParams.set("maxResults", "50");
        if (pageToken)
            url.searchParams.set("pageToken", pageToken);
        const data = await fetchJsonWithAuth(url, account.accessToken);
        playlists.push(...(data.items || []).map((item) => ({
            id: String(item.id || ""),
            title: String(item.snippet?.title || ""),
            description: String(item.snippet?.description || ""),
            thumbnailUrl: item.snippet?.thumbnails?.maxres?.url || item.snippet?.thumbnails?.standard?.url || item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || "",
            privacyStatus: String(item.status?.privacyStatus || ""),
            videoCount: Number(item.contentDetails?.itemCount || 0),
        })).filter((item) => item.id));
        pageToken = data.nextPageToken || "";
        if (!pageToken)
            break;
    }
    return playlists;
}
async function createYouTubePlaylist(account, { title, description = "", privacyStatus = "private" }) {
    requireYouTubeScope(account, "https://www.googleapis.com/auth/youtube.force-ssl", "YouTube playlist creation");
    const cleanTitle = String(title || "").trim().slice(0, 150);
    if (!cleanTitle)
        throw new Error("Playlist title is required.");
    const url = new URL("https://www.googleapis.com/youtube/v3/playlists");
    url.searchParams.set("part", "snippet,status");
    const data = await fetchGoogleWithAuth(url, account.accessToken, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=UTF-8" },
        body: JSON.stringify({
            snippet: {
                title: cleanTitle,
                description: String(description || "").slice(0, 5000),
            },
            status: {
                privacyStatus: safePrivacyStatus(privacyStatus),
            },
        }),
    });
    return {
        id: String(data.id || ""),
        title: String(data.snippet?.title || cleanTitle),
        description: String(data.snippet?.description || ""),
        privacyStatus: String(data.status?.privacyStatus || privacyStatus),
        videoCount: 0,
    };
}
async function addVideoToYouTubePlaylist(account, playlistId, videoId) {
    requireYouTubeScope(account, "https://www.googleapis.com/auth/youtube.force-ssl", "YouTube playlist update");
    const cleanPlaylistId = String(playlistId || "").trim();
    const cleanVideoId = String(videoId || "").trim();
    if (!cleanPlaylistId || !cleanVideoId)
        return null;
    const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
    url.searchParams.set("part", "snippet");
    try {
        const data = await fetchGoogleWithAuth(url, account.accessToken, {
            method: "POST",
            headers: { "Content-Type": "application/json; charset=UTF-8" },
            body: JSON.stringify({
                snippet: {
                    playlistId: cleanPlaylistId,
                    resourceId: {
                        kind: "youtube#video",
                        videoId: cleanVideoId,
                    },
                },
            }),
        });
        return { id: String(data.id || ""), playlistId: cleanPlaylistId, videoId: cleanVideoId };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error || "");
        if (/duplicate|already exists/i.test(message))
            return { id: "", playlistId: cleanPlaylistId, videoId: cleanVideoId, duplicate: true };
        throw error;
    }
}
function suggestAutomationPlaylistTitle(settings, metadata = {}, movie = null) {
    const haystack = [
        metadata.genre,
        metadata.microNiche,
        metadata.title,
        movie?.title,
        movie?.genre,
        movie?.mediaType,
        settings.genreFocus,
        settings.microNicheGoal,
    ].filter(Boolean).join(" ").toLowerCase();
    if (/(anime|manga|manhwa|manhua|webtoon|donghua)/i.test(haystack))
        return "Anime Recaps";
    if (/(finance|money|invest|stock|credit|bank|tax|budget|mortgage|wealth|business)/i.test(haystack))
        return "Finance Automation";
    if (/(ai cartoon|cartoon|animation|animated story|aicat)/i.test(haystack))
        return "AI Cartoons";
    if (/(ai|chatgpt|automation|artificial intelligence|prompt|workflow)/i.test(haystack))
        return "AI Automation";
    if (/(history|ancient|empire|war story|forgotten)/i.test(haystack))
        return "History Explained";
    if (/(military|tank|fighter jet|submarine|machinery|weapon)/i.test(haystack))
        return "Military & Machinery";
    if (/(space|science|astronomy|nasa|physics|mystery)/i.test(haystack))
        return "Space & Science";
    if (/(movie|film|recap|cinema|thriller|horror|sci-fi|scifi)/i.test(haystack))
        return "Movie Recaps";
    const fallback = String(settings.genreFocus || "").trim();
    return fallback && fallback.length <= 80 ? fallback : "AutoYT Picks";
}
async function resolveAutomationTargetPlaylist(account, settings, metadata = {}, movie = null) {
    const normalized = normalizeAutomationSettings(settings);
    const mode = normalized.targetPlaylistMode;
    if (mode === "none")
        return "";
    if (mode === "existing" && normalized.targetPlaylistId)
        return normalized.targetPlaylistId;
    const suggestedTitle = suggestAutomationPlaylistTitle(normalized, metadata, movie);
    const wantedTitle = mode === "auto"
        ? (suggestedTitle === "AutoYT Picks" && normalized.targetPlaylistTitle ? normalized.targetPlaylistTitle : suggestedTitle)
        : normalized.targetPlaylistTitle;
    if (mode === "create" && !wantedTitle)
        return "";
    const playlists = await listYouTubePlaylists(account).catch(() => []);
    const wanted = String(wantedTitle || "").trim().toLowerCase();
    if (!wanted)
        return "";
    const existing = playlists.find((playlist) => playlist.title.trim().toLowerCase() === wanted);
    if (existing?.id)
        return existing.id;
    if (mode === "auto" && !normalized.autoCreatePlaylists && !normalized.createTargetPlaylist)
        return "";
    if (mode === "create" && !normalized.createTargetPlaylist)
        return "";
    const created = await createYouTubePlaylist(account, {
        title: wantedTitle,
        description: "Uploads created by AutoYT automation.",
        privacyStatus: "public",
    });
    return created.id || "";
}
function compilationWorkspaceDir() {
    const dir = path.join(__dirname, "tmp", "compilations");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}
function createCompilationWorkspace() {
    const dir = path.join(compilationWorkspaceDir(), `comp_${crypto.randomUUID()}_${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}
function compilationDownloadDir() {
    const dir = path.join(__dirname, "tmp", "compiled-downloads");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}
function isCompilationDownloadName(name) {
    return /^comp_[a-f0-9-]+_\d+\.mp4$/i.test(String(name || ""));
}
function cleanupCompilationDownloads() {
    const maxAgeMs = Math.min(Math.max(Number(process.env.COMPILATION_DOWNLOAD_MAX_AGE_MS) || 24 * 60 * 60 * 1000, 60 * 60 * 1000), 7 * 24 * 60 * 60 * 1000);
    const now = Date.now();
    try {
        for (const entry of fs.readdirSync(compilationDownloadDir())) {
            if (!isCompilationDownloadName(entry))
                continue;
            const filePath = path.join(compilationDownloadDir(), entry);
            const stat = fs.statSync(filePath);
            if (now - stat.mtimeMs > maxAgeMs)
                fs.unlinkSync(filePath);
        }
    }
    catch {
        /* best effort */
    }
}
function persistCompilationDownload(filePath) {
    cleanupCompilationDownloads();
    const name = `comp_${crypto.randomUUID()}_${Date.now()}.mp4`;
    const target = path.join(compilationDownloadDir(), name);
    fs.copyFileSync(filePath, target);
    return { name, path: target, downloadUrl: `/api/compilations/download/${name}` };
}
function cleanupCompilationWorkspace(dir) {
    if (!dir)
        return;
    try {
        const resolved = path.resolve(dir);
        const root = path.resolve(compilationWorkspaceDir());
        if (resolved.startsWith(root))
            fs.rmSync(resolved, { recursive: true, force: true });
    }
    catch {
        /* best effort */
    }
}
function compilationVideoDuration(video) {
    const raw = video?.durationSeconds ?? video?.duration ?? video?.lengthSeconds ?? 0;
    const seconds = Number(raw);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}
function normalizeCompilationVideoInput(video) {
    const id = String(video?.id || video?.videoId || "").trim();
    const playUrl = String(video?.playUrl || video?.url || video?.sourceUrl || "").trim();
    const authorHandle = String(video?.authorHandle || video?.uploaderId || video?.author || "").replace(/^@+/, "").trim();
    const title = String(video?.title || "TikTok clip").trim();
    if (!playUrl && !(id && authorHandle))
        return null;
    return {
        id,
        title,
        author: String(video?.author || authorHandle || "").trim(),
        authorHandle,
        playUrl: playUrl || `https://www.tiktok.com/@${authorHandle}/video/${id}`,
        dynamicCover: String(video?.dynamicCover || video?.thumbnailUrl || "").trim(),
        durationSeconds: compilationVideoDuration(video),
        stats: video?.stats || {},
        cleanPlaybackUrls: Array.isArray(video?.cleanPlaybackUrls) ? video.cleanPlaybackUrls : [],
        createdAt: video?.createdAt,
        width: video?.width,
        height: video?.height,
    };
}
function compilationLayoutFilter(layout) {
    if (layout === "landscape")
        return "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p";
    return "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p";
}
function safeConcatPath(filePath) {
    return String(filePath || "").replace(/\\/g, "/").replace(/'/g, "'\\''");
}
async function buildCompilationVideo(videos, options = {}) {
    const clips = (Array.isArray(videos) ? videos : []).map(normalizeCompilationVideoInput).filter(Boolean);
    if (!clips.length)
        throw new Error("Select at least one clip for the compilation.");
    const maxClips = Math.min(Math.max(Number(options.maxClips) || clips.length, 1), 300);
    const selected = clips.slice(0, maxClips);
    const workspace = createCompilationWorkspace();
    const downloaded = [];
    const normalized = [];
    const skipped = [];
    const layout = options.layout === "landscape" ? "landscape" : "vertical";
    try {
        for (let index = 0; index < selected.length; index += 1) {
            const clip = selected[index];
            const rawPath = path.join(workspace, `raw_${String(index + 1).padStart(3, "0")}.mp4`);
            try {
                const downloader = await runTikTokDownloadWithAudioRetry(clip, rawPath, { preferYtDlp: true });
                downloaded.push({ clip, rawPath, downloader });
                const normalizedPath = path.join(workspace, `clip_${String(index + 1).padStart(3, "0")}.mp4`);
                await runFfmpeg([
                    "-y",
                    "-threads", String(process.env.COMPILATION_FFMPEG_THREADS || 1),
                    "-i", rawPath,
                    "-vf", compilationLayoutFilter(layout),
                    "-c:v", "libx264",
                    "-threads:v", String(process.env.COMPILATION_FFMPEG_THREADS || 1),
                    "-preset", process.env.COMPILATION_FFMPEG_PRESET || "veryfast",
                    "-crf", String(process.env.COMPILATION_CRF || 20),
                    "-c:a", "aac",
                    "-ar", "44100",
                    "-ac", "2",
                    "-b:a", "160k",
                    "-movflags", "+faststart",
                    normalizedPath,
                ], Math.min(Math.max(Number(process.env.COMPILATION_NORMALIZE_TIMEOUT_MS) || 10 * 60 * 1000, 60 * 1000), 60 * 60 * 1000));
                await assertVideoHasAudio(normalizedPath, "Normalized clip");
                normalized.push({ clip, path: normalizedPath });
            }
            catch (error) {
                skipped.push({
                    id: clip.id,
                    url: clip.playUrl,
                    reason: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
                });
            }
        }
        if (!normalized.length) {
            const reasons = skipped.slice(0, 5)
                .map((item, index) => `${index + 1}. ${item.reason}`)
                .join(" | ");
            throw new Error(`No selected clips could be downloaded with confirmed audio.${reasons ? ` ${reasons}` : ""}`);
        }
        const concatList = path.join(workspace, "concat.txt");
        fs.writeFileSync(concatList, normalized.map((item) => `file '${safeConcatPath(item.path)}'`).join("\n"), "utf8");
        const outputPath = path.join(workspace, "autoyt-compilation.mp4");
        await runFfmpeg([
            "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", concatList,
            "-c", "copy",
            "-movflags", "+faststart",
            outputPath,
        ], Math.min(Math.max(Number(process.env.COMPILATION_CONCAT_TIMEOUT_MS) || 20 * 60 * 1000, 60 * 1000), 90 * 60 * 1000));
        await assertVideoHasAudio(outputPath, "Compilation");
        const totalSeconds = normalized.reduce((sum, item) => sum + compilationVideoDuration(item.clip), 0);
        return { workspace, outputPath, clips: normalized.map((item) => item.clip), skipped, totalSeconds, layout };
    }
    catch (error) {
        cleanupCompilationWorkspace(workspace);
        throw error;
    }
}
function compilationDefaultTitle(sourceTitle = "", clips = []) {
    const source = String(sourceTitle || "").trim();
    if (source)
        return `${source} compilation`;
    const firstTitle = String(clips[0]?.title || "").replace(/\s+/g, " ").trim();
    return firstTitle ? `${firstTitle.slice(0, 70)} compilation` : "AutoYT compilation";
}
async function createCompilationUpload(userId, body = {}, agent = null) {
    const outputMode = String(body.outputMode || body.mode || "upload").trim().toLowerCase() === "download" ? "download" : "upload";
    const settings = normalizeAutomationSettings(agent?.settings || {});
    const videos = Array.isArray(body.videos) && body.videos.length ? body.videos : agent ? await loadAgentSourceVideos(agent) : [];
    const minSeconds = Math.max(Number(body.minMinutes ?? settings.compilationMinMinutes) || 0, 0) * 60;
    const maxSeconds = Math.max(Number(body.maxMinutes ?? settings.compilationMaxMinutes) || 0, 0) * 60;
    const maxClips = Math.min(Math.max(Number(body.maxClips ?? settings.compilationMaxClips) || 80, 1), 300);
    let selected = (videos || []).map(normalizeCompilationVideoInput).filter(Boolean);
    if (maxSeconds > 0) {
        const next = [];
        let total = 0;
        for (const clip of selected) {
            const duration = compilationVideoDuration(clip) || 60;
            if (next.length && total + duration > maxSeconds)
                continue;
            next.push(clip);
            total += duration;
            if (total >= minSeconds)
                break;
            if (next.length >= maxClips)
                break;
        }
        selected = next;
    }
    else {
        selected = selected.slice(0, maxClips);
    }
    if (!selected.length)
        throw new Error("No clips were available for the compilation.");
    if (minSeconds > 0) {
        const projected = selected.reduce((sum, clip) => sum + (compilationVideoDuration(clip) || 60), 0);
        if (projected < minSeconds)
            throw new Error(`Not enough selected clips to reach ${Math.round(minSeconds / 60)} minutes.`);
    }
    const built = await buildCompilationVideo(selected, {
        layout: String(body.layout || settings.compilationLayout || "vertical"),
        maxClips,
    });
    try {
        const title = String(body.title || settings.compilationTitle || compilationDefaultTitle(body.sourceTitle || agent?.name, built.clips)).trim().slice(0, 100);
        const description = String(body.description || settings.compilationDescription || `Compiled by AutoYT from ${built.clips.length} selected clips.`).trim().slice(0, 5000);
        const publishAt = body.publishAt ? String(body.publishAt) : "";
        const privacyStatus = safePrivacyStatus(body.privacyStatus || (settings.publishMode === "unlisted" ? "unlisted" : "private"));
        if (outputMode === "download") {
            const file = persistCompilationDownload(built.outputPath);
            return { file: { ...file, title, url: file.downloadUrl }, clips: built.clips, skipped: built.skipped, totalSeconds: built.totalSeconds, outputBytes: fs.statSync(file.path).size };
        }
        const accountId = String(body.accountId || agent?.youtubeAccountId || "").trim();
        const account = await usableYouTubeAccount(userId, accountId);
        const upload = await uploadYouTubeVideoFromFile(account, {
            title,
            description,
            tags: safeYouTubeTags(body.tags || settings.genreFocus || ""),
            privacyStatus,
            publishAt,
            categoryId: String(body.categoryId || settings.categoryId || "24"),
            madeForKids: body.madeForKids === true || settings.madeForKids === true,
        }, built.outputPath, "video/mp4");
        let targetPlaylistId = String(body.playlistId || "").trim();
        const createPlaylistTitle = String(body.createPlaylistTitle || "").trim();
        if (!targetPlaylistId && createPlaylistTitle) {
            const created = await createYouTubePlaylist(account, {
                title: createPlaylistTitle,
                description: "Long-form compilations created from AutoYT.",
                privacyStatus: "public",
            });
            targetPlaylistId = created.id || "";
        }
        if (!targetPlaylistId && agent) {
            targetPlaylistId = await resolveAutomationTargetPlaylist(account, settings, { title, description, genre: settings.genreFocus, microNiche: settings.microNicheGoal }, null).catch(() => "");
        }
        let playlistItem = null;
        if (targetPlaylistId && upload.id) {
            playlistItem = await addVideoToYouTubePlaylist(account, targetPlaylistId, upload.id);
        }
        return { upload: { ...upload, playlistItem }, clips: built.clips, skipped: built.skipped, totalSeconds: built.totalSeconds, outputBytes: fs.statSync(built.outputPath).size };
    }
    finally {
        cleanupCompilationWorkspace(built.workspace);
    }
}
async function runAutomationCompilationOnce(userId, agentId, options = {}) {
    const agent = await getAutomationAgent(userId, agentId);
    if (!agent)
        throw new Error("Automation agent not found.");
    const runId = await createAutomationRun(agent.id, "running", "Building long compilation");
    const settings = normalizeAutomationSettings(agent.settings || {});
    try {
        const scheduleAt = settings.publishMode === "schedule" ? await nextAvailableAutomationPublishAt(settings, await usableYouTubeAccount(userId, agent.youtubeAccountId), new Date(options.from || Date.now())) : null;
        const result = await createCompilationUpload(userId, {
            minMinutes: options.minMinutes ?? settings.compilationMinMinutes,
            maxMinutes: options.maxMinutes ?? settings.compilationMaxMinutes,
            maxClips: options.maxClips ?? settings.compilationMaxClips,
            title: options.title || settings.compilationTitle || "",
            description: options.description || settings.compilationDescription || "",
            privacyStatus: settings.publishMode === "unlisted" ? "unlisted" : "private",
            publishAt: scheduleAt ? scheduleAt.toISOString() : "",
            layout: settings.compilationLayout,
        }, agent);
        const uploadId = `upl_${crypto.randomUUID()}`;
        await runPsql(`
INSERT INTO automation_uploads (
  id, agent_id, user_id, youtube_account_id, youtube_video_id, youtube_url, source_url, source_video_id, source_author,
  movie_key, movie_title, movie_year, genre, micro_niche, title, description, schedule_at, status, metrics, created_at, updated_at
)
VALUES (
  ${sqlString(uploadId)}, ${sqlString(agent.id)}, ${sqlString(userId)}, ${sqlString(agent.youtubeAccountId)},
  ${sqlString(result.upload.id)}, ${sqlString(result.upload.url)}, ${sqlString(agent.sourceUrl)}, ${sqlString(`compilation-${Date.now()}`)}, ${sqlString(agent.sourceKey || "")},
  ${sqlString(`compilation-${agent.id}-${Date.now()}`)}, ${sqlString("")}, ${sqlString("")}, ${sqlString(settings.genreFocus || "Compilation")},
  ${sqlString(settings.microNicheGoal || "Long-form compilation")}, ${sqlString(result.upload.title)}, ${sqlString(options.description || settings.compilationDescription || "")},
  ${scheduleAt ? `${sqlString(scheduleAt.toISOString())}::timestamptz` : "NULL"}, ${sqlString(scheduleAt ? "scheduled" : "uploaded")},
  ${jsonbLiteral({ compilation: true, clips: result.clips, skipped: result.skipped, totalSeconds: result.totalSeconds, outputBytes: result.outputBytes, playlistItem: result.upload.playlistItem || null })}, now(), now()
);
UPDATE automation_agents
SET last_run_at = now(), next_run_at = ${sqlString(nextAutomationRunAt(settings).toISOString())}::timestamptz, updated_at = now()
WHERE id = ${sqlString(agent.id)};
`);
        await finishAutomationRun(runId, "success", `Created compilation ${result.upload.title}`, { uploadId, youtubeVideoId: result.upload.id, totalSeconds: result.totalSeconds, clips: result.clips.length, skipped: result.skipped.length });
        return { ...result, uploadId };
    }
    catch (error) {
        await finishAutomationRun(runId, "error", error instanceof Error ? error.message : "Compilation run failed", {});
        throw error;
    }
}
async function getYouTubeVideoAnalytics(account, videoId, days = 28) {
    const cleanVideoId = String(videoId || "").trim();
    if (!cleanVideoId)
        throw new Error("Video ID is required.");
    const safeDays = Math.min(Math.max(Number(days) || 28, 1), 365);
    const endDate = new Date();
    const startDate = new Date(Date.now() - (safeDays - 1) * 864e5);
    const videosUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
    videosUrl.searchParams.set("part", "snippet,statistics,contentDetails,status");
    videosUrl.searchParams.set("id", cleanVideoId);
    const videoData = await fetchJsonWithAuth(videosUrl, account.accessToken);
    const video = videoData.items?.[0] || null;
    const stats = video?.statistics || {};
    let totals = null;
    let daily = [];
    try {
        requireYouTubeScope(account, "https://www.googleapis.com/auth/yt-analytics.readonly", "YouTube Analytics");
        const metrics = "views,likes,comments,shares,estimatedMinutesWatched,averageViewDuration,subscribersGained";
        const totalUrl = new URL("https://youtubeanalytics.googleapis.com/v2/reports");
        totalUrl.searchParams.set("ids", "channel==MINE");
        totalUrl.searchParams.set("startDate", yyyyMmDd(startDate));
        totalUrl.searchParams.set("endDate", yyyyMmDd(endDate));
        totalUrl.searchParams.set("metrics", metrics);
        totalUrl.searchParams.set("filters", `video==${cleanVideoId}`);
        const totalData = await fetchGoogleWithAuth(totalUrl, account.accessToken);
        totals = analyticsRowsToObjects(totalData)[0] || null;
        const dailyUrl = new URL("https://youtubeanalytics.googleapis.com/v2/reports");
        dailyUrl.searchParams.set("ids", "channel==MINE");
        dailyUrl.searchParams.set("startDate", yyyyMmDd(startDate));
        dailyUrl.searchParams.set("endDate", yyyyMmDd(endDate));
        dailyUrl.searchParams.set("metrics", "views,likes,comments,estimatedMinutesWatched");
        dailyUrl.searchParams.set("dimensions", "day");
        dailyUrl.searchParams.set("sort", "day");
        dailyUrl.searchParams.set("filters", `video==${cleanVideoId}`);
        const dailyData = await fetchGoogleWithAuth(dailyUrl, account.accessToken);
        daily = analyticsRowsToObjects(dailyData);
    }
    catch (error) {
        totals = { warning: error instanceof Error ? error.message : "YouTube Analytics unavailable" };
    }
    return {
        id: cleanVideoId,
        url: `https://www.youtube.com/watch?v=${cleanVideoId}`,
        title: video?.snippet?.title || "YouTube video",
        thumbnailUrl: video?.snippet?.thumbnails?.maxres?.url || video?.snippet?.thumbnails?.standard?.url || video?.snippet?.thumbnails?.high?.url || video?.snippet?.thumbnails?.medium?.url || video?.snippet?.thumbnails?.default?.url || "",
        publishedAt: video?.snippet?.publishedAt || "",
        privacyStatus: video?.status?.privacyStatus || "",
        durationSeconds: isoDurationToSeconds(video?.contentDetails?.duration),
        publicStats: {
            viewCount: Number(stats.viewCount || 0),
            likeCount: Number(stats.likeCount || 0),
            commentCount: Number(stats.commentCount || 0),
        },
        analytics: {
            days: safeDays,
            startDate: yyyyMmDd(startDate),
            endDate: yyyyMmDd(endDate),
            totals,
            daily,
        },
    };
}
function normalizeYouTubeComment(comment) {
    const snippet = comment?.snippet || {};
    return {
        id: String(comment?.id || ""),
        authorDisplayName: String(snippet.authorDisplayName || ""),
        authorProfileImageUrl: String(snippet.authorProfileImageUrl || ""),
        authorChannelUrl: String(snippet.authorChannelUrl || ""),
        textDisplay: String(snippet.textDisplay || snippet.textOriginal || ""),
        textOriginal: String(snippet.textOriginal || snippet.textDisplay || ""),
        likeCount: Number(snippet.likeCount || 0),
        publishedAt: String(snippet.publishedAt || ""),
        updatedAt: String(snippet.updatedAt || ""),
    };
}
async function getYouTubeVideoComments(account, videoId, maxResults = 20, pageToken = "") {
    requireYouTubeScope(account, "https://www.googleapis.com/auth/youtube.force-ssl", "YouTube comments");
    const cleanVideoId = String(videoId || "").trim();
    if (!cleanVideoId)
        throw new Error("Video ID is required.");
    const url = new URL("https://www.googleapis.com/youtube/v3/commentThreads");
    url.searchParams.set("part", "snippet,replies");
    url.searchParams.set("videoId", cleanVideoId);
    url.searchParams.set("order", "time");
    url.searchParams.set("textFormat", "plainText");
    url.searchParams.set("maxResults", String(Math.min(Math.max(Number(maxResults) || 20, 1), 50)));
    if (pageToken)
        url.searchParams.set("pageToken", pageToken);
    const data = await fetchJsonWithAuth(url, account.accessToken);
    return {
        videoId: cleanVideoId,
        nextPageToken: String(data.nextPageToken || ""),
        comments: (data.items || []).map((thread) => {
            const top = thread.snippet?.topLevelComment || {};
            return {
                threadId: String(thread.id || ""),
                canReply: thread.snippet?.canReply !== false,
                totalReplyCount: Number(thread.snippet?.totalReplyCount || 0),
                topLevelComment: normalizeYouTubeComment(top),
                replies: (thread.replies?.comments || []).map(normalizeYouTubeComment),
            };
        }),
    };
}
async function replyToYouTubeComment(account, parentId, text) {
    requireYouTubeScope(account, "https://www.googleapis.com/auth/youtube.force-ssl", "YouTube comment reply");
    const cleanParentId = String(parentId || "").trim();
    const cleanText = String(text || "").trim();
    if (!cleanParentId)
        throw new Error("Parent comment ID is required.");
    if (!cleanText)
        throw new Error("Reply text is required.");
    const url = new URL("https://www.googleapis.com/youtube/v3/comments");
    url.searchParams.set("part", "snippet");
    const data = await fetchGoogleWithAuth(url, account.accessToken, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=UTF-8" },
        body: JSON.stringify({
            snippet: {
                parentId: cleanParentId,
                textOriginal: cleanText,
            },
        }),
    });
    return normalizeYouTubeComment(data);
}
function geminiClient() {
    const key = (process.env.GEMINI_API_KEY || "").trim();
    if (!key)
        throw new Error("GEMINI_API_KEY is not configured.");
    return new GoogleGenAI({ apiKey: key });
}
function parseModelJson(text, fallback = {}) {
    const raw = String(text || "").trim();
    if (!raw)
        return fallback;
    const candidates = [raw];
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1])
        candidates.push(fenced[1].trim());
    const firstObject = raw.indexOf("{");
    const lastObject = raw.lastIndexOf("}");
    if (firstObject !== -1 && lastObject > firstObject)
        candidates.push(raw.slice(firstObject, lastObject + 1));
    const firstArray = raw.indexOf("[");
    const lastArray = raw.lastIndexOf("]");
    if (firstArray !== -1 && lastArray > firstArray)
        candidates.push(raw.slice(firstArray, lastArray + 1));
    let lastError = null;
    for (const candidate of candidates) {
        try {
            return JSON.parse(candidate);
        }
        catch (error) {
            lastError = error;
        }
    }
    const message = lastError instanceof Error ? lastError.message : "Invalid JSON";
    throw new Error(`AI returned malformed JSON: ${message}`);
}
function extractTikTokVideoIdFromUrl(value) {
    const match = String(value || "").match(/\/video\/(\d+)/i);
    return match?.[1] || "";
}
function extractYouTubeVideoIdFromUrl(value) {
    const raw = String(value || "").trim();
    if (!raw)
        return "";
    try {
        const parsed = new URL(raw);
        const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
        if (host === "youtu.be")
            return parsed.pathname.split("/").filter(Boolean)[0] || "";
        if (/youtube\.com$/i.test(host)) {
            if (parsed.searchParams.get("v"))
                return parsed.searchParams.get("v") || "";
            const parts = parsed.pathname.split("/").filter(Boolean);
            const marker = parts.findIndex((part) => ["shorts", "embed", "live"].includes(part.toLowerCase()));
            if (marker >= 0)
                return parts[marker + 1] || "";
        }
    }
    catch {
        /* ignore */
    }
    return "";
}
function normalizeMovieCacheUrl(value) {
    const raw = String(value || "").trim();
    if (!/^https?:\/\//i.test(raw))
        return "";
    try {
        const parsed = new URL(raw);
        parsed.hash = "";
        parsed.hostname = parsed.hostname.replace(/^www\./i, "").toLowerCase();
        const youtubeId = extractYouTubeVideoIdFromUrl(parsed.toString());
        if (youtubeId)
            return `https://youtube.com/watch?v=${youtubeId}`;
        const tiktokId = extractTikTokVideoIdFromUrl(parsed.pathname);
        if (tiktokId) {
            const parts = parsed.pathname.split("/").filter(Boolean);
            const handle = parts.find((part) => part.startsWith("@")) || "";
            return `https://www.tiktok.com/${handle || "@unknown"}/video/${tiktokId}`;
        }
        for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "lang", "t", "is_from_webapp", "sender_device"]) {
            parsed.searchParams.delete(key);
        }
        parsed.pathname = parsed.pathname.replace(/\/+$/, "");
        return parsed.toString();
    }
    catch {
        return raw.split("#")[0];
    }
}
function movieCacheLookupFromUrl(value) {
    const normalizedUrl = normalizeMovieCacheUrl(value);
    return normalizeMovieCacheLookup({
        sourceType: /tiktok\.com/i.test(value) ? "tiktok" : (/youtu\.?be|youtube\.com/i.test(value) ? "youtube" : "url"),
        tiktokVideoId: extractTikTokVideoIdFromUrl(value),
        youtubeVideoId: extractYouTubeVideoIdFromUrl(value),
        normalizedUrl,
    });
}
function normalizeMovieCacheLookup(input = {}) {
    const normalizedUrl = normalizeMovieCacheUrl(input.normalizedUrl || input.url || input.sourceUrl || "");
    const tiktokVideoId = String(input.tiktokVideoId || extractTikTokVideoIdFromUrl(normalizedUrl)).trim();
    const youtubeVideoId = String(input.youtubeVideoId || extractYouTubeVideoIdFromUrl(normalizedUrl)).trim();
    const sourceType = String(input.sourceType || (tiktokVideoId ? "tiktok" : youtubeVideoId ? "youtube" : "")).trim();
    return {
        sourceType,
        tiktokVideoId,
        youtubeVideoId,
        normalizedUrl,
        fileHash: String(input.fileHash || "").trim(),
        detectedTitle: String(input.detectedTitle || input.title || "").trim(),
        detectedYear: String(input.detectedYear || input.year || "").match(/\d{4}/)?.[0] || "",
        tmdbId: String(input.tmdbId || "").trim(),
        tmdbMediaType: String(input.tmdbMediaType || "").trim(),
        malId: String(input.malId || "").trim(),
        malMediaType: String(input.malMediaType || "").trim(),
    };
}
function movieCacheIdsFromResult(result = {}) {
    return {
        tmdbId: result?.tmdb?.id ? String(result.tmdb.id) : "",
        tmdbMediaType: result?.tmdb?.mediaType ? String(result.tmdb.mediaType) : "",
        malId: result?.mal?.id ? String(result.mal.id) : "",
        malMediaType: result?.mal?.type ? String(result.mal.type) : "",
    };
}
function movieCacheExpirySql() {
    const days = Math.min(Math.max(Number(process.env.MOVIE_IDENTIFICATION_CACHE_DAYS) || 90, 1), 730);
    return `now() + interval '${days} days'`;
}
function movieCacheDeterministicId(lookup) {
    if (lookup.tiktokVideoId)
        return `moviecache_tiktok_${lookup.tiktokVideoId}`;
    if (lookup.youtubeVideoId)
        return `moviecache_youtube_${lookup.youtubeVideoId}`;
    if (lookup.normalizedUrl)
        return `moviecache_url_${crypto.createHash("sha1").update(lookup.normalizedUrl).digest("hex")}`;
    if (lookup.fileHash)
        return `moviecache_file_${lookup.fileHash.slice(0, 32)}`;
    const titleKey = [lookup.detectedTitle.toLowerCase(), lookup.detectedYear].filter(Boolean).join(":");
    return `moviecache_title_${crypto.createHash("sha1").update(titleKey || crypto.randomUUID()).digest("hex")}`;
}
async function getMovieIdentificationCacheRecord(input = {}, options = {}) {
    if (!postgresConfigured())
        return null;
    const lookup = normalizeMovieCacheLookup(input);
    const expiryClause = options.includeExpired ? "TRUE" : "(expires_at IS NULL OR expires_at > now())";
    const cases = [];
    const conditions = [];
    const add = (condition, rank) => {
        conditions.push(condition);
        cases.push(`WHEN ${condition} THEN ${rank}`);
    };
    if (lookup.tiktokVideoId)
        add(`tiktok_video_id = ${sqlString(lookup.tiktokVideoId)}`, 1);
    if (lookup.youtubeVideoId)
        add(`youtube_video_id = ${sqlString(lookup.youtubeVideoId)}`, 2);
    if (lookup.normalizedUrl)
        add(`normalized_url = ${sqlString(lookup.normalizedUrl)}`, 3);
    if (lookup.fileHash)
        add(`file_hash = ${sqlString(lookup.fileHash)}`, 4);
    if (lookup.tmdbId)
        add(`tmdb_id = ${sqlString(lookup.tmdbId)} AND (${sqlString(lookup.tmdbMediaType)} = '' OR tmdb_media_type = ${sqlString(lookup.tmdbMediaType)})`, 5);
    if (lookup.malId)
        add(`mal_id = ${sqlString(lookup.malId)} AND (${sqlString(lookup.malMediaType)} = '' OR mal_media_type = ${sqlString(lookup.malMediaType)})`, 6);
    if (lookup.detectedTitle) {
        const yearCondition = lookup.detectedYear ? ` AND detected_year = ${sqlString(lookup.detectedYear)}` : "";
        add(`lower(detected_title) = lower(${sqlString(lookup.detectedTitle)})${yearCondition}`, 7);
    }
    if (!conditions.length)
        return null;
    const out = await runPsql(`
SELECT COALESCE((
  SELECT json_build_object(
    'id', id,
    'sourceType', source_type,
    'tiktokVideoId', tiktok_video_id,
    'youtubeVideoId', youtube_video_id,
    'normalizedUrl', normalized_url,
    'fileHash', file_hash,
    'detectedTitle', detected_title,
    'detectedYear', detected_year,
    'tmdbId', tmdb_id,
    'tmdbMediaType', tmdb_media_type,
    'malId', mal_id,
    'malMediaType', mal_media_type,
    'confidence', confidence,
    'result', result,
    'expiresAt', FLOOR(EXTRACT(EPOCH FROM expires_at) * 1000)::bigint,
    'updatedAt', FLOOR(EXTRACT(EPOCH FROM updated_at) * 1000)::bigint
  )
  FROM movie_identification_cache
  WHERE ${expiryClause}
    AND (${conditions.join(" OR ")})
  ORDER BY CASE ${cases.join(" ")} ELSE 99 END, updated_at DESC
  LIMIT 1
), 'null'::json);
`);
    return JSON.parse(out || "null");
}
async function getCachedMovieIdentification(input = {}) {
    const record = await getMovieIdentificationCacheRecord(input);
    return record?.result && typeof record.result === "object" ? record.result : null;
}
async function storeMovieIdentificationCache(input = {}, result = {}) {
    if (!postgresConfigured() || !result || typeof result !== "object")
        return null;
    const resultIds = movieCacheIdsFromResult(result);
    const lookup = normalizeMovieCacheLookup({
        ...input,
        detectedTitle: input.detectedTitle || result.title || "",
        detectedYear: input.detectedYear || result.year || "",
        ...resultIds,
    });
    const existing = await getMovieIdentificationCacheRecord(lookup, { includeExpired: true }).catch(() => null);
    const id = existing?.id || movieCacheDeterministicId(lookup);
    await runPsql(`
INSERT INTO movie_identification_cache (
  id, source_type, tiktok_video_id, youtube_video_id, normalized_url, file_hash,
  detected_title, detected_year, tmdb_id, tmdb_media_type, mal_id, mal_media_type,
  confidence, result, expires_at, created_at, updated_at
)
VALUES (
  ${sqlString(id)}, ${sqlString(lookup.sourceType)}, ${sqlString(lookup.tiktokVideoId)}, ${sqlString(lookup.youtubeVideoId)},
  ${sqlString(lookup.normalizedUrl)}, ${sqlString(lookup.fileHash)}, ${sqlString(lookup.detectedTitle)}, ${sqlString(lookup.detectedYear)},
  ${sqlString(lookup.tmdbId)}, ${sqlString(lookup.tmdbMediaType)}, ${sqlString(lookup.malId)}, ${sqlString(lookup.malMediaType)},
  ${sqlNumber(result.confidence)}, ${jsonbLiteral(result)}, ${movieCacheExpirySql()}, now(), now()
)
ON CONFLICT (id) DO UPDATE SET
  source_type = COALESCE(NULLIF(EXCLUDED.source_type, ''), movie_identification_cache.source_type),
  tiktok_video_id = COALESCE(NULLIF(EXCLUDED.tiktok_video_id, ''), movie_identification_cache.tiktok_video_id),
  youtube_video_id = COALESCE(NULLIF(EXCLUDED.youtube_video_id, ''), movie_identification_cache.youtube_video_id),
  normalized_url = COALESCE(NULLIF(EXCLUDED.normalized_url, ''), movie_identification_cache.normalized_url),
  file_hash = COALESCE(NULLIF(EXCLUDED.file_hash, ''), movie_identification_cache.file_hash),
  detected_title = COALESCE(NULLIF(EXCLUDED.detected_title, ''), movie_identification_cache.detected_title),
  detected_year = COALESCE(NULLIF(EXCLUDED.detected_year, ''), movie_identification_cache.detected_year),
  tmdb_id = COALESCE(NULLIF(EXCLUDED.tmdb_id, ''), movie_identification_cache.tmdb_id),
  tmdb_media_type = COALESCE(NULLIF(EXCLUDED.tmdb_media_type, ''), movie_identification_cache.tmdb_media_type),
  mal_id = COALESCE(NULLIF(EXCLUDED.mal_id, ''), movie_identification_cache.mal_id),
  mal_media_type = COALESCE(NULLIF(EXCLUDED.mal_media_type, ''), movie_identification_cache.mal_media_type),
  confidence = EXCLUDED.confidence,
  result = EXCLUDED.result,
  expires_at = EXCLUDED.expires_at,
  updated_at = now();
`);
    return id;
}
async function identifyMovieFromVideoFile(filePath, mimeType = "video/mp4", cacheLookup = {}) {
    const fileBuffer = fs.readFileSync(filePath);
    const fileHash = crypto.createHash("sha256").update(fileBuffer).digest("hex");
    const lookup = normalizeMovieCacheLookup({ ...cacheLookup, fileHash });
    const cached = await getCachedMovieIdentification(lookup).catch(() => null);
    if (cached)
        return cached;
    const result = await identifyMovieFromVideoBuffer(fileBuffer, mimeType);
    await storeMovieIdentificationCache(lookup, result).catch((error) => {
        console.warn("Movie ID cache write skipped:", error instanceof Error ? error.message : error);
    });
    return result;
}
async function identifyMovieFromVideoBuffer(fileBuffer, mimeType = "video/mp4") {
    const ai = geminiClient();
    const base64 = fileBuffer.toString("base64");
    const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
            {
                parts: [
                    {
                        text: `Identify the source title in this video clip. It may be a movie, TV series, anime, manga, manhwa, manhua, webtoon, donghua, or light novel adaptation. Return only JSON. Include the exact title, 4-digit year when visible or searchable, mediaType, genre, summary, and evidence. If it is manga or manhwa pages under narration, identify the manga/manhwa/webtoon title instead of calling it a slideshow. If uncertain, keep confidence below 0.7.`,
                    },
                    {
                        inlineData: {
                            mimeType,
                            data: base64,
                        },
                    },
                ],
            },
        ],
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    title: { type: Type.STRING },
                    year: { type: Type.STRING },
                    mediaType: { type: Type.STRING },
                    genre: { type: Type.STRING },
                    confidence: { type: Type.NUMBER },
                    summary: { type: Type.STRING },
                    evidence: {
                        type: Type.OBJECT,
                        properties: {
                            audio: { type: Type.STRING },
                            visual: { type: Type.STRING },
                            reasoning: { type: Type.STRING },
                        },
                    },
                },
                required: ["title", "confidence", "summary"],
            },
            tools: [{ googleSearch: {} }],
        },
    });
    const result = parseModelJson(response.text, {});
    return enrichServerMovieResult(result);
}
async function enrichServerMovieResult(result) {
    const title = String(result.title || "").trim();
    if (!title)
        return result;
    const shouldTryMalFirst = looksLikeAnimeOrManga(result);
    if (shouldTryMalFirst) {
        const malResult = await enrichServerMalResult(result);
        if (malResult?.mal)
            return malResult;
    }
    try {
        const year = String(result.year || "").match(/\d{4}/)?.[0] || "";
        const data = await fetchTmdbJson("search/multi", { query: title, include_adult: "false" });
        const match = chooseTmdbTitle(data.results || [], title, year);
        if (!match)
            return await enrichServerMalResult(result);
        const mediaType = match.media_type || "movie";
        const details = await fetchTmdbJson(`${mediaType}/${match.id}`, { append_to_response: "credits,external_ids" });
        return {
            ...result,
            title: details.title || details.name || match.title || match.name || title,
            year: (details.release_date || details.first_air_date || "").slice(0, 4) || year,
            director: mediaType === "movie"
                ? details.credits?.crew?.find((person) => person.job === "Director")?.name || result.director || ""
                : details.created_by?.map((person) => person.name).filter(Boolean).join(", ") || result.director || "",
            posterUrl: tmdbImage(details.poster_path || match.poster_path, "w500"),
            imdbUrl: details.external_ids?.imdb_id ? `https://www.imdb.com/title/${details.external_ids.imdb_id}/` : result.imdbUrl,
            genre: details.genres?.[0]?.name || result.genre || "",
            tmdb: {
                id: details.id || match.id,
                mediaType,
                title: details.title || details.name || title,
                originalTitle: details.original_title || details.original_name || "",
                overview: details.overview || "",
                tagline: details.tagline || "",
                genres: (details.genres || []).map((genre) => genre.name).filter(Boolean),
                releaseDate: details.release_date || details.first_air_date || "",
                runtime: details.runtime || details.episode_run_time?.[0] || null,
                rating: typeof details.vote_average === "number" ? details.vote_average : null,
                voteCount: details.vote_count || 0,
                status: details.status || "",
                language: details.original_language || "",
                tmdbUrl: `https://www.themoviedb.org/${mediaType}/${match.id}`,
                backdropUrl: tmdbImage(details.backdrop_path, "w1280"),
                director: mediaType === "movie"
                    ? details.credits?.crew?.find((person) => person.job === "Director")?.name || ""
                    : details.created_by?.map((person) => person.name).filter(Boolean).join(", ") || "",
                cast: (details.credits?.cast || []).slice(0, 8).map((person) => ({
                    name: person.name || "",
                    character: person.character || "",
                    profileUrl: tmdbImage(person.profile_path, "w185"),
                })).filter((person) => person.name),
            },
        };
    }
    catch {
        return await enrichServerMalResult(result);
    }
}
async function getChannelStyleSamples(account) {
    const dashboard = await getConnectedYouTubeDashboard(account);
    const ids = (dashboard.recentVideos || []).slice(0, 25).map((video) => video.id).filter(Boolean);
    if (!ids.length)
        return [];
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "snippet,statistics");
    url.searchParams.set("id", ids.join(","));
    const data = await fetchJsonWithAuth(url, account.accessToken);
    return (data.items || [])
        .map((video) => ({
        title: String(video.snippet?.title || ""),
        description: String(video.snippet?.description || "").slice(0, 1200),
        views: Number(video.statistics?.viewCount || 0),
        likes: Number(video.statistics?.likeCount || 0),
        comments: Number(video.statistics?.commentCount || 0),
    }))
        .sort((a, b) => b.views - a.views)
        .slice(0, 10);
}
async function generateAutomationMetadata({ movie, sourceVideo, agent, styleSamples }) {
    const ai = geminiClient();
    const settings = normalizeAutomationSettings(agent.settings || {});
    const sourceContext = movie || {
        title: sourceVideo.title || "TikTok clip",
        summary: sourceVideo.title || "",
        genre: settings.genreFocus || "",
    };
    const contentMode = settings.movieIdEnabled ? "movie recap/clip" : "TikTok-sourced niche clip";
    const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
            {
                role: "user",
                parts: [
                    {
                        text: `Create YouTube metadata for a scheduled ${contentMode} upload.

Detected source context:
${JSON.stringify(sourceContext)}

Source TikTok:
${JSON.stringify({ title: sourceVideo.title, author: sourceVideo.author, stats: sourceVideo.stats })}

Channel's strongest recent title/description patterns:
${JSON.stringify(styleSamples)}

Micro-sub-niche goal:
${settings.microNicheGoal || "Find a focused repeatable niche corner with strong demand."}

Rules:
- Title must feel native to the channel's top titles, not generic.
- Avoid claiming ownership or using spammy title stuffing.
- Description should include a concise hook, context, and discovery keywords.
- Return JSON with title, description, tags, microNiche, genre.
- Keep title under 95 characters, description under 4500 characters, tags under 15.`,
                    },
                ],
            },
        ],
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    title: { type: Type.STRING },
                    description: { type: Type.STRING },
                    tags: { type: Type.ARRAY, items: { type: Type.STRING } },
                    microNiche: { type: Type.STRING },
                    genre: { type: Type.STRING },
                },
                required: ["title", "description", "tags", "microNiche"],
            },
        },
    });
    const data = parseModelJson(response.text, {});
    return {
        title: String(data.title || `${sourceContext.title} explained`).slice(0, 95),
        description: String(data.description || sourceContext.summary || "").slice(0, 4500),
        tags: Array.isArray(data.tags) ? data.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 15) : [],
        microNiche: String(data.microNiche || settings.microNicheGoal || "").slice(0, 180),
        genre: String(data.genre || sourceContext.genre || settings.genreFocus || "").slice(0, 120),
    };
}
function movieKeyFromResult(movie) {
    const title = String(movie?.title || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const year = String(movie?.year || "").match(/\d{4}/)?.[0] || "";
    const tmdb = movie?.tmdb?.id ? `tmdb-${movie.tmdb.id}` : "";
    return tmdb || [title, year].filter(Boolean).join("-");
}
function safeVideoFileName(movie) {
    const title = String(movie?.title || "autoyt-clip").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80);
    const year = String(movie?.year || "").match(/\d{4}/)?.[0] || "";
    return `${title || "autoyt-clip"}${year ? `-${year}` : ""}.mp4`;
}
async function loadAgentSourceVideos(agent) {
    const settings = normalizeAutomationSettings(agent.settings || {});
    const sources = [];
    if (agent.sourceKey) {
        const record = await getSavedPlaylistRecordByKey(agent.userId, agent.sourceKey);
        if (record?.playlist?.videos?.length)
            sources.push(...record.playlist.videos);
    }
    if (!sources.length && agent.sourceUrl) {
        const playlist = await runTikTokListScript(agent.sourceUrl, settings.searchDepth, "");
        sources.push(...(playlist.videos || []));
    }
    if (settings.includeSideChannels) {
        for (const url of settings.sideChannels) {
            try {
                const playlist = await runTikTokListScript(url, Math.min(settings.searchDepth, 100), "");
                sources.push(...(playlist.videos || []));
            }
            catch {
                /* side channels should not block the primary source */
            }
        }
    }
    const seen = new Set();
    return sortTikTokVideosForAutomation(sources.filter((video) => {
        const key = String(video.id || video.playUrl || "");
        if (!key || seen.has(key))
            return false;
        seen.add(key);
        return true;
    }), settings.sourcePriority);
}
function automationTikTokViewCount(video) {
    return Number(video?.stats?.playCount || video?.stats?.viewCount || video?.playCount || video?.viewCount || 0) || 0;
}
function automationTikTokCreatedAt(video) {
    const raw = video?.createdAt ?? video?.createTime ?? video?.timestamp ?? video?.uploadDate ?? video?.publishedAt ?? "";
    if (typeof raw === "number")
        return raw > 100000000000 ? raw : raw * 1000;
    const value = String(raw || "").trim();
    if (!value)
        return 0;
    if (/^\d{8}$/.test(value)) {
        const parsed = Date.parse(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00Z`);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    if (/^\d+$/.test(value)) {
        const n = Number(value);
        return Number.isFinite(n) ? (n > 100000000000 ? n : n * 1000) : 0;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
}
function sortTikTokVideosForAutomation(videos = [], mode = "views") {
    return [...videos].sort((a, b) => {
        if (mode === "oldest") {
            const created = automationTikTokCreatedAt(a) - automationTikTokCreatedAt(b);
            if (created !== 0)
                return created;
            return automationTikTokViewCount(b) - automationTikTokViewCount(a);
        }
        const views = automationTikTokViewCount(b) - automationTikTokViewCount(a);
        if (views !== 0)
            return views;
        return automationTikTokCreatedAt(b) - automationTikTokCreatedAt(a);
    });
}
async function sourceAlreadyUploaded(agentId, video) {
    const sourceKey = automationSourceKey(video);
    if (!sourceKey)
        return false;
    const id = String(video.id || "").trim();
    const url = normalizeMovieCacheUrl(video.playUrl || video.sourceUrl || video.url || "");
    const out = await runPsql(`
SELECT COUNT(*)
FROM automation_uploads
WHERE agent_id = ${sqlString(agentId)}
  AND (
    (${id ? `source_video_id = ${sqlString(id)}` : "false"})
    OR (${url ? `source_url = ${sqlString(url)} OR source_url = ${sqlString(video.playUrl || video.sourceUrl || video.url || "")}` : "false"})
    OR metrics->>'sourceKey' = ${sqlString(sourceKey)}
  );
`);
    return Number(out || 0) > 0;
}
function automationSourceKey(video) {
    const id = String(video?.id || "").trim();
    if (id)
        return `tiktok:${id}`;
    const url = normalizeMovieCacheUrl(video?.playUrl || video?.sourceUrl || video?.url || "");
    if (url)
        return `url:${crypto.createHash("sha1").update(url).digest("hex")}`;
    const title = String(video?.title || "").trim();
    const author = String(video?.authorHandle || video?.author || "").trim();
    if (title || author)
        return `meta:${crypto.createHash("sha1").update(`${author}\n${title}`).digest("hex")}`;
    return "";
}
async function claimAutomationSource(agentId, video, runId) {
    const sourceKey = automationSourceKey(video);
    if (!sourceKey)
        return "";
    await runPsql(`DELETE FROM automation_source_claims WHERE claimed_at < now() - interval '24 hours';`).catch(() => null);
    const out = await runPsql(`
WITH inserted AS (
  INSERT INTO automation_source_claims (agent_id, source_key, run_id, claimed_at)
  VALUES (${sqlString(agentId)}, ${sqlString(sourceKey)}, ${sqlString(runId)}, now())
  ON CONFLICT DO NOTHING
  RETURNING source_key
)
SELECT COALESCE((SELECT source_key FROM inserted), '');
`);
    return String(out || "").trim();
}
async function releaseAutomationSourceClaim(agentId, sourceKey) {
    if (!sourceKey)
        return;
    await runPsql(`DELETE FROM automation_source_claims WHERE agent_id = ${sqlString(agentId)} AND source_key = ${sqlString(sourceKey)};`).catch(() => null);
}
async function movieAlreadyUploaded(accountId, movieKey) {
    if (!movieKey)
        return false;
    const out = await runPsql(`SELECT COUNT(*) FROM automation_uploads WHERE youtube_account_id = ${sqlString(accountId)} AND movie_key = ${sqlString(movieKey)};`);
    return Number(out || 0) > 0;
}
async function createAutomationRun(agentId, status = "running", message = "") {
    const id = `run_${crypto.randomUUID()}`;
    await runPsql(`
INSERT INTO automation_runs (id, agent_id, status, message, started_at)
VALUES (${sqlString(id)}, ${sqlString(agentId)}, ${sqlString(status)}, ${sqlString(message)}, now());
`);
    return id;
}
async function finishAutomationRun(runId, status, message, details = {}) {
    await runPsql(`
UPDATE automation_runs
SET status = ${sqlString(status)}, message = ${sqlString(message)}, details = ${jsonbLiteral(details)}, finished_at = now()
WHERE id = ${sqlString(runId)};
`);
}
function isSkippableAutomationDownloadError(error) {
    const message = error instanceof Error ? error.message : String(error || "");
    return /No clean \d+p TikTok source|expected at least \d+p|No direct clean playback URL candidates|TikWM returned \d+x\d+|yt-dlp returned \d+x\d+|no confirmed audio track|Audio probe/i.test(message);
}
async function runTikTokDownloadWithAudioRetry(video, outputPath, options = {}) {
    const sourceUrl = String(video?.playUrl || video?.sourceUrl || "").trim();
    if (!sourceUrl)
        throw new Error("TikTok source URL is missing.");
    const candidateUrls = Array.isArray(video?.cleanPlaybackUrls) ? video.cleanPlaybackUrls : [];
    const defaultAttempts = [
        { label: "preferred clean download", candidateUrls, options: {} },
        { label: "redownload without direct playback", candidateUrls: [], options: { skipDirect: true } },
        { label: "redownload with yt-dlp audio merge", candidateUrls: [], options: { skipDirect: true, skipTikwm: true } },
    ];
    const attempts = options.preferYtDlp === true
        ? [
            { label: "yt-dlp audio merge", candidateUrls: [], options: { skipDirect: true, skipTikwm: true } },
            ...defaultAttempts,
        ]
        : defaultAttempts;
    const errors = [];
    for (const attempt of attempts) {
        try {
            if (fs.existsSync(outputPath))
                fs.unlinkSync(outputPath);
            const downloader = await runTikTokDownload(sourceUrl, outputPath, attempt.candidateUrls, attempt.options);
            await assertVideoHasAudio(outputPath, "Downloaded TikTok video");
            return downloader;
        }
        catch (error) {
            errors.push(`${attempt.label}: ${error instanceof Error ? error.message : String(error)}`);
            try {
                if (fs.existsSync(outputPath))
                    fs.unlinkSync(outputPath);
            }
            catch {
                /* ignore */
            }
        }
    }
    throw new Error(`Could not redownload this TikTok with confirmed audio. ${errors.join(" | ")}`);
}
async function runAutomationAgentOnce(userId, agentId, options = {}) {
    const agent = await getAutomationAgent(userId, agentId);
    if (!agent)
        throw new Error("Automation agent not found.");
    const runId = await createAutomationRun(agent.id, "running", "Scanning source videos");
    const settings = normalizeAutomationSettings(agent.settings || {});
    let tempFile = "";
    let selectedSourceClaim = "";
    let pendingUploadId = "";
    try {
        const account = await usableYouTubeAccount(userId, agent.youtubeAccountId);
        const styleSamples = await getChannelStyleSamples(account);
        const videos = await loadAgentSourceVideos(agent);
        if (!videos.length)
            throw new Error("No TikTok source videos found.");
        let selected = null;
        let movie = null;
        let movieKey = "";
        let sourceIdentity = null;
        let analysisAttempts = 0;
        const downloadSkips = [];
        for (const video of videos) {
            if (await sourceAlreadyUploaded(agent.id, video))
                continue;
            if (analysisAttempts + downloadSkips.length >= Math.max(12, Math.min(settings.searchDepth || 50, 80)))
                break;
            const sourceClaim = await claimAutomationSource(agent.id, video, runId);
            if (!sourceClaim)
                continue;
            tempFile = makeTikTokVideoCachePath();
            try {
                await runTikTokDownloadWithAudioRetry(video, tempFile);
            }
            catch (error) {
                try {
                    if (tempFile && fs.existsSync(tempFile))
                        fs.unlinkSync(tempFile);
                }
                catch {
                    /* ignore */
                }
                tempFile = "";
                if (isSkippableAutomationDownloadError(error)) {
                    downloadSkips.push({
                        id: video.id || "",
                        url: video.playUrl || "",
                        views: automationTikTokViewCount(video),
                        reason: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
                    });
                    await releaseAutomationSourceClaim(agent.id, sourceClaim);
                    continue;
                }
                await releaseAutomationSourceClaim(agent.id, sourceClaim);
                throw error;
            }
            analysisAttempts += 1;
            if (settings.movieIdEnabled) {
                movie = await identifyMovieFromVideoFile(tempFile, "video/mp4", {
                    sourceType: "tiktok",
                    tiktokVideoId: video.id || "",
                    normalizedUrl: video.playUrl || video.sourceUrl || video.url || "",
                });
                movieKey = movieKeyFromResult(movie);
            }
            else {
                sourceIdentity = {
                    title: String(video.title || "TikTok clip").trim() || "TikTok clip",
                    summary: String(video.title || "").trim(),
                    genre: settings.genreFocus || "",
                    confidence: 0,
                    year: "",
                };
                movie = sourceIdentity;
                movieKey = `source-${String(video.id || crypto.createHash("sha1").update(String(video.playUrl || video.title || Date.now())).digest("hex")).slice(0, 48)}`;
            }
            if (settings.movieIdEnabled && settings.avoidMovieRepeats && (await movieAlreadyUploaded(agent.youtubeAccountId, movieKey))) {
                try {
                    fs.unlinkSync(tempFile);
                }
                catch {
                    /* ignore */
                }
                tempFile = "";
                await releaseAutomationSourceClaim(agent.id, sourceClaim);
                continue;
            }
            selected = video;
            selectedSourceClaim = sourceClaim;
            break;
        }
        if (!selected || !movie || !tempFile)
            throw new Error(downloadSkips.length ? `No fresh publishable candidate found. Skipped ${downloadSkips.length} videos for quality or missing audio.` : "No fresh candidate passed duplicate checks.");
        const metadata = await generateAutomationMetadata({ movie, sourceVideo: selected, agent, styleSamples });
        const targetPlaylistId = await resolveAutomationTargetPlaylist(account, settings, metadata, movie).catch((error) => {
            console.warn("Could not resolve automation target playlist:", error instanceof Error ? error.message : error);
            return "";
        });
        const scheduleAt = settings.publishMode === "schedule" ? await nextAvailableAutomationPublishAt(settings, account, new Date(options.from || Date.now())) : null;
        const nextPublishAt = settings.publishMode === "schedule" && scheduleAt
            ? await nextAvailableAutomationPublishAt(settings, account, new Date(scheduleAt.getTime() + 60_000))
            : null;
        const nextRunAt = nextPublishAt ? automationRunAtForPublish(settings, nextPublishAt) : nextAutomationRunAt(settings);
        const uploadId = `upl_${crypto.randomUUID()}`;
        pendingUploadId = uploadId;
        const pendingMetrics = {
            movieIdEnabled: settings.movieIdEnabled,
            movie,
            sourceIdentity,
            sourceStats: selected.stats || {},
            sourceKey: selectedSourceClaim,
            fileName: safeVideoFileName(movie),
            targetPlaylistId,
            uploadState: "uploading",
        };
        await runPsql(`
INSERT INTO automation_uploads (
  id, agent_id, user_id, youtube_account_id, youtube_video_id, youtube_url, source_url, source_video_id, source_author,
  movie_key, movie_title, movie_year, genre, micro_niche, title, description, schedule_at, status, metrics, created_at, updated_at
)
VALUES (
  ${sqlString(uploadId)}, ${sqlString(agent.id)}, ${sqlString(userId)}, ${sqlString(agent.youtubeAccountId)},
  '', '', ${sqlString(selected.playUrl)}, ${sqlString(selected.id)}, ${sqlString(selected.authorHandle || selected.author || "")},
  ${sqlString(movieKey)}, ${sqlString(settings.movieIdEnabled ? movie.title || "" : "")}, ${sqlString(settings.movieIdEnabled ? movie.year || "" : "")}, ${sqlString(metadata.genre || movie.genre || "")},
  ${sqlString(metadata.microNiche)}, ${sqlString(metadata.title)}, ${sqlString(metadata.description)}, ${scheduleAt ? `${sqlString(scheduleAt.toISOString())}::timestamptz` : "NULL"},
  'uploading', ${jsonbLiteral(pendingMetrics)}, now(), now()
);
`);
        const videoBuffer = fs.readFileSync(tempFile);
        const upload = await uploadYouTubeVideo(account, {
            title: metadata.title,
            description: metadata.description,
            tags: metadata.tags,
            privacyStatus: settings.publishMode === "unlisted" ? "unlisted" : "private",
            publishAt: scheduleAt ? scheduleAt.toISOString() : "",
            categoryId: settings.categoryId,
            madeForKids: settings.madeForKids,
        }, videoBuffer, "video/mp4");
        if (targetPlaylistId) {
            await addVideoToYouTubePlaylist(account, targetPlaylistId, upload.id).catch((error) => {
                console.warn("Could not add automation upload to playlist:", error instanceof Error ? error.message : error);
            });
        }
        await runPsql(`
UPDATE automation_uploads
SET youtube_video_id = ${sqlString(upload.id)},
    youtube_url = ${sqlString(upload.url)},
    status = ${sqlString(scheduleAt ? "scheduled" : "uploaded")},
    metrics = ${jsonbLiteral({ ...pendingMetrics, uploadState: "complete" })},
    updated_at = now()
WHERE id = ${sqlString(uploadId)};
UPDATE automation_agents
SET last_run_at = now(), next_run_at = ${sqlString(nextRunAt.toISOString())}::timestamptz, updated_at = now()
WHERE id = ${sqlString(agent.id)};
`);
        await captureAutomationPerformance(uploadId, account, upload.id).catch(() => null);
        await finishAutomationRun(runId, "success", `${scheduleAt ? "Scheduled" : "Uploaded"} ${metadata.title}`, { uploadId, youtubeVideoId: upload.id, movieTitle: settings.movieIdEnabled ? movie.title : "", sourceUrl: selected.playUrl, scheduleAt, nextRunAt, targetPlaylistId, skippedLowQuality: downloadSkips });
        return { uploadId, youtubeVideoId: upload.id, youtubeUrl: upload.url, movie, metadata, scheduleAt, nextRunAt };
    }
    catch (error) {
        if (pendingUploadId) {
            await runPsql(`
UPDATE automation_uploads
SET status = 'upload_failed',
    metrics = metrics || ${jsonbLiteral({ uploadState: "failed", error: error instanceof Error ? error.message : String(error || "Automation upload failed") })},
    updated_at = now()
WHERE id = ${sqlString(pendingUploadId)} AND youtube_video_id = '';
`).catch(() => null);
        }
        if (selectedSourceClaim)
            await releaseAutomationSourceClaim(agent.id, selectedSourceClaim);
        await finishAutomationRun(runId, "error", error instanceof Error ? error.message : "Automation run failed", {});
        throw error;
    }
    finally {
        if (tempFile) {
            try {
                fs.unlinkSync(tempFile);
            }
            catch {
                /* cache cleanup will catch it */
            }
        }
    }
}
async function captureAutomationPerformance(uploadId, account, videoId) {
    const analytics = await getYouTubeVideoAnalytics(account, videoId, 1);
    const id = `snap_${crypto.randomUUID()}`;
    await runPsql(`
INSERT INTO automation_performance_snapshots (id, upload_id, youtube_video_id, views, likes, comments, captured_at)
VALUES (
  ${sqlString(id)}, ${sqlString(uploadId)}, ${sqlString(videoId)},
  ${sqlNumber(analytics.publicStats.viewCount)}, ${sqlNumber(analytics.publicStats.likeCount)}, ${sqlNumber(analytics.publicStats.commentCount)}, now()
);
UPDATE automation_uploads
SET metrics = metrics || ${jsonbLiteral({ publicStats: analytics.publicStats, analytics: analytics.analytics })}, updated_at = now()
WHERE id = ${sqlString(uploadId)};
`);
    await autoManageYouTubeComments(uploadId, account, videoId).catch((error) => {
        console.warn("Automation comment management failed:", error instanceof Error ? error.message : error);
    });
}
function asksForMovieName(text) {
    const normalized = String(text || "").toLowerCase();
    const wordsOnly = normalized
        .replace(/[^\p{L}\p{N}?]+/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
    return /\b(anime|movie|film|show|series)\s+(name|title)\s*(please|pls|plz)?\s*\?*\s*$/i.test(normalized)
        || /\b(anime|movie|film|show|series)\s*(please|pls|plz)?\s*\?+\s*$/i.test(normalized)
        || /\b(anime|movie|film|show|series)\s+(please|pls|plz)\s*$/i.test(normalized)
        || /\b(name|title|sauce|source)\s*(please|pls|plz)?\s*\?*\s*$/i.test(normalized)
        || /\b(name|title|sauce|source)\s+(please|pls|plz)\b/i.test(wordsOnly)
        || /\b(please|pls|plz)\s+(name|title|sauce|source)\b/i.test(wordsOnly)
        || /\b(anime|movie|film|show|series)\s+(name|title|please|pls|plz)\b/i.test(wordsOnly)
        || /\b(what|which|whats|what's|wht|wat)\b.{0,40}\b(anime|movie|film|show|series|title|name|sauce|source)\b/i.test(normalized)
        || /\b(anime|movie|film|show|series)\b.{0,30}\b(name|title|please|pls|plz)\b/i.test(normalized);
}
function shouldSkipCommunityComment(text) {
    const normalized = String(text || "").toLowerCase().trim();
    if (!normalized)
        return true;
    if (normalized.length < 2)
        return true;
    if (/(^|\s)(http|www\.|telegram|whatsapp|crypto|forex|investment|giveaway|subscribe to my|check my channel)(\s|$)/i.test(normalized))
        return true;
    if (/^\W+$/.test(normalized))
        return true;
    const compact = normalized
        .replace(/https?:\/\/\S+|www\.\S+/gi, " ")
        .replace(/[\u200d\ufe0f]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    const meaningfulTokens = compact.match(/[\p{L}\p{N}]{2,}/gu) || [];
    const lettersAndNumbers = compact.match(/[\p{L}\p{N}]/gu) || [];
    if (lettersAndNumbers.length < 4)
        return true;
    if (meaningfulTokens.length < 2)
        return true;
    const weakTokens = new Set(["lol", "lmao", "haha", "wow", "bro", "ok", "yes", "no", "nice", "cool", "fire", "first"]);
    if (meaningfulTokens.length <= 2 && meaningfulTokens.every((token) => weakTokens.has(token)))
        return true;
    return false;
}
function sanitizeGeneratedReply(text) {
    return String(text || "")
        .replace(/[��]/g, ", ")
        .replace(/\s*,\s*,\s*/g, ", ")
        .replace(/\s+([,.!?])/g, "$1")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 220);
}
function replyLooksLikeQuestion(text) {
    const clean = String(text || "").trim();
    if (!clean)
        return false;
    if (/\?\s*$/.test(clean))
        return true;
    return /^(what|why|how|who|which|when|where|did|do|does|is|are|was|were|can|could|would|should|tell me|have you|anyone)\b/i.test(clean);
}
async function generateCommunityReply({ commentText, upload, settings, movieTitle, movieYear }) {
    const ai = geminiClient();
    const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
            {
                role: "user",
                parts: [
                    {
                        text: `Write one YouTube creator reply that gives a useful or insightful response without asking a question.

Video:
${JSON.stringify({ title: upload.title, movieTitle, movieYear, microNiche: upload.microNiche, genre: upload.genre })}

Viewer comment:
${commentText}

Agent tone:
${settings.commentReplyTone || "warm-curious"}

Extra channel instructions:
${settings.commentReplyInstructions || "Be friendly, brief, useful, and insightful. Do not ask questions."}

Rules:
- Return JSON only.
- If the comment is spam, abusive, asks for illegal uploads, has no clear context, is only emojis, is only one letter, or does not need a reply, set shouldReply false.
- Do not mention that you are AI.
- Do not invent facts about the movie or the viewer.
- Do not ask people to like/subscribe.
- Do not ask questions or end with a question mark.
- Prefer statements: useful context, a sharp observation, a playful reaction, a confident opinion, or a concise insight.
- Do not use long dash punctuation.
- Keep reply under 180 characters.
- One sentence is preferred.`,
                    },
                ],
            },
        ],
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    shouldReply: { type: Type.BOOLEAN },
                    reply: { type: Type.STRING },
                    reason: { type: Type.STRING },
                },
                required: ["shouldReply", "reply"],
            },
        },
    });
    const data = parseModelJson(response.text, {});
    const reply = sanitizeGeneratedReply(data.reply);
    if (replyLooksLikeQuestion(reply))
        return { shouldReply: false, reply: "", reason: "Question-style reply skipped" };
    return { shouldReply: data.shouldReply === true && reply.length > 0, reply, reason: String(data.reason || "") };
}
async function generateChannelCommentReply({ commentText, video, movie, tone, instructions }) {
    const ai = geminiClient();
    const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
            {
                role: "user",
                parts: [
                    {
                        text: `Write one YouTube creator reply for channel community management without asking a question.

Video:
${JSON.stringify({ title: video.title, views: video.viewCount, comments: video.commentCount, publishedAt: video.publishedAt })}

Movie ID context:
${JSON.stringify(movie?.title ? { title: movie.title, year: movie.year, genre: movie.genre, confidence: movie.confidence } : { title: "", note: "Movie ID context unavailable or not confident." })}

Viewer comment:
${commentText}

Tone:
${tone || "warm-curious"}

Channel instructions:
${instructions || "Reply briefly like the channel owner. Be friendly, natural, useful, and insightful. Do not ask questions."}

Rules:
- Return JSON only.
- If the comment is spam, abusive, asks for illegal uploads, has no clear context, is only emojis, is only one letter, or does not need a reply, set shouldReply false.
- Do not mention that you are AI.
- Use the Movie ID context when it helps, but do not over-explain it unless the viewer asks.
- Do not invent facts about the video, movie, or viewer.
- Do not ask people to like/subscribe.
- Do not ask questions or end with a question mark.
- Replies must be statements. They can be short provocative opinions, agreements, playful disagreement, useful context, or context-aware reactions.
- Prefer a confident creator voice over generic support-agent wording.
- Do not use long dash punctuation.
- Keep reply under 180 characters.
- One sentence is preferred.`,
                    },
                ],
            },
        ],
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    shouldReply: { type: Type.BOOLEAN },
                    reply: { type: Type.STRING },
                    reason: { type: Type.STRING },
                },
                required: ["shouldReply", "reply"],
            },
        },
    });
    const data = parseModelJson(response.text, {});
    const reply = sanitizeGeneratedReply(data.reply);
    if (replyLooksLikeQuestion(reply))
        return { shouldReply: false, reply: "", reason: "Question-style reply skipped" };
    return { shouldReply: data.shouldReply === true && reply.length > 0, reply, reason: String(data.reason || "") };
}
async function identifyMovieFromYouTubeVideo(videoId) {
    const cleanVideoId = String(videoId || "").trim();
    if (!cleanVideoId)
        throw new Error("Video ID is required.");
    const cacheLookup = normalizeMovieCacheLookup({
        sourceType: "youtube",
        youtubeVideoId: cleanVideoId,
        normalizedUrl: `https://www.youtube.com/watch?v=${cleanVideoId}`,
    });
    const cached = await getCachedMovieIdentification(cacheLookup).catch(() => null);
    if (cached) {
        return {
            title: String(cached?.title || "").trim(),
            year: String(cached?.year || "").trim(),
            genre: String(cached?.genre || "").trim(),
            confidence: Number(cached?.confidence || 0),
            result: cached,
            cached: true,
        };
    }
    const tempFile = makeLinkAnalysisVideoPath();
    try {
        await runYtDlpSocialDownload(`https://www.youtube.com/watch?v=${encodeURIComponent(cleanVideoId)}`, tempFile);
        const downloadedFile = resolveDownloadedOutput(tempFile);
        const stat = fs.statSync(downloadedFile);
        const maxBytes = tikTokDownloadMaxBytes();
        if (stat.size > maxBytes) {
            throw new Error(`Downloaded video is too large (${Math.round(stat.size / 1024 / 1024)}MB; limit ${Math.round(maxBytes / 1024 / 1024)}MB).`);
        }
        const result = await identifyMovieFromVideoFile(downloadedFile, "video/mp4", cacheLookup);
        return {
            title: String(result?.title || "").trim(),
            year: String(result?.year || "").trim(),
            genre: String(result?.genre || "").trim(),
            confidence: Number(result?.confidence || 0),
            result,
        };
    }
    finally {
        cleanupMatchingDownloadOutputs(tempFile);
    }
}
function threadHasOwnerReply(thread, account) {
    const channelId = String(account?.channelId || "").trim();
    const channelTitle = String(account?.channelTitle || "").trim().toLowerCase();
    return (thread.replies || []).some((reply) => {
        const url = String(reply.authorChannelUrl || "");
        const name = String(reply.authorDisplayName || "").trim().toLowerCase();
        return (channelId && url.includes(channelId)) || (channelTitle && name === channelTitle);
    });
}
function threadHasMovieNameOwnerReply(thread, account) {
    const channelId = String(account?.channelId || "").trim();
    const channelTitle = String(account?.channelTitle || "").trim().toLowerCase();
    return (thread.replies || []).some((reply) => {
        const url = String(reply.authorChannelUrl || "");
        const name = String(reply.authorDisplayName || "").trim().toLowerCase();
        const owner = (channelId && url.includes(channelId)) || (channelTitle && name === channelTitle);
        return owner && /^movie\s*:/i.test(String(reply.textOriginal || reply.textDisplay || "").trim());
    });
}
async function runChannelCommentReplyAgent(userId, accountId, options = {}) {
    const account = await usableYouTubeAccount(userId, accountId);
    requireYouTubeScope(account, "https://www.googleapis.com/auth/youtube.force-ssl", "YouTube comments");
    const dashboard = await getConnectedYouTubeDashboard(account);
    const maxVideos = Math.min(Math.max(Number(options.maxVideos) || 10, 1), 50);
    const maxCommentsPerVideo = Math.min(Math.max(Number(options.maxCommentsPerVideo) || 8, 1), 50);
    const maxReplies = Math.min(Math.max(Number(options.maxReplies) || 10, 1), 50);
    const dryRun = options.dryRun !== false;
    const tone = String(options.tone || "warm-curious").trim().slice(0, 80);
    const instructions = String(options.instructions || "").trim().slice(0, 500);
    const sort = String(options.sort || "comments");
    const identifyMovies = options.identifyMovies !== false;
    const movieCache = new Map();
    const movieContextForVideo = async (video) => {
        if (!identifyMovies)
            return null;
        if (movieCache.has(video.id))
            return movieCache.get(video.id);
        const movie = await identifyMovieFromYouTubeVideo(video.id).catch((error) => {
            console.warn("Channel movie ID skipped:", error instanceof Error ? error.message : error);
            return { title: "", year: "", confidence: 0, error: error instanceof Error ? error.message : String(error) };
        });
        movieCache.set(video.id, movie);
        return movie;
    };
    const videos = [...(dashboard.recentVideos || [])]
        .filter((video) => video.id && Number(video.commentCount || 0) > 0)
        .sort((a, b) => {
        if (sort === "views")
            return Number(b.viewCount || 0) - Number(a.viewCount || 0);
        if (sort === "oldest")
            return new Date(a.publishedAt || 0).getTime() - new Date(b.publishedAt || 0).getTime();
        if (sort === "recent")
            return new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime();
        return Number(b.commentCount || 0) - Number(a.commentCount || 0);
    })
        .slice(0, maxVideos);
    const scanned = [];
    const replied = [];
    const skipped = [];
    let replyCount = 0;
    for (const video of videos) {
        if (replyCount >= maxReplies)
            break;
        const comments = await getYouTubeVideoComments(account, video.id, maxCommentsPerVideo, "");
        scanned.push({ id: video.id, title: video.title, comments: comments.comments?.length || 0 });
        for (const thread of comments.comments || []) {
            if (replyCount >= maxReplies)
                break;
            const comment = thread.topLevelComment || {};
            const commentId = String(comment.id || "");
            if (!commentId || !thread.canReply) {
                skipped.push({ videoId: video.id, commentId, reason: "Cannot reply" });
                continue;
            }
            const commentText = `${comment.textOriginal || ""} ${comment.textDisplay || ""}`.trim();
            const asksMovie = asksForMovieName(commentText);
            const seenType = await runPsql(`SELECT COALESCE((SELECT reply_type FROM channel_comment_replies WHERE youtube_account_id = ${sqlString(account.id)} AND comment_id = ${sqlString(commentId)} LIMIT 1), '');`);
            if (seenType === "movie_name") {
                skipped.push({ videoId: video.id, commentId, reason: "Movie name already replied" });
                continue;
            }
            if (seenType && !asksMovie) {
                skipped.push({ videoId: video.id, commentId, reason: "Already handled" });
                continue;
            }
            if (threadHasMovieNameOwnerReply(thread, account)) {
                skipped.push({ videoId: video.id, commentId, reason: "Movie name already replied" });
                continue;
            }
            if (threadHasOwnerReply(thread, account) && !asksMovie) {
                skipped.push({ videoId: video.id, commentId, reason: "Owner already replied" });
                continue;
            }
            if (asksMovie && identifyMovies) {
                const movie = await movieContextForVideo(video);
                if (movie?.title && Number(movie.confidence || 0) >= 0.35) {
                    const replyText = sanitizeGeneratedReply(`Movie: ${movie.title}${movie.year ? ` (${movie.year})` : ""}`);
                    let replyId = "";
                    if (!dryRun) {
                        const reply = await replyToYouTubeComment(account, commentId, replyText);
                        replyId = String(reply.id || "");
                        await runPsql(`
INSERT INTO channel_comment_replies (id, user_id, youtube_account_id, video_id, video_title, comment_id, reply_id, reply_text, reply_type, created_at)
VALUES (
  ${sqlString(`ccr_${crypto.randomUUID()}`)}, ${sqlString(userId)}, ${sqlString(account.id)}, ${sqlString(video.id)}, ${sqlString(video.title)},
  ${sqlString(commentId)}, ${sqlString(replyId)}, ${sqlString(replyText)}, 'movie_name', now()
)
ON CONFLICT (youtube_account_id, comment_id) DO UPDATE SET
  reply_id = EXCLUDED.reply_id,
  reply_text = EXCLUDED.reply_text,
  reply_type = EXCLUDED.reply_type,
  created_at = now();
`);
                    }
                    replied.push({
                        dryRun,
                        videoId: video.id,
                        videoTitle: video.title,
                        commentId,
                        author: comment.authorDisplayName || "Viewer",
                        comment: commentText.slice(0, 500),
                        replyId,
                        replyText,
                        replyType: "movie_name",
                        movie,
                    });
                    replyCount += 1;
                    continue;
                }
                skipped.push({ videoId: video.id, commentId, reason: movie?.error ? `Movie ID failed: ${movie.error}` : "Movie name not confident enough" });
                continue;
            }
            if (shouldSkipCommunityComment(commentText)) {
                skipped.push({ videoId: video.id, commentId, reason: "Low-value or unsafe comment" });
                continue;
            }
            const movie = await movieContextForVideo(video);
            const generated = await generateChannelCommentReply({ commentText, video, movie, tone, instructions }).catch((error) => {
                console.warn("Channel comment reply generation skipped:", error instanceof Error ? error.message : error);
                return { shouldReply: false, reply: "", reason: "AI skipped" };
            });
            if (!generated.shouldReply) {
                skipped.push({ videoId: video.id, commentId, reason: generated.reason || "No reply needed" });
                continue;
            }
            let replyId = "";
            if (!dryRun) {
                const reply = await replyToYouTubeComment(account, commentId, generated.reply);
                replyId = String(reply.id || "");
                await runPsql(`
INSERT INTO channel_comment_replies (id, user_id, youtube_account_id, video_id, video_title, comment_id, reply_id, reply_text, reply_type, created_at)
VALUES (
  ${sqlString(`ccr_${crypto.randomUUID()}`)}, ${sqlString(userId)}, ${sqlString(account.id)}, ${sqlString(video.id)}, ${sqlString(video.title)},
  ${sqlString(commentId)}, ${sqlString(replyId)}, ${sqlString(generated.reply)}, 'ai_engagement', now()
)
ON CONFLICT (youtube_account_id, comment_id) DO NOTHING;
`);
            }
            replied.push({
                dryRun,
                videoId: video.id,
                videoTitle: video.title,
                commentId,
                author: comment.authorDisplayName || "Viewer",
                comment: commentText.slice(0, 500),
                replyId,
                replyText: generated.reply,
                replyType: movie?.title ? "ai_engagement_movie_context" : "ai_engagement",
                movie: movie?.title ? movie : null,
            });
            replyCount += 1;
        }
    }
    const statsOut = await runPsql(`
SELECT COALESCE(json_build_object(
  'totalReplies', COUNT(*),
  'videosTouched', COUNT(DISTINCT video_id),
  'lastReplyAt', CASE WHEN MAX(created_at) IS NULL THEN NULL ELSE FLOOR(EXTRACT(EPOCH FROM MAX(created_at)) * 1000)::bigint END
), '{}'::json)
FROM channel_comment_replies
WHERE youtube_account_id = ${sqlString(account.id)};
`);
    return {
        dryRun,
        account: {
            id: account.id,
            channelId: account.channelId,
            channelTitle: dashboard.account?.channelTitle || account.channelTitle,
        },
        scanned,
        replied,
        skipped: skipped.slice(0, 80),
        stats: JSON.parse(statsOut || "{}"),
    };
}
async function autoManageYouTubeComments(uploadId, account, videoId) {
    const uploadOut = await runPsql(`
SELECT COALESCE((
  SELECT json_build_object(
    'id', u.id,
    'title', u.title,
    'movieTitle', u.movie_title,
    'movieYear', u.movie_year,
    'genre', u.genre,
    'microNiche', u.micro_niche,
    'settings', a.settings
  )
  FROM automation_uploads u
  JOIN automation_agents a ON a.id = u.agent_id
  WHERE u.id = ${sqlString(uploadId)}
  LIMIT 1
), 'null'::json);
`);
    const upload = JSON.parse(uploadOut || "null");
    const movieTitle = String(upload?.movieTitle || "").trim();
    const settings = normalizeAutomationSettings(upload?.settings || {});
    if (!movieTitle && !settings.communityManagementEnabled)
        return;
    const comments = await getYouTubeVideoComments(account, videoId, 30, "");
    let aiReplies = 0;
    const maxAiReplies = settings.aiEngagementRepliesEnabled ? settings.maxCommentRepliesPerCheck : 0;
    for (const thread of comments.comments || []) {
        const comment = thread.topLevelComment || {};
        const commentId = String(comment.id || "");
        if (!commentId || !thread.canReply)
            continue;
        const seen = await runPsql(`SELECT COUNT(*) FROM automation_comment_replies WHERE upload_id = ${sqlString(uploadId)} AND comment_id = ${sqlString(commentId)};`);
        if (Number(seen || 0) > 0)
            continue;
        const commentText = `${comment.textOriginal || ""} ${comment.textDisplay || ""}`.trim();
        const asksMovie = movieTitle && asksForMovieName(commentText);
        let replyText = "";
        let replyType = "";
        if (asksMovie) {
            replyText = sanitizeGeneratedReply(`Movie: ${movieTitle}${upload?.movieYear ? ` (${upload.movieYear})` : ""}`);
            replyType = "movie_name";
        }
        else if (settings.communityManagementEnabled && settings.aiEngagementRepliesEnabled && aiReplies < maxAiReplies && !shouldSkipCommunityComment(commentText)) {
            const generated = await generateCommunityReply({ commentText, upload, settings, movieTitle, movieYear: upload?.movieYear || "" }).catch((error) => {
                console.warn("AI comment reply generation skipped:", error instanceof Error ? error.message : error);
                return { shouldReply: false, reply: "" };
            });
            if (!generated.shouldReply)
                continue;
            replyText = generated.reply;
            replyType = "ai_engagement";
            aiReplies += 1;
        }
        if (!replyText)
            continue;
        const reply = await replyToYouTubeComment(account, commentId, replyText);
        await runPsql(`
INSERT INTO automation_comment_replies (id, upload_id, comment_id, reply_id, reply_text, created_at)
VALUES (${sqlString(`acr_${crypto.randomUUID()}`)}, ${sqlString(uploadId)}, ${sqlString(commentId)}, ${sqlString(reply.id || "")}, ${sqlString(replyText)}, now())
ON CONFLICT (upload_id, comment_id) DO NOTHING;
UPDATE automation_uploads
SET metrics = metrics || ${jsonbLiteral({ lastCommentReply: { type: replyType, commentId, replyText, repliedAt: new Date().toISOString() } })}, updated_at = now()
WHERE id = ${sqlString(uploadId)};
`);
    }
}
const activeAutomationRuns = new Set();
function compilationJobsDir() {
    const dir = path.join(projectRoot, "tmp", "compilation-jobs");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}
function compilationJobPath(id) {
    const safeId = String(id || "").replace(/[^a-zA-Z0-9_-]/g, "");
    return path.join(compilationJobsDir(), `${safeId}.json`);
}
function saveCompilationJob(job) {
    const target = compilationJobPath(job.id);
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(job, null, 2));
    fs.renameSync(tmp, target);
}
function loadCompilationJob(id) {
    try {
        const safeId = String(id || "").replace(/[^a-zA-Z0-9_-]/g, "");
        if (!safeId)
            return null;
        const raw = fs.readFileSync(compilationJobPath(safeId), "utf8");
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
function isProcessAlive(pid) {
    const numericPid = Number(pid || 0);
    if (!numericPid)
        return false;
    try {
        process.kill(numericPid, 0);
        return true;
    }
    catch {
        return false;
    }
}
function publicCompilationJob(job) {
    return {
        id: job.id,
        status: job.status,
        message: job.message,
        result: job.result || null,
        error: job.error || "",
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
    };
}
function cleanupCompilationJobs() {
    const maxAgeMs = 24 * 60 * 60 * 1000;
    const now = Date.now();
    try {
        for (const entry of fs.readdirSync(compilationJobsDir())) {
            if (!entry.endsWith(".json"))
                continue;
            const filePath = path.join(compilationJobsDir(), entry);
            const raw = fs.readFileSync(filePath, "utf8");
            const job = JSON.parse(raw);
            if (now - Number(job.updatedAt || job.createdAt || now) > maxAgeMs) {
                fs.rmSync(filePath, { force: true });
            }
        }
    }
    catch {
    }
}
function spawnCompilationWorker(job) {
    const logDir = path.join(compilationJobsDir(), "logs");
    fs.mkdirSync(logDir, { recursive: true });
    const out = fs.openSync(path.join(logDir, `${job.id}.out.log`), "a");
    const err = fs.openSync(path.join(logDir, `${job.id}.err.log`), "a");
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--compilation-worker", job.id], {
        cwd: projectRoot,
        detached: true,
        stdio: ["ignore", out, err],
        env: process.env,
    });
    child.unref();
    job.workerPid = child.pid || 0;
    job.message = "Queued";
    job.updatedAt = Date.now();
    saveCompilationJob(job);
}
function createCompilationJob(userId, body = {}) {
    cleanupCompilationJobs();
    const now = Date.now();
    const job = {
        id: `compjob_${crypto.randomUUID()}`,
        userId,
        body,
        status: "queued",
        message: "Queued",
        result: null,
        error: "",
        workerPid: 0,
        createdAt: now,
        updatedAt: now,
    };
    saveCompilationJob(job);
    try {
        spawnCompilationWorker(job);
    }
    catch (error) {
        job.status = "error";
        job.message = "Could not start compilation worker";
        job.error = error instanceof Error ? error.message : "Could not start compilation worker";
        job.updatedAt = Date.now();
        saveCompilationJob(job);
    }
    return job;
}
async function runCompilationWorker(jobId) {
    const job = loadCompilationJob(jobId);
    if (!job)
        throw new Error("Compilation job not found");
    job.status = "running";
    job.message = "Building compilation";
    job.workerPid = process.pid;
    job.updatedAt = Date.now();
    saveCompilationJob(job);
    try {
        const result = await createCompilationUpload(job.userId, job.body || {});
        job.status = "done";
        job.message = String(job.body?.outputMode || "").toLowerCase() === "download" ? "Compilation file is ready" : "Compilation uploaded";
        job.result = result;
        job.updatedAt = Date.now();
        saveCompilationJob(job);
    }
    catch (error) {
        job.status = "error";
        job.message = "Compilation failed";
        job.error = error instanceof Error ? error.message : "Could not create compilation";
        job.updatedAt = Date.now();
        saveCompilationJob(job);
    }
}
async function runDueAutomationAgents() {
    if (!postgresConfigured())
        return;
    const out = await runPsql(`
SELECT COALESCE(json_agg(json_build_object('id', id, 'userId', user_id)), '[]'::json)
FROM (
  SELECT id, user_id
  FROM automation_agents
  WHERE status = 'active' AND (next_run_at IS NULL OR next_run_at <= now())
  ORDER BY COALESCE(next_run_at, created_at) ASC
  LIMIT 3
) due_agents;
`);
    const due = JSON.parse(out || "[]");
    for (const item of due) {
        if (!item?.id || activeAutomationRuns.has(item.id))
            continue;
        activeAutomationRuns.add(item.id);
        runAutomationAgentOnce(item.userId, item.id)
            .catch((error) => console.warn("Automation agent run failed:", error instanceof Error ? error.message : error))
            .finally(() => activeAutomationRuns.delete(item.id));
    }
}
async function captureDueAutomationPerformance() {
    if (!postgresConfigured())
        return;
    const out = await runPsql(`
SELECT COALESCE(json_agg(json_build_object(
  'uploadId', upload_id,
  'userId', user_id,
  'accountId', youtube_account_id,
  'videoId', youtube_video_id,
  'hours', performance_check_hours
)), '[]'::json)
FROM (
  SELECT
    u.id AS upload_id,
    u.user_id,
    u.youtube_account_id,
    u.youtube_video_id,
    COALESCE((a.settings->>'performanceCheckHours')::int, 3) AS performance_check_hours,
    u.created_at
  FROM automation_uploads u
  JOIN automation_agents a ON a.id = u.agent_id
  WHERE u.youtube_video_id <> ''
    AND u.created_at > now() - interval '14 days'
    AND NOT EXISTS (
      SELECT 1 FROM automation_performance_snapshots s
      WHERE s.upload_id = u.id
        AND s.captured_at > now() - (COALESCE((a.settings->>'performanceCheckHours')::int, 3)::text || ' hours')::interval
    )
  ORDER BY u.created_at DESC
  LIMIT 10
) due_uploads;
`);
    const due = JSON.parse(out || "[]");
    for (const item of due) {
        try {
            const account = await usableYouTubeAccount(item.userId, item.accountId);
            await captureAutomationPerformance(item.uploadId, account, item.videoId);
        }
        catch (error) {
            console.warn("Automation performance capture failed:", error instanceof Error ? error.message : error);
        }
    }
}
function youtubeApiKey() {
    return (process.env.YOUTUBE_API_KEY || process.env.YT_API_KEY || "").replace(/^["']|["']$/g, "").trim();
}
async function fetchYouTubeJson(pathName, params = {}) {
    const key = youtubeApiKey();
    if (!key) {
        throw new Error("YOUTUBE_API_KEY is not configured. Add it to .env.local.");
    }
    const url = new URL(`https://www.googleapis.com/youtube/v3/${pathName.replace(/^\/+/, "")}`);
    url.searchParams.set("key", key);
    Object.entries(params).forEach(([paramKey, value]) => {
        if (value !== undefined && value !== null && value !== "") {
            url.searchParams.set(paramKey, String(value));
        }
    });
    const response = await fetch(url);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const message = data?.error?.message || `YouTube request failed (${response.status})`;
        throw new Error(message);
    }
    return data;
}
function isoDurationToSeconds(duration) {
    const match = String(duration || "").match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match)
        return 0;
    const [, days, hours, minutes, seconds] = match;
    return (Number(days || 0) * 86400 + Number(hours || 0) * 3600 + Number(minutes || 0) * 60 + Number(seconds || 0));
}
function compactKeyword(text) {
    return String(text || "")
        .toLowerCase()
        .replace(/&amp;/g, " ")
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((word) => word.length > 3 && !["video", "official", "shorts", "youtube", "with", "from", "that", "this", "your", "what", "when", "where", "into"].includes(word));
}
/** YouTube Data API v3 `videoCategoryId` ? US guide labels (all official IDs 1�29). */
const YOUTUBE_CATEGORY_ID_TO_NAME = {
    "1": "Film & Animation",
    "2": "Autos & Vehicles",
    "10": "Music",
    "15": "Pets & Animals",
    "17": "Sports",
    "19": "Travel & Events",
    "20": "Gaming",
    "22": "People & Blogs",
    "23": "Comedy",
    "24": "Entertainment",
    "25": "News & Politics",
    "26": "Howto & Style",
    "27": "Education",
    "28": "Science & Technology",
    "29": "Nonprofits & Activism",
};
function getYoutubeCategoryName(categoryId) {
    const id = String(categoryId ?? "").trim();
    if (!id || id === "0")
        return "Not classified";
    return YOUTUBE_CATEGORY_ID_TO_NAME[id] || "Uncategorized";
}
function matchesVideoDurationFilter(durationKey, seconds) {
    if (durationKey === "any")
        return true;
    const s = Number(seconds) || 0;
    if (durationKey === "short")
        return s < 240;
    if (durationKey === "medium")
        return s >= 240 && s < 1200;
    if (durationKey === "long")
        return s >= 1200;
    return true;
}
function inferNiche(title, description, userQuery, categoryName, tagsText) {
    const tags = String(tagsText || "");
    const text = `${title} ${description} ${userQuery} ${tags}`.toLowerCase();
    const rules = [
        ["movie & TV recap", ["recap", "ending explained", "ending", "movie review", "film explained"]],
        ["movie recap", ["movie", "recap", "film", "cinema", "trailer", "full movie"]],
        ["documentary & explainers", ["documentary", "docuseries", "miniseries", "investigative", "exposed", "scandal", "controversy"]],
        ["AI & automation", ["chatgpt", "openai", "midjourney", "gemini", "robot", "automation", "artificial intelligence", "llm", "neural", "sora", "claude"]],
        ["space & astronomy", ["space", "nasa", "spacex", "moon", "mars", "galaxy", "planet", "solar", "astronom", "cosmos", "ufo", "james webb"]],
        ["history & war", ["history", "ancient", "ww2", "wwii", "empire", "civilization", "battle of", "dynasty"]],
        ["money & business", ["stonks", "stock", "passive income", "money", "business", "startup", "crypto", "invest", "hustle", "revenue"]],
        ["true crime", ["true crime", "unsolved", "serial killer", "case file", "murder", "mystery", "jury", "court case"]],
        ["health & fitness", ["gym", "workout", "diet", "protein", "longevity", "health", "sleep", "meditation", "yoga", "keto", "gains", "primal"]],
        ["coding & software", ["coding", "python", "javascript", "typescript", "github", "programming", "debug", "react.js", "next.js", "node.js", "api", "devops", "linux", "cursor", "stack overflow"]],
        ["reaction & review", ["reaction video", "reacts", "first time", "honest review", "rating", "game breakdown", "tier list", "i watched"]],
        ["shorts & clips", ["#shorts", "shorts", "short video", "clip", "bitesized"]],
        ["challenge & viral", ["challenge", "dare", "prank", "viral", "trending", "gone wrong", "satisfying", "satisfy"]],
        ["music & audio", ["cover", "lyrics", "remix", "acoustic", "beat", "album", "mv", "official video", "live performance"]],
        ["podcast & talk", ["podcast", "interview", "ep.", "livestream", "q&a", "debate", "opinion", "rant"]],
        ["beauty & fashion", ["makeup", "skincare", "outfit", "fashion", "grwm", "aesthetic", "nails", "hairstyle"]],
        ["food & cooking", ["recipe", "cooking", "mukbang", "eat", "food review", "chef", "kitchen", "baking"]],
    ];
    for (const [label, keywords] of rules) {
        for (const keyword of keywords) {
            if (text.includes(String(keyword).toLowerCase()))
                return label;
        }
    }
    const cat = String(categoryName || "").toLowerCase();
    if (cat.includes("film") || cat.includes("animation")) {
        if (/(movie|recap|trailer|scene|cinema|short film)/.test(text))
            return "Film & long-form (category)";
        return "Animation & video (category)";
    }
    if (cat.includes("gaming"))
        return "Gaming (category)";
    if (cat.includes("science") || cat.includes("technology")) {
        if (/(space|nasa|planet|physics|quantum|data science|ml\b|code)/.test(text))
            return "STEM & digital (category)";
        return "Science & tech (category)";
    }
    if (cat.includes("howto") || cat.includes("style"))
        return "How-to & life skills (category)";
    if (cat.includes("education"))
        return "Education (category)";
    if (cat.includes("entertainment"))
        return "Entertainment (category)";
    if (cat.includes("news") || cat.includes("politics"))
        return "News & politics (category)";
    if (cat.includes("people") || cat.includes("blogs")) {
        const topWord = compactKeyword(`${title} ${userQuery} ${tags}`)[0];
        return topWord ? `${topWord} � creator` : "Creator & lifestyle (category)";
    }
    if (cat.includes("music"))
        return "Music (category)";
    if (cat.includes("sports"))
        return "Sports (category)";
    if (cat.includes("pets") || cat.includes("animals"))
        return "Pets & animals (category)";
    if (cat.includes("travel") || cat.includes("events"))
        return "Travel & events (category)";
    if (cat.includes("comedy"))
        return "Comedy (category)";
    if (cat.includes("nonprofit"))
        return "Nonprofit (category)";
    if (cat.includes("autos") || cat.includes("vehicles"))
        return "Autos (category)";
    const topWordN = compactKeyword(`${title} ${userQuery} ${tags}`)[0];
    if (topWordN)
        return `${topWordN} (topic signal)`;
    if (categoryName && categoryName !== "Uncategorized" && categoryName !== "Not classified")
        return `General � ${categoryName}`;
    return "emerging / multi-topic";
}
function facelessSignals(title, description, channelTitle) {
    const text = `${title} ${description} ${channelTitle}`.toLowerCase();
    const signals = [
        "recap",
        "explained",
        "facts",
        "documentary",
        "story",
        "stories",
        "mystery",
        "history",
        "top 10",
        "compilation",
        "animation",
        "ai voice",
        "motivation",
        "shorts",
    ];
    const hits = signals.filter((signal) => text.includes(signal));
    const personalBrandPenalty = /\b(i|me|my|vlog|daily life|family|travel with|my day)\b/i.test(text) ? 1 : 0;
    const score = Math.max(0, Math.min(100, 42 + hits.length * 9 - personalBrandPenalty * 22));
    return { score, hits: hits.slice(0, 4) };
}
function estimateRpm(niche) {
    const n = String(niche || "").toLowerCase();
    if (/(money|business|finance|tech|software|ai)/.test(n))
        return "$8-$24";
    if (/(health|fitness)/.test(n))
        return "$5-$16";
    if (/(history|space|crime|movie|story)/.test(n))
        return "$2-$9";
    return "$2-$7";
}
function competitionLabel(channelCount, medianSubscribers) {
    if (medianSubscribers < 25000 && channelCount < 12)
        return "Low";
    if (medianSubscribers < 150000 && channelCount < 28)
        return "Medium";
    return "High";
}
function median(values) {
    const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
    if (!sorted.length)
        return 0;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}
function buildYouTubeRadarVideos(videos, channelMap, query) {
    const now = Date.now();
    return videos.map((video) => {
        const snippet = video.snippet || {};
        const stats = video.statistics || {};
        const details = video.contentDetails || {};
        const channel = channelMap.get(snippet.channelId) || {};
        const channelStats = channel.statistics || {};
        const viewCount = Number(stats.viewCount || 0);
        const likeCount = Number(stats.likeCount || 0);
        const commentCount = Number(stats.commentCount || 0);
        const subscriberCount = channelStats.hiddenSubscriberCount ? 0 : Number(channelStats.subscriberCount || 0);
        const publishedAt = snippet.publishedAt || "";
        const ageHours = publishedAt ? Math.max(1, (now - new Date(publishedAt).getTime()) / 36e5) : 1;
        const viewsPerHour = Math.round(viewCount / ageHours);
        const outlierScore = Math.round(Math.min(100, (viewCount / Math.max(subscriberCount, 1)) * 18 + viewsPerHour / 180));
        const categoryId = String(snippet.categoryId ?? "").trim() || "0";
        const categoryName = getYoutubeCategoryName(categoryId);
        const tagStr = Array.isArray(snippet.tags) ? snippet.tags.join(" ") : "";
        const niche = inferNiche(snippet.title, snippet.description, query, categoryName, tagStr);
        const face = facelessSignals(snippet.title, snippet.description, snippet.channelTitle);
        const opportunityScore = Math.round(Math.min(100, outlierScore * 0.46 + face.score * 0.28 + Math.min(100, viewsPerHour / 60) * 0.18 + (subscriberCount < 100000 ? 8 : 0)));
        return {
            id: video.id,
            url: `https://www.youtube.com/watch?v=${video.id}`,
            title: snippet.title || "Untitled video",
            description: snippet.description || "",
            thumbnailUrl: snippet.thumbnails?.maxres?.url || snippet.thumbnails?.standard?.url || snippet.thumbnails?.high?.url || snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || "",
            channelId: snippet.channelId || "",
            channelTitle: snippet.channelTitle || "Unknown channel",
            channelUrl: snippet.channelId ? `https://www.youtube.com/channel/${snippet.channelId}` : "",
            categoryId,
            categoryName,
            publishedAt,
            viewCount,
            likeCount,
            commentCount,
            subscriberCount,
            viewsPerHour,
            outlierScore,
            opportunityScore,
            facelessScore: face.score,
            facelessSignals: face.hits,
            niche,
            durationSeconds: isoDurationToSeconds(details.duration),
            rpmEstimate: estimateRpm(niche),
        };
    });
}
function buildYouTubeNiches(radarVideos) {
    const groups = new Map();
    for (const video of radarVideos) {
        const current = groups.get(video.niche) || [];
        current.push(video);
        groups.set(video.niche, current);
    }
    return Array.from(groups.entries())
        .map(([name, videos]) => {
        const medianSubscribers = median(videos.map((video) => video.subscriberCount));
        const avgOpportunity = Math.round(videos.reduce((sum, video) => sum + video.opportunityScore, 0) / videos.length);
        const avgVph = Math.round(videos.reduce((sum, video) => sum + video.viewsPerHour, 0) / videos.length);
        return {
            name,
            opportunityScore: avgOpportunity,
            competition: competitionLabel(new Set(videos.map((video) => video.channelId)).size, medianSubscribers),
            estimatedRpm: estimateRpm(name),
            outlierCount: videos.filter((video) => video.outlierScore >= 55).length,
            medianSubscribers,
            viewsPerHour: avgVph,
            topVideos: videos.slice(0, 3).map((video) => video.id),
            angles: [
                `Fast-paced ${name} breakdowns with a strong first-line hook`,
                `Series format: 5-8 repeatable examples per upload`,
                `Shorts-to-longform funnel using the same topic cluster`,
            ],
        };
    })
        .sort((a, b) => b.opportunityScore - a.opportunityScore);
}
const YT_RADAR_REGIONS = new Set(["US", "GB", "CA", "AU", "IN"]);
const YT_RADAR_ORDERS = new Set(["date", "relevance", "viewCount"]);
const YT_RADAR_DURATIONS = new Set(["any", "short", "medium", "long"]);
function normalizeYouTubeRadarInput(body) {
    const b = body && typeof body === "object" ? body : {};
    const query = String(b.query ?? "").trim();
    const maxN = Number(b.maxResults);
    const capped = Math.min(Math.max(Number.isFinite(maxN) && maxN > 0 ? maxN : 30, 5), 50);
    const dayN = Number(b.publishedAfterDays);
    const publishedAfterDays = Math.min(Math.max(Number.isFinite(dayN) && dayN > 0 ? dayN : 90, 1), 3650);
    let regionCode = String(b.regionCode ?? "US")
        .trim()
        .toUpperCase();
    if (!/^[A-Z]{2}$/.test(regionCode) || !YT_RADAR_REGIONS.has(regionCode))
        regionCode = "US";
    const rawLang = String(b.relevanceLanguage ?? "en").trim().toLowerCase();
    const relevanceLanguage = (rawLang.slice(0, 2) || "en");
    let order = String(b.order ?? "viewCount").toLowerCase();
    if (!YT_RADAR_ORDERS.has(order))
        order = "viewCount";
    let duration = String(b.duration ?? "any").toLowerCase();
    if (!YT_RADAR_DURATIONS.has(duration))
        duration = "any";
    const wantsTrending = b.trending === true
        || b.trending === 1
        || String(b.mode ?? "").toLowerCase() === "trending"
        || String(b.scanMode ?? "").toLowerCase() === "trending";
    const mode = wantsTrending ? "trending" : "search";
    return { mode, query, maxResults: capped, publishedAfterDays, regionCode, relevanceLanguage, order, duration };
}
function orderRadarVideosBySearch(videos, order) {
    if (order === "viewCount")
        return [...videos].sort((a, b) => b.viewCount - a.viewCount);
    if (order === "date")
        return [...videos].sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
    return [...videos];
}
async function getYouTubeSearchRadar(n) {
    const { query: cleanQuery, maxResults, regionCode, relevanceLanguage, order, duration, publishedAfterDays } = n;
    if (!cleanQuery)
        throw new Error("Search query is required");
    const publishedAfter = new Date(Date.now() - publishedAfterDays * 864e5).toISOString();
    const search = await fetchYouTubeJson("search", {
        part: "snippet",
        type: "video",
        q: cleanQuery,
        maxResults,
        order,
        regionCode,
        relevanceLanguage,
        videoDuration: duration === "any" ? "" : duration,
        publishedAfter,
        safeSearch: "none",
    });
    const ids = (search.items || []).map((item) => item.id?.videoId).filter(Boolean);
    if (!ids.length) {
        return { query: cleanQuery, scanMode: "search", generatedAt: new Date().toISOString(), videos: [], niches: [], summary: { videoCount: 0, avgOpportunity: 0, avgViewsPerHour: 0, bestNiche: "", apiMode: "youtube-data-api" } };
    }
    const videoData = await fetchYouTubeJson("videos", {
        part: "snippet,statistics,contentDetails",
        id: ids.join(","),
        maxResults: Math.min(50, maxResults),
    });
    const byId = new Map((videoData.items || []).map((video) => [video.id, video]));
    const searchOrderItems = ids.map((id) => byId.get(id)).filter(Boolean);
    const channelIds = Array.from(new Set(searchOrderItems.map((video) => video.snippet?.channelId).filter(Boolean)));
    const channelMap = new Map();
    for (let i = 0; i < channelIds.length; i += 50) {
        const chunk = channelIds.slice(i, i + 50);
        const channelData = await fetchYouTubeJson("channels", {
            part: "snippet,statistics",
            id: chunk.join(","),
            maxResults: chunk.length,
        });
        for (const channel of channelData.items || []) {
            channelMap.set(channel.id, channel);
        }
    }
    const built = buildYouTubeRadarVideos(searchOrderItems, channelMap, cleanQuery);
    const videos = orderRadarVideosBySearch(built, order);
    const niches = buildYouTubeNiches(videos);
    return {
        query: cleanQuery,
        scanMode: "search",
        generatedAt: new Date().toISOString(),
        videos,
        niches,
        summary: {
            videoCount: videos.length,
            avgOpportunity: videos.length ? Math.round(videos.reduce((sum, video) => sum + video.opportunityScore, 0) / videos.length) : 0,
            avgViewsPerHour: videos.length ? Math.round(videos.reduce((sum, video) => sum + video.viewsPerHour, 0) / videos.length) : 0,
            bestNiche: niches[0]?.name || "",
            apiMode: "youtube-data-api",
        },
    };
}
/**
 * Regional chart=mostPopular, then local filters (age, length), then your Sort (views ties to "top by views"),
 * and niche/category from our classifier + YouTube category.
 */
async function getYouTubeTrendingRadar(n) {
    const { maxResults, regionCode, order, duration, publishedAfterDays } = n;
    const videoData = await fetchYouTubeJson("videos", {
        part: "snippet,statistics,contentDetails",
        chart: "mostPopular",
        regionCode,
        maxResults: 50,
    });
    const cutoff = Date.now() - publishedAfterDays * 864e5;
    let items = (videoData.items || []).filter((v) => {
        const t = v.snippet?.publishedAt;
        if (!t)
            return false;
        return new Date(t).getTime() >= cutoff;
    });
    items = items.filter((v) => {
        const sec = isoDurationToSeconds(v.contentDetails?.duration);
        return matchesVideoDurationFilter(duration, sec);
    });
    const qf = n.query && String(n.query).trim();
    if (qf) {
        const needle = String(qf).toLowerCase();
        const terms = needle.split(/\s+/).filter(Boolean);
        items = items.filter((v) => {
            const s = v.snippet || {};
            const blob = `${s.title} ${s.description || ""} ${(Array.isArray(s.tags) ? s.tags.join(" ") : "")}`.toLowerCase();
            return terms.every((t) => blob.includes(t));
        });
    }
    const channelIds = Array.from(new Set(items.map((video) => video.snippet?.channelId).filter(Boolean)));
    const channelMap = new Map();
    for (let i = 0; i < channelIds.length; i += 50) {
        const chunk = channelIds.slice(i, i + 50);
        const channelData = await fetchYouTubeJson("channels", {
            part: "snippet,statistics",
            id: chunk.join(","),
            maxResults: chunk.length,
        });
        for (const channel of channelData.items || []) {
            channelMap.set(channel.id, channel);
        }
    }
    const nicheContext = "regional trending";
    const built = buildYouTubeRadarVideos(items, channelMap, nicheContext);
    const ordered = orderRadarVideosBySearch(built, order);
    const videos = ordered.slice(0, maxResults);
    const niches = buildYouTubeNiches(videos);
    const qLabel = n.query && String(n.query).trim()
        ? `Regional viral � matching �${String(n.query).trim()}�`
        : "YouTube regional viral (most popular chart)";
    return {
        query: qLabel,
        scanMode: "trending",
        generatedAt: new Date().toISOString(),
        videos,
        niches,
        summary: {
            videoCount: videos.length,
            avgOpportunity: videos.length ? Math.round(videos.reduce((sum, video) => sum + video.opportunityScore, 0) / videos.length) : 0,
            avgViewsPerHour: videos.length ? Math.round(videos.reduce((sum, video) => sum + video.viewsPerHour, 0) / videos.length) : 0,
            bestNiche: niches[0]?.name || "",
            apiMode: "youtube-trending-mostPopular",
        },
    };
}
async function getYouTubeRadar(body) {
    const n = normalizeYouTubeRadarInput(body);
    if (!n.query || !n.query.trim() || n.mode === "trending")
        return getYouTubeTrendingRadar(n);
    return getYouTubeSearchRadar(n);
}
async function getConnectedYouTubeDashboard(account) {
    const channelUrl = new URL("https://www.googleapis.com/youtube/v3/channels");
    channelUrl.searchParams.set("part", "snippet,statistics,contentDetails");
    channelUrl.searchParams.set("id", account.channelId);
    const channelData = await fetchJsonWithAuth(channelUrl, account.accessToken);
    const channel = channelData.items?.[0] || {};
    const uploadsPlaylistId = account.uploadsPlaylistId || channel.contentDetails?.relatedPlaylists?.uploads || "";
    let recentVideos = [];
    if (uploadsPlaylistId) {
        const uploadsUrl = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
        uploadsUrl.searchParams.set("part", "snippet,contentDetails");
        uploadsUrl.searchParams.set("playlistId", uploadsPlaylistId);
        uploadsUrl.searchParams.set("maxResults", "50");
        const uploads = await fetchJsonWithAuth(uploadsUrl, account.accessToken);
        const ids = (uploads.items || []).map((item) => item.contentDetails?.videoId).filter(Boolean);
        if (ids.length) {
            const videosUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
            videosUrl.searchParams.set("part", "snippet,statistics,contentDetails,status");
            videosUrl.searchParams.set("id", ids.join(","));
            const videos = await fetchJsonWithAuth(videosUrl, account.accessToken);
            recentVideos = (videos.items || []).map((video) => ({
                id: video.id,
                url: `https://www.youtube.com/watch?v=${video.id}`,
                title: video.snippet?.title || "Untitled video",
                thumbnailUrl: video.snippet?.thumbnails?.maxres?.url || video.snippet?.thumbnails?.standard?.url || video.snippet?.thumbnails?.high?.url || video.snippet?.thumbnails?.medium?.url || video.snippet?.thumbnails?.default?.url || "",
                publishedAt: video.snippet?.publishedAt || "",
                privacyStatus: video.status?.privacyStatus || "",
                uploadStatus: video.status?.uploadStatus || "",
                embeddable: video.status?.embeddable !== false,
                madeForKids: video.status?.madeForKids === true || video.status?.selfDeclaredMadeForKids === true,
                categoryId: video.snippet?.categoryId || "",
                viewCount: Number(video.statistics?.viewCount || 0),
                likeCount: Number(video.statistics?.likeCount || 0),
                commentCount: Number(video.statistics?.commentCount || 0),
                durationSeconds: isoDurationToSeconds(video.contentDetails?.duration),
            }));
        }
    }
    const stats = channel.statistics || {};
    const totalViews = Number(stats.viewCount || 0);
    const totalVideos = Number(stats.videoCount || 0);
    const totalSubs = Number(stats.subscriberCount || 0);
    const recentViews = recentVideos.reduce((sum, video) => sum + video.viewCount, 0);
    return {
        account: {
            id: account.id,
            email: account.email,
            channelId: account.channelId,
            channelTitle: channel.snippet?.title || account.channelTitle,
            channelHandle: channel.snippet?.customUrl || account.channelHandle || "",
            thumbnailUrl: channel.snippet?.thumbnails?.high?.url || channel.snippet?.thumbnails?.medium?.url || channel.snippet?.thumbnails?.default?.url || account.thumbnailUrl || "",
            uploadsPlaylistId,
            url: `https://www.youtube.com/channel/${account.channelId}`,
        },
        stats: {
            subscriberCount: totalSubs,
            viewCount: totalViews,
            videoCount: totalVideos,
            recentVideoCount: recentVideos.length,
            recentViews,
            averageViewsPerVideo: totalVideos ? Math.round(totalViews / totalVideos) : 0,
        },
        recentVideos,
        publish: {
            studioUploadUrl: "https://studio.youtube.com/channel/UC/videos/upload",
            note: "Direct upload is prepared through OAuth scope. Browser upload UI is the next step; for now this opens YouTube publishing tools for the selected channel.",
        },
    };
}
function safeVideoTags(input) {
    if (Array.isArray(input)) {
        return input.map((tag) => String(tag || "").trim()).filter(Boolean).slice(0, 30);
    }
    return String(input || "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 30);
}
async function updateYouTubeVideoMetadata(account, videoId, input = {}) {
    requireYouTubeScope(account, "https://www.googleapis.com/auth/youtube.force-ssl", "YouTube metadata updates");
    const cleanVideoId = String(videoId || "").trim();
    if (!cleanVideoId)
        throw new Error("Video ID is required");
    const getUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
    getUrl.searchParams.set("part", "snippet");
    getUrl.searchParams.set("id", cleanVideoId);
    const existing = await fetchJsonWithAuth(getUrl, account.accessToken);
    const video = existing.items?.[0];
    if (!video?.snippet)
        throw new Error("YouTube video not found");
    const snippet = video.snippet;
    const payload = {
        id: cleanVideoId,
        snippet: {
            ...snippet,
            title: String(input.title || snippet.title || "Untitled video").trim().slice(0, 100),
            description: String(input.description ?? snippet.description ?? ""),
            tags: safeVideoTags(input.tags?.length ? input.tags : snippet.tags || []),
            categoryId: String(input.categoryId || snippet.categoryId || "22"),
        },
    };
    const updateUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
    updateUrl.searchParams.set("part", "snippet");
    const updated = await fetchGoogleWithAuth(updateUrl, account.accessToken, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    return updated;
}
async function startServer() {
    const app = express();
    const PORT = Number(process.env.PORT) || 3000;
    async function initializeDatabaseAndSchedulers() {
        try {
            await startManagedPostgresIfConfigured();
            await ensureSavedPlaylistSchema();
            if (postgresConfigured())
                console.log("Saved TikTok playlists database ready.");
        }
        catch (error) {
            console.warn("Saved playlist database is not ready:", error instanceof Error ? error.message : error);
        }
        if (postgresConfigured() && process.env.AUTOMATION_SCHEDULER_DISABLED !== "1") {
            setInterval(() => {
                runDueAutomationAgents().catch((error) => console.warn("Automation scheduler failed:", error instanceof Error ? error.message : error));
                captureDueAutomationPerformance().catch((error) => console.warn("Automation performance scheduler failed:", error instanceof Error ? error.message : error));
            }, Math.min(Math.max(Number(process.env.AUTOMATION_POLL_INTERVAL_MS) || 10 * 60 * 1000, 60 * 1000), 60 * 60 * 1000));
        }
    }
    app.use(cors());
    app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "100mb" }));
    app.get("/api/auth/session", async (req, res) => {
        try {
            res.json(await currentAuthPayload(req));
        }
        catch (error) {
            res.status(503).json({ user: null, accounts: [], activeAccount: null, googleConfigured: googleOAuthConfigured(), error: error instanceof Error ? error.message : "Auth unavailable" });
        }
    });
    app.get("/api/auth/google", async (req, res) => {
        if (!googleOAuthConfigured()) {
            return res.status(503).send("Google OAuth is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.");
        }
        const mode = String(req.query.mode || "signin") === "connect" ? "connect" : "signin";
        const next = String(req.query.next || "/channels").startsWith("/") ? String(req.query.next || "/channels") : "/channels";
        const state = makeOAuthState({ mode, next });
        const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID || "");
        url.searchParams.set("redirect_uri", googleRedirectUri(req));
        url.searchParams.set("response_type", "code");
        url.searchParams.set("scope", googleOAuthScopesForMode(mode).join(" "));
        url.searchParams.set("access_type", "offline");
        url.searchParams.set("include_granted_scopes", "true");
        url.searchParams.set("prompt", "consent select_account");
        url.searchParams.set("state", state);
        res.redirect(url.toString());
    });
    app.get("/api/auth/google/callback", async (req, res) => {
        try {
            if (!postgresConfigured())
                throw new Error("Database is required for Google sign-in.");
            const code = String(req.query.code || "");
            if (!code)
                throw new Error(String(req.query.error || "Missing Google authorization code"));
            const state = readOAuthState(String(req.query.state || ""));
            const tokenData = await exchangeGoogleCode(req, code);
            const profile = await fetchGoogleProfile(tokenData.access_token);
            if (!profile.googleSub || !profile.email)
                throw new Error("Google did not return a usable profile.");
            let session = await getSessionRecord(req);
            let user = session?.user || null;
            if (state.mode === "connect" && !user)
                throw new Error("Sign in before connecting a YouTube channel.");
            if (state.mode !== "connect") {
                user = await upsertAuthUser(profile);
                const sessionId = await createAuthSession(user.id);
                setSessionCookie(res, sessionId);
                session = { id: sessionId, user };
            }
            if (state.mode === "connect") {
                const channels = await fetchGoogleYouTubeChannels(tokenData.access_token);
                const saved = await saveYouTubeAccounts(user.id, profile, tokenData, channels);
                if (saved[0]?.id) {
                    await runPsql(`UPDATE auth_sessions SET active_youtube_account_id = ${sqlString(saved[0].id)}, updated_at = now() WHERE id = ${sqlString(session.id)};`);
                }
            }
            res.redirect(state.next || "/channels");
        }
        catch (error) {
            const message = encodeURIComponent(error instanceof Error ? error.message : "Google sign-in failed");
            res.redirect(`/auth/error?message=${message}`);
        }
    });
    app.post("/api/auth/logout", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (session?.id) {
                await runPsql(`DELETE FROM auth_sessions WHERE id = ${sqlString(session.id)};`);
            }
        }
        catch {
            /* logout should still clear the browser cookie */
        }
        clearSessionCookie(res);
        res.json({ ok: true });
    });
    app.post("/api/youtube/accounts/:id/select", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            const account = await getYouTubeAccount(session.user.id, req.params.id);
            if (!account)
                return res.status(404).json({ error: "YouTube account not found" });
            await runPsql(`UPDATE auth_sessions SET active_youtube_account_id = ${sqlString(account.id)}, updated_at = now() WHERE id = ${sqlString(session.id)};`);
            res.json(await currentAuthPayload(req));
        }
        catch (error) {
            res.status(500).json({ error: error instanceof Error ? error.message : "Could not switch account" });
        }
    });
    app.delete("/api/youtube/accounts/:id", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            await runPsql(`DELETE FROM youtube_accounts WHERE id = ${sqlString(req.params.id)} AND user_id = ${sqlString(session.user.id)};`);
            res.json(await currentAuthPayload(req));
        }
        catch (error) {
            res.status(500).json({ error: error instanceof Error ? error.message : "Could not disconnect account" });
        }
    });
    app.get("/api/youtube/channel/dashboard", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            const accountId = String(req.query.accountId || session.activeYoutubeAccountId || "");
            if (!accountId)
                return res.status(404).json({ error: "Connect a YouTube channel first" });
            const account = await usableYouTubeAccount(session.user.id, accountId);
            res.json(await getConnectedYouTubeDashboard(account));
        }
        catch (error) {
            res.status(500).json({ error: error instanceof Error ? error.message : "YouTube dashboard unavailable" });
        }
    });
    app.patch("/api/youtube/videos/:id/metadata", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            const accountId = String(req.query.accountId || req.body?.accountId || session.activeYoutubeAccountId || "");
            if (!accountId)
                return res.status(404).json({ error: "Connect a YouTube channel first" });
            const account = await usableYouTubeAccount(session.user.id, accountId);
            const video = await updateYouTubeVideoMetadata(account, req.params.id, req.body || {});
            res.json({ video });
        }
        catch (error) {
            const status = Number(error?.statusCode || 500);
            res.status(status >= 400 && status < 600 ? status : 500).json({ error: error instanceof Error ? error.message : "Could not update video" });
        }
    });
    app.get("/api/youtube/playlists", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            const accountId = String(req.query.accountId || session.activeYoutubeAccountId || "");
            if (!accountId)
                return res.status(404).json({ error: "Connect a YouTube channel first" });
            const account = await usableYouTubeAccount(session.user.id, accountId);
            res.json({ playlists: await listYouTubePlaylists(account) });
        }
        catch (error) {
            const status = Number(error?.statusCode || 500);
            res.status(status >= 400 && status < 600 ? status : 500).json({ error: error instanceof Error ? error.message : "YouTube playlists unavailable" });
        }
    });
    app.post("/api/youtube/playlists", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            const accountId = String(req.query.accountId || req.body?.accountId || session.activeYoutubeAccountId || "");
            if (!accountId)
                return res.status(404).json({ error: "Connect a YouTube channel first" });
            const account = await usableYouTubeAccount(session.user.id, accountId);
            const playlist = await createYouTubePlaylist(account, {
                title: req.body?.title,
                description: req.body?.description,
                privacyStatus: req.body?.privacyStatus,
            });
            res.json({ playlist });
        }
        catch (error) {
            const status = Number(error?.statusCode || 500);
            res.status(status >= 400 && status < 600 ? status : 500).json({ error: error instanceof Error ? error.message : "Could not create playlist" });
        }
    });
    app.post("/api/youtube/playlists/:playlistId/items", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            const accountId = String(req.query.accountId || req.body?.accountId || session.activeYoutubeAccountId || "");
            if (!accountId)
                return res.status(404).json({ error: "Connect a YouTube channel first" });
            const account = await usableYouTubeAccount(session.user.id, accountId);
            const item = await addVideoToYouTubePlaylist(account, req.params.playlistId, req.body?.videoId);
            res.json({ item });
        }
        catch (error) {
            const status = Number(error?.statusCode || 500);
            res.status(status >= 400 && status < 600 ? status : 500).json({ error: error instanceof Error ? error.message : "Could not update playlist" });
        }
    });
    app.post("/api/youtube/videos/upload", express.raw({ type: ["application/octet-stream", "video/*"], limit: process.env.YOUTUBE_UPLOAD_LIMIT || "512mb" }), async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            const accountId = String(req.query.accountId || session.activeYoutubeAccountId || "");
            if (!accountId)
                return res.status(404).json({ error: "Connect a YouTube channel first" });
            const title = String(req.query.title || "").trim();
            if (!title)
                return res.status(400).json({ error: "Video title is required" });
            const account = await usableYouTubeAccount(session.user.id, accountId);
            const result = await uploadYouTubeVideo(account, {
                title,
                description: String(req.query.description || ""),
                tags: safeYouTubeTags(req.query.tags),
                privacyStatus: safePrivacyStatus(req.query.privacyStatus),
                categoryId: String(req.query.categoryId || "22"),
                madeForKids: String(req.query.madeForKids || "false") === "true",
            }, req.body, String(req.headers["content-type"] || "application/octet-stream"));
            let playlistItem = null;
            const playlistId = String(req.query.playlistId || "").trim();
            const createPlaylistTitle = String(req.query.createPlaylistTitle || "").trim();
            let targetPlaylistId = playlistId;
            if (!targetPlaylistId && createPlaylistTitle) {
                const created = await createYouTubePlaylist(account, {
                    title: createPlaylistTitle,
                    description: "Uploads created from AutoYT.",
                    privacyStatus: safePrivacyStatus(req.query.playlistPrivacyStatus || "public"),
                });
                targetPlaylistId = created.id;
            }
            if (targetPlaylistId && result.id) {
                playlistItem = await addVideoToYouTubePlaylist(account, targetPlaylistId, result.id);
            }
            res.json({ video: { ...result, playlistItem } });
        }
        catch (error) {
            const status = Number(error?.statusCode || 500);
            res.status(status >= 400 && status < 600 ? status : 500).json({ error: error instanceof Error ? error.message : "Could not upload video" });
        }
    });
    app.post("/api/compilations/create", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            if (!req.body?.rightsConfirmed)
                return res.status(400).json({ error: "Confirm that you have rights to compile and upload the selected clips." });
            const job = createCompilationJob(session.user.id, req.body || {});
            res.status(202).json({ job: publicCompilationJob(job) });
        }
        catch (error) {
            const status = Number(error?.statusCode || 500);
            res.status(status >= 400 && status < 600 ? status : 500).json({ error: error instanceof Error ? error.message : "Could not create compilation" });
        }
    });
    app.get("/api/compilations/jobs/:id", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            cleanupCompilationJobs();
            const job = loadCompilationJob(req.params.id);
            if (!job || job.userId !== session.user.id)
                return res.status(404).json({ error: "Compilation job not found" });
            const runningAgeMs = Date.now() - Number(job.updatedAt || job.createdAt || Date.now());
            if (job.status === "running" && ((job.workerPid && !isProcessAlive(job.workerPid)) || (!job.workerPid && runningAgeMs > 2 * 60 * 1000))) {
                job.status = "error";
                job.message = "Compilation worker stopped";
                job.error = "Compilation worker stopped before finishing. Try again with fewer clips, or move compilation to a VPS for more reliable video processing.";
                job.updatedAt = Date.now();
                saveCompilationJob(job);
            }
            res.json({ job: publicCompilationJob(job) });
        }
        catch (error) {
            const status = Number(error?.statusCode || 500);
            res.status(status >= 400 && status < 600 ? status : 500).json({ error: error instanceof Error ? error.message : "Could not load compilation job" });
        }
    });
    app.get("/api/youtube/videos/:id/analytics", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            const accountId = String(req.query.accountId || session.activeYoutubeAccountId || "");
            if (!accountId)
                return res.status(404).json({ error: "Connect a YouTube channel first" });
            const account = await usableYouTubeAccount(session.user.id, accountId);
            res.json(await getYouTubeVideoAnalytics(account, req.params.id, Number(req.query.days || 28)));
        }
        catch (error) {
            const status = Number(error?.statusCode || 500);
            res.status(status >= 400 && status < 600 ? status : 500).json({ error: error instanceof Error ? error.message : "Video analytics unavailable" });
        }
    });
    app.get("/api/youtube/videos/:id/comments", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            const accountId = String(req.query.accountId || session.activeYoutubeAccountId || "");
            if (!accountId)
                return res.status(404).json({ error: "Connect a YouTube channel first" });
            const account = await usableYouTubeAccount(session.user.id, accountId);
            res.json(await getYouTubeVideoComments(account, req.params.id, Number(req.query.maxResults || 20), String(req.query.pageToken || "")));
        }
        catch (error) {
            const status = Number(error?.statusCode || 500);
            res.status(status >= 400 && status < 600 ? status : 500).json({ error: error instanceof Error ? error.message : "Video comments unavailable" });
        }
    });
    app.post("/api/youtube/comments/:id/reply", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            const accountId = String(req.query.accountId || session.activeYoutubeAccountId || "");
            if (!accountId)
                return res.status(404).json({ error: "Connect a YouTube channel first" });
            const account = await usableYouTubeAccount(session.user.id, accountId);
            const reply = await replyToYouTubeComment(account, req.params.id, req.body?.text);
            res.json({ reply });
        }
        catch (error) {
            const status = Number(error?.statusCode || 500);
            res.status(status >= 400 && status < 600 ? status : 500).json({ error: error instanceof Error ? error.message : "Could not reply to comment" });
        }
    });
    app.post("/api/youtube/channel/comment-agent/run", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            const accountId = String(req.query.accountId || req.body?.accountId || session.activeYoutubeAccountId || "");
            if (!accountId)
                return res.status(404).json({ error: "Connect a YouTube channel first" });
            res.json(await runChannelCommentReplyAgent(session.user.id, accountId, req.body || {}));
        }
        catch (error) {
            const status = Number(error?.statusCode || 500);
            res.status(status >= 400 && status < 600 ? status : 500).json({ error: error instanceof Error ? error.message : "Channel comment reply agent failed" });
        }
    });
    app.get("/api/automation/options", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            const accounts = await listYouTubeAccounts(session.user.id);
            const playlists = await listSavedPlaylistRecords(session.user.id);
            res.json({
                accounts,
                sources: playlists.map(savedPlaylistSummaryFromRecord),
            });
        }
        catch (error) {
            res.status(503).json({ error: error instanceof Error ? error.message : "Automation options unavailable" });
        }
    });
    app.get("/api/automation/agents", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            res.json({ agents: await listAutomationAgents(session.user.id) });
        }
        catch (error) {
            res.status(503).json({ error: error instanceof Error ? error.message : "Automation agents unavailable" });
        }
    });
    app.post("/api/automation/agents", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            const agent = await upsertAutomationAgent(session.user.id, normalizeAutomationAgentPayload(req.body || {}));
            res.json({ agent });
        }
        catch (error) {
            const status = Number(error?.statusCode || 400);
            res.status(status >= 400 && status < 600 ? status : 400).json({ error: error instanceof Error ? error.message : "Could not save automation agent" });
        }
    });
    app.get("/api/automation/agents/:id", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            const agent = await getAutomationAgent(session.user.id, req.params.id);
            if (!agent)
                return res.status(404).json({ error: "Automation agent not found" });
            res.json({
                agent,
                runs: await listAutomationRuns(agent.id),
                uploads: await listAutomationUploads(agent.id),
            });
        }
        catch (error) {
            res.status(503).json({ error: error instanceof Error ? error.message : "Automation agent unavailable" });
        }
    });
    app.post("/api/automation/agents/:id/run", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            if (activeAutomationRuns.has(req.params.id))
                return res.status(409).json({ error: "This agent is already running." });
            activeAutomationRuns.add(req.params.id);
            try {
                const result = await runAutomationAgentOnce(session.user.id, req.params.id);
                res.json({ result });
            }
            finally {
                activeAutomationRuns.delete(req.params.id);
            }
        }
        catch (error) {
            const status = Number(error?.statusCode || 500);
            res.status(status >= 400 && status < 600 ? status : 500).json({ error: error instanceof Error ? error.message : "Automation run failed" });
        }
    });
    app.post("/api/automation/agents/:id/run-compilation", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            if (activeAutomationRuns.has(req.params.id))
                return res.status(409).json({ error: "This agent is already running." });
            activeAutomationRuns.add(req.params.id);
            try {
                const result = await runAutomationCompilationOnce(session.user.id, req.params.id, req.body || {});
                res.json({ result });
            }
            finally {
                activeAutomationRuns.delete(req.params.id);
            }
        }
        catch (error) {
            const status = Number(error?.statusCode || 500);
            res.status(status >= 400 && status < 600 ? status : 500).json({ error: error instanceof Error ? error.message : "Compilation run failed" });
        }
    });
    app.delete("/api/automation/agents/:id", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            const agent = await getAutomationAgent(session.user.id, req.params.id);
            if (!agent)
                return res.status(404).json({ error: "Automation agent not found" });
            if (activeAutomationRuns.has(agent.id))
                return res.status(409).json({ error: "This agent is running. Wait for the run to finish before deleting it." });
            const deletedId = await deleteAutomationAgent(session.user.id, agent.id);
            if (!deletedId)
                return res.status(404).json({ error: "Automation agent not found" });
            activeAutomationRuns.delete(deletedId);
            res.json({ ok: true, id: deletedId });
        }
        catch (error) {
            const status = Number(error?.statusCode || 500);
            res.status(status >= 400 && status < 600 ? status : 500).json({ error: error instanceof Error ? error.message : "Could not delete automation agent" });
        }
    });
    app.post("/api/automation/agents/:id/delete", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            const agent = await getAutomationAgent(session.user.id, req.params.id);
            if (!agent)
                return res.status(404).json({ error: "Automation agent not found" });
            if (activeAutomationRuns.has(agent.id))
                return res.status(409).json({ error: "This agent is running. Wait for the run to finish before deleting it." });
            const deletedId = await deleteAutomationAgent(session.user.id, agent.id);
            if (!deletedId)
                return res.status(404).json({ error: "Automation agent not found" });
            activeAutomationRuns.delete(deletedId);
            res.json({ ok: true, id: deletedId });
        }
        catch (error) {
            const status = Number(error?.statusCode || 500);
            res.status(status >= 400 && status < 600 ? status : 500).json({ error: error instanceof Error ? error.message : "Could not delete automation agent" });
        }
    });
    app.post("/api/automation/uploads/:id/reupload", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            const result = await reuploadAutomationUpload(session.user.id, req.params.id);
            res.json({ result });
        }
        catch (error) {
            const status = Number(error?.statusCode || 500);
            res.status(status >= 400 && status < 600 ? status : 500).json({ error: error instanceof Error ? error.message : "HD test reupload failed" });
        }
    });
    app.post("/api/automation/performance/check", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            await captureDueAutomationPerformance();
            res.json({ ok: true });
        }
        catch (error) {
            res.status(500).json({ error: error instanceof Error ? error.message : "Performance check failed" });
        }
    });
    app.post("/api/tiktok/list", async (req, res) => {
        const session = await getSessionRecord(req);
        if (!session?.user)
            return res.status(401).json({ error: "Sign in required" });
        const { url, count, seedVideoUrl, forceNetwork } = req.body;
        if (!url || typeof url !== "string") {
            return res.status(400).json({ error: "URL is required" });
        }
        const maxList = Math.min(Math.max(Number(process.env.TIKTOK_LIST_MAX) || 5000, 1), 10000);
        const n = Math.min(Math.max(Number(count) || 30, 1), maxList);
        let seed = typeof seedVideoUrl === "string" ? seedVideoUrl.trim() : "";
        try {
            const cached = await savedPlaylistFallbackForTikTokUrl(session.user.id, url.trim(), n).catch(() => null);
            if (!seed && cached?.videos?.length)
                seed = tikTokSeedVideoUrlFromPlaylist(cached);
            if (!forceNetwork && /tiktok\.com\/@[^/?#]+\/collection(?:[/?#]|$)/i.test(url) && !/\/collection\/\d/i.test(url)) {
                if (cached?.videos?.length) {
                    res.json(cached);
                    return;
                }
            }
            const playlist = await runTikTokListScript(url.trim(), n, seed);
            const normalizedPlaylist = normalizeTikTokPlaylistForStorage(playlist);
            if (normalizedPlaylist?.videos?.length) {
                await saveTikTokPlaylistToDb(session.user.id, url.trim(), normalizedPlaylist, url.trim()).catch((error) => {
                    console.error("TikTok auto-save error:", error);
                });
            }
            res.json(normalizedPlaylist);
        }
        catch (e) {
            console.error("TikTok list error:", e);
            const cached = await savedPlaylistFallbackForTikTokUrl(session.user.id, url.trim(), n).catch(() => null);
            if (cached?.videos?.length) {
                res.json({
                    ...cached,
                    stale: true,
                    warning: e instanceof Error ? e.message : "TikTok refresh failed; showing saved playlist cache.",
                });
                return;
            }
            const message = e instanceof Error ? e.message : "TikTok listing failed";
            res.status(500).json({ error: message });
        }
    });
    app.get("/api/saved/tiktok-playlists", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            const records = await listSavedPlaylistRecords(session.user.id);
            res.json({ summaries: records.map(savedPlaylistSummaryFromRecord) });
        }
        catch (error) {
            res.status(503).json({ error: error instanceof Error ? error.message : "Saved playlist database unavailable" });
        }
    });
    app.get("/api/saved/tiktok-playlists/by-url", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            const rawUrl = typeof req.query.url === "string" ? req.query.url : "";
            const record = await getSavedPlaylistRecordByKey(session.user.id, rawUrl);
            res.json({ record });
        }
        catch (error) {
            res.status(503).json({ error: error instanceof Error ? error.message : "Saved playlist database unavailable" });
        }
    });
    app.get("/api/saved/tiktok-playlists/by-slug/:slug", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            const record = await getSavedPlaylistRecordBySlug(session.user.id, req.params.slug);
            res.json({ record });
        }
        catch (error) {
            res.status(503).json({ error: error instanceof Error ? error.message : "Saved playlist database unavailable" });
        }
    });
    app.get("/api/saved/tiktok-posts/:slug", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            const wanted = slugifySavedPlaylistTitle(req.params.slug);
            const records = await listSavedPlaylistRecords(session.user.id);
            for (const record of records) {
                const videos = record?.playlist?.videos || [];
                const videoIndex = videos.findIndex((video) => slugifySavedPost(video) === wanted);
                if (videoIndex >= 0) {
                    res.json({ found: { record, videoIndex } });
                    return;
                }
            }
            res.json({ found: null });
        }
        catch (error) {
            res.status(503).json({ error: error instanceof Error ? error.message : "Saved playlist database unavailable" });
        }
    });
    app.post("/api/saved/tiktok-playlists", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            const { rawUrl, playlist, analyzedUrl } = req.body || {};
            const record = await saveTikTokPlaylistToDb(session.user.id, rawUrl, playlist, analyzedUrl);
            res.json({ record, summary: savedPlaylistSummaryFromRecord(record) });
        }
        catch (error) {
            res.status(503).json({ error: error instanceof Error ? error.message : "Could not save playlist" });
        }
    });
    app.delete("/api/saved/tiktok-playlists", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            const key = typeof req.query.key === "string" ? req.query.key : "";
            await deleteSavedPlaylistFromDb(session.user.id, key);
            res.json({ ok: true });
        }
        catch (error) {
            res.status(503).json({ error: error instanceof Error ? error.message : "Could not remove playlist" });
        }
    });
    app.get("/api/niches", async (_req, res) => {
        try {
            const niches = await listNicheLibraryEntries();
            const hierarchy = buildNicheHierarchy(niches);
            res.json({
                niches,
                hierarchy,
                summary: {
                    count: niches.length,
                    macroCount: new Set(niches.map((n) => n.macroNiche)).size,
                    subNicheCount: new Set(niches.map((n) => `${n.macroNiche}::${n.subNiche}`)).size,
                    tierOneCount: niches.filter((n) => String(n.geoTier || "").includes("Tier 1")).length,
                    sourceRefs: ["user-pdf-2026", "user-docx-2026", "vidiq-2026", "nextglobalwave-2026", "packapop-2026", "imf-2026"],
                },
            });
        }
        catch (error) {
            const fallback = loadNicheSeedEntries();
            const hierarchy = buildNicheHierarchy(fallback);
            res.json({
                niches: fallback,
                hierarchy,
                summary: {
                    count: fallback.length,
                    macroCount: new Set(fallback.map((n) => n.macroNiche)).size,
                    subNicheCount: new Set(fallback.map((n) => `${n.macroNiche}::${n.subNiche}`)).size,
                    tierOneCount: fallback.filter((n) => String(n.geoTier || "").includes("Tier 1")).length,
                    sourceRefs: ["seed-fallback"],
                },
                warning: error instanceof Error ? error.message : "Niche database unavailable",
            });
        }
    });
    app.post("/api/youtube/radar", async (req, res) => {
        try {
            const q = req.query || {};
            const body = (req.body && typeof req.body === "object" && !Array.isArray(req.body) ? { ...req.body } : {});
            if (q.trending === "1" || String(q.trending).toLowerCase() === "true")
                body.trending = true;
            const radar = await getYouTubeRadar(body);
            res.json(radar);
        }
        catch (error) {
            console.error("YouTube radar error:", error);
            res.status(500).json({
                error: error instanceof Error ? error.message : "YouTube radar scan failed",
            });
        }
    });
    app.post("/api/movie/identify-link", async (req, res) => {
        const rawUrl = String(req.body?.url || "").trim();
        if (!rawUrl)
            return res.status(400).json({ error: "URL is required" });
        if (!/^https?:\/\//i.test(rawUrl))
            return res.status(400).json({ error: "Use a full http or https video URL." });
        const cacheLookup = movieCacheLookupFromUrl(rawUrl);
        const cached = await getCachedMovieIdentification(cacheLookup).catch(() => null);
        if (cached) {
            res.json({ result: cached, downloader: "movie-cache", size: 0, cached: true });
            return;
        }
        const tempFile = makeLinkAnalysisVideoPath();
        try {
            let downloader = "yt-dlp";
            if (/tiktok\.com/i.test(rawUrl)) {
                const candidateUrls = Array.isArray(req.body?.candidateUrls) ? req.body.candidateUrls : [];
                downloader = await runTikTokDownload(rawUrl, tempFile, candidateUrls);
            }
            else {
                downloader = await runYtDlpSocialDownload(rawUrl, tempFile);
            }
            const downloadedFile = resolveDownloadedOutput(tempFile);
            const stat = fs.statSync(downloadedFile);
            const maxBytes = tikTokDownloadMaxBytes();
            if (stat.size > maxBytes) {
                throw new Error(`Downloaded video is too large (${Math.round(stat.size / 1024 / 1024)}MB; limit ${Math.round(maxBytes / 1024 / 1024)}MB).`);
            }
            const result = await identifyMovieFromVideoFile(downloadedFile, "video/mp4", cacheLookup);
            res.json({ result, downloader, size: stat.size });
        }
        catch (error) {
            console.error("Movie link analysis error:", error);
            res.status(500).json({
                error: "Could not identify movie from link.",
                details: error instanceof Error ? error.message : String(error),
            });
        }
        finally {
            try {
                cleanupDownloadArtifacts(tempFile);
            }
            catch {
                /* best-effort cleanup */
            }
        }
    });
    // API Route: TikTok Download & Proxy
    app.post("/api/tiktok/process", async (req, res) => {
        const { url } = req.body;
        if (!url)
            return res.status(400).json({ error: "URL is required" });
        console.log(`Processing TikTok URL: ${url}`);
        const tempFile = makeTikTokVideoCachePath();
        try {
            const candidateUrls = Array.isArray(req.body?.candidateUrls) ? req.body.candidateUrls : [];
            const downloader = await runTikTokDownload(String(url).trim(), tempFile, candidateUrls);
            console.log(`Video downloaded to ${tempFile} via ${downloader}`);
            const stat = fs.statSync(tempFile);
            const dimensions = await probeVideoDimensions(tempFile);
            if (req.body?.returnBase64 === true) {
                const videoData = fs.readFileSync(tempFile);
                const base64Video = videoData.toString("base64");
                fs.unlinkSync(tempFile);
                res.json({
                    success: true,
                    base64: base64Video,
                    mimeType: "video/mp4",
                    downloader,
                    width: dimensions?.width || 0,
                    height: dimensions?.height || 0,
                });
                return;
            }
            res.json({
                success: true,
                videoUrl: `/api/tiktok/video/${path.basename(tempFile)}`,
                mimeType: "video/mp4",
                downloader,
                size: stat.size,
                width: dimensions?.width || 0,
                height: dimensions?.height || 0,
            });
        }
        catch (error) {
            console.error("TikTok download error:", error);
            try {
                if (fs.existsSync(tempFile))
                    fs.unlinkSync(tempFile);
            }
            catch {
                /* best-effort cleanup */
            }
            res.status(500).json({
                error: "Failed to download TikTok video.",
                details: error instanceof Error ? error.message : String(error),
            });
        }
    });
    app.post("/api/tiktok/probe-dimensions", async (req, res) => {
        try {
            const videos = Array.isArray(req.body?.videos) ? req.body.videos.slice(0, tiktokDimensionProbeLimit()) : [];
            const probeOne = async (video) => {
                const key = String(video?.key || video?.id || normalizeTikTokProbeUrl(video)).trim();
                const id = String(video?.id || "").trim();
                const existingWidth = Math.round(Number(video?.width || 0));
                const existingHeight = Math.round(Number(video?.height || 0));
                const existingDuration = Math.round(Number(video?.durationSeconds || video?.duration || 0));
                if (existingWidth > 0 && existingHeight > 0) {
                    return { key, id, width: existingWidth, height: existingHeight, durationSeconds: existingDuration };
                }
                const probeUrl = normalizeTikTokProbeUrl(video);
                if (!probeUrl) {
                    return { key, id, width: 0, height: 0, durationSeconds: existingDuration, error: "No probe URL" };
                }
                try {
                    const meta = await runYtDlpDumpJson(probeUrl);
                    const dimensions = extractTikTokVideoProbe(meta);
                    return {
                        key,
                        id: id || String(meta?.id || ""),
                        width: dimensions.width,
                        height: dimensions.height,
                        durationSeconds: dimensions.durationSeconds || existingDuration,
                    };
                }
                catch (error) {
                    return {
                        key,
                        id,
                        width: 0,
                        height: 0,
                        durationSeconds: existingDuration,
                        error: cleanYtDlpMessage(error instanceof Error ? error.message : String(error)),
                    };
                }
            };
            const results = new Array(videos.length);
            const concurrency = Math.min(Math.max(Number(process.env.TIKTOK_DIMENSION_PROBE_CONCURRENCY) || 3, 1), 5);
            let index = 0;
            await Promise.all(Array.from({ length: Math.min(concurrency, videos.length) }, async () => {
                while (index < videos.length) {
                    const current = index;
                    index += 1;
                    results[current] = await probeOne(videos[current]);
                }
            }));
            res.json({ results });
        }
        catch (error) {
            res.status(500).json({ error: error instanceof Error ? error.message : "Could not probe TikTok metadata" });
        }
    });
    app.get("/api/compilations/download/:name", (req, res) => {
        cleanupCompilationDownloads();
        const name = String(req.params.name || "");
        if (!isCompilationDownloadName(name)) {
            return res.status(404).json({ error: "Compilation not found" });
        }
        const filePath = path.join(compilationDownloadDir(), name);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: "Compilation expired" });
        }
        res.setHeader("Content-Type", "video/mp4");
        res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
        res.setHeader("Cache-Control", "private, max-age=600");
        res.sendFile(filePath);
    });
    app.get("/api/tiktok/video/:name", (req, res) => {
        cleanupTikTokVideoCache();
        const name = String(req.params.name || "");
        if (!isTikTokVideoCacheName(name)) {
            return res.status(404).json({ error: "Video not found" });
        }
        const filePath = path.join(tiktokVideoCacheDir(), name);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: "Video expired" });
        }
        res.setHeader("Content-Type", "video/mp4");
        res.setHeader("Cache-Control", "private, max-age=600");
        res.sendFile(filePath);
    });
    app.get("/api/movie/poster", async (req, res) => {
        const title = typeof req.query.title === "string" ? req.query.title.trim() : "";
        const year = typeof req.query.year === "string" ? req.query.year.trim() : "";
        if (!title)
            return res.status(400).json({ error: "title is required" });
        try {
            const cached = await getCachedMovieIdentification({ detectedTitle: title, detectedYear: year }).catch(() => null);
            if (cached?.posterUrl || cached?.tmdb?.tmdbUrl || cached?.mal?.url) {
                res.json({
                    posterUrl: cached.posterUrl || cached.mal?.imageUrl || "",
                    backdropUrl: cached.tmdb?.backdropUrl || "",
                    tmdbUrl: cached.tmdb?.tmdbUrl || "",
                    imdbUrl: cached.imdbUrl || "",
                    id: cached.tmdb?.id || cached.mal?.id || "",
                    mediaType: cached.tmdb?.mediaType || cached.mal?.type || cached.mediaType || "",
                    title: cached.title || title,
                    originalTitle: cached.tmdb?.originalTitle || "",
                    overview: cached.tmdb?.overview || cached.summary || "",
                    tagline: cached.tmdb?.tagline || "",
                    releaseDate: cached.tmdb?.releaseDate || "",
                    runtime: cached.tmdb?.runtime || null,
                    genres: cached.tmdb?.genres || (cached.genre ? [cached.genre] : []),
                    rating: cached.tmdb?.rating || null,
                    voteCount: cached.tmdb?.voteCount || 0,
                    status: cached.tmdb?.status || "",
                    language: cached.tmdb?.language || "",
                    countries: [],
                    director: cached.tmdb?.director || cached.director || "",
                    cast: cached.tmdb?.cast || [],
                    cached: true,
                });
                return;
            }
            const data = await fetchTmdbJson("search/multi", {
                query: title,
                include_adult: "false",
            });
            const match = chooseTmdbTitle(data.results || [], title, year);
            if (!match?.poster_path || (match.media_type !== "movie" && match.media_type !== "tv")) {
                return res.json({ posterUrl: "", tmdbUrl: "", title, notFound: true });
            }
            const mediaType = match.media_type;
            const details = await fetchTmdbJson(`${mediaType}/${match.id}`, {
                append_to_response: "credits,external_ids",
            });
            const imdbId = details.external_ids?.imdb_id || "";
            const director = mediaType === "movie"
                ? details.credits?.crew?.find((person) => person.job === "Director")?.name || ""
                : details.created_by?.map((person) => person.name).filter(Boolean).join(", ") || "";
            const resolvedTitle = details.title || details.name || match.title || match.name || title;
            const releaseDate = details.release_date || details.first_air_date || match.release_date || match.first_air_date || "";
            const response = {
                posterUrl: tmdbImage(details.poster_path || match.poster_path, "w500"),
                backdropUrl: tmdbImage(details.backdrop_path, "w1280"),
                tmdbUrl: `https://www.themoviedb.org/${mediaType}/${match.id}`,
                imdbUrl: imdbId ? `https://www.imdb.com/title/${imdbId}/` : "",
                id: details.id || match.id,
                mediaType,
                title: resolvedTitle,
                originalTitle: details.original_title || details.original_name || "",
                overview: details.overview || "",
                tagline: details.tagline || "",
                releaseDate,
                runtime: details.runtime || details.episode_run_time?.[0] || null,
                genres: (details.genres || []).map((genre) => genre.name).filter(Boolean),
                rating: typeof details.vote_average === "number" ? details.vote_average : null,
                voteCount: details.vote_count || 0,
                status: details.status || "",
                language: details.original_language || "",
                countries: mediaType === "movie"
                    ? (details.production_countries || []).map((country) => country.name).filter(Boolean)
                    : details.origin_country || [],
                director,
                cast: (details.credits?.cast || [])
                    .sort((a, b) => (a.order || 0) - (b.order || 0))
                    .slice(0, 8)
                    .map((person) => ({
                    name: person.name || "",
                    character: person.character || "",
                    profileUrl: tmdbImage(person.profile_path, "w185"),
                }))
                    .filter((person) => person.name),
            };
            await storeMovieIdentificationCache({ detectedTitle: title, detectedYear: year }, {
                title: resolvedTitle,
                year: releaseDate.slice(0, 4) || year,
                mediaType,
                genre: response.genres[0] || "",
                confidence: 1,
                posterUrl: response.posterUrl,
                imdbUrl: response.imdbUrl,
                summary: response.overview,
                tmdb: {
                    id: response.id,
                    mediaType,
                    title: resolvedTitle,
                    originalTitle: response.originalTitle,
                    overview: response.overview,
                    tagline: response.tagline,
                    genres: response.genres,
                    releaseDate: response.releaseDate,
                    runtime: response.runtime,
                    rating: response.rating,
                    voteCount: response.voteCount,
                    status: response.status,
                    language: response.language,
                    tmdbUrl: response.tmdbUrl,
                    backdropUrl: response.backdropUrl,
                    director: response.director,
                    cast: response.cast,
                },
            }).catch(() => null);
            res.json(response);
        }
        catch (error) {
            console.error("TMDB poster error:", error);
            res.json({
                posterUrl: "",
                tmdbUrl: "",
                title,
                notFound: true,
                warning: error instanceof Error ? error.message : "TMDB poster lookup failed",
            });
        }
    });
    app.use("/api", (req, res) => {
        res.status(404).json({ error: `API route not found: ${req.method} ${req.originalUrl}` });
    });
    const distIndexPath = path.join(__dirname, "dist", "index.html");
    const useViteDevServer = process.env.VITE_DEV_SERVER === "1" || (process.env.NODE_ENV !== "production" && !fs.existsSync(distIndexPath));
    if (useViteDevServer) {
        const vite = await createViteServer({
            server: { middlewareMode: true },
            appType: "spa",
        });
        const serveDevIndex = async (req, res, next) => {
            try {
                const indexPath = path.join(__dirname, "index.html");
                const rawHtml = fs.readFileSync(indexPath, "utf8");
                const html = await vite.transformIndexHtml(req.originalUrl, rawHtml);
                res.status(200).set({ "Content-Type": "text/html" }).end(html);
            }
            catch (error) {
                vite.ssrFixStacktrace(error);
                next(error);
            }
        };
        app.get("/", serveDevIndex);
        app.get("/playlist/:slug", serveDevIndex);
        app.get("/channel/:slug", serveDevIndex);
        app.get("/post/:slug", serveDevIndex);
        app.get("/youtube", serveDevIndex);
        app.get("/niches", serveDevIndex);
        app.get("/niches/:slug", serveDevIndex);
        app.get("/niches/:top/:sub", serveDevIndex);
        app.get("/niches/:top/:sub/:msn", serveDevIndex);
        app.get("/channels", serveDevIndex);
        app.get("/publish", serveDevIndex);
        app.get("/automation", serveDevIndex);
        app.get("/automation/:slug", serveDevIndex);
        app.get("/auth/error", serveDevIndex);
        app.use(vite.middlewares);
    }
    else {
        app.use(express.static(path.join(__dirname, "dist")));
        app.get("*", (req, res) => {
            res.sendFile(distIndexPath);
        });
    }
    app.listen(PORT, "0.0.0.0", () => {
        console.log(`Server running on http://localhost:${PORT}`);
        void initializeDatabaseAndSchedulers();
    });
}
if (process.argv[2] === "--compilation-worker") {
    runCompilationWorker(process.argv[3])
        .then(() => process.exit(0))
        .catch((error) => {
        console.error(error instanceof Error ? error.stack || error.message : error);
        process.exit(1);
    });
}
else {
    startServer();
}
