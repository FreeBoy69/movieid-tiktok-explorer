import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

// WKWebView and Android WebView ignore <a download>, so exports are written to
// the app cache and handed to the share sheet ("Save Video", Files, Drive, …).
const CHUNK_BYTES = 2 * 1024 * 1024;

/** True for links that should save a file rather than navigate. */
export function isDownloadLink(anchor: HTMLAnchorElement): boolean {
  if (anchor.hasAttribute("download")) return true;
  const href = anchor.getAttribute("href") || "";
  return /[?&]download=1(?:&|$)/.test(href)
    || /\/download(?:\/|\?|$)/.test(href)
    || /\.(?:zip|srt|vtt)(?:\?|$)/i.test(href);
}

function safeName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/^\.+/, "").trim();
  return cleaned.slice(0, 120) || "autoyt-export";
}

function nameFromResponse(response: Response, url: string, suggested?: string | null): string {
  if (suggested && suggested !== "true" && suggested.trim()) return safeName(suggested);
  const disposition = response.headers.get("content-disposition") || "";
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (star) return safeName(decodeURIComponent(star[1]));
  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  if (plain) return safeName(plain[1]);
  try {
    const last = new URL(url, window.location.href).pathname.split("/").filter(Boolean).pop();
    if (last && /\.[a-z0-9]{2,5}$/i.test(last)) return safeName(decodeURIComponent(last));
  } catch {
    /* blob: and data: URLs have no useful path */
  }
  const type = (response.headers.get("content-type") || "").split(";")[0];
  const ext = ({ "video/mp4": "mp4", "audio/mpeg": "mp3", "audio/wav": "wav", "image/png": "png", "image/jpeg": "jpg", "application/zip": "zip", "text/plain": "txt" } as Record<string, string>)[type];
  return `autoyt-export${ext ? `.${ext}` : ""}`;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function concat(parts: Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Streams a same-origin, blob:, or data: URL into the cache and opens the share sheet. */
export async function saveToDevice(url: string, suggestedName?: string | null): Promise<void> {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const name = nameFromResponse(response, url, suggestedName);
  const path = `exports/${Date.now()}-${name}`;
  let started = false;
  const write = async (bytes: Uint8Array) => {
    const data = toBase64(bytes);
    if (!started) {
      await Filesystem.writeFile({ path, data, directory: Directory.Cache, recursive: true });
      started = true;
    } else {
      await Filesystem.appendFile({ path, data, directory: Directory.Cache });
    }
  };
  const reader = response.body?.getReader();
  if (!reader) {
    await write(new Uint8Array(await response.arrayBuffer()));
  } else {
    let parts: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (value) {
        parts.push(value);
        size += value.length;
      }
      if (size >= CHUNK_BYTES || (done && size > 0)) {
        await write(concat(parts, size));
        parts = [];
        size = 0;
      }
      if (done) break;
    }
    if (!started) await write(new Uint8Array());
  }
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
  await Share.share({ title: name, files: [uri] });
}
