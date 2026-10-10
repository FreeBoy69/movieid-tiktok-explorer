import { describe, expect, it } from "vitest";
import { isEcho, nextSentences, resumeAt, speakable, turnPause } from "./JuelLive";
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
    expect(turnPause("make a video about rome", [])).toBeGreaterThanOrEqual(550);
    expect(turnPause("make a video about rome", [])).toBeLessThanOrEqual(1200);
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

describe("live mode echo and replies", () => {
  it("knows his own words coming back from yours", () => {
    const said = new Set(["hi", "there", "i'm", "juel", "what", "are", "we", "making", "today"]);
    expect(isEcho("what are we making today", said)).toBe(true);
    expect(isEcho("Hi there I'm Juel", said)).toBe(true);
    expect(isEcho("make a video about rome", said)).toBe(false);
    expect(isEcho("anything", new Set())).toBe(false);
  });
  it("never says the same words twice when the reply's text changes", () => {
    expect(resumeAt("Hello there. How are", 13, "Hello there. How are you?")).toBe(13);
    expect(resumeAt("Rome it is.!", 12, "Rome it is.")).toBe(11);
    expect(resumeAt("On it.", 6, "Something else entirely.")).toBe(0);
  });
});
