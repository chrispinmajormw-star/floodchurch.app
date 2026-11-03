// menu.js — the side menu (opened from the ☰ button in the top bar). Loaded only when someone
// taps the button, so it adds nothing to normal page loads.
import { ICONS } from "./icons.js";
import { supabase } from "./supabaseClient.js";
import { getUnreadCount } from "./notifications.js";
import { escapeHtml } from "./util.js";

const GROUPS = [
  {
    title: "Quick access",
    items: [
      { label: "Profile", icon: "user", href: "profile.html" },
      { label: "Giving", icon: "heart", href: "give.html" },
      { label: "Updates", icon: "bell", href: "notifications.html", badge: true },
      { label: "Prayer requests", icon: "pray", href: "prayer.html" },
    ],
  },
  {
    title: "Media",
    items: [
      { label: "Sermons", icon: "sermon", href: "sermons.html" },
      { label: "Live TV", icon: "tv", href: "live.html" },
      { label: "Devotions", icon: "devotion", href: "devotions.html" },
      { label: "Podcasts", icon: "podcast", href: "media.html" },
      { label: "Saved sermons", icon: "bookmark", href: "saved-sermons.html" },
      { label: "Downloads", icon: "downloads", href: "downloads.html" },
    ],
  },
  {
    title: "Church",
    items: [
      { label: "Events", icon: "calendar", href: "events.html" },
      { label: "Be Involved", icon: "ministries", href: "be-involved.html" },
      { label: "Discipleship", icon: "book", href: "discipleship.html" },
    ],
  },
  {
    title: "More",
    items: [
      { label: "Connect with us", icon: "pin", href: "connect.html" },
      { label: "Settings", icon: "gear", href: "settings.html" },
      { label: "Help & FAQ", icon: "help", href: "help.html" },
    ],
  },
];

const X_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
let els = null;
let keyHandler = null;

function linkHTML(item) {
  const here = (location.pathname.split("/").pop() || "index.html") === item.href;
  return `<a class="drawer-link${here ? " current" : ""}" href="${item.href}"${here ? ' aria-current="page"' : ""}>
      <span class="drawer-icon">${ICONS[item.icon]}</span>
      <span class="drawer-label">${escapeHtml(item.label)}</span>
      ${item.badge ? '<span class="menu-badge" hidden></span>' : ""}
      <span class="drawer-chevron">${ICONS.chevron}</span>
    </a>`;
}

function build() {
  const overlay = document.createElement("div");
  overlay.className = "drawer-overlay";
  overlay.id = "drawer-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `
    <aside class="drawer" role="dialog" aria-modal="true" aria-label="Menu">
      <div class="drawer-head">
        <div class="brand">
          <div class="mark"><img src="assets/floodwhite.svg" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'F'}))"></div>
          <div class="word"><b>FLOOD</b><span>CHURCH</span></div>
        </div>
        <button class="icon-btn" id="drawer-close" aria-label="Close menu">${X_ICON}</button>
      </div>
      <nav class="drawer-body">
        ${GROUPS.map((g) => `<p class="drawer-group">${escapeHtml(g.title)}</p>${g.items.map(linkHTML).join("")}`).join("")}
        <div id="drawer-staff"></div>
      </nav>
    </aside>`;
  document.body.appendChild(overlay);
  els = { overlay, drawer: overlay.querySelector(".drawer") };
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeMenu();
  });
  overlay.querySelector("#drawer-close").addEventListener("click", closeMenu);
}

/** The unread count and the dashboard link for staff — filled in after the menu is already showing. */
async function fillDynamic() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const uid = session.user.id;
    const [count, profile] = await Promise.all([
      getUnreadCount(uid),
      supabase.from("profiles").select("is_admin, is_pastor").eq("id", uid).maybeSingle(),
    ]);
    const badge = els.overlay.querySelector(".menu-badge");
    if (badge) {
      badge.textContent = count > 9 ? "9+" : String(count);
      badge.hidden = count < 1;
    }
    const staff = profile.data;
    const holder = els.overlay.querySelector("#drawer-staff");
    if ((staff?.is_admin || staff?.is_pastor) && holder && !holder.innerHTML) {
      holder.innerHTML = `<p class="drawer-group">Staff</p>${linkHTML({ label: "Dashboard", icon: "lock", href: "admin.html" })}`;
    }
  } catch (e) {
    /* the menu works fine without the count */
  }
}

export function isMenuOpen() {
  return Boolean(els && document.body.contains(els.overlay) && !els.overlay.hidden);
}

export function openMenu() {
  if (!els || !document.body.contains(els.overlay)) build();
  els.overlay.hidden = false;
  requestAnimationFrame(() => els.overlay.classList.add("open"));
  document.body.style.overflow = "hidden";
  keyHandler = (e) => {
    if (e.key === "Escape") closeMenu();
  };
  document.addEventListener("keydown", keyHandler);
  fillDynamic();
}

export function closeMenu() {
  if (!els) return;
  els.overlay.classList.remove("open");
  els.overlay.hidden = true;
  document.body.style.overflow = "";
  if (keyHandler) document.removeEventListener("keydown", keyHandler);
  keyHandler = null;
}

export function toggleMenu() {
  if (isMenuOpen()) closeMenu();
  else openMenu();
}
