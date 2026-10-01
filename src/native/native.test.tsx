// @vitest-environment-options { "url": "http://localhost/channels" }
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({ value: null as "ios" | "android" | null }));
vi.mock("./platform", () => ({
  nativePlatform: () => platform.value,
  isNativeApp: () => platform.value !== null,
  purchasesAllowed: () => platform.value === null,
}));

import { isAuthStartHref } from "./auth";
import { isDownloadLink } from "./downloads";
import { activeTabId, isHubPath, NativeTabBar } from "./NativeTabBar";

const anchor = (href: string, download?: string) => {
  const a = document.createElement("a");
  a.setAttribute("href", href);
  if (download !== undefined) a.setAttribute("download", download);
  return a;
};

describe("native link handling", () => {
  it("recognises sign-in and connect links", () => {
    expect(isAuthStartHref("/api/auth/google?mode=signin&next=/channels")).toBe(true);
    expect(isAuthStartHref("/api/auth/social/instagram?next=/channels")).toBe(true);
    expect(isAuthStartHref("/api/auth/session")).toBe(false);
    expect(isAuthStartHref("https://accounts.google.com/api/auth/google")).toBe(false);
  });

  it("recognises downloads but not the downloader page", () => {
    expect(isDownloadLink(anchor("/api/x.mp4", "clip.mp4"))).toBe(true);
    expect(isDownloadLink(anchor("/api/studio/files/a.mp4?download=1"))).toBe(true);
    expect(isDownloadLink(anchor("/api/compilations/download/final.mp4"))).toBe(true);
    expect(isDownloadLink(anchor("/api/maker/projects/p1/scene-images.zip?accountId=a"))).toBe(true);
    expect(isDownloadLink(anchor("/downloader"))).toBe(false);
    expect(isDownloadLink(anchor("/channels"))).toBe(false);
  });
});

describe("NativeTabBar", () => {
  afterEach(() => {
    platform.value = null;
  });

  it("renders nothing on the web", () => {
    const { container } = render(<NativeTabBar />);
    expect(container.firstChild).toBeNull();
  });

  it("marks the current section in the app", () => {
    platform.value = "ios";
    render(<NativeTabBar />);
    expect(screen.getByRole("link", { name: "Channels" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Explore" }).getAttribute("aria-current")).toBeNull();
    expect(document.documentElement.dataset.nativeTabbar).toBe("on");
  });

  it("shows on hub screens only", () => {
    for (const path of ["/", "/tools", "/create", "/projects", "/agent", "/channels", "/feed"]) expect(isHubPath(path)).toBe(true);
    for (const path of ["/studio/video", "/projects/p1/brief", "/agent/my-agent/chat", "/tools/transcriber", "/tts"]) expect(isHubPath(path)).toBe(false);
    expect(activeTabId("/projects/p1/brief")).toBe("create");
    expect(activeTabId("/agent/my-agent/chat")).toBe("agents");
    expect(activeTabId("/")).toBe("explore");
    expect(activeTabId("/tts")).toBeNull();
  });
});
