export type AgentCreateStep = "source" | "publish" | "confirm";

export const AGENT_CREATE_STEPS: Array<{ id: AgentCreateStep; label: string; hint: string }> = [
  { id: "source", label: "Source", hint: "Where clips come from" },
  { id: "publish", label: "Publish", hint: "Which channel, how often" },
  { id: "confirm", label: "Confirm", hint: "Review and create" },
];

export interface AgentCreateDraft {
  name?: string;
  youtubeAccountId?: string;
  sourceType?: string;
  sourceKey?: string;
  sourceUrl?: string;
  settings?: {
    sourceTags?: unknown;
    scheduleTimes?: unknown;
    maxPostsPerDay?: unknown;
    rightsConfirmed?: unknown;
  };
}

function isSupportedSourceUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "youtu.be"
      || host.endsWith(".youtu.be")
      || host === "youtube.com"
      || host.endsWith(".youtube.com")
      || host === "tiktok.com"
      || host.endsWith(".tiktok.com");
  } catch {
    return false;
  }
}

/** Returns the first blocking problem for a step, or an empty string when the step is complete. */
export function agentCreateStepError(step: AgentCreateStep, draft: AgentCreateDraft): string {
  const settings = draft.settings || {};
  if (step === "source") {
    if (draft.sourceType === "custom_url") {
      const url = String(draft.sourceUrl || "").trim();
      if (!url) return "Paste a TikTok or YouTube channel, playlist, or collection URL.";
      if (!isSupportedSourceUrl(url)) return "That link is not a TikTok or YouTube URL.";
      return "";
    }
    if (draft.sourceType === "saved_tags") {
      const tags = Array.isArray(settings.sourceTags) ? settings.sourceTags : [];
      return tags.length ? "" : "Pick at least one tag so the agent knows which saved videos to use.";
    }
    return String(draft.sourceKey || draft.sourceUrl || "").trim() ? "" : "Choose one of your saved sources, or switch to a pasted URL.";
  }
  if (step === "publish") {
    if (!String(draft.name || "").trim()) return "Give the agent a name so you can tell it apart later.";
    if (!String(draft.youtubeAccountId || "").trim()) return "Choose the channel this agent posts to.";
    const times = Array.isArray(settings.scheduleTimes) ? settings.scheduleTimes.filter((value) => /^\d{2}:\d{2}$/.test(String(value || ""))) : [];
    if (!times.length) return "Add at least one release time.";
    return "";
  }
  return settings.rightsConfirmed === true ? "" : "Confirm you have the rights to reuse these clips before creating the agent.";
}

/** Index of the first incomplete step, or the total step count when every step is complete. */
export function agentCreateFirstIncompleteStep(draft: AgentCreateDraft): number {
  const index = AGENT_CREATE_STEPS.findIndex((step) => agentCreateStepError(step.id, draft));
  return index === -1 ? AGENT_CREATE_STEPS.length : index;
}

/** Suggests a readable default name from the publish channel, falling back to a neutral label. */
export function suggestAgentName(channelTitle?: string | null, existingNames: string[] = []): string {
  const base = String(channelTitle || "").replace(/\s+/g, " ").trim();
  const candidate = base ? `${base} agent` : "New agent";
  const taken = new Set(existingNames.map((name) => String(name || "").trim().toLowerCase()));
  if (!taken.has(candidate.toLowerCase())) return candidate;
  let index = 2;
  while (taken.has(`${candidate} ${index}`.toLowerCase())) index += 1;
  return `${candidate} ${index}`;
}

export type AgentGettingStartedStep = { id: "run" | "review" | "activate"; label: string; body: string; done: boolean };

/** The three post-creation steps, with completion derived from what the agent has already done. */
export function agentGettingStartedSteps(input: { uploadCount: number; status?: string | null }): AgentGettingStartedStep[] {
  const hasUpload = input.uploadCount > 0;
  const active = input.status === "active";
  return [
    { id: "run", label: "Run a test candidate", body: "The agent picks one clip, identifies the movie, and uploads it once.", done: hasUpload },
    { id: "review", label: "Check the upload", body: "Confirm the movie is right and the quality looks good.", done: hasUpload },
    { id: "activate", label: "Activate the agent", body: "Switch it on to post automatically on schedule.", done: active },
  ];
}
