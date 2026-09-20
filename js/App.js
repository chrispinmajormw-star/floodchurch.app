// App.js — shared application core.
// Every page imports this to get the top bar, bottom navigation,
// and a small helper for loading this page's JSON data.
import { ICONS } from "./icons.js";

const NAV_ITEMS = [
  { href: "index.html", label: "Home", icon: "home" },
  { href: "bible.html", label: "Bible", icon: "book" },
  { href: "media.html", label: "Media", icon: "play" },
  { href: "give.html", label: "Give", icon: "heart" },
  { href: "profile.html", label: "Profile", icon: "user" },
];

/** Which .html file we're currently on, e.g. "index.html". */
export function currentPage() {
  const path = window.location.pathname.split("/").pop();
  return path === "" ? "index.html" : path;
}

/** Renders the bottom tab bar into <nav id="bottomnav">. */
export function renderBottomNav() {
  const mount = document.getElementById("bottomnav");
  if (!mount) return;
  const active = currentPage();
  mount.innerHTML = NAV_ITEMS.map((item) => {
    const isActive = item.href === active;
    return `<a class="navitem${isActive ? " active" : ""}" href="${item.href}">
      ${ICONS[item.icon]}
      <span>${item.label}</span>
    </a>`;
  }).join("");
}

/**
 * Renders the top bar into <header id="topbar">.
 * `rightIcon` is a key from ICONS, `rightHref` where it links to.
 * Pass `back: true` to show a back chevron on the left instead of the brand mark.
 */
export function renderTopbar({ rightIcon = "bell", rightHref = "#", back = false, backHref = "profile.html", title = null } = {}) {
  const mount = document.getElementById("topbar");
  if (!mount) return;

  const left = back
    ? `<a class="icon-btn" href="${backHref}" aria-label="Back">${ICONS.back}</a>`
    : `<div class="brand">
         <div class="mark">F</div>
         <div class="word"><b>FLOOD</b><span>CHURCH</span></div>
       </div>`;

  const center = title
    ? `<div class="brand" style="justify-content:center;"><div class="word" style="text-align:center;"><b>${title}</b></div></div>`
    : "";

  const right = rightIcon
    ? `<a class="icon-btn" href="${rightHref}" aria-label="Action">${ICONS[rightIcon]}</a>`
    : `<span style="width:36px;"></span>`;

  mount.innerHTML = `${left}${center}${right}`;
}

/** Fetches and parses a JSON data file relative to the site root. */
export async function loadData(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

/** Boots the shared chrome (topbar + bottom nav). Call once per page. */
export function bootApp(topbarOptions) {
  renderTopbar(topbarOptions);
  renderBottomNav();
}
