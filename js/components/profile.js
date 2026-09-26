// components/profile.js — renders the Profile page from the signed-in user's
// Supabase profile + activity, plus the church's ministries table.
import { bootApp } from "../App.js";
import { ICONS } from "../icons.js";
import { requireAuth } from "../auth.js";
import { supabase } from "../supabaseClient.js";

const LIST_ROWS = [
  { key: "giving", title: "Giving history", icon: "heart", href: "giving-history.html" },
  { key: "prayer", title: "Prayer requests", icon: "pray", href: "prayer.html" },
  { key: "sermons", title: "Saved sermons", icon: "bookmark", href: "saved-sermons.html" },
  { key: "downloads", title: "Downloads", icon: "downloads", href: "downloads.html" },
  { key: "ministries", title: "Ministries", icon: "ministries", href: "#" },
];

function formatMWK(amount) {
  if (amount >= 1000) return `MWK ${Math.round(amount / 1000)}k`;
  return `MWK ${amount}`;
}

export async function renderProfile() {
  const authUser = await requireAuth();
  if (!authUser) return;

  bootApp({ rightIcon: "gear", rightHref: "settings.html" });

  const [ministriesRes, profileRes, giftsRes, sermonsRes, plansRes] = await Promise.all([
    supabase.from("ministries").select("*").order("sort_order"),
    supabase.from("profiles").select("*").eq("id", authUser.id).maybeSingle(),
    supabase.from("gifts").select("amount").eq("user_id", authUser.id),
    supabase.from("saved_sermons").select("id", { count: "exact", head: true }).eq("user_id", authUser.id),
    supabase.from("reading_plan_progress").select("id").eq("user_id", authUser.id).gt("percent", 0),
  ]);

  const profile = profileRes.data || {
    name: authUser.email.split("@")[0],
    member_id: "—",
    group_name: "",
    team: "",
    avatar_initial: authUser.email[0].toUpperCase(),
  };

  const totalGiven = (giftsRes.data || []).reduce((sum, g) => sum + Number(g.amount), 0);
  const savedCount = sermonsRes.count ?? 0;

  document.getElementById("avatar").textContent = profile.avatar_initial;
  document.getElementById("profile-name").textContent = profile.name;
  document.getElementById("member-id").textContent = `Member ID \u00b7 ${profile.member_id}`;
  document.getElementById("tag-line").innerHTML = [profile.group_name, profile.team]
    .filter(Boolean)
    .join('<span class="sep">&middot;</span>');

  document.getElementById("stat-given").textContent = formatMWK(totalGiven);
  document.getElementById("stat-saved").textContent = savedCount;
  document.getElementById("stat-plans").textContent = plansRes.data?.length ?? 0;

  const listMount = document.getElementById("profile-list");
  const rows = [...LIST_ROWS];
  if (profile.is_admin || profile.is_pastor) {
    rows.push({ key: "admin", title: "Admin dashboard", icon: "gear", href: "admin.html" });
  }
  listMount.innerHTML = rows
    .map(
      (row) => `
    <a class="list-row" href="${row.href}">
      <div class="row-icon">${ICONS[row.icon]}</div>
      <div class="row-body"><p class="row-title">${row.title}</p></div>
      <div class="chevron">${ICONS.chevron}</div>
    </a>`
    )
    .join("");

  const ministryMount = document.getElementById("ministry-grid");
  const ministries = ministriesRes.data || [];
  ministryMount.innerHTML = ministries
    .map((m) =>
      m.link
        ? `<a class="list-row" href="${m.link}" target="_blank" rel="noopener">
             <div class="row-body"><p class="row-title">${m.name}</p></div>
             <div class="chevron">${ICONS.chevron}</div>
           </a>`
        : `<div class="list-row" style="cursor:pointer;" data-noform="${m.name}">
             <div class="row-body"><p class="row-title">${m.name}</p></div>
             <div class="chevron">${ICONS.chevron}</div>
           </div>`
    )
    .join("");

  ministryMount.querySelectorAll("[data-noform]").forEach((el) => {
    el.addEventListener("click", () => {
      alert(`Registration for ${el.dataset.noform} isn't open yet — check back soon.`);
    });
  });
}
