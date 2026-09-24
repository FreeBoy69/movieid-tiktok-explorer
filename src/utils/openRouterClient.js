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
  // Images without a usage block are charged at the flat per-image rate.
  const units = !usage && operation === "image" && body ? Math.max(1, Array.isArray(data.data) ? data.data.length : 1) : 0;
  if (!usage && !units) return;
  const id = String(data.id || "");
  meterUsage({ provider, model: data.model || body?.model || "", operation, usage, units, ref: id ? `${operation}:${id}` : "" });
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

// ---------- VideoRouter first for image and video jobs ----------
// VideoRouter (videorouter.sh) takes the same image and video request shapes as
// OpenRouter. When VIDEOROUTER_API_KEY is set, image and video jobs try it
// first and fall back to OpenRouter on any failure, a missing model, or a
// request VideoRouter can't honor (audio or video references). Its job ids are
// prefixed "vr:" so status polls and downloads return to it.
const VR_API = "https://videorouter.sh/api/v1";
// Filter-free "unrestricted" routes are never used, and VideoRouter's own
// OpenRouter pass-through would only loop back to the fallback.
const VR_BLOCKED = /(^|\/)(opensand|toapis|openrouter)\/|unrestricted/i;
const VR_ROUTES = ["", "fal/", "wavespeed/", "atlascloud/", "replicate/", "machgen/", "pika/", "together/", "novita/"];
const vrCatalog = { at: 0, images: new Set(), videos: new Set(), loading: null };

const videoRouterKey = (env) => (String(env.VIDEOROUTER_DISABLED || "") === "1" ? "" : String(env.VIDEOROUTER_API_KEY || "").trim());

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
    const error = new Error(`VideoRouter (${response.status}): ${detail}`);
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

// "openai/gpt-image-2" -> "gpt-image-2"; "bytedance/seedance-2.5" -> "fal/seedance-2.5".
export function videoRouterModel(model, available) {
  const name = String(model || "").split("/").pop();
  if (!name) return "";
  for (const route of VR_ROUTES) {
    const id = `${route}${name}`;
    if (available.has(id) && !VR_BLOCKED.test(id)) return id;
  }
  return "";
}

async function viaVideoRouter(endpoint, options) {
  const body = options.body || {};
  // Lip-synced drama clips send their dialogue as an audio reference, which
  // VideoRouter doesn't document; a clip that ignored it would lose the voices.
  if ((body.input_references || []).some((ref) => ref?.type && ref.type !== "image_url")) return null;
  const model = videoRouterModel(body.model, await vrModels(endpoint === "/images" ? "images" : "videos", options));
  if (!model) return null;
  if (endpoint === "/images") {
    const data = await vrFetch("/images", { ...options, body: { ...body, model } });
    const image = data.data?.[0];
    if (image?.b64_json) return data;
    if (image?.url && /^https:\/\//.test(image.url)) {
      const response = await (options.fetchImpl || fetch)(image.url, { signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw new Error(`VideoRouter image download failed (${response.status})`);
      const bytes = Buffer.from(await response.arrayBuffer());
      return { ...data, data: [{ ...image, b64_json: bytes.toString("base64") }] };
    }
    throw new Error("VideoRouter returned no image");
  }
  const created = await vrFetch("/videos", { ...options, body: { ...body, model, ...(body.duration ? { duration_secs: body.duration } : {}) } });
  const id = created.id || created.data?.id;
  if (!id) throw new Error("VideoRouter did not start the job");
  return { ...created, id: `vr:${id}` };
}

const VR_STATUS = { succeeded: "completed", success: "completed", complete: "completed", done: "completed", error: "failed", queued: "pending", processing: "in_progress", running: "in_progress" };
async function videoRouterJob(id, content, options) {
  const route = `/videos/${encodeURIComponent(id)}`;
  const status = await vrFetch(route, { ...options, body: undefined, binary: false, timeoutMs: 60000 });
  const normalized = { ...status, id: `vr:${id}`, status: VR_STATUS[String(status.status || "").toLowerCase()] || status.status };
  if (!content) return normalized;
  const url = status.url || status.video_url || status.output?.url || status.data?.[0]?.url || (Array.isArray(status.unsigned_urls) ? status.unsigned_urls[0] : "");
  if (!url) return vrFetch(`${route}/content`, { ...options, body: undefined, binary: true, timeoutMs: options.timeoutMs || 300000 });
  if (!/^https:\/\//.test(url)) throw new Error("VideoRouter returned an unusable video address");
  // Provider download links are presigned: no credentials go to them.
  const response = await (options.fetchImpl || fetch)(url, { signal: AbortSignal.timeout(options.timeoutMs || 300000) });
  if (!response.ok) throw new Error(`VideoRouter video download failed (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

export async function openRouterRequest(endpoint, options = {}) {
  const env = options.env || process.env;
  const job = String(endpoint).match(/^\/videos\/vr(?::|%3A)([^/?]+)(\/content)?$/i);
  if (job) return videoRouterJob(decodeURIComponent(job[1]), Boolean(job[2]), options);
  if (videoRouterKey(env) && options.body && (endpoint === "/images" || endpoint === "/videos")) {
    const routed = await viaVideoRouter(endpoint, options).catch((error) => {
      options.signal?.throwIfAborted();
      console.warn(`[videorouter] ${endpoint} ${options.body?.model || ""} fell back to OpenRouter: ${error.message}`);
      return null;
    });
    if (routed) return routed;
  }
  return openRouterDirect(endpoint, options);
}

async function openRouterDirect(endpoint, { body, signal, timeoutMs = 90000, binary = false, fetchImpl = fetch, env = process.env } = {}) {
  const key = String(env.OPENROUTER_API_KEY || "").trim();
  if (!key) throw new Error("OpenRouter is not configured.");
  // Never send credentials to provider-supplied polling or download URLs.
  if (!endpoint.startsWith("/") || endpoint.startsWith("//")) throw new Error("Invalid OpenRouter endpoint.");
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
    const error = new Error(`OpenRouter (${response.status}): ${detail}`);
    error.status = response.status;
    throw error;
  }
  meterResponse("openrouter", endpoint, body, data);
  return data;
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
      if (choice?.finish_reason === "length") throw new Error("OpenRouter output exceeded its token limit.");
      if (choice?.finish_reason === "content_filter") throw new Error("OpenRouter could not return this response.");
      const text = messageText(choice?.message);
      if (!text) throw new Error("OpenRouter returned an empty response.");
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
      if (!media) throw new Error("Unsupported multimodal content for OpenRouter.");
      const mime = media.mimeType || "";
      const url = part.inlineData ? `data:${mime};base64,${media.data}` : media.fileUri;
      if (mime.startsWith("image/")) return { type: "image_url", image_url: { url } };
      if (mime.startsWith("video/")) return { type: "video_url", video_url: { url } };
      throw new Error(`Unsupported OpenRouter media type: ${mime}`);
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
  if (!text) throw new Error("OpenRouter did not detect speech.");
  return text;
}
