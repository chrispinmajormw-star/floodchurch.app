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

const BG_COLORS = { dark: "#0b0c10", light: "#f3f4f8" };

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = (n >> 16) & 255,
    g = (n >> 8) & 255,
    b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ---- readable accent colours ------------------------------------------------------------------------------------------
// Whatever accent a person picks, text and buttons must stay legible (WCAG AA: contrast of at least 4.5 : 1). A pale
// accent such as Gold needs dark text on its buttons; a mid one such as Blue needs a slightly deeper button; and an
// accent used as TEXT needs to be lighter on the dark theme and deeper on the light one.
const parse = (hex) => {
  const n = parseInt(String(hex).replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (rgb) => "#" + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
const channel = (v) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex) => {
  const [r, g, b] = parse(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
export function contrastRatio(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
const mix = (a, b, t) => toHex(parse(a).map((v, i) => v + (parse(b)[i] - v) * t));
/** Moves `colour` towards `towards` in small steps until it has `need` contrast against `against` (or gives up). */
function nudge(colour, towards, against, need = 4.5) {
  let c = colour;
  for (let i = 0; i < 30 && contrastRatio(c, against) < need; i++) c = mix(c, towards, 0.04);
  return c;
}
// accent text sits on pages AND on cards (a little lighter in the dark theme), so it is judged against the lighter of the two
const PAGE = { dark: "#1d2028", light: "#f3f4f8" };
const LABEL = { light: "#ffffff", dark: "#12141b" };

/**
 * For a chosen accent: `text` (the accent as readable text on the page), `fill` (a button/badge fill), `on` (the label
 * colour to put on that fill) and `fill2` (a second stop for gradients). `label` says whether `on` is "light" or "dark".
 */
export function accentTokens(accent, theme = "dark") {
  const page = PAGE[theme] || PAGE.dark;
  const text = nudge(accent, theme === "light" ? "#000000" : "#ffffff", page);
  // white labels are preferred (the usual look); only when the accent would have to be darkened a lot do we switch to dark labels
  const deeper = nudge(accent, "#000000", LABEL.light);
  const whiteWorks = contrastRatio(deeper, LABEL.light) >= 4.5 && contrastRatio(accent, deeper) < 1.9;
  const label = whiteWorks ? "light" : "dark";
  const fill = whiteWorks ? deeper : nudge(accent, "#ffffff", LABEL.dark);
  const on = LABEL[label];
  const fill2 = nudge(mix(fill, "#7c5cf0", 0.5), label === "light" ? "#000000" : "#ffffff", on);
  return { text, fill, fill2, on, label };
}

/** Applies the given (or stored) theme + accent to the page right now. */
export function applyTheme(theme = getTheme(), accent = getAccent()) {
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.setProperty("--blue", accent);
  const t = accentTokens(accent, theme);
  document.documentElement.style.setProperty("--accent-text", t.text);
  document.documentElement.style.setProperty("--accent-fill", t.fill);
  document.documentElement.style.setProperty("--accent-fill-2", t.fill2);
  document.documentElement.style.setProperty("--on-accent", t.on);
  document.documentElement.setAttribute("data-on-accent", t.label);
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
