import { setTimeout as delay } from "node:timers/promises";

function failure(message, code, status = 0) {
  return Object.assign(new Error(message), { code, status });
}

// Retry generation only. Publishing and other side effects remain outside this client.
export async function requestDeepSeek(options) {
  const { apiKey, baseUrl = "https://api.deepseek.com", model, messages,
    json = false, validate, onResult, signal, fetchImpl = globalThis.fetch,
    sleep = (ms, abortSignal) => delay(ms, undefined, { signal: abortSignal }),
    logger = console } = options;
  if (!apiKey) throw failure("DEEPSEEK_API_KEY is not configured.", "configuration");
  const timeoutMs = Math.min(600000, Math.max(1000, Number(options.timeoutMs) || 90000));
  const totalMs = Math.min(600000, Math.max(timeoutMs, Number(options.totalTimeoutMs) || 150000));
  const deadline = Date.now() + totalMs;
  let maxTokens = Math.min(32768, Math.max(256, Number(options.maxTokens) || (json ? 3072 : 4096)));
  let thinking = options.thinking || { type: "disabled" };
  let repair = false;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    signal?.throwIfAborted();
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const timeout = AbortSignal.timeout(Math.min(timeoutMs, remaining));
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let retryAfterMs = 0;
    try {
      const response = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: repair ? [...messages, { role: "user", content: json
            ? "Return one complete, nonempty JSON object with all requested fields and correct field types. Be concise; no markdown or extra prose."
            : "Return the complete requested answer. Do not leave it empty or end mid-sentence." }] : messages,
          thinking,
          ...(thinking.type === "enabled" ? { reasoning_effort: "low" } : {
            temperature: Number.isFinite(options.temperature) ? options.temperature : 0.3,
          }),
          max_tokens: maxTokens,
          ...(json ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: requestSignal,
      });
      const retryAfter = response.headers?.get?.("retry-after");
      if (retryAfter) retryAfterMs = Math.max(0, Number.isFinite(Number(retryAfter))
        ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now());
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        // Never include provider bodies: they may echo credentials or private prompts.
        throw failure(`DeepSeek request failed (HTTP ${response.status}).`, "http", response.status);
      }
      const choice = data?.choices?.[0];
      if (choice?.finish_reason === "length") throw failure("DeepSeek output limit reached before completion.", "length");
      if (choice?.finish_reason && choice.finish_reason !== "stop")
        throw failure("DeepSeek did not return a completed answer.", "incomplete");
      const content = String(choice?.message?.content || "").trim();
      if (!content) throw failure("DeepSeek returned an empty answer.", "invalid_response");
      let value = content;
      if (json) {
        try {
          value = JSON.parse(content.replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, "$1"));
          if (!value || typeof value !== "object" || Array.isArray(value) || !Object.keys(value).length) throw new Error();
        } catch { throw failure("DeepSeek returned invalid or empty JSON.", "invalid_response"); }
      }
      if (validate) {
        try { validate(value); }
        catch { throw failure("DeepSeek response did not match the required fields.", "invalid_response"); }
      }
      const info = { provider: "deepseek", model, attempts: attempt,
        promptTokens: Number(data?.usage?.prompt_tokens) || 0,
        completionTokens: Number(data?.usage?.completion_tokens) || 0 };
      logger.info?.("DeepSeek generation completed", info);
      onResult?.(info);
      return value;
    } catch (error) {
      signal?.throwIfAborted();
      lastError = error;
      const retryable = ["length", "invalid_response"].includes(error.code)
        || (error.code === "http" && ([408, 409, 429].includes(error.status) || error.status >= 500))
        || error.name === "TimeoutError" || error.name === "AbortError" || error instanceof TypeError;
      if (!retryable || attempt === 3) throw error;
      if (error.code === "length") {
        maxTokens = Math.min(32768, maxTokens * 2);
        thinking = { type: "disabled" };
      }
      repair = ["length", "invalid_response"].includes(error.code);
      const waitMs = Math.max(retryAfterMs || 0, repair ? 0 : Math.min(10000, 500 * 2 ** (attempt - 1) + Math.random() * 250));
      if (waitMs >= deadline - Date.now()) break;
      logger.warn?.("DeepSeek retry", { model, attempt, code: error.code || error.name, status: error.status || 0, maxTokens });
      if (waitMs) await sleep(waitMs, signal);
    }
  }
  throw lastError || failure("DeepSeek request deadline exceeded.", "timeout");
}
