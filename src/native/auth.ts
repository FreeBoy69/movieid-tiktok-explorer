import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { nativePlatform } from "./platform";

// Implemented in ios/App/App/NativeAuthPlugin.swift. Android uses Custom Tabs
// (@capacitor/browser) and the autoyt:// intent filter instead.
interface NativeAuthPlugin {
  openAuthSession(options: { url: string; callbackScheme: string }): Promise<{ url: string }>;
  signInWithApple(options: { nonce?: string }): Promise<{ identityToken: string; user: string; email: string; name: string }>;
}
const NativeAuth = registerPlugin<NativeAuthPlugin>("NativeAuth");

const CALLBACK_SCHEME = "autoyt";
const PENDING_KEY = "autoyt-native-auth";
const AUTH_START = /^\/api\/auth\/(?:google|tiktok|social\/[a-z]+)$/;

let inFlight = false;

/** A flow started in this session owns its deep link; the global handler skips it. */
export function isAuthInFlight(): boolean {
  return inFlight;
}

export class AuthCancelled extends Error {
  constructor() {
    super("Sign-in was cancelled");
  }
}

/** True for same-origin links that start a sign-in or account connection. */
export function isAuthStartHref(href: string): boolean {
  try {
    const url = new URL(href, window.location.origin);
    return url.origin === window.location.origin && AUTH_START.test(url.pathname);
  } catch {
    return false;
  }
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomVerifier(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `Request failed (${response.status})`);
  return data as T;
}

/** Android: open a Custom Tab and wait for the autoyt://auth deep link. */
function openInCustomTab(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const handles: Promise<PluginListenerHandle>[] = [];
    let settled = false;
    let closedTimer: number | undefined;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(closedTimer);
      handles.forEach((handle) => handle.then((h) => h.remove()).catch(() => {}));
      fn();
    };
    handles.push(App.addListener("appUrlOpen", ({ url: opened }) => {
      if (!opened.startsWith(`${CALLBACK_SCHEME}://auth`)) return;
      Browser.close().catch(() => {});
      finish(() => resolve(opened));
    }));
    // The tab closes both when the user backs out and when the deep link
    // brings the app forward; give the deep link a moment to arrive first.
    handles.push(Browser.addListener("browserFinished", () => {
      closedTimer = window.setTimeout(() => finish(() => reject(new AuthCancelled())), 1500);
    }));
    Browser.open({ url, presentationStyle: "fullscreen" }).catch((error) => finish(() => reject(error)));
  });
}

async function completeFromCallback(callbackUrl: string, verifier: string): Promise<void> {
  const params = new URL(callbackUrl.replace(/^autoyt:\/\//, "https://autoyt.invalid/")).searchParams;
  const error = params.get("error");
  if (error) throw new Error(error);
  const code = params.get("code");
  if (!code) throw new Error("Sign-in did not finish. Try again.");
  const { next } = await postJson<{ next: string }>("/api/auth/native/exchange", { code, verifier });
  window.localStorage.removeItem(PENDING_KEY);
  // A full load refreshes the session everywhere in the app.
  window.location.assign(next || "/");
}

/**
 * Runs a Google, YouTube, TikTok, or social sign-in in the system browser and
 * brings the resulting session back into the app (server/nativeApp.js).
 */
export async function startNativeAuth(href: string): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    await runNativeAuth(href);
  } finally {
    inFlight = false;
  }
}

async function runNativeAuth(href: string): Promise<void> {
  const target = new URL(href, window.location.origin);
  const verifier = randomVerifier();
  const challenge = base64Url(await sha256(verifier));
  const { url } = await postJson<{ url: string }>("/api/auth/native/ticket", { challenge, to: target.pathname + target.search });
  // Survives Android killing the app while the browser is in front.
  window.localStorage.setItem(PENDING_KEY, JSON.stringify({ verifier, at: Date.now() }));
  let callbackUrl: string;
  if (nativePlatform() === "ios") {
    try {
      callbackUrl = (await NativeAuth.openAuthSession({ url, callbackScheme: CALLBACK_SCHEME })).url;
    } catch (error) {
      if ((error as { code?: string })?.code === "CANCELLED") throw new AuthCancelled();
      throw error;
    }
  } else {
    callbackUrl = await openInCustomTab(url);
  }
  await completeFromCallback(callbackUrl, verifier);
}

/** Finishes a sign-in whose deep link relaunched the app (Android cold start). */
export async function resumeNativeAuth(callbackUrl: string): Promise<boolean> {
  if (!callbackUrl.startsWith(`${CALLBACK_SCHEME}://auth`)) return false;
  const pending = JSON.parse(window.localStorage.getItem(PENDING_KEY) || "null") as { verifier: string; at: number } | null;
  if (!pending || Date.now() - pending.at > 15 * 60 * 1000) return false;
  await completeFromCallback(callbackUrl, pending.verifier);
  return true;
}

export async function signInWithApple(next: string): Promise<void> {
  const nonce = randomVerifier();
  const hashed = Array.from(await sha256(nonce), (byte) => byte.toString(16).padStart(2, "0")).join("");
  let result: Awaited<ReturnType<NativeAuthPlugin["signInWithApple"]>>;
  try {
    result = await NativeAuth.signInWithApple({ nonce: hashed });
  } catch (error) {
    if ((error as { code?: string })?.code === "CANCELLED") throw new AuthCancelled();
    throw error;
  }
  await postJson("/api/auth/apple/native", { identityToken: result.identityToken, nonce, name: result.name });
  window.location.assign(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}
