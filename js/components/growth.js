// components/growth.js — Growth Groups: your groups, and how to find and join one.
//
//   1. "Your groups"      the groups you are in, like a chat list (latest message, unread count)
//   2. "Find a group"     choose your LOCATION, then pick a group there and join it (you land straight in its chat)
//   3. "Manage" (pastors and admins only)   add / rename / remove locations and groups
//
// Growth Groups need an account, so this page uses requireAuth (a visitor is sent to the friendly sign-in screen).
import { bootApp } from "../App.js";
import { requireAuth } from "../auth.js";
import { supabase } from "../supabaseClient.js";
import { ICONS } from "../icons.js";
import { escapeHtml } from "../util.js";
import { hueOf, initialOf, listTime, previewText, groupUrl } from "../growth-util.js";

const LOCATION_KEY = "flood-growth-location"; // the location this phone looked at last

/** A plain-English reason for a failed request. */
export function friendlyGrowthError(error) {
  const msg = String((error && error.message) || error || "");
  const code = error && error.code;
  if (/row-level security|permission denied|jwt/i.test(msg)) return "Only pastors and admins can do that.";
  if (code === "23505" || /duplicate key/i.test(msg)) return "That name is already used there.";
  if (code === "23503" || /foreign key/i.test(msg)) return "Remove the groups in this location first.";
  if (/failed to fetch|network|load failed/i.test(msg)) return "Couldn't reach the server. Check your connection and try again.";
  return "Something went wrong. Please try again.";
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export async function renderGrowth() {
  const user = await requireAuth();
  if (!user) return;
  bootApp({ back: true, backHref: "index.html", rightIcon: null, title: "Growth Groups" });
  const root = document.getElementById("growth-root");

  const st = { mine: [], locations: [], countByLocation: new Map(), groupsByLocation: new Map(), staff: false, chosen: null, groupsHere: null, loadingHere: false, notice: "", manageOpen: false, failed: false };

  // ------------------------------------------------------------------ loading
  async function load() {
    let results;
    try {
      results = await Promise.all([
        supabase.rpc("growth_my_groups"),
        supabase.from("growth_locations").select("*").order("sort_order", { ascending: true }).order("name", { ascending: true }),
        supabase.from("growth_groups").select("*").order("name", { ascending: true }),
        supabase.from("profiles").select("is_admin, is_pastor").eq("id", user.id).maybeSingle(),
      ]);
    } catch (e) {
      st.failed = true;
      return;
    }
    const [mineRes, locRes, groupRes, profRes] = results;
    if (locRes.error || groupRes.error) {
      st.failed = true;
      return;
    }
    st.failed = false;
    st.mine = mineRes.data || [];
    st.locations = locRes.data || [];
    st.countByLocation = new Map();
    st.groupsByLocation = new Map();
    for (const g of groupRes.data || []) {
      st.countByLocation.set(g.location_id, (st.countByLocation.get(g.location_id) || 0) + 1);
      st.groupsByLocation.set(g.location_id, [...(st.groupsByLocation.get(g.location_id) || []), g]);
    }
    st.staff = Boolean(profRes.data?.is_admin || profRes.data?.is_pastor);
  }

  async function openLocation(id) {
    st.chosen = id;
    st.groupsHere = null;
    st.loadingHere = true;
    st.notice = "";
    try {
      localStorage.setItem(LOCATION_KEY, id);
    } catch (e) {
      /* it just won't be remembered */
    }
    render();
    const { data, error } = await supabase.rpc("growth_groups_at", { loc: id });
    if (st.chosen !== id) return; // they chose another place meanwhile
    st.loadingHere = false;
    if (error) st.notice = friendlyGrowthError(error);
    st.groupsHere = data || [];
    render();
  }

  // ------------------------------------------------------------------ drawing
  function myGroupsHTML() {
    if (!st.mine.length) return "";
    return `
      <h2 class="section-title">Your groups</h2>
      <div class="chat-list" id="my-groups">
        ${st.mine
          .map(
            (g) => `
          <a class="chat-row" href="${escapeHtml(groupUrl(g.group_id))}" data-group="${escapeHtml(g.group_id)}">
            <span class="avatar avatar-lg" style="--hue:${hueOf(g.name)}" aria-hidden="true">${escapeHtml(initialOf(g.name))}</span>
            <span class="chat-row-main">
              <span class="chat-row-top"><b class="chat-row-name">${escapeHtml(g.name)}</b><time class="chat-row-time">${escapeHtml(listTime(g.last_at))}</time></span>
              <span class="chat-row-sub">${ICONS.pin}${escapeHtml(g.location_name)}${g.role === "leader" ? ' · <span class="leader-tag">Leader</span>' : ""}</span>
              <span class="chat-row-bottom"><span class="chat-row-preview">${escapeHtml(previewText(g))}</span>${g.unread > 0 ? `<span class="unread-badge" aria-label="${g.unread} unread">${g.unread > 99 ? "99+" : g.unread}</span>` : ""}</span>
            </span>
          </a>`
          )
          .join("")}
      </div>`;
  }

  function findHTML() {
    const heading = st.mine.length ? "Join another group" : "Find your Growth Group";
    const intro = st.mine.length
      ? "Choose a location to see its groups."
      : "Growth Groups are small groups in your area. Join one to chat, pray together and get your group's announcements.";
    if (!st.locations.length) {
      return `
        <section class="find-card">
          <h2 class="section-title">${heading}</h2>
          <p class="find-empty">No Growth Groups have been set up yet. Please check back soon.</p>
        </section>`;
    }
    if (!st.chosen) {
      return `
        <section class="find-card">
          <h2 class="section-title">${heading}</h2>
          <p class="find-intro">${escapeHtml(intro)}</p>
          <p class="find-step">Step 1: choose your location</p>
          <div class="location-list">
            ${st.locations
              .map(
                (l) => `
              <button type="button" class="location-row" data-action="open-location" data-id="${escapeHtml(l.id)}">
                <span class="location-icon">${ICONS.pin}</span>
                <span class="location-name">${escapeHtml(l.name)}</span>
                <span class="location-count">${plural(st.countByLocation.get(l.id) || 0, "group", "groups")}</span>
                <span class="chevron">${ICONS.chevron}</span>
              </button>`
              )
              .join("")}
          </div>
        </section>`;
    }
    const place = st.locations.find((l) => l.id === st.chosen);
    const here = st.groupsHere;
    return `
      <section class="find-card">
        <h2 class="section-title">${heading}</h2>
        <button type="button" class="find-back" data-action="back-locations">${ICONS.back}<span>All locations</span></button>
        <p class="find-step">Step 2: pick your group in <b>${escapeHtml(place ? place.name : "this location")}</b></p>
        ${st.notice ? `<p class="growth-notice" role="alert">${escapeHtml(st.notice)}</p>` : ""}
        ${
          st.loadingHere || here === null
            ? '<p class="find-empty">Loading groups…</p>'
            : here.length
              ? `<div class="group-list">${here
                  .map(
                    (g) => `
                <div class="group-card" data-group="${escapeHtml(g.id)}">
                  <span class="avatar avatar-lg" style="--hue:${hueOf(g.name)}" aria-hidden="true">${escapeHtml(initialOf(g.name))}</span>
                  <div class="group-card-main">
                    <b>${escapeHtml(g.name)}</b>
                    ${g.description ? `<span class="group-card-desc">${escapeHtml(g.description)}</span>` : ""}
                    <span class="group-card-count">${ICONS.users}${plural(g.member_count, "member", "members")}</span>
                  </div>
                  ${
                    g.joined
                      ? `<a class="btn btn-outline group-card-btn" href="${escapeHtml(groupUrl(g.id))}" data-action="open">Open</a>`
                      : `<button type="button" class="btn btn-primary group-card-btn" data-action="join" data-id="${escapeHtml(g.id)}">Join</button>`
                  }
                </div>`
                  )
                  .join("")}</div>`
              : '<p class="find-empty">No groups in this location yet. Please ask your pastor to add one.</p>'
        }
      </section>`;
  }

  function manageHTML() {
    if (!st.staff) return "";
    const options = st.locations.map((l) => `<option value="${escapeHtml(l.id)}">${escapeHtml(l.name)}</option>`).join("");
    return `
      <details class="manage-panel" id="manage-panel"${st.manageOpen ? " open" : ""}>
        <summary>${ICONS.gear}<span>Manage Growth Groups</span></summary>
        <p class="manage-hint">Only pastors and admins see this. Add the locations first, then the groups inside them. To make someone a leader, they join the group, then open it and use "Group info".</p>
        <form class="manage-form" data-form="add-location">
          <label for="new-location">New location</label>
          <div class="manage-row"><input class="auth-input" id="new-location" name="name" maxlength="60" placeholder="e.g. Area 47" required><button class="btn btn-primary" type="submit">Add</button></div>
        </form>
        <form class="manage-form" data-form="add-group">
          <label for="new-group">New group</label>
          <select class="auth-input" id="new-group-location" name="location_id" required${st.locations.length ? "" : " disabled"}>${options || '<option value="">Add a location first</option>'}</select>
          <input class="auth-input" id="new-group" name="name" maxlength="60" placeholder="Group name" required>
          <input class="auth-input" name="description" maxlength="300" placeholder="A short description (optional)">
          <button class="btn btn-primary" type="submit"${st.locations.length ? "" : " disabled"}>Add group</button>
        </form>
        <p id="manage-notice" class="growth-notice" role="alert"${st.notice && st.manageOpen ? "" : " hidden"}>${escapeHtml(st.notice)}</p>
        <div class="manage-list">
          ${st.locations
            .map(
              (l) => `
            <div class="manage-location" data-location="${escapeHtml(l.id)}">
              <div class="manage-item">
                <b>${escapeHtml(l.name)}</b>
                <span class="manage-tools">
                  <button type="button" class="icon-tool" data-action="rename-location" data-id="${escapeHtml(l.id)}" aria-label="Rename ${escapeHtml(l.name)}">${ICONS.pencil}</button>
                  <button type="button" class="icon-tool" data-action="delete-location" data-id="${escapeHtml(l.id)}" aria-label="Delete ${escapeHtml(l.name)}">${ICONS.trash}</button>
                </span>
              </div>
              ${(st.groupsByLocation.get(l.id) || [])
                .map(
                  (g) => `
                <div class="manage-item manage-group" data-group="${escapeHtml(g.id)}">
                  <a href="${escapeHtml(groupUrl(g.id))}">${escapeHtml(g.name)}</a>
                  <span class="manage-tools">
                    <button type="button" class="icon-tool" data-action="rename-group" data-id="${escapeHtml(g.id)}" aria-label="Rename ${escapeHtml(g.name)}">${ICONS.pencil}</button>
                    <button type="button" class="icon-tool" data-action="delete-group" data-id="${escapeHtml(g.id)}" aria-label="Delete ${escapeHtml(g.name)}">${ICONS.trash}</button>
                  </span>
                </div>`
                )
                .join("")}
            </div>`
            )
            .join("")}
        </div>
      </details>`;
  }

  function render() {
    if (st.failed) {
      root.innerHTML = `
        <p class="find-empty">Couldn't load Growth Groups. Check your connection and try again.</p>
        <button type="button" class="btn btn-outline" data-action="retry">Try again</button>`;
      return;
    }
    const notice = st.notice && !st.manageOpen && !st.chosen ? `<p class="growth-notice" role="alert">${escapeHtml(st.notice)}</p>` : "";
    root.innerHTML = notice + myGroupsHTML() + findHTML() + manageHTML();
  }

  // ------------------------------------------------------------------ actions
  async function reloadAndRender() {
    await load();
    if (st.chosen && !st.locations.some((l) => l.id === st.chosen)) st.chosen = null;
    render();
    if (st.chosen) openLocation(st.chosen);
  }

  async function join(id, btn) {
    btn.disabled = true;
    btn.textContent = "Joining…";
    const { error } = await supabase.from("growth_members").insert({ group_id: id, user_id: user.id });
    if (error && error.code !== "23505") {
      st.notice = friendlyGrowthError(error);
      render();
      return;
    }
    location.href = groupUrl(id); // straight into the chat, like joining a WhatsApp group
  }

  async function staffDo(promise) {
    st.manageOpen = true; // whatever they just did, the panel stays open to show the result
    const { error } = await promise;
    st.notice = error ? friendlyGrowthError(error) : "";
    await reloadAndRender();
  }

  root.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn || !root.contains(btn)) return;
    const { action, id } = btn.dataset;
    if (action === "open-location") openLocation(id);
    else if (action === "back-locations") {
      st.chosen = null;
      st.notice = "";
      render();
    } else if (action === "join") join(id, btn);
    else if (action === "retry") {
      await load();
      render();
    } else if (action === "rename-location") {
      const l = st.locations.find((x) => x.id === id);
      const name = window.prompt("New name for this location", l ? l.name : "");
      if (name && name.trim()) staffDo(supabase.from("growth_locations").update({ name: name.trim() }).eq("id", id));
    } else if (action === "delete-location") {
      const l = st.locations.find((x) => x.id === id);
      if (window.confirm(`Delete the location "${l ? l.name : ""}"? It must have no groups.`)) staffDo(supabase.from("growth_locations").delete().eq("id", id));
    } else if (action === "rename-group") {
      const g = [...st.groupsByLocation.values()].flat().find((x) => x.id === id);
      const name = window.prompt("New name for this group", g ? g.name : "");
      if (name && name.trim()) staffDo(supabase.from("growth_groups").update({ name: name.trim() }).eq("id", id));
    } else if (action === "delete-group") {
      const g = [...st.groupsByLocation.values()].flat().find((x) => x.id === id);
      if (window.confirm(`Delete the group "${g ? g.name : ""}" and all of its messages? This can't be undone.`)) staffDo(supabase.from("growth_groups").delete().eq("id", id));
    }
  });

  root.addEventListener("submit", (e) => {
    const form = e.target.closest("form[data-form]");
    if (!form) return;
    e.preventDefault();
    const field = (n) => String((form.elements[n] && form.elements[n].value) || "").trim();
    st.manageOpen = true;
    if (form.dataset.form === "add-location") {
      const name = field("name");
      if (name) staffDo(supabase.from("growth_locations").insert({ name, sort_order: st.locations.length + 1 }));
    } else if (form.dataset.form === "add-group") {
      const name = field("name");
      const description = field("description");
      const location_id = field("location_id");
      if (name && location_id) staffDo(supabase.from("growth_groups").insert({ location_id, name, description: description || null }));
    }
  });

  root.addEventListener("toggle", (e) => {
    if (e.target.id === "manage-panel") st.manageOpen = e.target.open;
  }, true);

  // ------------------------------------------------------------------ go
  root.innerHTML = '<p class="find-empty">Loading…</p>';
  await load();
  let remembered = null;
  try {
    remembered = localStorage.getItem(LOCATION_KEY);
  } catch (e) {
    /* nothing remembered */
  }
  // First visit with no group yet: go straight to the groups in the location they looked at last time.
  if (!st.failed && !st.mine.length && remembered && st.locations.some((l) => l.id === remembered)) {
    st.chosen = remembered;
    render();
    openLocation(remembered);
    return;
  }
  render();
}
