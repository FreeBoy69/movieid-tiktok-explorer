export function optionalAutomationCatchUpDate(value) {
  if (value === undefined || value === null || value === false || value === 0 || String(value).trim() === "")
    return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// ---------- Scheduled compilations ----------
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** An agent's compilation schedule: which weekdays, what local time, and the last slot that ran. Off by default. */
export function normalizeCompilationSchedule(raw = {}) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const days = (Array.isArray(r.days) ? r.days : [r.days]).map((d) => String(d || "").trim().toLowerCase().slice(0, 3)).filter((d) => WEEKDAYS.includes(d));
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(r.time || "")) ? String(r.time) : "18:00";
  return { enabled: r.enabled === true, days: days.length ? [...new Set(days)].sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b)) : ["sun"], time, lastSlot: String(r.lastSlot || "").slice(0, 40) };
}

/** The local date, weekday, and HH:MM of `now` in `timeZone`. */
function localClock(now, timeZone) {
  let parts;
  try {
    parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now).map((p) => [p.type, p.value]));
  } catch {
    return localClock(now, "UTC");
  }
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday: String(parts.weekday).toLowerCase().slice(0, 3), minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

/** The compilation slot due now ("2026-10-11@18:00"), or "" when none is: a scheduled weekday, past its time
 *  by under `graceMinutes` (a slot missed by hours waits for the next one), and not already run. */
export function dueCompilationSlot(schedule, { now = new Date(), timeZone = "UTC", graceMinutes = 360 } = {}) {
  const s = normalizeCompilationSchedule(schedule);
  if (!s.enabled) return "";
  const clock = localClock(now, timeZone);
  if (!s.days.includes(clock.weekday)) return "";
  const [h, m] = s.time.split(":").map(Number);
  const late = clock.minutes - (h * 60 + m);
  if (late < 0 || late > graceMinutes) return "";
  const slot = `${clock.date}@${s.time}`;
  return slot === s.lastSlot ? "" : slot;
}
