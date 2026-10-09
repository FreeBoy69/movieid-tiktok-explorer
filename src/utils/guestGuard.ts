// Signed-out visitors use the real tool pages. Anything that would act (generate, upload,
// save: every non-GET call to /api) opens sign-in instead of running.
import { GUEST_SIGN_IN_MESSAGE } from "./toast";

const OPEN = /^\/api\/(auth|session)\b/;
const READ = new Set(["GET", "HEAD", "OPTIONS"]);

function apiPath(input: RequestInfo | URL): string | null {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) return null;
    return url.pathname;
  } catch {
    return null;
  }
}

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export function installGuestGuard(onSignIn: () => void): () => void {
  const original = window.fetch;
  window.fetch = async function guestFetch(input: RequestInfo | URL, init?: RequestInit) {
    const path = apiPath(input);
    if (!path || OPEN.test(path)) return original.call(window, input, init);
    const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (!READ.has(method)) {
      onSignIn();
      return json({ error: GUEST_SIGN_IN_MESSAGE }, 401);
    }
    // Reads go through untouched: pages already handle a read that needs an account.
    return original.call(window, input, init);
  } as typeof window.fetch;

  // Uploads with progress use XMLHttpRequest: same rule.
  const proto = XMLHttpRequest.prototype;
  const open = proto.open;
  const send = proto.send;
  proto.open = function guestOpen(this: XMLHttpRequest & { __guestBlock?: boolean }, method: string, url: string | URL, ...rest: unknown[]) {
    const path = apiPath(url);
    this.__guestBlock = Boolean(path && !OPEN.test(path) && !READ.has(String(method).toUpperCase()));
    return (open as (...args: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof proto.open;
  proto.send = function guestSend(this: XMLHttpRequest & { __guestBlock?: boolean }, body?: Document | XMLHttpRequestBodyInit | null) {
    if (!this.__guestBlock) return send.call(this, body);
    onSignIn();
    window.setTimeout(() => this.dispatchEvent(new ProgressEvent("abort")), 0);
  };
  return () => {
    window.fetch = original;
    proto.open = open;
    proto.send = send;
  };
}
