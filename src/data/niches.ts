// ─── Content Niche Database ───────────────────────────────────────────────────
// Sourced from: VidIQ (54 Best YouTube Niches 2026), OutlierKit (27 Untapped Niches 2026),
// TubeBuddy, NexLev, Scribd 100 Niche List

export interface NicheEntry {
  id: string;
  name: string;
  category: NicheCategory;
  tags: string[];
  competition: "Low" | "Medium" | "High" | "Very Low";
  monetization: "Low" | "Medium" | "High" | "Very High";
  searchVolume?: string;       // e.g. "450K/mo"
  timeToMonetize?: string;     // e.g. "1–2 months"
  saturationRisk?: "Low" | "Medium" | "High" | "Very Low";
  platforms: string[];
  why: string;                 // emotional trigger / why it works
  contentTypes: string[];      // sub-formats
  faceless?: boolean;
  trending?: boolean;
}

export type NicheCategory =
  | "Film & Cinema"
  | "Gaming"
  | "Music"
  | "Finance & Business"
  | "Travel"
  | "Fitness & Health"
  | "Education"
  | "Food & Cooking"
  | "Comedy & Entertainment"
  | "Sports"
  | "Animals & Pets"
  | "Lifestyle"
  | "Faith & Spirituality"
  | "History & Culture"
  | "DIY & Restoration"
  | "Ambient & Focus"
  | "Fashion & Style"
  | "Tech & AI";

export const NICHE_DATABASE: NicheEntry[] = [
  // ── Film & Cinema ────────────────────────────────────────────────────────────
  {
    id: "movie-recap",
    name: "Movie Recap & Scene Clips",
    category: "Film & Cinema",
    tags: ["movie", "recap", "scene", "tiktok", "shorts"],
    competition: "High",
    monetization: "High",
    platforms: ["TikTok", "YouTube Shorts", "Instagram Reels"],
    why: "High emotional resonance — suspense, plot twists, and mystery drive shares",
    contentTypes: ["Scene identification clips", "Plot twist reveals", "'What movie is this?' formats", "Cinematic comparison"],
    faceless: true,
    trending: true,
  },
  {
    id: "forgotten-national-cinema",
    name: "Forgotten National Cinemas",
    category: "Film & Cinema",
    tags: ["arthouse", "world cinema", "film history", "cinephile"],
    competition: "Very Low",
    monetization: "Medium",
    searchVolume: "25K/mo",
    timeToMonetize: "4–8 months",
    saturationRisk: "Very Low",
    platforms: ["YouTube", "Patreon"],
    why: "Film students and cinephiles crave undiscovered content beyond Hollywood",
    contentTypes: ["Yugoslav Black Wave", "Egyptian Golden Age", "Philippine indie films", "Historical movement deep-dives"],
    faceless: false,
  },
  {
    id: "film-analysis",
    name: "Film Analysis & Theory",
    category: "Film & Cinema",
    tags: ["analysis", "cinematography", "screenplay", "theory"],
    competition: "Medium",
    monetization: "High",
    platforms: ["YouTube", "Patreon"],
    why: "Intellectual stimulation + social currency for cinephile identity",
    contentTypes: ["Director deep-dives", "Scene breakdowns", "Cinematography essays", "Screenplay analysis"],
  },

  // ── Gaming ────────────────────────────────────────────────────────────────────
  {
    id: "speedrunning",
    name: "Speedrunning",
    category: "Gaming",
    tags: ["gaming", "speedrun", "challenge", "record"],
    competition: "Medium",
    monetization: "High",
    platforms: ["YouTube", "Twitch", "TikTok"],
    why: "Achievement + spectacle — record-breaking creates viral moments",
    contentTypes: ["World record attempts", "Category breakdowns", "Route explanations", "Community events"],
  },
  {
    id: "hyper-casual-mobile",
    name: "Hyper-Casual Mobile Gameplay",
    category: "Gaming",
    tags: ["mobile", "casual", "asmr gaming", "relaxing", "faceless"],
    competition: "Low",
    monetization: "Medium",
    searchVolume: "55K/mo",
    timeToMonetize: "3–7 months",
    saturationRisk: "Low",
    platforms: ["YouTube", "YouTube Shorts", "TikTok"],
    why: "Counter-programming to loud gaming — relaxation and background viewing",
    contentTypes: ["Satisfying gameplay loops", "ASMR mobile gaming", "Puzzle game sessions", "Idle game progress"],
    faceless: true,
  },
  {
    id: "streamer-lore",
    name: "Streamer Lore Mockumentaries",
    category: "Gaming",
    tags: ["streaming", "mockumentary", "comedy", "lore", "twitch"],
    competition: "Very Low",
    monetization: "Medium",
    searchVolume: "75K/mo",
    timeToMonetize: "2–5 months",
    saturationRisk: "Low",
    platforms: ["YouTube"],
    why: "Self-referential gaming community humor drives cult following",
    contentTypes: ["Parody documentaries", "Streamer drama analysis", "Community inside jokes", "Absurdist commentary"],
    trending: true,
  },
  {
    id: "retro-gaming",
    name: "Retro Gaming",
    category: "Gaming",
    tags: ["retro", "nostalgia", "old games", "console history"],
    competition: "Medium",
    monetization: "Medium",
    platforms: ["YouTube", "TikTok"],
    why: "Nostalgia — one of the strongest emotional purchase drivers",
    contentTypes: ["Console history", "Hidden gems", "Preservation content", "Mod showcases"],
  },

  // ── Music ─────────────────────────────────────────────────────────────────────
  {
    id: "vintage-soul-music",
    name: "Vintage Soul / 'Lost Albums'",
    category: "Music",
    tags: ["soul", "funk", "vintage", "lost album", "curation", "faceless"],
    competition: "Very Low",
    monetization: "Medium",
    searchVolume: "450K/mo",
    timeToMonetize: "4–8 months",
    saturationRisk: "Medium",
    platforms: ["YouTube"],
    why: "Nostalgia + music discovery — 'lost treasure' narrative is extremely engaging",
    contentTypes: ["Curated faux-album compilations", "Rediscovery narratives", "Liner note storytelling"],
    faceless: true,
  },
  {
    id: "vintage-reggae",
    name: "Vintage Reggae Albums",
    category: "Music",
    tags: ["reggae", "vintage", "70s", "80s", "music archive"],
    competition: "Very Low",
    monetization: "Medium",
    searchVolume: "95K/mo",
    timeToMonetize: "3–6 months",
    saturationRisk: "Medium",
    platforms: ["YouTube"],
    why: "Streaming gaps in older reggae catalogs — true fans seek complete albums",
    contentTypes: ["Full album uploads", "Artist biography commentary", "Regional reggae history"],
    faceless: true,
  },
  {
    id: "decade-music-docs",
    name: "Specific Decade Music Documentaries",
    category: "Music",
    tags: ["music history", "documentary", "decade", "scene", "label"],
    competition: "Low",
    monetization: "Medium",
    searchVolume: "58K/mo",
    timeToMonetize: "4–7 months",
    saturationRisk: "Medium",
    platforms: ["YouTube", "Patreon"],
    why: "Music documentaries have proven appeal but most leave narrow eras uncovered",
    contentTypes: ["Year-specific deep dives", "Label history", "Regional scene docs", "'Where are they now' segments"],
  },
  {
    id: "forgotten-folk-instruments",
    name: "Forgotten Folk Instruments",
    category: "Music",
    tags: ["folk", "traditional", "instrument", "cultural", "rare"],
    competition: "Very Low",
    monetization: "Medium",
    searchVolume: "18K/mo",
    timeToMonetize: "3–6 months",
    saturationRisk: "Very Low",
    platforms: ["YouTube", "Patreon"],
    why: "Cultural preservation + unique sounds — some instruments have zero English tutorials",
    contentTypes: ["Performance videos", "Tutorial series", "Instrument maker interviews", "Cultural context essays"],
  },

  // ── Finance & Business ────────────────────────────────────────────────────────
  {
    id: "trading-app-tutorials",
    name: "Trading App Tutorials for Beginners",
    category: "Finance & Business",
    tags: ["trading", "investing", "apps", "beginners", "finance"],
    competition: "Low",
    monetization: "Very High",
    searchVolume: "450K/mo",
    timeToMonetize: "1–2 months",
    saturationRisk: "High",
    platforms: ["YouTube", "YouTube Shorts"],
    why: "People search for specific app tutorials before risking money — high intent",
    contentTypes: ["Account setup walkthroughs", "Feature tutorials", "Comparison videos", "60-second tips (Shorts)"],
    faceless: true,
    trending: true,
  },
  {
    id: "personal-finance-gen-z",
    name: "Personal Finance for Gen Z",
    category: "Finance & Business",
    tags: ["personal finance", "gen z", "budgeting", "money", "investing"],
    competition: "Medium",
    monetization: "Very High",
    platforms: ["TikTok", "YouTube Shorts", "YouTube"],
    why: "Utility + anxiety relief — financial stress is a universal pain point for young people",
    contentTypes: ["Budgeting 101", "Credit card basics", "Side hustle ideas", "Student loan strategies"],
    trending: true,
  },

  // ── Travel ────────────────────────────────────────────────────────────────────
  {
    id: "geopolitical-travel",
    name: "Geopolitical Travel Vlogs",
    category: "Travel",
    tags: ["travel", "geopolitics", "restricted countries", "documentary"],
    competition: "Very Low",
    monetization: "High",
    searchVolume: "1.5M/mo",
    timeToMonetize: "3–6 months",
    saturationRisk: "Medium",
    platforms: ["YouTube"],
    why: "Audiences are curious about headline countries they'd never visit — curiosity gap",
    contentTypes: ["Ground-level POV vlogs", "Local life documentation", "Food & markets", "Drone footage tours"],
    faceless: false,
    trending: true,
  },
  {
    id: "budget-travel",
    name: "Budget Travel",
    category: "Travel",
    tags: ["budget", "backpacking", "affordable travel", "hacks"],
    competition: "High",
    monetization: "High",
    platforms: ["YouTube", "TikTok", "Instagram"],
    why: "Utility — viewers want aspiration with achievability",
    contentTypes: ["Cost breakdowns", "Itinerary guides", "Hostel reviews", "Flight deal strategies"],
  },

  // ── Fitness & Health ──────────────────────────────────────────────────────────
  {
    id: "home-workouts",
    name: "Home Workouts",
    category: "Fitness & Health",
    tags: ["fitness", "home", "no equipment", "calisthenics"],
    competition: "High",
    monetization: "High",
    platforms: ["YouTube", "TikTok", "Instagram Reels"],
    why: "Accessibility — removes barrier of gym membership; high everyday utility",
    contentTypes: ["Follow-along workouts", "Weekly programs", "Transformation journeys", "Equipment-free routines"],
  },
  {
    id: "health-longevity",
    name: "Health & Longevity",
    category: "Fitness & Health",
    tags: ["longevity", "biohacking", "anti-aging", "health", "wellness"],
    competition: "Medium",
    monetization: "Very High",
    platforms: ["YouTube", "Podcast", "Patreon"],
    why: "Fear + aspiration — living longer is a universal motivation",
    contentTypes: ["Research breakdowns", "Protocol guides", "Expert interviews", "Supplement reviews"],
    trending: true,
  },

  // ── Education ─────────────────────────────────────────────────────────────────
  {
    id: "micro-niche-history",
    name: "Micro-Niche History Deep Dives",
    category: "History & Culture",
    tags: ["history", "deep dive", "obscure", "documentary", "evergreen"],
    competition: "Very Low",
    monetization: "Medium",
    searchVolume: "51K/mo",
    timeToMonetize: "5–10 months",
    saturationRisk: "Very Low",
    platforms: ["YouTube", "Patreon"],
    why: "Curiosity-driven binge watching — evergreen content generates passive views for years",
    contentTypes: ["15–30 min deep dives", "Primary source research", "Timeline documentaries", "\"How it started\" formats"],
    faceless: true,
  },
  {
    id: "language-challenges",
    name: "High-Concept Language Challenges",
    category: "Education",
    tags: ["language learning", "challenge", "experiment", "documentary"],
    competition: "Very Low",
    monetization: "Medium",
    searchVolume: "25K/mo",
    timeToMonetize: "3–6 months",
    saturationRisk: "Medium",
    platforms: ["YouTube"],
    why: "Progress documentation creates episodic content viewers return to follow",
    contentTypes: ["Challenge series", "Method comparisons", "Progress updates", "Community learning"],
  },
  {
    id: "diy-tutorials",
    name: "DIY & How-To",
    category: "Education",
    tags: ["diy", "how-to", "crafts", "make", "build"],
    competition: "Medium",
    monetization: "High",
    platforms: ["YouTube", "TikTok", "Pinterest"],
    why: "Utility + satisfaction of making — strongest evergreen search intent",
    contentTypes: ["Step-by-step guides", "Material sourcing", "Project ideas", "Skill progression series"],
  },

  // ── Food & Cooking ────────────────────────────────────────────────────────────
  {
    id: "historical-recipes",
    name: "Historical Recipe Reconstructions",
    category: "Food & Cooking",
    tags: ["history", "cooking", "recipes", "food history", "educational"],
    competition: "Low",
    monetization: "Medium",
    searchVolume: "67K/mo",
    timeToMonetize: "3–6 months",
    saturationRisk: "Medium",
    platforms: ["YouTube"],
    why: "Educational entertainment with strong binge potential — history meets cooking",
    contentTypes: ["Era-specific recreation", "Ingredient sourcing stories", "Modern adaptation guides", "Failure and trial videos"],
  },
  {
    id: "meal-prep",
    name: "Meal Prep & Batch Cooking",
    category: "Food & Cooking",
    tags: ["meal prep", "batch cooking", "time saving", "healthy eating"],
    competition: "High",
    monetization: "High",
    platforms: ["YouTube", "TikTok", "Instagram"],
    why: "Utility + anxiety relief — saves time and promotes healthy habits",
    contentTypes: ["Weekly prep guides", "Budget meal planning", "Macro-tracked meals", "Container organization"],
  },

  // ── Comedy & Entertainment ────────────────────────────────────────────────────
  {
    id: "satire-commentary",
    name: "Satire News & Commentary",
    category: "Comedy & Entertainment",
    tags: ["satire", "comedy", "news", "commentary", "politics"],
    competition: "Medium",
    monetization: "High",
    platforms: ["YouTube", "TikTok"],
    why: "Social currency — sharing satirical takes signals intelligence and wit",
    contentTypes: ["Satirical news segments", "Parody coverage", "Comedic essays", "Mock interviews"],
  },
  {
    id: "faux-historical-docs",
    name: "Faux Historical Documentaries",
    category: "Comedy & Entertainment",
    tags: ["mockumentary", "comedy", "satire", "documentary style"],
    competition: "Very Low",
    monetization: "Medium",
    searchVolume: "34K/mo",
    timeToMonetize: "4–7 months",
    saturationRisk: "Low",
    platforms: ["YouTube"],
    why: "Unique format stands out — comedy with production value appeals to sophisticated viewers",
    contentTypes: ["Absurdist mockumentaries", "Fictional events presented seriously", "Satirical social commentary"],
  },

  // ── Faith & Spirituality ──────────────────────────────────────────────────────
  {
    id: "guided-christian-prayer",
    name: "Guided Christian Prayers",
    category: "Faith & Spirituality",
    tags: ["prayer", "christian", "devotional", "faith", "daily ritual"],
    competition: "Low",
    monetization: "Medium",
    searchVolume: "180K/mo",
    timeToMonetize: "1–3 months",
    saturationRisk: "High",
    platforms: ["YouTube"],
    why: "Routine listening builds loyal audiences who return daily — habit formation",
    contentTypes: ["Daily guided prayers", "Liturgical season content", "Intercessory prayer", "Contemplative sessions"],
    faceless: true,
    trending: true,
  },

  // ── DIY & Restoration ────────────────────────────────────────────────────────
  {
    id: "niche-item-restoration",
    name: "Niche Item Restoration",
    category: "DIY & Restoration",
    tags: ["restoration", "vintage", "typewriters", "consoles", "audio equipment"],
    competition: "Low",
    monetization: "High",
    searchVolume: "39K/mo",
    timeToMonetize: "2–4 months",
    saturationRisk: "Low",
    platforms: ["YouTube"],
    why: "Satisfying transformation + before/after psychology drives massive engagement",
    contentTypes: ["Full restoration journeys", "Before-and-after reveals", "Technique tutorials", "Sourcing guides"],
  },
  {
    id: "underrated-board-games",
    name: "Underrated Board Game Reviews",
    category: "DIY & Restoration",
    tags: ["board games", "tabletop", "reviews", "hidden gems", "indie games"],
    competition: "Very Low",
    monetization: "Medium",
    searchVolume: "38K/mo",
    timeToMonetize: "4–8 months",
    saturationRisk: "Low",
    platforms: ["YouTube"],
    why: "Niche gamers seek undiscovered gems — passionate community drives high engagement",
    contentTypes: ["Full game reviews", "\"Top hidden gems\" lists", "Buying guides", "Rules explainers"],
  },

  // ── Ambient & Focus ───────────────────────────────────────────────────────────
  {
    id: "meditative-urban-ambience",
    name: "Meditative Urban Ambience",
    category: "Ambient & Focus",
    tags: ["ambient", "focus", "study", "sleep", "urban sounds", "lofi"],
    competition: "Low",
    monetization: "Medium",
    searchVolume: "71K/mo",
    timeToMonetize: "3–6 months",
    saturationRisk: "Medium",
    platforms: ["YouTube"],
    why: "Long watch times + study/sleep utility — urban dwellers relate to city sounds",
    contentTypes: ["City soundscapes", "Café ambience", "Rain in urban settings", "Library atmospheres"],
    faceless: true,
  },

  // ── Fashion & Style ───────────────────────────────────────────────────────────
  {
    id: "alt-subculture-fashion",
    name: "Alt-Subculture Fashion Guides",
    category: "Fashion & Style",
    tags: ["fashion", "subculture", "streetwear", "identity", "style"],
    competition: "Very Low",
    monetization: "High",
    searchVolume: "44K/mo",
    timeToMonetize: "2–4 months",
    saturationRisk: "High",
    platforms: ["TikTok", "YouTube", "Instagram"],
    why: "Identity expression — fashion as self-definition drives strong engagement",
    contentTypes: ["Lookbooks", "Sourcing guides", "Subculture history", "Styling tutorials"],
    trending: true,
  },

  // ── Tech & AI ─────────────────────────────────────────────────────────────────
  {
    id: "ai-tools-workflows",
    name: "AI Tools & Workflows",
    category: "Tech & AI",
    tags: ["AI", "productivity", "automation", "tools", "workflows"],
    competition: "Medium",
    monetization: "Very High",
    platforms: ["YouTube", "TikTok", "Newsletter"],
    why: "Utility + FOMO — fear of falling behind on AI creates urgent demand",
    contentTypes: ["Tool tutorials", "Workflow automation guides", "AI vs human comparisons", "Use-case breakdowns"],
    trending: true,
  },
  {
    id: "emerging-tech-reviews",
    name: "Emerging Tech Reviews",
    category: "Tech & AI",
    tags: ["tech", "EVs", "smart home", "3D printing", "new products"],
    competition: "Low",
    monetization: "Very High",
    platforms: ["YouTube"],
    why: "First-mover advantage — covering categories before mainstream = early authority",
    contentTypes: ["Hands-on reviews", "Category explainers", "Buying guides", "Comparison videos"],
  },

  // ── Lifestyle ─────────────────────────────────────────────────────────────────
  {
    id: "remote-worker-day",
    name: "Remote Worker Day-in-the-Life",
    category: "Lifestyle",
    tags: ["remote work", "digital nomad", "productivity", "day in the life"],
    competition: "Very Low",
    monetization: "High",
    searchVolume: "62K/mo",
    timeToMonetize: "3–6 months",
    saturationRisk: "Medium",
    platforms: ["YouTube", "TikTok"],
    why: "Practical guidance + aspiration — realistic content outperforms highlight reels",
    contentTypes: ["Real workflow vlogs", "Setup tours", "Location guides", "Productivity breakdowns"],
  },

  // ── Sports ────────────────────────────────────────────────────────────────────
  {
    id: "sports-science",
    name: "Sports Science & Medicine",
    category: "Sports",
    tags: ["sports science", "physiology", "injury", "training", "nutrition"],
    competition: "Low",
    monetization: "High",
    platforms: ["YouTube"],
    why: "Authority + utility — athletes trust science-backed content for performance gains",
    contentTypes: ["Injury prevention guides", "Performance analysis", "Nutrition science", "Training methodology"],
  },

  // ── Animals & Pets ────────────────────────────────────────────────────────────
  {
    id: "exotic-pets",
    name: "Exotic Pets",
    category: "Animals & Pets",
    tags: ["exotic", "reptiles", "amphibians", "unusual pets", "care guides"],
    competition: "Low",
    monetization: "High",
    platforms: ["YouTube", "TikTok"],
    why: "Novelty + utility — exotic pet owners desperately need specific care guidance",
    contentTypes: ["Care guides", "Enclosure builds", "Feeding videos", "Behavior education"],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

export const NICHE_CATEGORIES = [
  ...new Set(NICHE_DATABASE.map((n) => n.category)),
].sort() as NicheCategory[];

/** Return niches most likely to match a given primary niche string */
export function findRelatedNiches(primary: string, limit = 5): NicheEntry[] {
  const lower = primary.toLowerCase();
  const keywords = lower.split(/[\s,/&-]+/).filter((w) => w.length > 2);

  const scored = NICHE_DATABASE.map((n) => {
    let score = 0;
    const haystack = [n.name, n.category, ...n.tags, ...n.contentTypes]
      .join(" ")
      .toLowerCase();
    for (const kw of keywords) {
      if (haystack.includes(kw)) score += 2;
    }
    return { niche: n, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.niche);
}

/** Return all niches in a category */
export function getNichesByCategory(category: NicheCategory): NicheEntry[] {
  return NICHE_DATABASE.filter((n) => n.category === category);
}

/** Return trending niches */
export function getTrendingNiches(): NicheEntry[] {
  return NICHE_DATABASE.filter((n) => n.trending);
}

/** Return untapped / low competition niches */
export function getUntappedNiches(): NicheEntry[] {
  return NICHE_DATABASE.filter(
    (n) => n.competition === "Very Low" || n.competition === "Low"
  );
}
