// How many scenes a video prompt lays out: timed segments ("00:03–00:06",
// "0-4 seconds", "2–8s"), numbered shots ("Shot 3", "Scene 2"), a declared
// count ("7 hard-cut shots"), or a bulleted "Sequence:" list. One continuous
// description counts as a single scene.
const TIMECODE = /(\d{1,2}:\d{2}(?:\.\d+)?)\s*(?:–|—|-|to)\s*(\d{1,2}:\d{2}(?:\.\d+)?)/g;
const SECONDS = /\b(\d{1,3}(?:\.\d+)?)\s*(?:s|sec|secs|seconds)?\s*(?:–|—|-|to)\s*(\d{1,3}(?:\.\d+)?)\s*(?:s|sec|secs|seconds)\b/gi;
const NUMBERED = /\b(?:shot|scene|cut|clip|segment|beat)\s*#?\s*(\d{1,2})(?:\s*(?:–|—|-)\s*(\d{1,2}))?\b/gi;
const WORD_NUMBERS = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };
const DECLARED = /\b(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten|twelve)[\s-]+(?:(?:hard[\s-]?cut|quick|distinct|different|separate)\s+)?(?:shots|scenes|cuts|beats|segments)\b|\b(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten|twelve)-shot\b/gi;
const SEQUENCE = /(?:^|\n)\s*(?:sequence|shots|scenes|shot list|storyboard|timeline)\s*:?\s*\n((?:\s*[-•*]\s+.+\n?){2,})/i;

export function countScenes(text) {
  const value = String(text || "");
  const distinct = (pattern, key) => new Set([...value.matchAll(pattern)].map(key)).size;
  // "Shot 4–5" names two shots.
  const numbered = new Set();
  for (const m of value.matchAll(NUMBERED)) {
    const from = Number(m[1]);
    const to = m[2] && Number(m[2]) > from && Number(m[2]) - from < 10 ? Number(m[2]) : from;
    for (let n = from; n <= to; n++) numbered.add(n);
  }
  const declared = Math.max(
    0,
    ...[...value.matchAll(DECLARED)].map((m) => {
      const word = String(m[1] || m[2]).toLowerCase();
      return Number(word) || WORD_NUMBERS[word] || 0;
    }),
  );
  const sequence = (value.match(SEQUENCE)?.[1].match(/^\s*[-•*]\s+/gm) || []).length;
  const scenes = Math.max(
    distinct(TIMECODE, (m) => `${m[1]}-${m[2]}`),
    distinct(SECONDS, (m) => `${Number(m[1])}-${Number(m[2])}`),
    numbered.size,
    declared,
    sequence,
  );
  return scenes >= 2 ? Math.min(scenes, 30) : 1;
}
export const isMultiScene = (text) => countScenes(text) >= 2;
