// Server side of the iOS and Android apps (capacitor.config.ts). The apps load
// autoyt.cc in a WebView, so they share this backend, database and session
// cookie with the website. Three things need help from the server:
//
// 1. OAuth. Google and the social networks refuse sign-in inside an embedded
//    WebView, so the app runs every /api/auth/* flow in the system browser and
//    gets the resulting session back through autoyt://auth (a PKCE-style
//    exchange: only the WebView that started the flow holds the verifier).
// 2. Sign in with Apple, which App Review requires next to Google sign-in.
// 3. In-app account deletion, which App Review requires for apps with sign-in.
import crypto from "node:crypto";

export const NATIVE_USER_AGENT = /\bAutoYTApp\//;
export const NATIVE_CALLBACK = "autoyt://auth";
const FLOW_COOKIE = "autoyt_native_flow";
const TICKET_TTL_MS = 3 * 60 * 1000;
const CODE_TTL_MS = 5 * 60 * 1000;
const FLOW_TTL_SECONDS = 15 * 60;
const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys";
// Rows that must outlive the account: paid orders are kept for tax and refund
// records, so a paying user's account is anonymised instead of removed.
const RETAINED_TABLES = new Set(["app_users", "billing_orders", "billing_accounts", "token_ledger"]);

const AUTH_START = /^\/api\/auth\/(?:google|tiktok|social\/[a-z]+)(?:\?|$)/;

export function isNativeRequest(req) {
    return NATIVE_USER_AGENT.test(String(req.headers["user-agent"] || ""));
}

export function isAuthStartPath(path) {
    return AUTH_START.test(String(path || ""));
}

export function base64Url(buffer) {
    return Buffer.from(buffer).toString("base64url");
}

export function pkceChallenge(verifier) {
    return base64Url(crypto.createHash("sha256").update(String(verifier)).digest());
}

/** Same-origin app path to return to after sign-in; anything else falls back. */
export function safeAppPath(value, fallback = "/") {
    const path = String(value || "").trim();
    if (!path || !/^\/(?!\/)/.test(path) || path.includes("\\") || /[\r\n]/.test(path) || path.startsWith("/api/"))
        return fallback;
    return path;
}

/** Single-use guard for tickets and codes. In-memory is enough: they live for minutes. */
export function createNonceRegistry(now = Date.now) {
    const used = new Map();
    return {
        consume(nonce, ttlMs) {
            const at = now();
            for (const [key, expires] of used)
                if (expires < at)
                    used.delete(key);
            if (!nonce || used.has(nonce))
                return false;
            used.set(nonce, at + ttlMs);
            return true;
        },
    };
}

function sealToken(signedValue, payload) {
    return signedValue(base64Url(JSON.stringify({ ...payload, ts: Date.now(), nonce: crypto.randomUUID() })));
}

function openToken(verifySignedValue, token, ttlMs) {
    const body = verifySignedValue(String(token || ""));
    if (!body)
        throw Object.assign(new Error("This sign-in link is invalid. Try again."), { statusCode: 400 });
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload.ts || Date.now() - Number(payload.ts) > ttlMs)
        throw Object.assign(new Error("This sign-in link expired. Try again."), { statusCode: 400 });
    return payload;
}

function readCookie(req, name) {
    for (const part of String(req.headers.cookie || "").split(";")) {
        const idx = part.indexOf("=");
        if (idx > 0 && part.slice(0, idx).trim() === name)
            return decodeURIComponent(part.slice(idx + 1).trim());
    }
    return "";
}

function appendSetCookie(res, cookie) {
    const existing = res.getHeader("Set-Cookie");
    const list = existing ? (Array.isArray(existing) ? existing : [String(existing)]) : [];
    res.setHeader("Set-Cookie", [...list, cookie]);
}

function sessionIdFromSetCookie(res, verifySignedValue) {
    const existing = res.getHeader("Set-Cookie");
    const list = existing ? (Array.isArray(existing) ? existing : [String(existing)]) : [];
    for (const cookie of list) {
        const match = /^movieid_session=([^;]*)/.exec(cookie);
        if (match && match[1])
            return verifySignedValue(decodeURIComponent(match[1]));
    }
    return "";
}

/** Verifies an Apple identity token (RS256 JWT) against Apple's published keys. */
export async function verifyAppleIdentityToken(token, { audiences, nonce, fetchKeys, now = Date.now }) {
    const parts = String(token || "").split(".");
    if (parts.length !== 3)
        throw new Error("Apple returned an unreadable identity token.");
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (header.alg !== "RS256")
        throw new Error("Apple identity token uses an unexpected algorithm.");
    const keys = await fetchKeys();
    const jwk = keys.find((key) => key.kid === header.kid);
    if (!jwk)
        throw new Error("Apple identity token was signed with an unknown key.");
    const valid = crypto.verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), crypto.createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(parts[2], "base64url"));
    if (!valid)
        throw new Error("Apple identity token signature is invalid.");
    if (payload.iss !== APPLE_ISSUER)
        throw new Error("Apple identity token has the wrong issuer.");
    const audienceList = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audienceList.some((aud) => audiences.includes(aud)))
        throw new Error("Apple identity token was issued for a different app.");
    if (!payload.exp || Number(payload.exp) * 1000 < now())
        throw new Error("Apple sign-in expired. Try again.");
    if (nonce && payload.nonce !== crypto.createHash("sha256").update(String(nonce)).digest("hex"))
        throw new Error("Apple sign-in could not be verified. Try again.");
    if (!payload.sub)
        throw new Error("Apple did not return an account id.");
    return payload;
}

function appleKeysFetcher(fetchImpl = fetch) {
    let cache = { keys: [], at: 0 };
    return async () => {
        if (cache.keys.length && Date.now() - cache.at < 60 * 60 * 1000)
            return cache.keys;
        const response = await fetchImpl(APPLE_KEYS_URL);
        if (!response.ok)
            throw new Error(`Could not reach Apple to verify sign-in (${response.status}).`);
        const data = await response.json();
        cache = { keys: Array.isArray(data.keys) ? data.keys : [], at: Date.now() };
        return cache.keys;
    };
}

/** SQL that deletes everything a user owns. Discovers tables at run time so new features are covered. */
export function accountDeletionSql(userId, sqlString) {
    const retained = [...RETAINED_TABLES].map((name) => sqlString(name)).join(", ");
    return `
DO $$
DECLARE
  target text := ${sqlString(userId)};
  r record;
BEGIN
  FOR r IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND c.column_name = 'agent_id' AND t.table_type = 'BASE TABLE'
      AND c.table_name <> 'automation_agents' AND c.table_name NOT IN (${retained})
  LOOP
    EXECUTE format('DELETE FROM %I WHERE agent_id::text IN (SELECT id::text FROM automation_agents WHERE user_id::text = $1)', r.table_name) USING target;
  END LOOP;
  FOR r IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND c.column_name = 'user_id' AND t.table_type = 'BASE TABLE'
      AND c.table_name NOT IN (${retained})
  LOOP
    EXECUTE format('DELETE FROM %I WHERE user_id::text = $1', r.table_name) USING target;
  END LOOP;
  IF EXISTS (SELECT 1 FROM billing_orders WHERE user_id = target) THEN
    UPDATE app_users SET google_sub = 'deleted:' || id, email = 'deleted-' || id || '@deleted.autoyt.cc',
      name = 'Deleted account', avatar_url = '', updated_at = now()
    WHERE id = target;
  ELSE
    DELETE FROM app_users WHERE id = target;
  END IF;
END $$;
SELECT 'ok';
`;
}

export function registerNativeApp(app, deps) {
    const { getSessionRecord, setSessionCookie, clearSessionCookie, createAuthSession, upsertAuthUser, signedValue, verifySignedValue, publicAppUrl, runPsql, sqlString, signupAllowed } = deps;
    const nonces = createNonceRegistry();
    const fetchAppleKeys = appleKeysFetcher(deps.fetch || fetch);
    const appleAudiences = String(process.env.APPLE_BUNDLE_IDS || process.env.APPLE_BUNDLE_ID || "cc.autoyt.app").split(",").map((id) => id.trim()).filter(Boolean);
    const secure = (process.env.NODE_ENV || "").toLowerCase() === "production";
    const flowCookie = (value, maxAge) => `${FLOW_COOKIE}=${encodeURIComponent(value)}; HttpOnly; Path=/api/auth; SameSite=Lax${secure ? "; Secure" : ""}; Max-Age=${maxAge}`;

    async function sessionExists(sessionId) {
        if (!sessionId)
            return false;
        const out = await runPsql(`SELECT 1 FROM app_sessions WHERE id = ${sqlString(sessionId)} AND expires_at > now() LIMIT 1;`);
        return String(out || "").trim() === "1";
    }

    function readFlow(req) {
        const raw = readCookie(req, FLOW_COOKIE);
        if (!raw)
            return null;
        try {
            return openToken(verifySignedValue, raw, FLOW_TTL_SECONDS * 1000);
        }
        catch {
            return null;
        }
    }

    // A WebView navigating straight to an auth start URL (a plain link or
    // location.assign) would hit Google's embedded-browser block. Send it back
    // to the page it came from with a marker; src/native/bootstrap.ts then runs
    // the flow in the system browser.
    app.get(/^\/api\/auth\/(?:google|tiktok|social\/[a-z]+)$/, (req, res, next) => {
        if (!isNativeRequest(req))
            return next();
        const to = req.originalUrl;
        let back = "/";
        try {
            const referer = new URL(String(req.headers.referer || ""), publicAppUrl(req));
            if (referer.origin === new URL(publicAppUrl(req)).origin)
                back = safeAppPath(referer.pathname + referer.search, "/");
        }
        catch {
            /* no usable referer */
        }
        const url = new URL(back, publicAppUrl(req));
        url.searchParams.set("native_auth", to);
        res.redirect(url.pathname + url.search);
    });

    // In the system browser, every redirect that leaves /api/auth/* for an app
    // page ends the flow: hand the session to the app instead of loading the page.
    app.use("/api/auth", (req, res, next) => {
        const flow = readFlow(req);
        if (!flow || isNativeRequest(req))
            return next();
        const redirect = res.redirect.bind(res);
        res.redirect = (...args) => {
            const target = String((typeof args[0] === "number" ? args[1] : args[0]) || "");
            const origin = publicAppUrl(req);
            const local = target.startsWith(origin) ? target.slice(origin.length) || "/" : target;
            if (!local.startsWith("/") || local.startsWith("//") || local.startsWith("/api/auth/"))
                return redirect(...args);
            appendSetCookie(res, flowCookie("", 0));
            if (local.startsWith("/auth/error")) {
                const message = new URL(local, origin).searchParams.get("message") || "Sign-in failed";
                return redirect(302, `${NATIVE_CALLBACK}?error=${encodeURIComponent(message)}`);
            }
            Promise.resolve().then(async () => {
                let sessionId = sessionIdFromSetCookie(res, verifySignedValue);
                if (!sessionId)
                    sessionId = (await getSessionRecord(req))?.id || "";
                if (!sessionId)
                    throw new Error("Sign-in did not finish. Try again.");
                const code = sealToken(signedValue, { sid: sessionId, challenge: flow.challenge, next: safeAppPath(local) });
                redirect(302, `${NATIVE_CALLBACK}?code=${encodeURIComponent(code)}`);
            }).catch((error) => {
                redirect(302, `${NATIVE_CALLBACK}?error=${encodeURIComponent(error instanceof Error ? error.message : "Sign-in failed")}`);
            });
        };
        next();
    });

    // Step 1 (WebView): get a short-lived ticket for the system browser. A
    // signed-in WebView passes its session along so connect flows know the user.
    app.post("/api/auth/native/ticket", async (req, res) => {
        try {
            const challenge = String(req.body?.challenge || "");
            const to = String(req.body?.to || "");
            if (!/^[A-Za-z0-9_-]{43}$/.test(challenge))
                return res.status(400).json({ error: "Invalid sign-in request." });
            if (!isAuthStartPath(to))
                return res.status(400).json({ error: "Unsupported sign-in destination." });
            const session = await getSessionRecord(req).catch(() => null);
            const ticket = sealToken(signedValue, { sid: session?.id || "", challenge, to });
            res.setHeader("Cache-Control", "no-store");
            res.json({ url: `${publicAppUrl(req)}/api/auth/native/start?ticket=${encodeURIComponent(ticket)}` });
        }
        catch (error) {
            res.status(500).json({ error: error instanceof Error ? error.message : "Could not start sign-in." });
        }
    });

    // Step 2 (system browser): adopt the WebView's session, mark the flow, start it.
    app.get("/api/auth/native/start", async (req, res) => {
        try {
            const ticket = openToken(verifySignedValue, req.query.ticket, TICKET_TTL_MS);
            if (!nonces.consume(ticket.nonce, TICKET_TTL_MS))
                throw new Error("This sign-in link was already used. Try again from the app.");
            if (!isAuthStartPath(ticket.to))
                throw new Error("Unsupported sign-in destination.");
            if (ticket.sid && await sessionExists(ticket.sid))
                setSessionCookie(res, ticket.sid);
            appendSetCookie(res, flowCookie(sealToken(signedValue, { challenge: ticket.challenge }), FLOW_TTL_SECONDS));
            res.redirect(ticket.to);
        }
        catch (error) {
            res.redirect(`${NATIVE_CALLBACK}?error=${encodeURIComponent(error instanceof Error ? error.message : "Sign-in failed")}`);
        }
    });

    // Step 3 (WebView): trade the code from autoyt://auth for the session cookie.
    app.post("/api/auth/native/exchange", async (req, res) => {
        try {
            const code = openToken(verifySignedValue, req.body?.code, CODE_TTL_MS);
            if (pkceChallenge(req.body?.verifier || "") !== code.challenge)
                return res.status(400).json({ error: "This sign-in belongs to another device. Try again." });
            if (!nonces.consume(code.nonce, CODE_TTL_MS))
                return res.status(400).json({ error: "This sign-in was already used. Try again." });
            if (!(await sessionExists(code.sid)))
                return res.status(400).json({ error: "Sign-in expired. Try again." });
            setSessionCookie(res, code.sid);
            res.setHeader("Cache-Control", "no-store");
            res.json({ ok: true, next: safeAppPath(code.next) });
        }
        catch (error) {
            res.status(error?.statusCode || 500).json({ error: error instanceof Error ? error.message : "Sign-in failed." });
        }
    });

    app.post("/api/auth/apple/native", async (req, res) => {
        try {
            const claims = await verifyAppleIdentityToken(req.body?.identityToken, {
                audiences: appleAudiences,
                nonce: String(req.body?.nonce || ""),
                fetchKeys: fetchAppleKeys,
            });
            const identity = `apple:${claims.sub}`;
            const existing = JSON.parse(await runPsql(`SELECT COALESCE((SELECT json_build_object('email', email, 'name', name) FROM app_users WHERE google_sub = ${sqlString(identity)} LIMIT 1), 'null'::json);`) || "null");
            const email = String(claims.email || existing?.email || "").trim().toLowerCase();
            if (!email)
                return res.status(400).json({ error: "Apple did not share an email address. Remove AutoYT from Settings > Apple ID > Sign in with Apple, then try again." });
            const givenName = String(req.body?.name || "").trim().slice(0, 120);
            const profile = { googleSub: identity, email, name: givenName || existing?.name || email.split("@")[0], avatarUrl: "" };
            if (!existing && signupAllowed && !(await signupAllowed(profile)))
                return res.status(403).json({ error: "New sign-ups are paused right now. Try again later." });
            const user = await upsertAuthUser(profile);
            const sessionId = await createAuthSession(user.id);
            setSessionCookie(res, sessionId);
            res.setHeader("Cache-Control", "no-store");
            res.json({ ok: true });
        }
        catch (error) {
            res.status(400).json({ error: error instanceof Error ? error.message : "Sign in with Apple failed." });
        }
    });

    app.post("/api/account/delete", async (req, res) => {
        try {
            const session = await getSessionRecord(req);
            if (!session?.user)
                return res.status(401).json({ error: "Sign in again to delete your account." });
            if (String(req.body?.confirm || "") !== "DELETE")
                return res.status(400).json({ error: "Type DELETE to confirm." });
            const billing = JSON.parse(await runPsql(`SELECT COALESCE((SELECT json_build_object('status', status, 'planId', plan_id, 'provider', payment_provider, 'paidThrough', subscription_paid_through) FROM billing_accounts WHERE user_id = ${sqlString(session.user.id)}), 'null'::json);`).catch(() => "null") || "null");
            const subscribed = Boolean(billing && billing.provider === "lingbase" && billing.status === "active" && billing.planId !== "pending"
                && billing.paidThrough && new Date(billing.paidThrough).getTime() > Date.now());
            if (subscribed && req.body?.acknowledgeSubscription !== true) {
                return res.status(409).json({
                    code: "subscription_active",
                    error: "You have an active paid plan. Deleting your account does not cancel it automatically; cancel it from Manage subscription at autoyt.cc first, or delete anyway and contact support for a refund.",
                });
            }
            await runPsql(accountDeletionSql(session.user.id, sqlString));
            clearSessionCookie(res);
            res.json({ ok: true });
        }
        catch (error) {
            res.status(500).json({ error: error instanceof Error ? error.message : "Could not delete the account." });
        }
    });
}
