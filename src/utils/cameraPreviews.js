// Cinema Studio camera previews ship as one sprite per group (public/assets/cinema/camera-<group>.webp),
// tiles in catalogue order, CAMERA_SPRITE_COLUMNS across. One file per group instead of ~80 keeps the
// hosted-app bundle under its 500-file limit. scripts/generate-camera-previews.mjs builds the sprites.
import { cameraOptions } from "./cameraShots.js";

export const CAMERA_SPRITE_COLUMNS = 6;
export const CAMERA_TILE = { width: 400, height: 225 };

/** Where an option's tile sits in its group's sprite, or null for an unknown id. */
export function cameraSprite(group, id) {
  const options = cameraOptions(group);
  const index = options.findIndex((option) => option.id === id);
  if (index < 0) return null;
  const columns = Math.min(CAMERA_SPRITE_COLUMNS, options.length);
  const rows = Math.ceil(options.length / columns);
  return { url: `/assets/cinema/camera-${group}.webp`, columns, rows, column: index % columns, row: Math.floor(index / columns) };
}
