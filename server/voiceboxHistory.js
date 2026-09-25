export function reusableVoiceGeneration(items, { profileId, text, language, instruct, engine, modelSize }) {
  if (!Array.isArray(items)) return null;
  return items.find((item) => item?.status === "completed" && item.audio_path
    && item.profile_id === profileId && item.text === text && item.language === language
    && String(item.instruct || "") === String(instruct || "") && item.engine === engine
    && String(item.model_size || "") === String(modelSize || "")) || null;
}
