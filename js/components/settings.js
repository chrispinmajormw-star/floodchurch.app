// components/settings.js — renders the Settings page from data/settings.json,
// plus a live Dark/Light theme + accent color picker (js/theme.js).
import { bootApp, loadData } from "../App.js";
import { ICONS } from "../icons.js";
import { requireAuth, signOut } from "../auth.js";
import { getTheme, getAccent, setTheme, setAccent, ACCENT_OPTIONS } from "../theme.js";
import { supabase } from "../supabaseClient.js";

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

function appearanceHTML() {
  const theme = getTheme();
  const accent = getAccent();
  return `
    <div class="theme-toggle">
      <button class="theme-btn${theme === "dark" ? " active" : ""}" data-theme-btn="dark">Dark</button>
      <button class="theme-btn${theme === "light" ? " active" : ""}" data-theme-btn="light">Light</button>
    </div>
    <div class="swatch-row">
      ${ACCENT_OPTIONS.map(
        (opt) => `<button class="swatch${accent === opt.value ? " active" : ""}" data-accent="${opt.value}" style="background:${opt.value}" aria-label="${opt.name}"></button>`
      ).join("")}
    </div>`;
}

function wireAppearance(mount) {
  mount.querySelectorAll("[data-theme-btn]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setTheme(btn.dataset.themeBtn);
      mount.innerHTML = appearanceHTML();
      wireAppearance(mount);
    });
  });
  mount.querySelectorAll("[data-accent]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setAccent(btn.dataset.accent);
      mount.innerHTML = appearanceHTML();
      wireAppearance(mount);
    });
  });
}

export async function renderSettings() {
  const authUser = await requireAuth();
  if (!authUser) return;

  bootApp({ back: true, backHref: "profile.html", rightIcon: null, title: "Settings" });

  const data = await loadData("data/settings.json");

  document.getElementById("account-group").innerHTML = data.account.map(accountRow).join("");
  document.getElementById("notifications-group").innerHTML = data.notifications.map(toggleRow).join("");
  document.getElementById("media-group").innerHTML = data.media.map(toggleRow).join("");
  document.getElementById("support-group").innerHTML = data.support.map(supportRow).join("");
  document.getElementById("app-version").textContent = data.version;

  const appearanceMount = document.getElementById("appearance-group");
  appearanceMount.innerHTML = appearanceHTML();
  wireAppearance(appearanceMount);

  document.querySelectorAll("[data-toggle]").forEach((el) => {
    el.addEventListener("click", () => el.classList.toggle("on"));
  });

  document.getElementById("logout-btn").addEventListener("click", async () => {
    await signOut(); // redirects to login.html
  });

  document.getElementById("delete-account").addEventListener("click", async () => {
    const confirmed = confirm(
      "Delete your account? This permanently removes your profile, giving history, prayer requests, saved sermons and downloads. This cannot be undone."
    );
    if (!confirmed) return;

    const row = document.getElementById("delete-account");
    row.style.opacity = "0.5";
    row.style.pointerEvents = "none";

    const { error } = await supabase.functions.invoke("delete-account");

    if (error) {
      row.style.opacity = "1";
      row.style.pointerEvents = "auto";
      alert(`Couldn't delete your account: ${error.message}`);
      return;
    }

    // Clear the now-invalid local session without calling the API again.
    await supabase.auth.signOut({ scope: "local" });
    alert("Your account has been deleted.");
    location.href = "login.html";
  });
}
