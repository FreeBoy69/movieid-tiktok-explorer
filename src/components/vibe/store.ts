// Editor state for Vibe Edit: the project with an undo history, selection,
// playhead, and transport. A tiny external store (no dependency) read through
// useSyncExternalStore so the timeline, preview, and panels stay in step.
import { useSyncExternalStore } from "react";
import { emptyProject, projectDuration, type VibeProject } from "../../utils/vibeEdit";

export type SaveState = "saved" | "dirty" | "saving" | "error";

export interface VibeState {
  project: VibeProject;
  past: VibeProject[];
  future: VibeProject[];
  selection: string[];
  playhead: number;
  playing: boolean;
  pxPerSec: number;
  save: SaveState;
  /** Long-running work shown in the status strip, keyed by task id. */
  tasks: Record<string, string>;
  /** Magnetic main track: deletes and trims on the base track close up behind them. */
  magnetic: boolean;
}

const MAGNETIC_KEY = "vibe-edit-magnetic";
function readMagnetic() {
  try {
    return window.localStorage.getItem(MAGNETIC_KEY) !== "0";
  } catch {
    return true;
  }
}

const HISTORY = 100;
let state: VibeState = {
  project: emptyProject(),
  past: [],
  future: [],
  selection: [],
  playhead: 0,
  playing: false,
  pxPerSec: 48,
  save: "saved",
  tasks: {},
  magnetic: typeof window === "undefined" ? true : readMagnetic(),
};
const listeners = new Set<() => void>();
let lastKey = "";
let lastAt = 0;

function emit() {
  listeners.forEach((l) => l());
}

export const vibe = {
  get: () => state,
  set(patch: Partial<VibeState>) {
    state = { ...state, ...patch };
    emit();
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
  /** Load a project fresh: no history, playhead home. */
  load(project: VibeProject) {
    state = { ...state, project, past: [], future: [], selection: [], playhead: 0, playing: false, save: "saved" };
    lastKey = "";
    emit();
  },
  /**
   * Apply an edit. Edits sharing a `coalesce` key within a moment (a drag, a
   * slider) fold into one undo step.
   */
  commit(next: VibeProject | ((p: VibeProject) => VibeProject), coalesce = "") {
    const project = typeof next === "function" ? next(state.project) : next;
    if (project === state.project) return;
    const now = Date.now();
    const fold = coalesce && coalesce === lastKey && now - lastAt < 800;
    lastKey = coalesce;
    lastAt = now;
    const past = fold ? state.past : [...state.past.slice(-(HISTORY - 1)), state.project];
    const ids = new Set([...project.clips, ...project.audio, ...project.texts, ...project.captions.cues].map((i) => i.id));
    state = { ...state, project, past, future: [], save: "dirty", selection: state.selection.filter((id) => ids.has(id)) };
    emit();
  },
  undo() {
    const prev = state.past.at(-1);
    if (!prev) return;
    lastKey = "";
    state = { ...state, project: prev, past: state.past.slice(0, -1), future: [state.project, ...state.future], save: "dirty" };
    emit();
  },
  redo() {
    const next = state.future[0];
    if (!next) return;
    lastKey = "";
    state = { ...state, project: next, past: [...state.past, state.project], future: state.future.slice(1), save: "dirty" };
    emit();
  },
  select(ids: string[]) {
    state = { ...state, selection: ids };
    emit();
  },
  seek(time: number) {
    const max = Math.max(projectDuration(state.project), 0);
    state = { ...state, playhead: Math.min(Math.max(0, time), max || 0) };
    emit();
  },
  play(on = !state.playing) {
    if (on && state.playhead >= projectDuration(state.project) - 0.05) state = { ...state, playhead: 0 };
    state = { ...state, playing: on && projectDuration(state.project) > 0 };
    emit();
  },
  setMagnetic(on: boolean) {
    try {
      window.localStorage.setItem(MAGNETIC_KEY, on ? "1" : "0");
    } catch {
      // Preference only.
    }
    state = { ...state, magnetic: on };
    emit();
  },
  task(id: string, label: string | null) {
    const tasks = { ...state.tasks };
    if (label) tasks[id] = label;
    else delete tasks[id];
    state = { ...state, tasks };
    emit();
  },
};

export function useVibe<T>(select: (s: VibeState) => T): T {
  return useSyncExternalStore(vibe.subscribe, () => select(state), () => select(state));
}

/** Run a labeled task: shows in the status strip while it runs. */
export async function withTask<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const id = Math.random().toString(36).slice(2);
  vibe.task(id, label);
  try {
    return await fn();
  } finally {
    vibe.task(id, null);
  }
}
