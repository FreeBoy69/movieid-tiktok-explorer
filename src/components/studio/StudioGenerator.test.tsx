import { useCallback, useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { defaultDraft, type Draft, StudioGenerator } from "./StudioGenerator";
import type { Catalog, VideoModel } from "./studioShared";

const video = (id: string, name: string, frames: string[]): VideoModel => ({
  id, name, provider: id.split("/")[0], description: "", aspectRatios: ["16:9"], resolutions: ["720p"], durations: [5], frames, audio: false, pricePerSecond: null,
});
const catalog: Catalog = {
  configured: true,
  image: [],
  video: [
    video("alibaba/wan-3.0", "Wan 3.0", ["first_frame"]),
    video("bytedance/seedance-2.0-fast", "Seedance 2.0 Fast", ["first_frame", "last_frame"]),
    video("openai/sora-2-pro", "Sora 2 Pro", []),
  ],
  avatar: [], edit: [], upscale: [], motion: [],
  music: { available: false, name: "", reason: "" },
  voices: [], agents: [], workflows: [],
};
const image = { file: "a.png", url: "/a.png", type: "image/png" };

function Harness({ initial }: { initial: Draft }) {
  const [draft, setDraft] = useState<Draft>({ ...defaultDraft(), ...initial });
  const patch = useCallback((changes: Draft) => setDraft((current) => ({ ...current, ...changes })), []);
  return (
    <StudioGenerator app="video" catalog={catalog} catalogLoading={false} generations={[]} draft={draft} patch={patch} now={0}
      onCreated={() => {}} onRefresh={() => {}} onRemoved={() => {}} onSend={() => {}} />
  );
}
const modes = () => within(screen.getByRole("radiogroup", { name: "Video input" })).getAllByRole("radio").map((r) => r.textContent);
const pickModel = (name: string) => {
  fireEvent.click(screen.getByRole("button", { name: /Wan 3.0|Seedance 2.0 Fast|Sora 2 Pro/ }));
  fireEvent.click(within(screen.getByRole("listbox", { name: "Models" })).getByRole("option", { name: new RegExp(name) }));
};

describe("Video Studio composer follows the model", () => {
  it("offers start and end frames only on models that take both", () => {
    render(<Harness initial={{ model: "bytedance/seedance-2.0-fast" }} />);
    expect(modes()).toEqual(["Text", "Start frame", "Start + end"]);
    expect(screen.queryByRole("button", { name: "Start frame" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Start + end" }));
    expect(screen.getByRole("button", { name: "Start frame" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "End frame" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Prompt" }).getAttribute("placeholder")).toMatch(/start to end/);
  });

  it("narrows the mode when a model with fewer inputs is picked", () => {
    render(<Harness initial={{ model: "bytedance/seedance-2.0-fast", frameMode: "first-last" }} />);
    pickModel("Wan 3.0");
    expect(modes()).toEqual(["Text", "Start frame"]);
    expect(screen.getByRole("radio", { name: "Start frame" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByRole("button", { name: "End frame" })).toBeNull();
    pickModel("Sora 2 Pro");
    expect(screen.queryByRole("radiogroup", { name: "Video input" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Start frame" })).toBeNull();
  });

  it("swaps to a frame-capable model when an image arrives on a text-only one", () => {
    render(<Harness initial={{ model: "openai/sora-2-pro", frameMode: "first", firstFrame: image }} />);
    expect(screen.getByRole("button", { name: /Wan 3.0/ })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Start frame" })).toBeTruthy();
  });

  it("opens drafts saved on the old Image to video tab in start-frame mode", () => {
    render(<Harness initial={{ videoTab: "image", model: "alibaba/wan-3.0" }} />);
    expect(screen.getByRole("tab", { name: "Generate" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("radio", { name: "Start frame" }).getAttribute("aria-checked")).toBe("true");
  });
});
