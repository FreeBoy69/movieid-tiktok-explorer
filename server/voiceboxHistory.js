export function reusableVoiceGeneration(items, { profileId, text, language, instruct, engine, modelSize }) {
  if (!Array.isArray(items)) return null;
  return items.find((item) => item?.status === "completed" && item.audio_path
    && item.profile_id === profileId && item.text === text && item.language === language
    && String(item.instruct || "") === String(instruct || "") && item.engine === engine
    && String(item.model_size || "") === String(modelSize || "")) || null;
}

/** A matching line Voicebox is still recording (started in the last 20 minutes), so a restarted app waits
 *  for it instead of asking for the same line again. */
export function inFlightVoiceGeneration(items, wanted, now = Date.now()) {
  if (!Array.isArray(items)) return null;
  return items.find((item) => ["generating", "pending", "queued"].includes(item?.status)
    && item.profile_id === wanted.profileId && item.text === wanted.text && item.language === wanted.language
    && String(item.instruct || "") === String(wanted.instruct || "") && item.engine === wanted.engine
    && String(item.model_size || "") === String(wanted.modelSize || "")
    && now - Date.parse(`${String(item.created_at || "").replace(/Z?$/, "Z")}`) < 20 * 60 * 1000) || null;
}
