// components/profile.js — renders the Profile page from data/user.json
import { bootApp, loadData } from "../App.js";
import { ICONS } from "../icons.js";

const LIST_ROWS = [
  { key: "giving", title: "Giving history", icon: "heart" },
  { key: "prayer", title: "Prayer requests", icon: "pray" },
  { key: "sermons", title: "Saved sermons", icon: "bookmark" },
  { key: "downloads", title: "Downloads", icon: "downloads" },
  { key: "ministries", title: "Ministries", icon: "ministries" },
];

export async function renderProfile() {
  bootApp({ rightIcon: "gear", rightHref: "settings.html" });

  const user = await loadData("data/user.json");

  document.getElementById("avatar").textContent = user.avatarInitial;
  document.getElementById("profile-name").textContent = user.name;
  document.getElementById("member-id").textContent = `Member ID \u00b7 ${user.memberId}`;
  document.getElementById(
    "tag-line"
  ).innerHTML = `${user.group}<span class="sep">&middot;</span>${user.team}`;

  document.getElementById("stat-given").textContent = user.stats.given;
  document.getElementById("stat-saved").textContent = user.stats.saved;
  document.getElementById("stat-plans").textContent = user.stats.plans;

  const listMount = document.getElementById("profile-list");
  listMount.innerHTML = LIST_ROWS.map(
    (row) => `
    <div class="list-row">
      <div class="row-icon">${ICONS[row.icon]}</div>
      <div class="row-body"><p class="row-title">${row.title}</p></div>
      <div class="chevron">${ICONS.chevron}</div>
    </div>`
  ).join("");

  const ministryMount = document.getElementById("ministry-grid");
  ministryMount.innerHTML = user.ministries
    .map(
      (m) => `<div class="ministry-pill"><b>${m.name}</b> &middot; ${m.leader}</div>`
    )
    .join("");
}
