// components/settings.js — renders the Settings page from data/settings.json,
// with notification/media toggles backed by Supabase's user_settings table
// and a live Dark/Light theme + accent color picker (js/theme.js).
import { bootApp, loadData } from "../App.js";
import { ICONS } from "../icons.js";
import { requireAuth, signOut } from "../auth.js";
import { getTheme, getAccent, setTheme, setAccent, ACCENT_OPTIONS } from "../theme.js";
import { supabase } from "../supabaseClient.js";

const DEFAULT_SETTINGS = {
  live_alerts: true,
  daily_verse: true,
  giving_receipts: false,
  ministry_updates: true,
  wifi_only_downloads: true,
  autoplay_next: false,
};

function accountRow(item) {
  const inner = `
      <div class="row-icon">${ICONS[item.icon]}</div>
      <div class="row-body">
        <p class="row-title">${item.title}</p>
        ${item.sub ? `<p class="row-sub">${item.sub}</p>` : ""}
      </div>
      <div class="chevron">${ICONS.chevron}</div>`;
  return item.href
    ? `<a class="list-row" href="${item.href}">${inner}</a>`
    : `<div class="list-row" data-noop="${item.title}">${inner}</div>`;
}

function toggleRow(item, settings) {
  const isOn = settings[item.field];
  return `
    <div class="toggle-row">
      <div>
        <div class="t-title">${item.title}</div>
        ${item.sub ? `<div class="t-sub">${item.sub}</div>` : ""}
      </div>
      <div class="switch${isOn ? " on" : ""}" data-toggle data-field="${item.field}"></div>
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

  const [data, settingsRes] = await Promise.all([
    loadData("data/settings.json"),
    supabase.from("user_settings").select("*").eq("user_id", authUser.id).maybeSingle(),
  ]);

  // First time this user hits Settings — create their row with defaults.
  let settings = settingsRes.data;
  if (!settings) {
    const { data: created } = await supabase
      .from("user_settings")
      .insert({ user_id: authUser.id, ...DEFAULT_SETTINGS })
      .select()
      .maybeSingle();
    settings = created || DEFAULT_SETTINGS;
  }

  document.getElementById("account-group").innerHTML = data.account.map(accountRow).join("");
  document.getElementById("notifications-group").innerHTML = data.notifications
    .map((item) => toggleRow(item, settings))
    .join("");
  document.getElementById("media-group").innerHTML = data.media
    .map((item) => toggleRow(item, settings))
    .join("");
  document.getElementById("support-group").innerHTML = data.support.map(supportRow).join("");
  document.getElementById("app-version").textContent = data.version;

  const appearanceMount = document.getElementById("appearance-group");
  appearanceMount.innerHTML = appearanceHTML();
  wireAppearance(appearanceMount);

  // Real toggles — flip visually, then persist; roll back if the save fails.
  document.querySelectorAll("[data-toggle]").forEach((el) => {
    el.addEventListener("click", async () => {
      const field = el.dataset.field;
      const nextValue = !el.classList.contains("on");
      el.classList.toggle("on");

      const { error } = await supabase
        .from("user_settings")
        .update({ [field]: nextValue, updated_at: new Date().toISOString() })
        .eq("user_id", authUser.id);

      if (error) {
        el.classList.toggle("on"); // roll back
        alert(`Couldn't save that: ${error.message}`);
      }
    });
  });

  // Rows with no destination yet (e.g. "Manage payment methods").
  document.querySelectorAll("[data-noop]").forEach((el) => {
    el.addEventListener("click", () => {
      alert(`${el.dataset.noop} isn't set up yet — coming soon.`);
    });
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

    await supabase.auth.signOut({ scope: "local" });
    alert("Your account has been deleted.");
    location.href = "login.html";
  });
}
