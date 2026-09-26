import { describe, expect, it } from "vitest";
import { normalizeRequest } from "./creatorStudio.js";
import { musicStructure, synthScore } from "./promoMusic.js";
import { applyEdits, brandColors, buildPromoKit, extractSiteBrief, filmPrompt, fontFamilies, linkFromNotes, researchLinks } from "./promoStudio.js";
import { hostPromoDocument, promoKit, stripPromoHost } from "./promoRenderer.js";

describe("promo requests", () => {
  it("takes a link, images, or a description, and fills the template's shape", () => {
    const request = normalizeRequest({ tab: "promo", prompt: "", settings: { sourceUrl: "linear.app", template: "social-teaser", uploads: [{ file: "up-abc-1.png", label: "Logo" }, { file: "up-abc-2.mp4" }] } });
    expect(request.settings).toMatchObject({ template: "social-teaser", subject: "auto", aspectRatio: "9:16", duration: 30, sourceUrl: "https://linear.app", music: true });
    expect(request.settings.uploads).toEqual([{ file: "up-abc-1.png", label: "Logo" }]);
    expect(normalizeRequest({ tab: "promo", prompt: "A cooking course", settings: { template: "nope", aspectRatio: "4:3", duration: 99, music: false } }).settings).toMatchObject({ template: "product-launch", aspectRatio: "16:9", duration: 30, music: false });
    expect(() => normalizeRequest({ tab: "promo", prompt: "", settings: {} })).toThrow(/link, images, or a description/);
    expect(() => normalizeRequest({ tab: "promo", prompt: "", settings: { baseFile: "gen-abc.html" } })).toThrow(/what to change/);
  });
});

describe("reading the user's material", () => {
  it("pulls copy, calls to action, logo, and fonts from a page", () => {
    const html = `<html><head><title>Acme &#x2013; Plan faster</title><meta name="description" content="Plans in minutes.">
      <link rel="icon" href="/favicon.png"><link rel="stylesheet" href="/app.css">
      <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;700" rel="stylesheet"></head>
      <body><a href="/"><svg class="logo" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg></a>
      <h1>Ship it Ship it Ship it</h1><h2>Built for teams</h2><a href="/signup">Start free</a><script>var x = "<h1>no</h1>"</script></body></html>`;
    const site = extractSiteBrief(html, "https://acme.test/");
    expect(site.title).toBe("Acme – Plan faster");
    expect(site.headings).toEqual(["Ship it", "Built for teams"]);
    expect(site.actions).toContain("Start free");
    expect(site.logoSvg).toMatch(/^<svg/);
    expect(site.images.icon).toBe("https://acme.test/favicon.png");
    expect(site.stylesheets).toEqual(["https://acme.test/app.css"]);
    expect(site.googleFonts).toEqual(["Space Grotesk"]);
  });

  it("finds brand colors and fonts in CSS", () => {
    const css = `:root{--brand-primary:#5E6AD2;--bg:#0b0b0c} a{color:#5e6ad2} body{background:#0b0b0c;color:rgb(240 240 240);font-family:"Inter Variable",sans-serif} h1{font-family:__Geist_a1b2c3, Arial}`;
    expect(brandColors(css)).toMatchObject({ named: [{ name: "brand-primary", value: "#5e6ad2" }], accents: ["#5e6ad2"] });
    expect(brandColors(css).neutrals).toContain("#0b0b0c");
    expect(fontFamilies(css)).toEqual(["Inter", "Geist"]);
  });

  it("keeps going on an unreadable site and turns uploads into assets", async () => {
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    const kit = await buildPromoKit({
      url: "https://blocked.test",
      uploads: [{ file: "up-1.png", label: "Logo" }],
      fetcher: async (url: string) => {
        if (url.includes("blocked")) throw new Error("The page answered 403.");
        throw new Error("offline");
      },
      readUpload: async () => ({ mime: "image/png", bytes: png }),
      signal: undefined,
    });
    expect(kit.brief.site).toBeNull();
    expect(kit.brief.siteError).toMatch(/403/);
    expect(kit.brief.assets).toEqual([{ id: "upload1", kind: "png", label: "User upload: Logo" }]);
    expect(kit.assets.upload1).toMatch(/^data:image\/png;base64,/);
  });

  it("treats a site named in the notes as the link", () => {
    expect(linkFromNotes("Launch video for LingCode (lingcode.dev)")).toBe("https://lingcode.dev");
    expect(linkFromNotes("see https://acme.io/pricing, then the course")).toBe("https://acme.io/pricing");
    expect(linkFromNotes("email me at hi@acme.com")).toBe("");
    expect(linkFromNotes("A cooking course for beginners.")).toBe("");
  });
});

describe("the film", () => {
  it("applies find/replace edits and reports the ones that don't match exactly once", () => {
    const doc = "<h1>Hello</h1>\n<p>a</p>\n<p>a</p>";
    const reply = "<<<<<<< FIND\n<h1>Hello</h1>\n=======\n<h1>Hi there</h1>\n>>>>>>> REPLACE\n<<<<<<< FIND\n<p>a</p>\n=======\n<p>b</p>\n>>>>>>> REPLACE";
    const result = applyEdits(doc, reply);
    expect(result.html).toBe("<h1>Hi there</h1>\n<p>a</p>\n<p>a</p>");
    expect(result).toMatchObject({ applied: 1, failed: ["<p>a</p>"] });
    expect(applyEdits(doc, "OK")).toMatchObject({ html: doc, applied: 0, failed: [] });
  });

  it("hosts a film with its kit and strips it back for revisions", () => {
    const film = `<!doctype html><html><head><style>#stage{background:#111}</style></head><body><div id="stage"><img src="asset:logo"></div><script>window.seek=(t)=>{}</script></body></html>`;
    const hosted = hostPromoDocument(film, { width: 1080, height: 1920, duration: 15, fontCss: "@font-face{font-family:X}", assets: { logo: "data:image/png;base64,AA==" } });
    expect(hosted).toContain("__promoSeek");
    expect(promoKit(hosted)).toMatchObject({ fontCss: "@font-face{font-family:X}", assets: { logo: "data:image/png;base64,AA==" } });
    const stripped = stripPromoHost(hosted);
    expect(stripped).not.toContain("__promoSeek");
    expect(stripped).toContain('src="asset:logo"');
  });
});

describe("site research", () => {
  it("reads product pages before docs, and stays on the site", () => {
    const anchors = ["/docs/cloud/quickstart.html", "https://www.acme.com/pricing", "/features", "https://other.com/features", "/features/", "/blog/post", "/#features", "/about.html"].map((href) => ({ href }));
    expect(researchLinks(anchors, "https://acme.com/")).toEqual(["https://acme.com/features", "https://www.acme.com/pricing", "https://acme.com/about.html"]);
  });
});

describe("one-pass film and score", () => {
  it("puts the drops, breakdown, and final hit on bar lines", () => {
    expect(musicStructure(30, 120)).toMatchObject({ beat: 0.5, bar: 2, drop: 4, breakdown: 20, drop2: 22, final: 28 });
    expect(musicStructure(15, 120)).toMatchObject({ drop: 2, breakdown: null, drop2: null, final: 12 });
  });

  it("synthesizes a stereo 16-bit WAV of the film's length", () => {
    const wav = synthScore(musicStructure(15, 120));
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wav.readUInt16LE(22)).toBe(2);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.readUInt32LE(40) / (wav.readUInt32LE(24) * 4)).toBeCloseTo(15, 1);
  });

  it("gives Opus the example film, the music structure, and the text rules", () => {
    const kit = { brief: { fonts: [{ family: "Inter" }], assets: [{ id: "logo", label: "Logo" }], site: { title: "Acme" } }, vision: [{ id: "logo", label: "Logo", url: "data:image/png;base64,AA==" }] };
    const [system, user] = filmPrompt({ template: { name: "Launch", direction: "Bold." }, subject: { name: "App", visuals: "UI." }, duration: 30, aspect: "16:9", width: 1920, height: 1080, kit, notes: "", reference: "", structure: musicStructure(30, 120) });
    expect(system.content).toContain("window.seek = function");
    expect(system.content).toContain("ONE IDEA PER FRAME");
    expect(system.content).toContain("VIBE TELLS");
    expect(system.content).toContain("shot(0,2");
    expect(system.content.length).toBeLessThan(80000);
    const text = (user.content as { type: string; text?: string }[]).find((part) => part.type === "text")!.text!;
    expect(text).toContain("4s: THE DROP");
    expect(text).toContain("28s: FINAL HIT");
    expect(text).toContain("Acme");
    expect((user.content as { type: string }[]).filter((part) => part.type === "image_url")).toHaveLength(1);
  });
});
