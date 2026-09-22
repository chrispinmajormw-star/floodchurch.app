// theme.js — dark/light theme and accent color, persisted per-device in
// localStorage and applied as CSS custom properties. No backend needed.
const THEME_KEY = "flood-theme";
const ACCENT_KEY = "flood-accent";

export const ACCENT_OPTIONS = [
  { name: "Blue", value: "#3b82f6" },
  { name: "Gold", value: "#e8b54a" },
  { name: "Teal", value: "#17b0c9" },
  { name: "Purple", value: "#8b5cf6" },
  { name: "Red", value: "#e5484d" },
];

export function getTheme() {
  return localStorage.getItem(THEME_KEY) || "dark";
}

export function getAccent() {
  return localStorage.getItem(ACCENT_KEY) || ACCENT_OPTIONS[0].value;
}

const BG_COLORS = { dark: "#0a0a0c", light: "#f5f6f8" };

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = (n >> 16) & 255,
    g = (n >> 8) & 255,
    b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Applies the given (or stored) theme + accent to the page right now. */
export function applyTheme(theme = getTheme(), accent = getAccent()) {
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.setProperty("--blue", accent);
  document.documentElement.style.setProperty(
    "--blue-dim",
    hexToRgba(accent, theme === "light" ? 0.12 : 0.2)
  );

  // Browser chrome (address bar / task-switcher card) follows the page
  // background, not the accent — same as the in-app top/bottom bars do.
  const bg = BG_COLORS[theme] || BG_COLORS.dark;
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute("content", bg);
}

export function setTheme(theme) {
  localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme, getAccent());
}

export function setAccent(accent) {
  localStorage.setItem(ACCENT_KEY, accent);
  applyTheme(getTheme(), accent);
}
