import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PostClip } from "./StudioGallery";

const clip = { file: "clip-0.mp4", url: "/api/creator/files/clip-0.mp4", type: "video/mp4", title: "The best moment", caption: "Why it works" };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Post a clip", () => {
  it("uploads the clip to the chosen channel with its schedule", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/auth/session")) return new Response(JSON.stringify({ user: { id: "u" }, accounts: [{ id: "acc1", email: "", channelId: "c", channelTitle: "My Channel", platform: "youtube" }], activeAccount: null, googleConfigured: true }));
      if (url === clip.url) return new Response(new Blob(["mp4"], { type: "video/mp4" }));
      if (url.startsWith("/api/youtube/videos/upload")) return new Response(JSON.stringify({ video: { id: "v1", url: "https://youtube.com/watch?v=v1" } }));
      throw new Error(`unexpected ${url} ${init?.method}`);
    });
    vi.stubGlobal("fetch", fetcher);
    const onTile = vi.fn();
    render(<div onClick={onTile}><PostClip output={clip} /></div>);

    fireEvent.click(screen.getByRole("button", { name: "Post to a channel" }));
    fireEvent.click(await screen.findByText("My Channel"));
    expect(screen.getByDisplayValue("The best moment")).toBeTruthy();
    expect(screen.getByDisplayValue("Why it works")).toBeTruthy();
    const when = new Date(Date.now() + 86_400_000);
    const local = new Date(when.getTime() - when.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    fireEvent.change(screen.getByLabelText(/Schedule/), { target: { value: local } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));

    await waitFor(() => expect(fetcher.mock.calls.some(([u]) => String(u).startsWith("/api/youtube/videos/upload"))).toBe(true));
    const [url, init] = fetcher.mock.calls.find(([u]) => String(u).startsWith("/api/youtube/videos/upload"))!;
    const params = new URL(String(url), "https://autoyt.cc").searchParams;
    expect(params.get("accountId")).toBe("acc1");
    expect(params.get("title")).toBe("The best moment");
    expect(params.get("privacyStatus")).toBe("public");
    expect(Math.abs(Date.parse(params.get("publishAt")!) - when.getTime())).toBeLessThan(60_000);
    expect(init?.method).toBe("POST");
    expect(onTile).not.toHaveBeenCalled();
  });
});
