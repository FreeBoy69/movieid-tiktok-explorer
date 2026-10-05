// Every voice gets a person's name: a first and a last name, like "Nora Whitfield".
// Shared by the server (clones it creates on its own) and the clone sheet (a
// suggested name the user can keep, shuffle, or replace).

const FIRST = [
  "Ava", "Nora", "Maya", "Iris", "Clara", "Elena", "Lena", "Sofia", "Hazel", "Ruby",
  "Naomi", "Leah", "Freya", "June", "Celia", "Amara", "Tessa", "Vera", "Mila", "Esme",
  "Julia", "Rosa", "Daphne", "Lydia", "Selena", "Imani", "Priya", "Keiko", "Zara", "Alma",
  "Owen", "Miles", "Felix", "Julian", "Theo", "Elliot", "Rowan", "Silas", "Adrian", "Marcus",
  "Caleb", "Jonah", "Gabriel", "Isaac", "Hugo", "Arthur", "Declan", "Simon", "Victor", "Malik",
  "Mateo", "Rafael", "Kenji", "Omar", "Dorian", "Wesley", "Graham", "Reid", "Callum", "Ezra",
];
const LAST = [
  "Whitfield", "Hale", "Mercer", "Ellison", "Calloway", "Ashford", "Bennett", "Carver", "Delaney", "Everett",
  "Fairchild", "Garrison", "Hartley", "Ingram", "Jameson", "Kingsley", "Langford", "Maddox", "Northcott", "Oakley",
  "Pembroke", "Quinlan", "Radcliffe", "Sterling", "Thornton", "Underwood", "Vance", "Whitaker", "Yardley", "Abbott",
  "Blackwood", "Castillo", "Donovan", "Fletcher", "Grayson", "Holloway", "Lockhart", "Monroe", "Navarro", "Prescott",
  "Reyes", "Sinclair", "Tanaka", "Vaughn", "Winslow", "Adeyemi", "Moreau", "Lindqvist", "Okafor", "Romano",
];

const NAME_PART = "[A-Z][a-zA-Z'’-]{1,20}";
const HUMAN_NAME = new RegExp(`^${NAME_PART} ${NAME_PART}$`);

/** True for a first-and-last name such as "Lily Hart". */
export function isHumanVoiceName(name) {
  return HUMAN_NAME.test(String(name || "").trim());
}

function pick(list, random) {
  return list[Math.floor(random() * list.length) % list.length];
}

/** A fresh first-and-last name that is not already in `taken` (case-insensitive). */
export function generateVoiceName(taken = [], random = Math.random) {
  const used = new Set([...taken].map((name) => String(name || "").trim().toLowerCase()));
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const name = `${pick(FIRST, random)} ${pick(LAST, random)}`;
    if (!used.has(name.toLowerCase())) return name;
  }
  return `${pick(FIRST, random)} ${pick(LAST, random)}`;
}

/** Keeps a requested name when it is already a person's name; otherwise generates one. */
export function humanVoiceName(requested, taken = [], random = Math.random) {
  const clean = String(requested || "").trim().replace(/\s+/g, " ");
  return isHumanVoiceName(clean) ? clean : generateVoiceName(taken, random);
}
