#!/usr/bin/env python3
"""Estimate common outlined caption geometry/color locally; no provider calls."""
import json
import csv
import io
import os
import shutil
import subprocess
import sys
import cv2
import numpy as np


def estimate(filename):
    cv2.setNumThreads(1)
    ocr_env = {**os.environ, "OMP_THREAD_LIMIT": "1"}
    if not shutil.which("tesseract"):
        raise RuntimeError("Install tesseract-ocr on the worker to estimate styles. Manual controls remain available.")
    info = json.loads(subprocess.check_output([os.environ.get("FFPROBE_PATH", "ffprobe"), "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", filename], timeout=15))
    video = info["streams"][0]
    width, height = int(video["width"]), int(video["height"])
    duration = float(info["format"]["duration"])
    # System FFmpeg supports AV1 software decoding even when OpenCV's bundled
    # decoder does not. Sample still frames, without transcoding the full clip.
    scale = min(1, 1280 / max(width, height))
    width, height = int(width * scale) // 2 * 2, int(height * scale) // 2 * 2
    samples = []
    for sample, fraction in enumerate(np.linspace(.04, .96, 12)):
        raw = subprocess.run([os.environ.get("FFMPEG_PATH", "ffmpeg"), "-v", "error", "-threads", "1", "-ss", str(duration * fraction), "-i", filename, "-frames:v", "1", "-filter_threads", "1", "-vf", f"scale={width}:{height}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], capture_output=True, timeout=20)
        if raw.returncode or len(raw.stdout) != width * height * 3:
            continue
        frame = np.frombuffer(raw.stdout, dtype=np.uint8).reshape(height, width, 3)
        _, png = cv2.imencode(".png", frame)
        ocr = subprocess.run(["tesseract", "stdin", "stdout", "--psm", "11", "tsv"], input=png.tobytes(), capture_output=True, timeout=15, env=ocr_env)
        if ocr.returncode:
            continue
        rows = {}
        for word in csv.DictReader(io.StringIO(ocr.stdout.decode()), delimiter="\t"):
            if float(word["conf"]) < 40 or not any(c.isalpha() for c in word["text"]):
                continue
            rows.setdefault((word["block_num"], word["par_num"], word["line_num"]), []).append(word)
        for words in rows.values():
            if len(words) < 3:
                continue
            x = min(int(w["left"]) for w in words)
            right = max(int(w["left"]) + int(w["width"]) for w in words)
            top = min(int(w["top"]) for w in words)
            bottom = max(int(w["top"]) + int(w["height"]) for w in words)
            if right - x < width * .15 or abs((x + right) / 2 - width / 2) > width * .3:
                continue
            roi = frame[top:bottom, x:right]
            hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
            gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
            dark = cv2.dilate((gray < 100).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
            glyphs = ((hsv[:, :, 2] > 185) & dark).astype(np.uint8)
            pixels = roi[glyphs > 0]
            if len(pixels) < 20:
                continue
            saturated = roi[(glyphs > 0) & (hsv[:, :, 1] > 100)]
            color = np.median(saturated if len(saturated) > len(pixels) * .2 else pixels, axis=0)
            count, labels, stats, _ = cv2.connectedComponentsWithStats(glyphs)
            slopes = []
            for index in range(1, count):
                gx, gy, gw, gh, area = stats[index]
                if gh < 8 or gw < 3 or area < 10:
                    continue
                yy, xx = np.where(labels[gy:gy+gh, gx:gx+gw] == index)
                upper, lower = xx[yy < gh * .3], xx[yy > gh * .7]
                if len(upper) and len(lower):
                    slopes.append((float(np.mean(upper)) - float(np.mean(lower))) / gh)
            samples.append((top, bottom, float(np.median([int(w["height"]) for w in words])), color, sample, bool(slopes and np.median(slopes) > .07)))
    if len(samples) < 4:
        raise RuntimeError("Could not reliably estimate the original captions. Set the band and style manually.")
    groups = [[s for s in samples if abs((s[0] + s[1] - seed[0] - seed[1]) / 2) < height * .045] for seed in samples]
    stable = max(groups, key=lambda group: (len(set(s[4] for s in group)), len(group)))
    sample_count = len(set(s[4] for s in stable))
    if sample_count < 4:
        raise RuntimeError("Caption positions vary too much. Set a band that covers every caption manually.")
    top = max(0, min(s[0] for s in stable) - height * .015)
    bottom = min(height, max(s[1] for s in stable) + height * .015)
    color = np.median([s[3] for s in stable], axis=0).astype(int)
    band = max(height * .06, bottom - top)
    top = max(0, min(height - band, (top + bottom - band) / 2))
    return {"y": round(top / height * 100, 1), "height": round(band / height * 100, 1), "fontSize": round(np.median([s[2] for s in stable]) * 1.35 / width * 100, 1), "font": "Arial", "bold": True, "italic": sum(s[5] for s in stable) > len(stable) / 2, "color": "#%02x%02x%02x" % tuple(color[::-1]), "outline": 2, "sampleCount": sample_count, "confidence": "estimate"}


if __name__ == "__main__":
    try:
        print(json.dumps(estimate(sys.argv[1])))
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
