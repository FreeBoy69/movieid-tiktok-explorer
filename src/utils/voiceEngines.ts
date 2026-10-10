// The self-hosted speech engine on our media server: KittenTTS (KittenTTS 2 for cloned voices, the
// KittenTTS mini model for preset voices). The voice decides which one speaks, so pickers don't ask.
import type { FieldOption } from "../components/LanguagePicker";

export const VOICE_ENGINES: FieldOption[] = [
  { value: "kitten", label: "KittenTTS 2 (cloned voices)" },
  { value: "kitten-mini", label: "KittenTTS mini (preset voices)" },
];

export const engineOptions = (only?: string[]) => (only ? VOICE_ENGINES.filter((engine) => only.includes(engine.value)) : VOICE_ENGINES);
