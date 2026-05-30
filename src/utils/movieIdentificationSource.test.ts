import { describe, expect, it } from "vitest";
import {
  attachMovieIdentificationSource,
  getMovieIdentificationSourceDisplay,
  resolveMovieIdentificationSource,
} from "./movieIdentificationSource.js";

describe("movieIdentificationSource", () => {
  it("labels comment reply results", () => {
    const result = attachMovieIdentificationSource({
      title: "Xam'd: Lost Memories",
      commentHint: {
        source: "comment_reply",
        format: "informal_its_reply",
        replyText: "Its Xam'd: Lost Memories",
      },
    }, "tiktok-comments");
    expect(result.identificationSource).toBe("comment-reply");
    expect(result.identificationSourceLabel).toBe("Comment agent");
  });

  it("labels cached and ai paths", () => {
    expect(resolveMovieIdentificationSource({ title: "Dorohedoro" }, "movie-cache")).toBe("cache");
    expect(resolveMovieIdentificationSource({ title: "Dorohedoro" }, "tikwm-no-watermark")).toBe("ai-video");
  });

  it("infers comment reply from legacy reasoning text", () => {
    const display = getMovieIdentificationSourceDisplay({
      title: "Peacemaker",
      evidence: { reasoning: 'TikTok comment reply: "Peacemaker series"' },
    });
    expect(display.source).toBe("comment-reply");
    expect(display.label).toBe("Comment agent");
  });
});
