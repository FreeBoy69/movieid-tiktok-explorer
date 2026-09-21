const API = "https://openrouter.ai/api/v1";

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

export async function openRouterRequest(endpoint, { body, signal, timeoutMs = 90000, binary = false, fetchImpl = fetch, env = process.env } = {}) {
  const key = String(env.OPENROUTER_API_KEY || "").trim();
  if (!key) throw new Error("OpenRouter is not configured.");
  // Never send credentials to provider-supplied polling or download URLs.
  if (!endpoint.startsWith("/") || endpoint.startsWith("//")) throw new Error("Invalid OpenRouter endpoint.");
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
  return data;
}

export async function requestOpenRouter({ messages, kind = "text", model, json = false, maxTokens = 4096, temperature = 0.3, validate = undefined, plugins = undefined, ...options }) {
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
        provider: { allow_fallbacks: true }, reasoning: { exclude: true },
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
