import { guardUsage, meterUsage } from "./usageMeter.js";

const API = "https://openrouter.ai/api/v1";

export function usageOperation(endpoint) {
  const path = String(endpoint || "");
  if (path.startsWith("/images")) return "image";
  if (path.startsWith("/videos")) return "video";
  if (path.startsWith("/audio/transcriptions")) return "transcription";
  if (path.startsWith("/audio/speech")) return "speech";
  return "chat";
}

function meterResponse(provider, endpoint, body, data) {
  if (!data || typeof data !== "object") return;
  const operation = usageOperation(endpoint);
  const usage = data.usage || (Number.isFinite(Number(data.cost)) ? { cost: Number(data.cost) } : null);
  // When a provider omits usage, keep the call visible as an estimated charge.
  // Video status responses are polled repeatedly, so only charge the terminal
  // response once; request bodies identify one-off image/chat/audio calls.
  const terminalVideo = operation === "video" && /^(completed|succeeded|success|complete|done)$/i.test(String(data.status || ""));
  if (operation === "video" && !body && !terminalVideo) return;
  const units = !usage && body
    ? operation === "image" ? Math.max(1, Array.isArray(data.data) ? data.data.length : 1) : 1
    : !usage && terminalVideo ? 1 : 0;
  if (!usage && !units) return;
  const id = String(data.id || "");
  meterUsage({ provider, model: data.model || body?.model || "", operation, usage, units, ref: id ? `${operation}:${id}` : "" });
}

function estimatedStreamUsage(body, content) {
  const input = JSON.stringify(body?.messages || []).length;
  const output = String(content || "").length;
  if (!input && !output) return null;
  return {
    prompt_tokens: Math.ceil(input / 4),
    completion_tokens: Math.ceil(output / 4),
  };
}

function messageText(message) {
  const content = message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) return content.map((part) => typeof part === "string" ? part : part?.text || "").join("\n").trim();
  return content == null ? "" : String(content).trim();
}

export function openRouterConfigured(env = process.env) {
  return Boolean(String(env.OPENROUTER_API_KEY || "").trim());
}

export function openRouterModel(kind = "text", env = process.env) {
  const defaults = { text: "deepseek/deepseek-v4.1-flash", agent: "qwen/qwen3.8-max-0902", vision: "qwen/qwen3.8-flash", avatar: "heygen/avatar-iv", transcription: "openai/whisper-1" };
  return String(env[`OPENROUTER_${kind.toUpperCase()}_MODEL`] || defaults[kind] || defaults.text).trim();
}

// Jev is exposed by OpenRouter through its typed Decisions API rather than
// Chat Completions. Keep the same account-level usage guard and ledger.
/** @param {{ state: unknown, questions: Record<string, unknown>, model?: string, signal?: AbortSignal, timeoutMs?: number, fetchImpl?: typeof fetch, env?: NodeJS.ProcessEnv }} [options] */
export async function openRouterDecision({ state, questions, model = "typesafe/jev-1.13", signal, timeoutMs = 12000, fetchImpl = fetch, env = process.env } = {}) {
  const key = String(env.OPENROUTER_API_KEY || "").trim();
  if (!key) return null;
  await guardUsage("openrouter", { operation: "chat", model });
  const timeout = AbortSignal.timeout(timeoutMs);
  const response = await fetchImpl("https://openrouter.ai/api/alpha/decisions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": env.APP_URL || "https://autoyt.cc",
      "X-OpenRouter-Title": "AutoYT",
    },
    body: JSON.stringify({ model, state, questions }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    const detail = String(data.error?.message || data.error || "Decision request failed").replaceAll(key, "[redacted]").slice(0, 300);
    const error = new Error(`OpenRouter decision (${response.status}): ${detail}`);
    error.status = response.status;
    throw error;
  }
  if (data.usage) meterUsage({ provider: "openrouter", model: data.model || model, operation: "chat", usage: data.usage, ref: data.id ? `decision:${data.id}` : "" });
  return data;
}

// ---------- VideoRouter first for image and video jobs ----------
// VideoRouter (videorouter.sh) takes the same image and video request shapes as
// OpenRouter. When VIDEOROUTER_API_KEY is set, image and video jobs try it
// first. A missing id is retried on every matching VideoRouter host, including
// its OpenRouter pass-through, before the OpenRouter key is spent. Its job ids are
// prefixed "vr:" so status polls and downloads return to it.
const VR_API = "https://videorouter.sh/api/v1";
// Filter-free "unrestricted" routes are never used. VideoRouter's OpenRouter
// pass-through is billed to the VideoRouter balance, so it is the last host we
// try — after every native host — and only then do we spend the OpenRouter key.
//
// OpenSand is allowed for regular (non-unrestricted) video models only. It is
// the cheapest provider for Seedance 2.5 by a wide margin, but it also fronts
// the filter-free "unrestricted" variants, and sending a whole job there for
// $0.05 only to have it refused mid-render is worse than the markup.
const VR_IGNORED_HOSTS = ["toapis", "openrouter"];
const VR_ROUTES = ["", "opensand/", "fal/", "wavespeed/", "atlascloud/", "replicate/", "machgen/", "pika/", "together/", "novita/"];
const vrCatalog = { at: 0, images: new Set(), videos: new Set(), loading: null };
// OpenRouter ids VideoRouter publishes under another canonical name.
const VR_ALIASES = { "minimax/hailuo-3": "minimax/h3", "minimax/hailuo-3-max": "minimax/h3-max" };
// Canonical ids VideoRouter answered "unknown model" for; these go straight to
// the host-id lookup instead of paying a rejected round trip every call.
const vrUnknownCanonical = new Set();

const videoRouterKey = (env) => (String(env.VIDEOROUTER_DISABLED || "") === "1" ? "" : String(env.VIDEOROUTER_API_KEY || "").trim());

// VideoRouter first, then the OpenRouter key. Callers that talk to a provider
// directly (music, hosted voices, voice design) use this so they spend the
// prepaid balance before the OpenRouter key.
export function aiProviderChain(env = process.env) {
  const chain = [];
  const vr = videoRouterKey(env);
  const orKey = String(env.OPENROUTER_API_KEY || "").trim();
  if (vr) chain.push({ base: VR_API, key: vr, provider: "videorouter", headers: {} });
  if (orKey) chain.push({
    base: API,
    key: orKey,
    provider: "openrouter",
    headers: { "HTTP-Referer": env.APP_URL || "https://autoyt.cc", "X-OpenRouter-Title": "AutoYT" },
  });
  return chain;
}

async function vrFetch(route, { body, signal, timeoutMs = 90000, binary = false, fetchImpl = fetch, env = process.env } = {}) {
  const key = videoRouterKey(env);
  if (body !== undefined) await guardUsage("videorouter", { operation: usageOperation(route), model: body?.model });
  const timeout = AbortSignal.timeout(timeoutMs);
  const response = await fetchImpl(`${VR_API}${route}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (binary && response.ok) return Buffer.from(await response.arrayBuffer());
  const text = await response.text().catch(() => "");
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {}
  if (!response.ok || data.error) {
    const detail = String(data.error?.message || data.detail || text || "Request failed").replaceAll(key, "[redacted]").slice(0, 300);
    const error = new Error(`AI provider (${response.status}): ${detail}`);
    error.status = response.status;
    throw error;
  }
  meterResponse("videorouter", route, body, data);
  return data;
}

// The model lists refresh hourly; a failed fetch retries after five minutes.
async function vrModels(kind, options) {
  const age = Date.now() - vrCatalog.at;
  if (vrCatalog.at && age < (vrCatalog.images.size ? 3600000 : 300000)) return vrCatalog[kind];
  vrCatalog.loading ||= Promise.all(
    ["images", "videos"].map((list) =>
      vrFetch(`/${list}/models`, { ...options, body: undefined, timeoutMs: 20000 })
        .then((data) => new Set((data.data || []).map((model) => model.id)))
        .catch(() => new Set()),
    ),
  ).then(([images, videos]) => {
    Object.assign(vrCatalog, { images, videos, at: Date.now(), loading: null });
  });
  await vrCatalog.loading;
  return vrCatalog[kind];
}

// Offline fallback only. Text-to-video requests normally send the canonical
// "creator/model" id and VideoRouter picks the cheapest live host itself.
// Image/audio reference scenes cannot use that path for Seedance: OpenSand is
// the cheapest host but rejects reference inputs, and VideoRouter's
// provider.only / provider.ignore still resolve to OpenSand for this model
// (verified 2026-09-26). Pinning a host-prefixed id is the only reliable way
// to reach a ref-capable host. Pricing (720p / s, videorouter.sh):
//
//   seedance-2.5 text   OpenSand $0.1179  MachGen $0.19  ...  fal $0.473
//   seedance-2.5 refs   MachGen $0.19     Atlas ~$0.30   WaveSpeed $0.36  fal $0.473
//   seedance-2.0-fast   Atlas Cloud $0.027 WaveSpeed ~$0.05  ...  fal $0.2419
//
// Create Drama always sends character sheets + dialogue audio, so it must use
// the ref host list — otherwise it lands on fal/seedance-2.5-reference (~$8
// for a ~17s 720p clip) instead of MachGen/WaveSpeed at a fraction of that.
export const VR_COST_PER_SECOND = {
  "seedance-2.5": { "opensand/": 0.1179, "machgen/": 0.19, "atlascloud/": 0.3005, "wavespeed/": 0.36, "fal/": 0.473 },
  "seedance-2.0": { "opensand/": 0.1179, "atlascloud/": 0.13, "wavespeed/": 0.15, "together/": 0.19, "replicate/": 0.22, "machgen/": 0.26, "fal/": 0.3034 },
  "seedance-2.0-fast": { "atlascloud/": 0.027, "wavespeed/": 0.05, "machgen/": 0.09, "fal/": 0.2419 },
  "seedance-2.0-mini": { "opensand/": 0.0104, "atlascloud/": 0.02, "wavespeed/": 0.03, "machgen/": 0.05, "fal/": 0.0721 },
};
const VR_PREFERRED = {
  "bytedance/seedance-2.5": ["opensand/", "machgen/", "atlascloud/", "wavespeed/", "together/", "fal/"],
  "bytedance/seedance-2.0-fast": ["atlascloud/", "wavespeed/", "machgen/", "fal/"],
  "bytedance/seedance-2.0": ["opensand/", "atlascloud/", "wavespeed/", "together/", "replicate/", "machgen/", "fal/"],
  "bytedance/seedance-2.0-mini": ["opensand/", "atlascloud/", "wavespeed/", "machgen/", "fal/"],
};
// Hosts known to accept Seedance image/audio reference inputs. OpenSand,
// TOAPIS, Together, and the OpenRouter pass-through reject them.
const VR_REF_HOSTS = {
  "bytedance/seedance-2.5": ["machgen/", "atlascloud/", "wavespeed/", "fal/"],
  "bytedance/seedance-2.0-fast": ["atlascloud/", "wavespeed/", "machgen/", "fal/"],
  "bytedance/seedance-2.0": ["atlascloud/", "wavespeed/", "replicate/", "machgen/", "fal/"],
  "bytedance/seedance-2.0-mini": ["atlascloud/", "wavespeed/", "machgen/", "fal/"],
};
const VR_ROUTE_ORDER = (model, { references = false } = {}) =>
  (references && VR_REF_HOSTS[model]) || VR_PREFERRED[model] || VR_ROUTES;

// "5-0" and "5.0" are the same version. OpenRouter publishes Seedream 5 as
// seedream-5-0-lite; VideoRouter publishes seedream-5.0-lite. Swap the
// separator only between digits so the rest of the name stays intact.
function versionSpellings(name) {
  const toDot = name.replace(/(\d)-(?=\d)/g, "$1.");
  const toHyphen = name.replace(/(\d)\.(?=\d)/g, "$1-");
  return [...new Set([name, toDot, toHyphen])];
}

const HOST_BLOCKED = /(^|\/)toapis\/|unrestricted/i;

// Native hosts first (cheapest route order), then VideoRouter's OpenRouter
// pass-through. The pass-through still bills the VideoRouter balance.
export function videoRouterCandidates(model, available, { references = false } = {}) {
  const name = String(model || "").split("/").pop();
  if (!name) return [];
  const spellings = versionSpellings(name);
  const native = [];
  const passThrough = [];
  const seen = new Set();
  const consider = (id, bucket) => {
    if (!id || seen.has(id) || !available?.has?.(id) || HOST_BLOCKED.test(id)) return;
    seen.add(id);
    bucket.push(id);
  };
  for (const route of VR_ROUTE_ORDER(model, { references })) {
    for (const spelling of spellings) consider(`${route}${spelling}`, native);
  }
  const wanted = new Set(spellings.map((spelling) => spelling.toLowerCase()));
  for (const id of available || []) {
    const tail = String(id).split("/").pop().toLowerCase();
    if (!wanted.has(tail)) continue;
    consider(id, /(^|\/)openrouter\//i.test(id) ? passThrough : native);
  }
  for (const spelling of spellings) consider(`openrouter/${spelling}`, passThrough);
  return [...native, ...passThrough];
}

// "openai/gpt-image-2" -> "gpt-image-2"; "bytedance/seedance-2.5" -> "opensand/seedance-2-5".
// The pass-through host is omitted here so a native host always wins the pick.
export function videoRouterModel(model, available, options = {}) {
  return videoRouterCandidates(model, available, options).find((id) => !/(^|\/)openrouter\//i.test(id)) || "";
}

const MAX_VR_HOSTS = 8;

function limitHosts(ids) {
  if (ids.length <= MAX_VR_HOSTS) return ids;
  const pass = ids.filter((id) => /(^|\/)openrouter\//i.test(id));
  const native = ids.filter((id) => !/(^|\/)openrouter\//i.test(id));
  return [...native.slice(0, MAX_VR_HOSTS - 1), ...pass.slice(0, 1)];
}

function stopTryingHosts(error) {
  if (!error) return false;
  if (error.name === "UsageBlockedError" || error.name === "AbortError" || error.videoRouterCharged) return true;
  return [401, 402, 403].includes(error.status);
}

async function attemptVideoRouter(endpoint, options, models, extras) {
  let last;
  for (const model of models) {
    try {
      return await sendToVideoRouter(endpoint, options, model, extras);
    } catch (error) {
      options.signal?.throwIfAborted();
      if (stopTryingHosts(error)) throw error;
      last = error;
      if (error.status === 400 && /unknown (video |image )?model/i.test(String(error.message || ""))) vrUnknownCanonical.add(model);
    }
  }
  if (last && stopTryingHosts(last)) throw last;
  if (last) console.warn(`[videorouter] ${endpoint} ${options.body?.model || ""} fell back to OpenRouter: ${last.message}`);
  return null;
}

async function viaVideoRouter(endpoint, options) {
  const body = options.body || {};
  const references = body.input_references || [];
  const audioReferences = references.filter((ref) => ref?.type === "audio_url");
  const imageReferences = references.filter((ref) => ref?.type === "image_url");
  const otherReferences = references.filter((ref) => ref?.type !== "audio_url" && ref?.type !== "image_url");
  if (otherReferences.length) return null;
  const extras = { audioReferences, references };
  // Image or dialogue references: pin a ref-capable host. Do not send the
  // canonical id (OpenSand wins and hard-fails) and do not force fal's
  // *-reference model (≈4× MachGen at 720p for Create Drama).
  if (endpoint === "/videos" && (audioReferences.length || imageReferences.length) && VR_REF_HOSTS[body.model]) {
    const available = await vrModels("videos", options);
    const hosts = videoRouterCandidates(body.model, available, { references: true }).filter((id) => !/(^|\/)openrouter\//i.test(id));
    return attemptVideoRouter(endpoint, options, limitHosts(hosts), extras);
  }
  if (audioReferences.length) return null;
  const canonical = VR_ALIASES[body.model] || String(body.model || "");
  const attempts = [];
  const push = (id) => {
    if (id && !attempts.includes(id)) attempts.push(id);
  };
  if (canonical.includes("/") && !vrUnknownCanonical.has(canonical)) push(canonical);
  const available = await vrModels(endpoint === "/images" ? "images" : "videos", options);
  const mapped = videoRouterCandidates(body.model, available);
  if (mapped.length) {
    for (const id of mapped) push(id);
  } else if (!available.size) {
    const name = String(body.model || "").split("/").pop();
    for (const route of ["pika/", "atlascloud/", "fal/", "opensand/", "openrouter/"]) {
      for (const spelling of versionSpellings(name)) push(`${route}${spelling}`);
    }
  }
  return attemptVideoRouter(endpoint, options, limitHosts(attempts), extras);
}

async function sendToVideoRouter(endpoint, options, model, { audioReferences = [], references = [] } = {}) {
  // Any caller `provider` object is OpenRouter-shaped; an `order` in it would
  // override VideoRouter's price ranking, so it is replaced rather than merged.
  const { provider: _openRouterProvider, ...body } = options.body || {};
  // A job pinned to VideoRouter's OpenRouter host must not also ignore that host.
  const pinnedPassThrough = /(^|\/)openrouter\//i.test(model);
  const provider = { sort: "price", ignore: pinnedPassThrough ? ["toapis"] : VR_IGNORED_HOSTS };
  if (endpoint === "/images") {
    const data = await vrFetch("/images", { ...options, body: { ...body, model, provider } });
    logVideoRouterHost(endpoint, model, data);
    const image = data.data?.[0];
    if (image?.b64_json) return data;
    if (image?.url && /^https:\/\//.test(image.url)) {
      const fetchImpl = options.fetchImpl || fetch;
      let last;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await fetchImpl(image.url, { signal: AbortSignal.timeout(120000) });
          if (!response.ok) throw new Error(`Image download failed (${response.status})`);
          const bytes = Buffer.from(await response.arrayBuffer());
          return { ...data, data: [{ ...image, b64_json: bytes.toString("base64") }] };
        } catch (error) {
          last = error;
        }
      }
      const error = last instanceof Error ? last : new Error("Image download failed");
      error.videoRouterCharged = true;
      throw error;
    }
    throw new Error("The AI provider returned no image");
  }
  const { duration, ...videoBody } = body;
  const created = await vrFetch("/videos", { ...options, body: {
    ...videoBody,
    model,
    provider,
    ...(duration ? { duration_secs: duration } : {}),
    ...(audioReferences.length ? {
      input_references: references.filter((ref) => ref?.type === "image_url"),
      input_audio_references: audioReferences,
    } : {}),
  } });
  logVideoRouterHost(endpoint, model, created);
  const id = created.id || created.data?.id;
  if (!id) throw new Error("The AI provider did not start the job");
  return { ...created, id: `vr:${id}` };
}

function logVideoRouterHost(endpoint, model, data) {
  if (!data?.provider) return;
  const fallback = data.fallback_used ? ` after ${Number(data.fallbacks_tried) || 1} rejected host(s)` : "";
  console.info(`[videorouter] ${endpoint} ${model} ran on ${data.provider}${fallback}`);
}

const VR_STATUS = { succeeded: "completed", success: "completed", complete: "completed", done: "completed", error: "failed", queued: "pending", processing: "in_progress", running: "in_progress" };
async function videoRouterJob(id, content, options) {
  const route = `/videos/${encodeURIComponent(id)}`;
  const status = await vrFetch(route, { ...options, body: undefined, binary: false, timeoutMs: 60000 });
  const normalized = { ...status, id: `vr:${id}`, status: VR_STATUS[String(status.status || "").toLowerCase()] || status.status };
  if (!content) return normalized;
  const url = status.url || status.video_url || status.output?.url || status.data?.[0]?.url || (Array.isArray(status.unsigned_urls) ? status.unsigned_urls[0] : "");
  if (!url) return vrFetch(`${route}/content`, { ...options, body: undefined, binary: true, timeoutMs: options.timeoutMs || 300000 });
  if (!/^https:\/\//.test(url)) throw new Error("The AI provider returned an unusable video address");
  // Provider download links are presigned: no credentials go to them.
  const response = await (options.fetchImpl || fetch)(url, { signal: AbortSignal.timeout(options.timeoutMs || 300000) });
  if (!response.ok) throw new Error(`Video download failed (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

export async function openRouterRequest(endpoint, options = {}) {
  const env = options.env || process.env;
  const job = String(endpoint).match(/^\/videos\/vr(?::|%3A)([^/?]+)(\/content)?$/i);
  if (job) return videoRouterJob(decodeURIComponent(job[1]), Boolean(job[2]), options);
  if (videoRouterKey(env) && options.body && (endpoint === "/images" || endpoint === "/videos")) {
    const routed = await viaVideoRouter(endpoint, options).catch((error) => {
      options.signal?.throwIfAborted();
      if (error?.name === "UsageBlockedError" || error?.videoRouterCharged) throw error;
      console.warn(`[videorouter] ${endpoint} ${options.body?.model || ""} fell back to OpenRouter: ${error.message}`);
      return null;
    });
    if (routed) return routed;
  }
  // Studio chat (motion graphics, agents, plans) uses the same order as the
  // streamed Promo path: VideoRouter first, OpenRouter only if that fails.
  if (videoRouterKey(env) && options.body && endpoint === "/chat/completions") {
    try {
      const { temperature: _temperature, reasoning: _reasoning, provider: _provider, ...rest } = options.body;
      const payload = { ...rest, model: vrChatModel(options.body.model), temperature: 1 };
      return await vrFetch("/chat/completions", { ...options, body: payload });
    } catch (error) {
      options.signal?.throwIfAborted();
      if (error?.name === "UsageBlockedError") throw error;
      if (!String(env.OPENROUTER_API_KEY || "").trim()) throw error;
      console.warn(`[videorouter] chat ${options.body?.model || ""} fell back to OpenRouter: ${error.message}`);
    }
  }
  return openRouterDirect(endpoint, options);
}

async function openRouterDirect(endpoint, { body, signal, timeoutMs = 90000, binary = false, fetchImpl = fetch, env = process.env } = {}) {
  const key = String(env.OPENROUTER_API_KEY || "").trim();
  if (!key) throw new Error("AI generation isn't set up on the server yet.");
  // Never send credentials to provider-supplied polling or download URLs.
  if (!endpoint.startsWith("/") || endpoint.startsWith("//")) throw new Error("Invalid AI provider endpoint.");
  if (body !== undefined) await guardUsage("openrouter", { operation: usageOperation(endpoint), model: body?.model });
  const timeout = AbortSignal.timeout(timeoutMs);
  const response = await fetchImpl(`${API}${endpoint}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": env.APP_URL || "https://autoyt.cc", "X-OpenRouter-Title": "AutoYT" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (binary && response.ok) return Buffer.from(await response.arrayBuffer());
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    const detail = String(data.error?.message || (typeof data.error === "string" ? data.error : "Request failed")).replaceAll(key, "[redacted]").slice(0, 350);
    const error = new Error(`AI provider (${response.status}): ${detail}`);
    error.status = response.status;
    throw error;
  }
  meterResponse("openrouter", endpoint, body, data);
  return data;
}

// Node's fetch sent concurrent long streams to OpenRouter one after another over a
// shared connection (six parallel requests took six times as long); a plain
// HTTP/1.1 request per call runs them side by side.
async function httpsFetch(url, { method = "GET", headers = {}, body, signal } = {}) {
  const https = await import("node:https");
  return new Promise((resolve, reject) => {
    const request = https.request(url, { method, headers: { ...headers, ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}) }, agent: false, signal }, (response) => {
      const status = response.statusCode || 0;
      resolve({
        ok: status >= 200 && status < 300,
        status,
        body: response,
        json: async () => {
          const chunks = [];
          for await (const chunk of response) chunks.push(chunk);
          return JSON.parse(Buffer.concat(chunks).toString("utf8"));
        },
      });
    });
    request.on("error", (error) => reject(signal?.aborted ? signal.reason : error));
    request.end(body);
  });
}

const VR_CHAT_MODELS = {
  "anthropic/claude-opus-5.5": "claude-opus-5-5",
  "anthropic/claude-opus-5": "claude-opus-5",
  "anthropic/claude-opus-4.8": "claude-opus-4.8",
  "anthropic/claude-opus-4.7": "claude-opus-4.7",
  "anthropic/claude-sonnet-4.6": "claude-sonnet-4.6",
  "anthropic/claude-sonnet-4.5": "claude-sonnet-4.5",
};
export const vrChatModel = (model) => VR_CHAT_MODELS[model] || String(model || "").replace(/^anthropic\//, "") || model;

async function readChatStream(response, { idleMs, onProgress, signal, stalled, bump }) {
  bump();
  const decoder = new TextDecoder();
  let buffer = "", content = "", finish = null, usage = null, id = "", model = "";
  for await (const chunk of response.body) {
    signal?.throwIfAborted();
    stalled?.signal.throwIfAborted();
    bump();
    buffer += decoder.decode(chunk, { stream: true });
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (!line.startsWith("data:") || line === "data: [DONE]") continue;
      let data;
      try {
        data = JSON.parse(line.slice(5));
      } catch {
        continue;
      }
      if (data.error) throw Object.assign(new Error(`AI provider: ${String(data.error.message || "Request failed").slice(0, 350)}`), { status: data.error.code });
      id ||= data.id || "";
      model ||= data.model || "";
      const choice = data.choices?.[0];
      if (choice?.delta?.content) {
        content += choice.delta.content;
        onProgress?.(content.length);
      }
      if (choice?.finish_reason) finish = choice.finish_reason;
      if (data.usage) usage = data.usage;
    }
  }
  return { id, model, usage, choices: [{ message: { content }, finish_reason: finish }] };
}

/**
 * A chat completion streamed, returned in the same shape as a plain one. Long
 * replies (minutes of writing) otherwise sit silent until they finish, and Node's
 * fetch drops a connection that is idle for five minutes.
 *
 * Chat tries VideoRouter first (cheapest host) when VIDEOROUTER_API_KEY is set,
 * then falls back to OpenRouter — same order as image/video jobs. Promo films
 * use this path; they do not use the image/video router.
 * @param {string} endpoint
 * @param {{ body?: object, signal?: AbortSignal, timeoutMs?: number, idleMs?: number, onProgress?: (n: number) => void, fetchImpl?: Function, env?: NodeJS.ProcessEnv }} [options]
 */
export async function openRouterStream(endpoint, { body, signal, timeoutMs = 90000, idleMs = 120000, onProgress, fetchImpl = httpsFetch, env = process.env } = {}) {
  if (!endpoint.startsWith("/") || endpoint.startsWith("//")) throw new Error("Invalid AI provider endpoint.");
  const orKey = String(env.OPENROUTER_API_KEY || "").trim();
  const vrKey = videoRouterKey(env);
  if (!orKey && !vrKey) throw new Error("AI generation isn't set up on the server yet.");

  const run = async (base, key, provider, payload) => {
    await guardUsage(provider, { operation: usageOperation(endpoint), model: payload?.model });
    const stalled = new AbortController();
    let idle;
    const bump = () => {
      clearTimeout(idle);
      idle = setTimeout(() => stalled.abort(new Error("The AI provider stopped responding.")), idleMs);
    };
    try {
      const response = await fetchImpl(`${base}${endpoint}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          ...(provider === "openrouter" ? { "HTTP-Referer": env.APP_URL || "https://autoyt.cc", "X-OpenRouter-Title": "AutoYT" } : {}),
        },
        body: JSON.stringify({
          ...payload,
          stream: true,
          ...(provider === "openrouter" ? { usage: { include: true }, stream_options: { include_usage: true } } : {}),
        }),
        signal: AbortSignal.any([stalled.signal, AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const error = new Error(`AI provider (${response.status}): ${String(data.error?.message || "Request failed").replaceAll(key, "[redacted]").slice(0, 350)}`);
        error.status = response.status;
        throw error;
      }
      const data = await readChatStream(response, { idleMs, onProgress, signal, stalled, bump });
      if (!data.usage) data.usage = estimatedStreamUsage(payload, data.choices?.[0]?.message?.content);
      meterResponse(provider, endpoint, payload, data);
      return data;
    } finally {
      clearTimeout(idle);
    }
  };

  if (vrKey && endpoint === "/chat/completions" && body) {
    try {
      // LiteLLM on VideoRouter only accepts temperature=1 for Claude Opus; other
      // values reject the whole model group and force an OpenRouter fallback.
      // Reasoning budgets are counted against max_tokens on VR hosts and truncate films.
      const { temperature: _temperature, reasoning: _reasoning, ...rest } = body;
      const payload = { ...rest, model: vrChatModel(body.model), temperature: 1 };
      const data = await run(VR_API, vrKey, "videorouter", payload);
      console.info(`[videorouter] chat ${payload.model} streamed ${data.choices?.[0]?.message?.content?.length || 0} chars`);
      return data;
    } catch (error) {
      signal?.throwIfAborted();
      if (!orKey) throw error;
      console.warn(`[videorouter] chat ${body.model || ""} fell back to OpenRouter: ${error.message}`);
    }
  }

  if (!orKey) throw new Error("AI generation isn't set up on the server yet.");
  return run(API, orKey, "openrouter", body);
}

export async function requestOpenRouter({ messages, kind = "text", model, json = false, maxTokens = 4096, temperature = 0.3, validate = undefined, plugins = undefined, reasoningEffort = undefined, ...options }) {
  const env = options.env || process.env;
  const selected = model || openRouterModel(kind, env);
  const fallback = kind === "vision" ? "qwen/qwen3.8-max-0902" : "deepseek/deepseek-v4.1-flash";
  const models = [...new Set([selected, fallback])];
  let lastError;
  for (const candidate of models) {
    options.signal?.throwIfAborted();
    try {
      const data = await openRouterRequest("/chat/completions", { ...options, body: {
        model: candidate, messages, max_tokens: maxTokens, temperature,
        provider: { allow_fallbacks: true }, reasoning: { exclude: true, ...(reasoningEffort ? { effort: reasoningEffort } : {}) },
        ...(json ? { response_format: { type: "json_object" } } : {}),
        ...(plugins?.length ? { plugins } : {}),
      } });
      const choice = data.choices?.[0];
      if (choice?.finish_reason === "length") throw new Error("The AI response was too long to finish.");
      if (choice?.finish_reason === "content_filter") throw new Error("The AI provider could not return this response.");
      const text = messageText(choice?.message);
      if (!text) throw new Error("The AI provider returned an empty response.");
      const value = json ? JSON.parse(text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) : text;
      validate?.(value);
      return { value, model: data.model || candidate };
    } catch (error) {
      options.signal?.throwIfAborted();
      lastError = error;
      if ([401, 402, 403].includes(error.status)) break;
    }
  }
  throw lastError;
}

export function geminiToOpenRouter(request) {
  const contents = typeof request.contents === "string" ? [{ parts: [{ text: request.contents }] }] : request.contents;
  const messages = (Array.isArray(contents) ? contents : [contents]).map((content) => ({
    role: content.role === "model" ? "assistant" : "user",
    content: (content.parts || [content]).map((part) => {
      if (typeof part.text === "string") return { type: "text", text: part.text };
      const media = part.inlineData || part.fileData;
      if (!media) throw new Error("Unsupported multimodal content.");
      const mime = media.mimeType || "";
      const url = part.inlineData ? `data:${mime};base64,${media.data}` : media.fileUri;
      if (mime.startsWith("image/")) return { type: "image_url", image_url: { url } };
      if (mime.startsWith("video/")) return { type: "video_url", video_url: { url } };
      throw new Error(`Unsupported media type: ${mime}`);
    }),
  }));
  const schema = request.config?.responseSchema;
  if (schema) messages.unshift({ role: "system", content: `Return valid JSON matching this schema: ${JSON.stringify(schema)}` });
  const instruction = request.config?.systemInstruction;
  if (instruction) messages.unshift({ role: "system", content: typeof instruction === "string" ? instruction : (instruction.parts || []).map((p) => p.text || "").join("\n") });
  return {
    messages, kind: "vision", json: request.config?.responseMimeType === "application/json",
    maxTokens: request.config?.maxOutputTokens || 8192,
    temperature: request.config?.temperature ?? 0.3,
    plugins: request.config?.tools?.some((tool) => tool.googleSearch) ? [{ id: "web", max_results: 5 }] : undefined,
  };
}

export async function transcribeOpenRouter(audio, format, options = {}) {
  const data = await openRouterRequest("/audio/transcriptions", { ...options, body: {
    model: openRouterModel("transcription", options.env), input_audio: { data: audio.toString("base64"), format },
  } });
  const text = String(data.text || "").trim();
  if (!text) throw new Error("No speech was detected in the audio.");
  return text;
}
