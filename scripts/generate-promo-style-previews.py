"""Builds Promo Studio's style previews from the mg-styles-15 films (MIT, Vincentwei1021/mg-styles-15).

  python3 scripts/generate-promo-style-previews.py <mg-styles-15 checkout>

Writes, to keep the hosted bundle under its 500-file limit, two files only:
  public/assets/promo/styles.webp       the picker sprite: one 320x180 tile per style, 5 across, in STYLE order
  public/assets/promo/promo-frames.bin  every reference sheet Opus is shown, packed behind a JSON header (4-byte
                                        big-endian length, then {"key": [offset, length]}): "style:<id>", each
                                        style's 12-frame sheet (JPEG, 4x3 of 320x180), and "template:<id>", each
                                        template's frame sheet from design/promo-templates/template-<id>-frames.jpg
Needs Pillow (animated WebP frames are partial and must be composited).
"""
import io
import json
import struct
import sys
from pathlib import Path

from PIL import Image, ImageSequence

# Picker order, matching src/utils/promoStyles.js.
STYLES = [
    ("cel-boil", "05-cel-boil"), ("isometric", "03-isometric"), ("flat-vector", "01-flat-vector"),
    ("line-art", "02-line-art"), ("3d-render", "04-3d-render"), ("morph", "08-morph"),
    ("sticker-explainer", "19-paperclip"), ("hud", "22-hud"), ("collage", "06-collage"),
    ("aurora-glass", "12-aurora-glass"), ("bauhaus", "09-bauhaus"), ("synthwave", "10-synthwave"),
    ("pixel", "20-pixel"), ("liquid", "07-liquid"), ("variety-captions", "18-hanazi"),
]
# Where each tile's still comes from, as a share of the film; most read best at the hero moment (~70%).
HERO = {"morph": 0.97, "liquid": 0.9}
TILE = (320, 180)
COLS = 5


def frames(path):
    """Every frame of an animated WebP, fully composited, as RGB."""
    canvas = None
    out = []
    with Image.open(path) as image:
        for frame in ImageSequence.Iterator(image):
            rgba = frame.convert("RGBA")
            canvas = rgba if canvas is None else Image.alpha_composite(canvas, rgba)
            out.append(canvas.convert("RGB"))
    return out


def main(root):
    films = Path(root) / "docs/readme/films"
    out = Path("public/assets/promo")
    keep = Path("design/promo-styles")
    keep.mkdir(parents=True, exist_ok=True)
    rows = -(-len(STYLES) // COLS)
    sprite = Image.new("RGB", (TILE[0] * COLS, TILE[1] * rows))
    header, blobs, at = {}, [], 0

    def add(key, data):
        nonlocal at
        header[key] = [at, len(data)]
        blobs.append(data)
        at += len(data)

    for index, (style_id, slug) in enumerate(STYLES):
        seq = frames(films / f"{slug}.webp")
        # The picker shows the film's hero moment (about 70% in); the sheet spreads 12 frames across it.
        hero = seq[min(len(seq) - 1, int(len(seq) * HERO.get(style_id, 0.7)))].resize(TILE, Image.LANCZOS)
        sprite.paste(hero, ((index % COLS) * TILE[0], (index // COLS) * TILE[1]))
        hero.save(keep / f"{style_id}.jpg", quality=88)
        sheet = Image.new("RGB", (TILE[0] * 4, TILE[1] * 3))
        for k in range(12):
            pick = seq[min(len(seq) - 1, round((k + 0.5) * len(seq) / 12))].resize(TILE, Image.LANCZOS)
            sheet.paste(pick, ((k % 4) * TILE[0], (k // 4) * TILE[1]))
        buffer = io.BytesIO()
        sheet.save(buffer, "JPEG", quality=80)
        add(f"style:{style_id}", buffer.getvalue())
    for sheet_file in sorted(Path("design/promo-templates").glob("template-*-frames.jpg")):
        add(f"template:{sheet_file.name[len('template-'):-len('-frames.jpg')]}", sheet_file.read_bytes())
    sprite.save(out / "styles.webp", "WEBP", quality=82, method=6)
    meta = json.dumps(header).encode()
    (out / "promo-frames.bin").write_bytes(struct.pack(">I", len(meta)) + meta + b"".join(blobs))
    print(f"styles.webp {(out / 'styles.webp').stat().st_size // 1024} KB, promo-frames.bin {(out / 'promo-frames.bin').stat().st_size // 1024} KB, {len(header)} sheets")


if __name__ == "__main__":
    main(sys.argv[1])
