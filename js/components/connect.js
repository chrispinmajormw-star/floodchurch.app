// components/connect.js — "Connect with us": where to find the church, how to reach it, and its
// social channels. Everything comes from Home & Contact Details in the dashboard, and only the
// things that have been filled in are shown.
import { bootApp } from "../App.js";
import { ICONS } from "../icons.js";
import { requireAuth } from "../auth.js";
import { getSiteSettings } from "../site-settings.js";
import { escapeHtml, safeUrl } from "../util.js";

/** Keeps only real web links (https://…), so a mistyped or unsafe value can never become a button. */
function webLink(value) {
  const url = safeUrl(value);
  return url && /^https?:\/\//i.test(url) ? url : null;
}

/** "https://www.youtube.com/@flood" → "youtube.com/@flood" */
function shortLink(url) {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "");
    return u.hostname.replace(/^www\./, "") + path;
  } catch (e) {
    return url;
  }
}

/** "+265 (999) 123-456" → "265999123456" (the form wa.me wants). */
export function whatsappDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

export function buildGroups(site) {
  const groups = [];

  const find = [];
  if (site.service_address) {
    find.push({
      icon: "pin", title: "Visit us", sub: site.service_address,
      href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(site.service_address)}`, external: true, hint: "Open in Maps",
    });
  }
  if (find.length) groups.push({ title: "Find us", rows: find });

  const reach = [];
  if (site.contact_phone) reach.push({ icon: "phone", title: "Call the office", sub: site.contact_phone, href: `tel:${site.contact_phone.replace(/\s+/g, "")}` });
  const wa = whatsappDigits(site.whatsapp_number);
  if (wa.length >= 7) reach.push({ icon: "whatsapp", title: "WhatsApp", sub: site.whatsapp_number, href: `https://wa.me/${wa}`, external: true });
  if (site.contact_email) reach.push({ icon: "mail", title: "Email the office", sub: site.contact_email, href: `mailto:${site.contact_email}` });
  if (reach.length) groups.push({ title: "Reach us", rows: reach });

  const follow = [];
  for (const [key, icon, title] of [
    ["youtube_url", "youtube", "YouTube"],
    ["facebook_url", "facebook", "Facebook"],
    ["instagram_url", "instagram", "Instagram"],
    ["tiktok_url", "tiktok", "TikTok"],
    ["website_url", "globe", "Website"],
  ]) {
    const url = webLink(site[key]);
    if (url) follow.push({ icon, title, sub: shortLink(url), href: url, external: true });
  }
  if (follow.length) groups.push({ title: "Follow us", rows: follow });

  return groups;
}

export async function renderConnect() {
  const authUser = await requireAuth();
  if (!authUser) return;

  bootApp({ back: true, backHref: "index.html", rightIcon: null, title: "Connect" });

  const site = await getSiteSettings();
  const groups = buildGroups(site);
  const mount = document.getElementById("connect-list");

  if (!groups.length) {
    document.getElementById("connect-empty").style.display = "block";
    return;
  }

  mount.innerHTML = groups
    .map(
      (g) => `
    <div class="settings-group">
      <p class="group-label">${escapeHtml(g.title)}</p>
      ${g.rows
        .map(
          (r) => `
        <a class="list-row" href="${escapeHtml(r.href)}"${r.external ? ' target="_blank" rel="noopener"' : ""}>
          <div class="row-icon">${ICONS[r.icon]}</div>
          <div class="row-body">
            <p class="row-title">${escapeHtml(r.title)}</p>
            <p class="row-sub">${escapeHtml(r.sub)}</p>
          </div>
          <div class="chevron">${ICONS.chevron}</div>
        </a>`
        )
        .join("")}
    </div>`
    )
    .join("");
}
