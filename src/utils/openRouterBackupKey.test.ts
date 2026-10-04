import { describe, expect, it, vi } from "vitest";
import { aiProviderChain, openRouterConfigured, openRouterKeys, openRouterRequest, shouldTryNextOpenRouterKey, withOpenRouterKeys } from "./openRouterClient.js";

const env = (extra: Record<string, string>) => ({ APP_URL: "https://autoyt.cc", ...extra }) as unknown as NodeJS.ProcessEnv;
const err = (status?: number, name?: string) => Object.assign(new Error("x"), status ? { status } : {}, name ? { name } : {});

describe("OpenRouter backup key", () => {
  it("lists the primary, then the backup, without duplicates", () => {
    expect(openRouterKeys(env({ OPENROUTER_API_KEY: "a", OPENROUTER_API_KEY_BACKUP: "b" }))).toEqual(["a", "b"]);
    expect(openRouterKeys(env({ OPENROUTER_API_KEY_BACKUP: " b " }))).toEqual(["b"]);
    expect(openRouterKeys(env({ OPENROUTER_API_KEY: "a", OPENROUTER_API_KEY_BACKUP: "a" }))).toEqual(["a"]);
    expect(openRouterKeys(env({ OPENROUTER_API_KEY: " a , b " }))).toEqual(["a", "b"]);
    expect(openRouterConfigured(env({ OPENROUTER_API_KEY_BACKUP: "b" }))).toBe(true);
    expect(aiProviderChain(env({ OPENROUTER_API_KEY: "a", OPENROUTER_API_KEY_BACKUP: "b" })).map((p) => p.key)).toEqual(["a", "b"]);
  });

  it("moves to the next key only for key, credit, rate, server, or network failures", () => {
    for (const status of [401, 402, 403, 429, 500, 503]) expect(shouldTryNextOpenRouterKey(err(status))).toBe(true);
    expect(shouldTryNextOpenRouterKey(err())).toBe(true);
    expect(shouldTryNextOpenRouterKey(err(400))).toBe(false);
    expect(shouldTryNextOpenRouterKey(err(undefined, "AbortError"))).toBe(false);
    expect(shouldTryNextOpenRouterKey(err(undefined, "UsageBlockedError"))).toBe(false);
  });

  it("tries the backup when the primary is out of credit, and stops on a bad request", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const seen: string[] = [];
    const value = await withOpenRouterKeys(env({ OPENROUTER_API_KEY: "a", OPENROUTER_API_KEY_BACKUP: "b" }), async (key) => {
      seen.push(key);
      if (key === "a") throw err(402);
      return "ok";
    });
    expect(value).toBe("ok");
    expect(seen).toEqual(["a", "b"]);
    const tried: string[] = [];
    await expect(withOpenRouterKeys(env({ OPENROUTER_API_KEY: "a", OPENROUTER_API_KEY_BACKUP: "b" }), async (key) => { tried.push(key); throw err(400); })).rejects.toThrow();
    expect(tried).toEqual(["a"]);
  });

  it("sends a direct request with the backup key after the primary is rejected", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const auth: string[] = [];
    const fetchImpl = async (_url: string, init: RequestInit) => {
      const header = String((init.headers as Record<string, string>).Authorization);
      auth.push(header);
      return header.endsWith("primary")
        ? new Response(JSON.stringify({ error: { message: "Insufficient credits" } }), { status: 402 })
        : new Response(JSON.stringify({ id: "1", model: "m", choices: [{ message: { content: "hi" } }] }), { status: 200 });
    };
    const data = await openRouterRequest("/models", { fetchImpl, env: env({ OPENROUTER_API_KEY: "primary", OPENROUTER_API_KEY_BACKUP: "backup" }) } as any);
    expect(data.id).toBe("1");
    expect(auth).toEqual(["Bearer primary", "Bearer backup"]);
  });
});
