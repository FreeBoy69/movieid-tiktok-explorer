import { describe, expect, it } from "vitest";
import { dedupeSegments, htmlToText, isAntibotPage, normalizePublicUrl, parseJinaReader, parseJson3, parseVtt, pickCaptionTrack, reachDoctor, readWebPage, segmentsToText, youtubeCaptions } from "./reach.js";

const fetcherOf = (answers: Record<string, { type?: string; body: string } | Error>) => async (url: string) => {
  const answer = answers[url] ?? answers[Object.keys(answers).find((key) => url.startsWith(key)) || ""];
  if (!answer) throw new Error(`no answer for ${url}`);
  if (answer instanceof Error) throw answer;
  return { url: new URL(url), type: answer.type || "text/plain", body: Buffer.from(answer.body) };
};

describe("reach: web pages", () => {
  it("accepts only public http(s) links and adds https to bare hosts", () => {
    expect(normalizePublicUrl("example.com/a?b=1")).toBe("https://example.com/a?b=1");
    for (const bad of ["", "ftp://x.com", "http://localhost/x", "http://user:pw@x.com", "http://x.local", "http://intranet", "javascript:alert(1)", "http://a b.com"])
      expect(() => normalizePublicUrl(bad)).toThrow(/public/);
  });

  it("recognises challenge pages and reads Jina's header", () => {
    expect(isAntibotPage("Title: Just a moment...\nWarning: Target URL returned error 403: requiring captcha\n## Performing security verification")).toBe(true);
    expect(isAntibotPage("Title: Attention Required! | Cloudflare\nRay ID: 123")).toBe(true);
    expect(isAntibotPage("Title: My blog\n\nMarkdown Content:\nHello")).toBe(false);
    expect(parseJinaReader("Title: My blog\nURL Source: https://x\nPublished Time: 2026\n\nMarkdown Content:\nHello **world**\n\n\n\nMore")).toEqual({ title: "My blog", text: "Hello **world**\n\nMore" });
  });

  it("turns HTML into readable text without scripts or navigation", () => {
    const page = htmlToText('<html><head><title>A &amp; B</title><style>p{}</style></head><body><nav>Menu</nav><h1>Hi</h1><p>One<br>two</p><script>x()</script><ul><li>a</li><li>b</li></ul></body></html>');
    expect(page.title).toBe("A & B");
    expect(page.text).toBe("# Hi\nOne\ntwo\n- a\n- b");
  });

  it("prefers Jina Reader and falls back to a direct fetch", async () => {
    const jinaOk = fetcherOf({ "https://r.jina.ai/": { body: `Title: Doc\n\nMarkdown Content:\n${"content ".repeat(20)}` } });
    expect(await readWebPage("https://example.com/doc", { fetcher: jinaOk })).toMatchObject({ backend: "jina-reader", title: "Doc", url: "https://example.com/doc" });
    const jinaBlocked = fetcherOf({ "https://r.jina.ai/": { body: "Title: Just a moment...\nWarning: requiring captcha\n## Performing security verification" }, "https://example.com/doc": { type: "text/html", body: `<html><head><title>Direct</title></head><body><p>${"words ".repeat(20)}</p></body></html>` } });
    expect(await readWebPage("https://example.com/doc", { fetcher: jinaBlocked })).toMatchObject({ backend: "direct", title: "Direct" });
    await expect(readWebPage("https://example.com/doc", { fetcher: fetcherOf({}) })).rejects.toThrow(/Could not read/);
  });
});

describe("reach: YouTube captions", () => {
  it("picks manual before automatic captions and English before the original language", () => {
    const info = {
      language: "de",
      subtitles: { de: [{ ext: "vtt", url: "https://yt/de.vtt" }], en: [{ ext: "json3", url: "https://yt/en.json3" }, { ext: "vtt", url: "https://yt/en.vtt" }] },
      automatic_captions: { en: [{ ext: "json3", url: "https://yt/auto-en.json3" }] },
    };
    expect(pickCaptionTrack(info)).toEqual({ kind: "manual", language: "en", ext: "json3", url: "https://yt/en.json3" });
    expect(pickCaptionTrack({ language: "de", automatic_captions: { "de-orig": [{ ext: "vtt", url: "u1" }], fr: [{ ext: "vtt", url: "u2" }] } })).toMatchObject({ kind: "auto", language: "de-orig" });
    expect(pickCaptionTrack({ subtitles: {}, automatic_captions: {} })).toBeNull();
    expect(pickCaptionTrack({ subtitles: { en: [{ ext: "srt" }] } })).toBeNull();
  });

  it("parses json3 and WebVTT and collapses rolling auto-caption repeats", () => {
    const json3 = parseJson3({ events: [{ tStartMs: 0, dDurationMs: 1500, segs: [{ utf8: "Hello" }, { utf8: " there" }] }, { tStartMs: 1500, segs: [{ utf8: "\n" }] }, { tStartMs: 2000, dDurationMs: 1000, segs: [{ utf8: "Hello there friends" }] }] });
    expect(json3).toEqual([{ start: 0, end: 1.5, text: "Hello there" }, { start: 2, end: 3, text: "Hello there friends" }]);
    expect(dedupeSegments(json3)).toEqual([{ start: 0, end: 3, text: "Hello there friends" }]);
    const vtt = parseVtt("WEBVTT\n\n00:00:01.000 --> 00:00:03.000 align:start position:0%\n<c>So</c> the first thing\n\n00:03.500 --> 00:05.000\nthe first thing\n\n00:00:06.000 --> 00:00:08.000\nwas a closet\n");
    expect(vtt).toEqual([{ start: 1, end: 3, text: "So the first thing" }, { start: 3.5, end: 5, text: "the first thing" }, { start: 6, end: 8, text: "was a closet" }]);
    expect(segmentsToText(dedupeSegments(vtt))).toBe("So the first thing was a closet");
  });

  it("fetches the chosen track and returns text with timings", async () => {
    const fetcher = fetcherOf({ "https://yt/en.json3": { body: JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "Hi" }] }] }) }, "https://yt/empty.json3": { body: "" } });
    const result = await youtubeCaptions({ subtitles: { en: [{ ext: "json3", url: "https://yt/en.json3" }] } }, { fetcher });
    expect(result).toMatchObject({ text: "Hi", language: "en", kind: "manual", backend: "youtube-captions" });
    expect(result!.segments).toEqual([{ start: 0, end: 1, text: "Hi" }]);
    expect(await youtubeCaptions({}, { fetcher })).toBeNull();
    await expect(youtubeCaptions({ subtitles: { en: [{ ext: "json3", url: "https://yt/empty.json3" }] } }, { fetcher })).rejects.toThrow(/empty/);
  });
});

describe("reach: doctor", () => {
  it("reports every channel and survives a failing probe", async () => {
    const report = await reachDoctor({
      web: async () => ({ status: "ok", message: "Jina answered" }),
      textModels: async () => ({ status: "warn", message: "Only one provider", activeBackend: "OpenRouter" }),
      voices: async () => { throw new Error("tunnel down"); },
    });
    expect(report.total).toBe(9);
    expect(report.ok).toBe(1);
    const byId = Object.fromEntries(report.channels.map((c) => [c.id, c]));
    expect(byId.web).toMatchObject({ status: "ok", activeBackend: "jina-reader" });
    expect(byId["text-models"]).toMatchObject({ status: "warn", activeBackend: "OpenRouter" });
    expect(byId.voices).toMatchObject({ status: "error" });
    expect(byId.voices.message).toMatch(/tunnel down/);
    expect(byId["youtube-media"].status).toBe("off");
  });
});
