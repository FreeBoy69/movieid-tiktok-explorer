import { describe, expect, it } from "vitest";
import { isEcho, nextSentences, resumeAt, speakable, thoughtState, turnPause } from "./JuelLive";
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
  it("knows a finished thought from one that stopped mid-sentence", () => {
    expect(thoughtState("make me a video about ancient Rome")).toBe("done");
    expect(thoughtState("what's trending this week?")).toBe("done");
    expect(thoughtState("hello")).toBe("done");
    expect(thoughtState("yes")).toBe("done");
    expect(thoughtState("thank you")).toBe("done");
    expect(thoughtState("make me a video about")).toBe("open");
    expect(thoughtState("I want to make a video and")).toBe("open");
    expect(thoughtState("can you um")).toBe("open");
    expect(thoughtState("check the")).toBe("open");
    expect(thoughtState("new channel")).toBe("unsure");
    expect(thoughtState("")).toBe("open");
  });
  it("answers quickly after a finished thought and waits after an unfinished one", () => {
    expect(turnPause("make me a video about rome", [], true)).toBeLessThanOrEqual(300);
    expect(turnPause("make me a video about rome", [])).toBeLessThanOrEqual(500);
    expect(turnPause("make me a video about", [])).toBeGreaterThanOrEqual(1200);
    expect(turnPause("new channel", [])).toBeGreaterThan(turnPause("new channel", [], true));
    // A slow talker gets more room than a quick one.
    expect(turnPause("make me a video", [700, 700, 700])).toBeGreaterThan(turnPause("make me a video", [250, 250, 250]));
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
  it("treats a one-word interruption as a complete utterance", () => {
    expect(thoughtState("hi")).toBe("done");
    expect(thoughtState("stop")).toBe("done");
  });
  it("never says the same words twice when the reply's text changes", () => {
    expect(resumeAt("Hello there. How are", 13, "Hello there. How are you?")).toBe(13);
    expect(resumeAt("Rome it is.!", 12, "Rome it is.")).toBe(11);
    expect(resumeAt("On it.", 6, "Something else entirely.")).toBe(0);
  });
});
