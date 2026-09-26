// components/admin.js — a single config-driven dashboard covering both
// roles: Admins get Announcements/Events/Conferences/Sermons/Podcasts/
// Media Live; Pastors get the Prayer Requests inbox, Today's Devotion,
// and Verse of the Day. Devotions can be posted by either role.
import { bootApp } from "../App.js";
import { requireAuth } from "../auth.js";
import { supabase } from "../supabaseClient.js";

const SECTIONS = [
  {
    table: "announcements",
    title: "Announcements",
    roles: ["admin"],
    orderBy: "sort_order",
    fields: [{ key: "content", label: "Announcement text", type: "textarea" }],
    listLabel: (row) => row.content,
  },
  {
    table: "events",
    title: "Upcoming Events",
    roles: ["admin"],
    orderBy: "event_date",
    fields: [
      { key: "title", label: "Title", type: "text" },
      { key: "event_date", label: "Date & time", type: "datetime-local" },
      { key: "location", label: "Location", type: "text", optional: true },
      { key: "description", label: "Full details (optional)", type: "textarea", optional: true },
    ],
    listLabel: (row) => `${row.title} — ${new Date(row.event_date).toLocaleString()}`,
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
      { key: "devotion_date", label: "Date", type: "date" },
    ],
    listLabel: (row) => `${row.title} (${row.devotion_date})`,
  },
  {
    table: "verse_of_day",
    title: "Verse of the Day",
    roles: ["admin", "pastor"],
    orderBy: "verse_date",
    fields: [
      { key: "text", label: "Verse text", type: "textarea" },
      { key: "reference", label: "Reference (e.g. Isaiah 43:19)", type: "text" },
      { key: "verse_date", label: "Date", type: "date" },
    ],
    listLabel: (row) => `${row.reference} (${row.verse_date})`,
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
  },
  {
    table: "ministries",
    title: "Serve in the Church",
    roles: ["admin"],
    orderBy: "sort_order",
    fields: [
      { key: "name", label: "Team name (e.g. Media Team)", type: "text" },
      { key: "link", label: "Registration form link (paste once the pastor sends it)", type: "text", optional: true },
    ],
    listLabel: (row) => `${row.name}${row.link ? " — has a form link" : " — no form link yet"}`,
  },
];

function fieldInput(field) {
  if (field.type === "textarea") {
    return `<textarea class="amount-input" style="border-radius:var(--radius-md); min-height:80px; font-weight:400; font-size:14.5px;" name="${field.key}" placeholder="${field.label}" ${field.optional ? "" : "required"}></textarea>`;
  }
  return `<input class="auth-input" type="${field.type}" name="${field.key}" placeholder="${field.label}" value="${field.default || ""}" ${field.type === "text" && !field.optional ? "required" : ""}>`;
}

async function uploadFile(file, folder) {
  const path = `${folder}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const { error } = await supabase.storage.from("media").upload(path, file);
  if (error) throw error;
  const { data } = supabase.storage.from("media").getPublicUrl(path);
  return data.publicUrl;
}

function renderSection(section) {
  const wrap = document.createElement("div");
  wrap.className = "card";
  wrap.style.marginBottom = "24px";
  wrap.innerHTML = `
    <h2 class="section-title" style="margin-top:0;">${section.title}</h2>
    <form class="admin-form">
      ${section.fields.map((f) => `<div class="auth-field">${fieldInput(f)}</div>`).join("")}
      ${
        section.fileField
          ? `<div class="auth-field">
               <label style="display:block;font-size:13px;font-weight:600;color:var(--text-dim);margin-bottom:8px;">Or upload a file</label>
               <input class="auth-input" type="file" accept="${section.fileField.accept}" data-file-for="${section.fileField.key}">
               <p class="upload-status" style="font-size:12.5px;color:var(--text-dim);margin-top:6px;"></p>
             </div>`
          : ""
      }
      <button class="btn btn-primary" type="submit" style="width:100%;padding:13px;">Post</button>
    </form>
    <div class="admin-list" style="margin-top:18px;"></div>
  `;

  const form = wrap.querySelector(".admin-form");
  const listMount = wrap.querySelector(".admin-list");

  async function loadList() {
    const { data, error } = await supabase.from(section.table).select("*").order(section.orderBy);
    if (error) {
      listMount.innerHTML = `<p style="color:var(--red);font-size:13px;">${error.message}</p>`;
      return;
    }
    listMount.innerHTML = data
      .map(
        (row) => `
      <div class="list-row" style="cursor:default;">
        <div class="row-body"><p class="row-title" style="font-weight:500;">${section.listLabel(row)}</p></div>
        <button class="icon-btn admin-delete" data-id="${row.id}" aria-label="Delete" style="width:32px;height:32px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>`
      )
      .join("") || `<p style="color:var(--text-dim);font-size:13px;">Nothing posted yet.</p>`;

    listMount.querySelectorAll(".admin-delete").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this?")) return;
        const { error: delError } = await supabase.from(section.table).delete().eq("id", btn.dataset.id);
        if (delError) {
          alert(`Couldn't delete: ${delError.message}`);
          return;
        }
        loadList();
      });
    });
  }

  if (section.fileField) {
    const fileInput = wrap.querySelector(`[data-file-for="${section.fileField.key}"]`);
    const statusEl = wrap.querySelector(".upload-status");
    const urlInput = form.querySelector(`[name="${section.fileField.key}"]`);
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files[0];
      if (!file) return;
      statusEl.textContent = "Uploading…";
      try {
        const url = await uploadFile(file, section.fileField.folder);
        urlInput.value = url;
        statusEl.textContent = "Uploaded — link filled in above.";
      } catch (err) {
        statusEl.textContent = `Upload failed: ${err.message}`;
      }
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector("button[type=submit]");
    const payload = {};
    section.fields.forEach((f) => {
      payload[f.key] = form.elements[f.key].value.trim();
    });

    submitBtn.disabled = true;
    submitBtn.textContent = "Posting…";
    const { error } = await supabase.from(section.table).insert(payload);
    submitBtn.disabled = false;
    submitBtn.textContent = "Post";

    if (error) {
      alert(`Couldn't post: ${error.message}`);
      return;
    }
    form.reset();
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
  `;

  (async () => {
    const { data } = await supabase.from("media_live").select("*").eq("id", 1).maybeSingle();
    if (data) {
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
    btn.disabled = true;
    btn.textContent = "Saving…";
    const { error } = await supabase
      .from("media_live")
      .update({
        is_live: wrap.querySelector("[data-live-toggle]").classList.contains("on"),
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
    alert("Saved.");
  });

  return wrap;
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins || 1}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
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
      listMount.innerHTML = `<p style="color:var(--red);font-size:13px;">${error.message}</p>`;
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
          <p class="row-title" style="font-weight:500;line-height:1.4;">${row.content}</p>
          <p class="row-sub">${nameById[row.user_id] || "Someone"} · ${timeAgo(row.created_at)}${row.prayed ? " · Prayed ✓" : ""}</p>
        </div>
        <button class="chip" data-prayed="${row.id}" data-current="${row.prayed}" style="padding:6px 12px;flex-shrink:0;">
          ${row.prayed ? "Undo" : "Mark prayed"}
        </button>
      </div>`
      )
      .join("");

    listMount.querySelectorAll("[data-prayed]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.prayed;
        const current = btn.dataset.current === "true";
        btn.disabled = true;
        const { error: updError } = await supabase
          .from("prayer_requests")
          .update({ prayed: !current })
          .eq("id", id);
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

  if (isPastor) {
    contentMount.appendChild(renderPrayerInboxSection());
  }
  if (isAdmin) {
    contentMount.appendChild(renderMediaLiveSection());
  }

  SECTIONS.forEach((section) => {
    const allowed = section.roles.some((r) => (r === "admin" && isAdmin) || (r === "pastor" && isPastor));
    if (allowed) contentMount.appendChild(renderSection(section));
  });
}
