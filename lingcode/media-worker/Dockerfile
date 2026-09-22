# Media worker image for LingCode container-compute.
#
# Carries only what genuinely needs a container: ffmpeg (for audio extraction)
# and yt-dlp (for downloading). Transcription runs on the OpenAI API instead of
# a local faster-whisper, because the ML stack (onnxruntime + ctranslate2 +
# tokenizers) plus baked weights pushed the image to 528 MB compressed -- about
# 20x the container-compute image-upload ceiling.
#
# MUST be built for linux/amd64. Building on an Apple-silicon Mac without the
# flag produces an arm64 image the runner will refuse:
#
#   docker build --platform=linux/amd64 \
#     -t lingcode-compute/32f0868d386a15ec19705ef0:media-worker \
#     -f lingcode/media-worker/Dockerfile .
#
# Build context is the REPO ROOT (it needs scripts/), not this directory.

FROM node:22-alpine

# Alpine's ffmpeg pulls a far smaller dependency tree than Debian's, which drags
# in llvm/mesa/pango for rendering filters this worker never uses. ffmpeg brings
# ffprobe with it. yt-dlp ships as a self-contained binary, so no Python runtime
# is needed at all.
ARG YTDLP_VERSION=2026.08.19
RUN apk add --no-cache ffmpeg ca-certificates \
 && wget -q -O /usr/local/bin/yt-dlp \
      "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp_musllinux" \
 && chmod +x /usr/local/bin/yt-dlp

WORKDIR /app

# No npm dependencies: the worker talks to the backend over the HTTPS data-API
# gateway using built-in fetch, so it needs no database driver and no DB creds.
COPY scripts/lingcode-cloud/job-transcribe.mjs ./scripts/lingcode-cloud/job-transcribe.mjs

# The runner mounts writable scratch here; job-transcribe.mjs falls back to the
# OS temp dir when it is unset so the script stays runnable locally.
ENV SCRATCH_DIR=/scratch
RUN mkdir -p /scratch

# Supply these at run time (never bake them into the image):
#   LINGCODE_GATEWAY_URL=https://lingcode.dev/api/cloud/be/<backendId>
#   LINGCODE_ANON_KEY=<anon key>
#   OPENAI_API_KEY=<key>            -- transcription
#
# Claim one job and exit. The schedule (cron every minute, overlap: skip) is what
# makes this a worker; a long-lived loop would double up against that schedule.
CMD ["node", "scripts/lingcode-cloud/job-transcribe.mjs", "--once"]
