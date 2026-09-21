// components/home.js — renders the Home page from data/home.json + data/user.json
import { bootApp, loadData } from "../App.js";
import { ICONS } from "../icons.js";

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

export async function renderHome() {
  bootApp({ rightIcon: "bell" });

  const [home, user] = await Promise.all([
    loadData("data/home.json"),
    loadData("data/user.json"),
  ]);

  document.getElementById("user-name").textContent = user.name;

  const quickGrid = document.getElementById("quick-grid");
  quickGrid.innerHTML = home.quickActions
    .map(
      (item) => `<a class="quick-item" href="${item.link}">
        ${ICONS[item.icon]}
        ${item.label}
      </a>`
    )
    .join("");

  document.getElementById("hero-tag").textContent = home.hero.tag;
  document.getElementById("hero-headline").textContent = home.hero.headline;
  document.getElementById("service-meta").innerHTML = `${home.service.days.join(
    " &middot; "
  )}<br>${home.service.address}`;
  document.getElementById("verse-text").textContent = `\u201c${home.verseOfDay.text}\u201d \u2014 ${home.verseOfDay.reference}`;

  // Today's devotion
  const d = home.devotion;
  document.getElementById("devotion-card").innerHTML = `
    <h3>${d.title}</h3>
    <p><b>${d.reference}:</b> ${d.text}</p>
    <div class="devotion-meta">
      <span class="devotion-date">${d.date}</span>
      <span class="tag-pill">${d.tag}</span>
    </div>`;

  // Recent sermons
  document.getElementById("sermon-grid").innerHTML = home.sermons
    .map(
      (s) => `
      <div class="sermon-card">
        <div class="sermon-thumb" style="background:${s.thumbGradient}">
          <span class="sermon-duration">${s.duration}</span>
        </div>
        <p class="sermon-title">${s.title}</p>
        <p class="sermon-sub">${s.speaker}</p>
      </div>`
    )
    .join("");

  // Upcoming events
  document.getElementById("event-list").innerHTML = home.events
    .map(
      (e) => `
      <div class="event-row">
        <div>
          <p class="e-title">${e.title}</p>
          <p class="e-sub">${e.when}</p>
        </div>
        <div class="chevron">${ICONS.chevron}</div>
      </div>`
    )
    .join("");

  // Conference banner
  const c = home.conference;
  document.getElementById("conference-banner").innerHTML = `
    <div class="eyebrow">${c.eyebrow}</div>
    <h3>${c.title}</h3>
    <p>${c.dates}</p>
    <button class="btn-dark" onclick="location.href='${c.link}'">${c.cta}</button>`;

  // Quick giving
  const qg = home.quickGiving;
  document.getElementById("quick-giving-text").textContent = qg.text;
  const qgBtn = document.getElementById("quick-giving-btn");
  qgBtn.textContent = qg.cta;
  qgBtn.addEventListener("click", () => (location.href = qg.link));

  // Podcast
  document.getElementById("home-podcasts").innerHTML = home.podcasts
    .map(
      (p) => `
      <div class="podcast-row">
        <div class="mic">${ICONS.mic}</div>
        <div>
          <div class="p-title">${p.title}</div>
          <div class="p-sub">${p.sub}</div>
        </div>
        <div class="play">${ICONS.playFilled}</div>
      </div>`
    )
    .join("");

  // Announcements
  document.getElementById("announcements").innerHTML = home.announcements
    .map((text) => `<div class="announcement-row">${text}</div>`)
    .join("");

  // Ministries
  document.getElementById("home-ministries").innerHTML = home.ministries
    .map((name) => `<div class="ministry-chip">${name}</div>`)
    .join("");

  startCountdown(home.service.nextServiceHour);
}
