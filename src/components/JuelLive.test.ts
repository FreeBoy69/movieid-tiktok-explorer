import { describe, expect, it } from "vitest";
import { nextSentences, speakable, turnPause } from "./JuelLive";
import { reactionTo } from "./JuelMascot";

describe("what Juel says out loud", () => {
  it("leaves out code, tables, links and formatting", () => {
    expect(speakable("**Done!** Here's the [video](https://x.y/z).\n\n| a | b |\n|---|---|\n\n```js\nx()\n```\nSee https://autoyt.cc")).toBe("Done! Here's the video. See the link");
  });

  it("speaks whole sentences as they arrive, and the rest at the end", () => {
    const text = "I found three channels in that niche. The first one started in May, and it";
    const first = nextSentences(text, 0, false);
    expect(first.sentences).toEqual(["I found three channels in that niche."]);
    const rest = nextSentences(`${text} already has 40K subscribers`, first.next, true);
    expect(rest.sentences).toEqual(["The first one started in May, and it already has 40K subscribers"]);
  });

  it("keeps very short bits with the next sentence", () => {
    expect(nextSentences("Okay. Let me check the numbers for you.", 0, false).sentences).toEqual(["Okay. Let me check the numbers for you."]);
  });
});

describe("turn-taking", () => {
  it("waits longer after a few words and less after a finished sentence", () => {
    expect(turnPause("make a", [])).toBeGreaterThan(turnPause("make a video about rome.", []));
    expect(turnPause("make a video about rome", [])).toBeGreaterThanOrEqual(700);
    expect(turnPause("make a video about rome", [])).toBeLessThanOrEqual(1500);
  });
});

describe("reactions", () => {
  it("reacts to what you say and to how a reply ends", () => {
    expect(reactionTo("can you dance?", "user")).toBe("dance");
    expect(reactionTo("thanks so much", "user")).toBe("love");
    expect(reactionTo("lol that's great", "user")).toBe("laugh");
    expect(reactionTo("Your video is posted to Night Tales.", "juel")).toBe("party");
    expect(reactionTo("Sorry, I couldn't reach the voice service.", "juel")).toBe("sad");
    expect(reactionTo("make a recap of Alien", "user")).toBeNull();
  });
});
