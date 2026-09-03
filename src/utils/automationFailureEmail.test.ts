import { describe, expect, it, vi } from "vitest";
import { buildAutomationFailureEmail, sendAutomationFailureEmail } from "./automationFailureEmail.js";

describe("automation failure email", () => {
  it("builds a responsive, theme-aware AutoYT alert and escapes run data", () => {
    const message = buildAutomationFailureEmail({
      agentName: "Manga <Kun>",
      channelTitle: "Manga-kun",
      error: "Upload failed & stopped",
      category: "publishing",
      phase: "publishing",
      failedAt: "2026-09-03T09:00:00.000Z",
      timezone: "Africa/Nairobi",
      retryAt: "2026-09-03T12:00:00.000Z",
      retryScheduled: true,
      runUrl: "https://autoyt.cc/automation/manga-kun?tab=runs",
      runId: "run_123",
    });

    expect(message.subject).toContain("Manga <Kun>");
    expect(message.html).toContain("prefers-color-scheme: dark");
    expect(message.html).toContain("meta name=\"color-scheme\"");
    expect(message.html).toContain("Manga &lt;Kun&gt;");
    expect(message.html).not.toContain("Manga <Kun>");
    expect(message.html).toContain("Open run details");
    expect(message.text).toContain("Upload failed & stopped");
  });

  it("does not call the provider when email delivery is not configured", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await sendAutomationFailureEmail({ to: "owner@example.com", subject: "Test", html: "<p>Test</p>", text: "Test" }, { apiKey: "" });
    expect(result).toEqual(expect.objectContaining({ sent: false, reason: "email_provider_not_configured" }));
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
