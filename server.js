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
import dns from "dns";
import { GoogleGenAI, Type } from "@google/genai";
import { asksForMovieName as policyAsksForMovieName, classifyCommentReply, contentNameReply, sourceTitleSafeForPublicReply, sourceTitleVerifiedForPublicReply } from "./src/utils/commentPolicy.js";
import { preferEnglishAnimeResultTitle, preferredMalDisplayTitle } from "./src/utils/movieTitlePolicy.js";
import { recoverCompactMovieIdJson } from "./src/utils/movieIdJsonRecovery.js";
import { movieIdShouldUseQwenFallback, qwenMovieIdNeedsCompactLocalVideo, qwenMovieIdVideoReference } from "./src/utils/movieIdProviderPolicy.js";
import { buildAutomationMovieIdFallback } from "./src/utils/automationMovieIdFallback.js";
import { findMovieTitleFromCommentThreads } from "./src/utils/movieCommentHints.js";
import { inferTitleFromCommentCorpus } from "./src/utils/commentTmdbInference.js";
import { capUnverifiedMovieIdResult, databaseSummaryCandidate, databaseSummaryCandidates, movieIdResultMayBeCached, verifiedMovieIdResult } from "./src/utils/movieIdVerification.js";
import { channelVideoKindMatches, normalizeChannelVideoKind, shouldContinueChannelVideoBucket } from "./src/utils/channelVideoBuckets.js";
import { genreMembershipFromMovieResult, genreMembershipFromStoryResult, groupSavedPlaylistGenreMemberships, mergeSavedPlaylistGenreMemberships, pendingSavedPlaylistGenreVideos, savedPlaylistGenreScanSummary } from "./src/utils/savedPlaylistGenres.js";
import { attachMovieIdentificationSource } from "./src/utils/movieIdentificationSource.js";
import { applyCachedTikTokCover, freshTikTokCover as freshTikTokCoverValue, isExpiredTikTokSignedCoverUrl, isLocalTikTokCoverUrl, tiktokCoverSourceUrl } from "./src/utils/tiktokCoverCache.js";
import { automationSourceKeyForVideo, automationVideoPlatform, automationVideoSourceUrl, isDirectChannelSourceUrl, normalizeAutomationSourceVideo, savedSourcePlatformFromUrl } from "./src/utils/automationSourceVideo.js";
import { availableStaggeredAutomationRunAt, sameDayCatchUpPublishAt, selectRunnableDueAgents } from "./src/utils/automationUploadTiming.js";
import { canUploadViaZernio, shouldUploadViaZernio } from "./src/utils/publishProvider.js";
import { repairAutomationMetadata } from "./src/utils/automationMetadataPolicy.js";
dns.setDefaultResultOrder("ipv4first");
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
const tiktokCommentDaemonState = {
    child: null,
    buffer: "",
    pending: new Map(),
    starting: null,
    idleTimer: null,
    nextId: 1,
};
function tiktokCommentDaemonEnabled() {
    return !["0", "false", "off"].includes(String(process.env.MOVIE_ID_COMMENT_HINTS || "true").trim().toLowerCase())
        && !["0", "false", "off"].includes(String(process.env.TIKTOK_COMMENT_DAEMON || "true").trim().toLowerCase());
}
function tiktokCommentDaemonIdleMs() {
    return Math.min(Math.max(Number(process.env.TIKTOK_COMMENT_DAEMON_IDLE_MS) || 1800000, 60000), 86400000);
}
function tiktokCommentCacheExpirySql() {
    const hours = Math.min(Math.max(Number(process.env.TIKTOK_COMMENT_CACHE_HOURS) || 168, 1), 720);
    return `now() + interval '${hours} hours'`;
}
function resetTikTokCommentDaemonState(error) {
    const child = tiktokCommentDaemonState.child;
    tiktokCommentDaemonState.child = null;
    tiktokCommentDaemonState.buffer = "";
    tiktokCommentDaemonState.starting = null;
    for (const [, pending] of tiktokCommentDaemonState.pending) {
        pending.reject(error instanceof Error ? error : new Error(String(error || "TikTok comment daemon stopped")));
    }
    tiktokCommentDaemonState.pending.clear();
    if (child && !child.killed) {
        try {
            child.kill("SIGKILL");
        }
        catch {
            /* ignore */
        }
    }
}
function scheduleTikTokCommentDaemonIdleShutdown() {
    if (tiktokCommentDaemonState.idleTimer)
        clearTimeout(tiktokCommentDaemonState.idleTimer);
    tiktokCommentDaemonState.idleTimer = setTimeout(() => {
        shutdownTikTokCommentDaemon().catch(() => { });
    }, tiktokCommentDaemonIdleMs());
}
function flushTikTokCommentDaemonBuffer() {
    let index = tiktokCommentDaemonState.buffer.indexOf("\n");
    while (index >= 0) {
        const line = tiktokCommentDaemonState.buffer.slice(0, index).trim();
        tiktokCommentDaemonState.buffer = tiktokCommentDaemonState.buffer.slice(index + 1);
        if (line) {
            try {
                const message = JSON.parse(line);
                const pending = tiktokCommentDaemonState.pending.get(String(message.id || ""));
                if (pending) {
                    tiktokCommentDaemonState.pending.delete(String(message.id || ""));
                    if (message.ok)
                        pending.resolve(message.data);
                    else
                        pending.reject(new Error(message.error || "TikTok comment daemon request failed"));
                }
            }
            catch (error) {
                console.warn("TikTok comment daemon parse skipped:", error instanceof Error ? error.message : error);
            }
        }
        index = tiktokCommentDaemonState.buffer.indexOf("\n");
    }
}
async function shutdownTikTokCommentDaemon() {
    if (tiktokCommentDaemonState.idleTimer) {
        clearTimeout(tiktokCommentDaemonState.idleTimer);
        tiktokCommentDaemonState.idleTimer = null;
    }
    if (!tiktokCommentDaemonState.child)
        return;
    try {
        await runTikTokCommentsViaDaemonRequest("shutdown", {}, 5000);
    }
    catch {
        resetTikTokCommentDaemonState(new Error("TikTok comment daemon shutdown"));
    }
}
async function ensureTikTokCommentDaemon() {
    if (tiktokCommentDaemonState.child)
        return tiktokCommentDaemonState.child;
    if (tiktokCommentDaemonState.starting)
        return tiktokCommentDaemonState.starting;
    tiktokCommentDaemonState.starting = new Promise((resolve, reject) => {
        const scriptPath = path.join(__dirname, "scripts", "tiktok_api_daemon.py");
        const { cmd, args } = resolvePythonExecutable(scriptPath);
        const child = spawn(cmd, args, {
            cwd: path.join(__dirname, "scripts"),
            env: { ...process.env },
            windowsHide: true,
            stdio: ["pipe", "pipe", "pipe"],
        });
        tiktokCommentDaemonState.child = child;
        tiktokCommentDaemonState.buffer = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            tiktokCommentDaemonState.buffer += chunk;
            flushTikTokCommentDaemonBuffer();
        });
        child.stderr.on("data", (chunk) => {
            const message = String(chunk || "").trim();
            if (message)
                console.warn("TikTok comment daemon:", message);
        });
        child.on("error", (error) => {
            resetTikTokCommentDaemonState(error);
            reject(error);
        });
        child.on("close", () => {
            resetTikTokCommentDaemonState(new Error("TikTok comment daemon exited"));
        });
        runTikTokCommentsViaDaemonRequest("ping", {}, 120000)
            .then(() => {
                scheduleTikTokCommentDaemonIdleShutdown();
                resolve(child);
            })
            .catch((error) => {
                resetTikTokCommentDaemonState(error);
                reject(error);
            })
            .finally(() => {
                tiktokCommentDaemonState.starting = null;
            });
    });
    return tiktokCommentDaemonState.starting;
}
function runTikTokCommentsViaDaemonRequest(action, payload = {}, timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
        if (!tiktokCommentDaemonState.child?.stdin?.writable) {
            reject(new Error("TikTok comment daemon is not running"));
            return;
        }
        const id = String(tiktokCommentDaemonState.nextId++);
        const killTimer = setTimeout(() => {
            tiktokCommentDaemonState.pending.delete(id);
            reject(new Error(`TikTok comment daemon timed out after ${Math.round(timeoutMs / 1000)}s`));
        }, timeoutMs);
        tiktokCommentDaemonState.pending.set(id, {
            resolve: (value) => {
                clearTimeout(killTimer);
                scheduleTikTokCommentDaemonIdleShutdown();
                resolve(value);
            },
            reject: (error) => {
                clearTimeout(killTimer);
                reject(error);
            },
        });
        try {
            tiktokCommentDaemonState.child.stdin.write(`${JSON.stringify({ id, action, ...payload })}\n`);
        }
        catch (error) {
            clearTimeout(killTimer);
            tiktokCommentDaemonState.pending.delete(id);
            reject(error instanceof Error ? error : new Error(String(error)));
        }
    });
}
async function runTikTokCommentsViaDaemon(url, options = {}) {
    await ensureTikTokCommentDaemon();
    const commentLimit = Math.max(5, Math.min(Number(options.commentLimit) || Number(process.env.TIKTOK_COMMENTS_LIMIT) || 40, 80));
    const replyLimit = Math.max(0, Math.min(Number(options.replyLimit) || Number(process.env.TIKTOK_COMMENT_REPLY_LIMIT) || 12, 30));
    const timeoutMs = Math.min(Math.max(Number(process.env.TIKTOK_COMMENTS_TIMEOUT_MS) || 120000, 30000), 300000);
    const data = await runTikTokCommentsViaDaemonRequest("fetch_comments", { url, commentLimit, replyLimit }, timeoutMs);
    if (!data || !Array.isArray(data.threads))
        throw new Error("TikTok comment daemon returned an invalid payload");
    return data;
}
function runTikTokCommentsScriptOnce(url, options = {}) {
    const scriptPath = path.join(__dirname, "scripts", "tiktok_comments.py");
    const { cmd, args } = resolvePythonExecutable(scriptPath);
    const timeoutMs = Math.min(Math.max(Number(process.env.TIKTOK_COMMENTS_TIMEOUT_MS) || 120000, 30000), 300000);
    const commentLimit = Math.max(5, Math.min(Number(options.commentLimit) || Number(process.env.TIKTOK_COMMENTS_LIMIT) || 40, 80));
    const replyLimit = Math.max(0, Math.min(Number(options.replyLimit) || Number(process.env.TIKTOK_COMMENT_REPLY_LIMIT) || 12, 30));
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, {
            cwd: path.join(__dirname, "scripts"),
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
            reject(new Error(err instanceof Error ? err.message : String(err)));
        });
        child.on("close", (code) => {
            clearTimeout(killTimer);
            if (killedByTimeout) {
                reject(new Error(`TikTok comment fetch timed out after ${Math.round(timeoutMs / 1000)}s.`));
                return;
            }
            try {
                const data = JSON.parse(stdout || "{}");
                if (data.error) {
                    reject(new Error(data.error));
                    return;
                }
                if (!Array.isArray(data.threads)) {
                    reject(new Error(stderr || stdout || `TikTok comment fetch failed (exit ${code})`));
                    return;
                }
                resolve(data);
            }
            catch {
                reject(new Error(stderr || stdout || `TikTok comment fetch failed (exit ${code})`));
            }
        });
        child.stdin.write(JSON.stringify({ url, commentLimit, replyLimit }));
        child.stdin.end();
    });
}
async function runTikTokCommentsScript(url, options = {}) {
    if (tiktokCommentDaemonEnabled()) {
        try {
            return await runTikTokCommentsViaDaemon(url, options);
        }
        catch (error) {
            console.warn("TikTok comment daemon fetch failed, falling back to one-shot script:", error instanceof Error ? error.message : error);
            resetTikTokCommentDaemonState(error instanceof Error ? error : new Error(String(error)));
        }
    }
    return runTikTokCommentsScriptOnce(url, options);
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
    const minHeight = socialDownloadMinHeight();
    const preferredHeight = socialDownloadPreferredHeight();
    const preferredFormat = `bv*[height<=${preferredHeight}][height>=${minHeight}][ext=mp4]+ba[ext=m4a]/bv*[height<=${preferredHeight}][height>=${minHeight}]+ba/b[height<=${preferredHeight}][height>=${minHeight}][ext=mp4]/b[height<=${preferredHeight}][height>=${minHeight}]/bv*[height<=${preferredHeight}][ext=mp4]+ba[ext=m4a]/bv*[height<=${preferredHeight}]+ba/b[height<=${preferredHeight}][ext=mp4]/b[height<=${preferredHeight}]/b`;
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
                    "-S",
                    `res:${preferredHeight},ext:mp4:m4a`,
                    "-f",
                    preferredFormat,
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
                    "-S",
                    `res:${preferredHeight},ext:mp4:m4a`,
                    "-f",
                    preferredFormat,
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
                    `proto:m3u8,res:${preferredHeight},ext:mp4:m4a`,
                    "-f",
                    preferredFormat,
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
                    "-S",
                    `res:${preferredHeight},ext:mp4:m4a`,
                    "-f",
                    preferredFormat,
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
function isTikTokUrl(value) {
    return /(?:^|\.)tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com/i.test(String(value || ""));
}
function isYouTubeUrl(value) {
    return /(?:youtube\.com|youtu\.be)/i.test(String(value || ""));
}
async function runYtDlpAudioDownload(url, outputPath) {
    const timeoutMs = Math.min(Math.max(Number(process.env.SOCIAL_DOWNLOAD_TIMEOUT_MS || process.env.TIKTOK_DOWNLOAD_TIMEOUT_MS) || 180000, 30000), 900000);
    const cookieFile = (process.env.YTDLP_COOKIES_FILE || process.env.YOUTUBE_YTDLP_COOKIES_FILE || "").trim();
    const args = [
        "-m",
        "yt_dlp",
        "--no-check-certificate",
        "--force-overwrites",
        "--no-playlist",
        "--force-ipv4",
        "--user-agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "-f",
        "bestaudio[ext=m4a]/bestaudio/best",
        "-o",
        outputPath,
        url,
    ];
    if (cookieFile) {
        args.splice(10, 0, "--cookies", cookieFile);
    }
    await runYtDlpWithArgs(args, timeoutMs);
}
async function downloadMediaForTranscription(rawUrl, outputPath) {
    const url = String(rawUrl || "").trim();
    if (!url)
        throw new Error("Missing url parameter");
    if (isTikTokUrl(url)) {
        const errors = [];
        try {
            const downloader = await runTikTokDownloadWithAudioRetry({ sourceUrl: url }, outputPath);
            return `tiktok:${downloader}`;
        }
        catch (error) {
            errors.push(`TikTok video download: ${error instanceof Error ? error.message : String(error)}`);
        }
        try {
            await runYtDlpAudioDownload(url, outputPath);
            return "tiktok:yt-dlp-audio";
        }
        catch (error) {
            errors.push(`TikTok audio download: ${error instanceof Error ? error.message : String(error)}`);
        }
        throw new Error(`Could not download TikTok media for transcription without a cookie session. ${errors.join(" | ")}`);
    }
    const downloader = await runYtDlpSocialDownload(url, outputPath);
    await assertVideoHasAudio(outputPath, "Downloaded video");
    return downloader;
}
async function extractAudioForTranscription(mediaPath, audioPath, options = {}) {
    const maxDurationSeconds = Math.min(Math.max(Number(options.maxDurationSeconds) || 0, 0), 60 * 60);
    const args = [
        "-y",
        "-i",
        mediaPath,
    ];
    if (maxDurationSeconds > 0) {
        args.push("-t", String(maxDurationSeconds));
    }
    args.push(
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        audioPath,
    );
    await runFfmpeg(args, Math.min(Math.max(Number(process.env.TRANSCRIBE_FFMPEG_TIMEOUT_MS) || 180000, 30000), 900000));
}
async function runLocalWhisperTranscription(audioPath) {
    const scriptPath = path.join(__dirname, "scripts", "transcribe.py");
    const { cmd, args } = resolvePythonExecutable(scriptPath);
    args.push(audioPath);
    return await new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { cwd: __dirname, env: { ...process.env }, windowsHide: true });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => { stdout += chunk; });
        child.stderr.on("data", (chunk) => { stderr += chunk; });
        child.on("close", () => {
            try {
                const lines = stdout.trim().split("\n");
                for (let i = lines.length - 1; i >= 0; i--) {
                    const line = lines[i].trim();
                    if (line.startsWith("{") && line.endsWith("}")) {
                        resolve(JSON.parse(line));
                        return;
                    }
                }
                reject(new Error("No JSON found in stdout. Stderr: " + stderr + " Stdout: " + stdout));
            }
            catch (error) {
                reject(new Error("Failed to parse JSON. Stderr: " + stderr + " Stdout: " + stdout));
            }
        });
        child.on("error", reject);
    });
}
function normalizeTranscriptSegments(value) {
    if (!Array.isArray(value))
        return [];
    return value.map((segment) => ({
        start: Math.max(0, Number(segment?.start) || 0),
        end: Math.max(0, Number(segment?.end) || 0),
        text: String(segment?.text || "").replace(/\s+/g, " ").trim(),
    })).filter((segment) => segment.text && segment.end > segment.start);
}
function clampText(value, maxChars = 2000) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text || text.length <= maxChars)
        return text;
    return `${text.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}
function transcriptExcerpt(value, maxChars = 1200) {
    return clampText(value, maxChars);
}
function compactAnalysisContextForPrompt(value, maxTextChars = 1200) {
    if (Array.isArray(value))
        return value.slice(0, 12).map((item) => compactAnalysisContextForPrompt(item, maxTextChars));
    if (value && typeof value === "object") {
        const result = {};
        for (const [key, child] of Object.entries(value)) {
            if (/fullText|localTranscript|transcriptText|raw/i.test(key)) {
                result[key] = transcriptExcerpt(child, maxTextChars);
            }
            else {
                result[key] = compactAnalysisContextForPrompt(child, maxTextChars);
            }
        }
        return result;
    }
    if (typeof value === "string")
        return clampText(value, maxTextChars);
    return value;
}
async function transcribeMediaFileForAnalysis(mediaPath) {
    const result = await transcribeMediaFileWithSegments(mediaPath);
    return String(result.text || "").trim();
}
async function transcribeMediaFileWithSegments(mediaPath, options = {}) {
    const tmpDir = path.join(__dirname, "tmp");
    if (!fs.existsSync(tmpDir))
        fs.mkdirSync(tmpDir, { recursive: true });
    const audioPath = path.join(tmpDir, `analysis-${crypto.randomBytes(12).toString("hex")}.wav`);
    try {
        await extractAudioForTranscription(mediaPath, audioPath, options);
        const result = await runLocalWhisperTranscription(audioPath);
        if (!result?.success)
            throw new Error(result?.error || "Local transcription failed.");
        return {
            text: String(result.text || "").trim(),
            segments: normalizeTranscriptSegments(result.segments),
        };
    }
    finally {
        if (fs.existsSync(audioPath)) {
            try {
                fs.unlinkSync(audioPath);
            }
            catch {
                /* ignore cleanup */
            }
        }
    }
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
function socialDownloadMinHeight() {
    return Math.min(Math.max(Number(process.env.SOCIAL_DOWNLOAD_MIN_HEIGHT) || 720, 240), 2160);
}
function socialDownloadPreferredHeight() {
    return Math.min(Math.max(Number(process.env.SOCIAL_DOWNLOAD_PREFERRED_HEIGHT) || 1080, socialDownloadMinHeight()), 2160);
}
function tiktokPhotoModeDimensions() {
    const height = Math.min(Math.max(Number(process.env.TIKTOK_PHOTO_MODE_HEIGHT) || tiktokDownloadPreferredHeight(), 720), 2160);
    const width = Math.max(360, Math.round(height * 9 / 16));
    return { width, height };
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
    const target = tiktokPhotoModeDimensions();
    const filter = `scale=${target.width}:${target.height}:force_original_aspect_ratio=decrease,pad=${target.width}:${target.height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`;
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
function probeVideoDuration(filePath) {
    const ffprobe = (process.env.FFPROBE_PATH || "ffprobe").trim();
    const timeoutMs = Math.min(Math.max(Number(process.env.FFPROBE_DURATION_TIMEOUT_MS) || 30000, 5000), 120000);
    return new Promise((resolve) => {
        const child = spawn(ffprobe, [
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            filePath,
        ], { cwd: __dirname, env: { ...process.env }, windowsHide: true });
        let stdout = "";
        let settled = false;
        const finish = (value) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            resolve(Number.isFinite(value) && value > 0 ? value : 0);
        };
        const timer = setTimeout(() => {
            try {
                child.kill("SIGKILL");
            }
            catch {
                /* already closed */
            }
            finish(0);
        }, timeoutMs);
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
        });
        child.on("error", () => finish(0));
        child.on("close", (code) => {
            if (code !== 0) {
                finish(0);
                return;
            }
            finish(Number.parseFloat(stdout.trim()));
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
function shortsUploadEnabled(settings = {}) {
    const value = settings.postAsShort ?? settings.shortsMode ?? settings.shortFormMode;
    return !["false", "0", "off", "long", "longform", "long-form"].includes(String(value).trim().toLowerCase()) && value !== false;
}
function secondsToClock(value) {
    const seconds = Math.max(0, Math.round(Number(value) || 0));
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${String(secs).padStart(2, "0")}`;
}
function scoreShortsTrimCandidate(segment, contextText, targetSeconds) {
    const end = Number(segment?.end) || 0;
    const text = String(segment?.text || "");
    const context = String(contextText || "").toLowerCase();
    let score = 0;
    score += Math.max(0, 42 - Math.abs(end - targetSeconds) * 0.38);
    if (/[.!?]\s*$/.test(text))
        score += 18;
    if (/[.!?]\s*$/.test(contextText))
        score += 8;
    if (/\b(then|but|however|suddenly|realized|finally|before|until|just as|that was when|only to|the moment|as soon as|from there|after that)\b/i.test(context))
        score += 12;
    if (/\b(defeated|escaped|won|lost|saved|collapsed|revealed|transformed|unlocked|finished|survived|returned|decided|prepared)\b/i.test(context))
        score += 10;
    if (/\b(part\s*\d+|follow for|subscribe|like and follow|what happens next)\b/i.test(context))
        score -= 18;
    if (end < 75)
        score -= 12;
    if (end > 176)
        score -= 4;
    return score;
}
function chooseShortsTrimPoint(segments, durationSeconds) {
    const maxSeconds = Math.min(179, Math.max(60, (Number(durationSeconds) || 0) - 0.5));
    const minSeconds = Math.min(60, maxSeconds);
    const targetSeconds = Math.min(165, Math.max(120, maxSeconds - 12));
    const candidates = normalizeTranscriptSegments(segments).filter((segment) => segment.end >= minSeconds && segment.end <= maxSeconds);
    let best = null;
    candidates.forEach((segment, index) => {
        const previous = candidates.slice(Math.max(0, index - 3), index).map((item) => item.text).join(" ");
        const contextText = `${previous} ${segment.text}`.trim();
        const score = scoreShortsTrimCandidate(segment, contextText, targetSeconds);
        if (!best || score > best.score) {
            best = { cutAtSeconds: Math.max(minSeconds, Math.min(maxSeconds, segment.end + 0.2)), score, reason: "transcript_arc", context: contextText.slice(-500) };
        }
    });
    if (best)
        return best;
    return {
        cutAtSeconds: Math.min(maxSeconds, Math.max(minSeconds, Math.round(Math.min(durationSeconds || 179, targetSeconds)))),
        score: 0,
        reason: "duration_fallback",
        context: "",
    };
}
async function prepareShortsUploadFile(inputPath, settings = {}, context = {}) {
    if (!shortsUploadEnabled(settings)) {
        return {
            filePath: inputPath,
            cleanup: false,
            metrics: { enabled: false, reason: "long_form_selected" },
        };
    }
    const originalDurationSeconds = await probeVideoDuration(inputPath);
    if (originalDurationSeconds > 0 && originalDurationSeconds <= 179.5) {
        return {
            filePath: inputPath,
            cleanup: false,
            metrics: {
                enabled: true,
                trimmed: false,
                reason: "already_under_three_minutes",
                originalDurationSeconds,
                uploadDurationSeconds: originalDurationSeconds,
            },
        };
    }
    let transcript = { text: "", segments: [] };
    let transcriptError = "";
    try {
        transcript = await transcribeMediaFileWithSegments(inputPath, { maxDurationSeconds: 185 });
    }
    catch (error) {
        transcriptError = error instanceof Error ? error.message : String(error);
    }
    const choice = chooseShortsTrimPoint(transcript.segments, originalDurationSeconds || 179);
    const cutAtSeconds = Math.min(179, Math.max(60, Number(choice.cutAtSeconds) || 179));
    const outputPath = makeTikTokVideoCachePath();
    await runFfmpeg([
        "-y",
        "-i",
        inputPath,
        "-t",
        cutAtSeconds.toFixed(2),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        outputPath,
    ], Math.min(Math.max(Number(process.env.SHORTS_TRIM_FFMPEG_TIMEOUT_MS) || 240000, 30000), 900000));
    await assertVideoHasAudio(outputPath, "Shorts upload");
    const uploadDurationSeconds = await probeVideoDuration(outputPath);
    return {
        filePath: outputPath,
        cleanup: true,
        metrics: {
            enabled: true,
            trimmed: true,
            reason: choice.reason,
            originalDurationSeconds,
            cutAtSeconds,
            uploadDurationSeconds,
            cutAt: secondsToClock(cutAtSeconds),
            transcriptSegmentCount: transcript.segments.length,
            transcriptError,
            context: choice.context,
            label: context.label || "",
        },
    };
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
async function runDirectTikTokMediaDownload(candidateUrls, outputPath, options = {}) {
    const candidates = orderedUniqueTikTokCandidates(candidateUrls, tiktokAllowWatermarkFallback());
    if (!candidates.length)
        throw new Error("No direct clean playback URL candidates");
    const minHeight = tiktokDownloadMinHeight();
    const preferredHeight = tiktokDownloadPreferredHeight();
    const errors = [];
    for (const candidate of candidates.slice(0, 8)) {
        try {
            await downloadUrlToFile(candidate, outputPath);
            const dimensions = await probeVideoDimensions(outputPath);
            if (dimensions && dimensions.height < minHeight) {
                throw new Error(`downloaded ${dimensions.width}x${dimensions.height}, expected at least ${minHeight}p`);
            }
            if (options.requirePreferred === true && dimensions && dimensions.height < preferredHeight) {
                throw new Error(`downloaded ${dimensions.width}x${dimensions.height}, expected preferred ${preferredHeight}p`);
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
async function runTikwmDownload(url, outputPath, options = {}) {
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
        const preferredHeight = tiktokDownloadPreferredHeight();
        if (dimensions && dimensions.height < minHeight) {
            throw new Error(`TikWM returned ${dimensions.width}x${dimensions.height}, expected at least ${minHeight}p`);
        }
        if (options.requirePreferred === true && dimensions && dimensions.height < preferredHeight) {
            throw new Error(`TikWM returned ${dimensions.width}x${dimensions.height}, expected preferred ${preferredHeight}p`);
        }
    }
    finally {
        clearTimeout(timer);
    }
}
async function runTikTokDownload(url, outputPath, candidateUrls = [], options = {}) {
    const errors = [];
    const preferPreferred = options.requirePreferred !== false && tiktokDownloadPreferredHeight() > tiktokDownloadMinHeight();
    if (options.skipDirect !== true) {
        try {
            const used = await runDirectTikTokMediaDownload(candidateUrls, outputPath, { requirePreferred: preferPreferred });
            return `direct-clean-playback:${new URL(used).hostname}`;
        }
        catch (error) {
            errors.push(`direct playback: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    if (options.skipTikwm !== true && (process.env.TIKTOK_DISABLE_TIKWM_FALLBACK || "").toLowerCase() !== "1") {
        try {
            await runTikwmDownload(url, outputPath, { requirePreferred: preferPreferred });
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
    if (preferPreferred) {
        if (options.skipDirect !== true) {
            try {
                const used = await runDirectTikTokMediaDownload(candidateUrls, outputPath, { requirePreferred: false });
                return `direct-clean-playback-fallback:${new URL(used).hostname}`;
            }
            catch (error) {
                errors.push(`direct playback fallback: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        if (options.skipTikwm !== true && (process.env.TIKTOK_DISABLE_TIKWM_FALLBACK || "").toLowerCase() !== "1") {
            try {
                await runTikwmDownload(url, outputPath, { requirePreferred: false });
                return "tikwm-no-watermark-fallback";
            }
            catch (error) {
                errors.push(`TikWM fallback: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
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
function cleanupMatchingDownloadOutputs(outputPath) {
    if (!outputPath)
        return;
    try {
        cleanupDownloadArtifacts(outputPath);
    }
    catch {
        /* best-effort cleanup */
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
function normalizedTitleWords(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9]+/g, " ")
        .split(/\s+/)
        .filter((word) => word && !new Set(["the", "a", "an", "of", "and", "to", "in", "on", "for", "with", "season", "part"]).has(word));
}
function titleMatchQuality(candidateTitle, wantedTitle) {
    const candidate = String(candidateTitle || "").trim().toLowerCase();
    const wanted = String(wantedTitle || "").trim().toLowerCase();
    if (!candidate || !wanted)
        return 0;
    if (candidate === wanted)
        return 1;
    if (candidate.includes(wanted) || wanted.includes(candidate))
        return 0.86;
    const candidateWords = new Set(normalizedTitleWords(candidate));
    const wantedWords = new Set(normalizedTitleWords(wanted));
    if (!candidateWords.size || !wantedWords.size)
        return 0;
    const overlap = [...wantedWords].filter((word) => candidateWords.has(word)).length;
    const precision = overlap / candidateWords.size;
    const recall = overlap / wantedWords.size;
    return precision && recall ? (2 * precision * recall) / (precision + recall) : 0;
}
function chooseTmdbTitle(results, title, year) {
    const wantedYear = (year || "").match(/\d{4}/)?.[0] || "";
    const withPosters = results.filter((r) => r.poster_path && (r.media_type === "movie" || r.media_type === "tv"));
    if (!withPosters.length)
        return null;
    const exact = withPosters.find((r) => {
        const resultYear = tmdbResultDate(r).slice(0, 4);
        return titleMatchQuality(tmdbResultTitle(r), title) >= 0.85 && (!wantedYear || resultYear === wantedYear);
    });
    if (exact)
        return exact;
    const ranked = withPosters
        .map((r) => ({
        item: r,
        quality: titleMatchQuality(tmdbResultTitle(r), title),
        yearMatch: wantedYear && tmdbResultDate(r).slice(0, 4) === wantedYear ? 1 : 0,
    }))
        .filter((row) => row.quality >= 0.52)
        .sort((a, b) => b.quality - a.quality || b.yearMatch - a.yearMatch || (b.item.vote_count || 0) - (a.item.vote_count || 0) || (b.item.popularity || 0) - (a.item.popularity || 0));
    return ranked[0]?.item || null;
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
        result?.commentHint?.source,
        result?.commentHint?.format,
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
    return /\b(anime|manga|manhwa|manhua|webtoon|toon|donghua|light novel|comic recap|manga recap|manhwa recap|comment reply|tiktok comment)\b/.test(haystack);
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
    const quality = titles.reduce((best, value) => Math.max(best, titleMatchQuality(value, wanted)), 0);
    if (quality >= 0.85)
        score += 20;
    else if (quality >= 0.52)
        score += 8 + quality * 8;
    if (wantedYear && startsAt.startsWith(wantedYear))
        score += 6;
    if (node.main_picture)
        score += 2;
    return score;
}
function malTitleMatchQuality(candidate, title) {
    const node = candidate?.node || candidate || {};
    const titles = [
        node.title,
        node.alternative_titles?.en,
        node.alternative_titles?.ja,
        ...(node.alternative_titles?.synonyms || []),
    ].filter(Boolean);
    return titles.reduce((best, value) => Math.max(best, titleMatchQuality(value, title)), 0);
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
            if (match?.node && malTitleMatchQuality(match, title) >= 0.52)
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
    const displayTitle = preferredMalDisplayTitle(node, result.title);
    return {
        ...result,
        title: displayTitle || result.title,
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
    return isExpiredTikTokSignedCoverUrl(value);
}
function freshTikTokCover(value) {
    return freshTikTokCoverValue(value);
}
function tikTokCoverCacheDir() {
    const dir = process.env.TIKTOK_COVER_CACHE_DIR
        ? path.resolve(process.env.TIKTOK_COVER_CACHE_DIR)
        : path.join(__dirname, "data", "tiktok-covers");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}
function tikTokCoverPublicUrl(fileName) {
    return `/api/tiktok/covers/${encodeURIComponent(fileName)}`;
}
function tikTokCoverExtension(contentType, sourceUrl) {
    const type = String(contentType || "").toLowerCase();
    if (type.includes("png"))
        return ".png";
    if (type.includes("webp"))
        return ".webp";
    if (type.includes("gif"))
        return ".gif";
    try {
        const ext = path.extname(new URL(sourceUrl).pathname).toLowerCase();
        if ([".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext))
            return ext === ".jpeg" ? ".jpg" : ext;
    }
    catch {
        /* fall back to jpeg */
    }
    return ".jpg";
}
function existingTikTokCoverFile(baseName) {
    const dir = tikTokCoverCacheDir();
    for (const ext of [".jpg", ".png", ".webp", ".gif"]) {
        const fileName = `${baseName}${ext}`;
        if (fs.existsSync(path.join(dir, fileName)))
            return tikTokCoverPublicUrl(fileName);
    }
    return "";
}
async function cacheTikTokCoverForVideo(video) {
    const current = String(video?.dynamicCover || "");
    if (isLocalTikTokCoverUrl(current))
        return current;
    const source = tiktokCoverSourceUrl(video);
    if (!source || isLocalTikTokCoverUrl(source) || isExpiredTikTokSignedUrl(source))
        return "";
    const stableKey = String(video?.id || video?.playUrl || source);
    const baseName = crypto.createHash("sha1").update(stableKey).digest("hex").slice(0, 32);
    const existing = existingTikTokCoverFile(baseName);
    if (existing)
        return existing;
    const timeoutMs = Math.min(Math.max(Number(process.env.TIKTOK_COVER_CACHE_TIMEOUT_MS) || 7000, 1000), 30000);
    const maxBytes = Math.min(Math.max(Number(process.env.TIKTOK_COVER_CACHE_MAX_BYTES) || 3 * 1024 * 1024, 128 * 1024), 15 * 1024 * 1024);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(source, {
            signal: controller.signal,
            headers: {
                "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
                referer: "https://www.tiktok.com/",
            },
        });
        if (!response.ok || !response.body)
            return "";
        const contentType = response.headers.get("content-type") || "";
        if (contentType && !/^image\//i.test(contentType))
            return "";
        const contentLength = Number(response.headers.get("content-length") || 0);
        if (contentLength > maxBytes)
            return "";
        const ext = tikTokCoverExtension(contentType, source);
        const fileName = `${baseName}${ext}`;
        const target = path.join(tikTokCoverCacheDir(), fileName);
        const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.byteLength > maxBytes)
            return "";
        fs.writeFileSync(temp, buffer);
        fs.renameSync(temp, target);
        return tikTokCoverPublicUrl(fileName);
    }
    catch {
        return "";
    }
    finally {
        clearTimeout(timeout);
    }
}
async function mapWithConcurrency(items, limit, mapper) {
    const out = new Array(items.length);
    let index = 0;
    const workers = Array.from({ length: Math.min(Math.max(limit, 1), Math.max(items.length, 1)) }, async () => {
        while (index < items.length) {
            const currentIndex = index++;
            out[currentIndex] = await mapper(items[currentIndex], currentIndex);
        }
    });
    await Promise.all(workers);
    return out;
}
async function cacheTikTokPlaylistCoversForStorage(playlist) {
    if (!playlist || typeof playlist !== "object")
        return playlist;
    const videos = Array.isArray(playlist.videos) ? playlist.videos : [];
    if (!videos.length)
        return playlist;
    const limit = Math.min(Math.max(Number(process.env.TIKTOK_COVER_CACHE_LIMIT) || 2000, 0), 10000);
    const concurrency = Math.min(Math.max(Number(process.env.TIKTOK_COVER_CACHE_CONCURRENCY) || 10, 1), 32);
    const cachedVideos = await mapWithConcurrency(videos, concurrency, async (video, index) => {
        if (limit > 0 && index >= limit)
            return applyCachedTikTokCover(video, "");
        const cached = await cacheTikTokCoverForVideo(video);
        return applyCachedTikTokCover(video, cached);
    });
    return { ...playlist, videos: cachedVideos };
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
ALTER TABLE saved_tiktok_playlists ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE saved_tiktok_playlists ADD COLUMN IF NOT EXISTS auto_tags jsonb NOT NULL DEFAULT '[]'::jsonb;
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
CREATE TABLE IF NOT EXISTS saved_tiktok_playlist_genre_scans (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  playlist_key text NOT NULL,
  playlist_slug text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'idle',
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, playlist_key)
);
CREATE INDEX IF NOT EXISTS saved_tiktok_playlist_genre_scans_user_idx ON saved_tiktok_playlist_genre_scans(user_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS saved_tiktok_post_analyses (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  playlist_key text NOT NULL DEFAULT '',
  post_slug text NOT NULL,
  video jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  auto_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  analyzed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, post_slug)
);
CREATE INDEX IF NOT EXISTS saved_tiktok_post_analyses_playlist_idx ON saved_tiktok_post_analyses(user_id, playlist_key, analyzed_at DESC);
CREATE INDEX IF NOT EXISTS saved_tiktok_post_analyses_slug_idx ON saved_tiktok_post_analyses(user_id, post_slug);
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
  zernio_api_key text DEFAULT NULL,
  zernio_account_id text DEFAULT NULL,
  platform text NOT NULL DEFAULT 'youtube',
  UNIQUE(user_id, channel_id)
);
CREATE INDEX IF NOT EXISTS youtube_accounts_user_idx ON youtube_accounts(user_id);
ALTER TABLE youtube_accounts ADD COLUMN IF NOT EXISTS zernio_api_key text DEFAULT NULL;
ALTER TABLE youtube_accounts ADD COLUMN IF NOT EXISTS zernio_account_id text DEFAULT NULL;
ALTER TABLE youtube_accounts ADD COLUMN IF NOT EXISTS platform text NOT NULL DEFAULT 'youtube';
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
CREATE TABLE IF NOT EXISTS tiktok_comment_cache (
  tiktok_video_id text PRIMARY KEY,
  normalized_url text NOT NULL DEFAULT '',
  author_unique_id text NOT NULL DEFAULT '',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tiktok_comment_cache_expires_idx ON tiktok_comment_cache(expires_at);
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
CREATE TABLE IF NOT EXISTS agent_content_signals (
  upload_id text PRIMARY KEY REFERENCES automation_uploads(id) ON DELETE CASCADE,
  agent_id text NOT NULL REFERENCES automation_agents(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  youtube_account_id text NOT NULL REFERENCES youtube_accounts(id) ON DELETE CASCADE,
  source_author text NOT NULL DEFAULT '',
  source_url text NOT NULL DEFAULT '',
  source_video_id text NOT NULL DEFAULT '',
  source_views bigint NOT NULL DEFAULT 0,
  source_likes bigint NOT NULL DEFAULT 0,
  source_comments bigint NOT NULL DEFAULT 0,
  genre text NOT NULL DEFAULT '',
  micro_niche text NOT NULL DEFAULT '',
  hook_pattern text NOT NULL DEFAULT '',
  duration_bucket text NOT NULL DEFAULT '',
  publish_hour integer NOT NULL DEFAULT 0,
  publish_day integer NOT NULL DEFAULT 0,
  youtube_views bigint NOT NULL DEFAULT 0,
  youtube_likes bigint NOT NULL DEFAULT 0,
  youtube_comments bigint NOT NULL DEFAULT 0,
  score double precision NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_content_signals_agent_score_idx ON agent_content_signals(agent_id, score DESC);
CREATE INDEX IF NOT EXISTS agent_content_signals_channel_score_idx ON agent_content_signals(youtube_account_id, score DESC);
CREATE INDEX IF NOT EXISTS agent_content_signals_msn_idx ON agent_content_signals(micro_niche);
CREATE TABLE IF NOT EXISTS agent_learning_profiles (
  agent_id text PRIMARY KEY REFERENCES automation_agents(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  youtube_account_id text NOT NULL REFERENCES youtube_accounts(id) ON DELETE CASCADE,
  profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary text NOT NULL DEFAULT '',
  recommendation text NOT NULL DEFAULT '',
  confidence double precision NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_learning_profiles_channel_idx ON agent_learning_profiles(youtube_account_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS agent_niche_observations (
  id text PRIMARY KEY,
  agent_id text NOT NULL REFERENCES automation_agents(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  youtube_account_id text NOT NULL REFERENCES youtube_accounts(id) ON DELETE CASCADE,
  micro_niche text NOT NULL,
  macro_niche text NOT NULL DEFAULT '',
  sub_niche text NOT NULL DEFAULT '',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  uploads integer NOT NULL DEFAULT 0,
  total_views bigint NOT NULL DEFAULT 0,
  best_views bigint NOT NULL DEFAULT 0,
  confidence double precision NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'candidate',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agent_id, micro_niche)
);
CREATE INDEX IF NOT EXISTS agent_niche_observations_score_idx ON agent_niche_observations(total_views DESC, confidence DESC);
CREATE TABLE IF NOT EXISTS competitor_channels (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  youtube_account_id text NOT NULL REFERENCES youtube_accounts(id) ON DELETE CASCADE,
  source_type text NOT NULL DEFAULT 'auto',
  channel_title text NOT NULL DEFAULT '',
  channel_url text NOT NULL DEFAULT '',
  channel_handle text NOT NULL DEFAULT '',
  niche text NOT NULL DEFAULT '',
  reason text NOT NULL DEFAULT '',
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(youtube_account_id, channel_url)
);
CREATE INDEX IF NOT EXISTS competitor_channels_account_idx ON competitor_channels(youtube_account_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS competitor_videos (
  id text PRIMARY KEY,
  competitor_id text NOT NULL REFERENCES competitor_channels(id) ON DELETE CASCADE,
  youtube_account_id text NOT NULL REFERENCES youtube_accounts(id) ON DELETE CASCADE,
  video_id text NOT NULL DEFAULT '',
  title text NOT NULL DEFAULT '',
  url text NOT NULL DEFAULT '',
  thumbnail_url text NOT NULL DEFAULT '',
  published_at timestamptz,
  view_count bigint NOT NULL DEFAULT 0,
  like_count bigint NOT NULL DEFAULT 0,
  comment_count bigint NOT NULL DEFAULT 0,
  duration_seconds integer NOT NULL DEFAULT 0,
  hook_pattern text NOT NULL DEFAULT '',
  niche text NOT NULL DEFAULT '',
  velocity double precision NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(competitor_id, video_id)
);
CREATE INDEX IF NOT EXISTS competitor_videos_account_velocity_idx ON competitor_videos(youtube_account_id, velocity DESC);
CREATE TABLE IF NOT EXISTS tracked_youtube_competitors (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  youtube_account_id text NOT NULL REFERENCES youtube_accounts(id) ON DELETE CASCADE,
  channel_id text NOT NULL,
  channel_title text NOT NULL DEFAULT '',
  channel_url text NOT NULL DEFAULT '',
  channel_handle text NOT NULL DEFAULT '',
  thumbnail_url text NOT NULL DEFAULT '',
  niche text NOT NULL DEFAULT '',
  sub_niche text NOT NULL DEFAULT '',
  reason text NOT NULL DEFAULT '',
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  recent_videos jsonb NOT NULL DEFAULT '[]'::jsonb,
  score double precision NOT NULL DEFAULT 0,
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(youtube_account_id, channel_id)
);
CREATE INDEX IF NOT EXISTS tracked_youtube_competitors_account_score_idx ON tracked_youtube_competitors(youtube_account_id, score DESC);
CREATE TABLE IF NOT EXISTS channel_styles (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  youtube_account_id text NOT NULL REFERENCES youtube_accounts(id) ON DELETE CASCADE,
  source_type text NOT NULL DEFAULT 'youtube',
  source_channel_id text NOT NULL DEFAULT '',
  source_url text NOT NULL DEFAULT '',
  name text NOT NULL DEFAULT '',
  niche text NOT NULL DEFAULT '',
  sub_niche text NOT NULL DEFAULT '',
  micro_niche text NOT NULL DEFAULT '',
  profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS channel_styles_account_idx ON channel_styles(youtube_account_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS creator_projects (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  youtube_account_id text NOT NULL REFERENCES youtube_accounts(id) ON DELETE CASCADE,
  source_type text NOT NULL DEFAULT 'channel_video',
  source_id text NOT NULL DEFAULT '',
  title text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active',
  stage text NOT NULL DEFAULT 'overview',
  style_id text REFERENCES channel_styles(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  outputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS creator_projects_account_idx ON creator_projects(youtube_account_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS creator_projects_source_idx ON creator_projects(youtube_account_id, source_type, source_id);
CREATE TABLE IF NOT EXISTS creator_project_assets (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES creator_projects(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  youtube_account_id text NOT NULL REFERENCES youtube_accounts(id) ON DELETE CASCADE,
  asset_type text NOT NULL DEFAULT '',
  label text NOT NULL DEFAULT '',
  url text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS creator_project_assets_project_idx ON creator_project_assets(project_id, created_at DESC);
CREATE TABLE IF NOT EXISTS feed_insights (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  youtube_account_id text NOT NULL REFERENCES youtube_accounts(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'All',
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  action_label text NOT NULL DEFAULT '',
  action_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_type text NOT NULL DEFAULT '',
  source_id text NOT NULL DEFAULT '',
  priority double precision NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  dismissed_at timestamptz
);
CREATE INDEX IF NOT EXISTS feed_insights_account_idx ON feed_insights(youtube_account_id, status, priority DESC, updated_at DESC);
CREATE TABLE IF NOT EXISTS agent_learning_events (
  id text PRIMARY KEY,
  agent_id text REFERENCES automation_agents(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  youtube_account_id text NOT NULL REFERENCES youtube_accounts(id) ON DELETE CASCADE,
  event_type text NOT NULL DEFAULT 'content_signal',
  source_type text NOT NULL DEFAULT '',
  source_id text NOT NULL DEFAULT '',
  taxonomy jsonb NOT NULL DEFAULT '{}'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  recommendation text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_learning_events_account_idx ON agent_learning_events(youtube_account_id, created_at DESC);
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
    const tags = normalizeSavedSourceTags(row.tags);
    const storedAutoTags = normalizeSavedSourceTags(row.autoTags);
    const generatedAutoTags = savedSourceAutoTags(row, row.genreScanState || {});
    const autoTags = mergeSavedSourceTags(storedAutoTags, generatedAutoTags);
    return {
        key: row.key,
        slug: row.slug || savedSlugForRecord(row),
        analyzedUrl: row.analyzedUrl || row.key,
        title: savedPlaylistDisplayTitle(row),
        videoCount: videos.length,
        savedAt: row.savedAt || 0,
        thumb: freshTikTokCover(first.dynamicCover),
        platform: savedSourcePlatformFromUrl(row.analyzedUrl || row.key || ""),
        tags,
        autoTags,
        allTags: mergeSavedSourceTags(tags, autoTags),
    };
}
function normalizeSavedSourceTag(value) {
    return String(value || "")
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 48);
}
function savedSourceTagKey(value) {
    return normalizeSavedSourceTag(value).toLowerCase();
}
function normalizeSavedSourceTags(values, max = 80) {
    const list = Array.isArray(values) ? values : [];
    const out = [];
    const seen = new Set();
    for (const raw of list) {
        const tag = normalizeSavedSourceTag(raw);
        const key = tag.toLowerCase();
        if (!tag || seen.has(key))
            continue;
        seen.add(key);
        out.push(tag);
        if (out.length >= max)
            break;
    }
    return out;
}
function mergeSavedSourceTags(...groups) {
    return normalizeSavedSourceTags(groups.flatMap((group) => Array.isArray(group) ? group : []), 120);
}
function savedSourceTagsFromText(value = "") {
    const text = String(value || "").toLowerCase();
    const tags = [];
    if (/\banime\b/.test(text))
        tags.push("anime");
    if (/\banime\b/.test(text) && /\brecaps?\b/.test(text))
        tags.push("anime recap");
    if (/\bmovie\b/.test(text) && /\brecaps?\b/.test(text))
        tags.push("movie recap");
    if (/\bdrama\b/.test(text))
        tags.push("Drama");
    if (/\bthriller\b/.test(text))
        tags.push("Thriller");
    if (/\baction\b/.test(text))
        tags.push("Action");
    return tags;
}
function savedVideoTagPool(video = {}, membership = null) {
    return normalizeSavedSourceTags([
        video.author,
        video.authorHandle,
        ...(String(video.title || "").match(/#[\p{L}\p{N}_-]+/gu) || []).map((tag) => tag.replace(/^#/, "")),
        ...savedSourceTagsFromText(`${video.title || ""} ${video.author || ""} ${video.authorHandle || ""}`),
        membership?.title,
        membership?.year,
        membership?.source,
        ...(Array.isArray(membership?.genres) ? membership.genres : []),
        ...(Array.isArray(membership?.storySignals) ? membership.storySignals : []),
    ], 80);
}
function savedSourceAutoTags(record = {}, state = {}) {
    const playlist = record.playlist || {};
    const videos = Array.isArray(playlist.videos) ? playlist.videos : [];
    const memberships = savedGenreScanState(state).memberships;
    const tags = [
        ...savedSourceTagsFromText(`${record.analyzedUrl || record.key || ""} ${playlist.title || ""} ${playlist.author || ""}`),
        playlist.author,
        playlist.authorHandle,
    ];
    for (const membership of memberships) {
        tags.push(...savedVideoTagPool(membership.video || {}, membership));
    }
    if (!memberships.length) {
        for (const video of videos.slice(0, 80)) {
            tags.push(...savedVideoTagPool(video));
        }
    }
    return normalizeSavedSourceTags(tags, 120);
}
async function refreshSavedPlaylistAutoTags(userId, record, state = null) {
    const key = normalizePlaylistListUrl(record?.key || record?.analyzedUrl || "");
    if (!key)
        return [];
    const scanState = state || await getSavedPlaylistGenreScanState(userId, key).catch(() => savedGenreScanState());
    const autoTags = savedSourceAutoTags(record, scanState);
    await runPsql(`
UPDATE saved_tiktok_playlists
SET auto_tags = ${jsonbLiteral(autoTags)}, updated_at = now()
WHERE user_id = ${sqlString(userId)}
  AND key = ${sqlString(key)};
`);
    return autoTags;
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
  'savedAt', FLOOR(EXTRACT(EPOCH FROM saved_at) * 1000)::bigint,
  'tags', tags,
  'autoTags', auto_tags,
  'genreScanState', (
    SELECT state FROM saved_tiktok_playlist_genre_scans g
    WHERE g.user_id = saved_tiktok_playlists.user_id
      AND g.playlist_key = saved_tiktok_playlists.key
    LIMIT 1
  )
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
    'savedAt', FLOOR(EXTRACT(EPOCH FROM saved_at) * 1000)::bigint,
    'tags', tags,
    'autoTags', auto_tags,
    'genreScanState', (
      SELECT state FROM saved_tiktok_playlist_genre_scans g
      WHERE g.user_id = saved_tiktok_playlists.user_id
        AND g.playlist_key = saved_tiktok_playlists.key
      LIMIT 1
    )
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
    'savedAt', FLOOR(EXTRACT(EPOCH FROM saved_at) * 1000)::bigint,
    'tags', tags,
    'autoTags', auto_tags,
    'genreScanState', (
      SELECT state FROM saved_tiktok_playlist_genre_scans g
      WHERE g.user_id = saved_tiktok_playlists.user_id
        AND g.playlist_key = saved_tiktok_playlists.key
      LIMIT 1
    )
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
    const playlistWithCachedCovers = await cacheTikTokPlaylistCoversForStorage(playlist);
    let normalizedPlaylist = normalizeTikTokPlaylistForStorage(playlistWithCachedCovers);
    const existingOut = await runPsql(`
SELECT COALESCE((
  SELECT json_build_object('playlist', playlist, 'tags', tags, 'autoTags', auto_tags)
  FROM saved_tiktok_playlists
  WHERE user_id = ${sqlString(userId)}
    AND key = ${sqlString(key)}
  LIMIT 1
), 'null'::json);
`);
    const existingRecord = JSON.parse(existingOut || "null");
    const existingPlaylist = existingRecord?.playlist;
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
    const autoTags = savedSourceAutoTags(record);
    const updated = await runPsql(`
UPDATE saved_tiktok_playlists
SET
  id = COALESCE(NULLIF(id, ''), ${sqlString(id)}),
  slug = ${sqlString(slug)},
  analyzed_url = ${sqlString(record.analyzedUrl)},
  playlist = ${jsonbLiteral(normalizedPlaylist)},
  auto_tags = ${jsonbLiteral(autoTags)},
  updated_at = now()
WHERE user_id = ${sqlString(userId)}
  AND key = ${sqlString(key)}
RETURNING json_build_object(
  'key', key,
  'slug', slug,
  'analyzedUrl', analyzed_url,
  'playlist', playlist,
  'savedAt', FLOOR(EXTRACT(EPOCH FROM saved_at) * 1000)::bigint,
  'tags', tags,
  'autoTags', auto_tags
);
`);
    if (updated && updated !== "null")
        return JSON.parse(updated);
    const out = await runPsql(`
INSERT INTO saved_tiktok_playlists (id, user_id, key, slug, analyzed_url, playlist, tags, auto_tags, saved_at, updated_at)
VALUES (${sqlString(id)}, ${sqlString(userId)}, ${sqlString(key)}, ${sqlString(slug)}, ${sqlString(record.analyzedUrl)}, ${jsonbLiteral(normalizedPlaylist)}, '[]'::jsonb, ${jsonbLiteral(autoTags)}, now(), now())
ON CONFLICT (id) DO UPDATE SET
  user_id = EXCLUDED.user_id,
  key = EXCLUDED.key,
  slug = EXCLUDED.slug,
  analyzed_url = EXCLUDED.analyzed_url,
  playlist = EXCLUDED.playlist,
  auto_tags = EXCLUDED.auto_tags,
  updated_at = now()
RETURNING json_build_object(
  'key', key,
  'slug', slug,
  'analyzedUrl', analyzed_url,
  'playlist', playlist,
  'savedAt', FLOOR(EXTRACT(EPOCH FROM saved_at) * 1000)::bigint,
  'tags', tags,
  'autoTags', auto_tags
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
async function updateSavedPlaylistTags(userId, key, tags) {
    const normalized = normalizePlaylistListUrl(key);
    if (!normalized)
        throw new Error("Saved source key is missing.");
    const cleanTags = normalizeSavedSourceTags(tags, 80);
    const out = await runPsql(`
UPDATE saved_tiktok_playlists
SET tags = ${jsonbLiteral(cleanTags)}, updated_at = now()
WHERE user_id = ${sqlString(userId)}
  AND key = ${sqlString(normalized)}
RETURNING json_build_object(
  'key', key,
  'slug', slug,
  'analyzedUrl', analyzed_url,
  'playlist', playlist,
  'savedAt', FLOOR(EXTRACT(EPOCH FROM saved_at) * 1000)::bigint,
  'tags', tags,
  'autoTags', auto_tags
);
`);
    const record = JSON.parse(out || "null");
    if (!record)
        throw new Error("Saved source not found.");
    return record;
}
async function addSavedPlaylistAutoTags(userId, key, tags) {
    const normalized = normalizePlaylistListUrl(key);
    if (!normalized)
        return null;
    const cleanTags = normalizeSavedSourceTags(tags, 120);
    if (!cleanTags.length)
        return await getSavedPlaylistRecordByKey(userId, normalized);
    const out = await runPsql(`
UPDATE saved_tiktok_playlists
SET auto_tags = (
    SELECT jsonb_agg(value ORDER BY first_seen)
    FROM (
      SELECT lower(value) AS key, value, MIN(first_seen) AS first_seen
      FROM (
        SELECT jsonb_array_elements_text(COALESCE(auto_tags, '[]'::jsonb)) AS value, 0 AS first_seen
        UNION ALL
        SELECT jsonb_array_elements_text(${jsonbLiteral(cleanTags)}) AS value, 1 AS first_seen
      ) t
      WHERE trim(value) <> ''
      GROUP BY lower(value), value
      ORDER BY MIN(first_seen), value
      LIMIT 120
    ) merged
  ),
  updated_at = now()
WHERE user_id = ${sqlString(userId)}
  AND key = ${sqlString(normalized)}
RETURNING json_build_object(
  'key', key,
  'slug', slug,
  'analyzedUrl', analyzed_url,
  'playlist', playlist,
  'savedAt', FLOOR(EXTRACT(EPOCH FROM saved_at) * 1000)::bigint,
  'tags', tags,
  'autoTags', auto_tags
);
`);
    return JSON.parse(out || "null");
}
function savedPostAnalysisDbId(userId, postSlug) {
    return `spa_${crypto.createHash("sha1").update(`${userId || ""}:${postSlug || ""}`).digest("hex").slice(0, 28)}`;
}
function savedPostAnalysisAutoTags(result = {}) {
    return normalizeSavedSourceTags([
        ...(Array.isArray(result?.tmdb?.genres) ? result.tmdb.genres : []),
        ...(Array.isArray(result?.mal?.genres) ? result.mal.genres : []),
        result?.genre,
        result?.mediaType,
        result?.year ? String(result.year) : "",
        result?.tmdb?.releaseDate ? String(result.tmdb.releaseDate).slice(0, 4) : "",
    ], 80);
}
function savedPostAnalysisRow(row) {
    if (!row)
        return null;
    return {
        result: row.result || {},
        analyzedAt: row.analyzedAt || Date.now(),
        video: row.video || undefined,
        playlistKey: row.playlistKey || "",
        autoTags: row.autoTags || [],
    };
}
async function listSavedPostAnalyses(userId, playlistKey = "") {
    const key = normalizePlaylistListUrl(playlistKey);
    const where = key
        ? `user_id = ${sqlString(userId)} AND playlist_key = ${sqlString(key)}`
        : `user_id = ${sqlString(userId)}`;
    const out = await runPsql(`
SELECT COALESCE(json_object_agg(post_slug, json_build_object(
  'result', result,
  'analyzedAt', FLOOR(EXTRACT(EPOCH FROM analyzed_at) * 1000)::bigint,
  'video', video,
  'playlistKey', playlist_key,
  'autoTags', auto_tags
)), '{}'::json)
FROM (
  SELECT *
  FROM saved_tiktok_post_analyses
  WHERE ${where}
  ORDER BY analyzed_at DESC
  LIMIT 5000
) rows;
`);
    return JSON.parse(out || "{}");
}
async function getSavedPostAnalysis(userId, postSlug) {
    const slug = slugifySavedPlaylistTitle(postSlug);
    if (!slug)
        return null;
    const out = await runPsql(`
SELECT COALESCE((
  SELECT json_build_object(
    'result', result,
    'analyzedAt', FLOOR(EXTRACT(EPOCH FROM analyzed_at) * 1000)::bigint,
    'video', video,
    'playlistKey', playlist_key,
    'autoTags', auto_tags
  )
  FROM saved_tiktok_post_analyses
  WHERE user_id = ${sqlString(userId)}
    AND post_slug = ${sqlString(slug)}
  LIMIT 1
), 'null'::json);
`);
    return JSON.parse(out || "null");
}
async function saveSavedPostAnalysis(userId, body = {}) {
    const postSlug = slugifySavedPlaylistTitle(body.slug || body.postSlug || "");
    if (!postSlug) {
        const error = new Error("Saved post slug is required.");
        error.statusCode = 400;
        throw error;
    }
    const result = body.result && typeof body.result === "object" && !Array.isArray(body.result) ? body.result : null;
    if (!result?.title) {
        const error = new Error("Movie ID result is required.");
        error.statusCode = 400;
        throw error;
    }
    const playlistKey = normalizePlaylistListUrl(body.playlistKey || "");
    const video = body.video && typeof body.video === "object" && !Array.isArray(body.video) ? body.video : {};
    const analyzedAtMs = Number(body.analyzedAt || Date.now());
    const analyzedAtIso = new Date(Number.isFinite(analyzedAtMs) ? analyzedAtMs : Date.now()).toISOString();
    const autoTags = savedPostAnalysisAutoTags(result);
    const id = savedPostAnalysisDbId(userId, postSlug);
    const out = await runPsql(`
INSERT INTO saved_tiktok_post_analyses (id, user_id, playlist_key, post_slug, video, result, auto_tags, analyzed_at, created_at, updated_at)
VALUES (${sqlString(id)}, ${sqlString(userId)}, ${sqlString(playlistKey)}, ${sqlString(postSlug)}, ${jsonbLiteral(video)}, ${jsonbLiteral(result)}, ${jsonbLiteral(autoTags)}, ${sqlString(analyzedAtIso)}::timestamptz, now(), now())
ON CONFLICT (user_id, post_slug) DO UPDATE SET
  playlist_key = COALESCE(NULLIF(EXCLUDED.playlist_key, ''), saved_tiktok_post_analyses.playlist_key),
  video = EXCLUDED.video,
  result = EXCLUDED.result,
  auto_tags = EXCLUDED.auto_tags,
  analyzed_at = EXCLUDED.analyzed_at,
  updated_at = now()
RETURNING json_build_object(
  'result', result,
  'analyzedAt', FLOOR(EXTRACT(EPOCH FROM analyzed_at) * 1000)::bigint,
  'video', video,
  'playlistKey', playlist_key,
  'autoTags', auto_tags
);
`);
    if (playlistKey && autoTags.length) {
        await addSavedPlaylistAutoTags(userId, playlistKey, autoTags).catch((error) => console.warn("Saved post auto-tag update skipped:", error instanceof Error ? error.message : error));
    }
    return JSON.parse(out || "null");
}
function savedGenreScanDbId(userId, playlistKey) {
    return `sgs_${crypto.createHash("sha1").update(`${userId || ""}:${playlistKey || ""}`).digest("hex").slice(0, 28)}`;
}
function savedGenreScanState(value = {}) {
    const state = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return {
        memberships: Array.isArray(state.memberships) ? state.memberships : [],
        errors: Array.isArray(state.errors) ? state.errors.slice(-80) : [],
        startedAt: Number(state.startedAt || 0),
        updatedAt: Number(state.updatedAt || 0),
    };
}
async function getSavedPlaylistGenreScanState(userId, playlistKey) {
    const normalizedKey = normalizePlaylistListUrl(playlistKey);
    if (!normalizedKey)
        return savedGenreScanState();
    const out = await runPsql(`
SELECT COALESCE((
  SELECT state
  FROM saved_tiktok_playlist_genre_scans
  WHERE user_id = ${sqlString(userId)}
    AND playlist_key = ${sqlString(normalizedKey)}
  LIMIT 1
), '{}'::jsonb);
`);
    return savedGenreScanState(JSON.parse(out || "{}"));
}
async function saveSavedPlaylistGenreScanState(userId, record, state, status = "ready") {
    const playlistKey = normalizePlaylistListUrl(record?.key || record?.analyzedUrl || "");
    if (!playlistKey)
        throw new Error("Saved playlist key is missing.");
    const id = savedGenreScanDbId(userId, playlistKey);
    const slug = String(record?.slug || savedSlugForRecord(record) || "").trim();
    const cleanState = savedGenreScanState(state);
    await runPsql(`
INSERT INTO saved_tiktok_playlist_genre_scans (id, user_id, playlist_key, playlist_slug, status, state, created_at, updated_at)
VALUES (
  ${sqlString(id)}, ${sqlString(userId)}, ${sqlString(playlistKey)}, ${sqlString(slug)},
  ${sqlString(status)}, ${jsonbLiteral(cleanState)}, now(), now()
)
ON CONFLICT (user_id, playlist_key) DO UPDATE SET
  playlist_slug = EXCLUDED.playlist_slug,
  status = EXCLUDED.status,
  state = EXCLUDED.state,
  updated_at = now();
`);
    await refreshSavedPlaylistAutoTags(userId, record, cleanState).catch(() => []);
    return cleanState;
}
function savedPlaylistGenreScanPayload(record, state = {}) {
    const scanState = savedGenreScanState(state);
    const videos = Array.isArray(record?.playlist?.videos) ? record.playlist.videos : [];
    const memberships = scanState.memberships;
    return {
        key: record?.key || "",
        slug: record?.slug || savedSlugForRecord(record),
        title: savedPlaylistDisplayTitle(record),
        summary: savedPlaylistGenreScanSummary(videos, memberships),
        groups: groupSavedPlaylistGenreMemberships(memberships),
        memberships,
        errors: scanState.errors,
        startedAt: scanState.startedAt || 0,
        updatedAt: scanState.updatedAt || 0,
    };
}
function savedGenreScanVideoUrl(video = {}) {
    const direct = String(video.playUrl || video.sourceUrl || video.url || "").trim();
    if (direct)
        return direct;
    const handle = String(video.authorHandle || video.uploaderId || "").replace(/^@/, "").trim();
    const id = String(video.id || "").trim();
    return handle && id ? `https://www.tiktok.com/@${handle}/video/${id}` : "";
}
async function identifySavedPlaylistGenreVideo(video) {
    const rawUrl = savedGenreScanVideoUrl(video);
    if (!rawUrl)
        throw new Error("Saved clip URL is missing.");
    const cacheLookup = movieCacheLookupFromUrl(rawUrl);
    const cached = await getCachedMovieIdentification(cacheLookup).catch(() => null);
    if (cached)
        return { result: cached, cached: true };
    const tempFile = makeLinkAnalysisVideoPath();
    try {
        await runTikTokDownloadWithAudioRetry({ ...video, playUrl: rawUrl }, tempFile, { preferYtDlp: true });
        const downloadedFile = resolveDownloadedOutput(tempFile);
        const result = await identifyMovieFromVideoFile(downloadedFile, "video/mp4", cacheLookup);
        return { result, cached: false };
    }
    finally {
        cleanupMatchingDownloadOutputs(tempFile);
    }
}
const SAVED_STORY_GENRE_BUCKETS = [
    "Action",
    "Adventure",
    "Comedy",
    "Crime",
    "Drama",
    "Fantasy",
    "Historical",
    "Horror",
    "Isekai",
    "Martial Arts",
    "Mystery",
    "Psychological",
    "Romance",
    "Sci-Fi",
    "Slice of Life",
    "Sports",
    "Supernatural",
    "Thriller",
    "War",
];
function savedStoryGenrePrompt(video, transcript) {
    const title = String(video?.title || "").trim();
    const author = String(video?.authorHandle || video?.author || "").trim();
    return `Classify this short-form recap clip by story genre from its narration transcript.

Choose 1 to 4 genre buckets only from this allowed list:
${SAVED_STORY_GENRE_BUCKETS.join(", ")}

Rules:
- Classify the story being told, not the TikTok creator or hashtag style.
- Use Sports only when competition, training, athletic stakes, or match/race progress drives the story.
- Use Romance only when the relationship arc is central.
- Use Thriller, Mystery, Psychological, Horror, or Crime only when their story evidence is clear.
- Use Isekai only when transfer/reincarnation into another world is explicit.
- Do not identify the movie/anime title. This scan is for fast story grouping only.
- If the transcript is too thin to classify, return an empty genres array.

Return JSON only:
{"genres":["Drama"],"summary":"One short sentence about the story arc.","storySignals":["training arc"],"confidence":0.0}

Source title/caption: ${transcriptExcerpt(title, 500) || "Unknown"}
Creator: ${transcriptExcerpt(author, 160) || "Unknown"}
Transcript:
${transcriptExcerpt(transcript, 9000)}`;
}
function normalizeSavedStoryGenreLabels(values) {
    const bucketMap = new Map(SAVED_STORY_GENRE_BUCKETS.map((genre) => [genre.toLowerCase(), genre]));
    const normalized = [];
    for (const raw of Array.isArray(values) ? values : []) {
        const key = String(raw || "").replace(/\s+/g, " ").trim().toLowerCase();
        const genre = bucketMap.get(key);
        if (genre && !normalized.includes(genre))
            normalized.push(genre);
    }
    return normalized.slice(0, 4);
}
async function transcribeSavedGenreStoryVideo(video) {
    const rawUrl = savedGenreScanVideoUrl(video);
    if (!rawUrl)
        throw new Error("Saved clip URL is missing.");
    const tempFile = makeLinkAnalysisVideoPath();
    let audioFirstError = "";
    try {
        try {
            await runYtDlpAudioDownload(rawUrl, tempFile);
        }
        catch (error) {
            audioFirstError = error instanceof Error ? error.message : String(error || "");
            await runTikTokDownloadWithAudioRetry({ ...video, playUrl: rawUrl }, tempFile, { preferYtDlp: true });
        }
        const mediaPath = resolveDownloadedOutput(tempFile);
        const transcript = await transcribeMediaFileForAnalysis(mediaPath);
        if (!transcript)
            throw new Error("Local transcription did not detect narration.");
        return transcript;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error || "Story transcription failed");
        if (audioFirstError && !message.includes(audioFirstError)) {
            throw new Error(`${message} Audio-first attempt: ${audioFirstError}`.slice(0, 1200));
        }
        throw error;
    }
    finally {
        cleanupDownloadArtifacts(tempFile);
    }
}
async function inferSavedPlaylistStoryGenres(video) {
    const transcript = await transcribeSavedGenreStoryVideo(video);
    const raw = await generateDeepSeekJson(savedStoryGenrePrompt(video, transcript), {
        temperature: 0.1,
        maxTokens: 420,
    });
    return genreMembershipFromStoryResult(video, {
        genres: normalizeSavedStoryGenreLabels(raw?.genres),
        summary: transcriptExcerpt(raw?.summary || "", 500),
        storySignals: Array.isArray(raw?.storySignals) ? raw.storySignals.slice(0, 6) : [],
        confidence: Number(raw?.confidence || 0),
        transcriptExcerpt: transcriptExcerpt(transcript, 1200),
    });
}
async function scanSavedPlaylistGenreVideo(video) {
    const rawUrl = savedGenreScanVideoUrl(video);
    if (!rawUrl)
        throw new Error("Saved clip URL is missing.");
    const cached = await getCachedMovieIdentification(movieCacheLookupFromUrl(rawUrl)).catch(() => null);
    if (cached) {
        const official = genreMembershipFromMovieResult(video, cached);
        if (official.status === "verified")
            return official;
    }
    return await inferSavedPlaylistStoryGenres(video);
}
async function scanSavedPlaylistGenreBatch(userId, record, options = {}) {
    const videos = Array.isArray(record?.playlist?.videos) ? record.playlist.videos : [];
    if (!videos.length)
        throw new Error("Saved playlist has no clips.");
    const previous = await getSavedPlaylistGenreScanState(userId, record.key || record.analyzedUrl);
    const batchSize = Math.min(Math.max(Number(options.batchSize) || 4, 1), 12);
    const pending = pendingSavedPlaylistGenreVideos(videos, previous.memberships, batchSize);
    const updates = [];
    const errors = [...previous.errors];
    for (const video of pending) {
        try {
            updates.push(await scanSavedPlaylistGenreVideo(video));
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error || "Story genre scan failed");
            updates.push({
                videoKey: String(video.id || savedGenreScanVideoUrl(video) || "").trim(),
                video,
                status: "needs_review",
                genres: [],
                reason: "story_genre_scan_failed",
                error: message.slice(0, 500),
                scannedAt: Date.now(),
            });
            errors.push({
                videoKey: String(video.id || savedGenreScanVideoUrl(video) || "").trim(),
                title: String(video.title || "").slice(0, 200),
                message: message.slice(0, 500),
                at: Date.now(),
            });
        }
    }
    const nextState = {
        memberships: mergeSavedPlaylistGenreMemberships(previous.memberships, updates),
        errors: errors.slice(-80),
        startedAt: previous.startedAt || Date.now(),
        updatedAt: Date.now(),
    };
    const summary = savedPlaylistGenreScanSummary(videos, nextState.memberships);
    await saveSavedPlaylistGenreScanState(userId, record, nextState, summary.pending ? "scanning" : "ready");
    return savedPlaylistGenreScanPayload(record, nextState);
}
function commentCachePushAuthorized(req) {
    const expected = String(process.env.TIKTOK_COMMENT_PUSH_TOKEN || "").trim();
    if (!expected)
        return false;
    const provided = String(req.headers["x-comment-push-token"] || req.body?.token || "").trim();
    return provided && provided === expected;
}
async function listPendingCommentCacheVideos(record) {
    const videos = Array.isArray(record?.playlist?.videos) ? record.playlist.videos : [];
    const pending = [];
    for (const video of videos) {
        const rawUrl = savedGenreScanVideoUrl(video);
        const videoId = extractTikTokVideoIdFromUrl(rawUrl || "");
        if (!videoId)
            continue;
        const cached = await getCachedTikTokComments(videoId).catch(() => null);
        if (cached?.threads?.length)
            continue;
        pending.push({
            videoId,
            url: rawUrl,
            slug: slugifySavedPost(video),
            title: String(video.title || "").slice(0, 200),
        });
    }
    return pending;
}
async function identifySavedPlaylistVideoMovie(video, options = {}) {
    const rawUrl = savedGenreScanVideoUrl(video);
    if (!rawUrl)
        throw new Error("Saved clip URL is missing.");
    const cacheLookup = { ...movieCacheLookupFromUrl(rawUrl), cacheOnly: options.cacheOnly !== false };
    const skipMovieCache = options.skipMovieCache === true;
    if (!skipMovieCache) {
        const cachedMovie = await getCachedMovieIdentification(cacheLookup).catch(() => null);
        if (cachedMovie?.title)
            return { result: attachMovieIdentificationSource(cachedMovie, "movie-cache"), source: "movie-cache" };
    }
    if (options.geminiFallback === false)
        throw new Error("Movie ID unavailable and Gemini fallback disabled.");
    const tempFile = makeLinkAnalysisVideoPath();
    try {
        let downloader = "yt-dlp";
        if (/tiktok\.com/i.test(rawUrl)) {
            const candidateUrls = Array.isArray(video?.cleanPlaybackUrls) ? video.cleanPlaybackUrls : [];
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
        const result = await identifyMovieFromVideoFile(downloadedFile, "video/mp4", { ...cacheLookup, skipCommentLookup: true });
        return { result: attachMovieIdentificationSource(result, downloader), source: downloader };
    }
    finally {
        try {
            cleanupDownloadArtifacts(tempFile);
        }
        catch {
            /* best-effort cleanup */
        }
    }
}
function savedPlaylistMovieScanSummary(videos = [], analyses = {}, recent = []) {
    const total = videos.length;
    const doneSlugs = new Set(Object.keys(analyses || {}));
    for (const item of recent) {
        if (item?.slug && item.ok)
            doneSlugs.add(item.slug);
    }
    let analyzed = 0;
    for (const video of videos) {
        if (doneSlugs.has(slugifySavedPost(video)))
            analyzed += 1;
    }
    return {
        total,
        analyzed,
        pending: Math.max(total - analyzed, 0),
    };
}
async function scanSavedPlaylistMovieBatch(userId, record, options = {}) {
    const videos = Array.isArray(record?.playlist?.videos) ? record.playlist.videos : [];
    if (!videos.length)
        throw new Error("Saved playlist has no clips.");
    const playlistKey = normalizePlaylistListUrl(record?.key || record?.analyzedUrl || "");
    const analyses = await listSavedPostAnalyses(userId, playlistKey).catch(() => ({}));
    const batchSize = Math.min(Math.max(Number(options.batchSize) || 1, 1), 6);
    const wantedSlugs = new Set((Array.isArray(options.slugs) ? options.slugs : options.slug ? [options.slug] : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean));
    let pendingVideos = videos.filter((video) => !analyses[slugifySavedPost(video)]);
    if (wantedSlugs.size)
        pendingVideos = pendingVideos.filter((video) => wantedSlugs.has(slugifySavedPost(video)));
    pendingVideos = pendingVideos.slice(0, batchSize);
    const processed = [];
    const errors = [];
    for (const video of pendingVideos) {
        const slug = slugifySavedPost(video);
        try {
            const { result, source } = await identifySavedPlaylistVideoMovie(video, {
                cacheOnly: true,
                geminiFallback: options.geminiFallback !== false,
                skipMovieCache: options.skipMovieCache === true,
            });
            const saved = await saveSavedPostAnalysis(userId, {
                slug,
                postSlug: slug,
                playlistKey,
                video,
                result,
                analyzedAt: Date.now(),
            });
            processed.push({
                slug,
                ok: true,
                source,
                title: String(result?.title || "").slice(0, 160),
                commentHint: Boolean(result?.commentHint),
                analysis: saved,
            });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error || "Movie scan failed");
            processed.push({ slug, ok: false, error: message.slice(0, 500) });
            errors.push({
                slug,
                title: String(video.title || "").slice(0, 200),
                message: message.slice(0, 500),
                at: Date.now(),
            });
        }
    }
    const mergedAnalyses = { ...analyses };
    for (const item of processed) {
        if (item.ok && item.analysis?.result)
            mergedAnalyses[item.slug] = item.analysis;
    }
    return {
        key: record?.key || "",
        slug: record?.slug || savedSlugForRecord(record),
        title: savedPlaylistDisplayTitle(record),
        summary: savedPlaylistMovieScanSummary(videos, mergedAnalyses),
        pendingComments: [],
        processed,
        errors: errors.slice(-40),
        analyses: mergedAnalyses,
    };
}
function normalizeAutomationSettings(input = {}) {
    const settings = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const scheduleTimes = Array.isArray(settings.scheduleTimes)
        ? [...new Set(settings.scheduleTimes.map(normalizeScheduleTime).filter(Boolean))].slice(0, 12)
        : [];
    const maxPostsPerDay = Math.min(Math.max(Number(settings.maxPostsPerDay) || scheduleTimes.length || 1, scheduleTimes.length || 1), 12);
    const sideChannels = Array.isArray(settings.sideChannels)
        ? settings.sideChannels.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 12)
        : [];
    const sourceTags = normalizeSavedSourceTags(settings.sourceTags, 24);
    const compilationMinMinutes = Math.min(Math.max(Number(settings.compilationMinMinutes) || 30, 1), 240);
    return {
        maxPostsPerDay,
        scheduleTimes: scheduleTimes.length ? scheduleTimes : ["09:00"],
        timezone: String(settings.timezone || "Africa/Nairobi").slice(0, 64),
        publishMode: ["schedule", "private", "unlisted"].includes(String(settings.publishMode || "")) ? String(settings.publishMode) : "schedule",
        searchDepth: Math.min(Math.max(Number(settings.searchDepth) || 50, 1), 5000),
        sourcePriority: ["views", "oldest", "newest"].includes(String(settings.sourcePriority || "")) ? String(settings.sourcePriority) : "views",
        movieIdEnabled: settings.movieIdEnabled !== false,
        includeSideChannels: settings.includeSideChannels === true,
        sideChannels,
        sourceTags,
        microNicheGoal: String(settings.microNicheGoal || "").trim().slice(0, 500),
        genreFocus: String(settings.genreFocus || "").trim().slice(0, 160),
        titleStyle: String(settings.titleStyle || "viral-curiosity").trim().slice(0, 80),
        postAsShort: shortsUploadEnabled(settings),
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
        performanceCadenceEnabled: settings.performanceCadenceEnabled !== false,
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
        compilationMinMinutes: compilationMinMinutes,
        compilationMaxMinutes: Math.min(Math.max(Number(settings.compilationMaxMinutes) || 40, compilationMinMinutes), 300),
        compilationMaxClips: Math.min(Math.max(Number(settings.compilationMaxClips) || 300, 1), 1000),
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
    const sourceType = ["saved_playlist", "saved_channel", "saved_tags", "custom_url"].includes(String(body.sourceType || "")) ? String(body.sourceType) : "saved_playlist";
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
async function findAutomationAgentForDirectUpload(userId, accountId, playlistKey = "") {
    const key = normalizePlaylistListUrl(playlistKey);
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
    AND a.youtube_account_id = ${sqlString(accountId)}
  ORDER BY
    CASE
      WHEN ${key ? `lower(a.source_key) = lower(${sqlString(key)}) OR lower(a.source_url) = lower(${sqlString(key)})` : "false"} THEN 0
      WHEN a.status = 'active' THEN 1
      ELSE 2
    END,
    a.updated_at DESC
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
function automationTimingSeed(agent = {}) {
    return `${String(agent.id || "automation-agent")}:${String(agent.youtubeAccountId || agent.youtube_account_id || "publish-channel")}`;
}
async function nextAvailableAutomationRunAt(settings, publishAt, agent = {}) {
    const accountId = String(agent.youtubeAccountId || agent.youtube_account_id || "").trim();
    const agentId = String(agent.id || "").trim();
    let occupied = [];
    if (accountId && postgresConfigured()) {
        const out = await runPsql(`
SELECT COALESCE(json_agg(next_run_at), '[]'::json)
FROM automation_agents
WHERE youtube_account_id = ${sqlString(accountId)}
  AND status = 'active'
  AND next_run_at IS NOT NULL
  ${agentId ? `AND id <> ${sqlString(agentId)}` : ""}
  AND next_run_at > ${sqlString(new Date(new Date(publishAt).getTime() - 5 * 3600_000).toISOString())}::timestamptz
  AND next_run_at < ${sqlString(new Date(publishAt).toISOString())}::timestamptz;
`);
        occupied = JSON.parse(out || "[]");
    }
    return availableStaggeredAutomationRunAt(publishAt, automationTimingSeed(agent), occupied);
}
async function nextAutomationRunAt(settings, fromDate = new Date(), agent = {}) {
    const after = new Date(fromDate);
    let cursor = new Date(after);
    for (let attempt = 0; attempt < 30; attempt += 1) {
        const publishAt = nextAutomationPublishAt(settings, cursor, false);
        const runAt = await nextAvailableAutomationRunAt(settings, publishAt, agent);
        if (runAt.getTime() > after.getTime() + 60_000)
            return runAt;
        cursor = new Date(publishAt.getTime() + 60_000);
    }
    return new Date(after.getTime() + 24 * 3600_000);
}
function sameDayAutomationCatchUpPublishAt(settings, fromDate = new Date()) {
    const normalized = normalizeAutomationSettings(settings);
    return sameDayCatchUpPublishAt(normalized, fromDate, {
        catchUpWindowMinutes: automationCatchUpWindowMinutes(),
        catchUpLeadMinutes: automationCatchUpLeadMinutes(),
        minimumScheduleLeadMinutes: 240,
        timezoneOffsetHours: 3,
    });
}
function scheduledRunCatchUpPublishAt(settings, runAt, fromDate = new Date()) {
    const normalized = normalizeAutomationSettings(settings);
    if (normalized.publishMode !== "schedule")
        return "";
    const scheduledRunAt = new Date(runAt || 0);
    const now = new Date(fromDate);
    if (Number.isNaN(scheduledRunAt.getTime()) || Number.isNaN(now.getTime()))
        return "";
    const target = nextAutomationPublishAt(normalized, scheduledRunAt, false);
    if (Number.isNaN(target.getTime()))
        return "";
    const tooOld = target.getTime() < now.getTime() - automationCatchUpWindowMinutes() * 60_000;
    if (tooOld)
        return "";
    return new Date(Math.max(target.getTime(), now.getTime() + automationCatchUpLeadMinutes() * 60_000)).toISOString();
}
function automationCatchUpPublishAtForDueAgent(item, fromDate = new Date()) {
    const failureCatchUp = String(item?.catchUpPublishAt || item?.catch_up_publish_at || "").trim();
    if (failureCatchUp)
        return failureCatchUp;
    if (!item?.lastRunAt && !item?.last_run_at)
        return sameDayAutomationCatchUpPublishAt(item?.settings || {}, fromDate);
    return scheduledRunCatchUpPublishAt(item?.settings || {}, item?.nextRunAt || item?.next_run_at || "", fromDate);
}
function automationRetryDelayMinutes() {
    return Math.min(Math.max(Number(process.env.AUTOMATION_RETRY_DELAY_MINUTES) || 5, 2), 60);
}
function automationMaxCatchUpRetries() {
    return Math.min(Math.max(Number(process.env.AUTOMATION_MAX_CATCHUP_RETRIES) || 3, 1), 8);
}
function automationCatchUpLeadMinutes() {
    return Math.min(Math.max(Number(process.env.AUTOMATION_CATCHUP_LEAD_MINUTES) || 20, 10), 120);
}
function automationCatchUpWindowMinutes() {
    return Math.min(Math.max(Number(process.env.AUTOMATION_CATCHUP_WINDOW_MINUTES) || 180, 30), 1440);
}
function scheduleMinuteKey(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
        return "";
    date.setUTCSeconds(0, 0);
    return date.toISOString();
}
function deriveYouTubeUploadsPlaylistId(channelId = "") {
    const clean = String(channelId || "").trim();
    if (/^UC[A-Za-z0-9_-]{20,}$/i.test(clean))
        return `UU${clean.slice(2)}`;
    return "";
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
    if (isZernioManagedAccount(account)) {
        return [];
    }
    const uploadsPlaylistId = account?.uploadsPlaylistId || deriveYouTubeUploadsPlaylistId(account?.channelId);
    if (!uploadsPlaylistId || !account?.accessToken)
        return [];
    const ids = [];
    let pageToken = "";
    for (let page = 0; page < 3; page++) {
        const uploadsUrl = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
        uploadsUrl.searchParams.set("part", "contentDetails");
        uploadsUrl.searchParams.set("playlistId", uploadsPlaylistId);
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
async function nextAvailableAutomationPublishAt(settings, account, fromDate = new Date(), includeLead = true) {
    const occupied = await getOccupiedAutomationScheduleMinutes(account);
    let cursor = new Date(fromDate);
    for (let attempt = 0; attempt < 60; attempt++) {
        const candidate = nextAutomationPublishAt(settings, cursor, includeLead);
        if (!occupied.has(scheduleMinuteKey(candidate)))
            return candidate;
        cursor = new Date(candidate.getTime() + 60_000);
    }
    return nextAutomationPublishAt(settings, cursor, includeLead);
}
async function nextAvailableFutureAutomationSlot(settings, account, publishFromDate = new Date(), runAfterDate = new Date(), agent = {}) {
    let cursor = new Date(publishFromDate);
    const runAfter = new Date(runAfterDate);
    for (let attempt = 0; attempt < 30; attempt += 1) {
        const publishAt = await nextAvailableAutomationPublishAt(settings, account, cursor, false);
        const runAt = await nextAvailableAutomationRunAt(settings, publishAt, agent);
        if (runAt.getTime() > runAfter.getTime() + 60_000)
            return { publishAt, runAt };
        cursor = new Date(publishAt.getTime() + 60_000);
    }
    return null;
}
async function nextAvailableCatchUpPublishAt(account, targetDate = new Date()) {
    const occupied = await getOccupiedAutomationScheduleMinutes(account);
    const minPublishAt = Date.now() + automationCatchUpLeadMinutes() * 60_000;
    let candidate = new Date(Math.max(new Date(targetDate).getTime() || 0, minPublishAt));
    candidate.setUTCSeconds(0, 0);
    for (let attempt = 0; attempt < 60; attempt += 1) {
        if (!occupied.has(scheduleMinuteKey(candidate)))
            return candidate;
        candidate = new Date(candidate.getTime() + 60_000);
    }
    return candidate;
}
async function resolveAutomationScheduleAt(settings, account, fromDate = new Date(), options = {}) {
    const normalized = normalizeAutomationSettings(settings);
    if (normalized.publishMode !== "schedule")
        return null;
    const catchUpPublishAt = new Date(options.catchUpPublishAt || 0);
    if (!Number.isNaN(catchUpPublishAt.getTime())) {
        return await nextAvailableCatchUpPublishAt(account, catchUpPublishAt);
    }
    return await nextAvailableAutomationPublishAt(normalized, account, fromDate);
}
async function upsertAutomationAgent(userId, payload) {
    const settings = normalizeAutomationSettings(payload.settings || {});
    if (!payload.youtubeAccountId)
        throw new Error("Choose a publish channel for this agent.");
    const hasSource = Boolean(String(payload.sourceUrl || "").trim()
        || String(payload.sourceKey || "").trim()
        || (payload.sourceType === "saved_tags" && settings.sourceTags.length));
    if (!hasSource)
        throw new Error("Choose a saved source collection, saved tags, or paste a TikTok/YouTube source URL.");
    if (!settings.rightsConfirmed)
        throw new Error("Confirm that this agent will only upload content you have rights to use.");
    const account = await getYouTubeAccount(userId, payload.youtubeAccountId);
    if (!account)
        throw new Error("Publish channel not found for this workspace.");
    if (isTikTokPublishAccount(account) && (!account.zernioApiKey || !account.zernioAccountId)) {
        throw new Error("The selected TikTok channel is not fully connected to Zernio. Reconnect TikTok from Channel Management.");
    }
    const id = payload.id || `agt_${crypto.randomUUID()}`;
    let existingAgent = null;
    if (payload.id) {
        const existingRaw = await runPsql(`
SELECT COALESCE((
  SELECT json_build_object(
    'userId', user_id,
    'status', status,
    'lastRunAt', CASE WHEN last_run_at IS NULL THEN NULL ELSE FLOOR(EXTRACT(EPOCH FROM last_run_at) * 1000)::bigint END
  )
  FROM automation_agents
  WHERE id = ${sqlString(id)}
  LIMIT 1
), 'null'::json);
`);
        existingAgent = JSON.parse(existingRaw || "null");
        if (existingAgent?.userId && existingAgent.userId !== userId)
            throw new Error("Automation agent not found.");
    }
    const slug = await automationAgentSlugForSave(id, payload.name);
    const firstRunCatchUpAt = payload.status === "active" && !existingAgent?.lastRunAt
        ? sameDayAutomationCatchUpPublishAt(payload.settings)
        : "";
    const nextRun = firstRunCatchUpAt
        ? new Date()
        : await nextAutomationRunAt(payload.settings, new Date(), { id, youtubeAccountId: payload.youtubeAccountId });
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
function normalizeManualMovieCorrectionInput(body = {}) {
    const title = String(body.title || body.movieTitle || "").trim();
    const year = String(body.year || body.movieYear || "").match(/\d{4}/)?.[0] || "";
    const mediaType = normalizeMediaHint(body.mediaType || body.type || "");
    return {
        title,
        year,
        mediaType: mediaType === "auto" ? "" : mediaType,
    };
}
function manualCorrectionMediaHint(input, upload) {
    const existing = upload?.metrics?.movie || {};
    const values = [
        input.mediaType,
        existing.mediaType,
        existing.mal?.type,
        existing.tmdb?.mediaType,
        upload?.genre,
        upload?.microNiche,
        upload?.title,
    ].filter(Boolean).join(" ");
    if (/\b(anime|manga|manhwa|manhua|donghua|webtoon)\b/i.test(values))
        return /\b(manga|manhwa|manhua|webtoon)\b/i.test(values) ? "manga" : "anime";
    if (/\b(tv|series|show)\b/i.test(values))
        return "tv";
    if (/\b(movie|film)\b/i.test(values))
        return "movie";
    return "";
}
async function correctAutomationUploadMovieId(userId, uploadId, body = {}) {
    const input = normalizeManualMovieCorrectionInput(body);
    if (!input.title) {
        const error = new Error("Corrected title is required.");
        error.statusCode = 400;
        throw error;
    }
    const upload = await getAutomationUploadForUser(userId, uploadId);
    if (!upload) {
        const error = new Error("Automation upload not found.");
        error.statusCode = 404;
        throw error;
    }
    const previousMovie = upload.metrics?.movie || {};
    const mediaHint = manualCorrectionMediaHint(input, upload);
    const enriched = preferEnglishAnimeResultTitle(await enrichServerMovieResult({
        ...previousMovie,
        title: input.title,
        year: input.year,
        mediaType: mediaHint,
        genre: mediaHint || previousMovie.genre || upload.genre || "",
        confidence: 1,
        summary: "",
    }));
    const candidate = databaseSummaryCandidate(enriched);
    if (!candidate) {
        const error = new Error("No fresh TMDB or MAL record with a usable summary was found for that correction.");
        error.statusCode = 404;
        throw error;
    }
    const corrected = {
        ...verifiedMovieIdResult(enriched, candidate, {
            confidence: 1,
            reason: `Manual correction confirmed against fresh ${candidate.provider.toUpperCase()} data.`,
        }),
        manualCorrection: true,
        sourceVerification: {
            verified: true,
            status: "manual_database_correction",
            provider: candidate.provider,
            databaseId: candidate.id,
            databaseTitle: candidate.title,
            reason: `Manual correction confirmed against fresh ${candidate.provider.toUpperCase()} summary data.`,
            confidence: 1,
        },
        evidence: {
            ...(previousMovie.evidence || {}),
            reasoning: `Manually corrected to ${candidate.title}${candidate.year ? ` (${candidate.year})` : ""} and refreshed from ${candidate.provider.toUpperCase()}.`,
        },
        summary: enriched.summary || candidate.summary || previousMovie.summary || "",
    };
    const correctedGenres = officialGenresFromAutomationMovie(corrected);
    const genre = correctedGenres[0] || corrected.genre || upload.genre || "";
    const updatedMetrics = {
        ...(upload.metrics || {}),
        movie: corrected,
        movieGenres: correctedGenres,
        movieGenreSource: corrected?.mal?.genres?.length ? "mal" : corrected?.tmdb?.genres?.length ? "tmdb" : correctedGenres.length ? "movie_id" : "",
        movieCorrection: {
            correctedAt: new Date().toISOString(),
            provider: candidate.provider,
            databaseId: candidate.id,
            previous: {
                title: upload.movieTitle || previousMovie.title || "",
                year: upload.movieYear || previousMovie.year || "",
                provider: previousMovie.mal?.id ? "mal" : previousMovie.tmdb?.id ? "tmdb" : "",
                databaseId: previousMovie.mal?.id || previousMovie.tmdb?.id || "",
            },
            current: {
                title: corrected.title,
                year: corrected.year || candidate.year || "",
                provider: candidate.provider,
                databaseId: candidate.id,
            },
        },
    };
    await runPsql(`
UPDATE automation_uploads u
SET movie_key = ${sqlString(movieKeyFromResult(corrected))},
    movie_title = ${sqlString(corrected.title || candidate.title || input.title)},
    movie_year = ${sqlString(String(corrected.year || candidate.year || input.year || "").match(/\d{4}/)?.[0] || "")},
    genre = ${sqlString(genre)},
    metrics = ${jsonbLiteral(updatedMetrics)},
    updated_at = now()
FROM automation_agents a
WHERE a.id = u.agent_id
  AND a.user_id = ${sqlString(userId)}
  AND u.id = ${sqlString(uploadId)};
`);
    await Promise.all([
        storeMovieIdentificationCache({
            sourceType: upload.youtubeVideoId ? "youtube" : "url",
            youtubeVideoId: upload.youtubeVideoId || "",
            normalizedUrl: upload.youtubeUrl || "",
        }, corrected).catch((error) => console.warn("Manual correction YouTube cache write skipped:", error instanceof Error ? error.message : error)),
        storeMovieIdentificationCache(movieCacheLookupFromUrl(upload.sourceUrl || ""), corrected).catch((error) => console.warn("Manual correction source cache write skipped:", error instanceof Error ? error.message : error)),
    ]);
    await recordAutomationLearningSignal(uploadId).catch((error) => console.warn("Manual correction learning refresh skipped:", error instanceof Error ? error.message : error));
    return { upload: await getAutomationUploadForUser(userId, uploadId), result: corrected };
}

function durationBucketFromSeconds(seconds) {
    const s = Number(seconds || 0);
    if (!Number.isFinite(s) || s <= 0)
        return "unknown";
    if (s <= 30)
        return "0-30s";
    if (s <= 60)
        return "31-60s";
    if (s <= 90)
        return "61-90s";
    if (s <= 180)
        return "91-180s";
    if (s <= 600)
        return "3-10m";
    return "10m+";
}
function inferHookPatternFromText(title = "", genre = "", microNiche = "") {
    const text = `${title} ${genre} ${microNiche}`.toLowerCase();
    if (/(cycling|bike|bicycle|cadence|mountain|race|sports|training|team|match|tournament)/i.test(text))
        return "sports-technique";
    if (/(martial|fighter|fighting|muscle|strength|technique|poison|forbidden|blood|battle)/i.test(text))
        return "martial-stakes";
    if (/(implant|cyber|robot|machine|spine|body|modification|faster|bullet)/i.test(text))
        return "body-upgrade";
    if (/(weak|trash|lazy|underdog|hidden|secret|underestimated|everyone laughed|proved)/i.test(text))
        return "underdog-reveal";
    if (/(god|demon|monkey king|wukong|myth|ancestor|sealed|legend)/i.test(text))
        return "mythic-power";
    if (/(betray|revenge|exiled|abandoned|clan|loyal|master)/i.test(text))
        return "betrayal-comeback";
    if (/(murder|detective|killer|crime|mystery|exposed)/i.test(text))
        return "mystery-reveal";
    if (/(fruit|apple|orange|sadstory|moral|lesson)/i.test(text))
        return "moral-story";
    if (/(geo|country|island|continent|hurricane|location|border|nation)/i.test(text))
        return "geo-facts";
    return "curiosity-recap";
}
function extractContentTaxonomy(movie = {}, fallback = {}) {
    const niche = movie?.contentNiche || {};
    const transcript = movie?.transcript || {};
    const existingTaxonomy = fallback.taxonomy || {};
    const primary = String(niche.primary || existingTaxonomy.primary || fallback.genre || movie.genre || "").trim();
    const subNiche = String(niche.subNiche || niche.secondary?.[0] || existingTaxonomy.subNiche || fallback.subNiche || "").trim();
    const microSubNiche = String(niche.microSubNiche || existingTaxonomy.microSubNiche || fallback.microNiche || "").trim();
    const hookPattern = String(niche.hookPattern || existingTaxonomy.hookPattern || fallback.hookPattern || inferHookPatternFromText(fallback.title || movie.title || "", primary, microSubNiche)).trim();
    const contentFormat = String(niche.contentFormat || existingTaxonomy.contentFormat || transcript.contentStyle?.[0] || fallback.contentFormat || "").trim();
    const transcriptText = String(transcript.fullText || transcript.excerpt || "").trim();
    return {
        primary,
        subNiche,
        microSubNiche,
        hookPattern,
        contentFormat,
        audience: String(niche.audience || existingTaxonomy.audience || "").trim(),
        rationale: String(niche.rationale || existingTaxonomy.rationale || "").trim(),
        opportunities: Array.isArray(niche.opportunities) ? niche.opportunities.slice(0, 8) : Array.isArray(existingTaxonomy.opportunities) ? existingTaxonomy.opportunities.slice(0, 8) : [],
        transcriptHooks: Array.isArray(transcript.hooks) ? transcript.hooks.slice(0, 8) : Array.isArray(existingTaxonomy.transcriptHooks) ? existingTaxonomy.transcriptHooks.slice(0, 8) : [],
        transcriptStructure: Array.isArray(transcript.structure) ? transcript.structure.slice(0, 8) : Array.isArray(existingTaxonomy.transcriptStructure) ? existingTaxonomy.transcriptStructure.slice(0, 8) : [],
        transcriptExcerpt: (transcriptText || String(existingTaxonomy.transcriptExcerpt || "")).slice(0, 1200),
    };
}
function publishParts(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime()))
        return { hour: 0, day: 0 };
    return { hour: date.getUTCHours(), day: date.getUTCDay() };
}
function performanceScore(views, likes, comments) {
    const v = Number(views || 0);
    const l = Number(likes || 0);
    const c = Number(comments || 0);
    return Math.round((v + l * 35 + c * 120) * 100) / 100;
}
function sourceStat(video, key) {
    return Number(video?.stats?.[key] || video?.stats?.[key.replace("Count", "")] || video?.[key] || 0) || 0;
}
async function recordAutomationLearningSignal(uploadId) {
    if (!postgresConfigured() || !uploadId)
        return null;
    const out = await runPsql(`
SELECT COALESCE((
  SELECT json_build_object(
    'id', u.id, 'agentId', u.agent_id, 'userId', u.user_id, 'accountId', u.youtube_account_id,
    'sourceUrl', u.source_url, 'sourceVideoId', u.source_video_id, 'sourceAuthor', u.source_author,
    'genre', u.genre, 'microNiche', u.micro_niche, 'title', u.title, 'scheduleAt', u.schedule_at,
    'createdAt', u.created_at, 'metrics', u.metrics
  )
  FROM automation_uploads u
  WHERE u.id = ${sqlString(uploadId)}
), 'null'::json);
`);
    const upload = JSON.parse(out || "null");
    if (!upload)
        return null;
    const metrics = upload.metrics || {};
    const publicStats = metrics.publicStats || {};
    const sourceStats = metrics.sourceStats || {};
    const sourceIdentity = metrics.sourceIdentity || {};
    const taxonomy = extractContentTaxonomy(metrics.movie || sourceIdentity || {}, {
        title: upload.title,
        genre: upload.genre,
        microNiche: upload.microNiche,
        taxonomy: metrics.taxonomy || {},
    });
    const sourceTitle = String(metrics.sourceTitle || sourceIdentity.title || upload.title || "");
    const durationSeconds = Number(metrics.sourceDurationSeconds || sourceIdentity.durationSeconds || 0);
    const publish = publishParts(upload.scheduleAt || upload.createdAt);
    const views = Number(publicStats.viewCount || 0);
    const likes = Number(publicStats.likeCount || 0);
    const comments = Number(publicStats.commentCount || 0);
    const score = performanceScore(views, likes, comments);
    const hookPattern = taxonomy.hookPattern || inferHookPatternFromText(upload.title, upload.genre, upload.microNiche);
    const durationBucket = durationBucketFromSeconds(durationSeconds);
    await runPsql(`
INSERT INTO agent_content_signals (
  upload_id, agent_id, user_id, youtube_account_id, source_author, source_url, source_video_id,
  source_views, source_likes, source_comments, genre, micro_niche, hook_pattern, duration_bucket,
  publish_hour, publish_day, youtube_views, youtube_likes, youtube_comments, score, metadata, created_at, updated_at
)
VALUES (
  ${sqlString(upload.id)}, ${sqlString(upload.agentId)}, ${sqlString(upload.userId)}, ${sqlString(upload.accountId)},
  ${sqlString(upload.sourceAuthor || "")}, ${sqlString(upload.sourceUrl || "")}, ${sqlString(upload.sourceVideoId || "")},
  ${sqlNumber(sourceStats.playCount || sourceStats.viewCount || 0)}, ${sqlNumber(sourceStats.diggCount || sourceStats.likeCount || 0)}, ${sqlNumber(sourceStats.commentCount || 0)},
  ${sqlString(upload.genre || "")}, ${sqlString(upload.microNiche || "")}, ${sqlString(hookPattern)}, ${sqlString(durationBucket)},
  ${sqlNumber(publish.hour)}, ${sqlNumber(publish.day)}, ${sqlNumber(views)}, ${sqlNumber(likes)}, ${sqlNumber(comments)}, ${sqlNumber(score)},
  ${jsonbLiteral({ sourceTitle, durationSeconds, movie: metrics.movie || null, taxonomy, transcriptExcerpt: taxonomy.transcriptExcerpt, analytics: metrics.analytics || null })}, ${sqlString(upload.createdAt)}::timestamptz, now()
)
ON CONFLICT (upload_id) DO UPDATE SET
  source_author = EXCLUDED.source_author,
  source_views = EXCLUDED.source_views,
  genre = EXCLUDED.genre,
  micro_niche = EXCLUDED.micro_niche,
  hook_pattern = EXCLUDED.hook_pattern,
  duration_bucket = EXCLUDED.duration_bucket,
  publish_hour = EXCLUDED.publish_hour,
  publish_day = EXCLUDED.publish_day,
  youtube_views = EXCLUDED.youtube_views,
  youtube_likes = EXCLUDED.youtube_likes,
  youtube_comments = EXCLUDED.youtube_comments,
  score = EXCLUDED.score,
  metadata = EXCLUDED.metadata,
  updated_at = now();
`);
    await runPsql(`
INSERT INTO agent_learning_events (
  id, agent_id, user_id, youtube_account_id, event_type, source_type, source_id,
  taxonomy, metrics, recommendation, created_at
)
VALUES (
  ${sqlString(stableId("learn", [upload.id, score, hookPattern, durationBucket]))}, ${sqlString(upload.agentId)}, ${sqlString(upload.userId)}, ${sqlString(upload.accountId)},
  'content_signal', 'automation_upload', ${sqlString(upload.id)},
  ${jsonbLiteral(taxonomy)},
  ${jsonbLiteral({
        sourceTitle,
        durationSeconds,
        sourceViews: sourceStats.playCount || sourceStats.viewCount || 0,
        youtubeViews: views,
        youtubeLikes: likes,
        youtubeComments: comments,
        score,
        hookPattern,
        durationBucket,
        publishHour: publish.hour,
        publishDay: publish.day,
    })},
  ${sqlString(`Learned ${taxonomy.microSubNiche || upload.microNiche || "this niche"} with ${hookPattern} at ${durationBucket}; compare future uploads against ${plainNumber(views)} views.`)},
  now()
)
ON CONFLICT (id) DO NOTHING;
`);
    await rebuildAgentLearningProfile(upload.agentId).catch((error) => console.warn("Agent learning rebuild failed:", error instanceof Error ? error.message : error));
    return upload;
}
function topRows(rows, key = "score", limit = 6) {
    return [...rows].sort((a, b) => Number(b[key] || 0) - Number(a[key] || 0)).slice(0, limit);
}
async function rebuildAgentLearningProfile(agentId) {
    if (!postgresConfigured() || !agentId)
        return null;
    const out = await runPsql(`
SELECT COALESCE(json_agg(json_build_object(
  'uploadId', upload_id,
  'agentId', agent_id,
  'userId', user_id,
  'accountId', youtube_account_id,
  'sourceAuthor', source_author,
  'sourceUrl', source_url,
  'sourceViews', source_views,
  'genre', genre,
  'microNiche', micro_niche,
  'hookPattern', hook_pattern,
  'durationBucket', duration_bucket,
  'publishHour', publish_hour,
  'publishDay', publish_day,
  'youtubeViews', youtube_views,
  'youtubeLikes', youtube_likes,
  'youtubeComments', youtube_comments,
  'score', score,
  'metadata', metadata,
  'createdAt', FLOOR(EXTRACT(EPOCH FROM created_at) * 1000)::bigint
) ORDER BY score DESC, created_at DESC), '[]'::json)
FROM agent_content_signals
WHERE agent_id = ${sqlString(agentId)};
`);
    const signals = JSON.parse(out || "[]");
    const agentOut = await runPsql(`SELECT COALESCE((SELECT json_build_object('userId', user_id, 'accountId', youtube_account_id, 'settings', settings) FROM automation_agents WHERE id = ${sqlString(agentId)}), 'null'::json);`);
    const agent = JSON.parse(agentOut || "null");
    if (!agent)
        return null;
    const bucket = (field) => {
        const map = new Map();
        for (const signal of signals) {
            const label = String(signal[field] || "").trim() || "Unknown";
            const row = map.get(label) || { label, uploads: 0, views: 0, likes: 0, comments: 0, score: 0 };
            row.uploads += 1;
            row.views += Number(signal.youtubeViews || 0);
            row.likes += Number(signal.youtubeLikes || 0);
            row.comments += Number(signal.youtubeComments || 0);
            row.score += Number(signal.score || 0);
            map.set(label, row);
        }
        return topRows([...map.values()], "score", 8);
    };
    const taxonomyBucket = (field) => {
        const map = new Map();
        for (const signal of signals) {
            const label = String(signal.metadata?.taxonomy?.[field] || "").trim() || "Unknown";
            const row = map.get(label) || { label, uploads: 0, views: 0, likes: 0, comments: 0, score: 0 };
            row.uploads += 1;
            row.views += Number(signal.youtubeViews || 0);
            row.likes += Number(signal.youtubeLikes || 0);
            row.comments += Number(signal.youtubeComments || 0);
            row.score += Number(signal.score || 0);
            map.set(label, row);
        }
        return topRows([...map.values()].filter((row) => row.label !== "Unknown"), "score", 8);
    };
    const profile = {
        generatedAt: new Date().toISOString(),
        samples: signals.length,
        totalViews: signals.reduce((sum, item) => sum + Number(item.youtubeViews || 0), 0),
        bestSignals: topRows(signals, "score", 8),
        bestGenres: bucket("genre"),
        bestMicroNiches: bucket("microNiche"),
        bestPrimaryNiches: taxonomyBucket("primary"),
        bestSubNiches: taxonomyBucket("subNiche"),
        bestTranscriptMicroNiches: taxonomyBucket("microSubNiche"),
        bestFormats: taxonomyBucket("contentFormat"),
        bestSources: bucket("sourceAuthor"),
        bestHooks: bucket("hookPattern"),
        bestDurations: bucket("durationBucket"),
        bestHours: bucket("publishHour"),
        exploreRate: signals.length < 8 ? 0.45 : 0.25,
    };
    const bestMsn = profile.bestMicroNiches[0]?.label || "";
    const bestHook = profile.bestHooks[0]?.label || "";
    const bestSource = profile.bestSources[0]?.label || "";
    const summary = signals.length
        ? `${bestMsn || "A niche cluster"} is leading with ${profile.bestMicroNiches[0]?.views || 0} views; strongest hook is ${bestHook || "still forming"}.`
        : "No upload performance has been captured yet.";
    const recommendation = signals.length
        ? `Prioritize ${bestMsn || agent.settings?.microNicheGoal || "the current MSN"} from ${bestSource || "the best source"} using ${bestHook || "curiosity"} hooks; keep exploring adjacent clips until 24h checks confirm a better cluster.`
        : "Run at least three candidates, then the agent can start exploiting winners and exploring adjacent niches.";
    const confidence = Math.min(0.95, Math.round((signals.length / 12) * 100) / 100);
    await runPsql(`
INSERT INTO agent_learning_profiles (agent_id, user_id, youtube_account_id, profile, summary, recommendation, confidence, updated_at)
VALUES (${sqlString(agentId)}, ${sqlString(agent.userId)}, ${sqlString(agent.accountId)}, ${jsonbLiteral(profile)}, ${sqlString(summary)}, ${sqlString(recommendation)}, ${sqlNumber(confidence)}, now())
ON CONFLICT (agent_id) DO UPDATE SET
  profile = EXCLUDED.profile,
  summary = EXCLUDED.summary,
  recommendation = EXCLUDED.recommendation,
  confidence = EXCLUDED.confidence,
  updated_at = now();
`);
    await refreshAgentNicheObservations(agentId, profile, agent).catch((error) => console.warn("Niche observation refresh failed:", error instanceof Error ? error.message : error));
    await refreshCompetitorSeeds(agentId, profile, agent).catch((error) => console.warn("Competitor seed refresh failed:", error instanceof Error ? error.message : error));
    return { profile, summary, recommendation, confidence };
}
async function getAgentLearningProfile(agentId) {
    if (!postgresConfigured() || !agentId)
        return null;
    const out = await runPsql(`
SELECT COALESCE((
  SELECT json_build_object(
    'profile', profile,
    'summary', summary,
    'recommendation', recommendation,
    'confidence', confidence,
    'updatedAt', FLOOR(EXTRACT(EPOCH FROM updated_at) * 1000)::bigint
  )
  FROM agent_learning_profiles
  WHERE agent_id = ${sqlString(agentId)}
), 'null'::json);
`);
    return JSON.parse(out || "null");
}
async function rebuildAllAutomationLearning(limit = 40) {
    if (!postgresConfigured())
        return;
    const out = await runPsql(`
SELECT COALESCE(json_agg(id), '[]'::json)
FROM (
  SELECT id FROM automation_uploads
  WHERE youtube_video_id <> ''
  ORDER BY updated_at DESC
  LIMIT ${sqlNumber(limit)}
) uploads;
`);
    const ids = JSON.parse(out || "[]");
    for (const id of ids) {
        await recordAutomationLearningSignal(id).catch((error) => console.warn("Learning backfill failed:", error instanceof Error ? error.message : error));
    }
}
function inferMacroFromAgentSettings(settings = {}, msn = "") {
    const text = `${settings.genreFocus || ""} ${settings.microNicheGoal || ""} ${msn}`.toLowerCase();
    if (/(anime|manga|donghua|manhwa|webtoon)/i.test(text))
        return { macro: "Entertainment", sub: "Anime and Manga Recaps" };
    if (/(movie|film|recap|cinema)/i.test(text))
        return { macro: "Entertainment", sub: "Movie Recaps" };
    if (/(geo|country|location|travel|map)/i.test(text))
        return { macro: "Education", sub: "Geography Facts" };
    if (/(fruit|animation|cartoon|story)/i.test(text))
        return { macro: "Entertainment", sub: "Animated Story Channels" };
    return { macro: "Creator-discovered", sub: "Agent-discovered MSNs" };
}
async function refreshAgentNicheObservations(agentId, profile, agent) {
    for (const niche of (profile.bestMicroNiches || []).slice(0, 8)) {
        const msn = String(niche.label || "").trim();
        if (!msn || msn === "Unknown")
            continue;
        const { macro, sub } = inferMacroFromAgentSettings(agent.settings || {}, msn);
        const id = `obs_${crypto.createHash("sha1").update(`${agentId}:${msn}`).digest("hex").slice(0, 24)}`;
        const confidence = Math.min(0.95, Math.max(0.1, Number(niche.uploads || 0) / 6 + Math.min(Number(niche.views || 0) / 100000, 0.4)));
        await runPsql(`
INSERT INTO agent_niche_observations (id, agent_id, user_id, youtube_account_id, micro_niche, macro_niche, sub_niche, evidence, uploads, total_views, best_views, confidence, status, updated_at)
VALUES (
  ${sqlString(id)}, ${sqlString(agentId)}, ${sqlString(agent.userId)}, ${sqlString(agent.accountId)}, ${sqlString(msn)},
  ${sqlString(macro)}, ${sqlString(sub)}, ${jsonbLiteral({ bestHooks: profile.bestHooks || [], bestSources: profile.bestSources || [], bestSignals: profile.bestSignals || [] })},
  ${sqlNumber(niche.uploads || 0)}, ${sqlNumber(niche.views || 0)}, ${sqlNumber(Math.max(...(profile.bestSignals || []).filter((s) => s.microNiche === msn).map((s) => Number(s.youtubeViews || 0)), Number(niche.views || 0)))},
  ${sqlNumber(confidence)}, ${sqlString(Number(niche.views || 0) >= 10000 || Number(niche.uploads || 0) >= 3 ? "promoted" : "candidate")}, now()
)
ON CONFLICT (agent_id, micro_niche) DO UPDATE SET
  evidence = EXCLUDED.evidence,
  uploads = EXCLUDED.uploads,
  total_views = EXCLUDED.total_views,
  best_views = EXCLUDED.best_views,
  confidence = EXCLUDED.confidence,
  status = EXCLUDED.status,
  updated_at = now();
`);
        if (Number(niche.views || 0) >= 10000) {
            const libraryId = `agent-${crypto.createHash("sha1").update(`${agentId}:${msn}`).digest("hex").slice(0, 16)}`;
            await runPsql(`
INSERT INTO niche_library (
  id, macro_niche, sub_niche, msn, faceless_formats, target_countries, geo_tier, cpm_tier, rpm_range,
  competition, audience_value, trend_score, monetization_stack, creator_fit, acquisition_queries,
  channel_angles, hook_patterns, seed_keywords, risk_notes, source_refs, updated_at
)
VALUES (
  ${sqlString(libraryId)}, ${sqlString(macro)}, ${sqlString(sub)}, ${sqlString(msn)},
  ${jsonbLiteral(["Short-form recaps", "Compilation tests", "Series playlist clusters"])}, ${jsonbLiteral(["US", "UK", "CA", "AU"])},
  ${sqlString("Tier 1 + global")}, ${sqlString("Medium")}, ${sqlString("$1.50-$6.00")}, ${sqlString("Measured")},
  ${sqlString(`Discovered from automation performance: ${niche.uploads} uploads, ${niche.views} views.`)}, ${sqlNumber(Math.min(99, Math.max(55, Math.round(Number(niche.views || 0) / 7000) + 55)))},
  ${jsonbLiteral(["YouTube Partner Program", "series playlists", "affiliate/contextual offers"])}, ${sqlString("Best for channels already proving this micro-sub-niche in Shorts.")},
  ${jsonbLiteral([msn, agent.settings?.genreFocus || "", agent.settings?.microNicheGoal || ""].filter(Boolean))},
  ${jsonbLiteral((profile.bestHooks || []).slice(0, 5).map((h) => h.label))}, ${jsonbLiteral((profile.bestHooks || []).slice(0, 5).map((h) => h.label))},
  ${jsonbLiteral([msn, ...(profile.bestSources || []).slice(0, 4).map((s) => s.label)])}, ${sqlString("Agent-discovered niche. Validate rights, audience fit, and retention before scaling aggressively.")},
  ${jsonbLiteral(["agent-learning", agentId])}, now()
)
ON CONFLICT (id) DO UPDATE SET
  trend_score = GREATEST(niche_library.trend_score, EXCLUDED.trend_score),
  audience_value = EXCLUDED.audience_value,
  channel_angles = EXCLUDED.channel_angles,
  hook_patterns = EXCLUDED.hook_patterns,
  seed_keywords = EXCLUDED.seed_keywords,
  source_refs = EXCLUDED.source_refs,
  updated_at = now();
`);
        }
    }
}
async function refreshCompetitorSeeds(agentId, profile, agent) {
    for (const source of (profile.bestSources || []).slice(0, 6)) {
        const label = String(source.label || "").trim();
        if (!label || label === "Unknown")
            continue;
        const id = `cmp_${crypto.createHash("sha1").update(`${agent.accountId}:${label}`).digest("hex").slice(0, 24)}`;
        const url = /^https?:/i.test(label) ? label : `https://www.tiktok.com/@${label.replace(/^@/, "")}`;
        await runPsql(`
INSERT INTO competitor_channels (id, user_id, youtube_account_id, source_type, channel_title, channel_url, channel_handle, niche, reason, metrics, updated_at)
VALUES (
  ${sqlString(id)}, ${sqlString(agent.userId)}, ${sqlString(agent.accountId)}, 'auto-source',
  ${sqlString(label)}, ${sqlString(url)}, ${sqlString(label.replace(/^@/, ""))}, ${sqlString(profile.bestMicroNiches?.[0]?.label || agent.settings?.genreFocus || "")},
  ${sqlString("Auto-added because this source is producing the strongest automation uploads.")},
  ${jsonbLiteral({ views: source.views || 0, uploads: source.uploads || 0, score: source.score || 0, agentId })}, now()
)
ON CONFLICT (youtube_account_id, channel_url) DO UPDATE SET
  metrics = EXCLUDED.metrics,
  reason = EXCLUDED.reason,
  niche = EXCLUDED.niche,
  updated_at = now();
`);
    }
}
function agentLearningThresholdViews() {
    return Math.max(Number(process.env.AGENT_SOURCE_PROMOTION_MIN_VIEWS) || 10000, 1000);
}
function stableAgentJitter(value = "", min = 0, max = 0) {
    const lower = Math.min(Number(min) || 0, Number(max) || 0);
    const upper = Math.max(Number(min) || 0, Number(max) || 0);
    if (upper <= lower)
        return lower;
    const hash = crypto.createHash("sha1").update(String(value || "agent")).digest("hex").slice(0, 8);
    return lower + (parseInt(hash, 16) % (upper - lower + 1));
}
function normalizeSourceIdentity(value = "") {
    return String(value || "")
        .trim()
        .split("#")[0]
        .split("?")[0]
        .replace(/\/+$/, "")
        .toLowerCase();
}
async function getPromotedAgentSourceChannels(agent, limit = 8) {
    if (!postgresConfigured() || !agent?.id || agent?.settings?.dynamicSourceLearning === false)
        return [];
    const minViews = agentLearningThresholdViews();
    const out = await runPsql(`
SELECT COALESCE(json_agg(json_build_object(
  'author', source_author,
  'url', 'https://www.tiktok.com/@' || regexp_replace(source_author, '^@', ''),
  'uploads', uploads,
  'totalViews', total_views,
  'bestViews', best_views,
  'avgViews', avg_views,
  'hits10k', hits_10k,
  'score', source_score
) ORDER BY source_score DESC, hits_10k DESC, total_views DESC), '[]'::json)
FROM (
  SELECT
    source_author,
    COUNT(*) AS uploads,
    SUM(youtube_views) AS total_views,
    MAX(youtube_views) AS best_views,
    AVG(youtube_views)::int AS avg_views,
    SUM(CASE WHEN youtube_views >= ${sqlNumber(minViews)} THEN 1 ELSE 0 END) AS hits_10k,
    (SUM(CASE WHEN youtube_views >= ${sqlNumber(minViews)} THEN 1 ELSE 0 END) * 120
      + LEAST(MAX(youtube_views), 100000) / 1000.0
      + COUNT(*) * 4
      + AVG(youtube_views) / 500.0) AS source_score
  FROM agent_content_signals
  WHERE agent_id = ${sqlString(agent.id)}
    AND source_author <> ''
    AND created_at > now() - interval '60 days'
  GROUP BY source_author
  HAVING MAX(youtube_views) >= ${sqlNumber(minViews)}
      OR SUM(CASE WHEN youtube_views >= ${sqlNumber(minViews)} THEN 1 ELSE 0 END) >= 2
      OR (COUNT(*) >= 3 AND AVG(youtube_views) >= ${sqlNumber(Math.round(minViews * 0.6))})
  ORDER BY source_score DESC
  LIMIT ${sqlNumber(limit)}
) ranked_sources;
`);
    return JSON.parse(out || "[]").filter((row) => row?.author && row?.url);
}
async function buildAgentPerformanceReport(agentId) {
    if (!postgresConfigured() || !agentId)
        return null;
    const out = await runPsql(`
WITH recent_uploads AS (
  SELECT
    u.*,
    COALESCE((u.metrics->'publicStats'->>'viewCount')::bigint, 0) AS views,
    COALESCE((u.metrics->'publicStats'->>'likeCount')::bigint, 0) AS likes,
    COALESCE((u.metrics->'publicStats'->>'commentCount')::bigint, 0) AS comments
  FROM automation_uploads u
  WHERE u.agent_id = ${sqlString(agentId)}
    AND u.created_at > now() - interval '30 days'
),
source_rows AS (
  SELECT
    source_author,
    COUNT(*) AS uploads,
    SUM(views) AS views,
    MAX(views) AS best_views,
    AVG(views)::int AS avg_views,
    SUM(CASE WHEN views >= 10000 THEN 1 ELSE 0 END) AS hits_10k
  FROM recent_uploads
  WHERE source_author <> ''
  GROUP BY source_author
),
run_rows AS (
  SELECT status, COUNT(*) AS count
  FROM automation_runs
  WHERE agent_id = ${sqlString(agentId)}
    AND started_at > now() - interval '7 days'
  GROUP BY status
)
SELECT json_build_object(
  'generatedAt', now(),
  'windowDays', 30,
  'uploads30d', (SELECT COUNT(*) FROM recent_uploads),
  'views30d', COALESCE((SELECT SUM(views) FROM recent_uploads), 0),
  'likes30d', COALESCE((SELECT SUM(likes) FROM recent_uploads), 0),
  'comments30d', COALESCE((SELECT SUM(comments) FROM recent_uploads), 0),
  'avgViews30d', COALESCE((SELECT AVG(views)::int FROM recent_uploads), 0),
  'bestViews30d', COALESCE((SELECT MAX(views) FROM recent_uploads), 0),
  'uploadsAbove1k', COALESCE((SELECT COUNT(*) FROM recent_uploads WHERE views >= 1000), 0),
  'uploadsAbove10k', COALESCE((SELECT COUNT(*) FROM recent_uploads WHERE views >= 10000), 0),
  'recentFailures7d', COALESCE((SELECT SUM(count) FROM run_rows WHERE status IN ('error','failed')), 0),
  'recentSuccess7d', COALESCE((SELECT SUM(count) FROM run_rows WHERE status = 'success'), 0),
  'topSources', COALESCE((SELECT json_agg(json_build_object(
    'author', source_author,
    'uploads', uploads,
    'views', views,
    'bestViews', best_views,
    'avgViews', avg_views,
    'hits10k', hits_10k,
    'promoted', hits_10k > 0 OR avg_views >= 6000
  ) ORDER BY hits_10k DESC, views DESC) FROM source_rows), '[]'::json),
  'weakSources', COALESCE((SELECT json_agg(json_build_object(
    'author', source_author,
    'uploads', uploads,
    'views', views,
    'bestViews', best_views,
    'avgViews', avg_views
  ) ORDER BY uploads DESC, views ASC) FROM source_rows WHERE uploads >= 3 AND best_views < 1000), '[]'::json),
  'latestRuns', COALESCE((SELECT json_agg(json_build_object(
    'status', status,
    'message', message,
    'startedAt', FLOOR(EXTRACT(EPOCH FROM started_at) * 1000)::bigint,
    'finishedAt', CASE WHEN finished_at IS NULL THEN NULL ELSE FLOOR(EXTRACT(EPOCH FROM finished_at) * 1000)::bigint END,
    'details', details
  ) ORDER BY started_at DESC) FROM (
    SELECT * FROM automation_runs WHERE agent_id = ${sqlString(agentId)} ORDER BY started_at DESC LIMIT 10
  ) r), '[]'::json)
) AS report;
`);
    const report = JSON.parse(out || "null");
    if (!report)
        return null;
    const topSources = Array.isArray(report.topSources) ? report.topSources : [];
    const weakSources = Array.isArray(report.weakSources) ? report.weakSources : [];
    const recommendations = [];
    if (topSources.some((source) => source.promoted)) {
        recommendations.push("Use promoted source channels from recent 10k+ winners before broad collection picks.");
    }
    if (Number(report.uploads30d || 0) >= 3 && Number(report.uploadsAbove1k || 0) === 0) {
        recommendations.push("Throttle cadence to every 2-3 days and randomize the next slot until one upload reaches 1k views.");
    }
    if (weakSources.length) {
        recommendations.push(`Avoid weak source authors for now: ${weakSources.slice(0, 4).map((source) => source.author).join(", ")}.`);
    }
    if (Number(report.recentFailures7d || 0) > Number(report.recentSuccess7d || 0)) {
        recommendations.push("Fix source freshness or downloader quality before increasing cadence.");
    }
    if (!recommendations.length) {
        recommendations.push("Keep current cadence while collecting more 24h performance snapshots.");
    }
    return { ...report, recommendations };
}
async function performanceAwareNextRunAt(agent, settings, account, proposedRunAt) {
    if (!postgresConfigured() || !agent?.id || settings?.performanceCadenceEnabled === false)
        return proposedRunAt;
    const out = await runPsql(`
SELECT COALESCE(json_build_object(
  'uploads', COUNT(*),
  'bestViews', COALESCE(MAX(COALESCE((metrics->'publicStats'->>'viewCount')::bigint, 0)), 0),
  'avgViews', COALESCE(AVG(COALESCE((metrics->'publicStats'->>'viewCount')::bigint, 0))::int, 0),
  'above1k', COUNT(*) FILTER (WHERE COALESCE((metrics->'publicStats'->>'viewCount')::bigint, 0) >= 1000)
), '{}'::json)
FROM automation_uploads
WHERE agent_id = ${sqlString(agent.id)}
  AND created_at > now() - interval '7 days'
  AND status <> 'upload_failed';
`);
    const stats = JSON.parse(out || "{}");
    if (Number(stats.uploads || 0) < 3 || Number(stats.above1k || 0) > 0 || Number(stats.bestViews || 0) >= 1000)
        return proposedRunAt;
    const delayDays = stableAgentJitter(`${agent.id}:${new Date().toISOString().slice(0, 10)}:cadence`, 2, 3);
    const from = new Date(Date.now() + delayDays * 86400_000);
    const slot = settings.publishMode === "schedule"
        ? await nextAvailableFutureAutomationSlot(settings, account, from, from, agent).catch(() => null)
        : null;
    return slot?.runAt || new Date(Math.max(new Date(proposedRunAt || 0).getTime() || 0, from.getTime()));
}
function candidateLearningScore(video, profileData, index = 0) {
    const profile = profileData?.profile || profileData || {};
    const views = automationTikTokViewCount(video);
    const title = String(video?.title || "");
    const author = String(video?.authorHandle || video?.author || "").replace(/^@/, "");
    const hook = inferHookPatternFromText(title);
    const durationBucket = durationBucketFromSeconds(Number(video?.durationSeconds || video?.duration || 0));
    const sourceHit = (profile.bestSources || []).find((row) => String(row.label || "").replace(/^@/, "").toLowerCase() === author.toLowerCase());
    const hookHit = (profile.bestHooks || []).find((row) => row.label === hook);
    const durationHit = (profile.bestDurations || []).find((row) => row.label === durationBucket);
    let score = Math.log10(Math.max(views, 1)) * 10 - index * 0.02;
    if (sourceHit)
        score += 35 + Math.log10(Math.max(Number(sourceHit.views || 1), 1)) * 3;
    if (hookHit)
        score += 22 + Math.log10(Math.max(Number(hookHit.views || 1), 1)) * 2;
    if (durationHit)
        score += 10;
    if (/(sports|cycling|martial|body|implant|underdog|training|technique|donghua)/i.test(title))
        score += 8;
    return Math.round(score * 100) / 100;
}
function rankAutomationCandidates(videos, profileData, sourcePriority = "views") {
    const profile = profileData?.profile || profileData || {};
    if (!profile?.samples)
        return videos;
    const mode = String(sourcePriority || "views");
    if (mode === "newest" || mode === "oldest")
        return videos;
    return [...videos].sort((a, b) => candidateLearningScore(b, profile) - candidateLearningScore(a, profile));
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
    'scheduleAt', CASE WHEN u.schedule_at IS NULL THEN NULL ELSE FLOOR(EXTRACT(EPOCH FROM u.schedule_at) * 1000)::bigint END,
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
async function getLatestFailedAutomationUploadForAgent(userId, agentId) {
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
  WHERE u.agent_id = ${sqlString(agentId)}
    AND u.user_id = ${sqlString(userId)}
    AND a.user_id = ${sqlString(userId)}
    AND u.status = 'upload_failed'
    AND COALESCE(u.youtube_video_id, '') = ''
    AND u.created_at > now() - interval '24 hours'
  ORDER BY u.created_at DESC
  LIMIT 1
), 'null'::json);
`);
    return JSON.parse(out || "null");
}
async function retryFailedAutomationUpload(userId, original, options = {}) {
    if (!original)
        throw new Error("Failed automation upload not found.");
    if (!original.sourceUrl)
        throw new Error("Original source URL is missing.");
    const agent = await getAutomationAgent(userId, original.agentId);
    if (!agent)
        throw new Error("Automation agent not found.");
    const settings = normalizeAutomationSettings(agent.settings || {});
    const account = await usableYouTubeAccount(userId, original.youtubeAccountId);
    const scheduleAt = await resolveAutomationScheduleAt(settings, account, new Date(options.from || Date.now()), {
        catchUpPublishAt: options.catchUpPublishAt,
    });
    let tempFile = "";
    let uploadFile = "";
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
        const sourceVideo = {
            playUrl: original.sourceUrl,
            sourceUrl: original.sourceUrl,
            id: original.sourceVideoId || "",
            cleanPlaybackUrls: candidateUrls,
        };
        const downloader = await runAutomationSourceDownload(sourceVideo, tempFile);
        const sourceDimensions = await probeVideoDimensions(tempFile);
        const sourceDurationSeconds = await probeVideoDuration(tempFile);
        const sourceFileSize = fs.existsSync(tempFile) ? fs.statSync(tempFile).size : 0;
        const preparedUpload = await prepareShortsUploadFile(tempFile, settings, { label: "retry_failed_upload" });
        uploadFile = preparedUpload.filePath;
        const uploadDimensions = await probeVideoDimensions(uploadFile);
        const uploadDurationSeconds = await probeVideoDuration(uploadFile);
        const uploadFileSize = fs.existsSync(uploadFile) ? fs.statSync(uploadFile).size : 0;
        const metricTags = Array.isArray(original.metrics?.metadata?.tags)
            ? original.metrics.metadata.tags
            : Array.isArray(original.metrics?.tags)
                ? original.metrics.tags
                : [];
        const upload = await uploadYouTubeVideoFromFile(account, {
            title: String(original.title || original.movieTitle || "Automation upload").slice(0, 100),
            description: original.description || "",
            tags: metricTags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 15),
            privacyStatus: automationPublishPrivacyStatus(settings),
            publishAt: scheduleAt ? scheduleAt.toISOString() : "",
            categoryId: settings.categoryId,
            madeForKids: settings.madeForKids,
        }, uploadFile, "video/mp4");
        const nextSlot = settings.publishMode === "schedule" && scheduleAt
            ? await nextAvailableFutureAutomationSlot(settings, account, new Date(scheduleAt.getTime() + 60_000), new Date(), agent)
            : null;
        let nextRunAt = nextSlot
            ? nextSlot.runAt
            : await nextAutomationRunAt(settings, new Date(), agent);
        nextRunAt = await performanceAwareNextRunAt(agent, settings, account, nextRunAt).catch(() => nextRunAt);
        const fileSize = fs.statSync(uploadFile).size;
        await runPsql(`
UPDATE automation_uploads
SET youtube_video_id = ${sqlString(upload.id)},
    youtube_url = ${sqlString(upload.url)},
    schedule_at = ${scheduleAt ? `${sqlString(scheduleAt.toISOString())}::timestamptz` : "NULL"},
    status = ${sqlString(scheduleAt ? "scheduled" : "uploaded")},
    metrics = metrics || ${jsonbLiteral({ uploadState: "recovered", recoveredAt: new Date().toISOString(), retryDownloader: downloader, retryFileSize: fileSize, sourceDownloadDimensions: sourceDimensions, sourceDownloadDurationSeconds: sourceDurationSeconds, sourceDownloadFileSize: sourceFileSize, uploadDimensions, uploadDurationSeconds, uploadFileSize, shortsTrim: preparedUpload.metrics, uploadVia: upload.provider || (String(upload.url || "").includes("zernio.com") ? "zernio" : "youtube"), zernioPostId: upload.zernioPostId || (String(upload.url || "").match(/zernio\.com\/posts\/([a-f0-9]{24})/i)?.[1] || "") })},
    updated_at = now()
WHERE id = ${sqlString(original.id)}
  AND user_id = ${sqlString(userId)};
UPDATE automation_agents
SET last_run_at = now(), next_run_at = ${sqlString(nextRunAt.toISOString())}::timestamptz, updated_at = now()
WHERE id = ${sqlString(agent.id)};
`);
        await captureAutomationPerformance(original.id, account, upload.id).catch(() => null);
        return {
            uploadId: original.id,
            youtubeVideoId: upload.id,
            youtubeUrl: upload.url,
            scheduleAt,
            nextRunAt,
            recoveredFailedUpload: true,
            downloader,
            fileSize,
        };
    }
    finally {
        if (uploadFile && uploadFile !== tempFile) {
            try {
                fs.unlinkSync(uploadFile);
            }
            catch {
                /* cache cleanup will catch it */
            }
        }
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
    let uploadFile = "";
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
        const sourceVideo = {
            playUrl: original.sourceUrl,
            sourceUrl: original.sourceUrl,
            id: original.sourceVideoId || "",
            cleanPlaybackUrls: candidateUrls,
        };
        const downloader = await runAutomationSourceDownload(sourceVideo, tempFile);
        const sourceDimensions = await probeVideoDimensions(tempFile);
        const sourceDurationSeconds = await probeVideoDuration(tempFile);
        const sourceFileSize = fs.existsSync(tempFile) ? fs.statSync(tempFile).size : 0;
        const preparedUpload = await prepareShortsUploadFile(tempFile, settings, { label: "manual_reupload" });
        uploadFile = preparedUpload.filePath;
        const uploadDimensions = await probeVideoDimensions(uploadFile);
        const uploadDurationSeconds = await probeVideoDuration(uploadFile);
        const uploadFileSize = fs.existsSync(uploadFile) ? fs.statSync(uploadFile).size : 0;
        const upload = await uploadYouTubeVideoFromFile(account, {
            title: `${original.title || "Automation upload"} (HD test)`.slice(0, 100),
            description: original.description || "",
            tags: [],
            privacyStatus: "private",
            categoryId: settings.categoryId,
            madeForKids: settings.madeForKids,
        }, uploadFile, "video/mp4");
        const newUploadId = `upl_${crypto.randomUUID()}`;
        const fileSize = fs.statSync(uploadFile).size;
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
  NULL, ${sqlString("hd_test")}, ${jsonbLiteral({ ...(original.metrics || {}), reuploadOf: original.id, reuploadDownloader: downloader, reuploadFileSize: fileSize, sourceDownloadDimensions: sourceDimensions, sourceDownloadDurationSeconds: sourceDurationSeconds, sourceDownloadFileSize: sourceFileSize, uploadDimensions, uploadDurationSeconds, uploadFileSize, shortsTrim: preparedUpload.metrics })}, now(), now()
);
`);
        await captureAutomationPerformance(newUploadId, account, upload.id).catch(() => null);
        return { uploadId: newUploadId, youtubeVideoId: upload.id, youtubeUrl: upload.url, downloader, fileSize };
    }
    finally {
        if (uploadFile && uploadFile !== tempFile) {
            try {
                fs.unlinkSync(uploadFile);
            }
            catch {
                /* cache cleanup will catch it */
            }
        }
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
        uploadsPlaylistId: String(channel.contentDetails?.relatedPlaylists?.uploads || deriveYouTubeUploadsPlaylistId(channel.id)),
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
  'connectedAt', FLOOR(EXTRACT(EPOCH FROM connected_at) * 1000)::bigint,
  'platform', platform,
  'zernioConnected', CASE WHEN COALESCE(zernio_api_key, '') <> '' AND COALESCE(zernio_account_id, '') <> '' THEN true ELSE false END
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
        const incomingRefresh = String(tokenData.refresh_token || "").trim();
        const refreshToken = incomingRefresh && incomingRefresh !== "zernio"
            ? incomingRefresh
            : (existing && existing !== "zernio" ? existing : incomingRefresh || existing || "");
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
      'tokenExpiresAt', FLOOR(EXTRACT(EPOCH FROM token_expires_at) * 1000)::bigint,
      'zernioApiKey', zernio_api_key,
      'zernioAccountId', zernio_account_id,
      'platform', platform
  )
  FROM youtube_accounts
  WHERE id = ${sqlString(accountId)} AND user_id = ${sqlString(userId)}
  LIMIT 1
), 'null'::json);
`);
    return JSON.parse(out || "null");
}
function isTikTokPublishAccount(account) {
    return String(account?.platform || "").toLowerCase() === "tiktok";
}
function isZernioManagedAccount(account) {
    return isTikTokPublishAccount(account) || Boolean(account?.zernioApiKey && account?.zernioAccountId);
}
function zernioAccountMatchesChannel(account, zernioAccount) {
    if (!account || !zernioAccount)
        return false;
    const channelId = String(account.channelId || "").trim();
    const platformUserId = String(zernioAccount.platformUserId || "").trim();
    if (channelId && platformUserId && channelId === platformUserId)
        return true;
    const channelHandle = String(account.channelHandle || "").replace(/^@+/, "").trim().toLowerCase();
    const username = String(zernioAccount.username || "").replace(/^@+/, "").trim().toLowerCase();
    return Boolean(channelHandle && username && channelHandle === username);
}
function accountHasGoogleOAuth(account) {
    return !isTikTokPublishAccount(account)
        && String(account?.accessToken || "").trim() !== ""
        && String(account?.accessToken || "") !== "zernio";
}
function isZernioOnlyYouTubeAccount(account) {
    return !isTikTokPublishAccount(account)
        && Boolean(account?.zernioApiKey && account?.zernioAccountId)
        && !accountHasGoogleOAuth(account);
}
async function ensureGoogleAccessToken(account) {
    if (!accountHasGoogleOAuth(account)) {
        const error = new Error("Google read access is not connected for this channel.");
        error.statusCode = 403;
        throw error;
    }
    if (Number(account.tokenExpiresAt || 0) < Date.now() + 60_000)
        return refreshGoogleToken(account);
    return account;
}
async function zernioApiFetch(apiKey, path, options = {}) {
    const response = await fetch(`https://zernio.com/api/v1${path}`, {
        ...options,
        headers: {
            Authorization: `Bearer ${apiKey}`,
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...(options.headers || {}),
        },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data?.error || data?.message || `Zernio API request failed (${response.status})`);
    }
    return data;
}
function firstNonEmptyString(...values) {
    for (const value of values) {
        const clean = String(value || "").trim();
        if (clean)
            return clean;
    }
    return "";
}
function zernioPlatformAccountId(platform) {
    return String(platform?.accountId?._id || platform?.accountId || "").trim();
}
function zernioPlatformForAccount(post, account) {
    const platforms = Array.isArray(post?.platforms) ? post.platforms : [];
    const accountId = String(account?.zernioAccountId || "").trim();
    return platforms.find((item) => accountId && zernioPlatformAccountId(item) === accountId)
        || platforms.find((item) => String(item?.platform || "").toLowerCase() === String(account?.platform || "tiktok").toLowerCase())
        || platforms[0]
        || {};
}
function tiktokVideoIdFromUrl(value = "") {
    return String(value || "").match(/\/video\/(\d{8,30})/i)?.[1] || "";
}
function zernioPostObjectFromResponse(data = {}) {
    return data?.post || data?.data?.post || data?.data || data?.result || data;
}
function zernioPostIdFromResponse(data = {}) {
    const post = zernioPostObjectFromResponse(data);
    return firstNonEmptyString(data?.id, data?._id, data?.postId, data?.data?.id, data?.data?._id, post?.id, post?._id);
}
function zernioPostUrlFromResponse(data = {}) {
    const post = zernioPostObjectFromResponse(data);
    const postId = zernioPostIdFromResponse(data);
    return firstNonEmptyString(post?.url, post?.postUrl, data?.url, data?.postUrl, postId ? `https://zernio.com/posts/${postId}` : "");
}
function zernioMediaItems(post, platform = {}) {
    const arrays = [post?.mediaItems, post?.media, post?.mediaUrls, post?.assets, post?.files, platform?.mediaItems, platform?.media, platform?.assets];
    return arrays.flatMap((value) => Array.isArray(value) ? value : (value ? [value] : []));
}
function zernioMediaThumbnailUrl(media) {
    if (typeof media === "string")
        return media;
    return firstNonEmptyString(media?.thumbnailUrl, media?.thumbnail, media?.previewUrl, media?.preview, media?.coverUrl, media?.cover, media?.posterUrl, media?.poster, media?.imageUrl, media?.publicUrl, media?.mediaUrl, media?.url);
}
function normalizeZernioPostRow(post, account) {
    if (!post || typeof post !== "object")
        return null;
    const platform = zernioPlatformForAccount(post, account);
    const firstMedia = zernioMediaItems(post, platform)[0];
    const thumbnailUrl = zernioMediaThumbnailUrl(firstMedia);
    const postUrl = firstNonEmptyString(platform.platformPostUrl, post.platformPostUrl, post.url);
    const postId = String(post._id || post.id || "");
    const analytics = post.analytics || post.metrics || platform.analytics || {};
    return {
        zernioPostId: postId,
        tiktokVideoId: tiktokVideoIdFromUrl(postUrl),
        title: String(post.title || post.content || "").trim().slice(0, 200) || "TikTok post",
        description: String(post.content || post.description || ""),
        url: postUrl || (postId ? `https://zernio.com/posts/${postId}` : ""),
        thumbnailUrl: thumbnailUrl || String(account?.thumbnailUrl || ""),
        publishedAt: String(post.publishedAt || post.scheduledFor || post.createdAt || ""),
        privacyStatus: String(post.status || platform.status || "public"),
        viewCount: Number(analytics.views || analytics.viewCount || post.views || post.viewCount || platform.views || platform.viewCount || 0),
        likeCount: Number(analytics.likes || analytics.likeCount || post.likes || post.likeCount || platform.likes || platform.likeCount || 0),
        commentCount: Number(analytics.comments || analytics.commentCount || post.comments || post.commentCount || platform.comments || platform.commentCount || 0),
        shareCount: Number(analytics.shares || analytics.shareCount || post.shares || post.shareCount || platform.shares || platform.shareCount || 0),
        durationSeconds: Number(post.durationSeconds || post.videoDuration || 0),
        raw: post,
    };
}
async function listZernioPostsForAccount(account, options = {}) {
    if (!account?.zernioApiKey || !account?.zernioAccountId)
        return [];
    const limit = Math.min(Math.max(Number(options.limit) || 24, 1), 50);
    const page = Math.max(Number(options.page) || 1, 1);
    try {
        const query = new URLSearchParams({
            accountId: String(account.zernioAccountId),
            platform: "tiktok",
            limit: String(limit),
            page: String(page),
        });
        const data = await zernioApiFetch(account.zernioApiKey, `/posts?${query.toString()}`);
        const posts = Array.isArray(data.posts) ? data.posts : [];
        return posts.map((post) => normalizeZernioPostRow(post, account)).filter(Boolean);
    }
    catch (error) {
        console.warn("Zernio TikTok post list failed:", error instanceof Error ? error.message : error);
        return [];
    }
}
async function listZernioAnalyticsPostsForAccount(account, options = {}) {
    if (!account?.zernioApiKey || !account?.zernioAccountId)
        return [];
    const limit = Math.min(Math.max(Number(options.limit) || 24, 1), 50);
    try {
        const query = new URLSearchParams({
            accountId: String(account.zernioAccountId),
            platform: "tiktok",
            limit: String(limit),
        });
        const data = await zernioApiFetch(account.zernioApiKey, `/analytics?${query.toString()}`);
        return Array.isArray(data.posts) ? data.posts : [];
    }
    catch (error) {
        console.warn("Zernio TikTok analytics list failed:", error instanceof Error ? error.message : error);
        return [];
    }
}
async function fetchZernioPostDetails(account, postId) {
    const cleanPostId = String(postId || "").trim();
    if (!account?.zernioApiKey || !cleanPostId)
        return null;
    try {
        const data = await zernioApiFetch(account.zernioApiKey, `/posts/${encodeURIComponent(cleanPostId)}`);
        return normalizeZernioPostRow(data.post || data, account);
    }
    catch (error) {
        console.warn("Zernio post fetch failed:", error instanceof Error ? error.message : error);
        return null;
    }
}
async function fetchZernioPostRaw(account, postId) {
    const cleanPostId = String(postId || "").trim();
    if (!account?.zernioApiKey || !cleanPostId)
        return null;
    try {
        const data = await zernioApiFetch(account.zernioApiKey, `/posts/${encodeURIComponent(cleanPostId)}`);
        return data.post || data || null;
    }
    catch (error) {
        console.warn("Zernio post raw fetch failed:", error instanceof Error ? error.message : error);
        return null;
    }
}
function youtubeVideoIdFromUrl(value = "") {
    const text = String(value || "").trim();
    if (!text)
        return "";
    const patterns = [
        /youtu\.be\/([A-Za-z0-9_-]{6,})/i,
        /youtube\.com\/watch\?[^#]*\bv=([A-Za-z0-9_-]{6,})/i,
        /youtube\.com\/shorts\/([A-Za-z0-9_-]{6,})/i,
        /youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/i,
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match?.[1])
            return match[1];
    }
    return /^[A-Za-z0-9_-]{11}$/.test(text) ? text : "";
}
function resolveZernioPlatformEntry(post = {}, account = {}, platformName = "youtube") {
    const platforms = Array.isArray(post?.platforms) ? post.platforms : [];
    const zernioAccountId = String(account?.zernioAccountId || "").trim();
    const wanted = String(platformName || "").toLowerCase();
    const matches = platforms.filter((platform) => String(platform?.platform || platform?.accountId?.platform || "").toLowerCase() === wanted);
    return matches.find((platform) => {
        const accountId = String(platform?.accountId?._id || platform?.accountId || "").trim();
        return !zernioAccountId || accountId === zernioAccountId;
    }) || matches[0] || null;
}
function resolveZernioYouTubePlatform(post = {}, account = {}) {
    return resolveZernioPlatformEntry(post, account, "youtube");
}
function zernioPublishedTikTokResult(post = {}, account = {}) {
    const platform = resolveZernioPlatformEntry(post, account, "tiktok");
    if (!platform)
        return null;
    const status = String(platform.status || post.status || "").toLowerCase();
    const url = firstNonEmptyString(platform.url, platform.postUrl, platform.publishedUrl, platform.platformUrl, platform.externalUrl, platform.permalink, platform.remoteUrl, platform.result?.url, platform.result?.postUrl);
    const rawId = firstNonEmptyString(platform.videoId, platform.platformPostId, platform.remotePostId, platform.postId, platform.result?.videoId, platform.result?.id);
    const tiktokId = tiktokVideoIdFromUrl(url) || (/^\d{6,}$/.test(String(rawId)) ? String(rawId) : "");
    const tiktokUrl = url && /tiktok\.com/i.test(url) ? url : "";
    const published = ["published", "posted", "success", "completed", "complete"].includes(status) || Boolean(tiktokUrl || tiktokId);
    return {
        status,
        tiktokId,
        tiktokUrl,
        published,
        rawPlatform: platform,
    };
}
function zernioPublishedYouTubeResult(post = {}, account = {}) {
    const platform = resolveZernioYouTubePlatform(post, account);
    if (!platform)
        return null;
    const status = String(platform.status || post.status || "").toLowerCase();
    const url = firstNonEmptyString(platform.url, platform.postUrl, platform.publishedUrl, platform.platformUrl, platform.externalUrl, platform.permalink, platform.remoteUrl, platform.result?.url, platform.result?.postUrl);
    const id = firstNonEmptyString(platform.videoId, platform.youtubeVideoId, platform.platformPostId, platform.remotePostId, platform.postId, platform.result?.videoId, platform.result?.id, youtubeVideoIdFromUrl(url));
    const youtubeId = youtubeVideoIdFromUrl(id) || youtubeVideoIdFromUrl(url);
    const youtubeUrl = youtubeId ? `https://www.youtube.com/watch?v=${youtubeId}` : (url && /youtu/i.test(url) ? url : "");
    const published = ["published", "posted", "success", "completed", "complete"].includes(status) || Boolean(youtubeUrl);
    return {
        status,
        youtubeId,
        youtubeUrl,
        published,
        rawPlatform: platform,
    };
}
function isZernioUploadReference(videoId = "", url = "") {
    return /^[a-f0-9]{24}$/i.test(String(videoId || "").trim()) || /zernio\.com\/posts/i.test(String(url || ""));
}
async function listTikTokPublicProfileVideosForAccount(account, limit = 24) {
    const handle = String(account?.channelHandle || account?.handle || "").replace(/^@/, "").trim();
    if (!handle || process.env.TIKTOK_DASHBOARD_PROFILE_ENRICH === "0")
        return [];
    try {
        const playlist = await runTikTokListScript(`https://www.tiktok.com/@${handle}`, limit, "");
        const normalized = await cacheTikTokPlaylistCoversForStorage(normalizeTikTokPlaylistForStorage(playlist));
        return Array.isArray(normalized?.videos) ? normalized.videos : [];
    }
    catch (error) {
        console.warn("TikTok public profile enrichment failed:", error instanceof Error ? error.message : error);
        return [];
    }
}
function dashboardKeyFromTikTokVideo(video = {}) {
    const id = String(video.tiktokVideoId || video.id || "").trim() || tiktokVideoIdFromUrl(video.url || video.playUrl || "");
    if (id)
        return `id:${id}`;
    return `title:${slugifySavedPlaylistTitle(video.title || video.description || "")}`;
}
function dashboardTitleKey(value = "") {
    return slugifySavedPlaylistTitle(String(value || "").replace(/#[\p{L}\p{N}_-]+/gu, "").slice(0, 90));
}
async function getChannelUploadByRef(userId, accountId, ref) {
    const clean = String(ref || "").trim();
    if (!clean || !postgresConfigured())
        return null;
    const safeRef = clean.replace(/[%_\\]/g, "");
    const out = await runPsql(`
SELECT COALESCE((SELECT json_build_object(
  'id', id,
  'title', title,
  'description', description,
  'genre', genre,
  'microNiche', micro_niche,
  'movieTitle', movie_title,
  'sourceAuthor', source_author,
  'sourceUrl', source_url,
  'sourceVideoId', source_video_id,
  'youtubeVideoId', youtube_video_id,
  'youtubeUrl', youtube_url,
  'metrics', metrics,
  'createdAt', created_at
) FROM automation_uploads
WHERE user_id = ${sqlString(userId)}
  AND youtube_account_id = ${sqlString(accountId)}
  AND (
    id = ${sqlString(clean)}
    OR youtube_video_id = ${sqlString(clean)}
    OR source_video_id = ${sqlString(clean)}
    OR youtube_url ILIKE ${sqlString(`%${safeRef}%`)}
    OR source_url ILIKE ${sqlString(`%${safeRef}%`)}
  )
ORDER BY created_at DESC
LIMIT 1), 'null'::json);
`);
    return JSON.parse(out || "null");
}
async function getTikTokPublicVideoForAccount(account, videoIdOrUrl = "") {
    const clean = String(videoIdOrUrl || "").trim();
    const wantedId = tiktokVideoIdFromUrl(clean) || clean;
    if (!wantedId)
        return null;
    const videos = await listTikTokPublicProfileVideosForAccount(account, 50);
    return videos.find((video) => String(video?.id || "") === wantedId || tiktokVideoIdFromUrl(video?.playUrl || "") === wantedId) || null;
}
function resolveZernioPostIdFromUpload(upload, ref) {
    const metrics = upload?.metrics || {};
    const candidates = [
        String(metrics.zernioPostId || ""),
        String(upload?.youtubeVideoId || ""),
        String(ref || ""),
        String(upload?.youtubeUrl || ""),
    ];
    for (const value of candidates) {
        const clean = String(value || "").trim();
        const fromUrl = clean.match(/zernio\.com\/posts\/([a-f0-9]{24})/i);
        if (fromUrl)
            return fromUrl[1];
        if (/^[a-f0-9]{24}$/i.test(clean))
            return clean;
    }
    return "";
}
async function getTikTokVideoAnalytics(userId, account, videoId, days = 28) {
    const safeDays = Math.min(Math.max(Number(days) || 28, 1), 365);
    const upload = userId ? await getChannelUploadByRef(userId, account.id, videoId).catch(() => null) : null;
    const zernioPostId = resolveZernioPostIdFromUpload(upload, videoId);
    const zernioPost = zernioPostId ? await fetchZernioPostDetails(account, zernioPostId) : null;
    const metrics = upload?.metrics || {};
    const publicVideoRef = String(metrics.tiktokVideoId || "").trim()
        || tiktokVideoIdFromUrl(metrics.tiktokUrl || "")
        || tiktokVideoIdFromUrl(zernioPost?.url || "")
        || videoId;
    const publicVideo = await getTikTokPublicVideoForAccount(account, publicVideoRef).catch(() => null);
    const publicStats = metrics.publicStats || {};
    const views = Number(publicVideo?.stats?.playCount ?? zernioPost?.viewCount ?? metrics.views ?? publicStats.viewCount ?? 0);
    const likes = Number(publicVideo?.stats?.diggCount ?? zernioPost?.likeCount ?? metrics.likes ?? publicStats.likeCount ?? 0);
    const comments = Number(publicVideo?.stats?.commentCount ?? zernioPost?.commentCount ?? metrics.comments ?? publicStats.commentCount ?? 0);
    const handle = String(account?.channelHandle || "").replace(/^@+/, "");
    const tiktokVideoId = String(publicVideo?.id || metrics.tiktokVideoId || tiktokVideoIdFromUrl(metrics.tiktokUrl || "") || tiktokVideoIdFromUrl(zernioPost?.url || "") || upload?.sourceVideoId || upload?.youtubeVideoId || tiktokVideoIdFromUrl(upload?.sourceUrl || "") || videoId || "").trim();
    const fallbackUrl = tiktokVideoId && handle ? `https://www.tiktok.com/@${handle}/video/${tiktokVideoId}` : "";
    const fallbackThumb = firstNonEmptyString(publicVideo?.dynamicCover, publicVideo?.thumbnailUrl, metrics.sourceThumbnailUrl, metrics.thumbnailUrl, metrics.movie?.tmdb?.posterUrl, metrics.movie?.mal?.imageUrl, account?.thumbnailUrl);
    return {
        id: tiktokVideoId || zernioPost?.zernioPostId || upload?.id || String(videoId || ""),
        url: publicVideo?.playUrl || String(metrics.tiktokUrl || "").trim() || zernioPost?.url || fallbackUrl || upload?.sourceUrl || upload?.youtubeUrl,
        title: publicVideo?.title || zernioPost?.title || upload?.title || "TikTok post",
        thumbnailUrl: fallbackThumb,
        publishedAt: publicVideo?.createdAt ? new Date(Number(publicVideo.createdAt)).toISOString() : zernioPost?.publishedAt || (upload?.createdAt ? new Date(upload.createdAt).toISOString() : ""),
        privacyStatus: zernioPost?.privacyStatus || "public",
        durationSeconds: Number(publicVideo?.durationSeconds || zernioPost?.durationSeconds || metrics.sourceDurationSeconds || metrics.shortsTrim?.uploadDurationSeconds || 60),
        publicStats: { viewCount: views, likeCount: likes, commentCount: comments },
        analytics: {
            days: safeDays,
            startDate: "",
            endDate: "",
            totals: {
                views,
                likes,
                comments,
                warning: "TikTok stats come from Zernio and AutoYT upload history. Watch minutes and subscriber gains are YouTube-only.",
            },
            daily: Array.isArray(metrics.analytics?.daily) ? metrics.analytics.daily : [],
        },
    };
}
async function fetchYouTubeVideoById(videoId, account) {
    const cleanVideoId = String(videoId || "").trim();
    if (!cleanVideoId)
        throw new Error("Video ID is required.");
    if (accountHasGoogleOAuth(account)) {
        const refreshed = await ensureGoogleAccessToken(account);
        const videosUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
        videosUrl.searchParams.set("part", "snippet,statistics,contentDetails,status");
        videosUrl.searchParams.set("id", cleanVideoId);
        const videoData = await fetchJsonWithAuth(videosUrl, refreshed.accessToken);
        return videoData.items?.[0] || null;
    }
    if (youtubeApiKey()) {
        const videoData = await fetchYouTubeJson("videos", {
            part: "snippet,statistics,contentDetails,status",
            id: cleanVideoId,
        });
        return videoData.items?.[0] || null;
    }
    throw new Error("Connect Google read access or configure YOUTUBE_API_KEY to load video metadata.");
}
async function syncZernioAccountCredentials(account) {
    const apiKey = String(account?.zernioApiKey || "").trim();
    if (!apiKey)
        return account;
    const targetPlatform = isTikTokPublishAccount(account) ? "tiktok" : "youtube";
    try {
        const response = await fetch("https://zernio.com/api/v1/accounts", {
            headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!response.ok)
            return account;
        const data = await response.json().catch(() => ({}));
        const platformAccounts = (data.accounts || []).filter((item) => String(item?.platform || "").toLowerCase() === targetPlatform);
        const hasLocalIdentity = Boolean(String(account.channelId || "").trim() || String(account.channelHandle || "").trim());
        let match = null;
        let storedMatchMismatch = false;
        if (account.zernioAccountId) {
            const storedMatch = platformAccounts.find((item) => String(item._id) === String(account.zernioAccountId)) || null;
            if (storedMatch && (!hasLocalIdentity || zernioAccountMatchesChannel(account, storedMatch))) {
                match = storedMatch;
            }
            else if (storedMatch) {
                storedMatchMismatch = true;
            }
        }
        if (!match && account.channelId) {
            match = platformAccounts.find((item) => String(item.platformUserId || "") === String(account.channelId)) || null;
        }
        if (!match && account.channelHandle) {
            const handle = String(account.channelHandle).replace(/^@+/, "").trim().toLowerCase();
            match = platformAccounts.find((item) => String(item.username || "").replace(/^@+/, "").trim().toLowerCase() === handle) || null;
        }
        if (!match && platformAccounts.length === 1 && !hasLocalIdentity)
            match = platformAccounts[0];
        if (!match) {
            if (storedMatchMismatch) {
                console.warn("Ignoring mismatched Zernio account mapping for publish account", { accountId: account.id, channelId: account.channelId, channelHandle: account.channelHandle });
                return { ...account, zernioApiKey: accountHasGoogleOAuth(account) ? "" : account.zernioApiKey, zernioAccountId: "" };
            }
            return account;
        }
        if (targetPlatform === "tiktok") {
            await runPsql(`
UPDATE youtube_accounts
SET zernio_api_key = ${sqlString(apiKey)},
    zernio_account_id = ${sqlString(match._id)},
    platform = 'tiktok',
    channel_title = ${sqlString(match.displayName || match.username || account.channelTitle || "TikTok Account")},
    channel_handle = ${sqlString("@" + String(match.username || account.channelHandle || "tiktok").replace(/^@+/, ""))},
    thumbnail_url = COALESCE(NULLIF(${sqlString(match.profilePicture || "")}, ''), thumbnail_url),
    updated_at = now()
WHERE id = ${sqlString(account.id)};
`);
            return {
                ...account,
                zernioApiKey: apiKey,
                zernioAccountId: String(match._id),
                platform: "tiktok",
                channelTitle: match.displayName || match.username || account.channelTitle,
                channelHandle: "@" + String(match.username || account.channelHandle || "tiktok").replace(/^@+/, ""),
                thumbnailUrl: match.profilePicture || account.thumbnailUrl || "",
            };
        }
        await runPsql(`
UPDATE youtube_accounts
SET zernio_api_key = ${sqlString(apiKey)},
    zernio_account_id = ${sqlString(match._id)},
    platform = 'youtube',
    channel_title = ${sqlString(match.displayName || match.username || account.channelTitle || "YouTube Channel")},
    channel_handle = ${sqlString("@" + String(match.username || account.channelHandle || "youtube").replace(/^@+/, ""))},
    thumbnail_url = COALESCE(NULLIF(${sqlString(match.profilePicture || "")}, ''), thumbnail_url),
    updated_at = now()
WHERE id = ${sqlString(account.id)};
`);
        return {
            ...account,
            zernioApiKey: apiKey,
            zernioAccountId: String(match._id),
            platform: "youtube",
            channelTitle: match.displayName || match.username || account.channelTitle,
            channelHandle: "@" + String(match.username || account.channelHandle || "youtube").replace(/^@+/, ""),
            thumbnailUrl: match.profilePicture || account.thumbnailUrl || "",
        };
    }
    catch (error) {
        console.warn("Could not sync Zernio account credentials:", error instanceof Error ? error.message : error);
        return account;
    }
}
async function refreshGoogleToken(account) {
    if (isTikTokPublishAccount(account)) {
        const error = new Error("This TikTok account publishes through Zernio, not Google OAuth. Reconnect TikTok from Channel Management.");
        error.statusCode = 403;
        throw error;
    }
    if (!accountHasGoogleOAuth(account) || String(account?.refreshToken || "") === "zernio" || !account.refreshToken) {
        const error = new Error("This YouTube channel needs Google read access. Connect Google from Channel Management.");
        error.statusCode = 403;
        throw error;
    }
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
        throw new Error("Publish channel not found");
    if (account.zernioApiKey)
        account = await syncZernioAccountCredentials(account);
    if (isTikTokPublishAccount(account)) {
        if (!account.zernioApiKey || !account.zernioAccountId) {
            const error = new Error("TikTok publish account is missing Zernio credentials. Reconnect TikTok from Channel Management.");
            error.statusCode = 403;
            throw error;
        }
        return account;
    }
    if (accountHasGoogleOAuth(account) && Number(account.tokenExpiresAt || 0) < Date.now() + 60_000) {
        try {
            account = await refreshGoogleToken(account);
        }
        catch (error) {
            if (canUploadViaZernio(account)) {
                console.warn("Google token refresh failed; using Zernio upload fallback:", error instanceof Error ? error.message : error);
                return {
                    ...account,
                    googleAuthUnavailable: true,
                    zernioFallbackRequired: true,
                    googleAuthError: error instanceof Error ? error.message : String(error || "Google token refresh failed"),
                };
            }
            throw error;
        }
    }
    return account;
}
function accountHasScope(account, scope) {
    return String(account?.scope || "").split(/\s+/).includes(scope);
}
function requireYouTubeScope(account, scope, label) {
    if (isTikTokPublishAccount(account) || !accountHasGoogleOAuth(account)) {
        return;
    }
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
function automationPublishPrivacyStatus(settings) {
    const mode = String(settings?.publishMode || "schedule");
    if (mode === "unlisted")
        return "unlisted";
    if (mode === "schedule")
        return "public";
    return "private";
}
function analyticsRowsToObjects(data) {
    const headers = (data.columnHeaders || []).map((header) => header.name);
    return (data.rows || []).map((row) => Object.fromEntries(row.map((value, index) => [headers[index] || `col${index}`, value])));
}
function isGoogleAuthResponseError(response, data = {}) {
    const message = String(data?.error?.message || data?.error_description || data?.error || "");
    return response?.status === 401 || /\binvalid authentication credentials\b|invalid_grant|unauthorized|oauth/i.test(message);
}
function youtubeUploadMetadataPayload(metadata, publishAt = "") {
    return {
        snippet: {
            title: metadata.title,
            description: metadata.description || "",
            tags: metadata.tags || [],
            categoryId: metadata.categoryId || "22",
        },
        status: {
            privacyStatus: publishAt ? "private" : safePrivacyStatus(metadata.privacyStatus),
            selfDeclaredMadeForKids: metadata.madeForKids === true,
            ...(publishAt ? { publishAt } : {}),
        },
    };
}
async function startYouTubeResumableUpload(account, metadata, contentLength, uploadContentType) {
    let uploadAccount = account;
    let lastData = {};
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const initUrl = new URL("https://www.googleapis.com/upload/youtube/v3/videos");
        initUrl.searchParams.set("uploadType", "resumable");
        initUrl.searchParams.set("part", "snippet,status");
        const initResponse = await fetch(initUrl, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${uploadAccount.accessToken}`,
                "Content-Type": "application/json; charset=UTF-8",
                "X-Upload-Content-Length": String(contentLength),
                "X-Upload-Content-Type": uploadContentType,
            },
            body: JSON.stringify(youtubeUploadMetadataPayload(metadata, metadata.publishAt || "")),
        });
        const location = initResponse.headers.get("location");
        if (initResponse.ok && location)
            return location;
        lastData = await initResponse.json().catch(() => ({}));
        if (attempt === 0 && isGoogleAuthResponseError(initResponse, lastData) && uploadAccount.refreshToken) {
            uploadAccount = await refreshGoogleToken(uploadAccount);
            continue;
        }
        break;
    }
    throw new Error(lastData?.error?.message || `Could not start YouTube upload`);
}
// Builds the Zernio API post body for both TikTok and YouTube accounts.
// TikTok uses a combined caption (title + description), maps visibility, and adds tiktokOptions.
// YouTube uses description as content and passes title in platformSpecificData.
function buildZernioPostBody(account, metadata, publicUrl) {
    const isTikTok = isTikTokPublishAccount(account);
    const tiktokCaption = [metadata.title, metadata.description].filter(Boolean).join("\n\n").trim().slice(0, 2200);
    const privacyStatus = String(metadata.privacyStatus || "private").toLowerCase();
    const platform = isTikTok ? "tiktok" : "youtube";
    const content = isTikTok ? tiktokCaption : (metadata.description || "");
    const body = {
        content,
        mediaItems: [{ type: "video", url: publicUrl }],
        platforms: [{
            platform,
            accountId: account.zernioAccountId,
            ...(isTikTok ? {} : { platformSpecificData: { title: metadata.title, visibility: privacyStatus || "private" } }),
        }],
        publishNow: !metadata.publishAt,
    };
    if (metadata.publishAt) {
        body.scheduledFor = new Date(metadata.publishAt).toISOString();
        body.timezone = String(metadata.timezone || "UTC").slice(0, 64);
    }
    if (isTikTok) {
        const privacyMap = {
            public: "PUBLIC_TO_EVERYONE",
            private: "SELF_ONLY",
            unlisted: "PUBLIC_TO_EVERYONE",
        };
        body.tiktokSettings = {
            privacy_level: privacyMap[privacyStatus] || "SELF_ONLY",
            allow_comment: true,
            allow_duet: true,
            allow_stitch: true,
            content_preview_confirmed: true,
            express_consent_given: true,
        };
    }
    return body;
}
function buildZernioPresignPayload(fileName, contentType, fileSize = 0) {
    const payload = {
        filename: String(fileName || "upload.mp4").slice(0, 255),
        contentType: String(contentType || "video/mp4").slice(0, 120),
    };
    const size = Number(fileSize);
    if (Number.isFinite(size) && size > 0)
        payload.fileSize = Math.floor(size);
    return payload;
}
function zernioApiErrorMessage(prefix, response, data = {}) {
    const detail = String(data?.error || data?.message || response?.statusText || "Request failed").trim();
    return `${prefix}: ${detail}`;
}
async function requestZernioMediaPresign(account, fileName, contentType, fileSize = 0) {
    const presignResponse = await fetch("https://zernio.com/api/v1/media/presign", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${account.zernioApiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(buildZernioPresignPayload(fileName, contentType, fileSize)),
    });
    const presignData = await presignResponse.json().catch(() => ({}));
    if (!presignResponse.ok)
        throw new Error(zernioApiErrorMessage("Zernio media presign failed", presignResponse, presignData));
    const uploadUrl = String(presignData?.uploadUrl || "").trim();
    const publicUrl = String(presignData?.publicUrl || "").trim();
    if (!uploadUrl || !publicUrl)
        throw new Error("Zernio media presign failed: uploadUrl or publicUrl missing from response.");
    return { uploadUrl, publicUrl };
}
function isZernioFallbackEligibleError(error) {
    const message = error instanceof Error ? error.message : String(error || "");
    return /bad request|invalid_grant|unauthori[sz]ed|invalid authentication|quota|upload limit|forbidden|permission|token|oauth|refresh/i.test(message);
}
async function uploadBufferViaZernio(account, metadata, videoBuffer, mimeType = "video/mp4") {
    if (!videoBuffer?.length) {
        throw new Error("Video file is required.");
    }
    const uploadContentType = mimeType && mimeType !== "application/octet-stream" ? mimeType : "video/mp4";
    const { uploadUrl, publicUrl } = await requestZernioMediaPresign(account, `upload_${crypto.randomUUID()}.mp4`, uploadContentType, videoBuffer.length);
    const putResponse = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
            "Content-Type": uploadContentType,
            "Content-Length": String(videoBuffer.length),
        },
        body: videoBuffer,
    });
    if (!putResponse.ok) {
        throw new Error(`Zernio media upload failed: ${putResponse.statusText}`);
    }
    const postRes = await fetch("https://zernio.com/api/v1/posts", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${account.zernioApiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(buildZernioPostBody(account, metadata, publicUrl)),
    });
    if (!postRes.ok) {
        const errData = await postRes.json().catch(() => ({}));
        throw new Error(zernioApiErrorMessage("Zernio post creation failed", postRes, errData));
    }
    const postData = await postRes.json();
    const postId = zernioPostIdFromResponse(postData);
    const postUrl = zernioPostUrlFromResponse(postData);
    return {
        id: postId,
        url: postUrl || (postId ? `https://zernio.com/posts/${postId}` : ""),
        title: metadata.title,
        privacyStatus: metadata.privacyStatus || "private",
        provider: "zernio",
        zernioPostId: postId,
        raw: postData,
    };
}
async function uploadFileViaZernio(account, metadata, filePath, mimeType = "video/mp4") {
    if (!filePath || !fs.existsSync(filePath))
        throw new Error("Compiled video file is missing.");
    const stat = fs.statSync(filePath);
    if (!stat.size)
        throw new Error("Compiled video file is empty.");
    const uploadContentType = mimeType && mimeType !== "application/octet-stream" ? mimeType : "video/mp4";
    const { uploadUrl, publicUrl } = await requestZernioMediaPresign(account, `upload_${crypto.randomUUID()}.mp4`, uploadContentType, stat.size);
    const putResponse = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
            "Content-Type": uploadContentType,
            "Content-Length": String(stat.size),
        },
        body: fs.createReadStream(filePath),
        duplex: "half",
    });
    if (!putResponse.ok) {
        throw new Error(`Zernio media upload failed: ${putResponse.statusText}`);
    }
    const postRes = await fetch("https://zernio.com/api/v1/posts", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${account.zernioApiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(buildZernioPostBody(account, metadata, publicUrl)),
    });
    if (!postRes.ok) {
        const errData = await postRes.json().catch(() => ({}));
        throw new Error(zernioApiErrorMessage("Zernio post creation failed", postRes, errData));
    }
    const postData = await postRes.json();
    const postId = zernioPostIdFromResponse(postData);
    const postUrl = zernioPostUrlFromResponse(postData);
    return {
        id: postId,
        url: postUrl || (postId ? `https://zernio.com/posts/${postId}` : ""),
        title: metadata.title,
        privacyStatus: metadata.privacyStatus || "private",
        provider: "zernio",
        zernioPostId: postId,
        raw: postData,
    };
}
async function uploadYouTubeVideo(account, metadata, videoBuffer, mimeType) {
    if (shouldUploadViaZernio(account)) {
        return uploadBufferViaZernio(account, metadata, videoBuffer, mimeType);
    }

    try {
        requireYouTubeScope(account, "https://www.googleapis.com/auth/youtube.upload", "YouTube upload");
        if (!videoBuffer?.length) {
            throw new Error("Video file is required.");
        }
        const uploadContentType = mimeType && mimeType !== "application/octet-stream" ? mimeType : "video/mp4";
        await assertUploadBufferHasAudio(videoBuffer, uploadContentType);
        const location = await startYouTubeResumableUpload(account, metadata, videoBuffer.length, uploadContentType);
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
            provider: "youtube",
            raw: data,
        };
    }
    catch (error) {
        if (canUploadViaZernio(account) && isZernioFallbackEligibleError(error)) {
            console.warn("YouTube direct upload failed; using Zernio backup:", error instanceof Error ? error.message : error);
            return uploadBufferViaZernio({ ...account, zernioFallbackRequired: true }, metadata, videoBuffer, mimeType);
        }
        throw error;
    }
}
async function uploadYouTubeVideoFromFile(account, metadata, filePath, mimeType = "video/mp4") {
    if (shouldUploadViaZernio(account)) {
        return uploadFileViaZernio(account, metadata, filePath, mimeType);
    }

    try {
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
        const location = await startYouTubeResumableUpload(account, metadata, stat.size, uploadContentType);
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
            provider: "youtube",
            raw: data,
        };
    }
    catch (error) {
        if (canUploadViaZernio(account) && isZernioFallbackEligibleError(error)) {
            console.warn("YouTube direct upload failed; using Zernio backup:", error instanceof Error ? error.message : error);
            return uploadFileViaZernio({ ...account, zernioFallbackRequired: true }, metadata, filePath, mimeType);
        }
        throw error;
    }
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
    // TikTok accounts publish via Zernio; YouTube playlists don't apply
    if (isZernioManagedAccount(account)) {
        return "";
    }
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
    const normalized = normalizeAutomationSourceVideo(video, video?.sourceListUrl || video?.analyzedUrl || "");
    const id = String(normalized?.id || video?.videoId || "").trim();
    const playUrl = automationVideoSourceUrl(normalized);
    const authorHandle = String(normalized?.authorHandle || normalized?.uploaderId || normalized?.author || "").replace(/^@+/, "").trim();
    const title = String(normalized?.title || (automationVideoPlatform(normalized) === "youtube" ? "YouTube clip" : "TikTok clip")).trim();
    if (!playUrl && !(id && authorHandle))
        return null;
    return {
        ...normalized,
        id,
        title,
        author: String(normalized?.author || authorHandle || "").trim(),
        authorHandle,
        playUrl,
        dynamicCover: String(normalized?.dynamicCover || normalized?.thumbnailUrl || "").trim(),
        durationSeconds: compilationVideoDuration(normalized),
        stats: normalized?.stats || {},
        cleanPlaybackUrls: Array.isArray(normalized?.cleanPlaybackUrls) ? normalized.cleanPlaybackUrls : [],
        createdAt: normalized?.createdAt,
        width: normalized?.width,
        height: normalized?.height,
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
    const maxClips = Math.min(Math.max(Number(options.maxClips) || clips.length, 1), 1000);
    const minSeconds = Math.max(Number(options.minSeconds) || 0, 0);
    const maxSeconds = Math.max(Number(options.maxSeconds) || 0, 0);
    const hasDurationTarget = minSeconds > 0 || maxSeconds > 0;
    // With a duration target the extra clips act as fallbacks for failed downloads,
    // so only pre-trim the candidate list when no target is set.
    const selected = hasDurationTarget ? clips : clips.slice(0, maxClips);
    const workspace = createCompilationWorkspace();
    const downloaded = [];
    const normalized = [];
    const skipped = [];
    let stitchedSeconds = 0;
    const layout = options.layout === "landscape" ? "landscape" : "vertical";
    try {
        for (let index = 0; index < selected.length; index += 1) {
            const clip = selected[index];
            if (normalized.length >= maxClips)
                break;
            if (normalized.length && minSeconds > 0 && stitchedSeconds >= minSeconds)
                break;
            if (normalized.length && maxSeconds > 0 && stitchedSeconds + (compilationVideoDuration(clip) || 60) > maxSeconds)
                continue;
            const rawPath = path.join(workspace, `raw_${String(index + 1).padStart(3, "0")}.mp4`);
            try {
                const downloader = await runAutomationSourceDownload(clip, rawPath, { preferYtDlp: automationVideoPlatform(clip) === "tiktok" });
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
                stitchedSeconds += compilationVideoDuration(clip) || 60;
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
    const maxClips = Math.min(Math.max(Number(body.maxClips ?? settings.compilationMaxClips) || 300, 1), 1000);
    let selected = (videos || []).map(normalizeCompilationVideoInput).filter(Boolean);
    if (maxSeconds > 0 || minSeconds > 0) {
        // Keep roughly double the target duration as candidates so failed clip
        // downloads still leave enough material to hit the minimum length.
        const bufferSeconds = (minSeconds > 0 ? minSeconds : maxSeconds) * 2 + 600;
        const next = [];
        let total = 0;
        for (const clip of selected) {
            const duration = compilationVideoDuration(clip) || 60;
            if (next.length && maxSeconds > 0 && duration > maxSeconds)
                continue;
            next.push(clip);
            total += duration;
            if (total >= bufferSeconds || next.length >= maxClips * 3)
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
        minSeconds,
        maxSeconds,
    });
    const belowMinimum = minSeconds > 0 && built.totalSeconds < minSeconds;
    try {
        const title = String(body.title || settings.compilationTitle || compilationDefaultTitle(body.sourceTitle || agent?.name, built.clips)).trim().slice(0, 100);
        const description = String(body.description || settings.compilationDescription || `Compiled by AutoYT from ${built.clips.length} selected clips.`).trim().slice(0, 5000);
        const publishAt = body.publishAt ? String(body.publishAt) : "";
        const privacyStatus = safePrivacyStatus(body.privacyStatus || automationPublishPrivacyStatus(settings));
        if (outputMode === "download") {
            const file = persistCompilationDownload(built.outputPath);
            return { file: { ...file, title, url: file.downloadUrl }, clips: built.clips, skipped: built.skipped, totalSeconds: built.totalSeconds, belowMinimum, outputBytes: fs.statSync(file.path).size };
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
        return { upload: { ...upload, playlistItem }, clips: built.clips, skipped: built.skipped, totalSeconds: built.totalSeconds, belowMinimum, outputBytes: fs.statSync(built.outputPath).size };
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
    let scheduleAt = null;
    try {
        const account = await usableYouTubeAccount(userId, agent.youtubeAccountId);
        scheduleAt = await resolveAutomationScheduleAt(settings, account, new Date(options.from || Date.now()), {
            catchUpPublishAt: options.catchUpPublishAt,
        });
        const result = await createCompilationUpload(userId, {
            minMinutes: options.minMinutes ?? settings.compilationMinMinutes,
            maxMinutes: options.maxMinutes ?? settings.compilationMaxMinutes,
            maxClips: options.maxClips ?? settings.compilationMaxClips,
            title: options.title || settings.compilationTitle || "",
            description: options.description || settings.compilationDescription || "",
            privacyStatus: automationPublishPrivacyStatus(settings),
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
  ${jsonbLiteral({ compilation: true, clips: result.clips, skipped: result.skipped, totalSeconds: result.totalSeconds, belowMinimum: result.belowMinimum === true, outputBytes: result.outputBytes, playlistItem: result.upload.playlistItem || null })}, now(), now()
);
UPDATE automation_agents
SET last_run_at = now(), next_run_at = ${sqlString((await nextAutomationRunAt(settings, new Date(), agent)).toISOString())}::timestamptz, updated_at = now()
WHERE id = ${sqlString(agent.id)};
`);
        const shortWarning = result.belowMinimum ? ` (finished ${Math.round(result.totalSeconds / 60)} min, below the ${settings.compilationMinMinutes} min target after skipped clips)` : "";
        await finishAutomationRun(runId, "success", `Created compilation ${result.upload.title}${shortWarning}`, { uploadId, youtubeVideoId: result.upload.id, totalSeconds: result.totalSeconds, belowMinimum: result.belowMinimum === true, clips: result.clips.length, skipped: result.skipped.length });
        return { ...result, uploadId };
    }
    catch (error) {
        const failure = await advanceAutomationAgentAfterFailure(agent, settings, error, { plannedPublishAt: scheduleAt }).catch(() => null);
        await finishAutomationRun(runId, "error", error instanceof Error ? error.message : "Compilation run failed", failure ? { failure } : {});
        throw error;
    }
}
async function getYouTubeVideoAnalytics(userId, account, videoId, days = 28) {
    if (isTikTokPublishAccount(account)) {
        if (!userId)
            throw new Error("User context is required for TikTok analytics.");
        return getTikTokVideoAnalytics(userId, account, videoId, days);
    }
    const cleanVideoId = String(videoId || "").trim();
    if (!cleanVideoId)
        throw new Error("Video ID is required.");
    const safeDays = Math.min(Math.max(Number(days) || 28, 1), 365);
    const endDate = new Date();
    const startDate = new Date(Date.now() - (safeDays - 1) * 864e5);
    let video = null;
    let videoFetchWarning = "";
    try {
        video = await fetchYouTubeVideoById(cleanVideoId, account);
    }
    catch (error) {
        videoFetchWarning = error instanceof Error ? error.message : "YouTube video metadata unavailable";
    }
    const stats = video?.statistics || {};
    let totals = videoFetchWarning ? { warning: videoFetchWarning } : null;
    let daily = [];
    if (accountHasGoogleOAuth(account)) {
        try {
            const googleAccount = await ensureGoogleAccessToken(account);
            requireYouTubeScope(googleAccount, "https://www.googleapis.com/auth/yt-analytics.readonly", "YouTube Analytics");
            const metrics = "views,likes,comments,shares,estimatedMinutesWatched,averageViewDuration,subscribersGained";
            const totalUrl = new URL("https://youtubeanalytics.googleapis.com/v2/reports");
            totalUrl.searchParams.set("ids", "channel==MINE");
            totalUrl.searchParams.set("startDate", yyyyMmDd(startDate));
            totalUrl.searchParams.set("endDate", yyyyMmDd(endDate));
            totalUrl.searchParams.set("metrics", metrics);
            totalUrl.searchParams.set("filters", `video==${cleanVideoId}`);
            const totalData = await fetchGoogleWithAuth(totalUrl, googleAccount.accessToken);
            totals = analyticsRowsToObjects(totalData)[0] || null;
            const dailyUrl = new URL("https://youtubeanalytics.googleapis.com/v2/reports");
            dailyUrl.searchParams.set("ids", "channel==MINE");
            dailyUrl.searchParams.set("startDate", yyyyMmDd(startDate));
            dailyUrl.searchParams.set("endDate", yyyyMmDd(endDate));
            dailyUrl.searchParams.set("metrics", "views,likes,comments,estimatedMinutesWatched");
            dailyUrl.searchParams.set("dimensions", "day");
            dailyUrl.searchParams.set("sort", "day");
            dailyUrl.searchParams.set("filters", `video==${cleanVideoId}`);
            const dailyData = await fetchGoogleWithAuth(dailyUrl, googleAccount.accessToken);
            daily = analyticsRowsToObjects(dailyData);
        }
        catch (error) {
            totals = { warning: error instanceof Error ? error.message : "YouTube Analytics unavailable" };
        }
    }
    else if (isZernioOnlyYouTubeAccount(account)) {
        totals = { warning: "Connect Google read access for owned-channel analytics (watch time, subs gained)." };
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
function shouldUseZernioComments(account) {
    return Boolean(account?.zernioApiKey && account?.zernioAccountId
        && (String(account?.accessToken || "") === "zernio"
            || !accountHasScope(account, "https://www.googleapis.com/auth/youtube.force-ssl")));
}
function normalizeZernioYouTubeComment(comment) {
    if (!comment || typeof comment !== "object")
        return { id: "", authorDisplayName: "", authorProfileImageUrl: "", authorChannelUrl: "", textDisplay: "", textOriginal: "", likeCount: 0, publishedAt: "", updatedAt: "" };
    const from = comment.from || {};
    return {
        id: String(comment.id || ""),
        authorDisplayName: String(from.name || from.username || ""),
        authorProfileImageUrl: String(from.picture || ""),
        authorChannelUrl: from.username ? `https://www.youtube.com/${String(from.username).startsWith("@") ? from.username : "@" + from.username}` : "",
        textDisplay: String(comment.message || ""),
        textOriginal: String(comment.message || ""),
        likeCount: Number(comment.likeCount || 0),
        publishedAt: String(comment.createdTime || ""),
        updatedAt: String(comment.updatedTime || comment.createdTime || ""),
    };
}
async function getZernioYouTubeVideoComments(account, videoId, maxResults = 20, pageToken = "") {
    const cleanVideoId = String(videoId || "").trim();
    const url = new URL(`https://zernio.com/api/v1/inbox/comments/${encodeURIComponent(cleanVideoId)}`);
    url.searchParams.set("accountId", account.zernioAccountId);
    url.searchParams.set("limit", String(Math.min(Math.max(Number(maxResults) || 20, 1), 100)));
    if (pageToken)
        url.searchParams.set("cursor", pageToken);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${account.zernioApiKey}` } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
        throw new Error(data?.error || data?.message || `Zernio comment listing failed (${response.status})`);
    const items = Array.isArray(data.comments) ? data.comments : [];
    return {
        videoId: cleanVideoId,
        nextPageToken: String(data.pagination?.cursor || data.pagination?.nextCursor || ""),
        comments: items.map((comment) => ({
            threadId: String(comment.id || ""),
            canReply: comment.canReply !== false,
            totalReplyCount: Number(comment.replyCount || (comment.replies || []).length || 0),
            topLevelComment: normalizeZernioYouTubeComment(comment),
            replies: (comment.replies || []).map(normalizeZernioYouTubeComment),
        })),
    };
}
async function getTikTokVideoComments(userId, account, videoId, maxResults = 20, pageToken = "") {
    const upload = userId ? await getChannelUploadByRef(userId, account.id, videoId).catch(() => null) : null;
    const zernioPostId = resolveZernioPostIdFromUpload(upload, videoId);
    if (zernioPostId && account?.zernioApiKey && account?.zernioAccountId)
        return getZernioYouTubeVideoComments(account, zernioPostId, maxResults, pageToken);
    const tiktokUrl = String(upload?.youtubeUrl || "").trim();
    if (!tiktokUrl || !isTikTokUrl(tiktokUrl))
        return { videoId: String(videoId || ""), nextPageToken: "", comments: [] };
    const payload = await runTikTokCommentsScript(tiktokUrl, { commentLimit: maxResults });
    const comments = Array.isArray(payload?.comments) ? payload.comments : [];
    return {
        videoId: String(videoId || ""),
        nextPageToken: "",
        comments: comments.slice(0, maxResults).map((comment) => ({
            threadId: String(comment.cid || comment.id || ""),
            canReply: true,
            totalReplyCount: Number(comment.reply_count || comment.replyCount || 0),
            topLevelComment: {
                id: String(comment.cid || comment.id || ""),
                authorDisplayName: String(comment.user?.nickname || comment.author || "TikTok user"),
                authorProfileImageUrl: String(comment.user?.avatar_thumb?.url_list?.[0] || comment.avatar || ""),
                authorChannelUrl: String(comment.user?.unique_id ? `https://www.tiktok.com/@${comment.user.unique_id}` : ""),
                textDisplay: String(comment.text || comment.content || ""),
                textOriginal: String(comment.text || comment.content || ""),
                likeCount: Number(comment.digg_count || comment.likes || 0),
                publishedAt: comment.create_time ? new Date(Number(comment.create_time) * 1000).toISOString() : "",
                updatedAt: comment.create_time ? new Date(Number(comment.create_time) * 1000).toISOString() : "",
            },
            replies: [],
        })),
    };
}
async function getYouTubeVideoComments(userId, account, videoId, maxResults = 20, pageToken = "") {
    const cleanVideoId = String(videoId || "").trim();
    if (!cleanVideoId)
        throw new Error("Video ID is required.");
    if (isTikTokPublishAccount(account))
        return getTikTokVideoComments(userId, account, cleanVideoId, maxResults, pageToken);
    if (shouldUseZernioComments(account))
        return getZernioYouTubeVideoComments(account, cleanVideoId, maxResults, pageToken);
    requireYouTubeScope(account, "https://www.googleapis.com/auth/youtube.force-ssl", "YouTube comments");
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
async function replyToZernioYouTubeComment(account, parentId, text, videoId) {
    const cleanVideoId = String(videoId || "").trim();
    if (!cleanVideoId)
        throw new Error("Video ID is required to reply to a YouTube comment through Zernio.");
    const response = await fetch("https://zernio.com/api/v1/inbox/comments/reply", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${account.zernioApiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            postId: cleanVideoId,
            accountId: account.zernioAccountId,
            commentId: parentId,
            message: text,
        }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
        throw new Error(data?.error || data?.message || `Zernio comment reply failed (${response.status})`);
    const reply = data?.comment || data?.reply || data || {};
    return normalizeZernioYouTubeComment({
        id: reply.id || reply.commentId || "",
        message: reply.message || text,
        createdTime: reply.createdTime || new Date().toISOString(),
        from: reply.from || {},
        likeCount: reply.likeCount || 0,
    });
}
async function replyToYouTubeComment(account, parentId, text, videoId = "") {
    const cleanParentId = String(parentId || "").trim();
    const cleanText = String(text || "").trim();
    if (!cleanParentId)
        throw new Error("Parent comment ID is required.");
    if (!cleanText)
        throw new Error("Reply text is required.");
    if (shouldUseZernioComments(account))
        return replyToZernioYouTubeComment(account, cleanParentId, cleanText, videoId);
    requireYouTubeScope(account, "https://www.googleapis.com/auth/youtube.force-ssl", "YouTube comment reply");
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
function geminiApiKeys() {
    const primary = (process.env.GEMINI_API_KEY || "").trim();
    const backup = (process.env.GEMINI_API_KEY_BACKUP || process.env.GEMINI_BACKUP_API_KEY || "").trim();
    const keys = [primary, backup].filter(Boolean);
    return [...new Set(keys)];
}
function geminiClient(apiKey) {
    const key = String(apiKey || geminiApiKeys()[0] || "").trim();
    if (!key)
        throw new Error("GEMINI_API_KEY is not configured.");
    return new GoogleGenAI({ apiKey: key });
}
function shouldTryBackupGeminiKey(error) {
    const message = String(error?.message || error || "");
    return /\b(401|403|408|409|429|500|502|503|504)\b|PERMISSION_DENIED|RESOURCE_EXHAUSTED|TooManyRequests|Forbidden|rate.?limit|quota|overloaded|unavailable/i.test(message);
}
async function generateGeminiContent(request) {
    const keys = geminiApiKeys();
    if (!keys.length)
        throw new Error("GEMINI_API_KEY is not configured.");
    let lastError = null;
    for (let index = 0; index < keys.length; index += 1) {
        try {
            return await geminiClient(keys[index]).models.generateContent(request);
        }
        catch (error) {
            lastError = error;
            if (index >= keys.length - 1 || !shouldTryBackupGeminiKey(error))
                throw error;
            console.warn("Gemini primary key failed; retrying with backup key:", error instanceof Error ? error.message : error);
        }
    }
    throw lastError || new Error("Gemini request failed.");
}
function deepSeekApiKey() {
    return (process.env.DEEPSEEK_API_KEY || "").trim();
}
function deepSeekTextModel() {
    return (process.env.DEEPSEEK_TEXT_MODEL || "deepseek-chat").trim();
}
function deepSeekBaseUrl() {
    return (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/+$/g, "");
}
function dashScopeApiKey() {
    return (process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY || "").replace(/^["']|["']$/g, "").trim();
}
function dashScopeBaseUrls() {
    const configured = (process.env.DASHSCOPE_BASE_URL || "").trim();
    const defaults = [
        "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        "https://dashscope.aliyuncs.com/compatible-mode/v1",
    ];
    return [...new Set([configured, ...defaults]
            .filter(Boolean)
            .map((url) => url.replace(/\/+$/g, "")))];
}
function qwenMovieVisionModel() {
    return (process.env.QWEN_VL_MODEL || process.env.QWEN_MOVIE_ID_VL_MODEL || "qwen3-vl-plus").trim();
}
function qwenMovieTextModel() {
    return (process.env.QWEN_TEXT_MODEL || process.env.QWEN_MOVIE_ID_TEXT_MODEL || "qwen-plus").trim();
}
function qwenAsrModel() {
    return (process.env.QWEN_ASR_MODEL || "qwen3-asr-flash").trim();
}
async function generateDashScopeChat(payload, options = {}) {
    const key = dashScopeApiKey();
    if (!key)
        throw new Error("DASHSCOPE_API_KEY is not configured.");
    let lastError = null;
    for (const baseUrl of dashScopeBaseUrls()) {
        try {
            const response = await fetch(`${baseUrl}/chat/completions`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${key}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
                signal: options.signal,
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                lastError = new Error(data?.error?.message || `DashScope request failed (${response.status})`);
                continue;
            }
            return data;
        }
        catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error("DashScope request failed.");
}
async function generateDeepSeekJson(prompt, options = {}) {
    const key = deepSeekApiKey();
    if (!key)
        throw new Error("DEEPSEEK_API_KEY is not configured.");
    const response = await fetch(`${deepSeekBaseUrl()}/chat/completions`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: options.model || deepSeekTextModel(),
            messages: [
                { role: "system", content: "Return valid compact JSON only. Do not include markdown fences, commentary, or extra text." },
                { role: "user", content: prompt },
            ],
            temperature: Number.isFinite(options.temperature) ? options.temperature : 0.3,
            max_tokens: options.maxTokens || 1800,
            response_format: { type: "json_object" },
        }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data?.error?.message || `DeepSeek request failed (${response.status})`);
    }
    return parseModelJson(data?.choices?.[0]?.message?.content || "", {});
}
async function generateDeepSeekText(systemPrompt, userPrompt, options = {}) {
    const key = deepSeekApiKey();
    if (!key)
        throw new Error("DEEPSEEK_API_KEY is not configured.");
    const response = await fetch(`${deepSeekBaseUrl()}/chat/completions`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: options.model || deepSeekTextModel(),
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
            ],
            temperature: Number.isFinite(options.temperature) ? options.temperature : 0.4,
            max_tokens: options.maxTokens || 1800,
        }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data?.error?.message || `DeepSeek request failed (${response.status})`);
    }
    return String(data?.choices?.[0]?.message?.content || "").trim();
}
function rewriteGeminiTextModel() {
    return (process.env.GEMINI_TEXT_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();
}
async function generateGeminiText(systemPrompt, userPrompt, options = {}) {
    const response = await generateGeminiContent({
        model: options.model || rewriteGeminiTextModel(),
        contents: [
            {
                parts: [
                    {
                        text: `${systemPrompt}\n\n${userPrompt}`,
                    },
                ],
            },
        ],
        config: {
            temperature: Number.isFinite(options.temperature) ? options.temperature : 0.4,
        },
    });
    return String(response.text || "").trim();
}
async function generateRewriteText(systemPrompt, userPrompt, options = {}) {
    if (deepSeekApiKey()) {
        try {
            return await generateDeepSeekText(systemPrompt, userPrompt, options);
        }
        catch (error) {
            console.warn("DeepSeek rewrite failed:", error instanceof Error ? error.message : error);
            if (process.env.ALLOW_GEMINI_TEXT_FALLBACK === "true") {
                console.warn("ALLOW_GEMINI_TEXT_FALLBACK is enabled; trying Gemini text fallback.");
                return await generateGeminiText(systemPrompt, userPrompt, options);
            }
            throw error;
        }
    }
    if (process.env.ALLOW_GEMINI_TEXT_FALLBACK === "true")
        return await generateGeminiText(systemPrompt, userPrompt, options);
    throw new Error("DEEPSEEK_API_KEY is not configured.");
}
const REWRITE_CHUNK_WORD_LIMIT = 600;
const REWRITE_CHUNKING_THRESHOLD = 2400;
const REWRITE_MAX_RETRIES_PER_SEGMENT = 2;
function splitRewriteChunks(text, wordLimit = REWRITE_CHUNK_WORD_LIMIT) {
    const sentences = String(text || "").match(/[^.!?]+[.!?]+["']?\s*/g) || [String(text || "")];
    const chunks = [];
    let current = "";
    let wordCount = 0;
    for (const sentence of sentences) {
        const sentenceWords = sentence.trim().split(/\s+/).filter(Boolean).length;
        if (wordCount + sentenceWords > wordLimit && current.trim()) {
            chunks.push(current.trim());
            current = sentence;
            wordCount = sentenceWords;
        }
        else {
            current += sentence;
            wordCount += sentenceWords;
        }
    }
    if (current.trim())
        chunks.push(current.trim());
    return chunks.length ? chunks : [String(text || "")];
}
function rewriteTokens(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]+/gu, " ")
        .split(/\s+/)
        .filter(Boolean);
}
function rewriteNgrams(tokens, size) {
    if (!Array.isArray(tokens) || tokens.length < size)
        return [];
    const grams = [];
    for (let index = 0; index <= tokens.length - size; index += 1) {
        grams.push(tokens.slice(index, index + size).join(" "));
    }
    return grams;
}
function sharedRewriteNgramRatio(original, candidate, size) {
    const originalSet = new Set(rewriteNgrams(rewriteTokens(original), size));
    const candidateGrams = rewriteNgrams(rewriteTokens(candidate), size);
    if (!originalSet.size || !candidateGrams.length)
        return 0;
    let shared = 0;
    for (const gram of candidateGrams) {
        if (originalSet.has(gram))
            shared += 1;
    }
    return shared / candidateGrams.length;
}
function normalizeRewriteSentence(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]+/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function copiedRewriteSentenceRatio(original, candidate) {
    const originalText = normalizeRewriteSentence(original);
    const sentences = String(candidate || "")
        .split(/(?<=[.!?])\s+/)
        .map(normalizeRewriteSentence)
        .filter((sentence) => sentence.length >= 60);
    if (!sentences.length)
        return 0;
    const copied = sentences.filter((sentence) => originalText.includes(sentence)).length;
    return copied / sentences.length;
}
function rewriteSimilarityReport(original, candidate) {
    return {
        fourGram: sharedRewriteNgramRatio(original, candidate, 4),
        fiveGram: sharedRewriteNgramRatio(original, candidate, 5),
        copiedSentences: copiedRewriteSentenceRatio(original, candidate),
        lengthRatio: String(candidate || "").length / Math.max(String(original || "").length, 1),
    };
}
function rewriteIsTooClose(report) {
    const maxFourGram = Math.min(Math.max(Number(process.env.REWRITE_MAX_SHARED_4GRAM_RATIO) || 0.22, 0.05), 0.8);
    const maxFiveGram = Math.min(Math.max(Number(process.env.REWRITE_MAX_SHARED_5GRAM_RATIO) || 0.14, 0.03), 0.7);
    const maxCopiedSentences = Math.min(Math.max(Number(process.env.REWRITE_MAX_COPIED_SENTENCE_RATIO) || 0.08, 0), 0.6);
    return report.fourGram > maxFourGram || report.fiveGram > maxFiveGram || report.copiedSentences > maxCopiedSentences;
}
function rewriteLengthIsOff(report) {
    const minRatio = Math.min(Math.max(Number(process.env.REWRITE_MIN_LENGTH_RATIO) || 0.92, 0.5), 1);
    const maxRatio = Math.max(Math.min(Number(process.env.REWRITE_MAX_LENGTH_RATIO) || 1.08, 1.8), 1);
    return report.lengthRatio < minRatio || report.lengthRatio > maxRatio;
}
function rewriteQualityScore(report) {
    return Math.abs(1 - report.lengthRatio) * 1.4 + report.fourGram + report.fiveGram * 1.5 + report.copiedSentences * 2;
}
function buildRewriteSystemPrompt(targetCharCount, mode = "standard") {
    const minChars = Math.floor(targetCharCount * 0.92);
    const maxChars = Math.ceil(targetCharCount * 1.08);
    const extra = mode === "strong"
        ? "This candidate was too close to the source or too far from the target length. Rewrite more aggressively: change sentence openings, clause order, transition wording, verbs, and sentence rhythm while keeping the same events and meaning. Avoid reusing any phrase of five or more words from the source unless it is a character name, item name, skill name, or exact stat. If the draft is short, restore the original cadence by expanding with equivalent narration from the same facts only."
        : "This is a rewrite, not a proofreading pass. Do not merely fix grammar. Change sentence construction, transitions, and wording throughout while keeping the same story beats, factual meaning, narration style, and approximate length.";
    return `You are a YouTube recap script rewriter for faceless narration channels. Preserve the same story events, character names, sequence, tone, and pacing, but make the wording genuinely fresh. Target about ${targetCharCount} characters. The final output should be between ${minChars} and ${maxChars} characters. ${extra} Do not summarize. Do not add facts, scenes, claims, names, jokes, or calls to action that are not present. Output only the rewritten script with no preamble or commentary.`;
}
async function rewriteSegmentWithQuality(originalSegment, fullOriginalStyle, segmentLabel = "script") {
    let best = "";
    let bestReport = null;
    let bestScore = Infinity;
    for (let attempt = 0; attempt <= REWRITE_MAX_RETRIES_PER_SEGMENT; attempt += 1) {
        const mode = attempt === 0 ? "standard" : "strong";
        const systemPrompt = buildRewriteSystemPrompt(originalSegment.length, mode);
        const userPrompt = `Style reference from the full source script:

"""${String(fullOriginalStyle || originalSegment).slice(0, 900)}"""

Rewrite this ${segmentLabel}. Keep the same facts and order, but make the wording unique:

"""${originalSegment}"""

Length requirement: write between ${Math.floor(originalSegment.length * 0.92)} and ${Math.ceil(originalSegment.length * 1.08)} characters.`;
        const candidate = await generateRewriteText(systemPrompt, userPrompt, {
            temperature: attempt === 0 ? 0.55 : 0.75,
            maxTokens: Math.max(1200, Math.ceil(originalSegment.length / 2.6)),
        });
        const report = rewriteSimilarityReport(originalSegment, candidate);
        const score = rewriteQualityScore(report);
        if (!best || score < bestScore) {
            best = candidate;
            bestReport = report;
            bestScore = score;
        }
        if (!rewriteIsTooClose(report) && !rewriteLengthIsOff(report))
            return candidate.trim();
        console.warn("Rewrite quality guard retrying segment:", { segmentLabel, attempt: attempt + 1, ...report });
    }
    return String(best || "").trim();
}
async function rewriteScriptText(originalText) {
    const text = String(originalText || "").trim();
    if (!text)
        throw new Error("No script text was provided.");
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    if (wordCount <= REWRITE_CHUNKING_THRESHOLD) {
        return await rewriteSegmentWithQuality(text, text, "script");
    }
    const chunks = splitRewriteChunks(text, REWRITE_CHUNK_WORD_LIMIT);
    const rewrittenChunks = [];
    for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index];
        rewrittenChunks.push(await rewriteSegmentWithQuality(chunk, text, `segment ${index + 1} of ${chunks.length}`));
    }
    return rewrittenChunks.join("\n\n").trim();
}
function voiceboxBaseCandidates() {
    const configured = (process.env.VOICEBOX_BASE_URL || process.env.VOICEBOX_URL || "").trim();
    const defaults = ["http://127.0.0.1:8000", "http://127.0.0.1:17493"];
    return [...new Set([configured, ...defaults].filter(Boolean).map((url) => url.replace(/\/+$/g, "")))];
}
async function voiceboxFetch(pathname, options = {}) {
    const bases = voiceboxBaseCandidates();
    let lastError = null;
    for (const base of bases) {
        try {
            const response = await fetch(`${base}${pathname}`, options);
            if (response.ok)
                return { response, base };
            const body = await response.text().catch(() => "");
            lastError = new Error(body || `Voicebox request failed (${response.status})`);
        }
        catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error("Voicebox is not reachable. Start Voicebox and set VOICEBOX_BASE_URL if needed.");
}
async function voiceboxJson(pathname, options = {}) {
    const { response, base } = await voiceboxFetch(pathname, options);
    const data = await response.json().catch(() => ({}));
    return { data, base };
}
async function findVoiceboxProfile(profileId) {
    const id = String(profileId || "").trim();
    if (!id)
        return null;
    const { data } = await voiceboxJson("/profiles", { method: "GET" });
    if (!Array.isArray(data))
        return null;
    const rawProfile = data.find((profile) => String(profile?.id || "") === id);
    return rawProfile ? normalizeVoiceboxProfile(rawProfile) : null;
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function waitForVoiceboxGeneration(id, timeoutMs = 120000) {
    const startedAt = Date.now();
    let lastData = null;
    while (Date.now() - startedAt < timeoutMs) {
        try {
            const { data } = await voiceboxJson(`/history/${encodeURIComponent(id)}`, { method: "GET" });
            if (data?.id) {
                lastData = data;
                const status = String(data.status || "").toLowerCase();
                if (status === "completed" || status === "failed" || status === "cancelled")
                    return data;
            }
        }
        catch (_error) {
            // Voicebox may not have written the history row immediately after /generate returns.
        }
        await delay(1200);
    }
    return lastData;
}
function normalizeVoiceboxProfile(profile) {
    return {
        id: String(profile?.id || profile?.name || ""),
        name: String(profile?.name || "Untitled voice"),
        description: String(profile?.description || ""),
        language: String(profile?.language || "en"),
        voiceType: String(profile?.voice_type || profile?.voiceType || "cloned"),
        presetEngine: String(profile?.preset_engine || profile?.presetEngine || ""),
        presetVoiceId: String(profile?.preset_voice_id || profile?.presetVoiceId || ""),
        defaultEngine: String(profile?.default_engine || profile?.defaultEngine || profile?.preset_engine || ""),
        sampleCount: Number(profile?.sample_count || profile?.sampleCount || 0),
        createdAt: profile?.created_at || profile?.createdAt || null,
        updatedAt: profile?.updated_at || profile?.updatedAt || null,
        raw: profile,
    };
}
function normalizeVoiceboxEngine(value) {
    const raw = String(value || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
    if (!raw)
        return "";
    if (raw.includes("qwen-custom"))
        return "qwen_custom_voice";
    if (raw.includes("chatterbox-turbo"))
        return "chatterbox_turbo";
    if (raw.includes("chatterbox"))
        return "chatterbox";
    if (raw.includes("luxtts"))
        return "luxtts";
    if (raw.includes("kokoro"))
        return "kokoro";
    if (raw.includes("tada"))
        return "tada";
    if (raw.includes("qwen"))
        return "qwen";
    return String(value || "").trim();
}
async function generateTextJson(prompt, geminiFallback) {
    let lastError = null;
    if (deepSeekApiKey()) {
        try {
            return await generateDeepSeekJson(prompt);
        }
        catch (error) {
            lastError = error;
            console.warn("DeepSeek text generation failed:", error instanceof Error ? error.message : error);
        }
    }
    if (dashScopeApiKey()) {
        try {
            const data = await generateDashScopeChat({
                model: qwenMovieTextModel(),
                messages: [
                    { role: "system", content: "Return valid compact JSON only. Do not include markdown fences, commentary, or extra text." },
                    { role: "user", content: prompt },
                ],
                temperature: 0.25,
                max_tokens: 1800,
                response_format: { type: "json_object" },
            });
            return parseModelJson(data?.choices?.[0]?.message?.content || "", {});
        }
        catch (error) {
            lastError = error;
            console.warn("Qwen text generation failed:", error instanceof Error ? error.message : error);
        }
    }
    if (process.env.ALLOW_GEMINI_TEXT_FALLBACK === "true" && typeof geminiFallback === "function") {
        try {
            return await geminiFallback();
        }
        catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error("No text generation provider is configured.");
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
function parseModelJsonLoose(text, fallback = {}) {
    try {
        return parseModelJson(text, fallback);
    }
    catch {
        const raw = String(text || "").trim();
        const title = raw.match(/"?(?:bestTitle|title)"?\s*:\s*"([^"]+)"/i)?.[1] || "";
        const year = raw.match(/"?(?:year)"?\s*:\s*"?(\d{4})"?/i)?.[1] || "";
        const mediaType = raw.match(/"?(?:mediaType)"?\s*:\s*"([^"]+)"/i)?.[1] || "";
        const confidence = Number(raw.match(/"?(?:confidence)"?\s*:\s*"?([0-9.]+)"?/i)?.[1] || 0);
        if (title) {
            return {
                ...fallback,
                title,
                year,
                mediaType,
                confidence: confidence || fallback.confidence || 0.7,
                summary: fallback.summary || "",
                evidence: {
                    ...(fallback.evidence || {}),
                    reasoning: transcriptExcerpt(raw, 1000),
                },
            };
        }
        return fallback;
    }
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
    return record?.result && typeof record.result === "object" ? preferEnglishAnimeResultTitle(record.result) : null;
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
async function getCachedTikTokComments(tiktokVideoId = "") {
    const videoId = String(tiktokVideoId || "").trim();
    if (!postgresConfigured() || !videoId)
        return null;
    const out = await runPsql(`
SELECT COALESCE((
  SELECT json_build_object(
    'videoId', tiktok_video_id,
    'normalizedUrl', normalized_url,
    'authorUniqueId', author_unique_id,
    'payload', payload
  )
  FROM tiktok_comment_cache
  WHERE tiktok_video_id = ${sqlString(videoId)}
    AND (expires_at IS NULL OR expires_at > now())
  LIMIT 1
), 'null'::json);
`);
    if (!out)
        return null;
    try {
        const record = JSON.parse(out || "null");
        if (!record || typeof record !== "object")
            return null;
        const payload = record.payload;
        if (!payload || typeof payload !== "object" || !Array.isArray(payload.threads))
            return null;
        return {
            ...payload,
            videoId: payload.videoId || record.videoId || videoId,
            authorUniqueId: payload.authorUniqueId || record.authorUniqueId || "",
            cached: true,
        };
    }
    catch {
        return null;
    }
}
async function storeTikTokCommentCache(tiktokVideoId = "", normalizedUrl = "", payload = {}) {
    const videoId = String(tiktokVideoId || payload?.videoId || "").trim();
    if (!postgresConfigured() || !videoId || !payload || typeof payload !== "object" || !Array.isArray(payload.threads))
        return null;
    await runPsql(`
INSERT INTO tiktok_comment_cache (
  tiktok_video_id, normalized_url, author_unique_id, payload, expires_at, created_at, updated_at
)
VALUES (
  ${sqlString(videoId)},
  ${sqlString(normalizedUrl || "")},
  ${sqlString(String(payload.authorUniqueId || ""))},
  ${jsonbLiteral(payload)},
  ${tiktokCommentCacheExpirySql()},
  now(),
  now()
)
ON CONFLICT (tiktok_video_id) DO UPDATE SET
  normalized_url = COALESCE(NULLIF(EXCLUDED.normalized_url, ''), tiktok_comment_cache.normalized_url),
  author_unique_id = COALESCE(NULLIF(EXCLUDED.author_unique_id, ''), tiktok_comment_cache.author_unique_id),
  payload = EXCLUDED.payload,
  expires_at = EXCLUDED.expires_at,
  updated_at = now();
`);
    return videoId;
}
function movieIdCommentHintsEnabled() {
    return !["0", "false", "off"].includes(String(process.env.MOVIE_ID_COMMENT_HINTS || "true").trim().toLowerCase());
}
function tiktokMovieCommentLookupUrl(cacheLookup = {}) {
    const lookup = normalizeMovieCacheLookup(cacheLookup);
    if (lookup.normalizedUrl && /tiktok\.com/i.test(lookup.normalizedUrl))
        return lookup.normalizedUrl;
    if (lookup.tiktokVideoId)
        return `https://www.tiktok.com/@unknown/video/${lookup.tiktokVideoId}`;
    return "";
}
async function identifyMovieFromVideoFile(filePath, mimeType = "video/mp4", cacheLookup = {}) {
    const fileBuffer = fs.readFileSync(filePath);
    const fileHash = crypto.createHash("sha256").update(fileBuffer).digest("hex");
    const lookup = normalizeMovieCacheLookup({ ...cacheLookup, fileHash });
    const cached = await getCachedMovieIdentification(lookup).catch(() => null);
    if (cached)
        return cached;
    const localTranscript = await transcribeMediaFileForAnalysis(filePath).catch((error) => {
        console.warn("Movie ID local transcription skipped:", error instanceof Error ? error.message : error);
        return "";
    });
    const result = await identifyMovieFromVideoBuffer(fileBuffer, mimeType, { localTranscript, filePath, cacheLookup: lookup });
    if (movieIdResultMayBeCached(result)) {
        await storeMovieIdentificationCache(lookup, result).catch((error) => {
            console.warn("Movie ID cache write skipped:", error instanceof Error ? error.message : error);
        });
    }
    return result;
}
async function qwenTranscribeMediaForMovieId(filePath) {
    if (!filePath || !dashScopeApiKey())
        return "";
    const tmpDir = path.join(__dirname, "tmp");
    if (!fs.existsSync(tmpDir))
        fs.mkdirSync(tmpDir, { recursive: true });
    const audioPath = path.join(tmpDir, `qwen-asr-${crypto.randomBytes(12).toString("hex")}.wav`);
    try {
        await extractAudioForTranscription(filePath, audioPath);
        const audioBase64 = fs.readFileSync(audioPath).toString("base64");
        const data = await generateDashScopeChat({
            model: qwenAsrModel(),
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "input_audio",
                            input_audio: {
                                data: `data:audio/wav;base64,${audioBase64}`,
                            },
                        },
                    ],
                },
            ],
            stream: false,
            asr_options: {
                enable_itn: true,
                language: "en",
            },
        });
        return String(data?.choices?.[0]?.message?.content || "").trim();
    }
    finally {
        if (fs.existsSync(audioPath)) {
            try {
                fs.unlinkSync(audioPath);
            }
            catch {
                /* ignore cleanup */
            }
        }
    }
}
async function generateQwenMovieCandidates(localTranscript, context = {}) {
    const fullTranscript = String(localTranscript || "").trim();
    if (!dashScopeApiKey() || !fullTranscript)
        return { candidates: [] };
    const sourceContext = context.cacheLookup || context.sourceContext || {};
    const prompt = `Create a compact candidate retrieval list for identifying the source title of a recap clip.

Use known media knowledge plus these clues. The narrator may rename characters, so focus on plot, places, objects, powers, dialogue, visual terms, and franchise-specific story beats.

Source context:
${JSON.stringify(sourceContext)}

Transcript:
${fullTranscript}

Return JSON only:
{
  "candidates": [
    {"title":"", "year":"", "mediaType":"movie|tv|anime|manga|manhwa|donghua|game|unknown", "reason":""}
  ]
}
Include up to 5 candidates and make the top candidate the best match.`;
    try {
        const data = await generateDashScopeChat({
            model: qwenMovieTextModel(),
            messages: [
                { role: "system", content: "Return valid compact JSON only. Do not include markdown fences or commentary." },
                { role: "user", content: prompt },
            ],
            temperature: 0.1,
            max_tokens: 1200,
            response_format: { type: "json_object" },
        });
        const parsed = parseModelJsonLoose(data?.choices?.[0]?.message?.content || "", { candidates: [] });
        return {
            candidates: Array.isArray(parsed.candidates) ? parsed.candidates.slice(0, 5) : [],
        };
    }
    catch (error) {
        console.warn("Qwen movie candidate generation failed:", error instanceof Error ? error.message : error);
        return { candidates: [] };
    }
}
function qwenCandidateContextText(candidates = []) {
    const list = Array.isArray(candidates) ? candidates : [];
    if (!list.length)
        return "No candidate list available. Identify cautiously from transcript and visuals.";
    return list.map((item, index) => {
        const title = String(item?.title || "").trim();
        const year = String(item?.year || "").match(/\d{4}/)?.[0] || "";
        const mediaType = String(item?.mediaType || "").trim();
        const reason = transcriptExcerpt(item?.reason || "", 500);
        return `${index + 1}. ${title}${year ? ` (${year})` : ""}${mediaType ? ` - ${mediaType}` : ""}${reason ? `: ${reason}` : ""}`;
    }).join("\n");
}
function normalizeQwenMovieResult(data = {}, localTranscript = "", candidates = []) {
    const best = data.bestTitle || data.title || data.sourceTitle || "";
    const transcript = data.transcript && typeof data.transcript === "object" ? data.transcript : {};
    const clues = [
        ...(Array.isArray(data.transcriptClues) ? data.transcriptClues : []),
        ...(Array.isArray(data.audioOrSubtitleClues) ? data.audioOrSubtitleClues : []),
    ].map((item) => String(item || "").trim()).filter(Boolean);
    const visualClues = Array.isArray(data.visualClues)
        ? data.visualClues.map((item) => String(item || "").trim()).filter(Boolean)
        : [];
    return {
        title: String(best || candidates?.[0]?.title || "").trim(),
        year: String(data.year || candidates?.[0]?.year || "").match(/\d{4}/)?.[0] || "",
        mediaType: String(data.mediaType || candidates?.[0]?.mediaType || "").trim(),
        genre: String(data.genre || "").trim(),
        confidence: Math.min(Math.max(Number(data.confidence || 0.72), 0), 1),
        summary: String(data.summary || data.whyThisCandidateWins || data.evidence || "").trim().slice(0, 1200),
        transcript: {
            ...transcript,
            excerpt: String(transcript.excerpt || transcriptExcerpt(localTranscript, 1200) || "").trim(),
            fullText: localTranscript || "",
            hooks: clues.slice(0, 8),
            contentStyle: Array.isArray(transcript.contentStyle) ? transcript.contentStyle : [],
            structure: Array.isArray(transcript.structure) ? transcript.structure : [],
        },
        contentNiche: data.contentNiche || {
            primary: String(data.mediaType || candidates?.[0]?.mediaType || "Entertainment").trim(),
            subNiche: String(data.genre || "").trim(),
            microSubNiche: "",
            hookPattern: "",
            contentFormat: "short-form recap",
            audience: "",
            rationale: String(data.whyThisCandidateWins || "").trim().slice(0, 1000),
            opportunities: [],
            platforms: ["YouTube Shorts", "TikTok", "Instagram Reels"],
        },
        evidence: {
            audio: clues.join(" | ").slice(0, 1200),
            visual: visualClues.join(" | ").slice(0, 1200),
            reasoning: String(data.whyThisCandidateWins || data.evidence || data.uncertainty || "").trim().slice(0, 1200),
        },
        qwenFallback: {
            used: true,
            candidates,
            rejectedCandidates: data.rejectedCandidates || [],
            uncertainty: data.uncertainty || "",
        },
    };
}
async function compactLocalVideoForQwen(filePath) {
    if (!filePath || !fs.existsSync(filePath))
        throw new Error("Qwen fallback requires a local video file.");
    const tmpDir = path.join(__dirname, "tmp");
    if (!fs.existsSync(tmpDir))
        fs.mkdirSync(tmpDir, { recursive: true });
    const attempts = [
        { videoBitrate: "420k", maxRate: "520k", audioBitrate: "48k", height: 720 },
        { videoBitrate: "260k", maxRate: "340k", audioBitrate: "40k", height: 540 },
    ];
    let lastError = null;
    for (const attempt of attempts) {
        const outputPath = path.join(tmpDir, `qwen-movie-id-${crypto.randomBytes(12).toString("hex")}.mp4`);
        try {
            await runFfmpeg([
                "-y",
                "-i", filePath,
                "-map", "0:v:0",
                "-map", "0:a?",
                "-vf", `scale=-2:${attempt.height}:force_original_aspect_ratio=decrease`,
                "-c:v", "libx264",
                "-preset", "veryfast",
                "-b:v", attempt.videoBitrate,
                "-maxrate", attempt.maxRate,
                "-bufsize", "1040k",
                "-c:a", "aac",
                "-b:a", attempt.audioBitrate,
                "-movflags", "+faststart",
                outputPath,
            ], 300000);
            const compactBuffer = fs.readFileSync(outputPath);
            if (!qwenMovieIdNeedsCompactLocalVideo(compactBuffer, "video/mp4"))
                return compactBuffer;
            lastError = new Error("Compact Qwen video still exceeds the inline video limit.");
        }
        catch (error) {
            lastError = error;
        }
        finally {
            try {
                if (fs.existsSync(outputPath))
                    fs.unlinkSync(outputPath);
            }
            catch {
                /* ignore */
            }
        }
    }
    throw lastError || new Error("Could not prepare a compact local video for Qwen.");
}
async function identifyMovieWithQwenFallback(fileBuffer, mimeType = "video/mp4", context = {}) {
    if (!dashScopeApiKey())
        throw new Error("DASHSCOPE_API_KEY is not configured.");
    let localTranscript = String(context.localTranscript || "").trim();
    if (!localTranscript && context.filePath) {
        localTranscript = await qwenTranscribeMediaForMovieId(context.filePath).catch((error) => {
            console.warn("Qwen ASR fallback transcript failed:", error instanceof Error ? error.message : error);
            return "";
        });
    }
    const candidates = (await generateQwenMovieCandidates(localTranscript, context)).candidates || [];
    const prompt = `Identify the source title in this full recap clip. Use the full video, subtitles/overlays, ASR transcript, and candidate retrieval context.

The answer may be a movie, TV series, anime, manga, manhwa, manhua, webtoon, donghua, light novel adaptation, or game. The narrator may rename characters. Prefer the candidate that matches exact story beats, named objects, locations, powers, timeline, and visuals. If none fit, identify cautiously and keep confidence below 0.7.

Source context:
${JSON.stringify(context.cacheLookup || context.sourceContext || {})}

Full ASR transcript:
${localTranscript || "Not available"}

Candidate retrieval context:
${qwenCandidateContextText(candidates)}

Return compact JSON only with: title, bestTitle, year, mediaType, genre, confidence, summary, whyThisCandidateWins, transcriptClues, visualClues, rejectedCandidates, uncertainty.`;
    const qwenVideoBuffer = qwenMovieIdNeedsCompactLocalVideo(fileBuffer, mimeType)
        ? await compactLocalVideoForQwen(context.filePath)
        : fileBuffer;
    const dataUrl = qwenMovieIdVideoReference(qwenVideoBuffer, mimeType, {});
    if (!dataUrl)
        throw new Error("Could not create a local Qwen video payload.");
    const data = await generateDashScopeChat({
        model: qwenMovieVisionModel(),
        messages: [
            {
                role: "user",
                content: [
                    { type: "video_url", video_url: { url: dataUrl }, fps: 1 },
                    { type: "text", text: prompt },
                ],
            },
        ],
        temperature: 0.05,
        max_tokens: 1600,
        response_format: { type: "json_object" },
    });
    const parsed = parseModelJsonLoose(data?.choices?.[0]?.message?.content || "", {});
    const result = normalizeQwenMovieResult(parsed, localTranscript, candidates);
    if (!result.title)
        throw new Error("Qwen fallback could not identify a source title.");
    return finalizeMovieIdResult(fileBuffer, mimeType, context, result);
}
async function identifyMovieWithCompactGeminiRetry(fileBuffer, mimeType = "video/mp4", context = {}) {
    const localTranscript = String(context.localTranscript || "").trim();
    const response = await generateGeminiContent({
        model: "gemini-3-flash-preview",
        contents: [
            {
                parts: [
                    {
                        text: `Retry source-title identification for this clip with a compact answer only. Use the video, local transcript, and Google Search when needed to identify the exact source title. It may be movie, TV, anime, manga, manhwa, manhua, webtoon, donghua, or light novel adaptation. Do not infer a famous title from generic reincarnation or recap tropes; prefer the title supported by exact characters, scene events, visible art, and search evidence. Return only JSON with short fields.

Full faster-whisper transcript:
${localTranscript || "Not available"}`,
                    },
                    {
                        inlineData: {
                            mimeType,
                            data: fileBuffer.toString("base64"),
                        },
                    },
                ],
            },
        ],
        config: {
            responseMimeType: "application/json",
            maxOutputTokens: 2048,
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    title: { type: Type.STRING },
                    year: { type: Type.STRING },
                    mediaType: { type: Type.STRING },
                    genre: { type: Type.STRING },
                    confidence: { type: Type.NUMBER },
                    summary: { type: Type.STRING },
                    transcript: {
                        type: Type.OBJECT,
                        properties: {
                            excerpt: { type: Type.STRING },
                            hooks: { type: Type.ARRAY, items: { type: Type.STRING } },
                        },
                    },
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
    let result;
    try {
        result = parseModelJson(response.text, {});
    }
    catch (error) {
        result = recoverCompactMovieIdJson(response.text, {});
        if (!result?.title)
            throw error;
        console.warn("Recovered clipped compact Gemini Movie ID JSON:", error instanceof Error ? error.message : error);
    }
    const transcript = result.transcript && typeof result.transcript === "object" ? result.transcript : {};
    result.transcript = {
        ...transcript,
        excerpt: String(transcript.excerpt || transcriptExcerpt(localTranscript, 1200) || "").trim(),
        fullText: localTranscript || "",
    };
    if (!result.title)
        throw new Error("Compact Gemini retry did not identify a source title.");
    return finalizeMovieIdResult(fileBuffer, mimeType, context, result);
}
async function identifyMovieFromVideoBuffer(fileBuffer, mimeType = "video/mp4", context = {}) {
    const base64 = fileBuffer.toString("base64");
    const localTranscript = String(context.localTranscript || "").trim();
    let response;
    try {
        response = await generateGeminiContent({
            model: "gemini-3-flash-preview",
            contents: [
                {
                    parts: [
                        {
                            text: `Identify the source title in this video clip. It may be a movie, TV series, anime, manga, manhwa, manhua, webtoon, donghua, or light novel adaptation. Return only compact JSON. Include the exact title, 4-digit year when visible or searchable, mediaType, genre, summary, a short transcript excerpt, content niche, sub-niche, micro-sub-niche, hook pattern, content format, and evidence. Do not return a full transcript or any field longer than 1200 characters. If it is manga or manhwa pages under narration, identify the manga/manhwa/webtoon title instead of calling it a slideshow. If uncertain, keep confidence below 0.7.

Full faster-whisper transcript, if available:
${localTranscript || "Not available"}`,
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
                maxOutputTokens: 8192,
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        title: { type: Type.STRING },
                        year: { type: Type.STRING },
                        mediaType: { type: Type.STRING },
                        genre: { type: Type.STRING },
                        confidence: { type: Type.NUMBER },
                        summary: { type: Type.STRING },
                        transcript: {
                            type: Type.OBJECT,
                            properties: {
                                excerpt: { type: Type.STRING },
                                hooks: { type: Type.ARRAY, items: { type: Type.STRING } },
                                contentStyle: { type: Type.ARRAY, items: { type: Type.STRING } },
                                structure: { type: Type.ARRAY, items: { type: Type.STRING } },
                            },
                        },
                        contentNiche: {
                            type: Type.OBJECT,
                            properties: {
                                primary: { type: Type.STRING },
                                subNiche: { type: Type.STRING },
                                microSubNiche: { type: Type.STRING },
                                hookPattern: { type: Type.STRING },
                                contentFormat: { type: Type.STRING },
                                audience: { type: Type.STRING },
                                rationale: { type: Type.STRING },
                                opportunities: { type: Type.ARRAY, items: { type: Type.STRING } },
                                platforms: { type: Type.ARRAY, items: { type: Type.STRING } },
                            },
                        },
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
    }
    catch (error) {
        if (!dashScopeApiKey() || !movieIdShouldUseQwenFallback(error))
            throw error;
        console.warn("Gemini Movie ID unavailable for quota/access; trying Qwen fallback:", error instanceof Error ? error.message : error);
        return await identifyMovieWithQwenFallback(fileBuffer, mimeType, context);
    }
    let result;
    try {
        result = parseModelJson(response.text, {});
    }
    catch (error) {
        console.warn("Gemini Movie ID returned malformed JSON; trying compact Gemini retry:", error instanceof Error ? error.message : error);
        try {
            return await identifyMovieWithCompactGeminiRetry(fileBuffer, mimeType, context);
        }
        catch (retryError) {
            if (!dashScopeApiKey() || !movieIdShouldUseQwenFallback(retryError))
                throw retryError;
            console.warn("Compact Gemini Movie ID unavailable for quota/access; trying Qwen fallback:", retryError instanceof Error ? retryError.message : retryError);
            return await identifyMovieWithQwenFallback(fileBuffer, mimeType, context);
        }
    }
    const transcript = result.transcript && typeof result.transcript === "object" ? result.transcript : {};
    result.transcript = {
        ...transcript,
        excerpt: String(transcript.excerpt || transcriptExcerpt(localTranscript, 1200) || "").trim(),
        fullText: localTranscript || "",
    };
    return finalizeMovieIdResult(fileBuffer, mimeType, context, result);
}
function fallbackFacelessContentIdentity(video = {}, settings = {}, error = null) {
    const title = String(video.title || "TikTok clip").trim() || "TikTok clip";
    const genre = String(settings.genreFocus || "Faceless short-form content").trim();
    const microNiche = String(settings.microNicheGoal || "").trim();
    const hookPattern = inferHookPatternFromText(title, genre, microNiche);
    return {
        title,
        year: "",
        mediaType: "faceless-content",
        genre,
        confidence: 0.35,
        summary: title,
        transcript: {
            excerpt: "",
            fullText: "",
            hooks: [],
            contentStyle: [],
            structure: [],
        },
        contentNiche: {
            primary: genre,
            subNiche: "",
            microSubNiche: microNiche,
            hookPattern,
            contentFormat: "short-form faceless clip",
            audience: "",
            rationale: error ? `Fallback metadata analysis used because video analysis failed: ${String(error.message || error).slice(0, 180)}` : "Fallback metadata analysis from source title and agent settings.",
            opportunities: [],
            platforms: ["YouTube Shorts", "TikTok", "Instagram Reels"],
        },
        facelessAnalysis: {
            contentCategory: "unknown",
            commentaryPresence: "unclear",
            monetization: {
                rpmTier: "",
                riskLevel: "",
                repeatability: "",
                shortsToLongformPotential: "",
                sponsorFit: "",
                recommendations: [],
            },
        },
        evidence: {
            audio: "",
            visual: "",
            reasoning: "Only source metadata was available.",
        },
    };
}
async function buildTranscriptBackedAutomationFallback(filePath, video = {}, settings = {}, error = null) {
    const localTranscript = await transcribeMediaFileForAnalysis(filePath).catch((transcriptionError) => {
        console.warn("Automation fallback transcription skipped:", transcriptionError instanceof Error ? transcriptionError.message : transcriptionError);
        return "";
    });
    const base = buildAutomationMovieIdFallback({ video, settings, transcript: localTranscript, error });
    const prompt = `Analyze this automation candidate from its transcript and source metadata. Movie ID vision failed, but the clip must still be published.

Source metadata:
${JSON.stringify({
        title: video.title || "",
        author: video.authorHandle || video.author || "",
        stats: video.stats || {},
        durationSeconds: video.durationSeconds || video.duration || 0,
        genreFocus: settings.genreFocus || "",
        microNicheGoal: settings.microNicheGoal || "",
    })}

Full local transcript:
${localTranscript || "Not available"}

Do not claim a movie/anime title unless the transcript explicitly identifies it. Return JSON with summary, primaryNiche, subNiche, microSubNiche, hookPattern, contentFormat, audience, transcriptHooks, and transcriptStructure.`;
    const data = await generateTextJson(prompt).catch((textError) => {
        console.warn("Automation transcript fallback text analysis skipped:", textError instanceof Error ? textError.message : textError);
        return {};
    });
    const transcriptHooks = Array.isArray(data.transcriptHooks) ? data.transcriptHooks.map((item) => String(item).trim()).filter(Boolean).slice(0, 8) : [];
    const transcriptStructure = Array.isArray(data.transcriptStructure) ? data.transcriptStructure.map((item) => String(item).trim()).filter(Boolean).slice(0, 8) : [];
    return {
        ...base,
        summary: String(data.summary || base.summary).trim(),
        transcript: {
            ...base.transcript,
            hooks: transcriptHooks,
            structure: transcriptStructure,
        },
        contentNiche: {
            ...base.contentNiche,
            primary: String(data.primaryNiche || base.contentNiche.primary).trim(),
            subNiche: String(data.subNiche || base.contentNiche.subNiche).trim(),
            microSubNiche: String(data.microSubNiche || base.contentNiche.microSubNiche).trim(),
            hookPattern: String(data.hookPattern || base.contentNiche.hookPattern).trim(),
            contentFormat: String(data.contentFormat || base.contentNiche.contentFormat).trim(),
            audience: String(data.audience || base.contentNiche.audience).trim(),
        },
    };
}
async function analyzeFacelessContentFromVideoFile(filePath, mimeType = "video/mp4", context = {}) {
    const fileBuffer = fs.readFileSync(filePath);
    const localTranscript = await transcribeMediaFileForAnalysis(filePath).catch((error) => {
        console.warn("Faceless content local transcription skipped:", error instanceof Error ? error.message : error);
        return "";
    });
    return analyzeFacelessContentFromVideoBuffer(fileBuffer, mimeType, { ...context, localTranscript });
}
async function analyzeFacelessContentFromVideoBuffer(fileBuffer, mimeType = "video/mp4", context = {}) {
    const base64 = fileBuffer.toString("base64");
    const localTranscript = String(context.localTranscript || "").trim();
    const localTranscriptPreview = transcriptExcerpt(localTranscript, 4500);
    const response = await generateGeminiContent({
        model: "gemini-3-flash-preview",
        contents: [
            {
                parts: [
                    {
                        text: `Analyze this short-form faceless content clip for an AutoYT automation agent. It may be anime/movie recap, sports, geography, history, facts, finance, AI story, moral story, satisfying visuals, compilation, comedy, motivation, or any other faceless niche.

Return only JSON. Do not force it into movie/anime. If there is spoken commentary, summarize the transcript and content structure. If there is no commentary, infer the topic and hook from visuals, on-screen text, pacing, and source metadata.

Source context:
${JSON.stringify(compactAnalysisContextForPrompt(context, 1200))}

Local faster-whisper transcript excerpt, if available:
${localTranscriptPreview || "Not available"}

Include:
- content category, topic family, summary, confidence, commentary presence
- primary niche, sub-niche, micro-sub-niche, hook pattern, repeatable content format, likely audience
- short transcript excerpt/hooks/structure when audio or text commentary exists
- visual pattern and pacing if the clip is non-verbal
- monetization fit: RPM tier, copyright/brand risk, repeatability, sponsor fit, shorts-to-longform potential, and practical recommendations for getting monetized faster.`,
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
            maxOutputTokens: 4096,
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    title: { type: Type.STRING },
                    contentCategory: { type: Type.STRING },
                    topicFamily: { type: Type.STRING },
                    summary: { type: Type.STRING },
                    confidence: { type: Type.NUMBER },
                    commentaryPresence: { type: Type.STRING },
                    hookPattern: { type: Type.STRING },
                    contentFormat: { type: Type.STRING },
                    transcript: {
                        type: Type.OBJECT,
                        properties: {
                            excerpt: { type: Type.STRING },
                            hooks: { type: Type.ARRAY, items: { type: Type.STRING } },
                            contentStyle: { type: Type.ARRAY, items: { type: Type.STRING } },
                            structure: { type: Type.ARRAY, items: { type: Type.STRING } },
                        },
                    },
                    contentNiche: {
                        type: Type.OBJECT,
                        properties: {
                            primary: { type: Type.STRING },
                            subNiche: { type: Type.STRING },
                            microSubNiche: { type: Type.STRING },
                            hookPattern: { type: Type.STRING },
                            contentFormat: { type: Type.STRING },
                            audience: { type: Type.STRING },
                            rationale: { type: Type.STRING },
                            opportunities: { type: Type.ARRAY, items: { type: Type.STRING } },
                            platforms: { type: Type.ARRAY, items: { type: Type.STRING } },
                        },
                    },
                    visualAnalysis: {
                        type: Type.OBJECT,
                        properties: {
                            visualStyle: { type: Type.STRING },
                            pacing: { type: Type.STRING },
                            onScreenText: { type: Type.STRING },
                            productionPattern: { type: Type.STRING },
                        },
                    },
                    monetization: {
                        type: Type.OBJECT,
                        properties: {
                            rpmTier: { type: Type.STRING },
                            riskLevel: { type: Type.STRING },
                            repeatability: { type: Type.STRING },
                            shortsToLongformPotential: { type: Type.STRING },
                            sponsorFit: { type: Type.STRING },
                            recommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
                        },
                    },
                    evidence: {
                        type: Type.OBJECT,
                        properties: {
                            audio: { type: Type.STRING },
                            visual: { type: Type.STRING },
                            reasoning: { type: Type.STRING },
                        },
                    },
                },
                required: ["title", "contentCategory", "summary", "confidence", "contentNiche"],
            },
        },
    });
    const data = parseModelJson(response.text, {});
    const niche = data.contentNiche || {};
    const transcript = data.transcript || {};
    const visualAnalysis = data.visualAnalysis || {};
    const monetization = data.monetization || {};
    const title = String(data.title || context.sourceTitle || "Faceless content clip").trim() || "Faceless content clip";
    const primary = String(niche.primary || data.topicFamily || context.genreFocus || data.contentCategory || "Faceless content").trim();
    const microSubNiche = String(niche.microSubNiche || context.microNicheGoal || "").trim();
    return {
        title,
        year: "",
        mediaType: "faceless-content",
        genre: String(data.topicFamily || primary || context.genreFocus || "").trim(),
        confidence: Number(data.confidence || 0.7),
        summary: String(data.summary || context.sourceTitle || title).trim(),
        transcript: {
            excerpt: String(transcript.excerpt || transcriptExcerpt(localTranscript, 1200) || "").trim(),
            fullText: localTranscript,
            hooks: Array.isArray(transcript.hooks) ? transcript.hooks.map((item) => String(item).trim()).filter(Boolean).slice(0, 8) : [],
            contentStyle: Array.isArray(transcript.contentStyle) ? transcript.contentStyle.map((item) => String(item).trim()).filter(Boolean).slice(0, 8) : [],
            structure: Array.isArray(transcript.structure) ? transcript.structure.map((item) => String(item).trim()).filter(Boolean).slice(0, 8) : [],
        },
        contentNiche: {
            primary,
            subNiche: String(niche.subNiche || context.genreFocus || "").trim(),
            microSubNiche,
            hookPattern: String(niche.hookPattern || data.hookPattern || inferHookPatternFromText(title, primary, microSubNiche)).trim(),
            contentFormat: String(niche.contentFormat || data.contentFormat || "short-form faceless clip").trim(),
            audience: String(niche.audience || "").trim(),
            rationale: String(niche.rationale || "").trim(),
            opportunities: Array.isArray(niche.opportunities) ? niche.opportunities.map((item) => String(item).trim()).filter(Boolean).slice(0, 8) : [],
            platforms: Array.isArray(niche.platforms) ? niche.platforms.map((item) => String(item).trim()).filter(Boolean).slice(0, 5) : ["YouTube Shorts", "TikTok", "Instagram Reels"],
        },
        facelessAnalysis: {
            contentCategory: String(data.contentCategory || "unknown").trim(),
            commentaryPresence: String(data.commentaryPresence || "unclear").trim(),
            visualAnalysis: {
                visualStyle: String(visualAnalysis.visualStyle || "").trim(),
                pacing: String(visualAnalysis.pacing || "").trim(),
                onScreenText: String(visualAnalysis.onScreenText || "").trim(),
                productionPattern: String(visualAnalysis.productionPattern || "").trim(),
            },
            monetization: {
                rpmTier: String(monetization.rpmTier || "").trim(),
                riskLevel: String(monetization.riskLevel || "").trim(),
                repeatability: String(monetization.repeatability || "").trim(),
                shortsToLongformPotential: String(monetization.shortsToLongformPotential || "").trim(),
                sponsorFit: String(monetization.sponsorFit || "").trim(),
                recommendations: Array.isArray(monetization.recommendations) ? monetization.recommendations.map((item) => String(item).trim()).filter(Boolean).slice(0, 8) : [],
            },
        },
        evidence: {
            audio: String(data.evidence?.audio || "").trim(),
            visual: String(data.evidence?.visual || "").trim(),
            reasoning: String(data.evidence?.reasoning || "").trim(),
        },
    };
}
async function enrichServerTmdbResult(result) {
    const title = String(result.title || "").trim();
    if (!title)
        return result;
    try {
        const year = String(result.year || "").match(/\d{4}/)?.[0] || "";
        const data = await fetchTmdbJson("search/multi", { query: title, include_adult: "false" });
        const match = chooseTmdbTitle(data.results || [], title, year);
        if (!match)
            return result;
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
            mediaType: result.mediaType || mediaType,
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
        return result;
    }
}
function enrichedTitleMatchQuality(enriched = {}, wantedTitle = "") {
    const wanted = String(wantedTitle || "").trim();
    if (!wanted)
        return 0;
    const titles = [
        enriched.title,
        enriched.mal?.englishTitle,
        enriched.mal?.title,
        enriched.tmdb?.title,
    ].filter(Boolean);
    return titles.reduce((best, value) => Math.max(best, titleMatchQuality(value, wanted)), 0);
}
function mergeDualEnrichedMovieResults(base, malResult, tmdbResult, wantedTitle = "") {
    const wanted = String(wantedTitle || base.title || "").trim();
    const malQuality = malResult?.mal ? enrichedTitleMatchQuality(malResult, wanted) : 0;
    const tmdbQuality = tmdbResult?.tmdb ? enrichedTitleMatchQuality(tmdbResult, wanted) : 0;
    if (malQuality < 0.52 && tmdbQuality < 0.52)
        return base;
    const primary = malQuality >= tmdbQuality ? malResult : tmdbResult;
    const secondary = primary === malResult ? tmdbResult : malResult;
    return {
        ...base,
        ...primary,
        title: primary.title || base.title,
        year: primary.year || base.year || "",
        posterUrl: primary.posterUrl || secondary.posterUrl || base.posterUrl || "",
        genre: primary.genre || secondary.genre || base.genre || "",
        summary: primary.summary || secondary.summary || base.summary || "",
        mediaType: primary.mediaType || secondary.mediaType || base.mediaType || "",
        mal: malResult?.mal || undefined,
        tmdb: tmdbResult?.tmdb || undefined,
        dualMatch: {
            wantedTitle: wanted,
            malQuality,
            tmdbQuality,
            primaryProvider: malQuality >= tmdbQuality ? "mal" : "tmdb",
        },
    };
}
async function enrichServerMovieResultDual(result, wantedTitle = "") {
    const [malResult, tmdbResult] = await Promise.all([
        enrichServerMalResult({ ...result }),
        enrichServerTmdbResult({ ...result }),
    ]);
    return mergeDualEnrichedMovieResults(result, malResult, tmdbResult, wantedTitle);
}
async function enrichServerMovieResult(result) {
    const title = String(result.title || "").trim();
    if (!title)
        return result;
    if (result?.commentHint?.source)
        return enrichServerMovieResultDual(result, title);
    const shouldTryMalFirst = looksLikeAnimeOrManga(result);
    if (shouldTryMalFirst) {
        const malResult = await enrichServerMalResult(result);
        if (malResult?.mal)
            return malResult;
    }
    const tmdbResult = await enrichServerTmdbResult(result);
    if (tmdbResult?.tmdb)
        return tmdbResult;
    return enrichServerMalResult(result);
}
function movieIdVerificationEnabled() {
    return !["0", "false", "off"].includes(String(process.env.MOVIE_ID_DATABASE_VERIFICATION || "true").trim().toLowerCase());
}
function compactMovieIdVerificationContext(result = {}) {
    return {
        title: String(result.title || "").trim(),
        year: String(result.year || "").trim(),
        mediaType: String(result.mediaType || "").trim(),
        genre: String(result.genre || "").trim(),
        summary: transcriptExcerpt(result.summary || "", 1200),
        evidence: {
            audio: transcriptExcerpt(result.evidence?.audio || "", 1000),
            visual: transcriptExcerpt(result.evidence?.visual || "", 1000),
            reasoning: transcriptExcerpt(result.evidence?.reasoning || "", 1000),
        },
    };
}
async function verifyMovieIdCandidateSummary(result, candidate, context = {}) {
    const localTranscript = String(context.localTranscript || result.transcript?.fullText || "").trim();
    const response = await generateGeminiContent({
        model: "gemini-3-flash-preview",
        contents: [
            {
                parts: [
                    {
                        text: `Verify a Movie ID result against the attached database candidate summary before AutoYT trusts the title.

The initial model guess is not evidence by itself. Compare the clip transcript and initial visual/audio evidence with the MAL or TMDB title summary. A database candidate is verified only when the summary, exact scene clues, characters/abilities/setting, or search evidence support that this clip comes from that title. Recap narrators may rename characters, so reason from exact events and visuals rather than a renamed first name. If the candidate is wrong or only loosely similar, set verified false. When you can identify a more likely exact source title from the clip evidence and Google Search, provide correctedTitle and correctedYear so it can be checked against its own database summary.

Initial Movie ID result:
${JSON.stringify(compactMovieIdVerificationContext(result))}

Database candidate from ${candidate.provider.toUpperCase()}:
${JSON.stringify(candidate)}

Full faster-whisper transcript:
${localTranscript || "Not available"}

Return compact JSON only.`,
                    },
                ],
            },
        ],
        config: {
            responseMimeType: "application/json",
            maxOutputTokens: 1600,
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    verified: { type: Type.BOOLEAN },
                    confidence: { type: Type.NUMBER },
                    reason: { type: Type.STRING },
                    mismatch: { type: Type.STRING },
                    correctedTitle: { type: Type.STRING },
                    correctedYear: { type: Type.STRING },
                    correctedMediaType: { type: Type.STRING },
                },
                required: ["verified", "confidence", "reason"],
            },
            tools: [{ googleSearch: {} }],
        },
    });
    return parseModelJson(response.text, {});
}
function movieIdCandidateSeedKey(value = {}) {
    return [value.title, value.year, value.mediaType]
        .map((item) => String(item || "").trim().toLowerCase())
        .join(":");
}
async function enrichMovieIdDatabaseSummaryPool(result, context = {}) {
    const localTranscript = String(context.localTranscript || result.transcript?.fullText || "").trim();
    const candidateSeeds = [{ title: result.title, year: result.year, mediaType: result.mediaType }];
    if (localTranscript && dashScopeApiKey()) {
        const qwenCandidates = await generateQwenMovieCandidates(localTranscript, context);
        for (const candidate of qwenCandidates.candidates || []) {
            candidateSeeds.push({
                title: candidate?.title,
                year: candidate?.year,
                mediaType: candidate?.mediaType,
            });
        }
    }
    const enriched = [];
    const seen = new Set();
    for (const seed of candidateSeeds) {
        const title = String(seed?.title || "").trim();
        const key = movieIdCandidateSeedKey(seed);
        if (!title || seen.has(key))
            continue;
        seen.add(key);
        if (titleMatchQuality(title, result.title) >= 0.98) {
            enriched.push(result);
            continue;
        }
        enriched.push(await enrichServerMovieResult({
            ...result,
            title,
            year: String(seed?.year || "").match(/\d{4}/)?.[0] || "",
            mediaType: String(seed?.mediaType || "").trim(),
            confidence: Math.min(Number(result.confidence || 0), 0.92),
        }));
    }
    const summaries = databaseSummaryCandidates(enriched);
    return summaries.map((candidate) => ({
        candidate,
        result: enriched.find((item) => {
            const summary = databaseSummaryCandidate(item);
            return summary?.provider === candidate.provider && summary?.id === candidate.id;
        }),
    })).filter((item) => item.result);
}
async function verifyMovieIdSummaryPoolWithQwen(result, pool, context = {}) {
    if (!dashScopeApiKey() || !Array.isArray(pool) || pool.length < 2)
        return null;
    const localTranscript = String(context.localTranscript || result.transcript?.fullText || "").trim();
    if (!localTranscript)
        return null;
    const response = await generateDashScopeChat({
        model: qwenMovieTextModel(),
        messages: [
            {
                role: "system",
                content: "Return valid compact JSON only. Verify a source title only when the recap transcript and database summary match specific plot, ability, character, or setting clues.",
            },
            {
                role: "user",
                content: `Cross-check this recap clip before AutoYT trusts a Movie ID title.

The initial model guess may be wrong. Compare the transcript and evidence against each TMDB or MAL candidate summary. Recap narrators may rename characters, so prefer exact events, powers, goals, setting, and story progression. Select only one candidate when its summary is a materially better source match than the others. If no candidate is supported, return verified false.

Initial Movie ID result:
${JSON.stringify(compactMovieIdVerificationContext(result))}

Database candidates:
${JSON.stringify(pool.map((item, index) => ({ index, ...item.candidate })))}

Full faster-whisper transcript:
${localTranscript}

Return JSON only:
{"verified":true|false,"candidateIndex":0,"confidence":0.0,"reason":"","mismatch":""}`,
            },
        ],
        temperature: 0.05,
        max_tokens: 1200,
        response_format: { type: "json_object" },
    });
    const verdict = parseModelJsonLoose(response?.choices?.[0]?.message?.content || "", {});
    const selectedIndex = Number(verdict.candidateIndex ?? verdict.index);
    const selected = Number.isInteger(selectedIndex) ? pool[selectedIndex] : null;
    if (verdict.verified !== true || !selected?.result)
        return null;
    return verifiedMovieIdResult(selected.result, selected.candidate, {
        ...verdict,
        confidence: Math.min(Number(verdict.confidence || selected.result.confidence || 0), 0.95),
        reason: transcriptExcerpt(`Qwen database-summary backup: ${verdict.reason || "Transcript and candidate summary agree."}`, 800),
    });
}
async function recoverMovieIdFromDatabaseSummaryPool(result, context = {}) {
    try {
        const pool = await enrichMovieIdDatabaseSummaryPool(result, context);
        return await verifyMovieIdSummaryPoolWithQwen(result, pool, context);
    }
    catch (error) {
        console.warn("Movie ID database-summary candidate recovery skipped:", error instanceof Error ? error.message : error);
        return null;
    }
}
async function verifyEnrichedMovieIdResult(result, context = {}, allowCorrection = true) {
    if (!movieIdVerificationEnabled() || result.manualCorrection === true)
        return result;
    const candidate = databaseSummaryCandidate(result);
    if (!candidate) {
        return capUnverifiedMovieIdResult(result, "missing_database_summary");
    }
    try {
        const verdict = await verifyMovieIdCandidateSummary(result, candidate, context);
        if (verdict.verified === true) {
            return verifiedMovieIdResult(result, candidate, verdict);
        }
        const correctedTitle = String(verdict.correctedTitle || "").trim();
        if (allowCorrection && correctedTitle && titleMatchQuality(correctedTitle, result.title) < 0.85) {
            const corrected = await enrichServerMovieResult({
                ...result,
                title: correctedTitle,
                year: String(verdict.correctedYear || result.year || "").match(/\d{4}/)?.[0] || "",
                mediaType: String(verdict.correctedMediaType || result.mediaType || "").trim(),
                confidence: Math.min(Number(verdict.confidence || result.confidence || 0), 0.92),
            });
            return await verifyEnrichedMovieIdResult(corrected, context, false);
        }
        const recovered = await recoverMovieIdFromDatabaseSummaryPool(result, context);
        if (recovered)
            return recovered;
        return capUnverifiedMovieIdResult(result, "database_summary_mismatch", {
            provider: candidate.provider,
            databaseId: candidate.id,
            databaseTitle: candidate.title,
            reason: transcriptExcerpt(verdict.reason || verdict.mismatch || "", 800),
        });
    }
    catch (error) {
        console.warn("Movie ID database-summary verification skipped:", error instanceof Error ? error.message : error);
        const recovered = await recoverMovieIdFromDatabaseSummaryPool(result, context);
        if (recovered)
            return recovered;
        return capUnverifiedMovieIdResult(result, "database_summary_verification_failed", {
            provider: candidate.provider,
            databaseId: candidate.id,
            databaseTitle: candidate.title,
        });
    }
}
async function finalizeMovieIdResult(_fileBuffer, _mimeType, context = {}, result = {}) {
    const enriched = await enrichServerMovieResult(result);
    return await verifyEnrichedMovieIdResult(enriched, context);
}
async function getChannelStyleSamples(account) {
    if (isZernioManagedAccount(account)) {
        return [];
    }
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
async function generateAutomationMetadata({ movie, sourceVideo, agent, styleSamples, account }) {
    const settings = normalizeAutomationSettings(agent.settings || {});
    const isTikTokTarget = isTikTokPublishAccount(account);
    const sourceContext = movie || {
        title: sourceVideo.title || "TikTok clip",
        summary: sourceVideo.title || "",
        genre: settings.genreFocus || "",
    };
    const taxonomy = extractContentTaxonomy(sourceContext, {
        title: sourceVideo.title,
        genre: settings.genreFocus,
        microNiche: settings.microNicheGoal,
    });
    const compactSourceContext = compactAnalysisContextForPrompt(sourceContext, 3000);
    const transcriptText = String(sourceContext?.transcript?.fullText || sourceContext?.transcript?.excerpt || sourceContext?.summary || "").trim();
    const transcriptForMetadata = transcriptExcerpt(transcriptText, 6500);
    const contentMode = settings.movieIdEnabled ? "movie recap/clip" : "faceless niche clip";
    const prompt = isTikTokTarget
        ? `Create TikTok caption metadata for a scheduled ${contentMode} upload via Zernio.

Detected source context:
${JSON.stringify(compactSourceContext)}

Detected niche/taxonomy:
${JSON.stringify(taxonomy)}

Transcript/story context:
${transcriptForMetadata || "Not available"}

Source TikTok:
${JSON.stringify({ title: sourceVideo.title, author: sourceVideo.author, stats: sourceVideo.stats })}

Rules:
- Write for TikTok discovery: strong hook in the first line, hashtags at the end.
- Title is the on-video overlay text (max 150 chars). Description is the caption body (max 2200 chars total with hashtags).
- Avoid claiming ownership or spammy keyword stuffing.
- Return JSON with title, description, tags, microNiche, genre, hookPattern, contentFormat.
- Keep title under 150 characters, description under 2200 characters, tags under 15.`
        : `Create YouTube metadata for a scheduled ${contentMode} upload.

Detected source context:
${JSON.stringify(compactSourceContext)}

Detected niche/taxonomy:
${JSON.stringify(taxonomy)}

Transcript/story context:
${transcriptForMetadata || "Not available"}

Source TikTok:
${JSON.stringify({ title: sourceVideo.title, author: sourceVideo.author, stats: sourceVideo.stats })}

Channel's strongest recent title/description patterns:
${JSON.stringify(styleSamples)}

Micro-sub-niche goal:
${settings.microNicheGoal || "Find a focused repeatable niche corner with strong demand."}

Rules:
- Title must be specific to the actual transcript story beat. Never use generic phrases like "This movie twist will blow your mind", "You won't believe what happens next", or "watch till the end".
- For non-movie content, optimize around the detected faceless niche, hook pattern, commentary/visual format, audience, and monetization fit instead of forcing a movie/anime angle.
- Avoid claiming ownership or using spammy title stuffing.
- Description should include a concise hook, context, and discovery keywords.
- Return JSON with title, description, tags, microNiche, genre, hookPattern, contentFormat.
- Keep title under 95 characters, description under 4500 characters, tags under 15.`;
    let metadataProvider = "text-ai";
    let metadataProviderError = "";
    const data = await generateTextJson(prompt, async () => {
        const response = await generateGeminiContent({
            model: "gemini-3-flash-preview",
            contents: [{ role: "user", parts: [{ text: prompt }] }],
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
                        hookPattern: { type: Type.STRING },
                        contentFormat: { type: Type.STRING },
                    },
                    required: ["title", "description", "tags", "microNiche"],
                },
            },
        });
        return parseModelJson(response.text, {});
    }).catch((error) => {
        metadataProvider = "transcript-fallback";
        metadataProviderError = error instanceof Error ? error.message : String(error);
        console.warn("Automation metadata AI generation failed; using transcript/source fallback:", error instanceof Error ? error.message : error);
        const sourceTitle = String(sourceVideo.title || sourceContext.title || "Untitled clip").replace(/\s+/g, " ").trim();
        const summary = String(sourceContext.summary || sourceContext.transcript?.excerpt || sourceTitle).replace(/\s+/g, " ").trim();
        return {
            title: sourceTitle,
            description: summary,
            tags: [
                taxonomy.primary,
                taxonomy.subNiche,
                taxonomy.microSubNiche,
                settings.genreFocus,
                settings.microNicheGoal,
            ].map((tag) => String(tag || "").trim()).filter(Boolean),
            microNiche: taxonomy.microSubNiche || settings.microNicheGoal || "",
            genre: taxonomy.primary || sourceContext.genre || settings.genreFocus || "",
            hookPattern: taxonomy.hookPattern || "curiosity-recap",
            contentFormat: taxonomy.contentFormat || "short-form faceless clip",
        };
    });
    const repaired = repairAutomationMetadata(data, {
        isTikTokTarget,
        sourceTitle: sourceVideo.title || sourceContext.title || "",
        transcript: transcriptText,
        summary: sourceContext.summary || "",
        genre: data.genre || taxonomy.primary || sourceContext.genre || settings.genreFocus || "",
    });
    if (repaired.metadataRepaired && metadataProvider === "text-ai")
        metadataProvider = "text-ai-repaired";
    return {
        title: String(repaired.title || `${sourceContext.title} explained`).slice(0, isTikTokTarget ? 150 : 95),
        description: String(repaired.description || sourceContext.summary || "").slice(0, isTikTokTarget ? 2200 : 4500),
        tags: Array.isArray(repaired.tags) ? repaired.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 15) : [],
        microNiche: String(repaired.microNiche || taxonomy.microSubNiche || settings.microNicheGoal || "").slice(0, 180),
        genre: String(repaired.genre || taxonomy.primary || sourceContext.genre || settings.genreFocus || "").slice(0, 120),
        hookPattern: String(repaired.hookPattern || taxonomy.hookPattern || "").slice(0, 120),
        contentFormat: String(repaired.contentFormat || taxonomy.contentFormat || "").slice(0, 120),
        metadataProvider,
        metadataProviderError,
        metadataRepaired: Boolean(repaired.metadataRepaired),
    };
}
function movieKeyFromResult(movie) {
    const title = String(movie?.title || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const year = String(movie?.year || "").match(/\d{4}/)?.[0] || "";
    const tmdb = movie?.tmdb?.id ? `tmdb-${movie.tmdb.id}` : "";
    return tmdb || [title, year].filter(Boolean).join("-");
}
function officialGenresFromAutomationMovie(movie = {}) {
    return [
        ...(Array.isArray(movie?.tmdb?.genres) ? movie.tmdb.genres : []),
        ...(Array.isArray(movie?.mal?.genres) ? movie.mal.genres : []),
        movie?.genre,
    ]
        .map((genre) => String(genre || "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .filter((genre, index, values) => values.findIndex((item) => item.toLowerCase() === genre.toLowerCase()) === index)
        .slice(0, 12);
}
function safeVideoFileName(movie) {
    const title = String(movie?.title || "autoyt-clip").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80);
    const year = String(movie?.year || "").match(/\d{4}/)?.[0] || "";
    return `${title || "autoyt-clip"}${year ? `-${year}` : ""}.mp4`;
}
function tagListsIntersect(a = [], b = []) {
    const wanted = new Set(normalizeSavedSourceTags(a).map(savedSourceTagKey));
    if (!wanted.size)
        return false;
    return normalizeSavedSourceTags(b).some((tag) => wanted.has(savedSourceTagKey(tag)));
}
function savedRecordAllTags(record = {}) {
    return mergeSavedSourceTags(record.tags, record.autoTags, savedSourceAutoTags(record, record.genreScanState || {}));
}
async function taggedSavedRecordVideos(userId, record, sourceTags = []) {
    const videos = Array.isArray(record?.playlist?.videos) ? record.playlist.videos : [];
    if (!videos.length)
        return [];
    const state = await getSavedPlaylistGenreScanState(userId, record.key || record.analyzedUrl).catch(() => savedGenreScanState());
    const memberships = savedGenreScanState(state).memberships;
    const byKey = new Map();
    for (const membership of memberships) {
        byKey.set(String(membership.videoKey || membership.video?.id || membership.video?.playUrl || ""), membership);
    }
    const matchingVideos = videos.filter((video) => {
        const videoKey = String(video.id || video.playUrl || video.url || "");
        const membership = byKey.get(videoKey);
        return tagListsIntersect(sourceTags, savedVideoTagPool(video, membership));
    });
    if (matchingVideos.length)
        return matchingVideos;
    return tagListsIntersect(sourceTags, savedRecordAllTags(record)) ? videos : [];
}
async function loadAgentSourceVideos(agent) {
    const settings = normalizeAutomationSettings(agent.settings || {});
    const sourceListUrl = String(agent.sourceUrl || agent.sourceKey || "").trim();
    const sources = [];
    if (agent.sourceType === "saved_tags" && settings.sourceTags.length) {
        const records = await listSavedPlaylistRecords(agent.userId);
        for (const record of records) {
            const taggedVideos = await taggedSavedRecordVideos(agent.userId, record, settings.sourceTags);
            sources.push(...taggedVideos.map((video) => normalizeAutomationSourceVideo(video, record.analyzedUrl || record.key || sourceListUrl)));
        }
    }
    else if ((agent.sourceType === "saved_playlist" || agent.sourceType === "saved_channel") && agent.sourceKey) {
        const record = await getSavedPlaylistRecordByKey(agent.userId, agent.sourceKey);
        if (record?.playlist?.videos?.length) {
            const recordUrl = record.analyzedUrl || record.key || sourceListUrl;
            sources.push(...record.playlist.videos.map((video) => normalizeAutomationSourceVideo(video, recordUrl)));
        }
    }
    if (!sources.length && agent.sourceUrl) {
        const playlist = await runTikTokListScript(agent.sourceUrl, settings.searchDepth, "");
        sources.push(...(playlist.videos || []).map((video) => normalizeAutomationSourceVideo(video, agent.sourceUrl)));
    }
    if (settings.includeSideChannels) {
        for (const url of settings.sideChannels) {
            try {
                const playlist = await runTikTokListScript(url, Math.min(settings.searchDepth, 100), "");
                sources.push(...(playlist.videos || []).map((video) => normalizeAutomationSourceVideo(video, url)));
            }
            catch {
                /* side channels should not block the primary source */
            }
        }
    }
    const promotedSources = isDirectChannelSourceUrl(sourceListUrl)
        ? []
        : await getPromotedAgentSourceChannels(agent).catch(() => []);
    const existingSourceUrls = new Set([
        sourceListUrl,
        agent.sourceUrl,
        agent.sourceKey,
        ...(Array.isArray(settings.sideChannels) ? settings.sideChannels : []),
    ].map(normalizeSourceIdentity).filter(Boolean));
    for (const source of promotedSources) {
        const url = String(source.url || "").trim();
        if (!url || existingSourceUrls.has(normalizeSourceIdentity(url)))
            continue;
        try {
            const playlist = await runTikTokListScript(url, Math.min(Math.max(settings.searchDepth || 50, 50), 150), "");
            sources.push(...(playlist.videos || []).map((video) => normalizeAutomationSourceVideo(video, url)));
        }
        catch (error) {
            console.warn("Promoted automation source skipped:", url, error instanceof Error ? error.message : error);
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
        if (mode === "newest") {
            const created = automationTikTokCreatedAt(b) - automationTikTokCreatedAt(a);
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
    const url = normalizeMovieCacheUrl(automationVideoSourceUrl(video) || video.playUrl || video.sourceUrl || video.url || "");
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
    return automationSourceKeyForVideo(video, video?.sourceListUrl || "");
}
async function runAutomationSourceDownload(video, outputPath, options = {}) {
    const normalized = normalizeAutomationSourceVideo(video, video?.sourceListUrl || "");
    const sourceUrl = automationVideoSourceUrl(normalized);
    if (!sourceUrl)
        throw new Error("Source video URL is missing.");
    if (automationVideoPlatform(normalized) === "youtube") {
        const downloader = await runYtDlpSocialDownload(sourceUrl, outputPath);
        await assertVideoHasAudio(outputPath, "Downloaded YouTube video");
        return downloader;
    }
    return runTikTokDownloadWithAudioRetry({ ...normalized, playUrl: sourceUrl, sourceUrl }, outputPath, options);
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
async function recentAutomationFailureCount(agentId, windowMinutes = automationCatchUpWindowMinutes()) {
    if (!agentId)
        return 0;
    const out = await runPsql(`
SELECT COUNT(*)
FROM automation_runs
WHERE agent_id = ${sqlString(agentId)}
  AND status = 'error'
  AND started_at > now() - (${sqlString(`${windowMinutes} minutes`)})::interval;
`);
    return Number(out || 0);
}
async function getManualCatchUpPublishAt(agentId) {
    if (!agentId)
        return "";
    const out = await runPsql(`
SELECT COALESCE((
  SELECT details->'failure'->>'catchUpPublishAt'
  FROM automation_runs
  WHERE agent_id = ${sqlString(agentId)}
    AND status = 'error'
    AND started_at > now() - (${sqlString(`${automationCatchUpWindowMinutes()} minutes`)})::interval
  ORDER BY started_at DESC
  LIMIT 1
), '');
`);
    const value = String(out || "").trim();
    const parsed = new Date(value);
    if (!value || Number.isNaN(parsed.getTime()))
        return "";
    if (parsed.getTime() < Date.now() - automationCatchUpWindowMinutes() * 60_000)
        return "";
    return value;
}
async function advanceAutomationAgentAfterFailure(agent, settings, error, context = {}) {
    if (!agent?.id)
        return;
    const normalized = normalizeAutomationSettings(settings || {});
    const failedAt = new Date();
    const plannedPublishAt = new Date(context.plannedPublishAt || 0);
    const failureCount = await recentAutomationFailureCount(agent.id).catch(() => 0);
    const canRetry = normalized.publishMode === "schedule"
        && failureCount < automationMaxCatchUpRetries()
        && !Number.isNaN(plannedPublishAt.getTime())
        && plannedPublishAt.getTime() > failedAt.getTime() - automationCatchUpWindowMinutes() * 60_000;
    const catchUpPublishAt = canRetry
        ? new Date(Math.max(plannedPublishAt.getTime(), failedAt.getTime() + automationCatchUpLeadMinutes() * 60_000))
        : null;
    const nextRunAt = canRetry
        ? new Date(failedAt.getTime() + automationRetryDelayMinutes() * 60_000)
        : await nextAutomationRunAt(normalized, failedAt, agent);
    await runPsql(`
UPDATE automation_agents
SET last_run_at = now(),
    next_run_at = ${sqlString(nextRunAt.toISOString())}::timestamptz,
    updated_at = now()
WHERE id = ${sqlString(agent.id)};
`);
    return {
        nextRunAt,
        retryScheduled: canRetry,
        retryAttempt: failureCount + 1,
        catchUpPublishAt,
        plannedPublishAt: Number.isNaN(plannedPublishAt.getTime()) ? null : plannedPublishAt,
        error: error instanceof Error ? error.message : String(error || "Automation run failed"),
    };
}
function isSkippableAutomationDownloadError(error) {
    const message = error instanceof Error ? error.message : String(error || "");
    return /No clean \d+p TikTok source|expected at least \d+p|No direct clean playback URL candidates|TikWM returned \d+x\d+|yt-dlp returned \d+x\d+|no confirmed audio track|Audio probe|yt-dlp could not download|YouTube blocked this server download/i.test(message);
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
        let uploadFile = "";
        let selectedSourceClaim = "";
        let pendingUploadId = "";
        let plannedScheduleAt = null;
        let sourceDownloader = "";
        let sourceDownloadDimensions = null;
        let sourceDownloadDurationSeconds = 0;
        let sourceDownloadFileSize = 0;
        try {
            const account = await usableYouTubeAccount(userId, agent.youtubeAccountId);
            plannedScheduleAt = await resolveAutomationScheduleAt(settings, account, new Date(options.from || Date.now()), {
                catchUpPublishAt: options.catchUpPublishAt,
            });
            if (options.retryFailedUpload !== false) {
                const failedUpload = await getLatestFailedAutomationUploadForAgent(userId, agent.id).catch(() => null);
                if (failedUpload) {
                    const recovered = await retryFailedAutomationUpload(userId, failedUpload, {
                        from: options.from,
                        catchUpPublishAt: plannedScheduleAt,
                    });
                    await finishAutomationRun(runId, "success", `Recovered failed upload ${failedUpload.title || failedUpload.movieTitle || recovered.youtubeVideoId}`, recovered);
                    return recovered;
                }
            }
            const styleSamples = await getChannelStyleSamples(account);
        const learningProfile = await getAgentLearningProfile(agent.id).catch(() => null);
        const videos = rankAutomationCandidates(await loadAgentSourceVideos(agent), learningProfile, settings.sourcePriority);
        if (!videos.length)
            throw new Error("No source videos found for this agent.");
        let selected = null;
        let movie = null;
        let movieKey = "";
        let sourceIdentity = null;
        let analysisAttempts = 0;
        const downloadSkips = [];
        const analysisSkips = [];
        const analysisFallbacks = [];
        for (const video of videos) {
            if (await sourceAlreadyUploaded(agent.id, video))
                continue;
            if (analysisAttempts + downloadSkips.length + analysisSkips.length >= Math.max(12, Math.min(settings.searchDepth || 50, 80)))
                break;
            const sourceClaim = await claimAutomationSource(agent.id, video, runId);
            if (!sourceClaim)
                continue;
            tempFile = makeTikTokVideoCachePath();
            try {
                sourceDownloader = await runAutomationSourceDownload(video, tempFile);
                sourceDownloadDimensions = await probeVideoDimensions(tempFile);
                sourceDownloadDurationSeconds = await probeVideoDuration(tempFile);
                sourceDownloadFileSize = fs.existsSync(tempFile) ? fs.statSync(tempFile).size : 0;
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
            try {
                if (settings.movieIdEnabled) {
                    const sourcePlatform = automationVideoPlatform(video);
                    movie = await identifyMovieFromVideoFile(tempFile, "video/mp4", {
                        sourceType: sourcePlatform === "youtube" ? "youtube" : "tiktok",
                        tiktokVideoId: sourcePlatform === "tiktok" ? video.id || "" : "",
                        youtubeVideoId: sourcePlatform === "youtube" ? video.id || "" : "",
                        normalizedUrl: automationVideoSourceUrl(video),
                    });
                    movieKey = movieKeyFromResult(movie);
                }
                else {
                    sourceIdentity = await analyzeFacelessContentFromVideoFile(tempFile, "video/mp4", {
                        sourceTitle: video.title || "",
                        sourceAuthor: video.authorHandle || video.author || "",
                        sourceStats: video.stats || {},
                        sourceDurationSeconds: video.durationSeconds || video.duration || 0,
                        genreFocus: settings.genreFocus || "",
                        microNicheGoal: settings.microNicheGoal || "",
                        channelTitle: account.channelTitle || account.title || "",
                    }).catch((error) => buildTranscriptBackedAutomationFallback(tempFile, video, settings, error));
                    movie = sourceIdentity;
                    movieKey = `source-${String(video.id || crypto.createHash("sha1").update(String(video.playUrl || video.title || Date.now())).digest("hex")).slice(0, 48)}`;
                }
            }
            catch (error) {
                movie = await buildTranscriptBackedAutomationFallback(tempFile, video, settings, error);
                sourceIdentity = movie;
                movieKey = sourceClaim
                    || automationSourceKeyForVideo(video, agent.sourceUrl)
                    || `source-${crypto.createHash("sha1").update(String(video.playUrl || video.title || Date.now())).digest("hex").slice(0, 48)}`;
                analysisFallbacks.push({
                    id: video.id || "",
                    url: video.playUrl || "",
                    views: automationTikTokViewCount(video),
                    reason: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
                });
            }
            if (settings.movieIdEnabled && movie?.movieIdStatus !== "failed" && settings.avoidMovieRepeats && (await movieAlreadyUploaded(agent.youtubeAccountId, movieKey))) {
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
            throw new Error(downloadSkips.length || analysisSkips.length ? `No fresh publishable candidate found. Skipped ${downloadSkips.length} videos for quality or missing audio and ${analysisSkips.length} videos for analysis errors.` : "No fresh candidate passed duplicate checks.");
        const metadata = await generateAutomationMetadata({ movie, sourceVideo: selected, agent, styleSamples, account });
        const tiktokPublish = isTikTokPublishAccount(account);
        const targetPlaylistId = tiktokPublish ? "" : await resolveAutomationTargetPlaylist(account, settings, metadata, movie).catch((error) => {
            console.warn("Could not resolve automation target playlist:", error instanceof Error ? error.message : error);
            return "";
        });
        const scheduleAt = await resolveAutomationScheduleAt(settings, account, new Date(options.from || Date.now()), {
            catchUpPublishAt: plannedScheduleAt,
        });
        const nextSlot = settings.publishMode === "schedule" && scheduleAt
            ? await nextAvailableFutureAutomationSlot(settings, account, new Date(scheduleAt.getTime() + 60_000), new Date(), agent)
            : null;
        let nextRunAt = nextSlot
            ? nextSlot.runAt
            : await nextAutomationRunAt(settings, new Date(), agent);
        nextRunAt = await performanceAwareNextRunAt(agent, settings, account, nextRunAt).catch(() => nextRunAt);
        const uploadId = `upl_${crypto.randomUUID()}`;
        pendingUploadId = uploadId;
        const movieGenres = officialGenresFromAutomationMovie(movie);
        const pendingMetrics = {
            movieIdEnabled: settings.movieIdEnabled,
            movieIdStatus: movie?.movieIdStatus || (settings.movieIdEnabled ? "identified" : "disabled"),
            movieIdError: movie?.movieIdError || "",
            movie,
            movieGenres,
            movieGenreSource: movie?.mal?.genres?.length ? "mal" : movie?.tmdb?.genres?.length ? "tmdb" : movieGenres.length ? "movie_id" : "",
            sourceIdentity,
            sourceStats: selected.stats || {},
            sourceTitle: selected.title || "",
            sourceThumbnailUrl: tiktokCoverSourceUrl(selected) || selected.dynamicCover || selected.thumbnailUrl || "",
            sourceDurationSeconds: selected.durationSeconds || selected.duration || 0,
            sourceCreatedAt: selected.createdAt || selected.createTime || "",
            sourceDownloader,
            sourceDownloadDimensions,
            sourceDownloadDurationSeconds,
            sourceDownloadFileSize,
            learningScore: candidateLearningScore(selected, learningProfile || {}),
            learningProfile: learningProfile ? {
                summary: learningProfile.summary,
                recommendation: learningProfile.recommendation,
                confidence: learningProfile.confidence,
            } : null,
            sourceKey: selectedSourceClaim,
            fileName: safeVideoFileName(movie),
            targetPlaylistId,
            uploadState: "uploading",
            metadataProvider: metadata.metadataProvider || "",
            metadataProviderError: metadata.metadataProviderError || "",
            metadataRepaired: metadata.metadataRepaired === true,
        };
        pendingMetrics.taxonomy = extractContentTaxonomy(movie, {
            title: metadata.title,
            genre: metadata.genre || movie.genre || settings.genreFocus,
            microNiche: metadata.microNiche,
            hookPattern: metadata.hookPattern,
            contentFormat: metadata.contentFormat,
        });
        await runPsql(`
INSERT INTO automation_uploads (
  id, agent_id, user_id, youtube_account_id, youtube_video_id, youtube_url, source_url, source_video_id, source_author,
  movie_key, movie_title, movie_year, genre, micro_niche, title, description, schedule_at, status, metrics, created_at, updated_at
)
VALUES (
  ${sqlString(uploadId)}, ${sqlString(agent.id)}, ${sqlString(userId)}, ${sqlString(agent.youtubeAccountId)},
  '', '', ${sqlString(automationVideoSourceUrl(selected))}, ${sqlString(selected.id)}, ${sqlString(selected.authorHandle || selected.author || "")},
  ${sqlString(movieKey)}, ${sqlString(settings.movieIdEnabled && movie?.movieIdStatus !== "failed" ? movie.title || "" : "")}, ${sqlString(settings.movieIdEnabled && movie?.movieIdStatus !== "failed" ? movie.year || "" : "")}, ${sqlString(metadata.genre || movieGenres[0] || movie.genre || "")},
  ${sqlString(metadata.microNiche)}, ${sqlString(metadata.title)}, ${sqlString(metadata.description)}, ${scheduleAt ? `${sqlString(scheduleAt.toISOString())}::timestamptz` : "NULL"},
  'uploading', ${jsonbLiteral(pendingMetrics)}, now(), now()
);
`);
        const preparedUpload = await prepareShortsUploadFile(tempFile, tiktokPublish ? { ...settings, postAsShort: false } : settings, { label: "automation_candidate" });
        uploadFile = preparedUpload.filePath;
        pendingMetrics.shortsTrim = preparedUpload.metrics;
        pendingMetrics.uploadDimensions = await probeVideoDimensions(uploadFile);
        pendingMetrics.uploadDurationSeconds = await probeVideoDuration(uploadFile);
        pendingMetrics.uploadFileSize = fs.existsSync(uploadFile) ? fs.statSync(uploadFile).size : 0;
        const upload = await uploadYouTubeVideoFromFile(account, {
            title: metadata.title,
            description: metadata.description,
            tags: metadata.tags,
            privacyStatus: automationPublishPrivacyStatus(settings),
            publishAt: scheduleAt ? scheduleAt.toISOString() : "",
            timezone: settings.timezone,
            categoryId: settings.categoryId,
            madeForKids: settings.madeForKids,
        }, uploadFile, "video/mp4");
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
    metrics = ${jsonbLiteral({ ...pendingMetrics, uploadState: "complete", uploadVia: upload.provider || (String(upload.url || "").includes("zernio.com") ? "zernio" : "youtube"), zernioPostId: upload.zernioPostId || (String(upload.url || "").match(/zernio\.com\/posts\/([a-f0-9]{24})/i)?.[1] || "") })},
    updated_at = now()
WHERE id = ${sqlString(uploadId)};
UPDATE automation_agents
SET last_run_at = now(), next_run_at = ${sqlString(nextRunAt.toISOString())}::timestamptz, updated_at = now()
WHERE id = ${sqlString(agent.id)};
`);
        await captureAutomationPerformance(uploadId, account, upload.id).catch(() => null);
        await recordAutomationLearningSignal(uploadId).catch((error) => console.warn("Initial automation learning signal failed:", error instanceof Error ? error.message : error));
        await finishAutomationRun(runId, "success", `${scheduleAt ? "Scheduled" : "Uploaded"} ${metadata.title}`, { uploadId, youtubeVideoId: upload.id, movieTitle: settings.movieIdEnabled && movie?.movieIdStatus !== "failed" ? movie.title : "", movieIdStatus: pendingMetrics.movieIdStatus, sourceUrl: selected.playUrl, scheduleAt, nextRunAt, targetPlaylistId, skippedLowQuality: downloadSkips, skippedAnalysis: analysisSkips, analysisFallbacks, learning: pendingMetrics.learningProfile, learningScore: pendingMetrics.learningScore, taxonomy: pendingMetrics.taxonomy });
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
        const failure = await advanceAutomationAgentAfterFailure(agent, settings, error, { plannedPublishAt: plannedScheduleAt }).catch(() => null);
        await finishAutomationRun(runId, "error", error instanceof Error ? error.message : "Automation run failed", failure ? { failure } : {});
        throw error;
    }
    finally {
        if (typeof uploadFile !== "undefined" && uploadFile && uploadFile !== tempFile) {
            try {
                fs.unlinkSync(uploadFile);
            }
            catch {
                /* cache cleanup will catch it */
            }
        }
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
    let userId = String(account?.userId || "");
    let uploadRecord = null;
    if (!userId && uploadId) {
        const userOut = await runPsql(`SELECT COALESCE((SELECT user_id FROM automation_uploads WHERE id = ${sqlString(uploadId)} LIMIT 1), '');`);
        userId = String(userOut || "").trim();
    }
    if (uploadId) {
        const uploadOut = await runPsql(`
SELECT COALESCE((SELECT json_build_object(
  'id', id,
  'youtubeVideoId', youtube_video_id,
  'youtubeUrl', youtube_url,
  'metrics', metrics,
  'scheduleAt', CASE WHEN schedule_at IS NULL THEN NULL ELSE schedule_at END
) FROM automation_uploads WHERE id = ${sqlString(uploadId)} LIMIT 1), 'null'::json);
`);
        uploadRecord = JSON.parse(uploadOut || "null");
    }
    if (uploadRecord && isZernioUploadReference(videoId, uploadRecord.youtubeUrl)) {
        const postId = String(uploadRecord.metrics?.zernioPostId || videoId || "").match(/[a-f0-9]{24}/i)?.[0] || "";
        const post = postId ? await fetchZernioPostRaw(account, postId).catch((error) => ({
            status: "",
            _autoytFetchError: error instanceof Error ? error.message : String(error || "Zernio post unavailable"),
        })) : null;
        const tiktokPublish = isTikTokPublishAccount(account);
        const published = post
            ? (tiktokPublish ? zernioPublishedTikTokResult(post, account) : zernioPublishedYouTubeResult(post, account))
            : null;
        await runPsql(`
UPDATE automation_uploads
SET metrics = metrics || ${jsonbLiteral({
            uploadVia: "zernio",
            zernioPostId: postId,
            zernioPostStatus: String(post?.status || ""),
            zernioPostError: String(post?._autoytFetchError || ""),
            zernioPlatformStatus: String(published?.status || ""),
            zernioLastCheckedAt: new Date().toISOString(),
            ...(tiktokPublish && published?.tiktokId ? { tiktokVideoId: published.tiktokId, tiktokUrl: published.tiktokUrl } : {}),
        })},
    ${!tiktokPublish && published?.youtubeId ? `youtube_video_id = ${sqlString(published.youtubeId)}, youtube_url = ${sqlString(published.youtubeUrl)},` : ""}
    updated_at = now()
WHERE id = ${sqlString(uploadId)};
`);
        if (tiktokPublish) {
            // TikTok stats come from getTikTokVideoAnalytics; the upload id is the
            // most reliable lookup ref (it resolves metrics, zernio post, and the
            // published TikTok video id we just stored).
            videoId = uploadId || postId || videoId;
        }
        else {
            if (!published?.youtubeId)
                return;
            videoId = published.youtubeId;
        }
    }
    const analytics = userId
        ? await getYouTubeVideoAnalytics(userId, account, videoId, 1)
        : { publicStats: { viewCount: 0, likeCount: 0, commentCount: 0 }, analytics: { days: 1, startDate: "", endDate: "", totals: null, daily: [] } };
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
    await recordAutomationLearningSignal(uploadId).catch((error) => {
        console.warn("Automation learning signal capture failed:", error instanceof Error ? error.message : error);
    });
    if (!isTikTokPublishAccount(account)) {
        await autoManageYouTubeComments(uploadId, account, videoId).catch((error) => {
            console.warn("Automation comment management failed:", error instanceof Error ? error.message : error);
        });
    }
}
function asksForMovieName(text) {
    return policyAsksForMovieName(text);
}
function shouldSkipCommunityComment(text) {
    return classifyCommentReply(text).action === "skip";
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
    const prompt = `Write one YouTube creator reply that gives a useful or insightful response without asking a question.

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
- One sentence is preferred.`;
    const data = await generateTextJson(prompt, async () => {
        const response = await generateGeminiContent({
            model: "gemini-3-flash-preview",
            contents: [{ role: "user", parts: [{ text: prompt }] }],
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
        return parseModelJson(response.text, {});
    });
    const reply = sanitizeGeneratedReply(data.reply);
    if (replyLooksLikeQuestion(reply))
        return { shouldReply: false, reply: "", reason: "Question-style reply skipped" };
    return { shouldReply: data.shouldReply === true && reply.length > 0, reply, reason: String(data.reason || "") };
}
async function generateChannelCommentReply({ commentText, video, movie, tone, instructions }) {
    const prompt = `Write one short YouTube creator reply for channel community management without asking a question.

Video:
${JSON.stringify({ title: video.title, views: video.viewCount, comments: video.commentCount, publishedAt: video.publishedAt })}

Source title context:
${JSON.stringify(movie?.title ? { title: movie.title, year: movie.year, genre: movie.genre, confidence: movie.confidence } : { title: "", note: "Movie ID context unavailable or not confident." })}

Viewer comment:
${commentText}

Tone:
${tone || "warm-curious"}

Channel instructions:
${instructions || "Reply like the channel owner. Keep it human, short, warm, and slightly playful when that fits. A tiny Gen Z touch is fine when it sounds natural. Do not ask questions."}

Rules:
- Return JSON only.
- If the comment is spam, abusive, asks for illegal uploads, has no clear context, is only emojis, is only one letter, is a rhetorical reaction, is a throwaway joke, or does not need a reply, set shouldReply false.
- Do not mention that you are AI.
- Use the source title context only when it directly helps the reply.
- For praise or reactions, sound like a creator acknowledging a viewer, not a plot explainer.
- Do not turn a rhetorical comment into lore or movie analysis.
- Do not invent facts about the video, movie, or viewer.
- Do not ask people to like/subscribe.
- Do not ask questions or end with a question mark.
- Replies must be statements. They can be brief agreements, playful reactions, useful context, or a short creator opinion.
- Prefer a confident creator voice over generic support-agent wording.
- Do not use long dash punctuation.
- Keep reply under 96 characters.
- One sentence is preferred.`;
    const data = await generateTextJson(prompt, async () => {
        const response = await generateGeminiContent({
            model: "gemini-3-flash-preview",
            contents: [{ role: "user", parts: [{ text: prompt }] }],
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
        return parseModelJson(response.text, {});
    });
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
        const comments = await getYouTubeVideoComments(userId, account, video.id, maxCommentsPerVideo, "");
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
            const commentDecision = classifyCommentReply(commentText);
            const asksMovie = commentDecision.action === "name_request";
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
                if (sourceTitleSafeForPublicReply(movie)) {
                    const replyText = sanitizeGeneratedReply(contentNameReply(movie));
                    let replyId = "";
                    if (!dryRun) {
                        const reply = await replyToYouTubeComment(account, commentId, replyText, video.id);
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
                skipped.push({ videoId: video.id, commentId, reason: movie?.error ? `Movie ID failed: ${movie.error}` : "Movie name not safe enough for public reply" });
                continue;
            }
            if (asksMovie && !identifyMovies) {
                skipped.push({ videoId: video.id, commentId, reason: "Movie ID disabled for source-name question" });
                continue;
            }
            if (commentDecision.action === "skip") {
                skipped.push({ videoId: video.id, commentId, reason: commentDecision.reason || "Low-value or unsafe comment" });
                continue;
            }
            if (commentDecision.action === "quick_reply" && commentDecision.reply) {
                const replyText = sanitizeGeneratedReply(commentDecision.reply);
                let replyId = "";
                if (!dryRun) {
                    const reply = await replyToYouTubeComment(account, commentId, replyText, video.id);
                    replyId = String(reply.id || "");
                    await runPsql(`
INSERT INTO channel_comment_replies (id, user_id, youtube_account_id, video_id, video_title, comment_id, reply_id, reply_text, reply_type, created_at)
VALUES (
  ${sqlString(`ccr_${crypto.randomUUID()}`)}, ${sqlString(userId)}, ${sqlString(account.id)}, ${sqlString(video.id)}, ${sqlString(video.title)},
  ${sqlString(commentId)}, ${sqlString(replyId)}, ${sqlString(replyText)}, 'quick_reply', now()
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
                    replyText,
                    replyType: "quick_reply",
                    movie: null,
                });
                replyCount += 1;
                continue;
            }
            const movie = await movieContextForVideo(video);
            const publicMovie = sourceTitleSafeForPublicReply(movie) ? movie : null;
            const generated = await generateChannelCommentReply({ commentText, video, movie: publicMovie, tone, instructions }).catch((error) => {
                console.warn("Channel comment reply generation skipped:", error instanceof Error ? error.message : error);
                return { shouldReply: false, reply: "", reason: "AI skipped" };
            });
            if (!generated.shouldReply) {
                skipped.push({ videoId: video.id, commentId, reason: generated.reason || "No reply needed" });
                continue;
            }
            let replyId = "";
            if (!dryRun) {
                const reply = await replyToYouTubeComment(account, commentId, generated.reply, video.id);
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
                replyType: publicMovie?.title ? "ai_engagement_movie_context" : "ai_engagement",
                movie: publicMovie?.title ? publicMovie : null,
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
    'userId', u.user_id,
    'title', u.title,
    'movieTitle', u.movie_title,
    'movieYear', u.movie_year,
    'genre', u.genre,
    'microNiche', u.micro_niche,
    'movie', u.metrics->'movie',
    'settings', a.settings
  )
  FROM automation_uploads u
  JOIN automation_agents a ON a.id = u.agent_id
  WHERE u.id = ${sqlString(uploadId)}
  LIMIT 1
), 'null'::json);
`);
    const upload = JSON.parse(uploadOut || "null");
    const uploadMovie = preferEnglishAnimeResultTitle(upload?.movie || {});
    const publicMovie = sourceTitleSafeForPublicReply(uploadMovie)
        ? uploadMovie
        : null;
    const movieTitle = String(publicMovie?.title || "").trim();
    const settings = normalizeAutomationSettings(upload?.settings || {});
    if (!movieTitle && !settings.communityManagementEnabled)
        return;
    const comments = await getYouTubeVideoComments(String(upload?.userId || ""), account, videoId, 30, "");
    let verifiedMoviePromise = null;
    const verifiedMovieForPublicNameReply = async () => {
        if (!movieTitle)
            return null;
        if (!verifiedMoviePromise) {
            verifiedMoviePromise = identifyMovieFromYouTubeVideo(videoId)
                .then((verification) => {
                const verifiedMovie = preferEnglishAnimeResultTitle(verification?.result || verification || {});
                return sourceTitleVerifiedForPublicReply(uploadMovie, verifiedMovie) ? verifiedMovie : null;
            })
                .catch((error) => {
                console.warn("Automation title reply verification skipped:", error instanceof Error ? error.message : error);
                return null;
            });
        }
        return await verifiedMoviePromise;
    };
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
        if (threadHasOwnerReply(thread, account))
            continue;
        const commentText = `${comment.textOriginal || ""} ${comment.textDisplay || ""}`.trim();
        const commentDecision = classifyCommentReply(commentText);
        const asksMovie = movieTitle && commentDecision.action === "name_request";
        let replyText = "";
        let replyType = "";
        if (asksMovie) {
            const verifiedMovie = await verifiedMovieForPublicNameReply();
            if (!verifiedMovie?.title)
                continue;
            replyText = sanitizeGeneratedReply(contentNameReply({
                title: verifiedMovie.title,
                year: verifiedMovie.year || publicMovie?.year || upload?.movieYear || "",
                mediaType: verifiedMovie.mediaType || publicMovie?.mediaType || "",
                genre: verifiedMovie.genre || publicMovie?.genre || upload?.genre || "",
                microNiche: upload?.microNiche || "",
            }));
            replyType = "movie_name";
        }
        else if (commentDecision.action === "quick_reply" && commentDecision.reply) {
            replyText = sanitizeGeneratedReply(commentDecision.reply);
            replyType = "quick_reply";
        }
        else if (settings.communityManagementEnabled && settings.aiEngagementRepliesEnabled && aiReplies < maxAiReplies && commentDecision.action === "ai_context") {
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
        const reply = await replyToYouTubeComment(account, commentId, replyText, videoId);
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
SELECT COALESCE(json_agg(json_build_object(
  'id', id,
  'userId', user_id,
  'settings', settings,
  'nextRunAt', next_run_at,
  'lastRunAt', last_run_at,
  'catchUpPublishAt', catch_up_publish_at
)), '[]'::json)
FROM (
  SELECT
    a.id,
    a.user_id,
    a.settings,
    a.next_run_at,
    CASE WHEN a.last_run_at IS NULL THEN NULL ELSE FLOOR(EXTRACT(EPOCH FROM a.last_run_at) * 1000)::bigint END AS last_run_at,
    latest.details->'failure'->>'catchUpPublishAt' AS catch_up_publish_at
  FROM automation_agents a
  LEFT JOIN LATERAL (
    SELECT details
    FROM automation_runs
    WHERE agent_id = a.id
    ORDER BY started_at DESC
    LIMIT 1
  ) latest ON true
  WHERE a.status = 'active'
    AND (
      a.next_run_at IS NULL
      OR a.next_run_at <= now()
      OR (
        a.last_run_at IS NULL
        AND a.created_at >= date_trunc('day', now() AT TIME ZONE 'Africa/Nairobi') AT TIME ZONE 'Africa/Nairobi'
      )
    )
  ORDER BY COALESCE(a.next_run_at, a.created_at) ASC
  LIMIT 30
) due_agents;
`);
    const due = JSON.parse(out || "[]");
    for (const item of selectRunnableDueAgents(due, activeAutomationRuns, 3)) {
        activeAutomationRuns.add(item.id);
        const catchUpPublishAt = automationCatchUpPublishAtForDueAgent(item);
        runAutomationAgentOnce(item.userId, item.id, { catchUpPublishAt })
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
    AND NOT (u.youtube_url ILIKE 'https://zernio.com/posts%' AND COALESCE(u.schedule_at, u.created_at) > now() - interval '10 minutes')
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
async function fetchYouTubeDiscoveryJson(account, pathName, params = {}) {
    if (youtubeApiKey())
        return fetchYouTubeJson(pathName, params);
    if (!account?.accessToken)
        throw new Error("YouTube API key or connected YouTube OAuth token is required.");
    const url = new URL(`https://www.googleapis.com/youtube/v3/${pathName.replace(/^\/+/, "")}`);
    Object.entries(params).forEach(([paramKey, value]) => {
        if (value !== undefined && value !== null && value !== "") {
            url.searchParams.set(paramKey, String(value));
        }
    });
    return fetchJsonWithAuth(url, account.accessToken);
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
async function getConnectedTikTokDashboard(account, options = {}) {
    let followerCount = 0;
    let videoCount = 0;
    let displayName = account.channelTitle || "TikTok Creator";
    let profilePicture = account.thumbnailUrl || "";

    if (account.zernioApiKey && account.zernioAccountId) {
        try {
            const response = await fetch("https://zernio.com/api/v1/accounts", {
                headers: { "Authorization": `Bearer ${account.zernioApiKey}` }
            });
            if (response.ok) {
                const data = await response.json();
                const zAcc = (data.accounts || []).find((a) => String(a._id) === String(account.zernioAccountId));
                if (zAcc) {
                    followerCount = Number(zAcc.followerCount || zAcc.followersCount || zAcc.followers || zAcc.stats?.followers || zAcc.metrics?.followers || 0);
                    videoCount = Number(zAcc.videoCount || zAcc.videosCount || zAcc.postsCount || zAcc.stats?.videos || zAcc.metrics?.videos || 0);
                    if (zAcc.displayName || zAcc.name || zAcc.username) displayName = zAcc.displayName || zAcc.name || zAcc.username;
                    if (zAcc.profilePicture || zAcc.avatar || zAcc.avatarUrl || zAcc.profileImage) profilePicture = zAcc.profilePicture || zAcc.avatar || zAcc.avatarUrl || zAcc.profileImage;
                }
            }
        } catch (e) {
            console.warn("Could not fetch TikTok stats from Zernio:", e);
        }
    }

    const pageSize = Math.min(Math.max(Number(options.pageSize) || 24, 1), 50);
    let recentVideos = [];
    const zernioPosts = await listZernioPostsForAccount(account, { limit: pageSize });
    const analyticsPosts = await listZernioAnalyticsPostsForAccount(account, { limit: pageSize });
    const analyticsByKey = new Map();
    for (const raw of analyticsPosts) {
        const row = normalizeZernioPostRow(raw, account);
        if (!row)
            continue;
        analyticsByKey.set(dashboardKeyFromTikTokVideo(row), row);
    }
    const publicVideos = await listTikTokPublicProfileVideosForAccount(account, pageSize);
    const zernioByKey = new Map();
    for (const post of zernioPosts)
        zernioByKey.set(dashboardKeyFromTikTokVideo(post), post);
    const seenKeys = new Set();
    const seenTitles = new Set();
    const addRecentVideo = (video) => {
        const key = dashboardKeyFromTikTokVideo(video);
        const titleKey = dashboardTitleKey(video.title || video.description || "");
        if ((key && seenKeys.has(key)) || (titleKey && seenTitles.has(titleKey)))
            return;
        if (key)
            seenKeys.add(key);
        if (titleKey)
            seenTitles.add(titleKey);
        recentVideos.push(video);
    };
    for (const publicVideo of publicVideos) {
        const key = dashboardKeyFromTikTokVideo(publicVideo);
        const zernioPost = zernioByKey.get(key) || {};
        const analyticsPost = analyticsByKey.get(key) || {};
        addRecentVideo({
            id: publicVideo.id || zernioPost.zernioPostId || key,
            url: publicVideo.playUrl || zernioPost.url,
            title: publicVideo.title || zernioPost.title,
            description: zernioPost.description || publicVideo.title || "",
            thumbnailUrl: publicVideo.dynamicCover || publicVideo.thumbnailUrl || zernioPost.thumbnailUrl || profilePicture,
            publishedAt: publicVideo.createdAt ? new Date(Number(publicVideo.createdAt)).toISOString() : zernioPost.publishedAt,
            viewCount: Number(publicVideo.stats?.playCount || analyticsPost.viewCount || zernioPost.viewCount || 0),
            likeCount: Number(publicVideo.stats?.diggCount || analyticsPost.likeCount || zernioPost.likeCount || 0),
            commentCount: Number(publicVideo.stats?.commentCount || analyticsPost.commentCount || zernioPost.commentCount || 0),
            durationSeconds: Number(publicVideo.durationSeconds || zernioPost.durationSeconds || 60),
            privacyStatus: zernioPost.privacyStatus || "public",
        });
    }
    for (const post of zernioPosts) {
        const analyticsPost = analyticsByKey.get(dashboardKeyFromTikTokVideo(post)) || {};
        addRecentVideo({
            id: post.tiktokVideoId || post.zernioPostId,
            url: post.url,
            title: post.title,
            description: post.description,
            thumbnailUrl: post.thumbnailUrl || profilePicture,
            publishedAt: post.publishedAt,
            viewCount: Number(analyticsPost.viewCount || post.viewCount || 0),
            likeCount: Number(analyticsPost.likeCount || post.likeCount || 0),
            commentCount: Number(analyticsPost.commentCount || post.commentCount || 0),
            durationSeconds: post.durationSeconds || 60,
            privacyStatus: post.privacyStatus,
        });
    }
    try {
        const out = await runPsql(`
        SELECT COALESCE(json_agg(json_build_object(
          'id', COALESCE(NULLIF(youtube_video_id, ''), id),
          'url', youtube_url,
          'title', title,
          'description', description,
          'thumbnailUrl', COALESCE(NULLIF(metrics->>'sourceThumbnailUrl', ''), NULLIF(metrics->>'thumbnailUrl', ''), NULLIF(metrics->'movie'->'tmdb'->>'posterUrl', ''), NULLIF(metrics->'movie'->'mal'->>'imageUrl', ''), ${sqlString(profilePicture)}),
          'publishedAt', TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
          'viewCount', COALESCE((metrics->'publicStats'->>'viewCount')::integer, (metrics->>'views')::integer, 0),
          'likeCount', COALESCE((metrics->'publicStats'->>'likeCount')::integer, (metrics->>'likes')::integer, 0),
          'commentCount', COALESCE((metrics->'publicStats'->>'commentCount')::integer, (metrics->>'comments')::integer, 0),
          'durationSeconds', COALESCE((metrics->'shortsTrim'->>'uploadDurationSeconds')::numeric, 60),
          'privacyStatus', status,
          'uploadState', metrics->>'uploadState'
        ) ORDER BY created_at DESC), '[]'::json)
        FROM automation_uploads
        WHERE youtube_account_id = ${sqlString(account.id)}
        LIMIT ${sqlNumber(pageSize)};
        `);
        const uploads = JSON.parse(out || "[]");
        for (const upload of uploads) {
            const status = String(upload.privacyStatus || "").toLowerCase();
            const uploadState = String(upload.uploadState || "").toLowerCase();
            const shouldAppendLocal = !recentVideos.length || status.includes("fail") || uploadState.includes("fail") || uploadState === "uploading";
            if (!shouldAppendLocal && seenTitles.has(dashboardTitleKey(upload.title)))
                continue;
            if (!shouldAppendLocal)
                continue;
            addRecentVideo(upload);
        }
        recentVideos = recentVideos.slice(0, pageSize);
    } catch (e) {
        console.warn("Could not fetch recent TikTok videos from DB:", e);
    }

    const recentViews = recentVideos.reduce((acc, v) => acc + (v.viewCount || 0), 0);
    return {
        account: {
            ...account,
            channelTitle: displayName,
            thumbnailUrl: profilePicture,
            url: `https://www.tiktok.com/@${account.channelHandle?.replace(/^@/, '') || ''}`
        },
        stats: {
            subscriberCount: followerCount,
            viewCount: recentViews,
            videoCount: videoCount,
            recentVideoCount: recentVideos.length,
            recentViews,
            averageViewsPerVideo: recentVideos.length ? Math.round(recentViews / recentVideos.length) : 0
        },
        recentVideos,
        publish: {
            studioUploadUrl: "https://www.tiktok.com/creator-center/upload",
            note: "AutoYT automatically syncs and posts recaps to TikTok using Zernio's high-capacity publishing network."
        }
    };
}
async function getZernioYouTubeDashboard(account, options = {}) {
    const videoKind = normalizeChannelVideoKind(options.videoKind);
    const pageSize = videoKind === "all" ? 50 : Math.min(Math.max(Number(options.pageSize) || 24, 1), 50);
    let channelSnippet = {};
    let channelStats = {};
    let recentVideos = [];
    let nextPageToken = "";
    let uploadsPlaylistId = account.uploadsPlaylistId || deriveYouTubeUploadsPlaylistId(account.channelId || "");
    let publicFetchError = "";
    if (youtubeApiKey() && account.channelId) {
        try {
            const channelData = await fetchYouTubeJson("channels", {
                part: "snippet,statistics,contentDetails",
                id: account.channelId,
            });
            const channel = channelData.items?.[0] || {};
            channelSnippet = channel.snippet || {};
            channelStats = channel.statistics || {};
            const remoteUploads = channel.contentDetails?.relatedPlaylists?.uploads || "";
            if (remoteUploads)
                uploadsPlaylistId = remoteUploads;
            if (uploadsPlaylistId && uploadsPlaylistId !== account.uploadsPlaylistId && account.id) {
                await runPsql(`UPDATE youtube_accounts SET uploads_playlist_id = ${sqlString(uploadsPlaylistId)}, updated_at = now() WHERE id = ${sqlString(account.id)};`).catch(() => undefined);
            }
            const maxBucketPages = Math.min(Math.max(Number(process.env.YOUTUBE_CHANNEL_BUCKET_SCAN_PAGES) || 6, 1), 20);
            let pageTokenInput = String(options.pageToken || "");
            let pagesScanned = 0;
            do {
                const uploads = await fetchYouTubeJson("playlistItems", {
                    part: "snippet,contentDetails",
                    playlistId: uploadsPlaylistId,
                    maxResults: 50,
                    pageToken: pageTokenInput,
                });
                pagesScanned += 1;
                nextPageToken = uploads.nextPageToken || "";
                const ids = (uploads.items || []).map((item) => item.contentDetails?.videoId).filter(Boolean);
                if (ids.length) {
                    const videos = await fetchYouTubeJson("videos", {
                        part: "snippet,statistics,contentDetails,status",
                        id: ids.join(","),
                    });
                    const pageVideos = (videos.items || []).map((video) => ({
                        id: video.id,
                        url: `https://www.youtube.com/watch?v=${video.id}`,
                        title: video.snippet?.title || "Untitled video",
                        description: video.snippet?.description || "",
                        tags: Array.isArray(video.snippet?.tags) ? video.snippet.tags : [],
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
                    })).filter((video) => channelVideoKindMatches(video, videoKind));
                    recentVideos.push(...pageVideos.slice(0, Math.max(0, pageSize - recentVideos.length)));
                }
                pageTokenInput = nextPageToken;
            } while (shouldContinueChannelVideoBucket({
                kind: videoKind,
                resultCount: recentVideos.length,
                targetCount: pageSize,
                nextPageToken,
                pagesScanned,
                maxPages: maxBucketPages,
            }));
        }
        catch (error) {
            publicFetchError = error instanceof Error ? error.message : String(error);
            console.warn("Zernio YouTube public-API video fetch failed:", publicFetchError);
        }
    }
    if (!recentVideos.length) {
        try {
            const out = await runPsql(`
SELECT COALESCE(json_agg(json_build_object(
  'id', COALESCE(NULLIF(youtube_video_id, ''), id),
  'url', youtube_url,
  'title', title,
  'description', description,
  'thumbnailUrl', '',
  'publishedAt', TO_CHAR(COALESCE(schedule_at, created_at), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'privacyStatus', CASE WHEN status = 'scheduled' THEN 'private' ELSE 'public' END,
  'uploadStatus', status,
  'embeddable', true,
  'madeForKids', false,
  'categoryId', '',
  'viewCount', COALESCE((metrics->'publicStats'->>'viewCount')::integer, 0),
  'likeCount', COALESCE((metrics->'publicStats'->>'likeCount')::integer, 0),
  'commentCount', COALESCE((metrics->'publicStats'->>'commentCount')::integer, 0),
  'durationSeconds', COALESCE((metrics->'shortsTrim'->>'uploadDurationSeconds')::numeric, 0)
) ORDER BY created_at DESC), '[]'::json)
FROM (
  SELECT * FROM automation_uploads
  WHERE youtube_account_id = ${sqlString(account.id)}
  ORDER BY created_at DESC
  LIMIT ${sqlNumber(pageSize)}
) uploads;
`);
            recentVideos = JSON.parse(out || "[]");
        }
        catch (error) {
            console.warn("Could not fetch Zernio YouTube dashboard uploads:", error instanceof Error ? error.message : error);
        }
    }
    const totalViews = Number(channelStats.viewCount || recentVideos.reduce((sum, video) => sum + Number(video.viewCount || 0), 0));
    const totalVideos = Number(channelStats.videoCount || recentVideos.length);
    const totalSubs = Number(channelStats.subscriberCount || 0);
    const recentViews = recentVideos.reduce((sum, video) => sum + Number(video.viewCount || 0), 0);
    return {
        account: {
            id: account.id,
            email: account.email,
            channelId: account.channelId,
            channelTitle: channelSnippet.title || account.channelTitle,
            channelHandle: channelSnippet.customUrl || account.channelHandle || "",
            thumbnailUrl: channelSnippet.thumbnails?.high?.url || channelSnippet.thumbnails?.medium?.url || channelSnippet.thumbnails?.default?.url || account.thumbnailUrl || "",
            uploadsPlaylistId,
            url: account.channelId ? `https://www.youtube.com/channel/${account.channelId}` : "",
        },
        stats: {
            subscriberCount: totalSubs,
            viewCount: totalViews,
            videoCount: totalVideos,
            recentVideoCount: recentVideos.length,
            recentViews,
            averageViewsPerVideo: recentVideos.length ? Math.round(recentViews / recentVideos.length) : 0,
        },
        recentVideos,
        nextPageToken,
        videoKind,
        publish: {
            studioUploadUrl: "https://studio.youtube.com/channel/UC/videos/upload",
            note: publicFetchError
                ? "Could not load existing channel videos from YouTube. AutoYT publishes through Zernio; some read features need a YouTube Data API key."
                : "AutoYT publishes through Zernio. Existing channel videos are loaded read-only via YouTube's public Data API.",
        },
    };
}
async function getConnectedYouTubeDashboard(account, options = {}) {
    // TikTok accounts have no YouTube channel; Zernio-linked YouTube accounts still do.
    if (account?.platform === "tiktok") {
        return { recentVideos: [], nextPageToken: "", channel: {}, uploadsPlaylistId: "", stats: {} };
    }
    if (String(account?.accessToken || "") === "zernio" || String(account?.refreshToken || "") === "zernio") {
        return getZernioYouTubeDashboard(account, options);
    }
    const videoKind = normalizeChannelVideoKind(options.videoKind);
    const pageSize = videoKind === "all" ? 50 : Math.min(Math.max(Number(options.pageSize) || 24, 1), 50);
    const maxBucketPages = Math.min(Math.max(Number(process.env.YOUTUBE_CHANNEL_BUCKET_SCAN_PAGES) || 6, 1), 20);
    let pageTokenInput = String(options.pageToken || "");
    const channelUrl = new URL("https://www.googleapis.com/youtube/v3/channels");
    channelUrl.searchParams.set("part", "snippet,statistics,contentDetails");
    channelUrl.searchParams.set("id", account.channelId);
    const channelData = await fetchJsonWithAuth(channelUrl, account.accessToken);
    const channel = channelData.items?.[0] || {};
    const uploadsPlaylistId = account.uploadsPlaylistId || channel.contentDetails?.relatedPlaylists?.uploads || deriveYouTubeUploadsPlaylistId(account.channelId);
    if (uploadsPlaylistId && uploadsPlaylistId !== account.uploadsPlaylistId && account.id) {
        await runPsql(`UPDATE youtube_accounts SET uploads_playlist_id = ${sqlString(uploadsPlaylistId)}, updated_at = now() WHERE id = ${sqlString(account.id)};`).catch((error) => {
            console.warn("YouTube uploads playlist backfill skipped:", error instanceof Error ? error.message : error);
        });
    }
    let recentVideos = [];
    let nextPageToken = "";
    if (uploadsPlaylistId) {
        let pagesScanned = 0;
        do {
            const uploadsUrl = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
            uploadsUrl.searchParams.set("part", "snippet,contentDetails");
            uploadsUrl.searchParams.set("playlistId", uploadsPlaylistId);
            uploadsUrl.searchParams.set("maxResults", "50");
            if (pageTokenInput)
                uploadsUrl.searchParams.set("pageToken", pageTokenInput);
            const uploads = await fetchJsonWithAuth(uploadsUrl, account.accessToken);
            pagesScanned += 1;
            nextPageToken = uploads.nextPageToken || "";
            const ids = (uploads.items || []).map((item) => item.contentDetails?.videoId).filter(Boolean);
            if (ids.length) {
                const videosUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
                videosUrl.searchParams.set("part", "snippet,statistics,contentDetails,status");
                videosUrl.searchParams.set("id", ids.join(","));
                const videos = await fetchJsonWithAuth(videosUrl, account.accessToken);
                const pageVideos = (videos.items || []).map((video) => ({
                    id: video.id,
                    url: `https://www.youtube.com/watch?v=${video.id}`,
                    title: video.snippet?.title || "Untitled video",
                    description: video.snippet?.description || "",
                    tags: Array.isArray(video.snippet?.tags) ? video.snippet.tags : [],
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
                })).filter((video) => channelVideoKindMatches(video, videoKind));
                recentVideos.push(...pageVideos.slice(0, Math.max(0, pageSize - recentVideos.length)));
            }
            pageTokenInput = nextPageToken;
        } while (shouldContinueChannelVideoBucket({
            kind: videoKind,
            resultCount: recentVideos.length,
            targetCount: pageSize,
            nextPageToken,
            pagesScanned,
            maxPages: maxBucketPages,
        }));
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
        nextPageToken,
        videoKind,
        publish: {
            studioUploadUrl: "https://studio.youtube.com/channel/UC/videos/upload",
            note: "Direct upload is prepared through OAuth scope. Browser upload UI is the next step; for now this opens YouTube publishing tools for the selected channel.",
        },
    };
}
async function listChannelCompetitorFeed(userId, accountId) {
    if (!postgresConfigured())
        return { competitors: [], videos: [] };
    const out = await runPsql(`
SELECT COALESCE(json_agg(json_build_object(
  'id', id,
  'sourceType', source_type,
  'title', channel_title,
  'url', channel_url,
  'handle', channel_handle,
  'niche', niche,
  'reason', reason,
  'metrics', metrics,
  'updatedAt', FLOOR(EXTRACT(EPOCH FROM updated_at) * 1000)::bigint
) ORDER BY updated_at DESC), '[]'::json)
FROM competitor_channels
WHERE user_id = ${sqlString(userId)}
  AND youtube_account_id = ${sqlString(accountId)};
`);
    const competitors = JSON.parse(out || "[]");
    const saved = await listSavedPlaylistRecords(userId).catch(() => []);
    const videos = [];
    for (const competitor of competitors) {
        const identity = String(competitor.url || "").replace(/\/+$/, "").toLowerCase();
        const handle = String(competitor.handle || competitor.title || "").replace(/^@/, "").toLowerCase();
        const record = saved.find((item) => {
            const key = String(item.key || item.analyzedUrl || "").replace(/\/+$/, "").toLowerCase();
            const author = String(item.playlist?.author || "").replace(/^@/, "").toLowerCase();
            return key === identity || (!!handle && author === handle) || (!!handle && key.includes(`/${handle}`));
        });
        const sourceVideos = Array.isArray(record?.playlist?.videos) ? record.playlist.videos : [];
        for (const video of sourceVideos.slice(0, 12)) {
            const views = automationTikTokViewCount(video);
            const created = automationTikTokCreatedAt(video);
            const ageHours = created ? Math.max(1, (Date.now() - created) / 36e5) : 24;
            videos.push({
                competitorId: competitor.id,
                competitorTitle: competitor.title,
                competitorHandle: competitor.handle,
                niche: competitor.niche,
                title: video.title || "Untitled source clip",
                url: video.playUrl || video.url || "",
                thumbnailUrl: freshTikTokCover(video.dynamicCover || video.thumbnailUrl || ""),
                views,
                comments: Number(video.stats?.commentCount || 0),
                likes: Number(video.stats?.diggCount || video.stats?.likeCount || 0),
                durationSeconds: Number(video.durationSeconds || video.duration || 0),
                hookPattern: inferHookPatternFromText(video.title || "", competitor.niche || ""),
                velocity: Math.round((views / ageHours) * 10) / 10,
                publishedAt: created || 0,
            });
        }
    }
    videos.sort((a, b) => b.velocity - a.velocity || b.views - a.views);
    return { competitors, videos: videos.slice(0, 60) };
}
function buildYouTubeCompetitorQueries(dashboard = {}, niches = [], topProfile = {}) {
    const terms = buildYouTubeCompetitorTargetTerms(dashboard, niches, topProfile);
    const recent = Array.isArray(dashboard.recentVideos) ? dashboard.recentVideos : [];
    const words = compactKeyword(recent.slice(0, 8).map((video) => video.title).join(" "));
    if (words.length >= 2)
        terms.push(words.slice(0, 4).join(" "));
    for (const video of recent.slice(0, 10)) {
        const videoWords = compactKeyword(video.title || "");
        if (videoWords.length >= 2)
            terms.push(videoWords.slice(0, 4).join(" "));
    }
    const titleBlob = recent.map((video) => video.title).join(" ");
    if (/(anime|manga|manhwa|donghua|recap|explained)/i.test(titleBlob))
        terms.push("anime recap explained", "manhwa recap story");
    if (/(movie|film|ending|story|recap)/i.test(titleBlob))
        terms.push("movie recap explained", "story recap channel");
    if (/(ai|fruit|animation|story|moral)/i.test(titleBlob))
        terms.push("ai fruit story", "ai animated story");
    if (/(shorts|viral|story)/i.test(titleBlob))
        terms.push("viral story shorts");
    return Array.from(new Set(terms.map((term) => term.replace(/\s+/g, " ").trim()).filter((term) => term.length >= 4))).slice(0, 12);
}
function buildYouTubeCompetitorTargetTerms(dashboard = {}, niches = [], topProfile = {}) {
    const terms = [];
    for (const niche of niches.slice(0, 8)) {
        const micro = String(niche.microNiche || "").replace(/\([^)]*\)/g, " ").trim();
        const sub = String(niche.subNiche || "").trim();
        if (micro)
            terms.push(micro);
        if (micro && sub)
            terms.push(`${micro} ${sub}`);
    }
    for (const row of (topProfile.bestMicroNiches || []).slice(0, 5)) {
        const label = String(row.label || "").trim();
        if (label && label !== "Unknown")
            terms.push(label);
    }
    for (const row of (topProfile.bestTranscriptMicroNiches || []).slice(0, 4)) {
        const label = String(row.label || "").trim();
        if (label && label !== "Unknown")
            terms.push(label);
    }
    for (const row of (topProfile.bestHooks || []).slice(0, 6)) {
        const label = String(row.label || "").replace(/-/g, " ").trim();
        if (label && label !== "Unknown")
            terms.push(label);
    }
    for (const row of (topProfile.bestGenres || []).slice(0, 4)) {
        const label = String(row.label || "").trim();
        if (label && label !== "Unknown")
            terms.push(label);
    }
    if (dashboard.account?.channelTitle)
        terms.push(String(dashboard.account.channelTitle).replace(/\b(official|channel|youtube)\b/gi, "").trim());
    const withVariants = [];
    for (const term of terms) {
        withVariants.push(term, ...buildMicroNicheSearchVariants(term));
    }
    return Array.from(new Set(withVariants.map((term) => term.replace(/\s+/g, " ").trim()).filter((term) => term.length >= 4))).slice(0, 22);
}
function youtubeCompetitorContentFamily(dashboard = {}, niches = [], topProfile = {}) {
    const text = [
        dashboard.account?.channelTitle,
        ...(dashboard.recentVideos || []).slice(0, 12).map((video) => video.title),
        ...(niches || []).flatMap((niche) => [niche.microNiche, niche.macroNiche, niche.subNiche]),
        ...(topProfile.bestMicroNiches || []).map((row) => row.label),
        ...(topProfile.bestTranscriptMicroNiches || []).map((row) => row.label),
    ].filter(Boolean).join(" ").toLowerCase();
    if (/(anime|manga|manhwa|manhua|donghua|webtoon|shonen|isekai|cultivation|immortal|demon king|martial arts tournament)/i.test(text))
        return "anime";
    if (/(movie|film|cinema|ending explained|hollywood)/i.test(text))
        return "movie";
    if (/(ai fruit|animated story|moral story|cartoon story)/i.test(text))
        return "animated-story";
    if (/(geo|country|map|border|island|continent)/i.test(text))
        return "geo";
    return "faceless";
}
function expandYouTubeCompetitorQueriesForFamily(queries, family) {
    const expanded = [];
    const familySeeds = [];
    for (const query of queries) {
        const clean = String(query || "").replace(/\s+/g, " ").trim();
        if (!clean)
            continue;
        if (family === "anime") {
            if (/(anime|manga|manhwa|manhua|donghua|webtoon)/i.test(clean)) {
                expanded.push(clean, `${clean} explained`, `${clean} recap`);
            }
            else {
                expanded.push(`${clean} anime recap`, `${clean} manga recap`, `${clean} manhwa recap`, `${clean} donghua recap`);
            }
        }
        else if (family === "movie") {
            expanded.push(`${clean} movie recap`, `${clean} film explained`, clean);
        }
        else if (family === "animated-story") {
            expanded.push(`${clean} animated story`, `${clean} animation shorts`, clean);
        }
        else if (family === "geo") {
            expanded.push(`${clean} geography facts`, `${clean} map facts`, clean);
        }
        else {
            expanded.push(clean);
        }
    }
    if (family === "anime") {
        familySeeds.push("anime recap", "anime recaps", "anime explained", "anime shorts recap", "manhwa recap", "manhwa explained", "donghua recap", "sports anime recap", "mecha anime recap");
    }
    else if (family === "animated-story") {
        familySeeds.push("animated story shorts", "ai story animation");
    }
    else if (family === "geo") {
        familySeeds.push("geography facts shorts", "country facts shorts");
    }
    return Array.from(new Set([...expanded, ...familySeeds].map((term) => term.replace(/\s+/g, " ").trim()).filter(Boolean))).slice(0, 18);
}
function buildMicroNicheSearchVariants(term) {
    const text = String(term || "").toLowerCase();
    const variants = [];
    const phraseRules = [
        /\bai\s+fruit\b/g,
        /\bfruit[-\s]?head\b/g,
        /\banthropomorphic\s+fruit\b/g,
        /\bfruit\s+(moral|drama|story|stories|lore)\b/g,
        /\bmoral\s+stor(y|ies)\b/g,
        /\bmartial\s+arts\b/g,
        /\bbody\s+modification\b/g,
        /\bsports?\s+(psychological|training|technique|anime)\b/g,
        /\bcybernetic\s+body\b/g,
        /\bmythological\s+donghua\b/g,
        /\bdonghua\s+(action|fantasy|recap)\b/g,
        /\bdetective\s+vs\s+perfect\s+crime\b/g,
        /\bmonster\s+sports\b/g,
        /\btournament\s+survival\b/g,
        /\bgeograph(y|ical)\s+(facts?|insights?|stories)\b/g,
        /\bcountry\s+facts?\b/g,
        /\bmap\s+facts?\b/g,
        /\bcat\s+(story|stories|drama|comedy)\b/g,
        /\bfeline\s+(storytelling|drama|humor)\b/g,
    ];
    for (const rule of phraseRules) {
        for (const match of text.matchAll(rule)) {
            const phrase = String(match[0] || "").trim();
            if (phrase)
                variants.push(phrase);
        }
    }
    const tokens = youtubeCompetitorImportantTokens(text);
    if (tokens.length >= 2)
        variants.push(tokens.slice(0, Math.min(4, tokens.length)).join(" "));
    if (/(anime|manga|manhwa|donghua|martial|sports|cybernetic|mythological|detective|tournament)/i.test(text)) {
        for (const variant of [...variants])
            variants.push(`${variant} anime recap`);
    }
    if (/(fruit|moral|anthropomorphic|fruitlore)/i.test(text)) {
        for (const variant of [...variants])
            variants.push(`${variant} animated story`, `${variant} shorts`);
    }
    if (/(geograph|country|map|border|island)/i.test(text)) {
        for (const variant of [...variants])
            variants.push(`${variant} shorts`);
    }
    return Array.from(new Set(variants)).filter((item) => item.length >= 4).slice(0, 8);
}
function youtubeCompetitorImportantTokens(text) {
    const stop = new Set([
        "with", "from", "that", "this", "they", "their", "your", "video", "short", "shorts", "youtube", "channel",
        "official", "recap", "recaps", "explained", "explain", "story", "stories", "animation", "animated", "generated",
        "content", "faceless", "viral", "clips", "clip", "best", "top", "full", "part", "episode", "anime", "manga",
        "manhwa", "manhua", "donghua", "movie", "movies", "film", "films",
    ]);
    return Array.from(new Set(String(text || "")
        .toLowerCase()
        .replace(/&amp;/g, " ")
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .map((word) => word.replace(/s$/i, ""))
        .filter((word) => word.length >= 3 && !stop.has(word))));
}
function youtubeCompetitorMicroMatchScore(text, targetTerms = []) {
    const haystack = String(text || "").toLowerCase();
    let best = 0;
    for (const term of targetTerms.slice(0, 10)) {
        const clean = String(term || "").toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
        if (!clean)
            continue;
        if (clean.length >= 8 && haystack.includes(clean))
            best = Math.max(best, 100);
        const tokens = youtubeCompetitorImportantTokens(clean);
        if (!tokens.length)
            continue;
        const hits = tokens.filter((token) => haystack.includes(token));
        const threshold = tokens.length <= 2 ? tokens.length : Math.max(2, Math.ceil(tokens.length * 0.45));
        if (hits.length >= threshold)
            best = Math.max(best, Math.round((hits.length / tokens.length) * 100));
    }
    return best;
}
function youtubeCompetitorText(video, channel, competitor = {}) {
    const snippet = video?.snippet || {};
    const tags = Array.isArray(snippet.tags) ? snippet.tags.join(" ") : "";
    const recentTitles = Array.isArray(competitor?.recentVideos)
        ? competitor.recentVideos.map((item) => item?.title || "").join(" ")
        : "";
    return [
        snippet.title,
        snippet.description,
        tags,
        snippet.channelTitle,
        channel?.snippet?.title,
        channel?.snippet?.description,
        competitor?.title,
        competitor?.niche,
        competitor?.subNiche,
        competitor?.reason,
        recentTitles,
    ].filter(Boolean).join(" ").toLowerCase();
}
function hasAnimeRecapPackaging(text) {
    const value = String(text || "").toLowerCase();
    if (/\b(anime|manga|manhwa|manhua|donghua|webtoon)\s+(recaps?|explained|summary|summaries|story|stories|breakdown)\b/i.test(value))
        return true;
    if (/\b(recaps?|explained|explanation|summar(y|ized|ised)|breakdown|ending explained|plot|full story|story recap|movie recap)\b/i.test(value))
        return true;
    return /\b(this|that)\s+(boy|girl|man|woman|kid|student|warrior|fighter|hero|villain|demon|king|prince|princess|mage|hunter|weakest|strongest)\b|\b(nobody|everyone|he|she)\s+(knew|thought|realized|discovers?|becomes?|was|had|could|gets?|finds?)\b|\b(reincarnated|isekai|awakens?|betrayed|overpowered|hidden power|secret technique|system|cultivation|immortal|demon king|martial arts)\b/i.test(value);
}
function isNonRecapAnimeFormat(text) {
    const value = String(text || "").toLowerCase();
    return /\b(rat(e|ing|ed|es)|rank(ed|ing)?|tier list|top\s+\d+|best anime|worst anime|review|reaction|reacts?|news|recommendations?|watch order|opening|ending song|ost|amv|edit|quiz|guess the anime)\b/i.test(value)
        && !hasAnimeRecapPackaging(value);
}
function youtubeCompetitorMatchesFamily(video, channel, family, matchedQuery = "", targetTerms = []) {
    const text = youtubeCompetitorText(video, channel);
    const microScore = youtubeCompetitorMicroMatchScore(`${text} ${matchedQuery}`, targetTerms);
    if (targetTerms.length && microScore < 34)
        return false;
    if (family === "anime") {
        const queryText = String(matchedQuery || "").toLowerCase();
        const recapHit = hasAnimeRecapPackaging(text);
        const animeHit = /(anime|manga|manhwa|manhua|donghua|webtoon|isekai|shonen|cultivation|immortal|demon king|monkey king|mecha|cyberpunk|martial arts|anime recap|manga recap|manhwa recap|donghua recap)/i.test(text)
            || (/\b(anime|manga|manhwa|manhua|donghua|webtoon)\b/i.test(queryText) && recapHit);
        const wrongRecapFamily = /\b(movie recap|film recap|hollywood recap|kdrama recap|celebrity|live action movie)\b/i.test(text) && !/(anime|manga|manhwa|manhua|donghua|webtoon)/i.test(text);
        return animeHit && recapHit && !wrongRecapFamily && !isNonRecapAnimeFormat(text);
    }
    if (family === "movie")
        return /(movie|film|ending|recap|explained|cinema|story)/i.test(text) && !/\b(anime|manga|manhwa|donghua)\b/i.test(text);
    if (family === "animated-story")
        return /(animated|animation|cartoon|ai story|moral story|fruit story|story shorts)/i.test(text);
    if (family === "geo")
        return /(geography|country|map|border|continent|island|facts)/i.test(text);
    return true;
}
function youtubeCompetitorRecordMatchesFamily(competitor, family, targetTerms = []) {
    if (!competitor)
        return false;
    const recordText = youtubeCompetitorText(null, null, competitor);
    if (targetTerms.length && youtubeCompetitorMicroMatchScore(recordText, targetTerms) < 34)
        return false;
    if (family !== "anime")
        return true;
    const recentTitles = Array.isArray(competitor.recentVideos)
        ? competitor.recentVideos.map((item) => item?.title || "").join(" ")
        : "";
    const identityText = [competitor.title, competitor.handle, recentTitles].filter(Boolean).join(" ").toLowerCase();
    const topicText = [identityText, competitor.niche, competitor.subNiche].filter(Boolean).join(" ").toLowerCase();
    const animeHit = /(anime|manga|manhwa|manhua|donghua|webtoon|isekai|shonen|cultivation|immortal|demon king|monkey king|mecha|cyberpunk|martial arts)/i.test(topicText);
    return animeHit && hasAnimeRecapPackaging(identityText) && !isNonRecapAnimeFormat(identityText);
}
async function listYouTubeCompetitorChannels(account, dashboard = {}, niches = [], topProfile = {}) {
    const family = youtubeCompetitorContentFamily(dashboard, niches, topProfile);
    const targetTerms = buildYouTubeCompetitorTargetTerms(dashboard, niches, topProfile);
    const queries = expandYouTubeCompetitorQueriesForFamily(buildYouTubeCompetitorQueries(dashboard, niches, topProfile), family);
    if (!queries.length)
        return [];
    const channelDiscoveryAfter = new Date(Date.now() - 90 * 864e5).toISOString();
    const recentVideoAfterMs = Date.now() - 14 * 864e5;
    const freshVideoAfterMs = Date.now() - 2 * 864e5;
    const videoMap = new Map();
    const matchedQueryByVideo = new Map();
    for (const query of queries) {
        try {
            const search = await fetchYouTubeDiscoveryJson(account, "search", {
                part: "snippet",
                type: "video",
                q: query,
                order: "viewCount",
                maxResults: 25,
                publishedAfter: channelDiscoveryAfter,
                relevanceLanguage: "en",
                regionCode: "US",
                safeSearch: "none",
            });
            const ids = (search.items || []).map((item) => item.id?.videoId).filter(Boolean);
            if (!ids.length)
                continue;
            const videosData = await fetchYouTubeDiscoveryJson(account, "videos", {
                part: "snippet,statistics,contentDetails",
                id: ids.join(","),
                maxResults: 50,
            });
            for (const video of videosData.items || []) {
                if (!video?.id || video.snippet?.channelId === account.channelId)
                    continue;
                videoMap.set(video.id, video);
                matchedQueryByVideo.set(video.id, query);
            }
        }
        catch (error) {
            console.warn("YouTube competitor query skipped:", query, error instanceof Error ? error.message : error);
        }
    }
    const videos = Array.from(videoMap.values());
    const channelIds = Array.from(new Set(videos.map((video) => video.snippet?.channelId).filter(Boolean))).slice(0, 50);
    if (!channelIds.length)
        return [];
    const channelsData = await fetchYouTubeDiscoveryJson(account, "channels", {
        part: "snippet,statistics",
        id: channelIds.join(","),
        maxResults: 50,
    }).catch((error) => {
        console.warn("YouTube competitor channel stats unavailable:", error instanceof Error ? error.message : error);
        return { items: [] };
    });
    const channelMap = new Map((channelsData.items || []).map((channel) => [channel.id, channel]));
    const now = Date.now();
    const grouped = new Map();
    for (const video of videos) {
        const snippet = video.snippet || {};
        const channelId = snippet.channelId || "";
        if (!channelId || channelId === account.channelId)
            continue;
        const channel = channelMap.get(channelId) || {};
        const matchedQuery = matchedQueryByVideo.get(video.id) || "";
        if (!youtubeCompetitorMatchesFamily(video, channel, family, matchedQuery, targetTerms))
            continue;
        const stats = video.statistics || {};
        const viewCount = Number(stats.viewCount || 0);
        const publishedAt = snippet.publishedAt || "";
        const publishedMs = publishedAt ? new Date(publishedAt).getTime() : 0;
        if (!publishedMs || publishedMs < recentVideoAfterMs)
            continue;
        const ageHours = Math.max(1, (now - publishedMs) / 36e5);
        const viewsPerHour = Math.round((viewCount / ageHours) * 10) / 10;
        const categoryName = getYoutubeCategoryName(snippet.categoryId || "");
        const inferredNiche = inferNiche(snippet.title || "", snippet.description || "", matchedQueryByVideo.get(video.id) || "", categoryName, Array.isArray(snippet.tags) ? snippet.tags.join(" ") : "");
        const microScore = youtubeCompetitorMicroMatchScore(`${snippet.title || ""} ${snippet.description || ""} ${snippet.channelTitle || ""} ${matchedQuery}`, targetTerms);
        const current = grouped.get(channelId) || {
            channelId,
            title: snippet.channelTitle || "YouTube competitor",
            url: `https://www.youtube.com/channel/${channelId}`,
            niche: inferredNiche,
            matchedQuery,
            contentFamily: family,
            microScore,
            totalRecentViews: 0,
            bestVideoViews: 0,
            bestViewsPerHour: 0,
            recentVideos: [],
        };
        current.totalRecentViews += viewCount;
        current.bestVideoViews = Math.max(current.bestVideoViews, viewCount);
        current.bestViewsPerHour = Math.max(current.bestViewsPerHour, viewsPerHour);
        current.microScore = Math.max(current.microScore || 0, microScore);
        current.recentVideos.push({
            id: video.id,
            title: snippet.title || "Untitled video",
            url: `https://www.youtube.com/watch?v=${video.id}`,
            thumbnailUrl: snippet.thumbnails?.maxres?.url || snippet.thumbnails?.standard?.url || snippet.thumbnails?.high?.url || snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || "",
            viewCount,
            likeCount: Number(stats.likeCount || 0),
            commentCount: Number(stats.commentCount || 0),
            viewsPerHour,
            freshnessBoost: publishedMs >= freshVideoAfterMs ? 1.25 : 1,
            publishedAt,
        });
        grouped.set(channelId, current);
    }
    return Array.from(grouped.values()).map((item) => {
        const channel = channelMap.get(item.channelId) || {};
        const stats = channel.statistics || {};
        const subscriberCount = stats.hiddenSubscriberCount ? 0 : Number(stats.subscriberCount || 0);
        const videoCount = Number(stats.videoCount || 0);
        const thumbnailUrl = channel.snippet?.thumbnails?.high?.url || channel.snippet?.thumbnails?.medium?.url || channel.snippet?.thumbnails?.default?.url || "";
        const handle = channel.snippet?.customUrl || "";
        const recentVideos = item.recentVideos.sort((a, b) => (b.viewsPerHour * (b.freshnessBoost || 1)) - (a.viewsPerHour * (a.freshnessBoost || 1)) || b.viewCount - a.viewCount).slice(0, 3);
        const freshClipBoost = recentVideos.some((video) => new Date(video.publishedAt || 0).getTime() >= freshVideoAfterMs) ? 25000 : 0;
        const score = Math.round(item.bestVideoViews * 0.45 + item.totalRecentViews * 0.16 + subscriberCount * 0.08 + item.bestViewsPerHour * 150 + Number(item.microScore || 0) * 4500 + freshClipBoost);
        return {
            id: `ytcmp_${item.channelId}`,
            sourceType: "youtube",
            channelId: item.channelId,
            title: channel.snippet?.title || item.title,
            url: handle ? `https://www.youtube.com/${handle}` : item.url,
            handle,
            thumbnailUrl,
            niche: item.contentFamily === "anime" ? "anime & manga recap" : item.niche,
            subNiche: item.matchedQuery,
            contentFamily: item.contentFamily,
            reason: `Recent YouTube videos match the learned micro-niche "${item.matchedQuery || targetTerms[0] || item.niche}" and are pulling high views.`,
            subscriberCount,
            videoCount,
            totalRecentViews: item.totalRecentViews,
            bestVideoViews: item.bestVideoViews,
            bestViewsPerHour: Math.round(item.bestViewsPerHour),
            recentVideos,
            score,
            updatedAt: Date.now(),
        };
    }).sort((a, b) => b.score - a.score).slice(0, 12);
}
async function getChannelGrowthInsights(userId, accountId, account = null, dashboard = null) {
    if (!postgresConfigured())
        return null;
    const profilesOut = await runPsql(`
SELECT COALESCE(json_agg(json_build_object(
  'agentId', p.agent_id,
  'agentName', a.name,
  'summary', p.summary,
  'recommendation', p.recommendation,
  'confidence', p.confidence,
  'profile', p.profile,
  'updatedAt', FLOOR(EXTRACT(EPOCH FROM p.updated_at) * 1000)::bigint
) ORDER BY p.confidence DESC, p.updated_at DESC), '[]'::json)
FROM agent_learning_profiles p
JOIN automation_agents a ON a.id = p.agent_id
WHERE p.user_id = ${sqlString(userId)}
  AND p.youtube_account_id = ${sqlString(accountId)};
`);
    const observationsOut = await runPsql(`
SELECT COALESCE(json_agg(json_build_object(
  'id', id,
  'agentId', agent_id,
  'microNiche', micro_niche,
  'macroNiche', macro_niche,
  'subNiche', sub_niche,
  'uploads', uploads,
  'totalViews', total_views,
  'bestViews', best_views,
  'confidence', confidence,
  'status', status,
  'evidence', evidence,
  'updatedAt', FLOOR(EXTRACT(EPOCH FROM updated_at) * 1000)::bigint
) ORDER BY total_views DESC, confidence DESC), '[]'::json)
FROM agent_niche_observations
WHERE user_id = ${sqlString(userId)}
  AND youtube_account_id = ${sqlString(accountId)};
`);
    const profiles = JSON.parse(profilesOut || "[]");
    const niches = JSON.parse(observationsOut || "[]");
    const competitorFeed = await listChannelCompetitorFeed(userId, accountId);
    const topProfile = profiles[0]?.profile || {};
    const competitorFamily = youtubeCompetitorContentFamily(dashboard || {}, niches, topProfile);
    const competitorTargetTerms = buildYouTubeCompetitorTargetTerms(dashboard || {}, niches, topProfile);
    const savedYouTubeCompetitorsRaw = await listTrackedYouTubeCompetitors(userId, accountId).catch((error) => {
        console.warn("Saved YouTube competitors unavailable:", error instanceof Error ? error.message : error);
        return [];
    });
    const savedYouTubeCompetitors = savedYouTubeCompetitorsRaw.filter((competitor) => youtubeCompetitorRecordMatchesFamily(competitor, competitorFamily, competitorTargetTerms));
    const discoveredYouTubeCompetitors = account && account.platform !== "tiktok" && dashboard ? await listYouTubeCompetitorChannels(account, dashboard, niches, topProfile).catch((error) => {
        console.warn("YouTube competitor discovery unavailable:", error instanceof Error ? error.message : error);
        return [];
    }) : [];
    if (discoveredYouTubeCompetitors.length) {
        await saveTrackedYouTubeCompetitors(userId, accountId, discoveredYouTubeCompetitors).catch((error) => {
            console.warn("YouTube competitor persistence unavailable:", error instanceof Error ? error.message : error);
        });
    }
    const youtubeCompetitors = mergeYouTubeCompetitors(discoveredYouTubeCompetitors, savedYouTubeCompetitors);
    const bestNiche = niches[0]?.microNiche || topProfile.bestMicroNiches?.[0]?.label || "";
    const bestHook = topProfile.bestHooks?.[0]?.label || "";
    const bestDuration = topProfile.bestDurations?.[0]?.label || "";
    const bestSource = topProfile.bestSources?.[0]?.label || "";
    const actions = [
        bestNiche ? `Scale ${bestNiche} until a 24h check underperforms the channel baseline.` : "Run more agent uploads to establish a winning MSN.",
        bestHook ? `Package the next upload around ${bestHook} hooks.` : "Tag each new upload with a hook pattern so the system can compare packaging.",
        bestDuration ? `Favor ${bestDuration} clips for the next test batch.` : "Capture source duration so the system can learn best clip length.",
        bestSource ? `Mine ${bestSource} and adjacent creators for follow-up clips.` : "Add competitor/source channels to create a richer feed.",
    ];
    return {
        profiles,
        niches,
        youtubeCompetitors,
        sourceCandidates: competitorFeed.competitors,
        candidateVideos: competitorFeed.videos,
        competitors: competitorFeed.competitors,
        competitorVideos: competitorFeed.videos,
        playbook: {
            bestNiche,
            bestHook,
            bestDuration,
            bestSource,
            monetizationFocus: bestNiche ? `${bestNiche}: build repeatable playlists, comment replies, and series identity around the proven cluster.` : "Find one repeatable cluster before scaling upload volume.",
            actions,
        },
    };
}
function defaultOptimizationFromContext(video, growthInsights, uploadRecord) {
    const title = String(video?.snippet?.title || video?.title || uploadRecord?.title || "Untitled video");
    const metrics = uploadRecord?.metrics || {};
    const taxonomy = metrics.taxonomy || extractContentTaxonomy(metrics.movie || {}, {
        title,
        genre: uploadRecord?.genre || "",
        microNiche: uploadRecord?.microNiche || "",
    });
    const playbook = growthInsights?.playbook || {};
    const bestNiche = taxonomy.microSubNiche || uploadRecord?.microNiche || playbook.bestNiche || "viral recap";
    const bestHook = taxonomy.hookPattern || playbook.bestHook || inferHookPatternFromText(title, uploadRecord?.genre || "", bestNiche);
    const subject = String(metrics.movie?.title || uploadRecord?.movieTitle || bestNiche || "This Story").trim();
    const titleIdeas = [
        `This ${bestHook.replace(/-/g, " ")} Moment Made ${subject} Impossible to Ignore`,
        `Everyone Missed Why ${subject} Went Viral`,
        `The ${bestNiche} Clip That Viewers Keep Rewatching`,
    ].map((value, index) => ({
        title: value.slice(0, 98),
        score: Math.max(72, 92 - index * 4),
        reason: index === 0 ? "Uses the strongest learned hook pattern for this channel." : "Keeps one clear curiosity promise without keyword stuffing.",
    }));
    const tags = Array.from(new Set([
        bestNiche,
        taxonomy.subNiche,
        taxonomy.primary,
        bestHook.replace(/-/g, " "),
        uploadRecord?.genre,
        "recap",
        "story explained",
        "viral shorts",
        "character reveal",
    ].filter(Boolean).map((item) => String(item).toLowerCase().slice(0, 45)))).slice(0, 15);
    return {
        generatedAt: new Date().toISOString(),
        titleScore: Math.max(58, Math.min(99, Math.round(48 + title.length / 2 + (Number(video?.statistics?.viewCount || 0) > 1000 ? 10 : 0)))),
        current: {
            title,
            description: String(video?.snippet?.description || uploadRecord?.description || ""),
            tags: Array.isArray(video?.snippet?.tags) ? video.snippet.tags : [],
        },
        taxonomy,
        learnedContext: {
            bestNiche,
            bestHook,
            bestDuration: playbook.bestDuration || "",
            bestSource: playbook.bestSource || uploadRecord?.sourceAuthor || "",
            monetizationFocus: playbook.monetizationFocus || "",
        },
        titleIdeas,
        description: `Watch this ${bestNiche} recap built around ${bestHook.replace(/-/g, " ")}.\n\n${taxonomy.audience ? `${taxonomy.audience}\n\n` : ""}This upload is packaged for viewers who like fast story reveals, character stakes, and repeatable recap formats.\n\nSubscribe for more ${bestNiche} clips and explained story moments.`,
        tags,
        actionCards: [
            `Lead with ${bestHook.replace(/-/g, " ")} in the first line of the title.`,
            playbook.bestDuration ? `Keep the next test near the winning ${playbook.bestDuration} duration bucket.` : "Compare this upload against the next 3 performance checks before scaling.",
            `Build a playlist around ${bestNiche} to improve session depth and monetization readiness.`,
        ],
        monetizationNotes: [
            "Favor repeatable series identity over random one-off clips.",
            "Use descriptions to clarify story context and reduce low-quality traffic.",
            "Scale niches that produce views plus comments, not views alone.",
        ],
    };
}
async function getAutomationUploadForVideo(userId, accountId, videoId) {
    return getChannelUploadByRef(userId, accountId, videoId);
}
async function getTikTokVideoOptimization(userId, account, videoId) {
    const uploadRecord = await getChannelUploadByRef(userId, account.id, videoId).catch(() => null);
    const zernioPostId = resolveZernioPostIdFromUpload(uploadRecord, videoId);
    const zernioPost = zernioPostId ? await fetchZernioPostDetails(account, zernioPostId) : null;
    const pseudoVideo = {
        snippet: {
            title: zernioPost?.title || uploadRecord?.title || "TikTok post",
            description: zernioPost?.description || uploadRecord?.description || "",
            tags: [],
        },
        statistics: {
            viewCount: zernioPost?.viewCount || uploadRecord?.metrics?.views || 0,
            likeCount: zernioPost?.likeCount || uploadRecord?.metrics?.likes || 0,
            commentCount: zernioPost?.commentCount || uploadRecord?.metrics?.comments || 0,
        },
        contentDetails: { duration: `PT${Math.max(1, Math.round(Number(zernioPost?.durationSeconds || 60)))}S` },
    };
    const growthInsights = await getChannelGrowthInsights(userId, account.id).catch(() => null);
    const fallback = defaultOptimizationFromContext(pseudoVideo, growthInsights, uploadRecord);
    return fallback;
}
async function getYouTubeVideoOptimization(userId, account, videoId) {
    if (isTikTokPublishAccount(account))
        return getTikTokVideoOptimization(userId, account, videoId);
    const video = await fetchYouTubeVideoById(videoId, account);
    if (!video)
        throw new Error("YouTube video not found");
    const uploadRecord = await getChannelUploadByRef(userId, account.id, videoId).catch(() => null);
    const growthInsights = await getChannelGrowthInsights(userId, account.id).catch(() => null);
    const fallback = defaultOptimizationFromContext(video, growthInsights, uploadRecord);
    try {
        const prompt = `Create viral but non-spammy YouTube optimization suggestions for faster monetization readiness.

Current video:
${JSON.stringify({
                                title: video.snippet?.title,
                                description: video.snippet?.description?.slice(0, 1500),
                                tags: video.snippet?.tags || [],
                                stats: video.statistics || {},
                                durationSeconds: isoDurationToSeconds(video.contentDetails?.duration),
                            })}

Known automation/movie/taxonomy context:
${JSON.stringify(uploadRecord || {})}

Channel learning and monetization playbook:
${JSON.stringify(growthInsights?.playbook || {})}

Rules:
- Titles must be under 100 characters, highly clickable, clear, and not misleading.
- Descriptions should improve search context, playlist/session intent, and viewer trust.
- Tags should be plain descriptive keywords only: niche, sub-niche, micro-sub-niche, hook, genre, content format, and common misspellings when useful. Do not include hashtags or score numbers in tags. Keep tags secondary to title, thumbnail, and description.
- Advice must be specific to the channel's proven winners, not generic SEO advice.
- Return JSON only.`;
        const generated = await generateTextJson(prompt, async () => {
            const response = await generateGeminiContent({
                model: "gemini-3-flash-preview",
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            titleIdeas: {
                                type: Type.ARRAY,
                                items: {
                                    type: Type.OBJECT,
                                    properties: {
                                        title: { type: Type.STRING },
                                        score: { type: Type.NUMBER },
                                        reason: { type: Type.STRING },
                                    },
                                },
                            },
                            description: { type: Type.STRING },
                            tags: { type: Type.ARRAY, items: { type: Type.STRING } },
                            actionCards: { type: Type.ARRAY, items: { type: Type.STRING } },
                            monetizationNotes: { type: Type.ARRAY, items: { type: Type.STRING } },
                        },
                    },
                },
            });
            return parseModelJson(response.text, {});
        });
        return {
            ...fallback,
            titleIdeas: Array.isArray(generated.titleIdeas) && generated.titleIdeas.length ? generated.titleIdeas.slice(0, 5) : fallback.titleIdeas,
            description: String(generated.description || fallback.description).slice(0, 5000),
            tags: Array.isArray(generated.tags) && generated.tags.length ? generated.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 20) : fallback.tags,
            actionCards: Array.isArray(generated.actionCards) && generated.actionCards.length ? generated.actionCards.slice(0, 6) : fallback.actionCards,
            monetizationNotes: Array.isArray(generated.monetizationNotes) && generated.monetizationNotes.length ? generated.monetizationNotes.slice(0, 6) : fallback.monetizationNotes,
        };
    }
    catch (error) {
        console.warn("Video optimization generation failed:", error instanceof Error ? error.message : error);
        return fallback;
    }
}
function stableId(prefix, parts) {
    return `${prefix}_${crypto.createHash("sha1").update(parts.map((part) => String(part || "")).join("\n")).digest("hex").slice(0, 24)}`;
}
function publicFeedType(type) {
    const value = String(type || "All").trim();
    return ["All", "Optimization", "Research", "Analytics", "Achievements"].includes(value) ? value : "All";
}
function plainNumber(value) {
    const n = Number(value || 0);
    return new Intl.NumberFormat("en").format(Number.isFinite(n) ? n : 0);
}
function compactNumber(value) {
    const n = Number(value || 0);
    return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(Number.isFinite(n) ? n : 0);
}
function feedInsightFromRow(row) {
    return row ? {
        id: row.id,
        type: row.type,
        title: row.title,
        body: row.body,
        actionLabel: row.actionLabel,
        actionPayload: row.actionPayload || {},
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        priority: Number(row.priority || 0),
        status: row.status,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    } : null;
}
function buildFeedInsightSeeds(dashboard = {}, growthInsights = null) {
    const seeds = [];
    const videos = Array.isArray(dashboard.recentVideos) ? dashboard.recentVideos : [];
    const stats = dashboard.stats || {};
    const medianViews = Math.max(1, median(videos.map((video) => Number(video.viewCount || 0)).filter(Boolean)));
    const add = (type, title, body, options = {}) => {
        const sourceType = options.sourceType || type.toLowerCase();
        const sourceId = options.sourceId || title;
        seeds.push({
            id: stableId("ins", [dashboard.account?.id || dashboard.account?.channelId || "", type, sourceType, sourceId]),
            type,
            title: String(title || "").slice(0, 180),
            body: String(body || "").slice(0, 700),
            actionLabel: String(options.actionLabel || "").slice(0, 80),
            actionPayload: options.actionPayload || {},
            sourceType,
            sourceId: String(sourceId || "").slice(0, 220),
            priority: Number(options.priority || 0),
        });
    };
    const weakTitle = videos.find((video) => String(video.title || "").length < 42 && Number(video.viewCount || 0) >= medianViews * 0.5);
    if (weakTitle) {
        add("Optimization", "Strengthen the title hook", `${weakTitle.title} is short enough to add a clearer curiosity promise tied to the channel's winning niche.`, {
            actionLabel: "Open title ideas",
            sourceType: "video",
            sourceId: weakTitle.id,
            priority: 82,
            actionPayload: { videoId: weakTitle.id, tab: "Title" },
        });
    }
    const lowEngagement = videos.find((video) => Number(video.viewCount || 0) > 0 && ((Number(video.likeCount || 0) + Number(video.commentCount || 0) * 2) / Math.max(1, Number(video.viewCount || 0))) < 0.01);
    if (lowEngagement) {
        add("Optimization", "Add stronger comment bait without asking a question", `${lowEngagement.title} has views but light engagement. Use a description/pinned-comment angle that invites opinions around the story payoff.`, {
            actionLabel: "Open SEO",
            sourceType: "video",
            sourceId: lowEngagement.id,
            priority: 74,
            actionPayload: { videoId: lowEngagement.id, tab: "SEO" },
        });
    }
    for (const competitor of (growthInsights?.youtubeCompetitors || []).slice(0, 4)) {
        add("Research", `Track ${competitor.title}`, `${competitor.reason || "This YouTube channel is posting similar content and pulling recent views."} Best recent clip: ${compactNumber(competitor.bestVideoViews || 0)} views.`, {
            actionLabel: "Copy style",
            sourceType: "youtube_competitor",
            sourceId: competitor.channelId || competitor.id,
            priority: Math.min(99, 62 + Number(competitor.score || 0) / 100000),
            actionPayload: { competitor, sourceUrl: competitor.url, sourceChannelId: competitor.channelId },
        });
    }
    for (const candidate of (growthInsights?.sourceCandidates || []).slice(0, 4)) {
        const views = Number(candidate.metrics?.views || candidate.metrics?.viewCount || candidate.metrics?.totalViews || 0);
        add("Research", `Watch ${candidate.title}`, `${candidate.reason || "This TikTok source is producing clips close to the channel's current content lane."}${views ? ` Recent source views: ${compactNumber(views)}.` : ""}`, {
            actionLabel: "Open source",
            sourceType: "tiktok_source_candidate",
            sourceId: candidate.id || candidate.url || candidate.title,
            priority: 68,
            actionPayload: { competitor: candidate, sourceUrl: candidate.url },
        });
    }
    for (const niche of (growthInsights?.niches || []).slice(0, 3)) {
        add("Research", `Niche signal: ${niche.microNiche}`, `${compactNumber(niche.totalViews || 0)} views across ${niche.uploads || 0} uploads. Status: ${niche.status || "candidate"}.`, {
            actionLabel: "Use in next project",
            sourceType: "niche",
            sourceId: niche.id || niche.microNiche,
            priority: Math.min(96, 60 + Number(niche.confidence || 0) * 35),
            actionPayload: { niche },
        });
    }
    const ownedOutliers = videos.map((video) => {
        const ageHours = Math.max(1, (Date.now() - new Date(video.publishedAt || Date.now()).getTime()) / 36e5);
        const viewsPerHour = Math.round(Number(video.viewCount || 0) / ageHours);
        return { video, viewsPerHour, multiple: Number(video.viewCount || 0) / medianViews };
    }).filter((row) => row.multiple >= 1.5 || row.viewsPerHour >= 10).sort((a, b) => b.multiple - a.multiple).slice(0, 3);
    for (const row of ownedOutliers) {
        add("Analytics", `Outlier signal: ${row.video.title}`, `${compactNumber(row.video.viewCount || 0)} views at ${compactNumber(row.viewsPerHour)} views/hour, about ${row.multiple.toFixed(1)}x this channel's recent baseline.`, {
            actionLabel: "Open performance",
            sourceType: "video",
            sourceId: row.video.id,
            priority: Math.min(98, 65 + row.multiple * 10),
            actionPayload: { videoId: row.video.id, tab: "Performance" },
        });
    }
    const subscriberMilestones = [100, 250, 500, 750, 1000, 2500, 5000, 10000].filter((value) => Number(stats.subscriberCount || 0) >= value);
    const latestSubscriberMilestone = subscriberMilestones[subscriberMilestones.length - 1];
    if (latestSubscriberMilestone) {
        const audienceLabel = dashboard.account?.platform === "tiktok" ? "followers" : "subscribers";
        add("Achievements", `Milestone unlocked - ${plainNumber(latestSubscriberMilestone)} ${audienceLabel}`, "Keep turning the highest-retention niche into a repeatable series so the next milestone compounds faster.", {
            sourceType: "milestone",
            sourceId: `subs-${latestSubscriberMilestone}`,
            priority: 58,
        });
    }
    const viewMilestones = [10000, 25000, 50000, 75000, 100000, 250000, 500000, 1000000].filter((value) => Number(stats.viewCount || 0) >= value);
    const latestViewMilestone = viewMilestones[viewMilestones.length - 1];
    if (latestViewMilestone) {
        add("Achievements", `Milestone unlocked - ${plainNumber(latestViewMilestone)} views`, "Use this proof to create tighter playlists and more consistent packaging around the winning content lane.", {
            sourceType: "milestone",
            sourceId: `views-${latestViewMilestone}`,
            priority: 56,
        });
    }
    if (growthInsights?.playbook?.actions?.length) {
        add("All", "Next best growth move", growthInsights.playbook.actions[0], {
            actionLabel: "Use in project",
            sourceType: "playbook",
            sourceId: "next-action",
            priority: 90,
            actionPayload: { playbook: growthInsights.playbook },
        });
    }
    return seeds;
}
async function upsertFeedInsightSeeds(userId, accountId, dashboard, growthInsights) {
    if (!postgresConfigured())
        return buildFeedInsightSeeds(dashboard, growthInsights);
    const currentCompetitorIds = (growthInsights?.youtubeCompetitors || [])
        .map((competitor) => String(competitor.channelId || competitor.id || "").trim())
        .filter(Boolean);
    if (currentCompetitorIds.length) {
        await runPsql(`
DELETE FROM feed_insights
WHERE user_id = ${sqlString(userId)}
  AND youtube_account_id = ${sqlString(accountId)}
  AND source_type = 'youtube_competitor'
  AND source_id NOT IN (${currentCompetitorIds.map(sqlString).join(", ")});
`);
    }
    for (const insight of buildFeedInsightSeeds(dashboard, growthInsights)) {
        await runPsql(`
INSERT INTO feed_insights (
  id, user_id, youtube_account_id, type, title, body, action_label, action_payload,
  source_type, source_id, priority, status, created_at, updated_at
)
VALUES (
  ${sqlString(insight.id)}, ${sqlString(userId)}, ${sqlString(accountId)}, ${sqlString(insight.type)},
  ${sqlString(insight.title)}, ${sqlString(insight.body)}, ${sqlString(insight.actionLabel)}, ${jsonbLiteral(insight.actionPayload)},
  ${sqlString(insight.sourceType)}, ${sqlString(insight.sourceId)}, ${sqlNumber(insight.priority)}, 'open', now(), now()
)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  body = EXCLUDED.body,
  action_label = EXCLUDED.action_label,
  action_payload = EXCLUDED.action_payload,
  priority = EXCLUDED.priority,
  status = CASE WHEN feed_insights.status = 'dismissed' THEN feed_insights.status ELSE EXCLUDED.status END,
  updated_at = now();
`);
    }
    return listFeedInsights(userId, accountId);
}
async function listFeedInsights(userId, accountId, type = "All") {
    if (!postgresConfigured())
        return [];
    const filter = publicFeedType(type);
    const typeWhere = filter === "All" ? "" : `AND type = ${sqlString(filter)}`;
    const out = await runPsql(`
SELECT COALESCE(json_agg(json_build_object(
  'id', id,
  'type', type,
  'title', title,
  'body', body,
  'actionLabel', action_label,
  'actionPayload', action_payload,
  'sourceType', source_type,
  'sourceId', source_id,
  'priority', priority,
  'status', status,
  'createdAt', FLOOR(EXTRACT(EPOCH FROM created_at) * 1000)::bigint,
  'updatedAt', FLOOR(EXTRACT(EPOCH FROM updated_at) * 1000)::bigint
) ORDER BY priority DESC, updated_at DESC), '[]'::json)
FROM feed_insights
WHERE user_id = ${sqlString(userId)}
  AND youtube_account_id = ${sqlString(accountId)}
  AND status <> 'dismissed'
  ${typeWhere};
`);
    return JSON.parse(out || "[]").map(feedInsightFromRow).filter(Boolean);
}
async function saveTrackedYouTubeCompetitors(userId, accountId, competitors = []) {
    if (!postgresConfigured())
        return;
    for (const competitor of competitors.slice(0, 20)) {
        if (!competitor?.channelId)
            continue;
        const id = stableId("ytcmp", [accountId, competitor.channelId]);
        await runPsql(`
INSERT INTO tracked_youtube_competitors (
  id, user_id, youtube_account_id, channel_id, channel_title, channel_url, channel_handle,
  thumbnail_url, niche, sub_niche, reason, metrics, recent_videos, score, last_checked_at, updated_at
)
VALUES (
  ${sqlString(id)}, ${sqlString(userId)}, ${sqlString(accountId)}, ${sqlString(competitor.channelId)},
  ${sqlString(competitor.title)}, ${sqlString(competitor.url)}, ${sqlString(competitor.handle || "")},
  ${sqlString(competitor.thumbnailUrl || "")}, ${sqlString(competitor.niche || "")}, ${sqlString(competitor.subNiche || "")},
  ${sqlString(competitor.reason || "")}, ${jsonbLiteral({
            subscriberCount: competitor.subscriberCount || 0,
            videoCount: competitor.videoCount || 0,
            totalRecentViews: competitor.totalRecentViews || 0,
            bestVideoViews: competitor.bestVideoViews || 0,
            bestViewsPerHour: competitor.bestViewsPerHour || 0,
        })}, ${jsonbLiteral(competitor.recentVideos || [])}, ${sqlNumber(competitor.score || 0)}, now(), now()
)
ON CONFLICT (youtube_account_id, channel_id) DO UPDATE SET
  channel_title = EXCLUDED.channel_title,
  channel_url = EXCLUDED.channel_url,
  channel_handle = EXCLUDED.channel_handle,
  thumbnail_url = EXCLUDED.thumbnail_url,
  niche = EXCLUDED.niche,
  sub_niche = EXCLUDED.sub_niche,
  reason = EXCLUDED.reason,
  metrics = EXCLUDED.metrics,
  recent_videos = EXCLUDED.recent_videos,
  score = EXCLUDED.score,
  last_checked_at = now(),
  updated_at = now();
`);
    }
}
async function listTrackedYouTubeCompetitors(userId, accountId) {
    if (!postgresConfigured())
        return [];
    const out = await runPsql(`
SELECT COALESCE(json_agg(json_build_object(
  'id', id,
  'sourceType', 'youtube',
  'channelId', channel_id,
  'title', channel_title,
  'url', channel_url,
  'handle', channel_handle,
  'thumbnailUrl', thumbnail_url,
  'niche', niche,
  'subNiche', sub_niche,
  'reason', reason,
  'subscriberCount', COALESCE((metrics->>'subscriberCount')::bigint, 0),
  'videoCount', COALESCE((metrics->>'videoCount')::bigint, 0),
  'totalRecentViews', COALESCE((metrics->>'totalRecentViews')::bigint, 0),
  'bestVideoViews', COALESCE((metrics->>'bestVideoViews')::bigint, 0),
  'bestViewsPerHour', COALESCE((metrics->>'bestViewsPerHour')::double precision, 0),
  'recentVideos', recent_videos,
  'score', score,
  'updatedAt', FLOOR(EXTRACT(EPOCH FROM updated_at) * 1000)::bigint
) ORDER BY score DESC, updated_at DESC), '[]'::json)
FROM tracked_youtube_competitors
WHERE user_id = ${sqlString(userId)}
  AND youtube_account_id = ${sqlString(accountId)};
`);
    return JSON.parse(out || "[]");
}
function mergeYouTubeCompetitors(primary = [], fallback = []) {
    const byChannel = new Map();
    for (const competitor of [...primary, ...fallback]) {
        const key = competitor?.channelId || competitor?.url || competitor?.title;
        if (!key || byChannel.has(key))
            continue;
        byChannel.set(key, competitor);
    }
    return Array.from(byChannel.values()).sort((a, b) => Number(b.score || 0) - Number(a.score || 0)).slice(0, 12);
}
async function resolveYouTubeChannelReference(source = {}, account = null) {
    const sourceUrl = String(source.sourceUrl || source.url || "").trim();
    const directId = String(source.sourceChannelId || source.channelId || "").trim();
    if (directId)
        return { channelId: directId, sourceUrl: sourceUrl || `https://www.youtube.com/channel/${directId}` };
    let handle = String(source.handle || "").replace(/^@/, "").trim();
    if (!handle && sourceUrl) {
        try {
            const url = new URL(sourceUrl);
            const parts = url.pathname.split("/").filter(Boolean);
            const channelIndex = parts.findIndex((part) => part.toLowerCase() === "channel");
            if (channelIndex >= 0 && parts[channelIndex + 1])
                return { channelId: parts[channelIndex + 1], sourceUrl };
            const atPart = parts.find((part) => part.startsWith("@"));
            if (atPart)
                handle = atPart.replace(/^@/, "");
            else if (parts[0])
                handle = parts[0].replace(/^c\//i, "").replace(/^user\//i, "");
        }
        catch {
            handle = sourceUrl.replace(/^@/, "");
        }
    }
    if (!handle)
        throw new Error("A YouTube channel URL, handle, or channel ID is required.");
    const byHandle = await fetchYouTubeDiscoveryJson(account, "channels", {
        part: "snippet,statistics",
        forHandle: handle,
        maxResults: 1,
    }).catch(() => ({ items: [] }));
    if (byHandle.items?.[0]?.id)
        return { channelId: byHandle.items[0].id, sourceUrl: sourceUrl || `https://www.youtube.com/@${handle}` };
    const search = await fetchYouTubeDiscoveryJson(account, "search", {
        part: "snippet",
        type: "channel",
        q: handle,
        maxResults: 1,
    });
    const channelId = search.items?.[0]?.snippet?.channelId || search.items?.[0]?.id?.channelId || "";
    if (!channelId)
        throw new Error("Could not resolve that YouTube channel.");
    return { channelId, sourceUrl: sourceUrl || `https://www.youtube.com/@${handle}` };
}
async function buildChannelStyleProfile(input = {}, account = null) {
    const ref = await resolveYouTubeChannelReference(input, account);
    const channelData = await fetchYouTubeDiscoveryJson(account, "channels", {
        part: "snippet,statistics",
        id: ref.channelId,
        maxResults: 1,
    });
    const channel = channelData.items?.[0];
    if (!channel)
        throw new Error("YouTube channel not found.");
    const search = await fetchYouTubeDiscoveryJson(account, "search", {
        part: "snippet",
        type: "video",
        channelId: ref.channelId,
        order: "viewCount",
        maxResults: 12,
        publishedAfter: new Date(Date.now() - 365 * 864e5).toISOString(),
    }).catch(() => ({ items: [] }));
    const ids = (search.items || []).map((item) => item.id?.videoId).filter(Boolean);
    let videos = [];
    if (ids.length) {
        const details = await fetchYouTubeDiscoveryJson(account, "videos", {
            part: "snippet,statistics,contentDetails",
            id: ids.join(","),
            maxResults: 50,
        });
        videos = (details.items || []).map((video) => {
            const snippet = video.snippet || {};
            const stats = video.statistics || {};
            const durationSeconds = isoDurationToSeconds(video.contentDetails?.duration);
            const tagText = Array.isArray(snippet.tags) ? snippet.tags.join(" ") : "";
            return {
                id: video.id,
                title: snippet.title || "",
                url: `https://www.youtube.com/watch?v=${video.id}`,
                thumbnailUrl: snippet.thumbnails?.maxres?.url || snippet.thumbnails?.standard?.url || snippet.thumbnails?.high?.url || snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || "",
                viewCount: Number(stats.viewCount || 0),
                likeCount: Number(stats.likeCount || 0),
                commentCount: Number(stats.commentCount || 0),
                durationSeconds,
                hookPattern: inferHookPatternFromText(snippet.title || "", "", tagText),
                niche: inferNiche(snippet.title || "", snippet.description || "", String(input.niche || ""), getYoutubeCategoryName(snippet.categoryId || ""), tagText),
                tags: Array.isArray(snippet.tags) ? snippet.tags.slice(0, 12) : [],
                transcriptStatus: "pending",
                descriptionExcerpt: String(snippet.description || "").slice(0, 700),
                publishedAt: snippet.publishedAt || "",
            };
        }).sort((a, b) => b.viewCount - a.viewCount);
    }
    const topTitleWords = compactKeyword(videos.map((video) => video.title).join(" ")).slice(0, 8);
    const hooks = Array.from(new Set(videos.map((video) => video.hookPattern).filter(Boolean))).slice(0, 6);
    const durations = videos.map((video) => durationBucketFromSeconds(video.durationSeconds)).filter(Boolean);
    const durationMode = modeValue(durations) || "test-short";
    const profile = {
        generatedAt: new Date().toISOString(),
        sourceChannel: {
            id: ref.channelId,
            title: channel.snippet?.title || input.title || "YouTube style",
            url: ref.sourceUrl,
            handle: channel.snippet?.customUrl || "",
            subscriberCount: channel.statistics?.hiddenSubscriberCount ? 0 : Number(channel.statistics?.subscriberCount || 0),
            videoCount: Number(channel.statistics?.videoCount || 0),
            thumbnailUrl: channel.snippet?.thumbnails?.high?.url || channel.snippet?.thumbnails?.medium?.url || channel.snippet?.thumbnails?.default?.url || "",
        },
        sampleCount: videos.length,
        topVideos: videos.slice(0, 8),
        titleFormula: topTitleWords.length ? `Lead with ${topTitleWords.slice(0, 3).join(", ")} and keep one clear curiosity payoff.` : "Use a direct curiosity hook with one concrete story payoff.",
        hookPatterns: hooks,
        durationPreference: durationMode,
        seoKeywords: Array.from(new Set(videos.flatMap((video) => video.tags || []).concat(topTitleWords))).slice(0, 18),
        thumbnailDirection: "Use the best source frames, readable contrast, one focal subject, and avoid cluttered side blur.",
        transcriptLearning: videos.some((video) => video.descriptionExcerpt) ? "Transcript fetch is pending; descriptions and title structures are used until captions are available." : "Transcript fetch is pending.",
        publishingAdvice: "Post similar tests in batches, compare 24h view velocity, and only scale the micro-niche when comments and retention signals follow views.",
    };
    return {
        name: channel.snippet?.title || input.title || "Copied YouTube style",
        sourceChannelId: ref.channelId,
        sourceUrl: ref.sourceUrl,
        thumbnailUrl: profile.sourceChannel.thumbnailUrl,
        niche: input.niche || videos[0]?.niche || "",
        subNiche: input.subNiche || "",
        microNiche: input.microNiche || input.niche || "",
        profile,
    };
}
function modeValue(values = []) {
    const map = new Map();
    for (const value of values) {
        map.set(value, (map.get(value) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}
function channelStyleFromRow(row) {
    return row ? {
        id: row.id,
        sourceType: row.sourceType,
        sourceChannelId: row.sourceChannelId,
        sourceUrl: row.sourceUrl,
        name: row.name,
        niche: row.niche,
        subNiche: row.subNiche,
        microNiche: row.microNiche,
        profile: row.profile || {},
        status: row.status,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    } : null;
}
async function saveChannelStyle(userId, accountId, input = {}, account = null) {
    if (!postgresConfigured())
        throw new Error("Database is required for style profiles.");
    const built = await buildChannelStyleProfile(input, account);
    const id = stableId("style", [accountId, built.sourceChannelId || built.sourceUrl, built.name]);
    const out = await runPsql(`
INSERT INTO channel_styles (
  id, user_id, youtube_account_id, source_type, source_channel_id, source_url, name,
  niche, sub_niche, micro_niche, profile, status, created_at, updated_at
)
VALUES (
  ${sqlString(id)}, ${sqlString(userId)}, ${sqlString(accountId)}, 'youtube',
  ${sqlString(built.sourceChannelId)}, ${sqlString(built.sourceUrl)}, ${sqlString(built.name)},
  ${sqlString(built.niche)}, ${sqlString(built.subNiche)}, ${sqlString(built.microNiche)},
  ${jsonbLiteral(built.profile)}, 'active', now(), now()
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  niche = EXCLUDED.niche,
  sub_niche = EXCLUDED.sub_niche,
  micro_niche = EXCLUDED.micro_niche,
  profile = EXCLUDED.profile,
  status = 'active',
  updated_at = now()
RETURNING json_build_object(
  'id', id,
  'sourceType', source_type,
  'sourceChannelId', source_channel_id,
  'sourceUrl', source_url,
  'name', name,
  'niche', niche,
  'subNiche', sub_niche,
  'microNiche', micro_niche,
  'profile', profile,
  'status', status,
  'createdAt', FLOOR(EXTRACT(EPOCH FROM created_at) * 1000)::bigint,
  'updatedAt', FLOOR(EXTRACT(EPOCH FROM updated_at) * 1000)::bigint
);
`);
    return channelStyleFromRow(JSON.parse(out || "null"));
}
async function listChannelStyles(userId, accountId) {
    if (!postgresConfigured())
        return [];
    const out = await runPsql(`
SELECT COALESCE(json_agg(json_build_object(
  'id', id,
  'sourceType', source_type,
  'sourceChannelId', source_channel_id,
  'sourceUrl', source_url,
  'name', name,
  'niche', niche,
  'subNiche', sub_niche,
  'microNiche', micro_niche,
  'profile', profile,
  'status', status,
  'createdAt', FLOOR(EXTRACT(EPOCH FROM created_at) * 1000)::bigint,
  'updatedAt', FLOOR(EXTRACT(EPOCH FROM updated_at) * 1000)::bigint
) ORDER BY updated_at DESC), '[]'::json)
FROM channel_styles
WHERE user_id = ${sqlString(userId)}
  AND youtube_account_id = ${sqlString(accountId)}
  AND status = 'active';
`);
    return JSON.parse(out || "[]").map(channelStyleFromRow).filter(Boolean);
}
function creatorProjectFromRow(row) {
    return row ? {
        id: row.id,
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        title: row.title,
        status: row.status,
        stage: row.stage,
        styleId: row.styleId || "",
        metadata: row.metadata || {},
        outputs: row.outputs || {},
        archivedAt: row.archivedAt || null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    } : null;
}
async function getCreatorProject(userId, projectId) {
    const out = await runPsql(`
SELECT COALESCE((SELECT json_build_object(
  'id', id,
  'sourceType', source_type,
  'sourceId', source_id,
  'title', title,
  'status', status,
  'stage', stage,
  'styleId', style_id,
  'metadata', metadata,
  'outputs', outputs,
  'archivedAt', FLOOR(EXTRACT(EPOCH FROM archived_at) * 1000)::bigint,
  'createdAt', FLOOR(EXTRACT(EPOCH FROM created_at) * 1000)::bigint,
  'updatedAt', FLOOR(EXTRACT(EPOCH FROM updated_at) * 1000)::bigint
) FROM creator_projects WHERE id = ${sqlString(projectId)} AND user_id = ${sqlString(userId)} LIMIT 1), 'null'::json);
`);
    return creatorProjectFromRow(JSON.parse(out || "null"));
}
async function listCreatorProjects(userId, accountId, sourceType = "", sourceId = "") {
    const sourceWhere = sourceType && sourceId ? `AND source_type = ${sqlString(sourceType)} AND source_id = ${sqlString(sourceId)}` : "";
    const out = await runPsql(`
SELECT COALESCE(json_agg(json_build_object(
  'id', id,
  'sourceType', source_type,
  'sourceId', source_id,
  'title', title,
  'status', status,
  'stage', stage,
  'styleId', style_id,
  'metadata', metadata,
  'outputs', outputs,
  'archivedAt', FLOOR(EXTRACT(EPOCH FROM archived_at) * 1000)::bigint,
  'createdAt', FLOOR(EXTRACT(EPOCH FROM created_at) * 1000)::bigint,
  'updatedAt', FLOOR(EXTRACT(EPOCH FROM updated_at) * 1000)::bigint
) ORDER BY updated_at DESC), '[]'::json)
FROM creator_projects
WHERE user_id = ${sqlString(userId)}
  AND youtube_account_id = ${sqlString(accountId)}
  AND status <> 'deleted'
  ${sourceWhere};
`);
    return JSON.parse(out || "[]").map(creatorProjectFromRow).filter(Boolean);
}
function defaultCreatorProjectOutputs(input = {}) {
    const video = input.video || {};
    const optimization = input.optimization || {};
    const title = String(input.title || video.title || optimization.current?.title || "Untitled creator project");
    const tags = Array.isArray(optimization.tags) ? optimization.tags : [];
    const titleIdeas = Array.isArray(optimization.titleIdeas) ? optimization.titleIdeas : [];
    return {
        overview: {
            summary: "Project created from Channel Management. Continue through title, SEO, script, visual, thumbnail, and publishing tabs.",
            sourceTitle: title,
        },
        title: {
            current: title,
            ideas: titleIdeas,
        },
        seo: {
            description: optimization.description || "",
            tags,
            actionCards: optimization.actionCards || [],
        },
        script: {
            hook: titleIdeas[0]?.title || title,
            structure: ["0-3s: direct curiosity hook", "3-20s: context and stakes", "20s+: payoff, lesson, or reveal"],
            notes: optimization.learnedContext || {},
        },
        visualPlan: {
            direction: "Use clean full-frame source visuals. Avoid side blur on Shorts and keep captions readable.",
            segments: [],
        },
        thumbnail: {
            direction: "One readable subject, high contrast, direct emotional cue, no clutter.",
        },
        publishingPlan: {
            playlist: optimization.learnedContext?.bestNiche || "",
            timing: optimization.learnedContext?.bestDuration ? `Test near the winning ${optimization.learnedContext.bestDuration} bucket.` : "Post in batches and compare 24h velocity.",
            monetization: optimization.monetizationNotes || [],
        },
    };
}
async function createCreatorProject(userId, accountId, input = {}) {
    if (!postgresConfigured())
        throw new Error("Database is required for creator projects.");
    const sourceType = String(input.sourceType || "channel_video").slice(0, 80);
    const sourceId = String(input.sourceId || input.video?.id || "").slice(0, 220);
    const existing = sourceId ? (await listCreatorProjects(userId, accountId, sourceType, sourceId)).find((project) => project.status !== "archived") : null;
    if (existing)
        return existing;
    const id = `prj_${crypto.randomUUID()}`;
    const title = String(input.title || input.video?.title || "Creator project").slice(0, 180);
    const metadata = {
        video: input.video || null,
        sourceUrl: input.sourceUrl || input.video?.url || "",
        createdFrom: input.createdFrom || "channel-management",
    };
    const outputs = defaultCreatorProjectOutputs(input);
    const out = await runPsql(`
INSERT INTO creator_projects (
  id, user_id, youtube_account_id, source_type, source_id, title, status, stage, style_id, metadata, outputs, created_at, updated_at
)
VALUES (
  ${sqlString(id)}, ${sqlString(userId)}, ${sqlString(accountId)}, ${sqlString(sourceType)}, ${sqlString(sourceId)},
  ${sqlString(title)}, 'active', 'overview', ${input.styleId ? sqlString(input.styleId) : "NULL"}, ${jsonbLiteral(metadata)}, ${jsonbLiteral(outputs)}, now(), now()
)
RETURNING json_build_object(
  'id', id,
  'sourceType', source_type,
  'sourceId', source_id,
  'title', title,
  'status', status,
  'stage', stage,
  'styleId', style_id,
  'metadata', metadata,
  'outputs', outputs,
  'archivedAt', FLOOR(EXTRACT(EPOCH FROM archived_at) * 1000)::bigint,
  'createdAt', FLOOR(EXTRACT(EPOCH FROM created_at) * 1000)::bigint,
  'updatedAt', FLOOR(EXTRACT(EPOCH FROM updated_at) * 1000)::bigint
);
`);
    return creatorProjectFromRow(JSON.parse(out || "null"));
}
function generatedProjectStageOutput(project, stage) {
    const outputs = project.outputs || {};
    const title = outputs.title?.ideas?.[0]?.title || outputs.title?.current || project.title;
    const niche = outputs.publishingPlan?.playlist || project.metadata?.video?.title || "faceless story";
    if (stage === "title") {
        return {
            current: outputs.title?.current || project.title,
            ideas: [
                { title: `${title}`.slice(0, 98), score: 91, reason: "Keeps the strongest current hook intact." },
                { title: `The ${niche} Moment Viewers Cannot Stop Rewatching`.slice(0, 98), score: 87, reason: "Connects the topic to repeat viewing and curiosity." },
                { title: `Everyone Missed Why This ${niche} Clip Took Off`.slice(0, 98), score: 84, reason: "Frames the upload as an explained insight." },
            ],
        };
    }
    if (stage === "seo") {
        return {
            description: `Watch this ${niche} video built around a clear curiosity hook, fast context, and a payoff viewers can understand quickly.\n\nSubscribe for more focused faceless YouTube stories, recaps, and high-retention content.`,
            tags: Array.from(new Set([niche, "faceless content", "story explained", "youtube shorts", "viral recap", "high retention"].map((tag) => String(tag).toLowerCase()))),
            actionCards: ["Match the first description line to the title promise.", "Add this video to a focused series playlist.", "Use the copied style keywords only when they truly match the clip."],
        };
    }
    if (stage === "script") {
        return {
            hook: outputs.title?.ideas?.[0]?.title || project.title,
            structure: ["Open with the exact conflict or reveal.", "Add one sentence of context.", "Escalate the stakes every 5-8 seconds.", "End with the payoff and a reason to watch the next upload."],
            draft: `Start with the moment that makes the viewer ask what happens next. Explain the context quickly, then build toward the reveal without adding filler.`,
        };
    }
    if (stage === "visualPlan") {
        return {
            direction: "Use full-frame 9:16 for Shorts and full-frame 16:9 for long-form. Keep every visual tied to the current script beat.",
            segments: ["Hook frame", "Context frame", "Escalation frame", "Payoff frame"],
            animation: "Subtle push-in only when the source frame is sharp enough.",
        };
    }
    if (stage === "thumbnail") {
        return {
            direction: "One focal subject, one emotional cue, one readable contrast decision.",
            prompts: [`${niche} thumbnail, expressive subject, clean contrast, YouTube-safe, no clutter`],
        };
    }
    if (stage === "publishingPlan") {
        return {
            playlist: niche,
            timing: "Publish in a repeatable test window and compare 24h views/hour before scaling.",
            checklist: ["Title promise is clear", "Description supports search intent", "Tags match niche/sub-niche", "Playlist selected", "Pinned comment prepared"],
        };
    }
    return outputs[stage] || { note: "Stage saved." };
}
async function updateCreatorProject(userId, projectId, input = {}) {
    const current = await getCreatorProject(userId, projectId);
    if (!current)
        throw new Error("Creator project not found");
    const metadata = { ...(current.metadata || {}), ...(input.metadata || {}) };
    const outputs = { ...(current.outputs || {}), ...(input.outputs || {}) };
    const status = String(input.status || current.status || "active");
    const archivedExpr = status === "archived" && !current.archivedAt ? "now()" : status !== "archived" ? "NULL" : "archived_at";
    const out = await runPsql(`
UPDATE creator_projects SET
  title = ${sqlString(input.title || current.title)},
  stage = ${sqlString(input.stage || current.stage || "overview")},
  style_id = ${input.styleId || current.styleId ? sqlString(input.styleId || current.styleId) : "NULL"},
  status = ${sqlString(status)},
  metadata = ${jsonbLiteral(metadata)},
  outputs = ${jsonbLiteral(outputs)},
  archived_at = ${archivedExpr},
  updated_at = now()
WHERE id = ${sqlString(projectId)} AND user_id = ${sqlString(userId)}
RETURNING json_build_object(
  'id', id,
  'sourceType', source_type,
  'sourceId', source_id,
  'title', title,
  'status', status,
  'stage', stage,
  'styleId', style_id,
  'metadata', metadata,
  'outputs', outputs,
  'archivedAt', FLOOR(EXTRACT(EPOCH FROM archived_at) * 1000)::bigint,
  'createdAt', FLOOR(EXTRACT(EPOCH FROM created_at) * 1000)::bigint,
  'updatedAt', FLOOR(EXTRACT(EPOCH FROM updated_at) * 1000)::bigint
);
`);
    return creatorProjectFromRow(JSON.parse(out || "null"));
}
async function generateCreatorProjectStage(userId, projectId, stage) {
    const cleanStage = String(stage || "").trim();
    const project = await getCreatorProject(userId, projectId);
    if (!project)
        throw new Error("Creator project not found");
    const output = generatedProjectStageOutput(project, cleanStage);
    return updateCreatorProject(userId, projectId, {
        stage: cleanStage,
        outputs: { [cleanStage]: output },
    });
}
function safeVideoTags(input) {
    const values = Array.isArray(input) ? input : String(input || "").split(",");
    const seen = new Set();
    return values
        .map((tag) => String(tag || "").replace(/^\s*\d+\s+/, "").replace(/^#+/, "").trim())
        .filter((tag) => tag && tag.length <= 100)
        .filter((tag) => {
        const key = tag.toLowerCase();
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    })
        .slice(0, 30);
}
async function updateYouTubeVideoMetadata(account, videoId, input = {}) {
    const cleanVideoId = String(videoId || "").trim();
    if (!cleanVideoId)
        throw new Error("Video ID is required");
    if (isZernioManagedAccount(account) && (String(account.accessToken || "") === "zernio" || !accountHasScope(account, "https://www.googleapis.com/auth/youtube.force-ssl"))) {
        if (!account.zernioApiKey || !account.zernioAccountId) {
            const error = new Error("This YouTube channel needs to be reconnected through Zernio to edit video metadata.");
            error.statusCode = 403;
            throw error;
        }
        const body = { platform: "youtube", videoId: cleanVideoId, accountId: account.zernioAccountId };
        if (input.title !== undefined)
            body.title = String(input.title || "").trim().slice(0, 100);
        if (input.description !== undefined)
            body.description = String(input.description ?? "");
        if (Array.isArray(input.tags) && input.tags.length)
            body.tags = safeVideoTags(input.tags);
        if (input.categoryId !== undefined)
            body.categoryId = String(input.categoryId);
        if (input.privacyStatus !== undefined)
            body.privacyStatus = String(input.privacyStatus);
        if (input.thumbnailUrl !== undefined)
            body.thumbnailUrl = String(input.thumbnailUrl);
        if (input.madeForKids !== undefined)
            body.madeForKids = Boolean(input.madeForKids);
        if (input.playlistId !== undefined)
            body.playlistId = String(input.playlistId);
        const response = await fetch("https://zernio.com/api/v1/posts/_/update-metadata", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${account.zernioApiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const message = data?.error || data?.message || `Zernio metadata update failed (${response.status})`;
            throw new Error(message);
        }
        return {
            id: cleanVideoId,
            snippet: {
                title: body.title,
                description: body.description,
                tags: body.tags,
                categoryId: body.categoryId,
            },
            zernio: data,
        };
    }
    requireYouTubeScope(account, "https://www.googleapis.com/auth/youtube.force-ssl", "YouTube metadata updates");
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
            tags: safeVideoTags(input.appendTags ? [...(snippet.tags || []), ...(input.tags || [])] : input.tags?.length ? input.tags : snippet.tags || []),
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
            await rebuildAllAutomationLearning(120).catch((error) => console.warn("Automation learning backfill skipped:", error instanceof Error ? error.message : error));
            if (postgresConfigured())
                console.log("Saved TikTok playlists database ready.");
        }
        catch (error) {
            console.warn("Saved playlist database is not ready:", error instanceof Error ? error.message : error);
        }
        if (postgresConfigured() && process.env.AUTOMATION_SCHEDULER_DISABLED !== "1") {
            const runSchedulers = () => {
                runDueAutomationAgents().catch((error) => console.warn("Automation scheduler failed:", error instanceof Error ? error.message : error));
                captureDueAutomationPerformance().catch((error) => console.warn("Automation performance scheduler failed:", error instanceof Error ? error.message : error));
            };
            runSchedulers();
            setInterval(runSchedulers, Math.min(Math.max(Number(process.env.AUTOMATION_POLL_INTERVAL_MS) || 10 * 60 * 1000, 60 * 1000), 60 * 60 * 1000));
        }
    }
    app.use(cors());
    app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "100mb" }));
    app.post("/api/rewrite", async (req, res) => {
        try {
            const text = String(req.body?.text || "").trim();
            if (!text)
                return res.status(400).json({ success: false, error: "No script text was provided." });
            const maxChars = Math.min(Math.max(Number(process.env.REWRITE_MAX_CHARS) || 120000, 1000), 300000);
            if (text.length > maxChars) {
                return res.status(413).json({ success: false, error: `Script is too long to rewrite in one request. Limit is ${maxChars.toLocaleString()} characters.` });
            }
            const rewrittenText = await rewriteScriptText(text);
            if (!rewrittenText)
                throw new Error("Rewrite provider returned an empty script.");
            res.json({ success: true, rewrittenText });
        }
        catch (error) {
            console.error("Rewrite failed:", error instanceof Error ? error.message : error);
            res.status(503).json({ success: false, error: error instanceof Error ? error.message : "Rewrite failed" });
        }
    });
    app.get("/api/voicebox/status", async (_req, res) => {
        try {
            const { data, base } = await voiceboxJson("/profiles", { method: "GET" });
            res.json({ online: true, baseUrl: base, profileCount: Array.isArray(data) ? data.length : 0 });
        }
        catch (error) {
            res.status(503).json({
                online: false,
                error: error instanceof Error ? error.message : "Voicebox is not reachable",
                candidates: voiceboxBaseCandidates(),
            });
        }
    });
    app.get("/api/voicebox/profiles", async (_req, res) => {
        try {
            const { data, base } = await voiceboxJson("/profiles", { method: "GET" });
            const profiles = Array.isArray(data) ? data.map(normalizeVoiceboxProfile).filter((profile) => profile.id) : [];
            res.json({ success: true, baseUrl: base, profiles });
        }
        catch (error) {
            res.status(503).json({ success: false, profiles: [], error: error instanceof Error ? error.message : "Voicebox profiles unavailable" });
        }
    });
    app.post("/api/voicebox/profiles", async (req, res) => {
        try {
            const name = String(req.body?.name || "").trim();
            if (!name)
                return res.status(400).json({ success: false, error: "Voice name is required." });
            const voiceType = String(req.body?.voiceType || req.body?.voice_type || "cloned").trim() || "cloned";
            const presetEngine = normalizeVoiceboxEngine(req.body?.presetEngine || req.body?.preset_engine || "");
            const defaultEngine = normalizeVoiceboxEngine(req.body?.defaultEngine || req.body?.default_engine || presetEngine || "");
            const payload = {
                name: name.slice(0, 100),
                description: String(req.body?.description || "").trim() || null,
                language: String(req.body?.language || "en").trim() || "en",
                voice_type: voiceType,
            };
            if (presetEngine)
                payload.preset_engine = presetEngine;
            if (req.body?.presetVoiceId || req.body?.preset_voice_id)
                payload.preset_voice_id = String(req.body?.presetVoiceId || req.body?.preset_voice_id || "").trim();
            if (defaultEngine)
                payload.default_engine = defaultEngine;
            if (req.body?.personality)
                payload.personality = String(req.body.personality).trim();
            const { data, base } = await voiceboxJson("/profiles", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            res.json({ success: true, baseUrl: base, profile: normalizeVoiceboxProfile(data) });
        }
        catch (error) {
            res.status(503).json({ success: false, error: error instanceof Error ? error.message : "Voice profile creation failed" });
        }
    });
    app.patch("/api/voicebox/profiles/:id", async (req, res) => {
        try {
            const profileId = String(req.params.id || "").trim();
            const name = String(req.body?.name || "").trim();
            if (!profileId)
                return res.status(400).json({ success: false, error: "Voice profile ID is required." });
            if (!name)
                return res.status(400).json({ success: false, error: "Voice name is required." });
            const payload = {
                name: name.slice(0, 100),
            };
            if (req.body?.description !== undefined)
                payload.description = String(req.body.description || "").trim() || null;
            let updated = null;
            let baseUrl = "";
            try {
                const { data, base } = await voiceboxJson(`/profiles/${encodeURIComponent(profileId)}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                });
                updated = data;
                baseUrl = base;
            }
            catch (patchError) {
                const { data, base } = await voiceboxJson(`/profiles/${encodeURIComponent(profileId)}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                });
                updated = data;
                baseUrl = base;
            }
            res.json({ success: true, baseUrl, profile: normalizeVoiceboxProfile(updated || { id: profileId, ...payload }) });
        }
        catch (error) {
            res.status(503).json({ success: false, error: error instanceof Error ? error.message : "Voice profile rename failed" });
        }
    });
    app.delete("/api/voicebox/profiles/:id", async (req, res) => {
        try {
            const profileId = String(req.params.id || "").trim();
            if (!profileId)
                return res.status(400).json({ success: false, error: "Voice profile ID is required." });
            const { data, base } = await voiceboxJson(`/profiles/${encodeURIComponent(profileId)}`, { method: "DELETE" });
            res.json({ success: true, baseUrl: base, deleted: true, profile: data || { id: profileId } });
        }
        catch (error) {
            res.status(503).json({ success: false, error: error instanceof Error ? error.message : "Voice profile deletion failed" });
        }
    });
    app.post("/api/voicebox/profiles/:id/samples", async (req, res) => {
        const tempFiles = [];
        try {
            const profileId = String(req.params.id || "").trim();
            let referenceText = String(req.body?.referenceText || req.body?.reference_text || "").trim();
            const audioBase64 = String(req.body?.audioBase64 || "").trim();
            const filename = String(req.body?.filename || "voice-sample.wav").replace(/[^\w.\-]+/g, "-").slice(0, 120);
            const mimeType = String(req.body?.mimeType || "audio/wav").trim();
            if (!profileId)
                return res.status(400).json({ success: false, error: "Voice profile ID is required." });
            if (!audioBase64)
                return res.status(400).json({ success: false, error: "Audio sample is required." });
            const audioBuffer = Buffer.from(audioBase64, "base64");
            if (!audioBuffer.length)
                return res.status(400).json({ success: false, error: "Audio sample is empty." });
            if (!referenceText) {
                const tmpDir = path.join(__dirname, "tmp");
                if (!fs.existsSync(tmpDir))
                    fs.mkdirSync(tmpDir, { recursive: true });
                const sampleId = crypto.randomBytes(16).toString("hex");
                const ext = path.extname(filename) || (mimeType.includes("mpeg") ? ".mp3" : mimeType.includes("mp4") ? ".m4a" : ".wav");
                const samplePath = path.join(tmpDir, `${sampleId}${ext}`);
                const normalizedAudioPath = path.join(tmpDir, `${sampleId}.wav`);
                fs.writeFileSync(samplePath, audioBuffer);
                tempFiles.push(samplePath, normalizedAudioPath);
                await extractAudioForTranscription(samplePath, normalizedAudioPath);
                const transcript = await runLocalWhisperTranscription(normalizedAudioPath);
                if (!transcript?.success || !String(transcript.text || "").trim()) {
                    throw new Error(transcript?.error || "Whisper could not detect reference speech in this voice sample.");
                }
                referenceText = String(transcript.text || "").trim();
            }
            const form = new globalThis.FormData();
            form.append("reference_text", referenceText);
            form.append("file", new Blob([audioBuffer], { type: mimeType }), filename);
            const { data, base } = await voiceboxJson(`/profiles/${encodeURIComponent(profileId)}/samples`, {
                method: "POST",
                body: form,
            });
            res.json({ success: true, baseUrl: base, sample: data, referenceText });
        }
        catch (error) {
            res.status(503).json({ success: false, error: error instanceof Error ? error.message : "Voice sample upload failed" });
        }
        finally {
            for (const file of tempFiles) {
                if (file && fs.existsSync(file)) {
                    try { fs.unlinkSync(file); } catch (_error) {}
                }
            }
        }
    });
    app.post("/api/voicebox/generate", async (req, res) => {
        try {
            const profileId = String(req.body?.profileId || req.body?.profile_id || "").trim();
            const text = String(req.body?.text || "").trim();
            if (!profileId)
                return res.status(400).json({ success: false, error: "Select a voice before generating audio." });
            if (!text)
                return res.status(400).json({ success: false, error: "Text is required." });
            const profile = await findVoiceboxProfile(profileId);
            if (profile?.voiceType === "cloned" && Number(profile.sampleCount || 0) <= 0) {
                return res.status(400).json({
                    success: false,
                    error: "This cloned voice has no usable voice sample yet. Re-create it from the Clone tab with a clear audio sample, then try again.",
                });
            }
            const payload = {
                profile_id: profileId,
                text: text.slice(0, 5000),
                language: String(req.body?.language || "en").trim() || "en",
                model_size: String(req.body?.modelSize || req.body?.model_size || "1.7B").trim() || "1.7B",
            };
            const engine = normalizeVoiceboxEngine(req.body?.engine || req.body?.defaultEngine || req.body?.default_engine || "");
            if (engine)
                payload.engine = engine;
            if (Number.isFinite(Number(req.body?.seed)))
                payload.seed = Number(req.body.seed);
            const { data, base } = await voiceboxJson("/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const id = String(data?.id || "");
            const waitForCompletion = req.body?.waitForCompletion !== false && req.body?.async !== true;
            if (!waitForCompletion) {
                return res.json({ success: true, pending: true, baseUrl: base, generation: data, audioUrl: id ? `/api/voicebox/audio/${encodeURIComponent(id)}` : "" });
            }
            const finished = id ? await waitForVoiceboxGeneration(id) : null;
            const generation = finished?.id ? finished : data;
            if (String(generation?.status || "").toLowerCase() === "failed")
                throw new Error(generation?.error || "Voicebox generation failed.");
            res.json({ success: true, baseUrl: base, generation, audioUrl: id ? `/api/voicebox/audio/${encodeURIComponent(id)}` : "" });
        }
        catch (error) {
            res.status(503).json({ success: false, error: error instanceof Error ? error.message : "Speech generation failed" });
        }
    });
    app.get("/api/voicebox/history/:id", async (req, res) => {
        try {
            const id = String(req.params.id || "").trim();
            if (!id)
                return res.status(400).json({ success: false, error: "Generation ID is required." });
            const { data, base } = await voiceboxJson(`/history/${encodeURIComponent(id)}`, { method: "GET" });
            res.json({ success: true, baseUrl: base, generation: data, audioUrl: `/api/voicebox/audio/${encodeURIComponent(id)}` });
        }
        catch (error) {
            res.status(503).json({ success: false, error: error instanceof Error ? error.message : "Voicebox generation status unavailable" });
        }
    });
    app.get("/api/voicebox/audio/:id", async (req, res) => {
        try {
            const id = String(req.params.id || "").trim();
            if (!id)
                return res.status(400).json({ error: "Generation ID is required." });
            const { response } = await voiceboxFetch(`/audio/${encodeURIComponent(id)}`, { method: "GET" });
            if (!response.ok)
                return res.status(response.status).json({ error: "Generated audio unavailable" });
            const audioBuffer = Buffer.from(await response.arrayBuffer());
            const size = audioBuffer.length;
            if (!size)
                return res.status(404).json({ error: "Generated audio is empty" });
            const contentType = response.headers.get("content-type") || "audio/wav";
            const disposition = response.headers.get("content-disposition") || `inline; filename="generation_${id}.wav"`;
            res.setHeader("Accept-Ranges", "bytes");
            res.setHeader("Content-Type", contentType);
            res.setHeader("Content-Disposition", disposition.replace(/^attachment/i, "inline"));
            res.setHeader("Cache-Control", "public, max-age=3600");
            const range = String(req.headers.range || "").trim();
            if (range) {
                const match = range.match(/^bytes=(\d*)-(\d*)$/);
                if (!match)
                    return res.status(416).setHeader("Content-Range", `bytes */${size}`).end();
                let start = match[1] ? Number(match[1]) : NaN;
                let end = match[2] ? Number(match[2]) : NaN;
                if (!Number.isFinite(start) && Number.isFinite(end)) {
                    start = Math.max(0, size - end);
                    end = size - 1;
                }
                if (Number.isFinite(start) && !Number.isFinite(end))
                    end = size - 1;
                if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) {
                    res.setHeader("Content-Range", `bytes */${size}`);
                    return res.status(416).end();
                }
                end = Math.min(end, size - 1);
                const chunk = audioBuffer.subarray(start, end + 1);
                res.status(206);
                res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
                res.setHeader("Content-Length", String(chunk.length));
                return res.end(chunk);
            }
            res.status(200);
            res.setHeader("Content-Length", String(size));
            res.end(audioBuffer);
        }
        catch (error) {
            res.status(503).json({ error: error instanceof Error ? error.message : "Generated audio unavailable" });
        }
    });
    const ALL_ZERNIO_KEYS = [
        "sk_d062b4f33ebd16a1a8419cb57e1e6e3da9981dba442b5da1dc39ef21908b2b86", // Key 1
        "sk_342e95a91a2befd763c508023962ecfe63f296bbbb93616cdc6ba200e3f03bc1", // Key 2
        "sk_98d06bd2c800bf9bafb9adef84e07a9601a163bfcba786b5068f36b0a4975d1b", // Key 3
        "sk_a23b6d9484d93bcd889db6bbc1432f8791e817e9d86a9bbbb237904708b7824d", // Key 4
        "sk_bce4b34db077631b5c210bb13520030dc7d1373928a29c6fc639560ae1334fa2", // Key 5
        "sk_d8832cbc168e7202f197f462c8e98c3dee32ca11fc4e08afb573cf7b5134ca3c", // Key 6
        "sk_77685af46a2e21c43d526ae020c86ff757a7b01aa3e79b912d559c2f582b3920"  // Key 7
    ];

    const ZERNIO_FREE_ACCOUNT_LIMIT = 2;
    async function zernioApiRequest(apiKey, path, options = {}) {
        const response = await fetch(`https://zernio.com/api/v1${path}`, {
            ...options,
            headers: {
                Authorization: `Bearer ${apiKey}`,
                ...(options.body ? { "Content-Type": "application/json" } : {}),
                ...(options.headers || {}),
            },
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data?.error || data?.message || `Zernio API request failed (${response.status})`);
        }
        return data;
    }
    async function listZernioAccounts(apiKey) {
        const data = await zernioApiRequest(apiKey, "/accounts");
        return Array.isArray(data.accounts) ? data.accounts : [];
    }
    function sameZernioPlatformIdentity(account, zernioAccount) {
        if (!account || !zernioAccount)
            return false;
        const localPlatform = String(account.platform || "").toLowerCase();
        const remotePlatform = String(zernioAccount.platform || "").toLowerCase();
        if (localPlatform && remotePlatform && localPlatform !== remotePlatform)
            return false;
        if (account.channelId && zernioAccount.platformUserId && String(account.channelId) === String(zernioAccount.platformUserId))
            return true;
        const localHandle = String(account.channelHandle || "").replace(/^@+/, "").trim().toLowerCase();
        const remoteHandle = String(zernioAccount.username || "").replace(/^@+/, "").trim().toLowerCase();
        return Boolean(localHandle && remoteHandle && localHandle === remoteHandle);
    }
    async function findExistingZernioConnection(account, expectedPlatform = "") {
        if (!account)
            return null;
        for (const key of ALL_ZERNIO_KEYS) {
            const accounts = await listZernioAccounts(key);
            const match = accounts.find((item) => {
                if (expectedPlatform && String(item.platform || "").toLowerCase() !== expectedPlatform)
                    return false;
                return sameZernioPlatformIdentity(account, item);
            });
            if (match)
                return { apiKey: key, account: match };
        }
        return null;
    }
    async function getZernioKeyWithFreeSlot() {
        const failures = [];
        for (const key of ALL_ZERNIO_KEYS) {
            try {
                const accounts = await listZernioAccounts(key);
                if (accounts.length < ZERNIO_FREE_ACCOUNT_LIMIT) {
                    return key;
                }
            }
            catch (error) {
                failures.push(error instanceof Error ? error.message : String(error));
            }
        }
        throw new Error(`No Zernio API key has a free account slot. ${failures.length ? failures.join("; ") : ""}`.trim());
    }
    async function createZernioConnectProfileId(apiKey, platform) {
        // A Zernio profile can hold platform accounts, but reconnecting the same platform
        // inside one profile can replace the previous account. Use a fresh profile per
        // OAuth connect so a key can safely hold multiple free accounts.
        const created = await zernioApiRequest(apiKey, "/profiles", {
            method: "POST",
            body: JSON.stringify({
                name: `AutoYT ${String(platform || "Account")} ${new Date().toISOString().slice(0, 19).replace("T", " ")}`,
                description: "AutoYT connected account",
            }),
        });
        const profileId = created?.profile?._id || created?._id;
        if (!profileId)
            throw new Error("Zernio profile creation did not return a profile id.");
        return profileId;
    }
    async function resolveZernioCallbackAccount(apiKey, req, platform) {
        const accountId = String(req.query.accountId || req.query.account_id || "").trim();
        if (!accountId)
            throw new Error("Zernio callback did not include accountId; reconnect the account and try again.");
        const accounts = await listZernioAccounts(apiKey);
        const account = accounts.find((item) => String(item?._id || "") === accountId);
        if (!account)
            throw new Error(`Zernio account ${accountId} was not found on the callback API key.`);
        if (String(account.platform || "").toLowerCase() !== platform)
            throw new Error(`Zernio callback returned a ${account.platform || "unknown"} account, expected ${platform}.`);
        return account;
    }

    app.get("/api/auth/session", async (req, res) => {
        try {
            res.json(await currentAuthPayload(req));
        }
        catch (error) {
            res.status(503).json({ user: null, accounts: [], activeAccount: null, googleConfigured: googleOAuthConfigured(), error: error instanceof Error ? error.message : "Auth unavailable" });
        }
    });
    app.get("/api/auth/google", async (req, res) => {
        const mode = String(req.query.mode || "signin") === "connect" ? "connect" : "signin";
        const provider = String(req.query.provider || "").trim().toLowerCase();
        if (mode === "connect" && provider !== "google") {
            try {
                if (!postgresConfigured())
                    throw new Error("Database is required for YouTube connection.");
                const session = await getSessionRecord(req);
                if (!session?.user) {
                    return res.status(401).send("Sign in before connecting a YouTube channel.");
                }

                const targetAccountId = String(req.query.accountId || "").trim();
                const targetAccount = targetAccountId ? await getYouTubeAccount(session.user.id, targetAccountId) : null;
                if (targetAccount?.zernioApiKey && targetAccount?.zernioAccountId)
                    throw new Error(`${targetAccount.channelTitle || targetAccount.channelHandle || "This YouTube channel"} is already connected to Zernio. Remove it from Zernio/AutoYT before reconnecting it.`);
                const existingZernio = targetAccount ? await findExistingZernioConnection(targetAccount, "youtube") : null;
                if (existingZernio)
                    throw new Error(`${targetAccount.channelTitle || targetAccount.channelHandle || "This YouTube channel"} is already connected to Zernio on another key. Remove that Zernio account before reconnecting it.`);
                const zernioApiKey = await getZernioKeyWithFreeSlot();
                const profileId = await createZernioConnectProfileId(zernioApiKey, "YouTube");

                // Get connect URL for YouTube from Zernio
                const redirectUrl = new URL(`${publicAppUrl(req)}/api/auth/youtube/callback`);
                redirectUrl.searchParams.set("zKey", zernioApiKey);
                if (targetAccount?.id)
                    redirectUrl.searchParams.set("targetAccountId", targetAccount.id);
                const redirectUri = redirectUrl.toString();
                const connectResponse = await fetch(`https://zernio.com/api/v1/connect/youtube?profileId=${profileId}&redirect_url=${encodeURIComponent(redirectUri)}`, {
                    headers: { "Authorization": `Bearer ${zernioApiKey}` }
                });
                if (!connectResponse.ok) {
                    throw new Error(`Failed to fetch YouTube connect URL from Zernio: ${connectResponse.statusText}`);
                }
                const connectData = await connectResponse.json();
                if (!connectData.authUrl) {
                    throw new Error("Failed to get YouTube authorization URL from Zernio");
                }
                return res.redirect(connectData.authUrl);
            }
            catch (error) {
                const message = encodeURIComponent(error instanceof Error ? error.message : "YouTube connection failed");
                return res.redirect(`/auth/error?message=${message}`);
            }
        }

        // Standard user sign-in using their own Google OAuth client
        if (!googleOAuthConfigured()) {
            return res.status(503).send("Google OAuth is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.");
        }
        const next = String(req.query.next || "/channels").startsWith("/") ? String(req.query.next || "/channels") : "/channels";
        const session = mode === "connect" ? await getSessionRecord(req) : null;
        const googleTargetAccountId = mode === "connect"
            ? String(req.query.accountId || session?.activeYoutubeAccountId || "").trim()
            : "";
        const state = makeOAuthState({ mode, next, provider, googleTargetAccountId });
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
                const targetId = String(state.googleTargetAccountId || "").trim();
                const selected = targetId
                    ? saved.find((item) => String(item?.id || "") === targetId)
                    : saved[0];
                if (targetId && !selected) {
                    throw new Error("Google did not return the YouTube channel you just connected through Zernio. Choose the matching Google account/channel and try again.");
                }
                if (selected?.id) {
                    await runPsql(`UPDATE auth_sessions SET active_youtube_account_id = ${sqlString(selected.id)}, updated_at = now() WHERE id = ${sqlString(session.id)};`);
                }
            }
            res.redirect(state.next || "/channels");
        }
        catch (error) {
            const message = encodeURIComponent(error instanceof Error ? error.message : "Google sign-in failed");
            res.redirect(`/auth/error?message=${message}`);
        }
    });

    app.get("/api/auth/tiktok", async (req, res) => {
        try {
            if (!postgresConfigured())
                throw new Error("Database is required for TikTok sign-in.");
            const session = await getSessionRecord(req);
            if (!session?.user) {
                return res.status(401).send("Sign in before connecting a TikTok account.");
            }

            const zernioApiKey = await getZernioKeyWithFreeSlot();
            const profileId = await createZernioConnectProfileId(zernioApiKey, "TikTok");

            // Get connect URL for TikTok from Zernio
            const redirectUri = `${publicAppUrl(req)}/api/auth/tiktok/callback?zKey=${zernioApiKey}`;
            const connectResponse = await fetch(`https://zernio.com/api/v1/connect/tiktok?profileId=${profileId}&redirect_url=${encodeURIComponent(redirectUri)}`, {
                headers: { "Authorization": `Bearer ${zernioApiKey}` }
            });
            if (!connectResponse.ok) {
                throw new Error(`Failed to fetch TikTok connect URL from Zernio: ${connectResponse.statusText}`);
            }
            const connectData = await connectResponse.json();
            if (!connectData.authUrl) {
                throw new Error("Failed to get TikTok authorization URL from Zernio");
            }
            res.redirect(connectData.authUrl);
        }
        catch (error) {
            const message = encodeURIComponent(error instanceof Error ? error.message : "TikTok connection failed");
            res.redirect(`/auth/error?message=${message}`);
        }
    });

    app.get("/api/auth/tiktok/callback", async (req, res) => {
        try {
            if (!postgresConfigured())
                throw new Error("Database is required for TikTok connection.");
            const session = await getSessionRecord(req);
            if (!session?.user) {
                return res.status(401).send("Unauthorized session.");
            }

            const zernioApiKey = String(req.query.zKey || "").trim() || await getZernioKeyWithFreeSlot();
            if (!zernioApiKey) {
                throw new Error("Zernio API key missing from TikTok callback.");
            }

            const zAcc = await resolveZernioCallbackAccount(zernioApiKey, req, "tiktok");
            const channelId = zAcc.platformUserId || zAcc._id;
            const accountId = `tta_${zAcc._id}`;
            await runPsql(`
UPDATE youtube_accounts
SET zernio_api_key = NULL, zernio_account_id = NULL, updated_at = now()
WHERE user_id = ${sqlString(session.user.id)}
  AND zernio_account_id = ${sqlString(zAcc._id)}
  AND channel_id <> ${sqlString(channelId)};
`);
            await runPsql(`
INSERT INTO youtube_accounts (
  id, user_id, google_sub, email, channel_id, channel_title, channel_handle, thumbnail_url,
  access_token, refresh_token, token_expires_at, scope, zernio_api_key, zernio_account_id, platform, connected_at, updated_at
) VALUES (
  ${sqlString(accountId)},
  ${sqlString(session.user.id)},
  'zernio',
  ${sqlString((zAcc.username || 'tiktok') + '@tiktok.zernio')},
  ${sqlString(channelId)},
  ${sqlString(zAcc.displayName || zAcc.username || 'TikTok Account')},
  ${sqlString('@' + (zAcc.username || 'tiktok'))},
  ${sqlString(zAcc.profilePicture || '')},
  'zernio',
  'zernio',
  now() + interval '10 years',
  'tiktok',
  ${sqlString(zernioApiKey)},
  ${sqlString(zAcc._id)},
  'tiktok',
  now(),
  now()
)
ON CONFLICT (user_id, channel_id) DO UPDATE SET
  channel_title = EXCLUDED.channel_title,
  channel_handle = EXCLUDED.channel_handle,
  thumbnail_url = EXCLUDED.thumbnail_url,
  zernio_api_key = EXCLUDED.zernio_api_key,
  zernio_account_id = EXCLUDED.zernio_account_id,
  platform = 'tiktok',
  updated_at = now();
`);
            await runPsql(`UPDATE auth_sessions SET active_youtube_account_id = ${sqlString(accountId)}, updated_at = now() WHERE id = ${sqlString(session.id)};`);
            res.redirect("/channels");
        }
        catch (error) {
            const message = encodeURIComponent(error instanceof Error ? error.message : "TikTok callback failed");
            res.redirect(`/auth/error?message=${message}`);
        }
    });

    app.get("/api/auth/youtube/callback", async (req, res) => {
        try {
            if (!postgresConfigured())
                throw new Error("Database is required for YouTube connection.");
            const session = await getSessionRecord(req);
            if (!session?.user) {
                return res.status(401).send("Unauthorized session.");
            }

            const zernioApiKey = String(req.query.zKey || "").trim() || await getZernioKeyWithFreeSlot();
            if (!zernioApiKey) {
                throw new Error("Zernio API key missing from YouTube callback.");
            }

            const zAcc = await resolveZernioCallbackAccount(zernioApiKey, req, "youtube");
            const channelId = zAcc.platformUserId || zAcc._id;
            const accountId = `yta_${crypto.createHash("sha256").update(`${session.user.id}:${channelId}`).digest("hex").slice(0, 24)}`;
            const targetAccountId = String(req.query.targetAccountId || "").trim();
            if (targetAccountId) {
                const targetAccount = await getYouTubeAccount(session.user.id, targetAccountId);
                if (!targetAccount)
                    throw new Error("The YouTube channel selected for reconnect no longer exists in AutoYT.");
                if (!sameZernioPlatformIdentity(targetAccount, zAcc))
                    throw new Error(`Zernio connected ${zAcc.displayName || zAcc.username || "a different channel"}, but you started reconnect for ${targetAccount.channelTitle || targetAccount.channelHandle}. Remove the existing Zernio connection and try again with the matching channel.`);
                if (targetAccount.zernioAccountId && targetAccount.zernioAccountId !== zAcc._id)
                    throw new Error(`${targetAccount.channelTitle || targetAccount.channelHandle || "This YouTube channel"} is already connected to a different Zernio account. Remove it before reconnecting.`);
            }
            await runPsql(`
UPDATE youtube_accounts
SET zernio_api_key = NULL, zernio_account_id = NULL, updated_at = now()
WHERE user_id = ${sqlString(session.user.id)}
  AND zernio_account_id = ${sqlString(zAcc._id)}
  AND channel_id <> ${sqlString(channelId)};
`);
            await runPsql(`
INSERT INTO youtube_accounts (
  id, user_id, google_sub, email, channel_id, channel_title, channel_handle, thumbnail_url,
  access_token, refresh_token, token_expires_at, scope, zernio_api_key, zernio_account_id, platform, connected_at, updated_at
) VALUES (
  ${sqlString(accountId)},
  ${sqlString(session.user.id)},
  'zernio',
  ${sqlString((zAcc.username || 'youtube') + '@youtube.zernio')},
  ${sqlString(channelId)},
  ${sqlString(zAcc.displayName || zAcc.username || 'YouTube Channel')},
  ${sqlString('@' + (zAcc.username || 'youtube'))},
  ${sqlString(zAcc.profilePicture || '')},
  'zernio',
  'zernio',
  now() + interval '10 years',
  'youtube',
  ${sqlString(zernioApiKey)},
  ${sqlString(zAcc._id)},
  'youtube',
  now(),
  now()
)
ON CONFLICT (user_id, channel_id) DO UPDATE SET
  channel_title = EXCLUDED.channel_title,
  channel_handle = EXCLUDED.channel_handle,
  thumbnail_url = EXCLUDED.thumbnail_url,
  zernio_api_key = EXCLUDED.zernio_api_key,
  zernio_account_id = EXCLUDED.zernio_account_id,
  platform = 'youtube',
  updated_at = now();
`);
            await runPsql(`UPDATE auth_sessions SET active_youtube_account_id = ${sqlString(accountId)}, updated_at = now() WHERE id = ${sqlString(session.id)};`);
            res.redirect("/channels");
        }
        catch (error) {
            const message = encodeURIComponent(error instanceof Error ? error.message : "YouTube callback failed");
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
                return res.status(404).json({ error: "Connect an account first" });
            let account = await usableYouTubeAccount(session.user.id, accountId);
            if (account.platform !== "tiktok" && String(account.refreshToken || "") !== "zernio" && Number(account.tokenExpiresAt || 0) < Date.now() + 60_000) {
                account = await refreshGoogleToken(account);
            }

            let dashboard;
            if (account.platform === "tiktok") {
                dashboard = await getConnectedTikTokDashboard(account, {
                    pageToken: String(req.query.pageToken || ""),
                    pageSize: Number(req.query.pageSize || 0),
                });
            } else {
                dashboard = await getConnectedYouTubeDashboard(account, {
                    pageToken: String(req.query.pageToken || ""),
                    videoKind: String(req.query.videoKind || ""),
                    pageSize: Number(req.query.pageSize || 0),
                });
            }

            const includeInsights = !["0", "false", "off"].includes(String(req.query.insights || "1").trim().toLowerCase());
            const growthInsights = includeInsights ? await getChannelGrowthInsights(session.user.id, account.id, account, dashboard).catch((error) => {
                console.warn("Channel growth insights unavailable:", error instanceof Error ? error.message : error);
                return null;
            }) : null;
            const feedInsights = includeInsights ? await upsertFeedInsightSeeds(session.user.id, account.id, dashboard, growthInsights).catch((error) => {
                console.warn("Feed insights unavailable:", error instanceof Error ? error.message : error);
                return [];
            }) : [];
            res.json({ ...dashboard, growthInsights, feedInsights });
        }
        catch (error) {
            res.status(500).json({ error: error instanceof Error ? error.message : "Dashboard unavailable" });
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
            if (account.platform === "tiktok") {
                return res.status(400).json({ error: "TikTok video metadata updates are managed via automated re-upload or Zernio's feed." });
            }
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
            if (account.platform === "tiktok") {
                return res.json({ playlists: [] });
            }
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
        let uploadInputFile = "";
        let preparedUploadFile = "";
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
            let uploadBody = req.body;
            let shortsTrim = null;
            const postAsShort = String(req.query.postAsShort || "false") === "true";
            if (postAsShort) {
                uploadInputFile = makeTikTokVideoCachePath();
                fs.writeFileSync(uploadInputFile, req.body);
                const preparedUpload = await prepareShortsUploadFile(uploadInputFile, { postAsShort: true }, { label: "channel_management_upload" });
                preparedUploadFile = preparedUpload.filePath;
                shortsTrim = preparedUpload.metrics;
                uploadBody = fs.readFileSync(preparedUploadFile);
            }
            const uploadContentType = postAsShort ? "video/mp4" : String(req.headers["content-type"] || "application/octet-stream");
            const result = await uploadYouTubeVideo(account, {
                title,
                description: String(req.query.description || ""),
                tags: safeYouTubeTags(req.query.tags),
                privacyStatus: safePrivacyStatus(req.query.privacyStatus),
                categoryId: String(req.query.categoryId || "22"),
                madeForKids: String(req.query.madeForKids || "false") === "true",
            }, uploadBody, uploadContentType);
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
            let automationUploadId = "";
            const postSlug = String(req.query.postSlug || "").trim();
            const playlistKey = String(req.query.playlistKey || "").trim();
            const sourceUrl = String(req.query.sourceUrl || "").trim();
            const savedAnalysis = postSlug ? await getSavedPostAnalysis(session.user.id, postSlug).catch(() => null) : null;
            const movie = savedAnalysis?.result || {};
            const agent = await findAutomationAgentForDirectUpload(session.user.id, account.id, playlistKey).catch(() => null);
            if (agent?.id && result.id) {
                automationUploadId = `upl_${crypto.randomUUID()}`;
                const movieGenres = officialGenresFromAutomationMovie(movie);
                const sourceVideo = savedAnalysis?.video || {};
                const sourceStats = sourceVideo?.stats || {};
                const metrics = {
                    directUpload: true,
                    movie,
                    movieGenres,
                    movieGenreSource: movie?.mal?.genres?.length ? "mal" : movie?.tmdb?.genres?.length ? "tmdb" : movieGenres.length ? "movie_id" : "",
                    sourceTitle: String(req.query.sourceTitle || sourceVideo.title || ""),
                    sourceStats,
                    sourceDurationSeconds: Number(sourceVideo.durationSeconds || sourceVideo.duration || 0) || 0,
                    sourceCreatedAt: sourceVideo.createdAt || sourceVideo.createTime || "",
                    postSlug,
                    playlistKey: normalizePlaylistListUrl(playlistKey),
                    shortsTrim,
                    uploadState: "complete",
                    taxonomy: extractContentTaxonomy(movie, {
                        title,
                        genre: movieGenres[0] || movie.genre || "",
                        microNiche: movie?.contentNiche?.microSubNiche || "",
                    }),
                    playlistItem,
                };
                await runPsql(`
INSERT INTO automation_uploads (
  id, agent_id, user_id, youtube_account_id, youtube_video_id, youtube_url, source_url, source_video_id, source_author,
  movie_key, movie_title, movie_year, genre, micro_niche, title, description, schedule_at, status, metrics, created_at, updated_at
)
VALUES (
  ${sqlString(automationUploadId)}, ${sqlString(agent.id)}, ${sqlString(session.user.id)}, ${sqlString(account.id)},
  ${sqlString(result.id)}, ${sqlString(result.url)}, ${sqlString(sourceUrl || sourceVideo.playUrl || sourceVideo.url || "")},
  ${sqlString(req.query.sourceVideoId || sourceVideo.id || "")}, ${sqlString(req.query.sourceAuthor || sourceVideo.authorHandle || sourceVideo.author || "")},
  ${sqlString(movieKeyFromResult(movie) || `direct-${result.id}`)}, ${sqlString(movie.title || "")}, ${sqlString(String(movie.year || "").match(/\d{4}/)?.[0] || "")},
  ${sqlString(movieGenres[0] || movie.genre || "")}, ${sqlString(movie?.contentNiche?.microSubNiche || "")}, ${sqlString(title)},
  ${sqlString(String(req.query.description || ""))}, NULL, ${sqlString("uploaded")}, ${jsonbLiteral(metrics)}, now(), now()
);
`);
                await recordAutomationLearningSignal(automationUploadId).catch((error) => console.warn("Direct upload learning signal skipped:", error instanceof Error ? error.message : error));
            }
            res.json({ video: { ...result, playlistItem, shortsTrim, automationUploadId } });
        }
        catch (error) {
            const status = Number(error?.statusCode || 500);
            res.status(status >= 400 && status < 600 ? status : 500).json({ error: error instanceof Error ? error.message : "Could not upload video" });
        }
        finally {
            for (const filePath of [preparedUploadFile, uploadInputFile]) {
                if (filePath) {
                    try {
                        fs.unlinkSync(filePath);
                    }
                    catch {
                        /* cache cleanup will catch it */
                    }
                }
            }
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
            res.json(await getYouTubeVideoAnalytics(session.user.id, account, req.params.id, Number(req.query.days || 28)));
        }
        catch (error) {
            const status = Number(error?.statusCode || 500);
            res.status(status >= 400 && status < 600 ? status : 500).json({ error: error instanceof Error ? error.message : "Video analytics unavailable" });
        }
    });
    app.get("/api/youtube/videos/:id/optimization", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            const accountId = String(req.query.accountId || session.activeYoutubeAccountId || "");
            if (!accountId)
                return res.status(404).json({ error: "Connect a YouTube channel first" });
            const account = await usableYouTubeAccount(session.user.id, accountId);
            res.json({ optimization: await getYouTubeVideoOptimization(session.user.id, account, req.params.id) });
        }
        catch (error) {
            const status = Number(error?.statusCode || 500);
            res.status(status >= 400 && status < 600 ? status : 500).json({ error: error instanceof Error ? error.message : "Video optimization unavailable" });
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
            res.json(await getYouTubeVideoComments(session.user.id, account, req.params.id, Number(req.query.maxResults || 20), String(req.query.pageToken || "")));
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
            if (account.platform === "tiktok") {
                return res.status(400).json({ error: "Replies not supported directly via API for TikTok accounts." });
            }
            const reply = await replyToYouTubeComment(account, req.params.id, req.body?.text, String(req.body?.videoId || req.query.videoId || ""));
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
            const account = await usableYouTubeAccount(session.user.id, accountId);
            if (account.platform === "tiktok") {
                return res.json({ scanned: [], replied: [], skipped: [] });
            }
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
                learning: await getAgentLearningProfile(agent.id),
            });
        }
        catch (error) {
            res.status(503).json({ error: error instanceof Error ? error.message : "Automation agent unavailable" });
        }
    });
    app.get("/api/automation/agents/:id/learning", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            const agent = await getAutomationAgent(session.user.id, req.params.id);
            if (!agent)
                return res.status(404).json({ error: "Automation agent not found" });
            await rebuildAgentLearningProfile(agent.id).catch(() => null);
            const observationsOut = await runPsql(`
SELECT COALESCE(json_agg(json_build_object(
  'microNiche', micro_niche,
  'uploads', uploads,
  'totalViews', total_views,
  'bestViews', best_views,
  'confidence', confidence,
  'status', status,
  'evidence', evidence
) ORDER BY total_views DESC), '[]'::json)
FROM agent_niche_observations
WHERE agent_id = ${sqlString(agent.id)};
`);
            res.json({ learning: await getAgentLearningProfile(agent.id), niches: JSON.parse(observationsOut || "[]") });
        }
        catch (error) {
            res.status(503).json({ error: error instanceof Error ? error.message : "Automation learning unavailable" });
        }
    });
    app.get("/api/automation/agents/:id/report", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            const agent = await getAutomationAgent(session.user.id, req.params.id);
            if (!agent)
                return res.status(404).json({ error: "Automation agent not found" });
            await rebuildAgentLearningProfile(agent.id).catch(() => null);
            res.json({ agentId: agent.id, report: await buildAgentPerformanceReport(agent.id) });
        }
        catch (error) {
            res.status(503).json({ error: error instanceof Error ? error.message : "Automation report unavailable" });
        }
    });
    app.get("/api/growth/insights", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            const accountId = String(req.query.accountId || session.activeYoutubeAccountId || "");
            if (!accountId)
                return res.status(404).json({ error: "Connect a YouTube channel first" });
            const account = await usableYouTubeAccount(session.user.id, accountId);
            const dashboard = await getConnectedYouTubeDashboard(account, { pageToken: "" }).catch(() => null);
            res.json({ growthInsights: await getChannelGrowthInsights(session.user.id, account.id, account, dashboard) });
        }
        catch (error) {
            res.status(503).json({ error: error instanceof Error ? error.message : "Growth insights unavailable" });
        }
    });
    app.get("/api/feed/insights", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            const accountId = String(req.query.accountId || session.activeYoutubeAccountId || "");
            if (!accountId)
                return res.status(404).json({ error: "Connect a YouTube channel first" });
            const account = await usableYouTubeAccount(session.user.id, accountId);
            const dashboard = await getConnectedYouTubeDashboard(account, { pageToken: "" }).catch(() => null);
            const growthInsights = dashboard ? await getChannelGrowthInsights(session.user.id, account.id, account, dashboard).catch(() => null) : null;
            if (dashboard)
                await upsertFeedInsightSeeds(session.user.id, account.id, dashboard, growthInsights).catch(() => null);
            res.json({ insights: await listFeedInsights(session.user.id, account.id, String(req.query.type || "All")) });
        }
        catch (error) {
            res.status(503).json({ error: error instanceof Error ? error.message : "Feed insights unavailable" });
        }
    });
    app.post("/api/feed/insights/:id/action", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            const action = String(req.body?.action || "done");
            const status = action === "dismiss" ? "dismissed" : action === "use" ? "used" : "done";
            await runPsql(`
UPDATE feed_insights
SET status = ${sqlString(status)},
    dismissed_at = ${status === "dismissed" ? "now()" : "dismissed_at"},
    updated_at = now()
WHERE id = ${sqlString(req.params.id)}
  AND user_id = ${sqlString(session.user.id)};
`);
            res.json({ ok: true, status });
        }
        catch (error) {
            res.status(503).json({ error: error instanceof Error ? error.message : "Could not update feed insight" });
        }
    });
    app.post("/api/competitors/youtube/discover", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            const accountId = String(req.body?.accountId || req.query.accountId || session.activeYoutubeAccountId || "");
            if (!accountId)
                return res.status(404).json({ error: "Connect a YouTube channel first" });
            const account = await usableYouTubeAccount(session.user.id, accountId);
            const dashboard = await getConnectedYouTubeDashboard(account, { pageToken: "" });
            const growthInsights = await getChannelGrowthInsights(session.user.id, account.id, account, dashboard).catch(() => null);
            const competitors = growthInsights?.youtubeCompetitors?.length ? growthInsights.youtubeCompetitors : await listYouTubeCompetitorChannels(account, dashboard, [], {});
            await saveTrackedYouTubeCompetitors(session.user.id, account.id, competitors);
            res.json({ competitors });
        }
        catch (error) {
            res.status(503).json({ error: error instanceof Error ? error.message : "YouTube competitor discovery unavailable" });
        }
    });
    app.get("/api/channel-styles", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            const accountId = String(req.query.accountId || session.activeYoutubeAccountId || "");
            if (!accountId)
                return res.status(404).json({ error: "Connect a YouTube channel first" });
            const account = await usableYouTubeAccount(session.user.id, accountId);
            res.json({ styles: await listChannelStyles(session.user.id, account.id) });
        }
        catch (error) {
            res.status(503).json({ error: error instanceof Error ? error.message : "Channel styles unavailable" });
        }
    });
    app.post("/api/channel-styles/copy", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            const accountId = String(req.body?.accountId || req.query.accountId || session.activeYoutubeAccountId || "");
            if (!accountId)
                return res.status(404).json({ error: "Connect a YouTube channel first" });
            const account = await usableYouTubeAccount(session.user.id, accountId);
            const style = await saveChannelStyle(session.user.id, account.id, req.body || {}, account);
            res.json({ style });
        }
        catch (error) {
            const status = Number(error?.statusCode || 503);
            res.status(status >= 400 && status < 600 ? status : 503).json({ error: error instanceof Error ? error.message : "Could not copy channel style" });
        }
    });
    app.get("/api/creator-projects", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            const accountId = String(req.query.accountId || session.activeYoutubeAccountId || "");
            if (!accountId)
                return res.status(404).json({ error: "Connect a YouTube channel first" });
            const account = await usableYouTubeAccount(session.user.id, accountId);
            res.json({ projects: await listCreatorProjects(session.user.id, account.id, String(req.query.sourceType || ""), String(req.query.sourceId || "")) });
        }
        catch (error) {
            res.status(503).json({ error: error instanceof Error ? error.message : "Creator projects unavailable" });
        }
    });
    app.post("/api/creator-projects", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            const accountId = String(req.body?.accountId || req.query.accountId || session.activeYoutubeAccountId || "");
            if (!accountId)
                return res.status(404).json({ error: "Connect a YouTube channel first" });
            const account = await usableYouTubeAccount(session.user.id, accountId);
            res.json({ project: await createCreatorProject(session.user.id, account.id, req.body || {}) });
        }
        catch (error) {
            res.status(503).json({ error: error instanceof Error ? error.message : "Could not create creator project" });
        }
    });
    app.patch("/api/creator-projects/:id", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            res.json({ project: await updateCreatorProject(session.user.id, req.params.id, req.body || {}) });
        }
        catch (error) {
            res.status(503).json({ error: error instanceof Error ? error.message : "Could not update creator project" });
        }
    });
    app.post("/api/creator-projects/:id/generate/:stage", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            res.json({ project: await generateCreatorProjectStage(session.user.id, req.params.id, req.params.stage) });
        }
        catch (error) {
            res.status(503).json({ error: error instanceof Error ? error.message : "Could not generate project stage" });
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
                const agent = await getAutomationAgent(session.user.id, req.params.id);
                if (!agent)
                    return res.status(404).json({ error: "Automation agent not found" });
                const catchUpPublishAt = await getManualCatchUpPublishAt(agent.id)
                    || sameDayAutomationCatchUpPublishAt(agent.settings || {});
                const result = await runAutomationAgentOnce(session.user.id, agent.id, { catchUpPublishAt });
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
                const agent = await getAutomationAgent(session.user.id, req.params.id);
                if (!agent)
                    return res.status(404).json({ error: "Automation agent not found" });
                const catchUpPublishAt = await getManualCatchUpPublishAt(agent.id);
                const result = await runAutomationCompilationOnce(session.user.id, agent.id, { ...(req.body || {}), catchUpPublishAt });
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
    app.post("/api/automation/uploads/:id/movie-id/correct", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            const result = await correctAutomationUploadMovieId(session.user.id, req.params.id, req.body || {});
            res.json(result);
        }
        catch (error) {
            const status = Number(error?.statusCode || 500);
            res.status(status >= 400 && status < 600 ? status : 500).json({ error: error instanceof Error ? error.message : "Movie ID correction failed" });
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
    app.get("/api/tiktok/covers/:file", (req, res) => {
        try {
            const fileName = path.basename(String(req.params.file || ""));
            if (!/^[a-f0-9]{32}\.(?:jpg|png|webp|gif)$/i.test(fileName)) {
                res.status(404).end();
                return;
            }
            const filePath = path.join(tikTokCoverCacheDir(), fileName);
            if (!fs.existsSync(filePath)) {
                res.status(404).end();
                return;
            }
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
            res.sendFile(filePath);
        }
        catch {
            res.status(404).end();
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
            let normalizedPlaylist = normalizeTikTokPlaylistForStorage(playlist);
            if (normalizedPlaylist?.videos?.length) {
                const savedRecord = await saveTikTokPlaylistToDb(session.user.id, url.trim(), playlist, url.trim()).catch((error) => {
                    console.error("TikTok auto-save error:", error);
                    return null;
                });
                normalizedPlaylist = savedRecord?.playlist || normalizedPlaylist;
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
    app.patch("/api/saved/tiktok-playlists/tags", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            const key = String(req.body?.key || "").trim();
            const record = await updateSavedPlaylistTags(session.user.id, key, req.body?.tags || []);
            res.json({ record, summary: savedPlaylistSummaryFromRecord(record) });
        }
        catch (error) {
            res.status(503).json({ error: error instanceof Error ? error.message : "Could not update saved source tags" });
        }
    });
    app.patch("/api/saved/tiktok-playlists/auto-tags", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            const key = String(req.body?.key || "").trim();
            const record = await addSavedPlaylistAutoTags(session.user.id, key, req.body?.tags || []);
            res.json({ record, summary: record ? savedPlaylistSummaryFromRecord(record) : null });
        }
        catch (error) {
            res.status(503).json({ error: error instanceof Error ? error.message : "Could not update saved source auto tags" });
        }
    });
    app.get("/api/saved/tiktok-post-analyses", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            const playlistKey = typeof req.query.playlistKey === "string" ? req.query.playlistKey : "";
            res.json({ analyses: await listSavedPostAnalyses(session.user.id, playlistKey) });
        }
        catch (error) {
            res.status(503).json({ error: error instanceof Error ? error.message : "Saved post analyses unavailable" });
        }
    });
    app.get("/api/saved/tiktok-post-analyses/:slug", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            res.json({ analysis: await getSavedPostAnalysis(session.user.id, req.params.slug) });
        }
        catch (error) {
            res.status(503).json({ error: error instanceof Error ? error.message : "Saved post analysis unavailable" });
        }
    });
    app.post("/api/saved/tiktok-post-analyses", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            res.json({ analysis: await saveSavedPostAnalysis(session.user.id, req.body || {}) });
        }
        catch (error) {
            const status = Number(error?.statusCode || 503);
            res.status(status >= 400 && status < 600 ? status : 503).json({ error: error instanceof Error ? error.message : "Could not save post analysis" });
        }
    });
    app.get("/api/saved/tiktok-playlists/genre-scan", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            const key = typeof req.query.key === "string" ? req.query.key : "";
            const slug = typeof req.query.slug === "string" ? req.query.slug : "";
            const record = key
                ? await getSavedPlaylistRecordByKey(session.user.id, key)
                : slug
                    ? await getSavedPlaylistRecordBySlug(session.user.id, slug)
                    : null;
            if (!record)
                return res.status(404).json({ error: "Saved playlist not found" });
            const state = await getSavedPlaylistGenreScanState(session.user.id, record.key || record.analyzedUrl);
            res.json({ scan: savedPlaylistGenreScanPayload(record, state) });
        }
        catch (error) {
            res.status(503).json({ error: error instanceof Error ? error.message : "Saved genre scan unavailable" });
        }
    });
    app.post("/api/saved/tiktok-playlists/genre-scan", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            const key = String(req.body?.key || "").trim();
            const slug = String(req.body?.slug || "").trim();
            const record = key
                ? await getSavedPlaylistRecordByKey(session.user.id, key)
                : slug
                    ? await getSavedPlaylistRecordBySlug(session.user.id, slug)
                    : null;
            if (!record)
                return res.status(404).json({ error: "Saved playlist not found" });
            res.json({ scan: await scanSavedPlaylistGenreBatch(session.user.id, record, { batchSize: req.body?.batchSize }) });
        }
        catch (error) {
            res.status(503).json({ error: error instanceof Error ? error.message : "Could not scan saved playlist genres" });
        }
    });
    app.post("/api/tiktok/comments/cache", async (req, res) => {
        try {
            if (!commentCachePushAuthorized(req))
                return res.status(401).json({ error: "Comment push token required" });
            const body = req.body && typeof req.body === "object" ? req.body : {};
            const threads = Array.isArray(body.threads) ? body.threads : [];
            const videoId = String(body.videoId || extractTikTokVideoIdFromUrl(body.url || "") || "").trim();
            if (!videoId || !threads.length)
                return res.status(400).json({ error: "videoId and threads are required" });
            const payload = {
                videoId,
                authorUniqueId: String(body.authorUniqueId || ""),
                title: String(body.title || body.videoTitle || "").slice(0, 240),
                videoTitle: String(body.videoTitle || body.title || "").slice(0, 240),
                threads,
                source: String(body.source || "local_comment_fetcher"),
                pushedAt: Date.now(),
            };
            await storeTikTokCommentCache(videoId, String(body.url || body.normalizedUrl || ""), payload);
            res.json({ ok: true, videoId, threadCount: threads.length });
        }
        catch (error) {
            res.status(503).json({ error: error instanceof Error ? error.message : "Could not store TikTok comment cache" });
        }
    });
    app.get("/api/saved/tiktok-playlists/movie-scan/pending", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            const key = String(req.query.key || "").trim();
            const slug = String(req.query.slug || "").trim();
            const record = key
                ? await getSavedPlaylistRecordByKey(session.user.id, key)
                : slug
                    ? await getSavedPlaylistRecordBySlug(session.user.id, slug)
                    : null;
            if (!record)
                return res.status(404).json({ error: "Saved playlist not found" });
            const pendingComments = await listPendingCommentCacheVideos(record);
            res.json({
                key: record.key || "",
                slug: record.slug || savedSlugForRecord(record),
                title: savedPlaylistDisplayTitle(record),
                pendingComments,
                pendingCount: pendingComments.length,
            });
        }
        catch (error) {
            res.status(503).json({ error: error instanceof Error ? error.message : "Could not list pending comment cache videos" });
        }
    });
    app.get("/api/saved/tiktok-playlists/movie-scan", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            const key = String(req.query.key || "").trim();
            const slug = String(req.query.slug || "").trim();
            const record = key
                ? await getSavedPlaylistRecordByKey(session.user.id, key)
                : slug
                    ? await getSavedPlaylistRecordBySlug(session.user.id, slug)
                    : null;
            if (!record)
                return res.status(404).json({ error: "Saved playlist not found" });
            const playlistKey = normalizePlaylistListUrl(record.key || record.analyzedUrl || "");
            const analyses = await listSavedPostAnalyses(session.user.id, playlistKey).catch(() => ({}));
            const videos = Array.isArray(record?.playlist?.videos) ? record.playlist.videos : [];
            res.json({
                scan: {
                    key: record.key || "",
                    slug: record.slug || savedSlugForRecord(record),
                    title: savedPlaylistDisplayTitle(record),
                    summary: savedPlaylistMovieScanSummary(videos, analyses),
                    pendingComments: await listPendingCommentCacheVideos(record),
                    analyses,
                },
            });
        }
        catch (error) {
            res.status(503).json({ error: error instanceof Error ? error.message : "Saved movie scan unavailable" });
        }
    });
    app.post("/api/saved/tiktok-playlists/movie-scan", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in required" });
            const key = String(req.body?.key || "").trim();
            const slug = String(req.body?.slug || "").trim();
            const record = key
                ? await getSavedPlaylistRecordByKey(session.user.id, key)
                : slug
                    ? await getSavedPlaylistRecordBySlug(session.user.id, slug)
                    : null;
            if (!record)
                return res.status(404).json({ error: "Saved playlist not found" });
            res.json({
                scan: await scanSavedPlaylistMovieBatch(session.user.id, record, {
                    batchSize: req.body?.batchSize,
                    slug: req.body?.slug,
                    slugs: req.body?.slugs,
                    geminiFallback: req.body?.geminiFallback !== false,
                    skipMovieCache: req.body?.skipMovieCache === true,
                }),
            });
        }
        catch (error) {
            res.status(503).json({ error: error instanceof Error ? error.message : "Could not scan saved playlist movies" });
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
        const skipCache = req.body?.skipCache === true || req.body?.forceRefresh === true;
        const commentsOnly = req.body?.commentsOnly === true || req.body?.geminiFallback === false;
        if (!skipCache) {
            const cached = await getCachedMovieIdentification(cacheLookup).catch(() => null);
            if (cached) {
                res.json({
                    result: attachMovieIdentificationSource(cached, "movie-cache"),
                    downloader: "movie-cache",
                    size: 0,
                    cached: true,
                });
                return;
            }
        }
        if (commentsOnly) {
            return res.status(400).json({ error: "Comment-only Movie ID is disabled. Use video analysis instead." });
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
            const result = await identifyMovieFromVideoFile(downloadedFile, "video/mp4", { ...cacheLookup, skipCommentLookup: true });
            res.json({
                result: attachMovieIdentificationSource(result, downloader),
                downloader,
                size: stat.size,
            });
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
    app.post("/api/movie/identify-file", express.raw({ type: ["application/octet-stream", "video/*"], limit: process.env.MOVIE_ID_UPLOAD_LIMIT || process.env.YOUTUBE_UPLOAD_LIMIT || "512mb" }), async (req, res) => {
        const tempFile = makeLinkAnalysisVideoPath();
        try {
            if (!Buffer.isBuffer(req.body) || !req.body.length)
                return res.status(400).json({ error: "Video file is required." });
            fs.writeFileSync(tempFile, req.body);
            const downloadedFile = resolveDownloadedOutput(tempFile);
            const stat = fs.statSync(downloadedFile);
            const maxBytes = tikTokDownloadMaxBytes();
            if (stat.size > maxBytes) {
                throw new Error(`Uploaded video is too large (${Math.round(stat.size / 1024 / 1024)}MB; limit ${Math.round(maxBytes / 1024 / 1024)}MB).`);
            }
            const mimeType = String(req.headers["content-type"] || "video/mp4");
            const result = await identifyMovieFromVideoFile(downloadedFile, mimeType);
            res.json({ result, downloader: "browser-upload", size: stat.size });
        }
        catch (error) {
            console.error("Movie file analysis error:", error);
            res.status(500).json({
                error: "Could not identify movie from uploaded file.",
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

    app.post("/api/transcribe", express.json(), async (req, res) => {
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: "Missing url parameter" });

        const tmpDir = path.join(__dirname, "tmp");
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

        const videoId = crypto.randomBytes(16).toString("hex");
        const outputPath = path.join(tmpDir, `${videoId}.mp4`);
        const audioPath = path.join(tmpDir, `${videoId}.wav`);

        try {
            const downloader = await downloadMediaForTranscription(url, outputPath);
            await extractAudioForTranscription(outputPath, audioPath);

            const result = await runLocalWhisperTranscription(audioPath);

            if (!result.success) {
                throw new Error(result.error);
            }

            res.json({ success: true, text: result.text, downloader });
        } catch (error) {
            console.error("Transcription error:", error);
            res.status(500).json({ error: error.message || "Transcription failed" });
        } finally {
            if (fs.existsSync(outputPath)) {
                try { fs.unlinkSync(outputPath); } catch (e) {}
            }
            if (fs.existsSync(audioPath)) {
                try { fs.unlinkSync(audioPath); } catch (e) {}
            }
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
        app.get("/tts", serveDevIndex);
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
    process.on("SIGINT", () => {
        shutdownTikTokCommentDaemon().finally(() => process.exit(0));
    });
    process.on("SIGTERM", () => {
        shutdownTikTokCommentDaemon().finally(() => process.exit(0));
    });
    startServer();
}
