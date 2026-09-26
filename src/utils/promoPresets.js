// Promo Studio templates. Each one is a structure (beats, pacing, and motion
// language) adapted from prompts creators shared on X with their all-code
// motion videos (credited per template). Templates never carry content: every
// word and visual comes from the user's link, images, and notes. Shared by the
// page and the server, which turns the choice into the storyboard and film.

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
    blurb: "Hook, reveal, three reasons, call to action",
    group: "launch",
    aspect: "16:9",
    duration: 30,
    bpm: 120,
    credit: { handle: "twoclipping", url: "https://x.com/twoclipping/status/2102554209166000267" },
    direction:
      "High-end minimal launch film. One idea per shot, lots of empty space, one accent color from the brand, one clean sans with tight tracking. Masked type reveals, match cuts, one smooth camera language. No full stops in on-screen text.",
    beats: [
      [0, 0.12, "Hook: the audience's problem or desire lands word by word on the beats, then a quieter second line"],
      [0.12, 0.22, "Promise: one hook word morphs into the subject's name or logo and its one-line promise"],
      [0.22, 0.3, "The drop: a shape opens out of the name into the subject's world, revealing its strongest visual"],
      [0.3, 0.72, "Three reasons, one per bar group: each shows the subject doing its job, with a short caption of the benefit"],
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
    duration: 15,
    bpm: 124,
    credit: { handle: "sofiarxin", url: "https://x.com/sofiarxin/status/2102719343599800340" },
    direction:
      "Clean, airy film on the brand's own background color with a faint accent glow. Everything smooth: ease-in-out, a tiny settle on badges only. Text reveals word by word (each word rises about 10px and fades in with a 60ms stagger). Every scene flows into the next through a shared element or crossfade, never a hard cut. Captions bottom-center, key words in the accent.",
    beats: [
      [0, 0.2, "Hook: the pain the new thing removes, in one short line, then a 'New' chip pops in the accent color"],
      [0.2, 0.35, "Name the new feature, product, flavor, module, or offer in large type; it settles into its place on the subject"],
      [0.35, 0.8, "Show it working step by step (a UI demo, product details, or what's inside), each step with a two-to-four word caption"],
      [0.8, 1, "The result in one line, then logo, where to get it, soft fade out"],
    ],
  },
  {
    id: "explainer",
    name: "Explainer",
    blurb: "Problem, what it is, how it works in three steps, proof",
    group: "explain",
    aspect: "16:9",
    duration: 30,
    bpm: 110,
    credit: { handle: "alex_prompter", url: "https://x.com/alex_prompter/status/2103499977632997524" },
    direction:
      "Animated explainer in the brand's colors. Bold text, smooth transitions, generous pacing so every line can be read twice. Simple iconography drawn in SVG with one consistent stroke width. Diagrams build piece by piece; arrows draw on.",
    beats: [
      [0, 0.18, "Scene 1, the audience's problem: a relatable situation in two short lines and a simple illustration"],
      [0.18, 0.36, "Scene 2, what the subject is: its name and one-sentence promise"],
      [0.36, 0.7, "Scene 3, how it works in 3 numbered steps; each step builds a diagram, a screen, or an uploaded image"],
      [0.7, 0.85, "Scene 4, one proof point from the material (a real metric, testimonial, credential, or result)"],
      [0.85, 1, "Scene 5, the name at the end: logo, tagline, where to find it"],
    ],
  },
  {
    id: "kinetic-type",
    name: "Kinetic Type Promo",
    blurb: "All typography: the promise, word by word, on the beat",
    group: "launch",
    aspect: "16:9",
    duration: 15,
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
    duration: 15,
    bpm: 120,
    credit: { handle: "twoclipping", url: "https://x.com/twoclipping/status/2103273003555402193" },
    direction:
      "Dribbble-level motion. One shape, never cut: every state is the same element morphing its size, radius, and color while its content swaps with a short blur. For software and apps a cursor drives each change with real clicks and drags; for anything else the shape morphs on the beat into cards, photos, and badges. Calm canvas in the brand's background color, one clean font. Springs everywhere, a tiny overshoot at most. The camera zooms so each state fills the frame. The last frame equals the first frame so it loops.",
    beats: [
      [0, 0.1, "A pill with the subject's main call to action"],
      [0.1, 0.9, "8 to 10 states, one per beat pair, each showing one real thing the subject offers (screens, features, products, modules, services, dates, photos from the material)"],
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
    credit: { handle: "moritzkremb", url: "https://x.com/moritzkremb/status/2103066071838466494" },
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
    name: "Social Teaser",
    blurb: "A vertical, scroll-stopping 15 seconds for Reels and TikTok",
    group: "social",
    aspect: "9:16",
    duration: 15,
    bpm: 128,
    credit: { handle: "himanshutwtxs", url: "https://x.com/himanshutwtxs/status/2103503774203752450" },
    direction:
      "Loud but never janky vertical teaser. A never-static background layer, a new visual hit every 0.4 to 0.6 seconds, huge captions in the upper and middle thirds (keep the bottom 20% clear for platform UI), fast match cuts between the subject's strongest visuals. Overshoot springs allowed on type only.",
    beats: [
      [0, 0.12, "Hook in the first half second: a bold question or claim the audience cares about"],
      [0.12, 0.8, "Four quick moments that show the subject, each with a two-to-three word caption"],
      [0.8, 1, "Logo, where to find it, and a short call to action"],
    ],
  },
  {
    id: "showreel",
    name: "Brand Showreel",
    blurb: "The viral prompt, “go all out”, in your brand",
    group: "social",
    aspect: "16:9",
    duration: 15,
    bpm: 128,
    credit: { handle: "ajith_io", url: "https://x.com/ajith_io/status/2103449416325890146" },
    direction:
      "A dynamic motion graphics showreel for this subject that shows what an incredible motion designer you are, like it's your showreel for a résumé. Go all out: typography, shape play, camera moves, color shifts, each technique distinct, always in the brand's palette and voice, always clear what is being promoted.",
    beats: [
      [0, 0.1, "A striking hook in the first second"],
      [0.1, 0.85, "A sequence of distinct techniques, each carrying one idea about the subject"],
      [0.85, 1, "A clean, memorable final frame with the logo and where to find it"],
    ],
  },
];

export const findPromoTemplate = (id) => PROMO_TEMPLATES.find((item) => item.id === id) || PROMO_TEMPLATES[0];
export const findPromoSubject = (id) => PROMO_SUBJECTS.find((item) => item.id === id) || PROMO_SUBJECTS[0];

// Six-second muted loops cut from each credited creator's post, with a poster frame.
export const promoPreview = (id) => ({ video: `/assets/promo/template-${id}.mp4`, poster: `/assets/promo/template-${id}.webp` });
