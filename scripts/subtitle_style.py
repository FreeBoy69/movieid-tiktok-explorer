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
        raise RuntimeError("Install tesseract-ocr on the worker to detect original captions.")
    info = json.loads(subprocess.check_output([os.environ.get("FFPROBE_PATH", "ffprobe"), "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", filename], timeout=15))
    video = info["streams"][0]
    width, height = int(video["width"]), int(video["height"])
    duration = float(info["format"]["duration"])
    # System FFmpeg supports AV1 software decoding even when OpenCV's bundled
    # decoder does not. Sample still frames, without transcoding the full clip.
    # Upscale small exports too; otherwise lowercase interiors fall below the
    # character-size threshold before OCR has a chance to recognize them.
    scale = min(4, 1280 / max(width, height))
    width, height = int(width * scale) // 2 * 2, int(height * scale) // 2 * 2
    samples = []
    for sample, fraction in enumerate(np.linspace(.04, .96, 12)):
        raw = subprocess.run([os.environ.get("FFMPEG_PATH", "ffmpeg"), "-v", "error", "-threads", "1", "-ss", str(duration * fraction), "-i", filename, "-frames:v", "1", "-filter_threads", "1", "-vf", f"scale={width}:{height}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], capture_output=True, timeout=20)
        if raw.returncode or len(raw.stdout) != width * height * 3:
            continue
        frame = np.frombuffer(raw.stdout, dtype=np.uint8).reshape(height, width, 3)
        # Remove large scene shapes before OCR. Colored/italic captions are
        # easier to recognize as isolated interiors than against moving art.
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        near_dark = cv2.dilate((gray < 95).astype(np.uint8), np.ones((5, 5), np.uint8))
        core = ((hsv[:, :, 2] > 185) & (near_dark > 0)).astype(np.uint8)
        count, labels, stats, _ = cv2.connectedComponentsWithStats(core)
        mask = np.zeros_like(core)
        for index in range(1, count):
            gx, gy, gw, gh, area = stats[index]
            if 7 <= gh <= min(height * .12, width * .12) and 2 <= gw <= gh * 2.5 and area >= 8:
                mask[labels == index] = 255
        joined = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, max(9, int(width * .03))), np.uint8))
        contours, _ = cv2.findContours(joined, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        proposals = [cv2.boundingRect(contour) for contour in contours]
        proposals = [box for box in proposals if box[2] >= width * .18 and 8 <= box[3] <= min(height * .14, width * .14)]
        # A bounded set prevents busy frames from creating unbounded OCR work.
        for x, top, row_width, row_height in sorted(proposals, key=lambda box: box[2], reverse=True)[:8]:
            right, bottom = x + row_width, top + row_height
            if abs((x + right) / 2 - width / 2) > width * .3:
                continue
            isolated = 255 - mask[max(0, top-4):min(height, bottom+4), max(0, x-4):min(width, right+4)]
            isolated = cv2.resize(isolated, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
            isolated = cv2.copyMakeBorder(isolated, 20, 20, 20, 20, cv2.BORDER_CONSTANT, value=255)
            _, png = cv2.imencode(".png", isolated)
            ocr = subprocess.run(["tesseract", "stdin", "stdout", "--psm", "7", "tsv"], input=png.tobytes(), capture_output=True, timeout=10, env=ocr_env)
            if ocr.returncode:
                continue
            words = [word for word in csv.DictReader(io.StringIO(ocr.stdout.decode()), delimiter="\t") if float(word["conf"]) >= 45 and any(c.isalpha() for c in word["text"])]
            if sum(sum(c.isalpha() for c in word["text"]) for word in words) < 8:
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
            samples.append((top, bottom, float(row_height), color, sample, bool(slopes and np.median(slopes) > .07)))
    if len(samples) < 4:
        raise RuntimeError("Could not reliably locate burned-in subtitles in this video. Retry detection with a clearer source.")
    groups = [[s for s in samples if abs((s[0] + s[1] - seed[0] - seed[1]) / 2) < height * .045] for seed in samples]
    stable = max(groups, key=lambda group: (len(set(s[4] for s in group)), len(group)))
    sample_count = len(set(s[4] for s in stable))
    if sample_count < 4:
        raise RuntimeError("Could not confirm a consistent subtitle area. Retry detection with a clearer source.")
    # Include neighboring rows that recur alongside the primary caption line.
    # This covers two-line captions instead of masking only the strongest row.
    center = float(np.median([(s[0] + s[1]) / 2 for s in stable]))
    primary_frames = set(s[4] for s in stable)
    nearby = [s for s in samples if s[4] in primary_frames and abs((s[0] + s[1]) / 2 - center) < height * .14]
    supported = [s for s in nearby if len(set(t[4] for t in nearby if abs((t[0] + t[1] - s[0] - s[1]) / 2) < height * .025)) >= 2]
    coverage = supported or stable
    top = max(0, min(s[0] for s in coverage) - height * .015)
    bottom = min(height, max(s[1] for s in coverage) + height * .015)
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
