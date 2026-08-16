#!/usr/bin/env python3
"""Verify and composite an externally reconstructed caption crop.

This deliberately contains no bundled generative model. A licensed video-editing
provider supplies a reconstructed crop; this verifier identifies only likely
caption glyphs in the original frames and composites the provider result under
that small mask. It keeps the rest of each source frame intact and reports the
strict checks consumed by the Voice Studio worker.
"""

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

import cv2
import numpy as np


def fail(message):
    raise RuntimeError(message)


def video_info(video_path, label):
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        fail(f"Could not read the {label} video.")
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    fps = float(capture.get(cv2.CAP_PROP_FPS) or 0)
    frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    capture.release()
    if not width or not height or not fps or not frame_count:
        fail(f"Could not read the {label} video dimensions or frame rate.")
    return width, height, fps, frame_count


def caption_mask(frame, zone):
    height, width = frame.shape[:2]
    left = max(0, min(width - 1, int(round(width * zone[0]))))
    top = max(0, min(height - 1, int(round(height * zone[1]))))
    right = max(left + 1, min(width, int(round(width * (zone[0] + zone[2])))))
    bottom = max(top + 1, min(height, int(round(height * (zone[1] + zone[3])))))
    roi = frame[top:bottom, left:right]
    hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)

    # Baked social captions tend to use neutral-white glyphs with dark outlines.
    # Select character-shaped components, not a broad bright row: this avoids
    # erasing illustrated faces, highlights, or other scene detail near text.
    dark = (gray <= 105).astype(np.uint8)
    near_dark = cv2.dilate(dark, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
    core = ((gray >= 190) & (hsv[:, :, 1] <= 20) & (near_dark > 0)).astype(np.uint8)
    label_count, labels, stats, _ = cv2.connectedComponentsWithStats(core, connectivity=8)
    max_component_width = max(35, int(round(roi.shape[1] * 0.08)))
    max_component_height = max(32, int(round(roi.shape[0] * 0.10)))
    components = []
    for label in range(1, label_count):
        component_x, component_y, component_width, component_height, area = stats[label]
        density = area / max(1, component_width * component_height)
        if not (2 <= component_width <= max_component_width and 7 <= component_height <= max_component_height):
            continue
        if area < 8 or density < 0.05:
            continue
        components.append({
            "label": label,
            "x": int(component_x),
            "y": int(component_y),
            "width": int(component_width),
            "height": int(component_height),
            "area": int(area),
            "center": float(component_y + component_height / 2),
        })

    # Cluster components into one or two caption rows. A true row has several
    # glyphs, enough ink, and a meaningful horizontal span.
    rows = []
    row_tolerance = max(8, int(round(roi.shape[0] * 0.02)))
    for component in sorted(components, key=lambda value: value["center"]):
        row = next((candidate for candidate in rows if abs(candidate["center"] - component["center"]) <= row_tolerance), None)
        if row is None:
            rows.append({"center": component["center"], "components": [component]})
        else:
            row["components"].append(component)
            row["center"] = float(np.mean([value["center"] for value in row["components"]]))
    qualified_rows = []
    for row in rows:
        row_components = row["components"]
        min_x = min(component["x"] for component in row_components)
        max_x = max(component["x"] + component["width"] for component in row_components)
        total_area = sum(component["area"] for component in row_components)
        if len(row_components) < 5:
            continue
        if total_area < max(100, int(round(roi.shape[1] * 0.18))):
            continue
        if max_x - min_x < max(55, int(round(roi.shape[1] * 0.10))):
            continue
        qualified_rows.append({**row, "area": total_area})

    selected_rows = []
    if qualified_rows:
        best_single = max(qualified_rows, key=lambda row: row["area"])
        best_pair = None
        for first, second in zip(qualified_rows, qualified_rows[1:]):
            distance = abs(second["center"] - first["center"])
            if not 10 <= distance <= 42:
                continue
            score = first["area"] + second["area"] + 100 * min(len(first["components"]), len(second["components"]))
            if best_pair is None or score > best_pair[0]:
                best_pair = (score, first, second)
        selected_rows = [best_pair[1], best_pair[2]] if best_pair else [best_single]

    glyphs = np.zeros_like(core)
    for row in selected_rows:
        for component in row["components"]:
            glyphs[labels == component["label"]] = 1

    # Include anti-aliasing and a small amount of outline only around selected
    # glyphs. This is intentionally not a rectangular lower-third mask.
    near_glyphs = cv2.dilate(glyphs, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    dark_outline = ((gray <= 130).astype(np.uint8) & near_glyphs)
    mask_roi = np.maximum(glyphs, dark_outline)
    mask_roi = cv2.morphologyEx(mask_roi, cv2.MORPH_CLOSE, np.ones((5, 5), dtype=np.uint8))
    mask_roi = cv2.dilate(mask_roi, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))

    # Keep a separate ink signature for residual scoring. The feathered repair
    # mask deliberately includes a little surrounding context; scoring that
    # context as subtitle residue would create false failures on untouched art.
    ink_roi = np.maximum(glyphs, dark_outline)
    mask = np.zeros((height, width), dtype=np.uint8)
    mask[top:bottom, left:right] = mask_roi * 255
    glyph_mask = np.zeros((height, width), dtype=np.uint8)
    glyph_mask[top:bottom, left:right] = glyphs * 255
    ink_mask = np.zeros((height, width), dtype=np.uint8)
    ink_mask[top:bottom, left:right] = ink_roi * 255
    return mask, glyph_mask, ink_mask


def scan_caption_centers(source, zone):
    capture = cv2.VideoCapture(str(source))
    if not capture.isOpened():
        fail("Could not read the source video for caption detection.")
    centers = []
    ink_pixels = []
    frames = 0
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        _, glyph_mask, ink_mask = caption_mask(frame, zone)
        ys, _ = np.where(glyph_mask > 0)
        centers.append(float(np.median(ys)) if len(ys) else None)
        ink_pixels.append(int(np.count_nonzero(ink_mask)))
        frames += 1
    capture.release()
    if not frames:
        fail("The source video did not contain readable frames.")
    valid_centers = [value for value in centers if value is not None]
    return frames, centers, ink_pixels, float(np.median(valid_centers)) if valid_centers else None


def remaining_caption_pixels(source_frame, repaired_frame, original_ink_mask):
    hsv = cv2.cvtColor(repaired_frame, cv2.COLOR_BGR2HSV)
    gray = cv2.cvtColor(repaired_frame, cv2.COLOR_BGR2GRAY)
    still_bright = (gray >= 200) & (hsv[:, :, 1] <= 110)
    dark = (gray <= 105).astype(np.uint8)
    still_outlined = cv2.dilate(dark, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))) > 0
    # White interiors alone are not enough: a black outline can remain readable
    # after a weak edit. Count original caption ink that either still has the
    # bright/outlining signature or barely changed from the source. The latter
    # makes this deliberately conservative for dark outlined glyphs.
    delta = np.max(np.abs(source_frame.astype(np.int16) - repaired_frame.astype(np.int16)), axis=2)
    unchanged_ink = delta <= 18
    return int(np.count_nonzero((original_ink_mask > 0) & (unchanged_ink | (still_bright & still_outlined))))


def render_command(ffmpeg, width, height, fps, source, output, duration):
    output.parent.mkdir(parents=True, exist_ok=True)
    return subprocess.Popen([
        ffmpeg, "-y",
        "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{width}x{height}", "-r", f"{fps:.6f}", "-i", "pipe:0",
        "-i", str(source),
        "-map", "0:v:0", "-map", "1:a?",
        "-c:v", "libx264", "-crf", "17", "-preset", "medium", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k", "-t", f"{duration:.6f}", "-movflags", "+faststart", str(output),
    ], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def parse_values(value, expected, label):
    try:
        values = tuple(float(item) for item in value.split(","))
    except ValueError as error:
        raise RuntimeError(f"{label} contains invalid values.") from error
    if len(values) != expected:
        fail(f"{label} must contain {expected} comma-separated values.")
    return values


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="Source segment with its original video frames")
    parser.add_argument("--candidate", help="Provider-reconstructed crop video")
    parser.add_argument("--output")
    parser.add_argument("--zone", required=True, help="x,y,width,height as normalized fractions")
    parser.add_argument("--crop", help="x,y,width,height as source-frame pixels")
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument("--engine", default="Licensed temporal video reconstruction")
    parser.add_argument("--inspect", action="store_true", help="Only validate that caption glyphs exist before an external request")
    args = parser.parse_args()

    source = Path(args.input).resolve()
    if not source.is_file():
        fail("The source video was not found.")
    zone = parse_values(args.zone, 4, "Caption zone")
    if zone[2] <= 0 or zone[3] <= 0 or min(zone) < 0 or zone[0] + zone[2] > 1 or zone[1] + zone[3] > 1:
        fail("Caption zone must be contained inside the video.")

    width, height, fps, reported_frames = video_info(source, "source")
    started = time.time()
    scanned_frames, centers, ink_counts, median_center = scan_caption_centers(source, zone)
    if scanned_frames != reported_frames:
        reported_frames = scanned_frames
    vertical_tolerance = max(64, int(round(height * 0.10)))
    valid_indices = [
        index for index, center in enumerate(centers)
        if center is not None and (median_center is None or abs(center - median_center) <= vertical_tolerance)
    ]
    detected_frames = len(valid_indices)
    detected_frame_ratio = detected_frames / max(1, reported_frames)
    detected_ink_pixels = sum(ink_counts[index] for index in valid_indices)
    if args.inspect:
        if detected_frame_ratio < 0.03 or detected_ink_pixels < 250:
            fail("No reliable hard-coded captions were detected in the selected zone. Choose the zone containing the captions and retry.")
        print(json.dumps({
            "sourceDurationSeconds": round(reported_frames / fps, 3),
            "frameCount": reported_frames,
            "fps": round(fps, 3),
            "detectedFrameRatio": round(detected_frame_ratio, 4),
            "detectedCaptionFrames": detected_frames,
            "inputCaptionPixels": detected_ink_pixels,
            "elapsedSeconds": round(time.time() - started, 2),
        }))
        return

    if not args.candidate or not args.output or not args.crop:
        fail("Candidate, output, and crop are required when compositing caption cleanup.")
    candidate = Path(args.candidate).resolve()
    output = Path(args.output).resolve()
    if not candidate.is_file():
        fail("The reconstructed crop was not found.")
    crop_values = parse_values(args.crop, 4, "Caption crop")
    crop = tuple(int(round(item)) for item in crop_values)
    crop_x, crop_y, crop_width, crop_height = crop
    if crop_width <= 0 or crop_height <= 0 or crop_x < 0 or crop_y < 0 or crop_x + crop_width > width or crop_y + crop_height > height:
        fail("Caption crop must be contained inside the source video.")
    candidate_width, candidate_height, candidate_fps, _ = video_info(candidate, "reconstructed crop")
    if candidate_width != crop_width or candidate_height != crop_height:
        fail("The reconstructed crop changed dimensions and cannot be safely composited.")
    if abs(candidate_fps - fps) > 0.02:
        fail("The reconstructed crop changed frame rate and cannot be safely composited.")

    source_capture = cv2.VideoCapture(str(source))
    candidate_capture = cv2.VideoCapture(str(candidate))
    if not source_capture.isOpened() or not candidate_capture.isOpened():
        fail("Could not reopen a video for frame compositing.")
    render = render_command(args.ffmpeg, width, height, fps, source, output, reported_frames / fps)
    if render.stdin is None:
        fail("Could not start the final video renderer.")

    frame_count = 0
    detected_frames = 0
    input_caption_pixels = 0
    masked_pixels = 0
    remaining_pixels = 0
    extra_candidate = False
    try:
        while True:
            ok, base = source_capture.read()
            if not ok:
                break
            candidate_ok, repaired = candidate_capture.read()
            if not candidate_ok:
                fail("The reconstructed crop did not contain every source frame.")
            if repaired.shape[1] != crop_width or repaired.shape[0] != crop_height:
                fail("The reconstructed crop frame dimensions changed during processing.")
            mask, glyph_mask, ink_mask = caption_mask(base, zone)
            if median_center is not None and centers[frame_count] is not None and abs(centers[frame_count] - median_center) > vertical_tolerance:
                mask = np.zeros_like(mask)
                glyph_mask = np.zeros_like(glyph_mask)
                ink_mask = np.zeros_like(ink_mask)
            local_mask = (mask[crop_y:crop_y + crop_height, crop_x:crop_x + crop_width] > 0).astype(np.uint8)
            if np.any(glyph_mask):
                source_frame = base.copy()
                detected_frames += 1
                input_caption_pixels += int(np.count_nonzero(ink_mask))
                masked_pixels += int(np.count_nonzero(mask))
                target = base[crop_y:crop_y + crop_height, crop_x:crop_x + crop_width]
                # Feather only a few pixels around the detected outline. The
                # candidate never replaces a full lower-third rectangle.
                support = cv2.dilate(local_mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
                alpha = cv2.GaussianBlur(support.astype(np.float32), (0, 0), 1.15)
                alpha = np.clip(alpha, 0.0, 1.0)[:, :, np.newaxis]
                base[crop_y:crop_y + crop_height, crop_x:crop_x + crop_width] = np.rint(target * (1.0 - alpha) + repaired * alpha).astype(np.uint8)
                remaining_pixels += remaining_caption_pixels(source_frame, base, ink_mask)
            render.stdin.write(base.tobytes())
            frame_count += 1
        extra_candidate, _ = candidate_capture.read()
    finally:
        source_capture.release()
        candidate_capture.release()
        render.stdin.close()
    if extra_candidate:
        fail("The reconstructed crop contained extra frames and cannot be safely aligned.")
    stderr = render.stderr.read().decode("utf-8", "replace") if render.stderr else ""
    exit_code = render.wait()
    if exit_code != 0:
        fail(f"Final video render failed. {stderr.strip()[-1800:]}")
    if frame_count != reported_frames:
        fail("The source-frame count changed during caption compositing.")
    if frame_count < 1:
        fail("The source video contained no compositable frames.")
    detected_frame_ratio = detected_frames / frame_count
    if detected_frame_ratio < 0.03 or input_caption_pixels < 250:
        fail("No reliable hard-coded captions were detected in the selected zone. Choose the zone containing the captions and retry.")

    result = {
        "engine": args.engine,
        "sourceDurationSeconds": round(frame_count / fps, 3),
        "frameCount": frame_count,
        "fps": round(fps, 3),
        "candidateFrameRate": round(candidate_fps, 3),
        "candidateFrameCount": frame_count,
        "zone": {"x": zone[0], "y": zone[1], "width": zone[2], "height": zone[3]},
        "crop": {"x": crop_x, "y": crop_y, "width": crop_width, "height": crop_height},
        "detectedFrameRatio": round(detected_frame_ratio, 4),
        "inputCaptionPixels": input_caption_pixels,
        "remainingCaptionPixels": remaining_pixels,
        "maskedPixelRatio": round(masked_pixels / max(1, frame_count * width * height), 5),
        "candidateTimingPassed": True,
        "elapsedSeconds": round(time.time() - started, 2),
    }
    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"error": str(error)}))
        sys.exit(1)
