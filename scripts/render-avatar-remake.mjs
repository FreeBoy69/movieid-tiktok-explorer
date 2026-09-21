import fs from "node:fs";
import path from "node:path";
import {
  composeAvatarRemake,
  generateTalkingAvatar,
} from "../src/utils/avatarProviders.js";
import { normalizeAvatarRemake, timelineNeedsReedit, avatarScenePlan } from "../src/utils/avatarRemake.js";

/**
 * Generate a talking avatar and composite it on the original synchronized timeline.
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
  publishMedia,
  onProgress,
}) {
  const remake = normalizeAvatarRemake(settings);
  if (!fs.existsSync(facePath)) throw new Error("Upload a client face image before rendering an avatar remake.");
  if (!fs.existsSync(narrationPath)) throw new Error("A narration audio track is required for avatar remakes. Render a voiceover first.");

  const duration = Number(durationSeconds) || (probeDuration ? await probeDuration(narrationPath) : 0);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Could not determine narration duration.");
  const plan = remake.layout === "smart" ? avatarScenePlan(scenes, duration) : scenes;
  if (remake.layout === "smart" && !plan.some(scene => scene.role !== "broll"))
    throw new Error("No presenter scenes were identified. Choose Split or Full to place an avatar manually.");

  const picturePath = sourcePath;

  if (timelineNeedsReedit(scenes))
    throw new Error("Restore the original scene order before rendering to keep the avatar and narration synchronized.");
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
    publishMedia,
    onProgress: (message, fraction) => onProgress?.(message, 0.28 + fraction * 0.4),
  });

  if (probeDuration && await probeDuration(avatar.path) < duration - 0.15)
    throw new Error("The generated avatar does not cover the complete narration. No remake was exported.");

  onProgress?.(`Composing ${remake.layout} remake`, 0.78);
  await composeAvatarRemake({
    sourcePath: picturePath,
    avatarPath: avatar.path,
    narrationPath,
    outputPath,
    layout: remake.layout,
    splitRatio: remake.splitRatio,
    aspectRatio: remake.aspectRatio,
    scenes: plan,
    durationSeconds: duration,
    runFfmpeg,
  });

  if (probeDuration && Math.abs(await probeDuration(outputPath) - duration) > 0.15)
    throw new Error("The avatar remake failed its duration check. No export was saved.");

  return {
    settings: remake,
    avatarProvider: avatar.provider,
    avatarPath: avatar.path,
    picturePath,
    outputPath,
    durationSeconds: duration,
  };
}
