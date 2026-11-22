// growth-util.js — small, pure helpers for the Growth Groups screens (kept apart so they are easy to test).

/** The same name always gets the same colour. */
export function hueOf(name) {
  let h = 0;
  for (const ch of String(name || "")) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}

/** The first letter of a name, for the round picture. */
export function initialOf(name) {
  const first = Array.from(String(name || "").trim())[0];
  return first ? first.toUpperCase() : "?";
}

/** "14:05" or "2:05 PM", as this phone shows times. */
export function clockTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "Today", "Yesterday", a weekday for the last week, then a date. */
export function dayLabel(iso, now = new Date()) {
  const d = new Date(iso);
  if (sameDay(d, now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return "Yesterday";
  const days = Math.floor((now - d) / 86400000);
  if (days >= 0 && days < 7) return d.toLocaleDateString([], { weekday: "long" });
  return d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}

/** The short time shown on a chat-list row: the time today, "Yesterday", a weekday, or a date. */
export function listTime(iso, now = new Date()) {
  if (!iso) return "";
  const d = new Date(iso);
  return sameDay(d, now) ? clockTime(iso) : dayLabel(iso, now);
}

/** One line for the chat list: "Luke: Meeting at 6pm", "Announcement: …", or an invitation to say hello. */
export function previewText(group) {
  if (!group.last_body) return "No messages yet. Say hello!";
  const text = String(group.last_body).replace(/\s+/g, " ").trim();
  if (group.last_kind === "announcement") return `Announcement: ${text}`;
  return group.last_author ? `${group.last_author}: ${text}` : text;
}

/** How many messages from the same person within this many minutes are shown as one run. */
export const RUN_MINUTES = 5;

/**
 * Prepares messages (oldest first) for drawing: a day heading before each new day, and whether each message begins a
 * new "run" from the same person (so their name is only shown once). Announcements always stand on their own.
 */
export function layoutMessages(messages, now = new Date()) {
  const out = [];
  let lastDay = "";
  let prev = null;
  for (const m of messages) {
    const day = new Date(m.created_at).toDateString();
    if (day !== lastDay) {
      out.push({ type: "day", label: dayLabel(m.created_at, now), key: "day-" + day });
      lastDay = day;
      prev = null;
    }
    const closeToPrev = prev && prev.user_id === m.user_id && prev.kind === "chat" && m.kind === "chat" && new Date(m.created_at) - new Date(prev.created_at) < RUN_MINUTES * 60000;
    out.push({ type: "message", message: m, startsRun: !closeToPrev });
    prev = m;
  }
  return out;
}

/** The address of a group's chat. */
export const groupUrl = (id) => `growth-group.html?id=${encodeURIComponent(id)}`;
