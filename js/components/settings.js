// components/settings.js — renders the Settings page from data/settings.json
import { bootApp, loadData } from "../App.js";
import { ICONS } from "../icons.js";
import { requireAuth, signOut } from "../auth.js";

function accountRow(item) {
  return `
    <div class="list-row">
      <div class="row-icon">${ICONS[item.icon]}</div>
      <div class="row-body">
        <p class="row-title">${item.title}</p>
        ${item.sub ? `<p class="row-sub">${item.sub}</p>` : ""}
      </div>
      <div class="chevron">${ICONS.chevron}</div>
    </div>`;
}

function toggleRow(item) {
  return `
    <div class="toggle-row">
      <div>
        <div class="t-title">${item.title}</div>
        ${item.sub ? `<div class="t-sub">${item.sub}</div>` : ""}
      </div>
      <div class="switch${item.on ? " on" : ""}" data-toggle></div>
    </div>`;
}

function supportRow(item) {
  return `
    <div class="list-row">
      <div class="row-icon">${ICONS[item.icon]}</div>
      <div class="row-body"><p class="row-title">${item.title}</p></div>
      <div class="chevron">${ICONS.chevron}</div>
    </div>`;
}

export async function renderSettings() {
  const authUser = await requireAuth();
  if (!authUser) return;

  bootApp({ back: true, backHref: "profile.html", rightIcon: null, title: "Settings" });

  const data = await loadData("data/settings.json");

  document.getElementById("account-group").innerHTML = data.account.map(accountRow).join("");
  document.getElementById("notifications-group").innerHTML = data.notifications.map(toggleRow).join("");
  document.getElementById("media-group").innerHTML = data.media.map(toggleRow).join("");
  document.getElementById("appearance-group").innerHTML = data.appearance.map(toggleRow).join("");
  document.getElementById("support-group").innerHTML = data.support.map(supportRow).join("");
  document.getElementById("app-version").textContent = data.version;

  document.querySelectorAll("[data-toggle]").forEach((el) => {
    el.addEventListener("click", () => el.classList.toggle("on"));
  });

  document.getElementById("logout-btn").addEventListener("click", async () => {
    await signOut(); // redirects to login.html
  });

  document.getElementById("delete-account").addEventListener("click", () => {
    if (confirm("Delete your account? This is a demo — nothing will actually happen.")) {
      alert("(Demo only — no account was deleted.)");
    }
  });
}
