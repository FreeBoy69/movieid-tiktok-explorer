import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ModelPicker, type VideoModel } from "./studioShared";

const video: VideoModel = {
  id: "example/video", name: "Example Video", provider: "Example", description: "",
  aspectRatios: ["16:9"], resolutions: ["720p"], durations: [5], frames: [], audio: false,
  pricePerSecond: 0.14,
};

describe("studio model prices", () => {
  it("shows the configured credit estimate instead of provider dollars", () => {
    render(<ModelPicker models={[video]} value={video.id} onChange={() => {}} loading={false} pricing={{ tokensPerUsd: 750_000, flatTokens: {} }} />);
    fireEvent.click(screen.getByRole("button", { name: /Example Video/ }));
    const option = within(screen.getByRole("listbox", { name: "Models" })).getByRole("option", { name: /Example Video/ });
    expect(option.textContent).toContain("≈ 1,050 credits/s");
    expect(option.textContent).not.toContain("$");
  });
});
