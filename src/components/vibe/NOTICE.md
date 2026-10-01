# Vibe Edit notice

Vibe Edit is adapted from Donkey Cut (https://github.com/donkeycut/donkey),
Copyright Donkey Cut contributors, licensed under the Apache License 2.0
(https://www.apache.org/licenses/LICENSE-2.0).

Parts derived from it, changed to run on AutoYT's services:

- The project model (clips on stacked tracks, soundtrack lanes with ducking,
  word-timed captions): `src/utils/vibeEdit.ts`.
- The voice treatment presets and their equalizer, compressor and limiter
  values: `src/utils/vibeSound.js`.
- The voiceover planning step that reads a delivery direction for a language
  request and translates the lines, the per-line synthesis laid out on caption
  times, and caption re-timing: `server/vibeEdit.js`,
  `src/components/vibe/commands.ts`.
- The assistant's edit-tool vocabulary: `src/utils/vibeEditActions.js`.
- The Gemini prebuilt voice catalog descriptions: `server/hostedVoices.js`.
