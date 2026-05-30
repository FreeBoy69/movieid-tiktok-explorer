import sys
import os
import json

# Redirect all warnings and library logs to stderr so stdout stays clean JSON
import warnings
warnings.filterwarnings("ignore")
os.environ["TRANSFORMERS_VERBOSITY"] = "error"
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"

# Redirect ctranslate2 / faster-whisper internal logs to stderr
import logging
logging.basicConfig(stream=sys.stderr, level=logging.ERROR)


def output(obj):
    """Write JSON to stdout and flush immediately."""
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def transcribe_audio(audio_path):
    # 1. Validate file exists and has non-trivial size
    if not os.path.exists(audio_path):
        output({"success": False, "error": f"Audio file not found: {audio_path}"})
        return

    file_size = os.path.getsize(audio_path)
    if file_size < 1024:  # Less than 1KB means download likely failed
        output({"success": False, "error": f"Downloaded file is too small ({file_size} bytes) — the video platform may have blocked the download or the URL is invalid."})
        return

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        output({"success": False, "error": "faster-whisper module not found. Run: pip install faster-whisper"})
        return

    try:
        model_size = "base"
        model = WhisperModel(model_size, device="cpu", compute_type="int8")

        try:
            segments_generator, info = model.transcribe(
                audio_path,
                beam_size=5,
                vad_filter=True,  # Skip silent portions
            )
        except Exception as vad_error:
            if "tuple index out of range" not in str(vad_error).lower():
                raise
            print("VAD transcription failed; retrying without VAD filter.", file=sys.stderr)
            segments_generator, info = model.transcribe(
                audio_path,
                beam_size=1,
                vad_filter=False,
            )

        # Consume the generator safely
        texts = []
        segments = []
        for segment in segments_generator:
            texts.append(segment.text)
            segments.append({
                "start": float(getattr(segment, "start", 0) or 0),
                "end": float(getattr(segment, "end", 0) or 0),
                "text": segment.text,
            })

        full_text = " ".join(texts).strip()

        if not full_text:
            output({"success": False, "error": "No speech detected in the audio. The video may be silent or music-only."})
        else:
            output({"success": True, "text": full_text, "segments": segments})

    except Exception as e:
        message = str(e)
        if "tuple index out of range" in message.lower():
            message = "The local transcription model could not segment this audio. AutoYT normalized the audio and retried without silence filtering, but transcription still failed."
        output({"success": False, "error": f"Transcription failed: {message}"})


if __name__ == "__main__":
    if len(sys.argv) < 2:
        output({"success": False, "error": "No audio path provided"})
        sys.exit(1)

    transcribe_audio(sys.argv[1])
