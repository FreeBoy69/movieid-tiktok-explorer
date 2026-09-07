#!/usr/bin/env bash
set -euo pipefail

# The caption verifier only needs OpenCV and NumPy. It does not download or
# install a generative model; reconstruction is performed by the configured
# licensed provider.
autoyt_caption_python="${CAPTION_CLEANUP_PYTHON:-python3}"
if ! "$autoyt_caption_python" -c 'import cv2, numpy' >/dev/null 2>&1; then
  "$autoyt_caption_python" -m pip install --disable-pip-version-check --upgrade opencv-python-headless numpy
fi

# Local subtitle style estimation uses OCR; manual placement and FFmpeg rendering
# remain available without it on non-Debian developer machines.
if ! command -v tesseract >/dev/null 2>&1 && command -v apt-get >/dev/null 2>&1 && [ "$(id -u)" -eq 0 ]; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq tesseract-ocr fonts-liberation
fi
