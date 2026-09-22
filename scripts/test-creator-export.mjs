import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { renderCreatorProject } from "../server/creatorWorkspace.js";

const evidenceDir = "/tmp/autoyt-creator-evidence";
fs.mkdirSync(evidenceDir, { recursive: true });

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 120000,
    ...options,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} failed (${result.status}): ${String(result.stderr || result.error?.message || "").slice(-2000)}`,
    );
  }
  return result.stdout;
}

const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const ffprobe = process.env.FFPROBE_PATH || "ffprobe";
const root = fs.mkdtempSync(path.join(evidenceDir, "ffmpeg-"));
const projectId = "fixture_project";
const projectDir = path.join(root, projectId);
fs.mkdirSync(projectDir, { recursive: true });
process.env.CREATOR_ASSETS_DIR = root;

run(ffmpeg, [
  "-y",
  "-f",
  "lavfi",
  "-i",
  "color=c=0x1f6f8b:s=640x360",
  "-frames:v",
  "1",
  path.join(projectDir, "one.png"),
]);
run(ffmpeg, [
  "-y",
  "-f",
  "lavfi",
  "-i",
  "color=c=0xf9dc0b:s=640x360",
  "-frames:v",
  "1",
  path.join(projectDir, "two.png"),
]);
run(ffmpeg, [
  "-y",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:duration=2",
  "-c:a",
  "pcm_s16le",
  path.join(projectDir, "voice.wav"),
]);

const project = {
  id: projectId,
  accountId: "account_fixture",
  title: "Fixture export",
  status: "active",
  stage: "review",
  styleId: "",
  metadata: {
    brief: "A local fixture",
    settings: {
      aspect: "16:9",
      soundtrackVolume: 0.18,
      preserveDialogue: true,
      rightsConfirmed: true,
    },
  },
  outputs: {
    script: { draft: "First line. Second line." },
    voiceover: {
      asset: `/api/maker/projects/${projectId}/assets/voice.wav`,
      duration: 2,
      segments: [
        { start: 0, end: 1, text: "First line." },
        { start: 1, end: 2, text: "Second line." },
      ],
    },
    visualPlan: {
      scenes: [
        {
          id: "scene-1",
          start: 0,
          end: 1,
          text: "First line.",
          prompt: "Blue frame",
          motion: "still",
          asset: `/api/maker/projects/${projectId}/assets/one.png`,
        },
        {
          id: "scene-2",
          start: 1,
          end: 2,
          text: "Second line.",
          prompt: "Yellow frame",
          motion: "push",
          asset: `/api/maker/projects/${projectId}/assets/two.png`,
        },
      ],
    },
    thumbnail: {
      asset: `/api/maker/projects/${projectId}/assets/one.png`,
    },
  },
};

const results = [];
for (const aspect of ["9:16", "16:9", "1:1"]) {
  const expected =
    aspect === "9:16"
      ? [720, 1280]
      : aspect === "1:1"
        ? [1080, 1080]
        : [1280, 720];
  project.metadata.settings.aspect = aspect;
  const result = await renderCreatorProject(
    project,
    { id: `fixture_${aspect.replace(":", "x")}`, stage: "review" },
    undefined,
    () => {},
  );
  const outputPath = path.join(
    projectDir,
    `${String(result.asset).split("/").pop()}`,
  );
  const probe = JSON.parse(
    run(ffprobe, [
      "-v",
      "error",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      outputPath,
    ]),
  );
  const video = probe.streams.find((stream) => stream.codec_type === "video");
  const audio = probe.streams.find((stream) => stream.codec_type === "audio");
  const subtitle = probe.streams.find(
    (stream) => stream.codec_type === "subtitle",
  );
  if (!audio || !subtitle) throw new Error(`${aspect} lost audio or captions`);
  if (video.width !== expected[0] || video.height !== expected[1])
    throw new Error(`${aspect} rendered ${video.width}x${video.height}`);
  if (Math.abs(Number(probe.format.duration) - 2) > 0.5)
    throw new Error(`${aspect} duration drifted`);

  const bundlePath = path.join(
    projectDir,
    `${String(result.bundle).split("/").pop()}`,
  );
  const inventory = run("unzip", ["-Z1", bundlePath])
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  for (const required of [
    "video.mp4",
    "narration.wav",
    "captions.srt",
    "script.txt",
    "project.json",
    "manifest.json",
    "scene-1.png",
    "scene-2.png",
  ])
    if (!inventory.includes(required))
      throw new Error(`${aspect} bundle is missing ${required}`);
  results.push({
    aspect,
    dimensions: `${video.width}x${video.height}`,
    duration: Number(probe.format.duration),
    audio: true,
    subtitles: true,
    bundleInventory: inventory,
    manifest: result.manifest,
  });
}

fs.writeFileSync(
  path.join(evidenceDir, "ffmpeg-fixture.json"),
  JSON.stringify({ root, results }, null, 2),
);
console.log(
  JSON.stringify(
    results.map(({ aspect, dimensions, duration, bundleInventory }) => ({
      aspect,
      dimensions,
      duration,
      bundleFiles: bundleInventory.length,
    })),
    null,
    2,
  ),
);
