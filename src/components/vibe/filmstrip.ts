// Filmstrip thumbnails for timeline clips: frames grabbed once per video by
// seeking a hidden element, drawn small, and cached by URL. Grabs run one at a
// time so a long project never decodes several videos at once.
import { useEffect, useState } from "react";

export interface Filmstrip {
  /** Seconds between frames. */
  step: number;
  frames: string[];
  aspect: number;
}

const cache = new Map<string, Promise<Filmstrip | null>>();
let queue: Promise<unknown> = Promise.resolve();
const THUMB_H = 72;

function grab(url: string, duration: number): Promise<Filmstrip | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.crossOrigin = "anonymous";
    video.playsInline = true;
    const frames: string[] = [];
    const count = Math.max(2, Math.min(48, Math.ceil(duration / 1.5)));
    const step = duration / count;
    let i = 0;
    let canvas: HTMLCanvasElement | null = null;
    let watchdog = 0;
    // Some browsers only decode attached media; keep it in the page, unseen.
    video.style.cssText = "position:fixed;left:-10000px;top:0;width:160px;height:90px;opacity:0;pointer-events:none";
    document.body.appendChild(video);
    const done = (value: Filmstrip | null) => {
      window.clearTimeout(watchdog);
      video.removeAttribute("src");
      video.load();
      video.remove();
      resolve(value);
    };
    const seek = (t: number) => {
      window.clearTimeout(watchdog);
      // A seek that never lands (a broken keyframe) is skipped, not waited on.
      watchdog = window.setTimeout(() => {
        // Hold the previous frame in this slot so later frames keep their times.
        frames.push(frames[frames.length - 1] || "");
        i += 1;
        if (i >= count) done(frames.some(Boolean) ? { step, frames, aspect: canvas ? canvas.width / canvas.height : 16 / 9 } : null);
        else seek(Math.min(duration - 0.05, step * i + step / 2));
      }, 4000);
      video.currentTime = t;
    };
    const fail = () => done(frames.length ? { step, frames, aspect: canvas ? canvas.width / canvas.height : 16 / 9 } : null);
    const timer = window.setTimeout(fail, 45000);
    video.onerror = () => {
      window.clearTimeout(timer);
      fail();
    };
    video.onloadeddata = () => {
      const aspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9;
      canvas = document.createElement("canvas");
      canvas.height = THUMB_H;
      canvas.width = Math.round(THUMB_H * aspect);
      seek(Math.min(duration - 0.05, step / 2));
    };
    video.onseeked = () => {
      const ctx = canvas?.getContext("2d");
      if (!ctx || !canvas) return fail();
      try {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        frames.push(canvas.toDataURL("image/jpeg", 0.6));
      } catch {
        window.clearTimeout(timer);
        return fail();
      }
      i += 1;
      if (i >= count) {
        window.clearTimeout(timer);
        return done({ step, frames, aspect: canvas.width / canvas.height });
      }
      seek(Math.min(duration - 0.05, step * i + step / 2));
    };
    video.src = url;
  });
}

export function filmstripFor(url: string, duration: number): Promise<Filmstrip | null> {
  if (!cache.has(url)) {
    const job = queue.then(() => grab(url, Math.max(0.5, duration)));
    queue = job.catch(() => null);
    cache.set(url, job);
  }
  return cache.get(url)!;
}

export function useFilmstrip(url: string | undefined, duration: number | undefined) {
  const [strip, setStrip] = useState<Filmstrip | null>(null);
  useEffect(() => {
    if (!url || !duration) return;
    let live = true;
    void filmstripFor(url, duration).then((s) => live && setStrip(s));
    return () => {
      live = false;
    };
  }, [url, duration]);
  return strip;
}
