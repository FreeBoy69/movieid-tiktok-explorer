import { SystemBars, SystemBarsStyle } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { Keyboard } from "@capacitor/keyboard";
import { SplashScreen } from "@capacitor/splash-screen";
import { messageOf, toast } from "../utils/toast";
import { AuthCancelled, isAuthInFlight, isAuthStartHref, resumeNativeAuth, startNativeAuth } from "./auth";
import { isDownloadLink, saveToDevice } from "./downloads";
import { nativePlatform } from "./platform";
// The app shell's own styles (safe areas, header, dock). Imported here, with the shell, so they ship
// with every build: they used to ride along with the old native tab bar and vanished when it went.
import "./native.css";

let installed = false;

/** Wires the web app into the iOS/Android shell. A no-op in browsers. */
export function installNativeShell(): void {
  const platform = nativePlatform();
  if (!platform || installed) return;
  installed = true;
  const root = document.documentElement;
  root.dataset.native = platform;
  ensureViewportCover();

  syncSystemBars();
  new MutationObserver(syncSystemBars).observe(root, { attributes: true, attributeFilter: ["data-theme"] });

  document.addEventListener("click", onDocumentClick, true);
  patchAnchorClick();
  startPendingAuth();

  App.addListener("backButton", onBackButton).catch(() => {});
  App.addListener("appUrlOpen", ({ url }) => routeDeepLink(url)).catch(() => {});
  App.getLaunchUrl().then((launch) => { if (launch?.url) routeDeepLink(launch.url); }).catch(() => {});
  // iOS posts this when the status bar is tapped: scroll back to the top like UIKit does.
  window.addEventListener("statusTap", () => window.scrollTo({ top: 0, behavior: "smooth" }));

  Keyboard.addListener("keyboardWillShow", () => { root.dataset.keyboard = "open"; }).catch(() => {});
  Keyboard.addListener("keyboardWillHide", () => { delete root.dataset.keyboard; }).catch(() => {});
}

/** Called once the first screen has rendered. */
export function nativeAppReady(): void {
  if (!nativePlatform()) return;
  SplashScreen.hide({ fadeOutDuration: 200 }).catch(() => {});
}

export function tapFeedback(): void {
  if (!nativePlatform()) return;
  Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
}

/** In-app navigation that the router in App.tsx picks up through popstate. */
export function navigateInApp(path: string): void {
  if (window.location.pathname + window.location.search === path) {
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo({ top: 0 });
}

function ensureViewportCover(): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  // Native apps do not pinch-zoom, and this stops iOS zooming into small form fields.
  if (meta) meta.content = "width=device-width, initial-scale=1.0, maximum-scale=1, viewport-fit=cover";
}

function syncSystemBars(): void {
  const light = document.documentElement.dataset.theme === "light";
  // Style.Dark means light icons for a dark background.
  SystemBars.setStyle({ style: light ? SystemBarsStyle.Light : SystemBarsStyle.Dark }).catch(() => {});
}

function runAuth(href: string): void {
  tapFeedback();
  startNativeAuth(href).catch((error) => {
    if (error instanceof AuthCancelled) return;
    toast.error(messageOf(error), { title: "Sign-in failed" });
  });
}

function runDownload(href: string, name: string | null): void {
  tapFeedback();
  const preparing = toast.info("Preparing your file…", { title: "Saving", duration: 120_000 });
  saveToDevice(href, name)
    .catch((error) => {
      // Dismissing the share sheet is not a failure.
      if (/cancel/i.test(messageOf(error))) return;
      toast.error(messageOf(error), { title: "Couldn't save the file" });
    })
    .finally(() => toast.dismiss(preparing));
}

/** Returns true when the link was handled natively. */
function handleAnchor(anchor: HTMLAnchorElement): boolean {
  const href = anchor.href;
  if (!href) return false;
  if (isAuthStartHref(href)) {
    runAuth(href);
    return true;
  }
  if (isDownloadLink(anchor)) {
    runDownload(href, anchor.getAttribute("download"));
    return true;
  }
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  if ((url.protocol === "https:" || url.protocol === "http:") && url.origin !== window.location.origin) {
    // External sites open in the in-app browser instead of replacing the app.
    Browser.open({ url: href, presentationStyle: "popover" }).catch(() => {});
    return true;
  }
  return false;
}

function onDocumentClick(event: MouseEvent): void {
  if (event.button !== 0 || event.defaultPrevented) return;
  const anchor = (event.target as Element | null)?.closest?.("a");
  if (!anchor || !(anchor instanceof HTMLAnchorElement)) return;
  if (handleAnchor(anchor)) {
    event.preventDefault();
    event.stopPropagation();
  }
}

// Downloads are often triggered with a detached `a.click()`, which never reaches
// the document listener.
function patchAnchorClick(): void {
  const original = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function patchedClick(this: HTMLAnchorElement) {
    if (handleAnchor(this)) return;
    original.call(this);
  };
}

// The server bounces WebView navigations to auth URLs back here with
// ?native_auth=<path> (server/nativeApp.js) so they run in the system browser.
function startPendingAuth(): void {
  const url = new URL(window.location.href);
  const target = url.searchParams.get("native_auth");
  if (!target) return;
  url.searchParams.delete("native_auth");
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  if (isAuthStartHref(target)) runAuth(target);
}

function routeDeepLink(raw: string): void {
  if (raw.startsWith("autoyt://auth")) {
    if (isAuthInFlight()) return;
    resumeNativeAuth(raw).catch((error) => toast.error(messageOf(error), { title: "Sign-in failed" }));
    return;
  }
  try {
    const url = new URL(raw);
    // autoyt://open/channels and https://autoyt.cc/channels both land on /channels.
    const path = url.protocol === "autoyt:" ? `/${url.pathname.replace(/^\/+/, "")}${url.search}` : url.pathname + url.search;
    if (url.protocol === "autoyt:" && url.hostname !== "open") return;
    if (url.protocol !== "autoyt:" && url.origin !== window.location.origin) return;
    navigateInApp(path || "/");
  } catch {
    /* ignore malformed links */
  }
}

function hasOpenOverlay(): boolean {
  return Boolean(document.querySelector('[aria-modal="true"], [role="dialog"], .ah-overlay'));
}

// Android Back: close the top sheet or dialog first, then go back, then leave.
function onBackButton({ canGoBack }: { canGoBack: boolean }): void {
  if (hasOpenOverlay()) {
    const escape = { key: "Escape", code: "Escape", bubbles: true, cancelable: true };
    (document.activeElement || document.body).dispatchEvent(new KeyboardEvent("keydown", escape));
    return;
  }
  if (canGoBack && window.history.length > 1) {
    window.history.back();
    return;
  }
  App.minimizeApp().catch(() => {});
}
