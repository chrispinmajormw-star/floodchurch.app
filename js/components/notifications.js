// components/notifications.js — the notification list behind the bell.
import { bootApp } from "../App.js";
import { requireAuth } from "../auth.js";
import { ICONS } from "../icons.js";
import { fetchNotifications, markAllRead } from "../notifications.js";
import { getPushStatus, enablePush } from "../push.js";
import { escapeHtml, timeAgo, safeUrl } from "../util.js";

const CATEGORY_ICON = {
  live: "tv",
  verse: "book",
  devotion: "devotion",
  ministry: "ministries",
  receipt: "heart",
  general: "bell",
};

function rowHTML(n) {
  const href = safeUrl(n.url);
  const external = href && /^https?:/i.test(href);
  const inner = `
    <div class="notif-icon">${ICONS[CATEGORY_ICON[n.category] || "bell"]}</div>
    <div class="notif-body">
      <p class="notif-title">${escapeHtml(n.title)}</p>
      ${n.body ? `<p class="notif-text">${escapeHtml(n.body)}</p>` : ""}
      <p class="notif-time">${timeAgo(n.created_at)}</p>
    </div>`;
  const cls = `notif-row${n.unread ? " unread" : ""}`;
  return href
    ? `<a class="${cls}" href="${escapeHtml(href)}"${external ? ' target="_blank" rel="noopener"' : ""}>${inner}</a>`
    : `<div class="${cls}">${inner}</div>`;
}

export async function renderNotifications() {
  const authUser = await requireAuth();
  if (!authUser) return;

  bootApp({ back: true, backHref: "index.html", rightIcon: null, title: "Notifications" });

  const listMount = document.getElementById("notif-list");
  const emptyMsg = document.getElementById("notif-empty");

  // Offer to turn on phone alerts, if this device can and hasn't yet.
  const banner = document.getElementById("push-banner");
  const enableBtn = document.getElementById("push-enable-btn");
  if ((await getPushStatus()) === "disabled") {
    banner.style.display = "flex";
    enableBtn.addEventListener("click", async () => {
      enableBtn.disabled = true;
      enableBtn.textContent = "Turning on…";
      try {
        await enablePush(authUser.id);
        banner.style.display = "none";
        alert("Push alerts are on for this device.");
      } catch (err) {
        enableBtn.disabled = false;
        enableBtn.textContent = "Turn on";
        alert(err.message);
      }
    });
  }

  let items;
  try {
    items = await fetchNotifications(authUser.id, 50);
  } catch (err) {
    listMount.innerHTML = `<p style="color:var(--red);font-size:14px;">Couldn't load notifications: ${escapeHtml(err.message)}</p>`;
    return;
  }

  if (!items.length) {
    emptyMsg.style.display = "block";
    return;
  }

  listMount.innerHTML = items.map(rowHTML).join("");

  // Opening the list counts as reading it (rows stay highlighted for this visit).
  await markAllRead(authUser.id, items[0].created_at);
}
