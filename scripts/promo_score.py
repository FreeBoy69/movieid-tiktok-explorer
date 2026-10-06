#!/usr/bin/env python3
"""Promo Studio scores in a style's own genre, with mgaudio (lib/audio of github.com/Vincentwei1021/mg-styles-15,
MIT; its instrument samples are the CC0 Versilian Community Sample Library).

  python3 promo_score.py --options '{"style":"10-synthwave","duration":30,"bpm":100,"drop":4.8,
                                     "breakdown":19.2,"drop2":21.6,"final":26.4}' --out music.wav

The film is written against the same moments (server/promoMusic.js musicStructure): the music's bar 0 is the
drop, the energy dips for the breakdown and comes back on the second drop, and a hit lands on each drop and on
the end card. Output: 48 kHz stereo WAV mastered to -14 LUFS, true peak -1 dBTP. Prints one JSON line.

mgaudio needs numpy, numba, scipy, pedalboard, soundfile and pyloudnorm, which live in their own venv on the
media worker (MGAUDIO_PYTHON, default /opt/autoyt/mgaudio-venv/bin/python) with the toolkit and samples in
MGAUDIO_DIR (default /opt/autoyt/mgaudio/audio). Run with any python3, it re-runs itself in that venv.
"""
import argparse
import json
import os
import sys

VENV_PYTHON = os.environ.get("MGAUDIO_PYTHON", "/opt/autoyt/mgaudio-venv/bin/python")
MGAUDIO_DIR = os.environ.get("MGAUDIO_DIR", "/opt/autoyt/mgaudio/audio")


def emit(value):
    print(json.dumps(value), flush=True)


try:
    import numpy  # noqa: F401
except ImportError:
    # A venv's python is a symlink to the system one, so compare the environment, not the binary.
    venv = os.path.dirname(os.path.dirname(VENV_PYTHON))
    if os.path.realpath(sys.prefix) != os.path.realpath(venv) and os.path.exists(VENV_PYTHON):
        os.execv(VENV_PYTHON, [VENV_PYTHON, *sys.argv])
    emit({"error": "The music toolkit isn't installed on this worker."})
    sys.exit(0)

sys.path.insert(0, MGAUDIO_DIR)
import mgaudio as mg  # noqa: E402,F401
from mgaudio import recipes, sfx  # noqa: E402

# The sound design each style lands its big moments with (from mg-styles-15's SFX palettes).
HITS = {
    "01-flat-vector": lambda: sfx.transition(0.6, "swish_pop"),
    "02-line-art": lambda: sfx.chime(),
    "03-isometric": lambda: sfx.pop(),
    "04-3d-render": lambda: sfx.impact("soft"),
    "05-cel-boil": lambda: sfx.pop("cork"),
    "06-collage": lambda: sfx.sticker_slap(),
    "07-liquid": lambda: sfx.splash(),
    "08-morph": lambda: sfx.morph(0.5),
    "09-bauhaus": lambda: sfx.impact("punch"),
    "10-synthwave": lambda: sfx.impact("cinematic"),
    "12-aurora-glass": lambda: sfx.shimmer_hit(),
    "18-hanazi": lambda: sfx.duang(),
    "19-paperclip": lambda: sfx.pop(),
    "20-pixel": lambda: sfx.powerup(),
    "22-hud": lambda: sfx.lock_on(0.8),
}
# Styles whose music should never build with a riser (calm by design).
CALM = {"02-line-art", "12-aurora-glass"}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--options", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    o = json.loads(args.options)
    style = str(o.get("style", ""))
    if style not in recipes.STYLES:
        return emit({"error": f"unknown style {style}"})
    duration = float(o["duration"])
    drop = float(o["drop"])
    final = float(o["final"])
    breakdown, drop2 = o.get("breakdown"), o.get("drop2")
    bpm = float(o["bpm"])
    bar = 240.0 / bpm
    name, defaults, _, _ = recipes.STYLES[style]
    kwargs = {**defaults, "duration": duration, "bpm": bpm, "drop": drop, "outro": final}
    if breakdown is not None and drop2 is not None:
        build = max(0.0, drop - bar)
        kwargs["energy"] = [
            (0.0, 0.3), (build, 0.42), (drop - 0.02, 0.9), (drop, 1.0),
            (float(breakdown) - 0.02, 1.0), (float(breakdown), 0.35),
            (float(drop2) - 0.02, 0.85), (float(drop2), 1.0), (final, 1.0), (duration, 0.6),
        ]
    m = recipes.RECIPES[name](**kwargs)
    hit = HITS.get(style, lambda: sfx.impact("cinematic"))
    moments = [drop] + ([float(drop2)] if drop2 is not None else []) + [final]
    for at in moments:
        if at < duration - 0.2:
            m.sfx(hit(), at=at, gain=2 if at == final else 0)
    if style not in CALM and drop2 is not None:
        m.sfx(sfx.riser(min(2.0, float(drop2) - float(breakdown)), kind="hybrid"), at=float(drop2), gain=-3)
    result = m.export(args.out)
    emit({"ok": True, "file": args.out, "lufs": result.get("lufs"), "truePeak": result.get("true_peak"), "bpm": round(m.form.bpm, 2)})


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # noqa: BLE001 - the app falls back to its own score
        emit({"error": str(error)[:400]})
