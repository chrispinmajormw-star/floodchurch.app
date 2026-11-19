// components/downloads.js — audio saved on THIS phone (so it plays with no internet), with sizes,
// tap-to-play and remove. It works offline: the list lives on the phone, not on the server.
// Older "saved for later" bookmarks from before real downloads existed are kept in a second list.
import { bootApp } from "../App.js";
import { ICONS } from "../icons.js";
import { requireAuth } from "../auth.js";
import { supabase } from "../supabaseClient.js";
import { savedList, verifyIndex, removeAudio, removeAllAudio, totalBytes, formatBytes } from "../offline-audio.js";
import { escapeHtml } from "../util.js";

const KIND_LABEL = { sermon: "Sermon", podcast: "Podcast" };

function deviceRowHTML(d) {
  const href = d.id ? `watch.html?kind=${encodeURIComponent(d.kind)}&id=${encodeURIComponent(d.id)}` : "";
  const sub = [KIND_LABEL[d.kind] || "Audio", formatBytes(d.bytes)].join(" \u00b7 ");
  const main = `<div class="row-icon">${ICONS.mic}</div>
      <div class="row-body"><p class="row-title">${escapeHtml(d.title)}</p><p class="row-sub">${escapeHtml(sub)}</p></div>`;
  return `<div class="list-row dl-row" data-url="${escapeHtml(d.url)}">
    ${href ? `<a class="dl-main" href="${escapeHtml(href)}">${main}</a>` : `<div class="dl-main">${main}</div>`}
    <button class="icon-btn dl-remove" aria-label="Remove ${escapeHtml(d.title)} from this phone" style="width:36px;height:36px;flex-shrink:0;">${ICONS.trash}</button>
  </div>`;
}

export async function renderDownloads() {
  const authUser = await requireAuth();
  if (!authUser) return;

  bootApp({ back: true, backHref: "profile.html", rightIcon: null, title: "Downloads" });

  const listMount = document.getElementById("downloads-list");
  const emptyMsg = document.getElementById("downloads-empty");
  let legacyRows = []; // older bookmarks (title only) from the downloads table

  function render() {
    const device = savedList();
    const onPhone = new Set(device.map((d) => d.title));
    const later = legacyRows.filter((r) => !onPhone.has(r.title));

    const parts = [];
    if (device.length) {
      parts.push(`<div class="downloads-summary">
          <div><b>${device.length} download${device.length === 1 ? "" : "s"}</b><span>${formatBytes(totalBytes())} on this phone</span></div>
          <button class="chip" id="dl-clear">Remove all</button>
        </div>`);
      parts.push(device.map(deviceRowHTML).join(""));
    }
    if (later.length) {
      parts.push(`<div class="settings-group"><p class="group-label">Saved for later</p>${later
        .map(
          (r) => `<div class="list-row later-row" data-id="${escapeHtml(r.id)}">
            <div class="row-icon">${ICONS.bookmark}</div>
            <div class="row-body"><p class="row-title">${escapeHtml(r.title)}</p><p class="row-sub">${r.podcastId ? "Tap to open, then Download" : "Not on this phone yet"}</p></div>
            ${r.podcastId ? `<a class="icon-btn" href="watch.html?kind=podcast&id=${encodeURIComponent(r.podcastId)}" aria-label="Open" style="width:36px;height:36px;">${ICONS.chevron}</a>` : ""}
            <button class="icon-btn later-remove" aria-label="Remove" style="width:36px;height:36px;flex-shrink:0;">${ICONS.trash}</button>
          </div>`
        )
        .join("")}</div>`);
    }
    listMount.innerHTML = parts.join("");
    emptyMsg.style.display = device.length || later.length ? "none" : "block";
  }

  // Remove buttons (one handler for the whole list)
  listMount.addEventListener("click", async (e) => {
    const clear = e.target.closest("#dl-clear");
    if (clear) {
      if (confirm(`Remove all ${savedList().length} downloads from this phone?`)) {
        await removeAllAudio();
        render();
      }
      return;
    }
    const rm = e.target.closest(".dl-remove");
    if (rm) {
      const row = rm.closest(".dl-row");
      const entry = savedList().find((d) => d.url === row.dataset.url);
      if (entry && confirm(`Remove \u201c${entry.title}\u201d from this phone?`)) {
        await removeAudio(entry.url);
        render();
      }
      return;
    }
    const later = e.target.closest(".later-remove");
    if (later) {
      const row = later.closest(".later-row");
      const { error } = await supabase.from("downloads").delete().eq("id", row.dataset.id);
      if (error) {
        alert(`Couldn't remove: ${error.message}`);
        return;
      }
      legacyRows = legacyRows.filter((r) => String(r.id) !== row.dataset.id);
      render();
    }
  });

  // 1) Show what's on the phone straight away (works with no internet)...
  await verifyIndex();
  render();

  // 2) ...then add the older bookmarks if we can reach the server.
  const { data, error } = await supabase.from("downloads").select("*").eq("user_id", authUser.id).order("created_at", { ascending: false });
  if (error || !data || !data.length) return;
  legacyRows = data.map((r) => ({ id: r.id, title: r.title, podcastId: null }));
  const { data: podcasts } = await supabase.from("podcasts").select("id, title").in("title", legacyRows.map((r) => r.title));
  const byTitle = Object.fromEntries((podcasts || []).map((p) => [p.title, p.id]));
  legacyRows.forEach((r) => (r.podcastId = byTitle[r.title] || null));
  render();
}
