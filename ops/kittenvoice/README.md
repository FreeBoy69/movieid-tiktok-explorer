# KittenVoice

AutoYT's self-hosted voice service on the media VPS (212.95.34.95), replacing Voicebox on 2026-10-10.
It speaks Voicebox's HTTP API (the routes `server.js` `voiceboxFetch` and `server/voicebox.js` use), so
the app, the nginx token proxy on :17494, and the Cloudflare tunnel are unchanged.

- Cloned voices: KittenTTS 2 through the `kitten-tts-2-cpp` CPU runtime (about 4–6x slower than real
  time on 4 cores, ~2 GB). A new voice is prepared once from its sample and transcript (~20 s).
- Preset voices: the KittenTTS mini model, kept loaded (about 3x faster than real time).
- Free-text directions map onto KittenTTS's mood tags (`mood_of` in service.py).

On the VPS: data in `/opt/kittenvoice/data` (profiles, samples, history, audio, runtime assets), the
runtime and Python package in `/opt/kittenvoice/engine`, model weights in the `kitten-hf` Docker volume,
`KV_REPO` in `/opt/kittenvoice/env`. Container `kittenvoice` (image `kittenvoice:1`, built from this
folder on top of `kittenvoice-base:1`), bound to 127.0.0.1:17493, restart unless-stopped.
`migrate.py` moved Voicebox's profiles, samples, and history; a backup of Voicebox's data is in
`/opt/backups/voicebox-data-2026-10-10.tgz`.
