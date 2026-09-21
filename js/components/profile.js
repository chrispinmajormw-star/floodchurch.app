// components/profile.js — renders the Profile page from the signed-in user's
// Supabase profile + activity, plus the church's static ministry directory.
import { bootApp, loadData } from "../App.js";
import { ICONS } from "../icons.js";
import { requireAuth } from "../auth.js";
import { supabase } from "../supabaseClient.js";

const LIST_ROWS = [
  { key: "giving", title: "Giving history", icon: "heart" },
  { key: "prayer", title: "Prayer requests", icon: "pray" },
  { key: "sermons", title: "Saved sermons", icon: "bookmark" },
  { key: "downloads", title: "Downloads", icon: "downloads" },
  { key: "ministries", title: "Ministries", icon: "ministries" },
];

function formatMWK(amount) {
  if (amount >= 1000) return `MWK ${Math.round(amount / 1000)}k`;
  return `MWK ${amount}`;
}

export async function renderProfile() {
  const authUser = await requireAuth();
  if (!authUser) return;

  bootApp({ rightIcon: "gear", rightHref: "settings.html" });

  const [directory, profileRes, giftsRes, sermonsRes] = await Promise.all([
    loadData("data/user.json"), // static church directory (ministries + leaders)
    supabase.from("profiles").select("*").eq("id", authUser.id).maybeSingle(),
    supabase.from("gifts").select("amount").eq("user_id", authUser.id),
    supabase.from("saved_sermons").select("id", { count: "exact", head: true }).eq("user_id", authUser.id),
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
  document.getElementById("stat-plans").textContent = "0"; // wire to a reading_plans table when that's built

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
  ministryMount.innerHTML = directory.ministries
    .map(
      (m) => `<div class="ministry-pill"><b>${m.name}</b> &middot; ${m.leader}</div>`
    )
    .join("");
}
