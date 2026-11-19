// components/media.js — the Media page: Sermons / Live TV / Devotions tiles and the podcast
// list. Podcasts and the live stream play inside the app; the tiles open the Sermons library
// and the Devotions archive.
import { bootApp, loadData } from "../App.js";
import { ICONS } from "../icons.js";
import { requireAuth } from "../auth.js";
import { supabase } from "../supabaseClient.js";
import { escapeHtml, safeUrl } from "../util.js";
import { nextOccurrence, describeOccurrence } from "../schedule.js";
import { parseMedia } from "../player.js";
import { audioSupported, bindDownloadButton } from "../offline-audio.js";

export async function renderMedia() {
  const authUser = await requireAuth();
  if (!authUser) return;

  bootApp({ rightIcon: "bell" });

  const [data, podcastsRes, liveRes, scheduleRes, settingsRes] = await Promise.all([
    loadData("data/media.json"),
    supabase.from("podcasts").select("*").order("created_at", { ascending: false }),
    supabase.from("media_live").select("*").eq("id", 1).maybeSingle(),
    supabase.from("live_schedule").select("*"),
    supabase.from("user_settings").select("wifi_only_downloads").eq("user_id", authUser.id).maybeSingle(),
  ]);

  const live = liveRes.data;
  const liveUrl = safeUrl(live?.stream_url);
  const isLiveNow = Boolean(live?.is_live && liveUrl);
  const next = scheduleRes.error ? null : nextOccurrence(scheduleRes.data || []);

  // ---- Tiles ----------------------------------------------------------------
  const tilesMount = document.getElementById("media-tiles");
  tilesMount.innerHTML = data.tiles
    .map((tile, i) => {
      const isLiveTile = tile.action === "live";
      const sub = isLiveTile
        ? isLiveNow
          ? "Live now"
          : next
            ? `Next: ${describeOccurrence(next)}`
            : live?.schedule_text || tile.sub
        : tile.sub;
      return `
      <div class="media-tile" data-tile="${i}" role="button" tabindex="0" style="cursor:pointer;">
        <div class="tile-icon">${ICONS[tile.icon]}</div>
        <div>
          <div class="tile-title">${escapeHtml(tile.title)}${isLiveTile && live?.is_live ? ' <span style="color:var(--red);font-size:11px;font-weight:800;">&bull; LIVE</span>' : ""}</div>
          <div class="tile-sub">${escapeHtml(sub)}</div>
        </div>
      </div>`;
    })
    .join("");

  tilesMount.querySelectorAll("[data-tile]").forEach((el) => {
    const tile = data.tiles[Number(el.dataset.tile)];
    const go = () => {
      if (tile.action === "live") {
        location.href = "live.html"; // the stream when live, otherwise the countdown and weekly schedule
      } else if (tile.href) {
        location.href = tile.href;
      }
    };
    el.addEventListener("click", go);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        go();
      }
    });
  });

  // ---- Podcasts -------------------------------------------------------------
  const podcasts = podcastsRes.data || [];
  const podcastsMount = document.getElementById("podcasts");
  podcastsMount.innerHTML =
    podcasts
      .map(
        (p, i) => `
      <div class="podcast-row">
        <a class="podcast-play" href="watch.html?kind=podcast&id=${encodeURIComponent(p.id)}" style="display:flex;align-items:center;gap:14px;flex:1;min-width:0;text-decoration:none;color:inherit;">
          <div class="mic">${ICONS.mic}</div>
          <div>
            <div class="p-title">${escapeHtml(p.title)}</div>
            <div class="p-sub">${escapeHtml(p.sub || "")}</div>
          </div>
        </a>
        <button class="icon-btn download-btn" aria-label="Download" data-index="${i}" style="width:36px;height:36px;flex-shrink:0;">
          ${ICONS.downloads}
        </button>
      </div>`
      )
      .join("") || `<p style="color:var(--text-dim);font-size:14px;padding:12px 4px;">No podcasts posted yet.</p>`;

  // The round button on each podcast really downloads the audio to the phone (only for audio files that can be saved).
  const wifiOnly = Boolean(settingsRes.data?.wifi_only_downloads);
  podcastsMount.querySelectorAll(".download-btn").forEach((btn) => {
    const p = podcasts[Number(btn.dataset.index)];
    if (!p || !audioSupported() || parseMedia(p.audio_url).kind !== "audio") {
      btn.remove();
      return;
    }
    bindDownloadButton(btn, { url: p.audio_url, title: p.title, subtitle: p.sub || "", kind: "podcast", id: p.id }, { wifiOnly, compact: true });
  });
}
