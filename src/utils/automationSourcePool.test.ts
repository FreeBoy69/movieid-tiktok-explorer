import { describe, expect, it } from "vitest";
import { planSourcePoolCandidates, poolSourceIdentity, sourcePoolUsage, sourceUploadIndex, sourceVideoUsed } from "./automationSourcePool.js";
import { rankAutomationCandidatesByEvidence } from "./automationCandidateRanking.js";

const video = (author: string, id: string, extra = {}) => ({ id, authorHandle: author,
  sourceListUrl: `https://www.tiktok.com/@${author}`, playUrl: `https://www.tiktok.com/@${author}/video/${id}`, ...extra });

describe("source pool selection and usage", () => {
  it("gives every eligible source turns even when one source dominates the evidence score", () => {
    const videos = ["winner", "newcomer", "weak"].flatMap((name, index) => Array.from({ length: 30 }, (_, n) => video(name, `${7600000000000000000n + BigInt(index * 100 + n)}`)));
    const sources = ["winner", "newcomer", "weak"].map((name) => ({ url: `https://www.tiktok.com/@${name}`, videos: videos.filter((v) => v.authorHandle === name) }));
    const uploads: any[] = [];
    const picks: string[] = [];
    const profile = { samples: 30, totalViews: 1000000, bestSources: [{ label: "winner", uploads: 30, views: 1000000 }] };
    for (let run = 0; run < 24; run++) {
      const used = sourceUploadIndex(uploads);
      const ranked = rankAutomationCandidatesByEvidence(videos.filter((v) => !sourceVideoUsed(v, used)), { profile });
      const plan = planSourcePoolCandidates(ranked, { profileData: profile, sourceUsage: sourcePoolUsage(sources, uploads), seed: `run-${run}` });
      const chosen = plan.videos[0];
      picks.push(chosen.authorHandle);
      uploads.push({ ...chosen, sourceVideoId: chosen.id, sourceUrl: chosen.playUrl, status: "uploaded", createdAt: run + 1 });
    }
    for (let i = 0; i <= picks.length - 6; i++) expect(new Set(picks.slice(i, i + 6)).size).toBe(3);
    expect(picks.filter((p) => p === "winner").length).toBeGreaterThanOrEqual(picks.filter((p) => p === "weak").length);
    expect(new Set(uploads.map((u) => u.id)).size).toBe(24);
  });

  it("does not fall back to unrelated videos when every source fails strict niche rules", () => {
    const plan = planSourcePoolCandidates([video("football", "7600000000000000001", { title: "Football world cup" })], { settings: { genreFocus: "Anime", sourceNicheMode: "strict" } });
    expect(plan.videos).toEqual([]);
    expect(plan.strategy.reason).toBe("no_niche_compatible_sources");
  });

  it("counts legacy uploads, deduplicates source membership and distinguishes failed uploads from posts", () => {
    const first = video("fruit", "7600000000000000001");
    const second = video("fruit", "7600000000000000002");
    const usage = sourcePoolUsage([{ url: first.sourceListUrl, videos: [first, first, second] }], [
      { sourceVideoId: first.id, sourceUrl: first.playUrl, status: "uploaded", createdAt: 10 },
      { sourceVideoId: second.id, sourceUrl: second.playUrl, status: "upload_failed", createdAt: 20 },
    ])[0];
    expect(usage).toMatchObject({ total: 2, used: 2, remaining: 0, percent: 100, posts: 1, status: "exhausted" });
  });

  it("retains matching clips in a mixed source even when its top clip is off-topic", () => {
    const plan = planSourcePoolCandidates([
      video("mixed", "7600000000000000001", { title: "Football world cup" }),
      video("mixed", "7600000000000000002", { title: "Anime isekai story" }),
    ], { settings: { genreFocus: "Anime", sourceNicheMode: "strict" } });
    expect(plan.videos.map((v) => v.id)).toEqual(["7600000000000000002"]);
  });

  it("handles overlapping collections without falsely attributing a new post to both", () => {
    const clip = video("fruit", "7600000000000000001");
    const sources = ["one", "two"].map((name) => ({ url: `https://www.tiktok.com/@owner/collection/${name}-123`, videos: [clip] }));
    const usage = sourcePoolUsage(sources, [{ sourceVideoId: clip.id, sourceUrl: clip.playUrl, sourceListUrl: sources[0].url, status: "scheduled", createdAt: 1 }]);
    expect(usage.map((row) => row.used)).toEqual([1, 1]);
    expect(usage.map((row) => row.posts)).toEqual([1, 0]);
  });

  it("does not collapse different YouTube playlists and ignores tracking parameters", () => {
    expect(poolSourceIdentity("https://www.youtube.com/playlist?list=AA&feature=share")).not.toBe(poolSourceIdentity("https://www.youtube.com/playlist?list=BB"));
    expect(poolSourceIdentity("https://www.tiktok.com/@fruit/?_t=abc")).toBe(poolSourceIdentity("https://www.tiktok.com/@fruit"));
  });

  it("treats unscanned sources as unknown, not fully used", () => {
    expect(sourcePoolUsage([{ url: "https://www.tiktok.com/@new", videos: [] }])[0]).toMatchObject({ total: 0, percent: 0, status: "not_scanned" });
  });
});
