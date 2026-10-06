import { describe, expect, it } from "vitest";
import { cameraSprite } from "./cameraPreviews.js";
import { cameraOptions } from "./cameraShots.js";

describe("camera preview sprites", () => {
  it("places every option on its group's grid in catalogue order", () => {
    for (const group of ["angle", "shot", "perspective", "motion"]) {
      const options = cameraOptions(group);
      options.forEach((option: { id: string }, index: number) => {
        const sprite = cameraSprite(group, option.id)!;
        expect(sprite.url).toBe(`/assets/cinema/camera-${group}.webp`);
        expect(sprite.row * sprite.columns + sprite.column).toBe(index);
        expect(sprite.row).toBeLessThan(sprite.rows);
      });
    }
    expect(cameraSprite("angle", "nope")).toBeNull();
  });
});
