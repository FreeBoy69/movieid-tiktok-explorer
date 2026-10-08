// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { installInputModality } from "./inputModality";

describe("installInputModality", () => {
  let stop: () => void = () => {};
  afterEach(() => stop());

  it("shows keyboard mode only after navigation keys, and pointer mode after a click", () => {
    stop = installInputModality();
    const root = document.documentElement;
    expect(root.dataset.input).toBe("pointer");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(root.dataset.input).toBe("pointer");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    expect(root.dataset.input).toBe("keyboard");
    window.dispatchEvent(new Event("pointerdown"));
    expect(root.dataset.input).toBe("pointer");
  });

  it("ignores caret keys inside a text field but not Tab", () => {
    stop = installInputModality();
    const input = document.createElement("input");
    document.body.append(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(document.documentElement.dataset.input).toBe("pointer");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.documentElement.dataset.input).toBe("keyboard");
    input.remove();
  });
});
