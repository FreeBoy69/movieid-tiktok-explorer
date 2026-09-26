// Promo Studio templates. Each one is a structure (beats, pacing, and motion
// language) adapted from prompts creators shared on X with their all-code
// motion videos (credited per template). Templates never carry content: every
// word and visual comes from the user's link, images, and notes. Shared by the
// page and the server, which turns the choice into the film.

export const PROMO_ASPECTS = ["16:9", "9:16", "1:1"];
export const PROMO_DURATIONS = [15, 30, 45];

// What is being promoted decides how the film shows it.
export const PROMO_SUBJECTS = [
  { id: "auto", name: "Auto", hint: "Work it out from the material", visuals: "Decide what the subject is from the material, then show it the way that suits it best." },
  { id: "software", name: "Software or website", hint: "SaaS, tools, sites", visuals: "Recreate its real interface as HTML (nav, hero, cards, buttons, charts) from the site copy and any screenshots, and show it being used by a cursor. Never gray placeholder boxes." },
  { id: "app", name: "Mobile app", hint: "iOS and Android apps", visuals: "Show its screens inside a clean phone frame, recreated from screenshots or the site, with taps, swipes, and transitions between screens." },
  { id: "product", name: "Physical product", hint: "Things people buy", visuals: "Make the uploaded product photos the heroes: masked reveals, slow pushes and parallax, detail callouts with thin leader lines, price and offer as clean type." },
  { id: "course", name: "Course or program", hint: "Courses, cohorts, coaching", visuals: "Show the outcome first, then modules as numbered chapters or cards, the instructor (photo if provided) with credentials from the material, and the enroll call to action." },
  { id: "event", name: "Event", hint: "Launches, meetups, conferences", visuals: "Lead with the date and place as big type, count in the lineup, speakers, or agenda from the material, and end on the ticket or RSVP call to action." },
  { id: "business", name: "Business or service", hint: "Agencies, shops, local services", visuals: "Show the services as a clean card system, the process in simple steps, real details (location, hours, offer) from the material, and the booking call to action." },
  { id: "creator", name: "Creator or personal brand", hint: "Channels, newsletters, portfolios", visuals: "Introduce the person or brand by name, what they make and for whom, highlights from the material (with photos if provided), and where to follow or subscribe." },
  { id: "other", name: "Something else", hint: "Anything else", visuals: "Show the subject with the strongest visuals the material allows: uploaded images first, then typography, shapes, and simple illustrations drawn in SVG." },
];

// Beats are fractions of the film, so every template scales to 15, 30, or 45
// seconds. "The subject" is whatever the user is promoting.
export const PROMO_TEMPLATES = [
  {
    id: "product-launch",
    name: "Product Launch",
    blurb: "SaaS-style launch film: features, benefits, logo lockup",
    group: "launch",
    aspect: "16:9",
    duration: 30,
    bpm: 120,
    credit: { handle: "moritzkremb", url: "https://x.com/moritzkremb/status/2103066071838466494" },
    direction:
      "Pick a real SaaS (or the user's product) and build a highly professional product-launch film like the ones people post on X. Get actual logos, screenshots, and UI from the site — never stock. One idea per shot, empty space, one brand accent, one clean sans (Inter/Geist). Masked type, match cuts, cursor demos on a beat grid (~120 BPM). Show features and benefits; end on logo lockup. No full stops in on-screen text.",
    beats: [
      [0, 0.12, "Hook: the audience's problem or desire lands word by word on the beats, then a quieter second line"],
      [0.12, 0.22, "Promise: one hook word morphs into the subject's name or logo and its one-line promise"],
      [0.22, 0.3, "The drop: a shape opens out of the name into the subject's world, revealing its strongest real visual"],
      [0.3, 0.72, "Three reasons, one per bar group: each shows a real feature or screen doing its job, with a short benefit caption"],
      [0.72, 0.84, "Proof: the strongest fact from the material as big type on push cuts (only real numbers the user or the site gives)"],
      [0.84, 1, "Call to action: the action (visit, buy, enroll, book) and where, logo lockup, soft fade"],
    ],
  },
  {
    id: "feature-drop",
    name: "Feature Announcement",
    blurb: "One new thing, shown working, with a crisp New badge",
    group: "launch",
    aspect: "16:9",
    duration: 30,
    bpm: 124,
    credit: { handle: "sofiarxin", url: "https://x.com/sofiarxin/status/2102546517068308786" },
    direction:
      "Clean, light, airy product film. Recreate the real site UI (nav, hero, boards, cards, pricing) from the material. Canvas near white with a faint brand-accent radial glow. Soft white cards, 12–16px radius, soft diffuse shadows. Everything smooth: cubic ease-in-out / ease-out, tiny settle on badges only — no bounce. Text reveals word by word (each word rises ~10px and fades in, 60ms stagger). Every scene flows through a shared element or crossfade, never a hard cut. Captions bottom-center; key words in the accent.",
    beats: [
      [0, 0.17, "Hook: the pain the new thing removes, in one short line, then a chip or badge pops in the accent color"],
      [0.17, 0.31, "Name the product or feature in large type; logo settles into nav as the real interface builds"],
      [0.31, 0.78, "Show it working in three value beats (board, proof, result), each with a two-to-four word caption"],
      [0.78, 1, "Pricing or CTA morphs into the main action button; logo and tagline hold"],
    ],
  },
  {
    id: "explainer",
    name: "Explainer",
    blurb: "Turn a paper, skill, or SOP into a fun animated walkthrough",
    group: "explain",
    aspect: "16:9",
    duration: 30,
    bpm: 110,
    credit: { handle: "alex_prompter", url: "https://x.com/alex_prompter/status/2103499977632997524" },
    direction:
      "Expert motion-designer explainer as one film. Five scenes: the customer's problem, what the subject is, how it works in 3 steps, one proof point, name at the end. Bold text, smooth transitions, brand colours. Fun enough to ingest a paper, skill, or SOP without reading it — simple SVG icons/characters, diagrams that build. Direct it with scenes, length, and pace; revise with short notes.",
    beats: [
      [0, 0.18, "Scene 1 — the customer's problem: a relatable situation in two short lines plus a simple illustration"],
      [0.18, 0.36, "Scene 2 — what it is: name and one-sentence promise in plain English"],
      [0.36, 0.7, "Scene 3 — how it works in 3 numbered steps; each builds a diagram, metaphor, or screen"],
      [0.7, 0.85, "Scene 4 — one proof point from the material"],
      [0.85, 1, "Scene 5 — name at the end: logo, tagline, where to find it"],
    ],
  },
  {
    id: "kinetic-type",
    name: "Kinetic Type Promo",
    blurb: "All typography: the promise, word by word, on the beat",
    group: "launch",
    aspect: "16:9",
    duration: 30,
    bpm: 128,
    credit: { handle: "darel023", url: "https://x.com/darel023/status/2103424524297420829" },
    direction:
      "Pure kinetic typography. Open with a striking hook in the first second, then build through distinct type techniques: masked slides, scale punches, split-line wipes, word swaps inside a fixed frame, tracking changes, and one color inversion. Pacing feels cut to music: a new visual hit every 0.4 to 0.8 seconds. Huge type, few words, perfect kerning.",
    beats: [
      [0, 0.15, "Hook: one huge word about the subject slams in on the downbeat"],
      [0.15, 0.75, "The manifesto: the subject's promise and three benefits, two to four words per hit, each with a different type technique"],
      [0.75, 0.9, "Inversion: the palette flips and the subject's name fills the frame"],
      [0.9, 1, "Logo and where to find it on a clean, memorable final frame"],
    ],
  },
  {
    id: "app-showreel",
    name: "Showcase Loop",
    blurb: "One shape morphs through everything it offers, and loops",
    group: "launch",
    aspect: "1:1",
    duration: 30,
    bpm: 120,
    credit: { handle: "twoclipping", url: "https://x.com/twoclipping/status/2103273003555402193" },
    direction:
      "Dribbble-level UI motion. One shape, never cut: every state is the same element morphing its size, radius and color while its content swaps with a short blur. A cursor drives every change with real clicks and drags. Calm canvas in the brand background, one clean UI font. Springs everywhere, a tiny overshoot at most. Camera zooms so each state fills the frame. Last frame equals first so it loops. Banned: bouncy easing, particle bursts, glows, gradients on UI chrome, dead time.",
    beats: [
      [0, 0.1, "A pill with the subject's main call to action"],
      [0.1, 0.9, "8 to 10 states on the beat: button → loader → check → island → player → slider → toggle → tabs → chart → command palette → toast → back"],
      [0.9, 1, "Back to the opening pill, identical to frame one, with the logo beside it"],
    ],
  },
  {
    id: "whats-new",
    name: "What's New",
    blurb: "An update film: three to five changes, one card each",
    group: "launch",
    aspect: "16:9",
    duration: 30,
    bpm: 116,
    credit: { handle: "twoclipping", url: "https://x.com/twoclipping/status/2102554209166000267" },
    direction:
      "Polished update video, like the ones teams post on launch day. A version, season, or date counts up, then each update gets its own card that flips or slides in, with a small visual (a screen, a photo, an icon) and a one-line benefit. Consistent card system, brand accent for tags (New, Improved, Back).",
    beats: [
      [0, 0.12, "Title: 'What's new' with the subject's name and the version, season, or month counting in"],
      [0.12, 0.85, "Three to five updates from the material, one card each: tag, name, one-line benefit, a small visual"],
      [0.85, 1, "Recap: all cards shrink into a grid, then logo and where to see it"],
    ],
  },
  {
    id: "funding",
    name: "Big Announcement",
    blurb: "A milestone, a raise, or a new chapter, told cinematically",
    group: "launch",
    aspect: "16:9",
    duration: 30,
    bpm: 100,
    credit: { handle: "jumperz", url: "https://x.com/jumperz/status/2103533568391590161" },
    direction:
      "Confident, cinematic announcement. Dark, rich background from the brand palette, slow deliberate camera pushes, big numerals, restrained accent light, serif or wide display type for the headline. Only state amounts, names, and dates that the material gives; if none are given, announce the milestone without numbers.",
    beats: [
      [0, 0.2, "The why: what the subject believes or set out to do, in one line"],
      [0.2, 0.45, "The announcement: the milestone (a raise, a launch date, a number reached, an opening) builds as large type or numerals"],
      [0.45, 0.75, "What it means: three things that come next, from the material"],
      [0.75, 1, "Thank-you line, logo, where to follow along, and (if given) a hiring or signup call"],
    ],
  },
  {
    id: "social-teaser",
    name: "Short-Form Cutdown",
    blurb: "Long-form → vertical: strong hook, fast cuts, Instagram/TikTok",
    group: "social",
    aspect: "9:16",
    duration: 30,
    bpm: 128,
    credit: { handle: "himanshutwtxs", url: "https://x.com/himanshutwtxs/status/2103503774203752450" },
    direction:
      "One-shot vertical motion for Reels/TikTok. Strong hook in the first half second, then a fast cut pace — never slow. Huge captions in the upper and middle thirds (keep the bottom 20% clear for platform UI). Pick one sharp topic from the material; do not compress everything. Mix rebuilt UI, type punches, and any real footage provided. Sentences must flow.",
    beats: [
      [0, 0.12, "Hook in the first half second: a bold claim or curiosity gap the audience cares about"],
      [0.12, 0.8, "Four to six rapid beats that teach one idea, each with a two-to-three word caption"],
      [0.8, 1, "Logo, where to find it, and a short call to action"],
    ],
  },
  {
    id: "showreel",
    name: "Brand Showreel",
    blurb: "The viral prompt, “go all out”, in your brand",
    group: "social",
    aspect: "16:9",
    duration: 30,
    bpm: 128,
    credit: { handle: "ajith_io", url: "https://x.com/ajith_io/status/2103449416325890146" },
    direction:
      "Make a dynamic motion-graphics film that shows what an incredible motion designer you are — like a résumé showreel — always in this subject's brand. Go all out: typography, shape play, camera moves, colour shifts. Open with a striking hook in the first second; pacing should feel cut to music; land on a clean memorable final frame.",
    beats: [
      [0, 0.1, "A striking hook in the first second"],
      [0.1, 0.85, "A sequence of distinct techniques, each carrying one idea about the subject"],
      [0.85, 1, "A clean, memorable final frame with the logo and where to find it"],
    ],
  },
  {
    id: "proposal",
    name: "Proposal Film",
    blurb: "Turn a proposal doc into a client-ready walkthrough video",
    group: "explain",
    aspect: "16:9",
    duration: 30,
    bpm: 104,
    credit: { handle: "moritzkremb", url: "https://www.tiktok.com/@promptwarrior/video/7689151665538174240" },
    direction:
      "Read the proposal (or notes) and turn it into a fun little video the customer can watch instead of only a boring document. Soft cream / brand-tinted paper, one recurring SVG guide character who greets the clients by name, big readable headlines, short captions. Research and fetch assets. Structure from the doc: greeting → what you see (facts/engine) → the goal → numbered steps → the ask (price if given). Only real numbers and names from the material. Calm pacing, soft springs.",
    beats: [
      [0, 0.12, "Greeting: guide character and who this is for"],
      [0.12, 0.35, "What you see: the current situation in two or three facts from the material"],
      [0.35, 0.5, "The goal in one clear line"],
      [0.5, 0.8, "The plan: two or three steps, each with a short caption and a simple visual"],
      [0.8, 1, "The ask: price or next step if given, logo, and how to reply"],
    ],
  },
  {
    id: "deck",
    name: "Dynamic Deck",
    blurb: "Turn static slides into an animated presentation film",
    group: "explain",
    aspect: "16:9",
    duration: 30,
    bpm: 100,
    credit: { handle: "moritzkremb", url: "https://www.tiktok.com/@promptwarrior/video/7689151665538174240" },
    direction:
      "Take a static presentation (HTML/PDF/slide points from the material) and turn it into a dynamic presentation film: still slide-shaped, but each slide is visually engaging. Eyebrow label, big headline with accent on key words, short support line. Background nodes/network drift, cards flip in, numbers and bars animate. Feels like pressing D on a static↔dynamic deck demo — not a paragraph dump.",
    beats: [
      [0, 0.12, "Title slide: the subject's promise in one line, with a living background"],
      [0.12, 0.8, "Four slide beats from the material: problem, opportunity, solution, how to fix it"],
      [0.8, 1, "Closing slide: name, logo, call to action"],
    ],
  },
];

export const findPromoTemplate = (id) => PROMO_TEMPLATES.find((item) => item.id === id) || PROMO_TEMPLATES[0];
export const findPromoSubject = (id) => PROMO_SUBJECTS.find((item) => item.id === id) || PROMO_SUBJECTS[0];

// From each credited creator's post: a six-second muted loop for cards, a poster
// frame, and the full reference (up to 30s, with sound where it had any) for preview.
export const promoPreview = (id) => ({
  video: `/assets/promo/template-${id}.mp4`,
  poster: `/assets/promo/template-${id}.webp`,
  full: `/assets/promo/template-${id}-full.mp4`,
});
