// components/home.js — renders Home from data/home.json (static bits: hero,
// service times, verse of day, quick actions) plus LIVE Supabase content:
// devotion, sermons, events, conference banner, podcasts, announcements,
// ministries, and the live-stream state.
import { bootApp, loadData } from "../App.js";
import { ICONS } from "../icons.js";
import { requireAuth } from "../auth.js";
import { supabase } from "../supabaseClient.js";

function nextServiceDate(hour) {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, 0, 0, 0);
  const dayDiff = (7 - now.getDay()) % 7;
  target.setDate(now.getDate() + dayDiff);
  if (target <= now) target.setDate(target.getDate() + 7);
  return target;
}

function startCountdown(hour) {
  const el = document.getElementById("countdown");
  function tick() {
    const diff = nextServiceDate(hour) - new Date();
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    el.textContent = `${d}d ${h}h ${m}m ${s}s`;
  }
  tick();
  setInterval(tick, 1000);
}

function greetingForHour() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning,";
  if (h < 17) return "Good afternoon,";
  return "Good evening,";
}

// A handful of gradients to cycle through since sermons no longer carry a
// hardcoded thumbGradient field once they're posted from the admin dashboard.
const THUMB_GRADIENTS = [
  "linear-gradient(160deg, #1fb6c9, #0a4a52)",
  "linear-gradient(160deg, #a8500f, #241205)",
  "linear-gradient(160deg, #6b4fd6, #1c1240)",
  "linear-gradient(160deg, #2f8bff, #0b1d3a)",
];

export async function renderHome() {
  const authUser = await requireAuth();
  if (!authUser) return; // requireAuth already redirected to login.html

  bootApp({ rightIcon: "bell" });

  const [
    home,
    profileRes,
    devotionRes,
    sermonsRes,
    eventsRes,
    conferenceRes,
    podcastsRes,
    announcementsRes,
    ministriesRes,
    liveRes,
  ] = await Promise.all([
    loadData("data/home.json"),
    supabase.from("profiles").select("name").eq("id", authUser.id).maybeSingle(),
    supabase.from("devotions").select("*").order("devotion_date", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("sermons").select("*").order("created_at", { ascending: false }).limit(2),
    supabase.from("events").select("*").gte("event_date", new Date().toISOString()).order("event_date").limit(2),
    supabase.from("conferences").select("*").eq("active", true).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("podcasts").select("*").order("created_at", { ascending: false }).limit(2),
    supabase.from("announcements").select("*").order("sort_order"),
    supabase.from("ministries").select("*").order("sort_order"),
    supabase.from("media_live").select("*").eq("id", 1).maybeSingle(),
  ]);

  const displayName = profileRes.data?.name || authUser.email.split("@")[0];
  document.getElementById("user-name").textContent = displayName;
  document.getElementById("greeting-text").textContent = greetingForHour();

  const quickGrid = document.getElementById("quick-grid");
  quickGrid.innerHTML = home.quickActions
    .map(
      (item) => `<a class="quick-item" href="${item.link}">
        ${ICONS[item.icon]}
        ${item.label}
      </a>`
    )
    .join("");

  // Hero — headline stays static, but the LIVE badge and Watch Live button
  // reflect the real media_live row.
  const live = liveRes.data;
  document.getElementById("hero-tag").textContent = live?.is_live ? "LIVE NOW" : home.hero.tag;
  document.getElementById("hero-headline").textContent = home.hero.headline;
  const watchLiveBtn = document.getElementById("watch-live-btn");
  if (watchLiveBtn) {
    watchLiveBtn.onclick = () => {
      if (live?.is_live && live.stream_url) {
        window.open(live.stream_url, "_blank");
      } else {
        location.href = "media.html";
      }
    };
  }

  document.getElementById("service-meta").innerHTML = `${home.service.days.join(
    " &middot; "
  )}<br>${home.service.address}`;
  document.getElementById("verse-text").textContent = `\u201c${home.verseOfDay.text}\u201d \u2014 ${home.verseOfDay.reference}`;

  // Today's devotion
  const d = devotionRes.data;
  document.getElementById("devotion-card").innerHTML = d
    ? `<h3>${d.title}</h3>
       <p><b>${d.reference || ""}:</b> ${d.body}</p>
       <div class="devotion-meta">
         <span class="devotion-date">${d.devotion_date}</span>
         ${d.tag ? `<span class="tag-pill">${d.tag}</span>` : ""}
       </div>`
    : `<p style="color:var(--text-dim);font-size:14px;">No devotion posted yet.</p>`;

  // Recent sermons
  const sermons = sermonsRes.data || [];
  document.getElementById("sermon-grid").innerHTML =
    sermons
      .map(
        (s, i) => `
      <div class="sermon-card" data-title="${s.title}">
        <a href="${s.video_url}" target="_blank" rel="noopener">
          <div class="sermon-thumb" style="background:${THUMB_GRADIENTS[i % THUMB_GRADIENTS.length]}">
            ${s.duration ? `<span class="sermon-duration">${s.duration}</span>` : ""}
          </div>
        </a>
        <button class="sermon-save" aria-label="Save sermon" data-title="${s.title}">${ICONS.bookmark}</button>
        <p class="sermon-title">${s.title}</p>
        <p class="sermon-sub">${s.speaker || ""}</p>
      </div>`
      )
      .join("") || `<p style="color:var(--text-dim);font-size:14px;">No sermons posted yet.</p>`;

  document.querySelectorAll(".sermon-save").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const title = btn.dataset.title;
      btn.disabled = true;
      const { error } = await supabase
        .from("saved_sermons")
        .insert({ user_id: authUser.id, sermon_title: title });
      btn.disabled = false;
      if (error) {
        alert(`Couldn't save "${title}": ${error.message}`);
        return;
      }
      btn.classList.add("saved");
    });
  });

  // Upcoming events
  const events = eventsRes.data || [];
  document.getElementById("event-list").innerHTML =
    events
      .map(
        (e) => `
      <div class="event-row">
        <div>
          <p class="e-title">${e.title}</p>
          <p class="e-sub">${new Date(e.event_date).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}${e.location ? " · " + e.location : ""}</p>
        </div>
        <div class="chevron">${ICONS.chevron}</div>
      </div>`
      )
      .join("") || `<p style="color:var(--text-dim);font-size:14px;">No upcoming events.</p>`;

  // Conference banner
  const c = conferenceRes.data;
  const bannerMount = document.getElementById("conference-banner");
  if (c) {
    bannerMount.style.display = "";
    bannerMount.innerHTML = `
      <div class="eyebrow">${c.eyebrow || ""}</div>
      <h3>${c.title}</h3>
      <p>${c.dates || ""}</p>
      ${c.cta_link ? `<button class="btn-dark" onclick="window.open('${c.cta_link}','_blank')">${c.cta_text || "Register"}</button>` : ""}`;
  } else {
    bannerMount.style.display = "none";
  }

  // Quick giving (static copy, real destination)
  const qg = home.quickGiving;
  document.getElementById("quick-giving-text").textContent = qg.text;
  const qgBtn = document.getElementById("quick-giving-btn");
  qgBtn.textContent = qg.cta;
  qgBtn.addEventListener("click", () => (location.href = qg.link));

  // Podcasts
  const podcasts = podcastsRes.data || [];
  document.getElementById("home-podcasts").innerHTML =
    podcasts
      .map(
        (p) => `
      <a class="podcast-row" href="${p.audio_url}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit;">
        <div class="mic">${ICONS.mic}</div>
        <div>
          <div class="p-title">${p.title}</div>
          <div class="p-sub">${p.sub || ""}</div>
        </div>
        <div class="play">${ICONS.playFilled}</div>
      </a>`
      )
      .join("") || `<p style="color:var(--text-dim);font-size:14px;padding:12px 4px;">No podcasts posted yet.</p>`;

  // Announcements
  const announcements = announcementsRes.data || [];
  document.getElementById("announcements").innerHTML =
    announcements.map((a) => `<div class="announcement-row">${a.content}</div>`).join("") ||
    `<p style="color:var(--text-dim);font-size:14px;">No announcements right now.</p>`;

  // Ministries
  const ministries = ministriesRes.data || [];
  document.getElementById("home-ministries").innerHTML = ministries
    .map((m) => `<div class="ministry-chip">${m.name}</div>`)
    .join("");

  startCountdown(home.service.nextServiceHour);
}
