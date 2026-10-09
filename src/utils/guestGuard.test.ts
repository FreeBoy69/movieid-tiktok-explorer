// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { installGuestGuard } from "./guestGuard";

describe("installGuestGuard", () => {
  let stop: () => void = () => {};
  afterEach(() => stop());

  it("opens sign-in instead of sending an action, and lets reads through", async () => {
    const real = vi.fn(async () => new Response("{}", { status: 200 }));
    window.fetch = real as unknown as typeof fetch;
    const onSignIn = vi.fn();
    stop = installGuestGuard(onSignIn);

    const blocked = await fetch("/api/studio/generate", { method: "POST", body: "{}" });
    expect(blocked.status).toBe(401);
    expect(onSignIn).toHaveBeenCalledTimes(1);
    expect(real).not.toHaveBeenCalled();

    await fetch("/api/studio/catalog");
    await fetch("/api/auth/logout", { method: "POST" });
    await fetch("https://example.com/upload", { method: "POST" });
    expect(real).toHaveBeenCalledTimes(3);
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });
});
