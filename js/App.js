// App.js — shared application core.
// Every page imports this to get the top bar, bottom navigation,
// and a small helper for loading this page's JSON data.
import { ICONS } from "./icons.js";
import { applyTheme } from "./theme.js";
import { supabase } from "./supabaseClient.js";
import { getUnreadCount } from "./notifications.js";

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

/** Puts the unread count on the bell (a red number), or removes it when there are none. */
async function refreshBellBadge() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const count = await getUnreadCount(session.user.id);
    const bell = document.querySelector("#topbar [data-bell]");
    if (!bell) return;
    let badge = bell.querySelector(".bell-badge");
    if (count > 0) {
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "bell-badge";
        bell.appendChild(badge);
      }
      badge.textContent = count > 9 ? "9+" : String(count);
    } else if (badge) {
      badge.remove();
    }
  } catch (e) {
    /* the bell still works without a badge */
  }
}

/**
 * Renders the top bar into <header id="topbar">.
 * `rightIcon` is a key from ICONS, `rightHref` where it links to.
 * The "bell" icon always opens the notifications page and shows an unread badge.
 * Pass `back: true` to show a back chevron on the left instead of the brand mark.
 */
export function renderTopbar({ rightIcon = "bell", rightHref = "#", back = false, backHref = "profile.html", title = null } = {}) {
  const mount = document.getElementById("topbar");
  if (!mount) return;

  const left = back
    ? `<a class="icon-btn" href="${backHref}" aria-label="Back">${ICONS.back}</a>`
    : `<div class="brand">
         <div class="mark"><img src="assets/floodwhite.svg" alt="Flood Church logo" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'F'}))"></div>
         <div class="word"><b>FLOOD</b><span>CHURCH</span></div>
       </div>`;

  const center = title
    ? `<div class="brand" style="justify-content:center;"><div class="word" style="text-align:center;"><b>${title}</b></div></div>`
    : "";

  const isBell = rightIcon === "bell";
  const right = rightIcon
    ? `<a class="icon-btn" href="${isBell ? "notifications.html" : rightHref}" aria-label="${isBell ? "Notifications" : "Action"}"${isBell ? " data-bell" : ""}>${ICONS[rightIcon]}</a>`
    : `<span style="width:36px;"></span>`;

  mount.innerHTML = `${left}${center}${right}`;
  if (isBell) refreshBellBadge();
}

/** Fetches and parses a JSON data file relative to the site root. */
export async function loadData(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

/** Registers the service worker (offline support + push alerts). Safe to call on every page. */
function registerServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const register = () => navigator.serviceWorker.register("sw.js").catch(() => {});
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register);
}

/** A slim notice while the phone has no connection, so it's clear why things aren't updating. */
function initOfflineBanner() {
  if (typeof window === "undefined" || document.getElementById("offline-banner")) return;
  const banner = document.createElement("div");
  banner.id = "offline-banner";
  banner.className = "offline-banner";
  banner.textContent = "You\u2019re offline \u2014 showing what\u2019s saved on your phone.";
  document.body.appendChild(banner);
  const update = () => {
    banner.hidden = navigator.onLine !== false;
  };
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  update();
}

/** Boots the shared chrome (topbar + bottom nav). Call once per page. */
export function bootApp(topbarOptions) {
  applyTheme();
  renderTopbar(topbarOptions);
  renderBottomNav();
  initOfflineBanner();
  registerServiceWorker();
}
