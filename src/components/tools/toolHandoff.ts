// Moving a file between apps: a tool result can open in another tool or in a
// Creator Studio app with the file already loaded. Both sides keep their drafts
// in localStorage, so a handoff writes the draft and then navigates.
import { isToolId, STUDIO_TABS, type StudioTab, type ToolId, writeDeepLink } from "../../utils/tiktokRoute";

export type HandoffAsset = { file: string; url: string; type: string; name?: string };
export const TOOL_DRAFTS_KEY = "autoyt-tools-drafts-v1";
const STUDIO_DRAFTS_KEY = "autoyt-creator-studio-drafts-v2";

export function readDrafts(key: string): Record<string, Record<string, any>> {
  try {
    const saved = JSON.parse(window.localStorage.getItem(key) || "{}");
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}
export function writeDrafts(key: string, drafts: Record<string, Record<string, any>>) {
  try {
    window.localStorage.setItem(key, JSON.stringify(drafts));
  } catch {}
}

/** Loads an asset (or any draft fields) into a tool and opens it. */
export function openToolWith(toolId: ToolId, fields: Record<string, any>) {
  const drafts = readDrafts(TOOL_DRAFTS_KEY);
  drafts[toolId] = { ...(drafts[toolId] || {}), ...fields };
  writeDrafts(TOOL_DRAFTS_KEY, drafts);
  writeDeepLink({ view: "tool", toolId });
}

/** Sends a file to a tool or a Creator Studio app, whichever `target` names. */
export function sendAsset(target: string, field: string, asset: HandoffAsset) {
  const value = { file: asset.file, url: asset.url, type: asset.type, name: asset.name };
  if (isToolId(target)) return openToolWith(target, { [field]: value });
  if (!(STUDIO_TABS as readonly string[]).includes(target)) return;
  const drafts = readDrafts(STUDIO_DRAFTS_KEY);
  // An image sent to Video Studio opens its composer in start-frame mode.
  drafts[target] = { ...(drafts[target] || {}), [field]: value, ...(target === "video" && field === "firstFrame" ? { videoTab: "text", frameMode: "first" } : {}) };
  writeDrafts(STUDIO_DRAFTS_KEY, drafts);
  writeDeepLink({ view: "studio", studioTab: target as StudioTab });
}
