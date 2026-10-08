import { describe, expect, it } from "vitest";
import { emptyProject } from "../../utils/vibeEdit";
import { gestureKey, vibe } from "./store";

const renamed = (name: string) => (p: ReturnType<typeof emptyProject>) => ({ ...p, name });

describe("undo history for gestures", () => {
  it("gives every drag its own key", () => {
    expect(gestureKey("drag:c1")).not.toBe(gestureKey("drag:c1"));
  });

  it("folds a whole drag into one step, even a slow one", () => {
    vibe.load(emptyProject("Start"));
    const key = gestureKey("drag:x");
    vibe.commit(renamed("A"), key);
    vibe.commit(renamed("B"), key);
    vibe.commit(renamed("C"), key, { fold: true });
    expect(vibe.get().past).toHaveLength(1);
    vibe.undo();
    expect(vibe.get().project.name).toBe("Start");
  });

  it("drops the step of a gesture that was put back", () => {
    vibe.load(emptyProject("Start"));
    const base = vibe.get().project;
    const key = gestureKey("drag:y");
    vibe.commit(renamed("Moved"), key);
    vibe.commit(base, key, { fold: true });
    expect(vibe.get().past).toHaveLength(0);
    expect(vibe.get().project).toBe(base);
  });

  it("keeps two drags of the same item as two steps", () => {
    vibe.load(emptyProject("Start"));
    vibe.commit(renamed("One"), gestureKey("drag:z"));
    vibe.commit(renamed("Two"), gestureKey("drag:z"));
    expect(vibe.get().past).toHaveLength(2);
  });
});
