# Media worker image for LingCode container-compute.
#
# Carries the three toolchains the hosted-app tier does not have -- ffmpeg,
# yt-dlp and faster-whisper -- so the 26 routes that shell out to them can run
# as jobs instead of failing ENOENT in the Express container.
#
# MUST be built for linux/amd64. Building on an Apple-silicon Mac without the
# flag produces an arm64 image that the runner will refuse:
#
#   docker build --platform=linux/amd64 \
#     -t lingcode-compute/32f0868d386a15ec19705ef0:media-worker \
#     -f lingcode/media-worker/Dockerfile .
#
# Build context is the REPO ROOT (it needs scripts/ and src/utils/), not this
# directory.

FROM --platform=linux/amd64 node:22-bookworm-slim

# ffmpeg brings ffprobe. python3 runs transcribe.py and hosts yt-dlp.
# ca-certificates is required for HTTPS fetches to the source platforms.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      python3 \
      python3-pip \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# faster-whisper pulls ctranslate2 + onnxruntime, which are large; keeping this
# in its own layer means a worker code change does not re-download them.
# --break-system-packages is needed on bookworm's externally-managed python.
RUN pip3 install --no-cache-dir --break-system-packages \
      "yt-dlp>=2025.1.15" \
      "faster-whisper>=1.0.0"

WORKDIR /app

# No npm dependencies: the worker talks to the backend over the HTTPS data-API
# gateway using built-in fetch, so it needs no database driver and no DB creds.

# transcribe.py is the same helper the VPS used; job-transcribe.mjs shells to it.
COPY scripts/transcribe.py            ./scripts/transcribe.py
COPY scripts/lingcode-cloud/job-transcribe.mjs ./scripts/lingcode-cloud/job-transcribe.mjs

# Pre-download the whisper weights so the first job does not pay for it (and so
# the worker does not need a writable HOME at runtime). Must match the model
# transcribe.py loads: WhisperModel("base", compute_type="int8").
ENV HF_HOME=/opt/whisper-cache
RUN python3 -c "from faster_whisper import WhisperModel; WhisperModel('base', device='cpu', compute_type='int8')"

# The runner mounts writable scratch here; job-transcribe.mjs falls back to the
# OS temp dir when it is unset so the script stays runnable locally.
ENV SCRATCH_DIR=/scratch
RUN mkdir -p /scratch

# Supply these at run time (never bake them into the image):
#   LINGCODE_GATEWAY_URL=https://lingcode.dev/api/cloud/be/<backendId>
#   LINGCODE_ANON_KEY=<anon key>
#
# Claim one job and exit. The schedule (cron every minute, overlap: skip) is what
# makes this a worker; a long-lived loop would double up against that schedule.
CMD ["node", "scripts/lingcode-cloud/job-transcribe.mjs", "--once"]
