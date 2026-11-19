// util.js — tiny shared helpers.

/** Escapes text so it can be dropped safely into innerHTML. */
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** "just now", "5m ago", "3h ago", "2d ago" … */
export function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Only lets through in-app pages or http(s) links — never javascript: URLs. */
export function safeUrl(url) {
  if (!url) return null;
  const u = String(url).trim();
  if (/^[a-z0-9][a-z0-9\-_/]*\.html(\?[^\s#]*)?(#\S*)?$/i.test(u)) return u;
  if (/^https?:\/\/\S+$/i.test(u)) return u;
  return null;
}
