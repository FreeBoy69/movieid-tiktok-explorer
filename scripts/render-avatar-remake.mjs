import fs from "node:fs";
import path from "node:path";
import {
  applyTimelineScenes,
  composeAvatarRemake,
  generateTalkingAvatar,
} from "../src/utils/avatarProviders.js";
import { normalizeAvatarRemake, timelineNeedsReedit } from "../src/utils/avatarRemake.js";

/**
 * End-to-end avatar remake: optional timeline cut → talking avatar → split/full compose.
 */
export async function renderAvatarRemake({
  sourcePath,
  narrationPath,
  facePath,
  outputPath,
  workspace,
  settings,
  scenes,
  durationSeconds,
  runFfmpeg,
  probeDuration,
  onProgress,
}) {
  const remake = normalizeAvatarRemake(settings);
  if (!fs.existsSync(facePath)) throw new Error("Upload a client face image before rendering an avatar remake.");
  if (!fs.existsSync(narrationPath)) throw new Error("A narration audio track is required for avatar remakes. Render a voiceover first.");

  let picturePath = sourcePath;
  if (timelineNeedsReedit(scenes)) {
    onProgress?.("Applying timeline scene order", 0.12);
    picturePath = await applyTimelineScenes(sourcePath, scenes, workspace, runFfmpeg, probeDuration);
  }

  const duration = Math.max(1, Number(durationSeconds) || (probeDuration ? await probeDuration(narrationPath) : 5));
  onProgress?.(`Generating ${remake.provider} talking avatar`, 0.28);
  const avatar = await generateTalkingAvatar(remake.provider, {
    imagePath: facePath,
    audioPath: narrationPath,
    workspace,
    durationSeconds: duration,
    aspectRatio: remake.aspectRatio,
    resolution: remake.resolution,
    prompt: remake.prompt,
    runFfmpeg,
    onProgress: (message, fraction) => onProgress?.(message, 0.28 + fraction * 0.4),
  });

  onProgress?.(`Composing ${remake.layout} remake`, 0.78);
  await composeAvatarRemake({
    sourcePath: picturePath,
    avatarPath: avatar.path,
    outputPath,
    layout: remake.layout,
    splitRatio: remake.splitRatio,
    durationSeconds: duration,
    runFfmpeg,
  });

  return {
    settings: remake,
    avatarProvider: avatar.provider,
    avatarPath: avatar.path,
    picturePath,
    outputPath,
    durationSeconds: duration,
  };
}
