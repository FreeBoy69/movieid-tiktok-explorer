// Provider prices for Create Video's paid steps. Billing charges a call at the cost the
// provider reports, so the page quotes credits from these same prices.
import { openRouterRequest } from "../src/utils/openRouterClient.js";

const CACHE_MS = 6 * 3600 * 1000;
let cached = null;

const number = (value) => (value !== undefined && value !== null && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null);

/** USD a second of image-to-video output costs at `resolution`, from OpenRouter's pricing SKUs. */
export function videoUsdPerSecond(skus = {}, resolution = "720p") {
  const cents =
    number(skus[`cents_per_video_output_second_${resolution}`]) ??
    number(skus[`cents_per_second_output_${resolution}`]) ??
    number(skus.cents_per_second_output);
  if (cents !== null) return cents / 100;
  const usd =
    number(skus[`image_to_video_duration_seconds_${resolution}`]) ??
    number(skus[`duration_seconds_without_audio_${resolution}`]) ??
    number(skus[`duration_seconds_${resolution}`]) ??
    number(skus.duration_seconds_without_audio) ??
    number(skus.duration_seconds);
  if (usd !== null) return usd;
  // Token-priced models (Seedance) bill about width × height × fps / 1024 tokens a second.
  const perToken = number(skus.video_tokens_without_audio) ?? number(skus.video_tokens);
  return perToken !== null ? perToken * ((1280 * 720 * 24) / 1024) : null;
}

// "minimax/hailuo-3" -> "Hailuo 3". Provider display names can be cryptic ("H3").
export const modelName = (id) =>
  String(id || "").split("/").pop().split("-").map((word) => (/^[a-z]/.test(word) ? word[0].toUpperCase() + word.slice(1) : word)).join(" ");

/** { imageUsd, video: { [model]: { name, usdPerSecond, durations } } }, cached for six hours. */
export async function makerPrices({ imageModel, videoModels = [] }, request = openRouterRequest) {
  if (cached && Date.now() - cached.at < CACHE_MS && cached.key === `${imageModel}|${videoModels.join(",")}`) return cached.value;
  const [videos, image] = await Promise.all([
    request("/videos/models", { timeoutMs: 20000 }).catch(() => null),
    imageModel ? request(`/images/models/${imageModel}/endpoints`, { timeoutMs: 20000 }).catch(() => null) : null,
  ]);
  const video = {};
  for (const model of Array.isArray(videos?.data) ? videos.data : []) {
    if (!videoModels.includes(model.id)) continue;
    video[model.id] = {
      name: modelName(model.id),
      usdPerSecond: videoUsdPerSecond(model.pricing_skus || {}),
      durations: (model.supported_durations || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b),
    };
  }
  const imageUsd = number((image?.endpoints?.[0]?.pricing || []).find((price) => price.billable === "output_image")?.cost_usd);
  const value = { imageUsd, video };
  if (videos || image) cached = { at: Date.now(), key: `${imageModel}|${videoModels.join(",")}`, value };
  return value;
}
