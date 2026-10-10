// @vitest-environment node
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  accountDeletionSql,
  createNonceRegistry,
  isAuthStartPath,
  pkceChallenge,
  registerNativeApp,
  safeAppPath,
  verifyAppleIdentityToken,
} from "./nativeApp.js";

const secret = "test-secret";
const sign = (value: string) => crypto.createHmac("sha256", secret).update(value).digest("base64url");
const signedValue = (value: string) => `${value}.${sign(value)}`;
function verifySignedValue(raw: string) {
  const idx = String(raw || "").lastIndexOf(".");
  if (idx <= 0) return "";
  const value = raw.slice(0, idx);
  return raw.slice(idx + 1) === sign(value) ? value : "";
}
const sqlString = (value: string) => `'${String(value).replace(/'/g, "''")}'`;

describe("native app helpers", () => {
  it("only treats auth start routes as handoff targets", () => {
    expect(isAuthStartPath("/api/auth/google?mode=signin&next=/channels")).toBe(true);
    expect(isAuthStartPath("/api/auth/tiktok")).toBe(true);
    expect(isAuthStartPath("/api/auth/social/instagram?next=/channels")).toBe(true);
    expect(isAuthStartPath("/api/auth/google/callback?code=x")).toBe(false);
    expect(isAuthStartPath("/api/auth/logout")).toBe(false);
    expect(isAuthStartPath("https://evil.example/api/auth/google")).toBe(false);
  });

  it("keeps return paths inside the app", () => {
    expect(safeAppPath("/channels?tab=1")).toBe("/channels?tab=1");
    expect(safeAppPath("//evil.example")).toBe("/");
    expect(safeAppPath("https://evil.example")).toBe("/");
    expect(safeAppPath("/api/account/delete")).toBe("/");
    expect(safeAppPath("/feed\r\nSet-Cookie: x")).toBe("/");
  });

  it("matches the RFC 7636 S256 example", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("accepts each nonce once", () => {
    let now = 1000;
    const nonces = createNonceRegistry(() => now);
    expect(nonces.consume("a", 100)).toBe(true);
    expect(nonces.consume("a", 100)).toBe(false);
    now += 500;
    expect(nonces.consume("b", 100)).toBe(true);
    expect(nonces.consume("")).toBe(false);
  });

  it("deletes user rows but keeps payment records", () => {
    const sql = accountDeletionSql("usr_o'neil", sqlString);
    expect(sql).toContain("'usr_o''neil'");
    expect(sql).toContain("'billing_orders'");
    expect(sql).toMatch(/UPDATE app_users SET google_sub = 'deleted:'/);
    expect(sql).toMatch(/DELETE FROM app_users WHERE id = target/);
  });
});

describe("verifyAppleIdentityToken", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
  const nonce = "raw-nonce";
  const makeToken = (claims: Record<string, unknown>, kid = "k1") => {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", kid })).toString("base64url");
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const signature = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url");
    return `${header}.${payload}.${signature}`;
  };
  const base = () => ({
    iss: "https://appleid.apple.com",
    aud: "cc.autoyt.app",
    sub: "001234.abc",
    email: "me@privaterelay.appleid.com",
    exp: Math.floor(Date.now() / 1000) + 600,
    nonce: crypto.createHash("sha256").update(nonce).digest("hex"),
  });
  const options = { audiences: ["cc.autoyt.app"], nonce, fetchKeys: async () => [jwk] };

  it("accepts a valid token", async () => {
    const claims = await verifyAppleIdentityToken(makeToken(base()), options);
    expect(claims.sub).toBe("001234.abc");
  });

  it("rejects tampering, other apps, expiry and replayed nonces", async () => {
    const good = makeToken(base());
    const [h, , s] = good.split(".");
    const forged = `${h}.${Buffer.from(JSON.stringify({ ...base(), sub: "someone-else" })).toString("base64url")}.${s}`;
    await expect(verifyAppleIdentityToken(forged, options)).rejects.toThrow(/signature/);
    await expect(verifyAppleIdentityToken(makeToken({ ...base(), aud: "com.other.app" }), options)).rejects.toThrow(/different app/);
    await expect(verifyAppleIdentityToken(makeToken({ ...base(), exp: 1 }), options)).rejects.toThrow(/expired/);
    await expect(verifyAppleIdentityToken(makeToken(base()), { ...options, nonce: "other" })).rejects.toThrow(/verified/);
    await expect(verifyAppleIdentityToken(makeToken(base(), "unknown"), options)).rejects.toThrow(/unknown key/);
  });
});

describe("system-browser sign-in handoff", () => {
  const sessions = new Set(["ses_webview"]);
  let base = "";
  let server: ReturnType<ReturnType<typeof express>["listen"]>;
  const cookieOf = (res: Response, name: string) => {
    for (const cookie of res.headers.getSetCookie()) {
      const match = new RegExp(`^${name}=([^;]*)`).exec(cookie);
      if (match) return match[1];
    }
    return null;
  };

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    const sessionFrom = (req: express.Request) => {
      const raw = /movieid_session=([^;]+)/.exec(String(req.headers.cookie || ""))?.[1];
      const id = raw ? verifySignedValue(decodeURIComponent(raw)) : "";
      return sessions.has(id) ? { id, user: { id: "usr_1" } } : null;
    };
    registerNativeApp(app, {
      getSessionRecord: async (req: express.Request) => sessionFrom(req),
      setSessionCookie: (res: express.Response, id: string) => res.setHeader("Set-Cookie", `movieid_session=${encodeURIComponent(signedValue(id))}; Path=/`),
      clearSessionCookie: (res: express.Response) => res.setHeader("Set-Cookie", "movieid_session=; Max-Age=0"),
      createAuthSession: async () => "ses_new",
      upsertAuthUser: async () => ({ id: "usr_1" }),
      signedValue,
      verifySignedValue,
      publicAppUrl: () => base,
      runPsql: async (sql: string) => {
        const id = /WHERE id = '([^']+)'/.exec(sql)?.[1];
        return id && sessions.has(id) ? "1" : "";
      },
      sqlString,
    });
    // Stand-ins for the real Google routes: start redirects out, callback signs in.
    app.get("/api/auth/google", (_req, res) => res.redirect("https://accounts.google.com/o/oauth2/v2/auth?state=x"));
    app.get("/api/auth/google/callback", (req, res) => {
      if (req.query.fail) return res.redirect("/auth/error?message=Denied");
      sessions.add("ses_google");
      res.setHeader("Set-Cookie", `movieid_session=${encodeURIComponent(signedValue("ses_google"))}; Path=/`);
      res.redirect("/channels");
    });
    await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  async function startFlow(webviewCookie = "") {
    const verifier = crypto.randomBytes(32).toString("base64url");
    const ticketRes = await fetch(`${base}/api/auth/native/ticket`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: webviewCookie },
      body: JSON.stringify({ challenge: pkceChallenge(verifier), to: "/api/auth/google?mode=signin&next=/channels" }),
    });
    expect(ticketRes.status).toBe(200);
    const { url } = await ticketRes.json();
    const start = await fetch(url, { redirect: "manual" });
    expect(start.status).toBe(302);
    expect(start.headers.get("location")).toBe("/api/auth/google?mode=signin&next=/channels");
    const flow = cookieOf(start, "autoyt_native_flow");
    expect(flow).toBeTruthy();
    return { verifier, url, start, flow: `autoyt_native_flow=${flow}` };
  }

  it("hands a browser sign-in back to the app, once, only with the verifier", async () => {
    const { verifier, url, flow } = await startFlow();
    // Leaving for Google stays in the browser.
    const out = await fetch(`${base}/api/auth/google`, { redirect: "manual", headers: { cookie: flow } });
    expect(out.headers.get("location")).toMatch(/^https:\/\/accounts\.google\.com/);
    // Returning to an app page ends the flow with a deep link instead.
    const back = await fetch(`${base}/api/auth/google/callback?code=c`, { redirect: "manual", headers: { cookie: flow } });
    const location = back.headers.get("location") || "";
    expect(location).toMatch(/^autoyt:\/\/auth\?code=/);
    const code = new URL(location.replace("autoyt://", "https://x/")).searchParams.get("code");

    const wrong = await fetch(`${base}/api/auth/native/exchange`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, verifier: "attacker" }) });
    expect(wrong.status).toBe(400);
    const ok = await fetch(`${base}/api/auth/native/exchange`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, verifier }) });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, next: "/channels" });
    expect(verifySignedValue(decodeURIComponent(cookieOf(ok, "movieid_session") || ""))).toBe("ses_google");
    const replay = await fetch(`${base}/api/auth/native/exchange`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, verifier }) });
    expect(replay.status).toBe(400);
    // Tickets are single use too.
    const reused = await fetch(url, { redirect: "manual" });
    expect(reused.headers.get("location")).toMatch(/^autoyt:\/\/auth\?error=/);
  });

  it("carries the app's session into the browser for account connections", async () => {
    const webview = `movieid_session=${encodeURIComponent(signedValue("ses_webview"))}`;
    const { start } = await startFlow(webview);
    expect(verifySignedValue(decodeURIComponent(cookieOf(start, "movieid_session") || ""))).toBe("ses_webview");
  });

  it("reports provider errors through the deep link", async () => {
    const { flow } = await startFlow();
    const back = await fetch(`${base}/api/auth/google/callback?fail=1`, { redirect: "manual", headers: { cookie: flow } });
    expect(back.headers.get("location")).toBe("autoyt://auth?error=Denied");
  });

  it("hands Android back to the app through an intent page, since Chrome can block a plain autoyt:// redirect", async () => {
    const { flow } = await startFlow();
    const android = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";
    const back = await fetch(`${base}/api/auth/google/callback?code=c`, { redirect: "manual", headers: { cookie: flow, "user-agent": android } });
    expect(back.status).toBe(200);
    const html = await back.text();
    expect(html).toMatch(/intent:\/\/auth\?code=[^"#]+#Intent;scheme=autoyt;package=cc\.autoyt\.app;end/);
    expect(html).toContain("Open AutoYT");
  });

  it("bounces WebView navigations to auth URLs back to the app page", async () => {
    const res = await fetch(`${base}/api/auth/google?mode=connect&next=/channels`, {
      redirect: "manual",
      headers: { "user-agent": "Mozilla/5.0 AutoYTApp/1", referer: `${base}/channels?x=1` },
    });
    const location = new URL(res.headers.get("location") || "", base);
    expect(location.pathname).toBe("/channels");
    expect(location.searchParams.get("x")).toBe("1");
    expect(location.searchParams.get("native_auth")).toBe("/api/auth/google?mode=connect&next=/channels");
  });
});
