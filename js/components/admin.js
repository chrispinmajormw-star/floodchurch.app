// components/admin.js — one dashboard for both staff roles.
//   Admins: Applications, Send a notification, Media Live, Home & Contact
//           details, and posting for announcements, events, conference banner,
//           devotions, verse of the day, sermons, podcasts, reading plans,
//           FAQs and the three "apply" lists.
//   Pastors: Send a notification, the Prayer Requests inbox, devotions and
//           verse of the day.
import { bootApp } from "../App.js";
import { requireAuth } from "../auth.js";
import { supabase } from "../supabaseClient.js";
import { sendBroadcast, describePush } from "../notifications.js";
import { escapeHtml, timeAgo } from "../util.js";

function clip(text, n = 140) {
  const t = String(text ?? "").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
}

const WHEN_FORMAT = { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" };
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// `notify` (optional) adds an "Also notify members" tick-box to a section's form.
// `autoOrder` puts each new item at the end of the list (or the top, for "start").
const SECTIONS = [
  {
    table: "announcements",
    title: "Announcements",
    roles: ["admin"],
    orderBy: "sort_order",
    autoOrder: "start", // newest announcement goes to the top
    fields: [{ key: "content", label: "Announcement text", type: "textarea" }],
    listLabel: (row) => row.content,
    notify: {
      defaultOn: true,
      build: (r) => ({ title: "New announcement", body: clip(r.content), url: "index.html", category: "general" }),
    },
  },
  {
    table: "events",
    title: "Upcoming Events",
    roles: ["admin"],
    orderBy: "event_date",
    fields: [
      { key: "title", label: "Title", type: "text" },
      { key: "event_date", label: "Date & time", type: "datetime-local" },
      { key: "location", label: "Location (optional)", type: "text", optional: true },
      { key: "description", label: "Full details (optional)", type: "textarea", optional: true },
    ],
    listLabel: (row) => `${row.title} — ${new Date(row.event_date).toLocaleString()}`,
    notify: {
      defaultOn: true,
      build: (r) => ({
        title: `New event: ${r.title}`,
        body: [new Date(r.event_date).toLocaleString(undefined, WHEN_FORMAT), r.location].filter(Boolean).join(" · "),
        url: r.id ? `events.html?id=${r.id}` : "events.html",
        category: "general",
      }),
    },
  },
  {
    table: "conferences",
    title: "Conference Banner",
    roles: ["admin"],
    orderBy: "created_at",
    fields: [
      { key: "eyebrow", label: "Eyebrow label (e.g. CONFERENCE 2026)", type: "text" },
      { key: "title", label: "Title", type: "text" },
      { key: "dates", label: "Dates / location line", type: "text" },
      { key: "cta_text", label: "Button text", type: "text", default: "Register" },
      { key: "cta_link", label: "Button link", type: "text" },
    ],
    listLabel: (row) => row.title,
    notify: {
      defaultOn: true,
      build: (r) => ({ title: r.title, body: clip(r.dates), url: "index.html", category: "general" }),
    },
  },
  {
    table: "devotions",
    title: "Today's Devotion",
    roles: ["admin", "pastor"],
    orderBy: "devotion_date",
    fields: [
      { key: "title", label: "Title", type: "text" },
      { key: "reference", label: "Scripture reference (e.g. Romans 12:2)", type: "text" },
      { key: "body", label: "Devotion text", type: "textarea" },
      { key: "tag", label: "Tag (e.g. Transformation)", type: "text" },
      { key: "devotion_date", label: "Date (leave empty for today)", type: "date", optional: true },
    ],
    listLabel: (row) => `${row.title} (${row.devotion_date})`,
    notify: {
      defaultOn: true,
      build: (r) => ({
        title: `Today's Devotion: ${r.title}`,
        body: clip(`${r.reference ? r.reference + " — " : ""}${r.body}`),
        url: "index.html",
        category: "devotion",
      }),
    },
  },
  {
    table: "verse_of_day",
    title: "Verse of the Day",
    roles: ["admin", "pastor"],
    orderBy: "verse_date",
    fields: [
      { key: "text", label: "Verse text", type: "textarea" },
      { key: "reference", label: "Reference (e.g. Isaiah 43:19)", type: "text" },
      { key: "verse_date", label: "Date (leave empty for today)", type: "date", optional: true },
    ],
    listLabel: (row) => `${row.reference} (${row.verse_date})`,
    notify: {
      defaultOn: true,
      build: (r) => ({
        title: "Verse of the Day",
        body: clip(`\u201c${r.text}\u201d — ${r.reference}`),
        url: "index.html",
        category: "verse",
      }),
    },
  },
  {
    table: "sermons",
    title: "Recent Sermons",
    roles: ["admin"],
    orderBy: "created_at",
    fields: [
      { key: "title", label: "Title", type: "text" },
      { key: "speaker", label: "Speaker", type: "text" },
      { key: "duration", label: "Duration (e.g. 48 min)", type: "text" },
      { key: "video_url", label: "YouTube link (or upload a video file below)", type: "text" },
    ],
    fileField: { key: "video_url", accept: "video/mp4,video/*", folder: "sermons" },
    listLabel: (row) => `${row.title} — ${row.speaker || ""}`,
    notify: {
      defaultOn: false,
      build: (r) => ({ title: `New sermon: ${r.title}`, body: r.speaker || "", url: "index.html", category: "general" }),
    },
  },
  {
    table: "podcasts",
    title: "Podcasts",
    roles: ["admin"],
    orderBy: "created_at",
    fields: [
      { key: "title", label: "Title", type: "text" },
      { key: "sub", label: "Subtitle (e.g. Pastor Humphreys · 36 min)", type: "text" },
      { key: "audio_url", label: "Audio link (or upload an MP3 below)", type: "text" },
    ],
    fileField: { key: "audio_url", accept: "audio/mpeg,audio/*", folder: "podcasts" },
    listLabel: (row) => row.title,
    notify: {
      defaultOn: false,
      build: (r) => ({ title: `New podcast: ${r.title}`, body: r.sub || "", url: "media.html", category: "general" }),
    },
  },
  {
    table: "reading_plans",
    title: "Reading Plans",
    roles: ["admin"],
    orderBy: "sort_order",
    autoOrder: true,
    fields: [
      { key: "title", label: "Plan name (e.g. Bible in a Year)", type: "text" },
      { key: "duration_days", label: "Number of days", type: "number" },
      { key: "description", label: "Short description (optional)", type: "textarea", optional: true },
    ],
    listLabel: (row) => `${row.title} — ${row.duration_days} days`,
  },
  {
    table: "faqs",
    title: "Help & FAQ",
    roles: ["admin"],
    orderBy: "sort_order",
    autoOrder: true,
    fields: [
      { key: "question", label: "Question", type: "text" },
      { key: "answer", label: "Answer", type: "textarea" },
    ],
    listLabel: (row) => row.question,
  },
  {
    table: "ministries",
    title: "Serve in the Church",
    roles: ["admin"],
    orderBy: "sort_order",
    autoOrder: true,
    fields: [{ key: "name", label: "Team name (e.g. Media Team)", type: "text" }],
    listLabel: (row) => row.name,
  },
  {
    table: "discipleship_resources",
    title: "Discipleship",
    roles: ["admin"],
    orderBy: "sort_order",
    autoOrder: true,
    fields: [
      { key: "name", label: "Resource/course name", type: "text" },
      { key: "description", label: "Short description (optional)", type: "textarea", optional: true },
    ],
    listLabel: (row) => row.name,
  },
  {
    table: "involvement_options",
    title: "Be Involved in the Church",
    roles: ["admin"],
    orderBy: "sort_order",
    autoOrder: true,
    fields: [
      { key: "name", label: "Name (e.g. Prayer Cafe)", type: "text" },
      { key: "description", label: "Short description (optional)", type: "textarea", optional: true },
    ],
    listLabel: (row) => row.name,
  },
];

function fieldInput(field) {
  const req = field.optional ? "" : "required";
  const label = escapeHtml(field.label);
  if (field.type === "textarea") {
    return `<textarea class="amount-input" style="border-radius:var(--radius-md); min-height:80px; font-weight:400; font-size:14.5px;" name="${field.key}" placeholder="${label}" ${req}></textarea>`;
  }
  const extra = field.type === "number" ? ' min="1" inputmode="numeric"' : "";
  return `<input class="auth-input" type="${field.type}" name="${field.key}" placeholder="${label}" value="${escapeHtml(field.default || "")}" ${req}${extra}>`;
}

async function uploadFile(file, folder) {
  const path = `${folder}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const { error } = await supabase.storage.from("media").upload(path, file);
  if (error) throw error;
  const { data } = supabase.storage.from("media").getPublicUrl(path);
  return data.publicUrl;
}

const NEEDS_VISIBLE_LABEL = ["date", "datetime-local", "number"];

const ICON_PENCIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
const ICON_UP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>';
const ICON_DOWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
const ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

/** Turns what was typed into what the database stores. */
function castValue(field, v) {
  if (field.type === "number") return Number(v);
  // Entered in the admin's local time → stored as the exact moment, so it shows correctly for everyone.
  if (field.type === "datetime-local") return new Date(v).toISOString();
  return v;
}

/** Turns a stored value back into something a form field can show (for editing). */
function inputValue(field, stored) {
  if (stored === null || stored === undefined) return "";
  if (field.type === "date") return String(stored).slice(0, 10);
  if (field.type === "datetime-local") {
    const d = new Date(stored);
    if (isNaN(d)) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return String(stored);
}

function renderSection(section) {
  const sortable = section.orderBy === "sort_order";
  const wrap = document.createElement("div");
  wrap.className = "card";
  wrap.style.marginBottom = "24px";
  wrap.innerHTML = `
    <h2 class="section-title" style="margin-top:0;">${escapeHtml(section.title)}</h2>
    <form class="admin-form">
      <div class="edit-banner" hidden>
        <span class="edit-banner-text"></span>
        <button type="button" class="chip edit-cancel" style="padding:6px 12px;">Cancel</button>
      </div>
      ${section.fields
        .map(
          (f) =>
            `<div class="auth-field">${NEEDS_VISIBLE_LABEL.includes(f.type) ? `<label>${escapeHtml(f.label)}</label>` : ""}${fieldInput(f)}</div>`
        )
        .join("")}
      ${
        section.fileField
          ? `<div class="auth-field">
               <label>Or upload a file</label>
               <input class="auth-input" type="file" accept="${section.fileField.accept}" data-file-for="${section.fileField.key}">
               <p class="upload-status post-status"></p>
             </div>`
          : ""
      }
      ${
        section.notify
          ? `<label class="notify-check"><input type="checkbox" class="notify-box" ${section.notify.defaultOn ? "checked" : ""}> Also notify members (in-app + phone alerts)</label>`
          : ""
      }
      <button class="btn btn-primary" type="submit" style="width:100%;padding:13px;">Post</button>
      <p class="post-status form-status"></p>
    </form>
    <div class="admin-list" style="margin-top:18px;"></div>
  `;

  const form = wrap.querySelector(".admin-form");
  const listMount = wrap.querySelector(".admin-list");
  const statusEl = wrap.querySelector(".form-status");
  const banner = wrap.querySelector(".edit-banner");
  const bannerText = wrap.querySelector(".edit-banner-text");
  const submitBtn = form.querySelector("button[type=submit]");
  const notifyLabel = wrap.querySelector(".notify-check");

  let rowsById = {};
  let maxOrder = 0;
  let minOrder = 0;
  let editingId = null;

  function exitEdit() {
    editingId = null;
    form.reset();
    banner.hidden = true;
    submitBtn.textContent = "Post";
    if (notifyLabel) notifyLabel.hidden = false;
    statusEl.textContent = "";
  }

  function startEdit(row) {
    editingId = row.id;
    section.fields.forEach((f) => {
      form.elements[f.key].value = inputValue(f, row[f.key]);
    });
    bannerText.textContent = `Editing: ${clip(section.listLabel(row), 60)}`;
    banner.hidden = false;
    submitBtn.textContent = "Save changes";
    if (notifyLabel) notifyLabel.hidden = true; // edits don't re-notify; use "Send a Notification" if you want to
    statusEl.textContent = "";
    if (form.scrollIntoView) form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  wrap.querySelector(".edit-cancel").addEventListener("click", exitEdit);

  /** Moves one item up or down. Everything is renumbered 1…n so ties can't cause surprises. */
  async function moveRow(id, dir) {
    const { data, error } = await supabase.from(section.table).select("*").order("sort_order").order("id");
    if (error) {
      alert(`Couldn't reorder: ${error.message}`);
      return;
    }
    const ids = data.map((r) => r.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    const results = await Promise.all(ids.map((rid, idx) => supabase.from(section.table).update({ sort_order: idx + 1 }).eq("id", rid)));
    const failed = results.find((r) => r.error);
    if (failed) alert(`Couldn't reorder: ${failed.error.message}`);
    loadList();
  }

  async function loadList() {
    let query = supabase.from(section.table).select("*").order(section.orderBy);
    if (sortable) query = query.order("id"); // a fixed tie-breaker, so the order never jumps around
    const { data, error } = await query;
    if (error) {
      listMount.innerHTML = `<p style="color:var(--red);font-size:13px;">${escapeHtml(error.message)}</p>`;
      return;
    }
    rowsById = Object.fromEntries(data.map((r) => [r.id, r]));
    maxOrder = data.reduce((m, r) => Math.max(m, r.sort_order ?? 0), 0);
    minOrder = data.reduce((m, r) => Math.min(m, r.sort_order ?? 0), 0);

    const canMove = sortable && data.length > 1;
    listMount.innerHTML =
      data
        .map(
          (row, idx) => `
      <div class="list-row" data-row="${row.id}" style="cursor:default;">
        <div class="row-body"><p class="row-title" style="font-weight:500;">${escapeHtml(section.listLabel(row))}</p></div>
        ${
          canMove
            ? `<div class="move-btns">
                 <button class="icon-btn admin-move" data-id="${row.id}" data-dir="-1" aria-label="Move up" ${idx === 0 ? "disabled" : ""}>${ICON_UP}</button>
                 <button class="icon-btn admin-move" data-id="${row.id}" data-dir="1" aria-label="Move down" ${idx === data.length - 1 ? "disabled" : ""}>${ICON_DOWN}</button>
               </div>`
            : ""
        }
        <button class="icon-btn admin-edit" data-id="${row.id}" aria-label="Edit" style="width:32px;height:32px;">${ICON_PENCIL}</button>
        <button class="icon-btn admin-delete" data-id="${row.id}" aria-label="Delete" style="width:32px;height:32px;">${ICON_X}</button>
      </div>`
        )
        .join("") || `<p style="color:var(--text-dim);font-size:13px;">Nothing posted yet.</p>`;

    listMount.querySelectorAll(".admin-edit").forEach((btn) => {
      btn.addEventListener("click", () => startEdit(rowsById[btn.dataset.id]));
    });
    listMount.querySelectorAll(".admin-move").forEach((btn) => {
      btn.addEventListener("click", () => moveRow(btn.dataset.id, Number(btn.dataset.dir)));
    });
    listMount.querySelectorAll(".admin-delete").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this?")) return;
        const { error: delError } = await supabase.from(section.table).delete().eq("id", btn.dataset.id);
        if (delError) {
          alert(`Couldn't delete: ${delError.message}`);
          return;
        }
        if (editingId === btn.dataset.id) exitEdit();
        loadList();
      });
    });
  }

  if (section.fileField) {
    const fileInput = wrap.querySelector(`[data-file-for="${section.fileField.key}"]`);
    const uploadStatus = wrap.querySelector(".upload-status");
    const urlInput = form.querySelector(`[name="${section.fileField.key}"]`);
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files[0];
      if (!file) return;
      uploadStatus.textContent = "Uploading…";
      try {
        const url = await uploadFile(file, section.fileField.folder);
        urlInput.value = url;
        uploadStatus.textContent = "Uploaded — link filled in above.";
      } catch (err) {
        uploadStatus.textContent = `Upload failed: ${err.message}`;
      }
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    statusEl.textContent = "";

    // ---- Saving changes to an existing item ---------------------------------
    if (editingId) {
      const changes = {};
      section.fields.forEach((f) => {
        const v = form.elements[f.key].value.trim();
        changes[f.key] = v === "" ? null : castValue(f, v); // clearing an optional field really clears it
      });
      submitBtn.disabled = true;
      submitBtn.textContent = "Saving…";
      const { data: updated, error } = await supabase.from(section.table).update(changes).eq("id", editingId).select();
      submitBtn.disabled = false;
      if (error) {
        submitBtn.textContent = "Save changes";
        alert(`Couldn't save: ${error.message}`);
        return;
      }
      if (!updated || !updated.length) {
        submitBtn.textContent = "Save changes";
        alert("Nothing was changed — this account may not be allowed to edit that.");
        return;
      }
      exitEdit();
      statusEl.textContent = "Changes saved.";
      loadList();
      return;
    }

    // ---- Posting something new ---------------------------------------------
    // Empty optional fields are left out entirely so the database's own
    // defaults apply (e.g. "today" for dates) instead of failing on "".
    const payload = {};
    section.fields.forEach((f) => {
      const v = form.elements[f.key].value.trim();
      if (v === "") return;
      payload[f.key] = castValue(f, v);
    });
    if (section.autoOrder === "start") payload.sort_order = minOrder - 1;
    else if (section.autoOrder) payload.sort_order = maxOrder + 1;

    submitBtn.disabled = true;
    submitBtn.textContent = "Posting…";
    const { data: inserted, error } = await supabase.from(section.table).insert(payload).select().single();
    submitBtn.disabled = false;
    submitBtn.textContent = "Post";

    if (error) {
      alert(`Couldn't post: ${error.message}`);
      return;
    }

    let message = "Posted.";
    const notifyBox = form.querySelector(".notify-box");
    if (section.notify && notifyBox && notifyBox.checked) {
      try {
        const push = await sendBroadcast(section.notify.build(inserted || payload));
        message = `Posted. ${describePush(push)}`;
      } catch (err) {
        message = `Posted, but the notification didn't go out: ${err.message}`;
      }
    }

    form.reset();
    statusEl.textContent = message;
    loadList();
  });

  loadList();
  return wrap;
}

function renderMediaLiveSection() {
  const wrap = document.createElement("div");
  wrap.className = "card";
  wrap.style.marginBottom = "24px";
  wrap.innerHTML = `
    <h2 class="section-title" style="margin-top:0;">Media Live</h2>
    <div class="toggle-row" style="margin-bottom:12px;">
      <div><div class="t-title">Currently live</div></div>
      <div class="switch" data-live-toggle></div>
    </div>
    <div class="auth-field">
      <input class="auth-input" type="text" id="live-stream-url" placeholder="Live stream link (YouTube Live, etc.)">
    </div>
    <div class="auth-field">
      <input class="auth-input" type="text" id="live-schedule" placeholder="Schedule text (e.g. Sundays 9 & 11 am)">
    </div>
    <button class="btn btn-primary" id="live-save" style="width:100%;padding:13px;">Save</button>
    <p class="post-status" id="live-status"></p>
  `;

  let wasLive = false;

  (async () => {
    const { data } = await supabase.from("media_live").select("*").eq("id", 1).maybeSingle();
    if (data) {
      wasLive = !!data.is_live;
      wrap.querySelector("[data-live-toggle]").classList.toggle("on", data.is_live);
      wrap.querySelector("#live-stream-url").value = data.stream_url || "";
      wrap.querySelector("#live-schedule").value = data.schedule_text || "";
    }
  })();

  wrap.querySelector("[data-live-toggle]").addEventListener("click", (e) => {
    e.currentTarget.classList.toggle("on");
  });

  wrap.querySelector("#live-save").addEventListener("click", async () => {
    const btn = wrap.querySelector("#live-save");
    const statusEl = wrap.querySelector("#live-status");
    const nowLive = wrap.querySelector("[data-live-toggle]").classList.contains("on");
    statusEl.textContent = "";
    btn.disabled = true;
    btn.textContent = "Saving…";
    const { error } = await supabase
      .from("media_live")
      .update({
        is_live: nowLive,
        stream_url: wrap.querySelector("#live-stream-url").value.trim(),
        schedule_text: wrap.querySelector("#live-schedule").value.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);
    btn.disabled = false;
    btn.textContent = "Save";
    if (error) {
      alert(`Couldn't save: ${error.message}`);
      return;
    }

    let message = "Saved.";
    // Going live is the one moment worth buzzing phones — but ask first.
    if (nowLive && !wasLive && confirm("You just went live. Send members a \u201cWe\u2019re live\u201d notification?")) {
      try {
        const push = await sendBroadcast({
          title: "We\u2019re live now",
          body: "Join the service online.",
          url: "media.html",
          category: "live",
        });
        message = `Saved. ${describePush(push)}`;
      } catch (err) {
        message = `Saved, but the notification didn't go out: ${err.message}`;
      }
    }
    wasLive = nowLive;
    statusEl.textContent = message;
  });

  return wrap;
}

const SITE_FIELDS = [
  { key: "hero_tag", label: "Home banner tag (e.g. LIVE SUNDAY)", type: "text" },
  { key: "hero_headline", label: "Home banner headline", type: "textarea" },
  { key: "service_times", label: "Service times (shown under the countdown)", type: "text" },
  { key: "service_address", label: "Church address", type: "text" },
  { key: "service_day", label: "Countdown counts down to which day?", type: "select" },
  { key: "service_hour", label: "Countdown hour (0–23, so 9 = 9:00 am, 17 = 5:00 pm)", type: "number" },
  { key: "quick_giving_text", label: "Quick giving message on Home", type: "textarea" },
  { key: "quick_giving_cta", label: "Quick giving button text", type: "text" },
  { key: "contact_email", label: "Church office email (shown in Help)", type: "email", optional: true },
  { key: "contact_phone", label: "Church office phone (optional)", type: "tel", optional: true },
];

function renderSiteSettingsSection() {
  const wrap = document.createElement("div");
  wrap.className = "card";
  wrap.style.marginBottom = "24px";

  const controls = SITE_FIELDS.map((f) => {
    const req = f.optional ? "" : "required";
    let control;
    if (f.type === "textarea") {
      control = `<textarea class="amount-input" style="border-radius:var(--radius-md); min-height:70px; font-weight:400; font-size:14.5px;" name="${f.key}" ${req}></textarea>`;
    } else if (f.type === "select") {
      control = `<select class="auth-input" name="${f.key}">${DAYS.map((d, i) => `<option value="${i}">${d}</option>`).join("")}</select>`;
    } else {
      const extra = f.type === "number" ? ' min="0" max="23" inputmode="numeric"' : "";
      control = `<input class="auth-input" type="${f.type}" name="${f.key}" ${req}${extra}>`;
    }
    return `<div class="auth-field"><label>${escapeHtml(f.label)}</label>${control}</div>`;
  }).join("");

  wrap.innerHTML = `
    <h2 class="section-title" style="margin-top:0;">Home &amp; Contact Details</h2>
    <p class="post-status" style="margin:-8px 0 14px;">The wording on the Home banner, service times, address, quick giving, and the office's contact details.</p>
    <form class="admin-form">
      ${controls}
      <button class="btn btn-primary" type="submit" style="width:100%;padding:13px;">Save</button>
      <p class="post-status form-status"></p>
    </form>
  `;

  const form = wrap.querySelector(".admin-form");
  const statusEl = wrap.querySelector(".form-status");

  (async () => {
    const { data, error } = await supabase.from("site_settings").select("*").eq("id", 1).maybeSingle();
    if (error) {
      statusEl.textContent = `Run supabase-static-content.sql first (${error.message}).`;
      return;
    }
    if (data) SITE_FIELDS.forEach((f) => (form.elements[f.key].value = data[f.key] ?? ""));
  })();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button[type=submit]");
    const payload = { id: 1, updated_at: new Date().toISOString() };
    SITE_FIELDS.forEach((f) => {
      const v = form.elements[f.key].value.trim();
      if (f.type === "number" || f.type === "select") payload[f.key] = Number(v);
      else payload[f.key] = v === "" && f.optional ? null : v;
    });

    btn.disabled = true;
    btn.textContent = "Saving…";
    const { error } = await supabase.from("site_settings").upsert(payload);
    btn.disabled = false;
    btn.textContent = "Save";
    statusEl.textContent = error ? `Couldn't save: ${error.message}` : "Saved. It's live on the Home page now.";
  });

  return wrap;
}

const LINK_OPTIONS = [
  ["index.html", "Home"],
  ["events.html", "Events"],
  ["bible.html", "Bible"],
  ["media.html", "Media"],
  ["give.html", "Give"],
  ["be-involved.html", "Be Involved"],
  ["discipleship.html", "Discipleship"],
];
const CATEGORY_OPTIONS = [
  ["general", "General — reaches everyone"],
  ["live", "Live service"],
  ["verse", "Verse"],
  ["devotion", "Devotion"],
  ["ministry", "Ministry news"],
];

function renderSendNotificationSection() {
  const wrap = document.createElement("div");
  wrap.className = "card";
  wrap.style.marginBottom = "24px";
  wrap.innerHTML = `
    <h2 class="section-title" style="margin-top:0;">Send a Notification</h2>
    <p class="post-status" style="margin:-8px 0 14px;">Appears in every member's bell, and as a phone alert for anyone who has push turned on. Members can mute every type except "General".</p>
    <form class="admin-form">
      <div class="auth-field"><input class="auth-input" name="title" placeholder="Title" maxlength="80" required></div>
      <div class="auth-field"><textarea class="amount-input" style="border-radius:var(--radius-md); min-height:70px; font-weight:400; font-size:14.5px;" name="body" placeholder="Message (optional)" maxlength="240"></textarea></div>
      <div class="auth-field"><label>Tapping it opens</label>
        <select class="auth-input" name="url">${LINK_OPTIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></div>
      <div class="auth-field"><label>Type</label>
        <select class="auth-input" name="category">${CATEGORY_OPTIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></div>
      <button class="btn btn-primary" type="submit" style="width:100%;padding:13px;">Send</button>
      <p class="post-status form-status"></p>
    </form>
    <h3 style="font-size:14px;margin:18px 0 10px;color:var(--text-dim);">Recently sent</h3>
    <div class="admin-list"></div>
  `;

  const form = wrap.querySelector(".admin-form");
  const statusEl = wrap.querySelector(".form-status");
  const listMount = wrap.querySelector(".admin-list");

  async function loadRecent() {
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .is("user_id", null)
      .order("created_at", { ascending: false })
      .limit(8);
    if (error) {
      listMount.innerHTML = `<p style="color:var(--red);font-size:13px;">${escapeHtml(error.message)}</p>`;
      return;
    }
    listMount.innerHTML =
      data
        .map(
          (n) => `
      <div class="list-row" style="cursor:default;">
        <div class="row-body">
          <p class="row-title" style="font-weight:600;">${escapeHtml(n.title)}</p>
          <p class="row-sub">${escapeHtml(n.category)} · ${timeAgo(n.created_at)}</p>
        </div>
        <button class="icon-btn admin-delete" data-id="${n.id}" aria-label="Delete" style="width:32px;height:32px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>`
        )
        .join("") || `<p style="color:var(--text-dim);font-size:13px;">Nothing sent yet.</p>`;

    listMount.querySelectorAll(".admin-delete").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Remove this notification from everyone's list?")) return;
        const { error: delError } = await supabase.from("notifications").delete().eq("id", btn.dataset.id);
        if (delError) {
          alert(`Couldn't delete: ${delError.message}`);
          return;
        }
        loadRecent();
      });
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    btn.textContent = "Sending…";
    statusEl.textContent = "";
    try {
      const push = await sendBroadcast({
        title: form.elements.title.value.trim(),
        body: form.elements.body.value.trim(),
        url: form.elements.url.value,
        category: form.elements.category.value,
      });
      statusEl.textContent = describePush(push);
      form.reset();
      loadRecent();
    } catch (err) {
      statusEl.textContent = `Couldn't send: ${err.message}`;
    }
    btn.disabled = false;
    btn.textContent = "Send";
  });

  loadRecent();
  return wrap;
}

function renderPrayerInboxSection() {
  const wrap = document.createElement("div");
  wrap.className = "card";
  wrap.style.marginBottom = "24px";
  wrap.innerHTML = `
    <h2 class="section-title" style="margin-top:0;">Prayer Requests</h2>
    <p style="color:var(--text-dim);font-size:13.5px;margin:-8px 0 14px;">Every request submitted across the app, newest first.</p>
    <div class="admin-list"></div>
  `;
  const listMount = wrap.querySelector(".admin-list");

  async function loadList() {
    const { data, error } = await supabase
      .from("prayer_requests")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      listMount.innerHTML = `<p style="color:var(--red);font-size:13px;">${escapeHtml(error.message)}</p>`;
      return;
    }
    if (!data.length) {
      listMount.innerHTML = `<p style="color:var(--text-dim);font-size:13px;">No prayer requests yet.</p>`;
      return;
    }

    // prayer_requests.user_id points at auth.users, not profiles directly,
    // so PostgREST can't auto-join them — fetch names separately and merge.
    const userIds = [...new Set(data.map((r) => r.user_id))];
    const { data: profilesData } = await supabase.from("profiles").select("id, name").in("id", userIds);
    const nameById = Object.fromEntries((profilesData || []).map((p) => [p.id, p.name]));

    listMount.innerHTML = data
      .map(
        (row) => `
      <div class="list-row" style="cursor:default;align-items:flex-start;">
        <div class="row-body">
          <p class="row-title" style="font-weight:500;line-height:1.4;">${escapeHtml(row.content)}</p>
          <p class="row-sub">${escapeHtml(nameById[row.user_id] || "Someone")} · ${timeAgo(row.created_at)}${row.prayed ? " · Prayed ✓" : ""}</p>
        </div>
        <button class="chip" data-prayed="${row.id}" data-current="${row.prayed}" style="padding:6px 12px;flex-shrink:0;">
          ${row.prayed ? "Undo" : "Mark prayed"}
        </button>
      </div>`
      )
      .join("");

    listMount.querySelectorAll("[data-prayed]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const current = btn.dataset.current === "true";
        btn.disabled = true;
        const { error: updError } = await supabase
          .from("prayer_requests")
          .update({ prayed: !current })
          .eq("id", btn.dataset.prayed);
        btn.disabled = false;
        if (updError) {
          alert(`Couldn't update: ${updError.message}`);
          return;
        }
        loadList();
      });
    });
  }

  loadList();
  return wrap;
}

function renderApplicationsSection() {
  const wrap = document.createElement("div");
  wrap.className = "card";
  wrap.style.marginBottom = "24px";
  wrap.innerHTML = `
    <h2 class="section-title" style="margin-top:0;">Applications</h2>
    <p style="color:var(--text-dim);font-size:13.5px;margin:-8px 0 14px;">Discipleship, Be Involved and Serve in the Church sign-ups, newest first.</p>
    <div class="admin-list"></div>
  `;
  const listMount = wrap.querySelector(".admin-list");

  async function loadList() {
    const { data, error } = await supabase
      .from("applications")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      listMount.innerHTML = `<p style="color:var(--red);font-size:13px;">${escapeHtml(error.message)}</p>`;
      return;
    }
    if (!data.length) {
      listMount.innerHTML = `<p style="color:var(--text-dim);font-size:13px;">No applications yet.</p>`;
      return;
    }

    listMount.innerHTML = data
      .map(
        (row) => `
      <div class="list-row" style="cursor:default;align-items:flex-start;">
        <div class="row-body">
          <p class="row-title" style="font-weight:700;">${escapeHtml(row.item_name)} <span style="font-weight:500;color:var(--text-dim);">(${escapeHtml(row.category)})</span></p>
          <p class="row-sub" style="margin-bottom:4px;">${escapeHtml(row.name)} · ${escapeHtml(row.email)}${row.phone ? " · " + escapeHtml(row.phone) : ""}${row.location ? " · " + escapeHtml(row.location) : ""}</p>
          <p class="row-sub" style="font-style:italic;">"${escapeHtml(row.reason)}"</p>
          <p class="row-sub" style="margin-top:4px;">${timeAgo(row.created_at)}${row.status === "reviewed" ? " · Reviewed ✓" : ""}</p>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;">
          <button class="chip" data-review="${row.id}" data-current="${row.status}" style="padding:6px 12px;">
            ${row.status === "reviewed" ? "Undo" : "Mark reviewed"}
          </button>
          <button class="icon-btn admin-delete-app" data-id="${row.id}" aria-label="Delete" style="width:32px;height:32px;align-self:center;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
      </div>`
      )
      .join("");

    listMount.querySelectorAll("[data-review]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const current = btn.dataset.current;
        btn.disabled = true;
        const { error: updError } = await supabase
          .from("applications")
          .update({ status: current === "reviewed" ? "new" : "reviewed" })
          .eq("id", btn.dataset.review);
        btn.disabled = false;
        if (updError) {
          alert(`Couldn't update: ${updError.message}`);
          return;
        }
        loadList();
      });
    });

    listMount.querySelectorAll(".admin-delete-app").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this application?")) return;
        const { error: delError } = await supabase.from("applications").delete().eq("id", btn.dataset.id);
        if (delError) {
          alert(`Couldn't delete: ${delError.message}`);
          return;
        }
        loadList();
      });
    });
  }

  loadList();
  return wrap;
}

export async function renderAdmin() {
  const authUser = await requireAuth();
  if (!authUser) return;

  bootApp({ back: true, backHref: "profile.html", rightIcon: null, title: "Admin" });

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, is_pastor")
    .eq("id", authUser.id)
    .maybeSingle();

  const contentMount = document.getElementById("admin-content");
  const isAdmin = !!profile?.is_admin;
  const isPastor = !!profile?.is_pastor;

  if (!isAdmin && !isPastor) {
    contentMount.innerHTML = `<p style="color:var(--text-dim);">You don't have admin or pastor access on this account.</p>`;
    return;
  }

  contentMount.innerHTML = "";

  // Both roles can send notifications.
  contentMount.appendChild(renderSendNotificationSection());

  if (isPastor) {
    contentMount.appendChild(renderPrayerInboxSection());
  }
  if (isAdmin) {
    contentMount.appendChild(renderApplicationsSection());
    contentMount.appendChild(renderMediaLiveSection());
    contentMount.appendChild(renderSiteSettingsSection());
  }

  SECTIONS.forEach((section) => {
    const allowed = section.roles.some((r) => (r === "admin" && isAdmin) || (r === "pastor" && isPastor));
    if (allowed) contentMount.appendChild(renderSection(section));
  });
}
