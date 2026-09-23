import { describe, expect, it } from "vitest";
import { addressReply, commentCheckMinutes, isOwnerComment, reachedCheckedComments, threadIdOf, threadReplyTarget } from "./commentThreads.js";

const account = { channelId: "UCowner", channelTitle: "Recap Hub" };
const c = (id: string, author: string, text: string, at: string, owner = false) => ({
  id,
  authorDisplayName: author,
  authorChannelId: owner ? "UCowner" : `UC${author}`,
  textOriginal: text,
  publishedAt: at,
});

describe("comment thread targets", () => {
  it("answers a fresh top-level comment", () => {
    const top = c("T1", "@amy", "What movie is this?", "2026-09-23T10:00:00Z");
    expect(threadReplyTarget({ topLevelComment: top, replies: [] }, account)).toMatchObject({ kind: "comment", comment: { id: "T1" }, threadId: "T1" });
  });

  it("skips a thread the channel answered last", () => {
    const thread = {
      topLevelComment: c("T1", "@amy", "Name?", "2026-09-23T10:00:00Z"),
      replies: [c("T1.r1", "Recap Hub", "Movie: Heat (1995)", "2026-09-23T10:05:00Z", true)],
    };
    expect(threadReplyTarget(thread, account)).toBeNull();
  });

  it("catches the viewer's follow-up after the channel's reply", () => {
    const thread = {
      topLevelComment: c("T1", "@amy", "Name?", "2026-09-23T10:00:00Z"),
      replies: [
        c("T1.r2", "@amy", "Is there a part 2?", "2026-09-23T11:00:00Z"),
        c("T1.r1", "Recap Hub", "Movie: Heat (1995)", "2026-09-23T10:05:00Z", true),
      ],
    };
    const target = threadReplyTarget(thread, account)!;
    expect(target).toMatchObject({ kind: "follow_up", comment: { id: "T1.r2" }, threadId: "T1" });
    expect(target.context.map((m: any) => m.owner)).toEqual([false, true, false]);
    expect(addressReply(target, "Not yet, but fingers crossed!")).toBe("@amy Not yet, but fingers crossed!");
  });

  it("recognises the owner by channel id or title and splits reply ids", () => {
    expect(isOwnerComment({ authorChannelUrl: "http://www.youtube.com/channel/UCowner" }, account)).toBe(true);
    expect(isOwnerComment({ authorDisplayName: "recap hub" }, account)).toBe(true);
    // Zernio comments carry only a name and an @handle URL.
    expect(isOwnerComment({ authorDisplayName: "RH", authorChannelUrl: "https://www.youtube.com/@RecapHub" }, { ...account, channelHandle: "@recaphub" })).toBe(true);
    expect(isOwnerComment({ authorDisplayName: "@someone", authorChannelUrl: "https://www.youtube.com/@someone" }, { ...account, channelHandle: "@recaphub" })).toBe(false);
    expect(threadIdOf("Ugx123.8abcDEF")).toBe("Ugx123");
  });
});

describe("comment check cadence", () => {
  it("checks new videos every few minutes and stops after 60 days", () => {
    expect(commentCheckMinutes(1)).toBe(5);
    expect(commentCheckMinutes(12)).toBe(10);
    expect(commentCheckMinutes(48)).toBe(30);
    expect(commentCheckMinutes(24 * 7)).toBe(120);
    expect(commentCheckMinutes(24 * 30)).toBe(720);
    expect(commentCheckMinutes(24 * 61)).toBeNull();
  });

  it("stops paging once a page reaches comments the last check saw", () => {
    const page = [{ topLevelComment: { publishedAt: "2026-09-23T12:00:00Z" } }, { topLevelComment: { publishedAt: "2026-09-23T08:00:00Z" } }];
    expect(reachedCheckedComments(page, "2026-09-23T10:00:00Z")).toBe(true);
    expect(reachedCheckedComments(page, "2026-09-23T07:30:00Z")).toBe(false);
    expect(reachedCheckedComments(page, "")).toBe(false);
  });
});
