// schedule.js — the weekly service times (from the live_schedule table): which one is next,
// how to show times, and the week as a list. Times are the church's local time; they are read
// on the member's phone, so a phone set to Malawi time sees Malawi times.

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "09:00" or "09:00:00" → "9:00 am" ("" if it isn't a time). */
export function formatTime(t) {
  const m = String(t || "").match(/^(\d{1,2}):(\d{2})/);
  if (!m) return "";
  const h24 = Number(m[1]);
  return `${h24 % 12 || 12}:${m[2]} ${h24 >= 12 ? "pm" : "am"}`;
}

/** The soonest upcoming service: { entry, date } — or null when there are no valid entries. */
export function nextOccurrence(entries, now = new Date()) {
  let best = null;
  for (const entry of entries || []) {
    const m = String(entry.start_time || "").match(/^(\d{1,2}):(\d{2})/);
    if (!m || entry.day < 0 || entry.day > 6) continue;
    const date = new Date(now);
    date.setHours(Number(m[1]), Number(m[2]), 0, 0);
    date.setDate(date.getDate() + ((entry.day - now.getDay() + 7) % 7));
    if (date <= now) date.setDate(date.getDate() + 7); // already started today → next week
    if (!best || date < best.date) best = { entry, date };
  }
  return best;
}

/** "Today 9:00 am", "Tomorrow 9:00 am", or "Wednesday 5:30 pm". */
export function describeOccurrence(occ, now = new Date()) {
  if (!occ) return "";
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(occ.date) - startOfDay(now)) / 86400000);
  const when = days === 0 ? "Today" : days === 1 ? "Tomorrow" : DAY_NAMES[occ.entry.day];
  return `${when} ${formatTime(occ.entry.start_time)}`;
}

/** "2d 4h 20m 5s" (never negative). */
export function countdownText(ms) {
  const t = Math.max(0, ms);
  const d = Math.floor(t / 86400000);
  const h = Math.floor((t % 86400000) / 3600000);
  const m = Math.floor((t % 3600000) / 60000);
  const s = Math.floor((t % 60000) / 1000);
  return `${d}d ${h}h ${m}m ${s}s`;
}

/** The week in order, Sunday first, earliest first within a day. */
export function sortedWeek(entries) {
  return [...(entries || [])].sort((a, b) => a.day - b.day || String(a.start_time).localeCompare(String(b.start_time)));
}
