// Who owns each cloned voice.
//
// Voicebox keeps one shared library of profiles, and it has no notion of
// users. A voice someone clones (often their own, or their founder's) must be
// usable and visible only to them, so every profile created through the app
// is recorded here against its creator. Profiles made before this existed, or
// by the server itself (drama cast voices), have no owner and stay shared as
// they always were.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { assetStoreConfigured, ensureFile, saveFile } from "./assetStore.js";

const STORE_KEY = "voices/owners.json";
const file = () => path.resolve(process.env.CREATOR_ASSETS_DIR || "data/creator-assets", "voice-owners.json");
export const ownerKey = (userId) => crypto.createHash("sha256").update(`voice-owner:${userId}`).digest("hex").slice(0, 32);

let cache = null;
let chain = Promise.resolve();
async function load() {
  if (cache) return cache;
  const target = file();
  await ensureFile(STORE_KEY, target).catch(() => false);
  try {
    const parsed = JSON.parse(await fs.readFile(target, "utf8"));
    cache = parsed && typeof parsed.owners === "object" && parsed.owners ? parsed.owners : {};
  } catch {
    cache = {};
  }
  return cache;
}
function save() {
  const run = async () => {
    const target = file();
    await fs.mkdir(path.dirname(target), { recursive: true });
    const partial = `${target}.${crypto.randomBytes(4).toString("hex")}`;
    await fs.writeFile(partial, JSON.stringify({ owners: cache }));
    await fs.rename(partial, target);
    if (assetStoreConfigured()) await saveFile(STORE_KEY, target);
  };
  const next = chain.then(run, run);
  chain = next.catch((error) => console.warn(`[voices] could not save voice owners: ${error.message}`));
  return next;
}

export async function claimVoice(profileId, userId) {
  const owners = await load();
  owners[String(profileId)] = ownerKey(userId);
  await save();
}
/** Claims the voices that have no owner yet; voices someone already owns are left alone. */
export async function claimUnownedVoices(profileIds, userId) {
  const owners = await load();
  const free = [...new Set(profileIds.filter(Boolean).map(String))].filter((id) => !owners[id]);
  if (!free.length) return 0;
  for (const id of free) owners[id] = ownerKey(userId);
  await save();
  return free.length;
}
export async function releaseVoice(profileId) {
  const owners = await load();
  if (!(String(profileId) in owners)) return;
  delete owners[String(profileId)];
  await save();
}
/** True when the user may see, use, and change the voice: it is theirs, or it has no owner. */
export async function canUseVoice(profileId, userId) {
  const owner = (await load())[String(profileId)];
  return !owner || owner === ownerKey(userId);
}
export async function visibleVoices(profiles, userId) {
  const owners = await load();
  const mine = ownerKey(userId);
  return profiles
    .filter((profile) => !owners[profile.id] || owners[profile.id] === mine)
    .map((profile) => (owners[profile.id] === mine ? { ...profile, owned: true } : profile));
}
/** For tests. */
export function resetVoiceOwners() {
  cache = null;
  chain = Promise.resolve();
}
