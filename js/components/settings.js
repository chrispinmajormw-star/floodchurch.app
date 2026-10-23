// components/settings.js — renders the Settings page from data/settings.json,
// with notification/media toggles backed by Supabase's user_settings table,
// a push-notification switch for this device, and a live Dark/Light theme +
// accent color picker (js/theme.js).
import { bootApp, loadData } from "../App.js";
import { ICONS } from "../icons.js";
import { requireAuth, signOut } from "../auth.js";
import { getTheme, getAccent, setTheme, setAccent, ACCENT_OPTIONS } from "../theme.js";
import { supabase } from "../supabaseClient.js";
import { getPushStatus, enablePush, disablePush } from "../push.js";
import { getSiteSettings } from "../site-settings.js";
import { BIBLE_BOOKS } from "../bible-books.js";
import { savedBookCount, saveWholeBible, removeSavedBible } from "../bible-text.js";

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
  const inner = `
      <div class="row-icon">${ICONS[item.icon]}</div>
      <div class="row-body"><p class="row-title">${item.title}</p></div>
      <div class="chevron">${ICONS.chevron}</div>`;
  return item.href
    ? `<a class="list-row" href="${item.href}">${inner}</a>`
    : `<div class="list-row" data-noop="${item.title}">${inner}</div>`;
}

// --- Push notifications for this device -------------------------------------

function pushStatusText(status) {
  const onIphone = /iPhone|iPad|iPod/i.test(navigator.userAgent || "");
  switch (status) {
    case "enabled":
      return "On for this device";
    case "disabled":
      return "Off for this device — switch on to get alerts when the app is closed";
    case "blocked":
      return "Blocked — allow notifications in your phone or browser settings";
    case "unconfigured":
      return "Not available yet";
    default:
      return onIphone
        ? "On iPhone, add the app to your Home Screen first (Share → Add to Home Screen)"
        : "Not supported on this browser";
  }
}

function pushRowHTML(status) {
  const on = status === "enabled";
  const locked = status === "unsupported" || status === "unconfigured" || status === "blocked";
  return `
    <div class="toggle-row">
      <div>
        <div class="t-title">Push notifications</div>
        <div class="t-sub" id="push-sub">${pushStatusText(status)}</div>
      </div>
      <div class="switch${on ? " on" : ""}${locked ? " disabled" : ""}" id="push-switch"></div>
    </div>`;
}

async function refreshPushRow() {
  const status = await getPushStatus();
  const sw = document.getElementById("push-switch");
  const sub = document.getElementById("push-sub");
  if (!sw || !sub) return;
  sw.classList.toggle("on", status === "enabled");
  sw.classList.toggle("disabled", status === "unsupported" || status === "unconfigured" || status === "blocked");
  sub.textContent = pushStatusText(status);
}

function wirePushRow(authUser) {
  const sw = document.getElementById("push-switch");
  if (!sw) return;
  sw.addEventListener("click", async () => {
    if (sw.classList.contains("disabled") || sw.dataset.busy) return;
    sw.dataset.busy = "1";
    const turningOn = !sw.classList.contains("on");
    try {
      if (turningOn) await enablePush(authUser.id);
      else await disablePush();
    } catch (err) {
      alert(err.message);
    }
    delete sw.dataset.busy;
    await refreshPushRow();
  });
}

// --- Appearance ---------------------------------------------------------------

// --- Offline Bible ------------------------------------------------------------

const TOTAL_BOOKS = BIBLE_BOOKS.length;

function offlineRowHTML(saved) {
  const all = saved >= TOTAL_BOOKS;
  const sub = all
    ? "Saved on this phone — the whole Bible works with no signal"
    : saved > 0
      ? `${saved} of ${TOTAL_BOOKS} books saved. Save the rest to read anywhere`
      : "Save the whole Bible (about 1.3 MB) to read with no signal";
  return `
    <div class="toggle-row">
      <div>
        <div class="t-title">Bible for offline reading</div>
        <div class="t-sub" id="offline-sub">${sub}</div>
      </div>
      <button class="chip" id="offline-btn" style="padding:8px 14px;flex-shrink:0;">${all ? "Remove" : "Save"}</button>
    </div>`;
}

async function refreshOfflineRow() {
  const holder = document.getElementById("offline-row");
  if (holder) holder.innerHTML = offlineRowHTML(await savedBookCount());
  wireOfflineRow();
}

/** True when the phone says it's on mobile data (browsers that can't tell are treated as Wi-Fi). */
function onMobileData() {
  const c = navigator.connection;
  return Boolean(c && c.type === "cellular");
}

function wireOfflineRow() {
  const btn = document.getElementById("offline-btn");
  const sub = document.getElementById("offline-sub");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    if ((await savedBookCount()) >= TOTAL_BOOKS) {
      await removeSavedBible();
      await refreshOfflineRow();
      return;
    }
    const wifiOnly = document.querySelector('[data-field="wifi_only_downloads"]');
    if (wifiOnly && wifiOnly.classList.contains("on") && onMobileData()) {
      const go = confirm("You\u2019re on mobile data and \u201cDownload over Wi-Fi only\u201d is on. Save the Bible (about 1.3 MB) anyway?");
      if (!go) return;
    }
    btn.disabled = true;
    try {
      await saveWholeBible((done, total) => {
        sub.textContent = `Saving\u2026 ${done} of ${total} books`;
      });
    } catch (err) {
      alert(err.message);
    }
    await refreshOfflineRow();
  });
}

/** Wipes the church content saved on this phone for offline use (so the next person to sign in can't see it). */
async function clearSavedContent() {
  try {
    if (typeof caches !== "undefined") await caches.delete("flood-data");
  } catch (e) {}
}

// --- Theme saved to the account ---------------------------------------------------

let accountUserId = null;

/** Remember the Dark/Light choice and colour on the account, so a new phone looks the same after sign-in. */
async function saveThemeToAccount() {
  if (!accountUserId) return;
  try {
    await supabase
      .from("user_settings")
      .upsert({ user_id: accountUserId, theme: getTheme(), accent: getAccent() }, { onConflict: "user_id" });
  } catch (e) {
    /* the choice is still saved on this phone */
  }
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
      saveThemeToAccount();
      mount.innerHTML = appearanceHTML();
      wireAppearance(mount);
    });
  });
  mount.querySelectorAll("[data-accent]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setAccent(btn.dataset.accent);
      saveThemeToAccount();
      mount.innerHTML = appearanceHTML();
      wireAppearance(mount);
    });
  });
}

export async function renderSettings() {
  const authUser = await requireAuth();
  if (!authUser) return;

  bootApp({ back: true, backHref: "profile.html", rightIcon: null, title: "Settings" });

  accountUserId = authUser.id;

  const [data, settingsRes, pushStatus, site, savedBooks] = await Promise.all([
    loadData("data/settings.json"),
    supabase.from("user_settings").select("*").eq("user_id", authUser.id).maybeSingle(),
    getPushStatus(),
    getSiteSettings(),
    savedBookCount(),
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

  // The Dark/Light choice and colour saved on the account win over what this phone had.
  if (settings.theme && settings.theme !== getTheme()) setTheme(settings.theme);
  if (settings.accent && settings.accent !== getAccent()) setAccent(settings.accent);

  // "Contact the church office" uses whatever email/phone the admin has saved.
  const contactHref = site.contact_email
    ? `mailto:${site.contact_email}`
    : site.contact_phone
      ? `tel:${site.contact_phone.replace(/\s+/g, "")}`
      : null;
  const support = data.support.map((item) => (item.contact ? { ...item, href: contactHref } : item));

  document.getElementById("account-group").innerHTML = data.account.map(accountRow).join("");
  document.getElementById("notifications-group").innerHTML =
    pushRowHTML(pushStatus) + data.notifications.map((item) => toggleRow(item, settings)).join("");
  document.getElementById("media-group").innerHTML =
    `<div id="offline-row">${offlineRowHTML(savedBooks)}</div>` + data.media.map((item) => toggleRow(item, settings)).join("");
  document.getElementById("support-group").innerHTML = support.map(supportRow).join("");
  document.getElementById("app-version").textContent = data.version;

  const appearanceMount = document.getElementById("appearance-group");
  appearanceMount.innerHTML = appearanceHTML();
  wireAppearance(appearanceMount);

  wirePushRow(authUser);
  wireOfflineRow();

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
    // Stop sending this account's alerts to this phone once they sign out.
    await disablePush();
    await clearSavedContent();
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

    await clearSavedContent();
    await supabase.auth.signOut({ scope: "local" });
    alert("Your account has been deleted.");
    location.href = "login.html";
  });
}
