// Cinema Studio look presets, modelled on Higgsfield Cinema Studio 3.5: genre,
// colour palette, lighting, camera move set, and speed ramp. Each carries the
// prompt language it adds. Shared by the page and the server.

export const CINEMA_GENRES = [
  { id: "general", name: "General", text: "" },
  { id: "action", name: "Action", text: "high-energy action film look, kinetic framing, visceral tension" },
  { id: "epic", name: "Epic", text: "epic blockbuster scale, sweeping vistas, heroic composition" },
  { id: "drama", name: "Drama", text: "grounded character drama, intimate emotional framing" },
  { id: "comedy", name: "Comedy", text: "bright comedic tone, playful staging, clear readable action" },
  { id: "horror", name: "Horror", text: "horror film atmosphere, dread, deep shadows, unsettling negative space" },
  { id: "noir", name: "Noir", text: "film noir mood, hard shadows, venetian-blind light, moral ambiguity" },
];

export const CINEMA_PALETTES = [
  { id: "auto", name: "Auto", text: "" },
  { id: "naturalistic", name: "Naturalistic Clean", text: "naturalistic clean colour grade, true-to-life tones" },
  { id: "bleached-warm", name: "Bleached Warm", text: "bleached warm grade, sun-faded highlights, creamy midtones" },
  { id: "hyper-neon", name: "Hyper Neon", text: "hyper neon palette, saturated magenta and cyan light" },
  { id: "teal-orange", name: "Teal & Orange Epic", text: "teal and orange blockbuster grade" },
  { id: "sodium-decay", name: "Sodium Decay", text: "sodium-vapour orange streetlight grade with decaying greens" },
  { id: "cold-steel", name: "Cold Steel", text: "cold steel blue grade, desaturated and clinical" },
  { id: "bleach-bypass", name: "Bleach Bypass", text: "bleach bypass look, high contrast, low saturation, silvery" },
  { id: "classic-bw", name: "Classic B&W", text: "classic black and white film, rich greyscale" },
];

export const CINEMA_LIGHTING = [
  { id: "auto", name: "Auto", text: "" },
  { id: "soft-cross", name: "Soft Cross", text: "soft cross lighting from two sides" },
  { id: "overhead-fall", name: "Overhead Fall", text: "hard overhead light falling off into darkness" },
  { id: "contre-jour", name: "Contre-jour", text: "contre-jour backlight with glowing rim light" },
  { id: "window", name: "Window", text: "soft natural window light" },
  { id: "practicals", name: "Practicals", text: "lit by in-frame practical lamps and neon signs" },
  { id: "silhouette", name: "Silhouette", text: "subjects in silhouette against a bright background" },
];

export const CINEMA_MOVESETS = [
  { id: "auto", name: "Auto", text: "" },
  { id: "classic-static", name: "Classic Static", text: "locked-off static camera, composed like a painting" },
  { id: "silent-machine", name: "Silent Machine", text: "slow, precise motion-control camera glide" },
  { id: "one-take", name: "One Take", text: "continuous single-take tracking shot, no cuts" },
  { id: "epic-scale", name: "Epic Scale", text: "sweeping crane and drone moves revealing scale" },
  { id: "intimate-observer", name: "Intimate Observer", text: "close, gentle handheld following the subject" },
  { id: "impossible-camera", name: "Impossible Camera", text: "impossible camera path flying through tight spaces and objects" },
  { id: "documentary-snap", name: "Documentary Snap", text: "documentary handheld with quick reframes and snap zooms" },
  { id: "raw-chaos", name: "Raw Chaos", text: "chaotic shaky camera, whip pans, crash zooms" },
  { id: "dreamy-flow", name: "Dreamy Flow", text: "floating, dreamlike slow drift with soft focus pulls" },
];

export const CINEMA_SPEED_RAMPS = [
  { id: "auto", name: "Auto", text: "" },
  { id: "linear", name: "Linear", text: "real-time speed throughout" },
  { id: "slow-mo", name: "Slow-mo", text: "the whole shot in smooth slow motion" },
  { id: "flash-in", name: "Flash In", text: "starts fast and snaps into normal speed" },
  { id: "flash-out", name: "Flash Out", text: "normal speed that accelerates out at the end" },
  { id: "bullet-time", name: "Bullet Time", text: "bullet-time freeze with the camera orbiting the frozen moment" },
  { id: "impact", name: "Impact", text: "speed ramps down into slow motion at the moment of impact, then snaps back" },
  { id: "ramp-up", name: "Ramp Up", text: "gradually accelerating speed ramp" },
];

const find = (list, id) => list.find((item) => item.id === id) || list[0];
// Adds the chosen look to a scene prompt, skipping "Auto" and "General".
export function cinemaLookText({ genre, palette, lighting, moveset, speed } = {}, video = false) {
  return [find(CINEMA_GENRES, genre).text, find(CINEMA_PALETTES, palette).text, find(CINEMA_LIGHTING, lighting).text, video ? find(CINEMA_MOVESETS, moveset).text : "", video ? find(CINEMA_SPEED_RAMPS, speed).text : ""]
    .filter(Boolean)
    .join(", ");
}
export const cinemaPreview = (kind, id) => `/assets/cinema/${kind}-${id}.webp`;
