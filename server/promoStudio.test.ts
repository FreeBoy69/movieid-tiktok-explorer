import { describe, expect, it } from "vitest";
import { normalizeRequest } from "./creatorStudio.js";
import { applyEdits, brandColors, buildPromoKit, extractSiteBrief, fontFamilies, assembleFilm, linkFromNotes, parsePart, parsePlan, partImages, researchLinks, splitParts } from "./promoStudio.js";
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
  it("parses a fenced storyboard and clamps its scenes to the length", () => {
    const plan = parsePlan('```json\n{"title":"T","scenes":[{"start":-2,"end":9,"text":"a"},{"start":8,"end":99}]}\n```', 15);
    expect(plan.scenes.map((s: { start: number; end: number }) => [s.start, s.end])).toEqual([[0, 9], [8, 15]]);
    expect(() => parsePlan('{"scenes":[]}', 15)).toThrow(/no scenes/);
  });

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

describe("parallel film build", () => {
  const scenes = [0, 1.5, 3, 4.6, 6, 7.5, 9, 10.4, 12, 13.5].map((start, i, all) => ({ start, end: all[i + 1] ?? 15, name: `s${i}` }));

  it("cuts the storyboard into contiguous parts of whole scenes", () => {
    const parts = splitParts(scenes, 15);
    expect(parts.map((p) => [p.start, p.end, p.scenes.length])).toEqual([[0, 6, 4], [6, 12, 4], [12, 15, 2]]);
    const short = [0, 2, 4, 5.5].map((start, i, all) => ({ start, end: all[i + 1] ?? 7 }));
    expect(splitParts(short, 7).map((p) => [p.start, p.end, p.scenes.length])).toEqual([[0, 7, 4]]);
  });

  it("sends each part only the images its shots use, plus the first screenshot", () => {
    const vision = ["screen1", "screen2", "logo", "image1", "image10"].map((id) => ({ id, label: id, url: id }));
    expect(partImages(vision, [{ layers: "logo top left, image1 in a device frame" }]).map((v) => v.id)).toEqual(["screen1", "logo", "image1"]);
  });

  it("reads a part's css and script, fenced or not", () => {
    expect(parsePart("```html\n<style>#p1 .a{color:red}</style>\n<script>PART({ build(root) { return () => {}; } });</script>\n```")).toEqual({ css: "#p1 .a{color:red}", js: "PART({ build(root) { return () => {}; } });" });
    expect(parsePart("<script>console.log(1)</script>")).toBeNull();
  });

  it("stitches parts into one seekable film, and one broken part doesn't take the rest down", () => {
    const part = (index, start, end, js) => ({ index, start, end, css: `#p${index}{color:red}`, js });
    const html = assembleFilm({
      width: 1920, height: 1080, duration: 10, fonts: ["Inter"],
      plan: { title: "T", palette: { background: "#101010", accent: "#ff0055" }, fonts: { display: "Inter" } },
      parts: [
        part(1, 0, 5, "PART({ build(root) { const h = document.createElement('h1'); root.append(h); return (t) => { h.textContent = 'one ' + t; }; } });"),
        part(2, 5, 8, "PART({ build() { throw new Error('boom'); } });"),
        part(3, 8, 10, "PART({ build(root) { return (t) => { root.textContent = 'three ' + t; }; } });"),
      ],
    });
    expect(html).toContain("--accent:#ff0055");
    const errors: string[] = [];
    const original = console.error;
    console.error = (message) => errors.push(String(message));
    document.body.innerHTML = html.match(/<body>([\s\S]*?)<script>/)![1];
    new Function(html.match(/<script>([\s\S]*?)<\/script>/)![1])();
    console.error = original;
    const seek = (window as unknown as { seek: (t: number) => void }).seek;
    seek(2);
    expect(document.getElementById("p1")!.style.display).toBe("block");
    expect(document.getElementById("p1")!.textContent).toBe("one 2");
    seek(10);
    expect(document.getElementById("p1")!.style.display).toBe("none");
    expect(document.getElementById("p3")!.textContent).toBe("three 10");
    expect(errors).toEqual(["part 2 build failed: boom"]);
  });
});
