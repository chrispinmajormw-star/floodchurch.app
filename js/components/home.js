// components/home.js — renders Home. Static bits (quick actions, fallback verse)
// come from data/home.json; the banner text, service times, address and quick
// giving copy come from the dashboard-managed site_settings table; and
// everything else (devotion, sermons, events, conference, podcasts,
// announcements, ministries, live status, verse of the day) is live Supabase data.
import { bootApp, loadData } from "../App.js";
import { ICONS } from "../icons.js";
import { requireAuth } from "../auth.js";
import { supabase } from "../supabaseClient.js";
import { getSiteSettings } from "../site-settings.js";
import { escapeHtml, safeUrl } from "../util.js";
import { youtubeThumbnail } from "../player.js";
import { nextOccurrence, countdownText } from "../schedule.js";
import { getPushStatus, enablePush } from "../push.js";

function nextServiceDate(day, hour) {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, 0, 0, 0);
  const dayDiff = (day - now.getDay() + 7) % 7;
  target.setDate(now.getDate() + dayDiff);
  if (target <= now) target.setDate(target.getDate() + 7);
  return target;
}

/** `getTarget()` returns the moment of the next service; the countdown re-checks it every second. */
function startCountdown(getTarget) {
  const el = document.getElementById("countdown");
  function tick() {
    el.textContent = countdownText(getTarget() - new Date());
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

// A handful of gradients to cycle through since sermons carry no thumbnail
// once they're posted from the admin dashboard.
const THUMB_GRADIENTS = [
  "linear-gradient(160deg, #1fb6c9, #0a4a52)",
  "linear-gradient(160deg, #a8500f, #241205)",
  "linear-gradient(160deg, #6b4fd6, #1c1240)",
  "linear-gradient(160deg, #2f8bff, #0b1d3a)",
];

const PUSH_NUDGE_KEY = "flood-push-nudge";
const PUSH_NUDGE_QUIET_DAYS = 14;

/**
 * A one-tap invitation to switch on phone alerts. Shown only when this phone can receive them and
 * hasn't, and not again for two weeks after "Not now". (If someone taps Block in the phone's own
 * prompt, the app stops asking: the phone itself then says "blocked".)
 */
async function offerPush(authUser) {
  try {
    const last = Number(localStorage.getItem(PUSH_NUDGE_KEY));
    if (last && Date.now() - last < PUSH_NUDGE_QUIET_DAYS * 86400000) return;
    if ((await getPushStatus()) !== "disabled") return;
  } catch (e) {
    return;
  }
  const hero = document.querySelector(".hero");
  if (!hero || document.getElementById("home-push-banner")) return;

  const banner = document.createElement("div");
  banner.className = "push-banner";
  banner.id = "home-push-banner";
  banner.style.display = "flex";
  banner.innerHTML = `
    <div class="push-banner-text">
      <b>Get alerts on your phone</b>
      <span>Know when we go live, when a new message is posted, and when there\u2019s news from the church.</span>
    </div>
    <div class="push-banner-actions">
      <button class="btn btn-primary" id="home-push-on">Turn on</button>
      <button class="push-banner-dismiss" id="home-push-later">Not now</button>
    </div>`;
  hero.before(banner);

  document.getElementById("home-push-later").addEventListener("click", () => {
    localStorage.setItem(PUSH_NUDGE_KEY, String(Date.now()));
    banner.remove();
  });
  const onBtn = document.getElementById("home-push-on");
  onBtn.addEventListener("click", async () => {
    onBtn.disabled = true;
    onBtn.textContent = "Turning on\u2026";
    try {
      await enablePush(authUser.id);
      banner.innerHTML = `<div class="push-banner-text"><b>You\u2019re all set</b><span>Alerts are on for this phone.</span></div>`;
      setTimeout(() => banner.remove(), 3500);
    } catch (err) {
      localStorage.setItem(PUSH_NUDGE_KEY, String(Date.now()));
      onBtn.disabled = false;
      onBtn.textContent = "Turn on";
      alert(err.message);
    }
  });
}

/** A real YouTube picture when the sermon is a YouTube link, otherwise a coloured gradient. */
function thumbBackground(sermon, i) {
  const picture = youtubeThumbnail(sermon.video_url);
  const gradient = THUMB_GRADIENTS[i % THUMB_GRADIENTS.length];
  return picture ? `url('${picture}') center/cover no-repeat, ${gradient}` : gradient;
}

export async function renderHome() {
  const authUser = await requireAuth();
  if (!authUser) return; // requireAuth already redirected to login.html

  bootApp({ rightIcon: "bell" });

  const [
    home,
    site,
    profileRes,
    devotionRes,
    sermonsRes,
    eventsRes,
    conferenceRes,
    podcastsRes,
    announcementsRes,
    ministriesRes,
    liveRes,
    scheduleRes,
    verseRes,
  ] = await Promise.all([
    loadData("data/home.json"),
    getSiteSettings(),
    supabase.from("profiles").select("name").eq("id", authUser.id).maybeSingle(),
    supabase.from("devotions").select("*").order("devotion_date", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("sermons").select("*").order("created_at", { ascending: false }).limit(2),
    supabase.from("events").select("*").gte("event_date", new Date().toISOString()).order("event_date").limit(2),
    supabase.from("conferences").select("*").eq("active", true).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("podcasts").select("*").order("created_at", { ascending: false }).limit(2),
    supabase.from("announcements").select("*").order("sort_order"),
    supabase.from("ministries").select("*").order("sort_order"),
    supabase.from("media_live").select("*").eq("id", 1).maybeSingle(),
    supabase.from("live_schedule").select("*"),
    supabase.from("verse_of_day").select("*").order("verse_date", { ascending: false }).limit(1).maybeSingle(),
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

  // Hero — text comes from site settings, but the badge and Watch Live button
  // reflect the real media_live row.
  const live = liveRes.data;
  document.getElementById("hero-tag").textContent = live?.is_live ? "LIVE NOW" : site.hero_tag;
  document.getElementById("hero-headline").textContent = site.hero_headline;
  const watchLiveBtn = document.getElementById("watch-live-btn");
  if (watchLiveBtn) {
    // The Live TV page shows the stream when we're live, and the countdown + schedule when we're not.
    watchLiveBtn.onclick = () => {
      location.href = "live.html";
    };
  }

  const serviceMeta = document.getElementById("service-meta");
  serviceMeta.innerHTML = `${escapeHtml(site.service_times)}<br>${escapeHtml(site.service_address)}`;

  const verse = verseRes.data || home.verseOfDay;
  document.getElementById("verse-text").textContent = `\u201c${verse.text}\u201d \u2014 ${verse.reference}`;

  // Today's devotion
  const d = devotionRes.data;
  document.getElementById("devotion-card").innerHTML = d
    ? `<h3>${escapeHtml(d.title)}</h3>
       <p><b>${escapeHtml(d.reference || "")}:</b> ${escapeHtml(d.body)}</p>
       <div class="devotion-meta">
         <span class="devotion-date">${escapeHtml(d.devotion_date)}</span>
         ${d.tag ? `<span class="tag-pill">${escapeHtml(d.tag)}</span>` : ""}
       </div>`
    : `<p style="color:var(--text-dim);font-size:14px;">No devotion posted yet.</p>`;

  // Recent sermons
  const sermons = sermonsRes.data || [];
  document.getElementById("sermon-grid").innerHTML =
    sermons
      .map(
        (s, i) => `
      <div class="sermon-card" data-title="${escapeHtml(s.title)}">
        <a class="sermon-play" href="watch.html?kind=sermon&id=${encodeURIComponent(s.id)}" aria-label="Play ${escapeHtml(s.title)}">
          <div class="sermon-thumb" style="background:${thumbBackground(s, i)}">
            <span class="sermon-playicon">${ICONS.playFilled}</span>
            ${s.duration ? `<span class="sermon-duration">${escapeHtml(s.duration)}</span>` : ""}
          </div>
        </a>
        <button class="sermon-save" aria-label="Save sermon" data-title="${escapeHtml(s.title)}">${ICONS.bookmark}</button>
        <p class="sermon-title">${escapeHtml(s.title)}</p>
        <p class="sermon-sub">${escapeHtml(s.speaker || "")}</p>
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
      <a class="event-row" href="events.html?id=${escapeHtml(e.id)}" style="text-decoration:none;color:inherit;">
        <div>
          <p class="e-title">${escapeHtml(e.title)}</p>
          <p class="e-sub">${escapeHtml(new Date(e.event_date).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }))}${e.location ? " · " + escapeHtml(e.location) : ""}</p>
        </div>
        <div class="chevron">${ICONS.chevron}</div>
      </a>`
      )
      .join("") || `<p style="color:var(--text-dim);font-size:14px;">No upcoming events.</p>`;

  // Conference banner
  const c = conferenceRes.data;
  const bannerMount = document.getElementById("conference-banner");
  if (c) {
    bannerMount.style.display = "";
    const ctaUrl = safeUrl(c.cta_link);
    bannerMount.innerHTML = `
      <div class="eyebrow">${escapeHtml(c.eyebrow || "")}</div>
      <h3>${escapeHtml(c.title)}</h3>
      <p>${escapeHtml(c.dates || "")}</p>
      ${ctaUrl ? `<button class="btn-dark" id="conference-cta">${escapeHtml(c.cta_text || "Register")}</button>` : ""}`;
    const ctaBtn = document.getElementById("conference-cta");
    if (ctaBtn) ctaBtn.addEventListener("click", () => window.open(ctaUrl, "_blank"));
  } else {
    bannerMount.style.display = "none";
  }

  // Quick giving (copy from site settings, destination is always the Give page)
  document.getElementById("quick-giving-text").textContent = site.quick_giving_text;
  const qgBtn = document.getElementById("quick-giving-btn");
  qgBtn.textContent = site.quick_giving_cta;
  qgBtn.addEventListener("click", () => (location.href = "give.html"));

  // Podcasts
  const podcasts = podcastsRes.data || [];
  document.getElementById("home-podcasts").innerHTML =
    podcasts
      .map(
        (p, i) => `
      <a class="podcast-row" href="watch.html?kind=podcast&id=${encodeURIComponent(p.id)}" style="text-decoration:none;color:inherit;">
        <div class="mic">${ICONS.mic}</div>
        <div>
          <div class="p-title">${escapeHtml(p.title)}</div>
          <div class="p-sub">${escapeHtml(p.sub || "")}</div>
        </div>
        <div class="play">${ICONS.playFilled}</div>
      </a>`
      )
      .join("") || `<p style="color:var(--text-dim);font-size:14px;padding:12px 4px;">No podcasts posted yet.</p>`;

  // Announcements
  const announcements = announcementsRes.data || [];
  document.getElementById("announcements").innerHTML =
    announcements
      .map(
        (a) => `
      <div class="announcement-row">
        <div class="announcement-icon">${ICONS.bell}</div>
        <p class="announcement-text">${escapeHtml(a.content)}</p>
      </div>`
      )
      .join("") || `<p style="color:var(--text-dim);font-size:14px;">No announcements right now.</p>`;

  // Ministries
  const ministries = ministriesRes.data || [];
  document.getElementById("home-ministries").innerHTML = ministries
    .map((m) => `<div class="ministry-chip">${escapeHtml(m.name)}</div>`)
    .join("");

  // Count down to the next service on the weekly schedule (falls back to the Home & Contact Details setting).
  const schedule = scheduleRes.error ? [] : scheduleRes.data || [];
  startCountdown(() => (schedule.length ? nextOccurrence(schedule).date : nextServiceDate(site.service_day, site.service_hour)));

  offerPush(authUser); // not awaited: it must never hold up the page
}
