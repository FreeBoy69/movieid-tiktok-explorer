import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { JUEL_POSES, JuelMascot, setJuelMood, useJuelMood } from "./JuelMascot";

describe("Juel the character", () => {
  it("draws every pose, full and as a bust", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    for (const { pose } of JUEL_POSES) {
      act(() => root.render(<JuelMascot pose={pose} size={100} />));
      const svg = host.querySelector("svg.jm")!;
      expect(svg.getAttribute("data-pose")).toBe(pose);
      // Arms and feet in the full figure; the bust is just body, eyes and mouth.
      expect(svg.querySelector(".jm-arm-r")).not.toBeNull();
      act(() => root.render(<JuelMascot pose={pose} size={24} framing="bust" />));
      expect(host.querySelector(".jm-arm-r")).toBeNull();
      expect(host.querySelector(".jm-legs")).toBeNull();
    }
    act(() => root.unmount());
  });

  it("shares one mood between every Juel on screen", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    function Shown() {
      return <span>{useJuelMood("wave")}</span>;
    }
    act(() => root.render(<Shown />));
    expect(host.textContent).toBe("wave");
    act(() => setJuelMood("think"));
    expect(host.textContent).toBe("think");
    act(() => setJuelMood("idle"));
    expect(host.textContent).toBe("wave");
    act(() => root.unmount());
  });
});
