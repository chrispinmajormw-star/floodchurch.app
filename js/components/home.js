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

  startCountdown(home.service.nextServiceHour);
}
