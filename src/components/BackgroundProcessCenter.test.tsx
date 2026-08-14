import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackgroundProcessCenter, backgroundProcessEtaLabel } from "./BackgroundProcessCenter";

describe("BackgroundProcessCenter", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
        clear: () => storage.clear(),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("describes ETA calibration and overrun states honestly", () => {
    const now = new Date("2026-08-14T12:00:00Z").getTime();
    const process = {
      id: "job_1",
      kind: "compilation" as const,
      status: "running" as const,
      title: "Long compilation",
      message: "Preparing clips",
      progress: 10,
      createdAt: now - 30_000,
      updatedAt: now,
    };

    expect(backgroundProcessEtaLabel(process, now)).toBe("Calculating ETA");
    expect(backgroundProcessEtaLabel({ ...process, etaAt: now + 20_000 }, now)).toBe("Finishing now");
    expect(backgroundProcessEtaLabel({ ...process, etaAt: now - 31_000 }, now)).toBe("Taking longer than expected");
    expect(backgroundProcessEtaLabel({ ...process, status: "stopping" }, now)).toBe("Stopping safely");
  });

  it("shows active work and opens its owning workspace", async () => {
    const process = {
      id: "compjob_1",
      kind: "compilation" as const,
      status: "running" as const,
      title: "Anime highlights compilation",
      message: "Preparing clip 12 of 54",
      progress: 38,
      etaAt: Date.now() + 8 * 60_000,
      etaConfidence: "medium",
      agentId: "agent_1",
      createdAt: Date.now() - 90_000,
      updatedAt: Date.now(),
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ processes: [process] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    const onOpenProcess = vi.fn();

    render(<BackgroundProcessCenter onOpenProcess={onOpenProcess} />);

    const trigger = await screen.findByRole("button", { name: "Open background activity, 1 active" });
    fireEvent.click(trigger);
    expect(await screen.findByText("Anime highlights compilation")).toBeInTheDocument();
    expect(screen.getByText("Preparing clip 12 of 54")).toBeInTheDocument();
    expect(screen.getByText(/About 8m left/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(onOpenProcess).toHaveBeenCalledWith(expect.objectContaining({ id: "compjob_1", agentId: "agent_1" })));
  });
});
