#!/usr/bin/env python3
"""Render a HyperFrames project on the media worker.

The app has no Chrome of its own, so every HyperFrames render (Create Video
overlays and captions, Vibe Motion exports, Vibe Edit titles) runs here, on the
worker that already renders Movie to Recap's graphics. The app uploads the
project directory and gets back whatever is written next to the output.

  hyperframes_render.py PROJECT OUTPUT [--composition index.html] [--format mp4|mov|webm]
                        [--fps 30] [--batch rows.json] [--workers 2]

With --batch, OUTPUT is a pattern containing {index}: one file per row of
variables, rendered from the one composition.
"""
import argparse
import os
import subprocess
import sys

HYPERFRAMES = os.environ.get("HYPERFRAMES_BIN") or "/opt/autoyt/hyperframes/node_modules/.bin/hyperframes"
# HyperFrames downloads its own Chrome on first use; the worker already has one for Promo Studio.
BROWSER = os.environ.get("HYPERFRAMES_BROWSER_PATH") or next(
    (p for p in ("/opt/autoyt/promo-renderer/chrome/chrome-headless-shell",) if os.path.isfile(p)), "")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("project")
    parser.add_argument("output")
    parser.add_argument("--composition", default="")
    parser.add_argument("--format", default="mp4", choices=["mp4", "mov", "webm"])
    parser.add_argument("--fps", default="30")
    parser.add_argument("--batch", default="")
    parser.add_argument("--workers", default="2")
    args = parser.parse_args()

    project = os.path.abspath(args.project)
    output = os.path.abspath(args.output)
    os.makedirs(os.path.dirname(output), exist_ok=True)
    if not os.path.isfile(HYPERFRAMES):
        sys.exit(f"HyperFrames is not installed at {HYPERFRAMES}")
    command = [HYPERFRAMES, "render", project, "--output", output, "--format", args.format, "--fps", str(args.fps),
               "--workers", str(args.workers), "--no-browser-gpu", "--quiet"]
    if args.composition:
        command += ["-c", args.composition]
    if args.batch:
        command += ["--batch", os.path.abspath(args.batch)]
    env = {**os.environ, **({"HYPERFRAMES_BROWSER_PATH": BROWSER} if BROWSER else {})}
    result = subprocess.run(command, cwd=project, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, timeout=3600, env=env)
    if result.returncode != 0:
        sys.exit(f"HyperFrames render failed: {result.stderr[-1800:]}")


if __name__ == "__main__":
    main()
