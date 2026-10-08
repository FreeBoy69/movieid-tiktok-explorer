// The self-hosted speech engines (Voicebox), one list for every engine picker.
import type { FieldOption } from "../components/LanguagePicker";

export const VOICE_ENGINES: FieldOption[] = [
  { value: "kokoro", label: "Kokoro" },
  { value: "qwen", label: "Qwen3-TTS 1.7B" },
  { value: "qwen-0.6b", label: "Qwen3-TTS 0.6B" },
  { value: "qwen_custom_voice", label: "Qwen Custom Voice" },
  { value: "chatterbox_turbo", label: "Chatterbox Turbo" },
  { value: "chatterbox", label: "Chatterbox Multilingual" },
  { value: "luxtts", label: "LuxTTS" },
  { value: "tada", label: "TADA" },
];

export const engineOptions = (only?: string[]) => (only ? VOICE_ENGINES.filter((engine) => only.includes(engine.value)) : VOICE_ENGINES);
