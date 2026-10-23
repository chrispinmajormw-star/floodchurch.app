// components/media.js — the Media page: Sermons / Live TV / Devotions tiles and the podcast
// list. Podcasts and the live stream play inside the app; the tiles open the Sermons library
// and the Devotions archive.
import { bootApp, loadData } from "../App.js";
import { ICONS } from "../icons.js";
import { requireAuth } from "../auth.js";
import { supabase } from "../supabaseClient.js";
import { openPlayer } from "../player.js";
import { escapeHtml, safeUrl } from "../util.js";

export async function renderMedia() {
  const authUser = await requireAuth();
  if (!authUser) return;

  bootApp({ rightIcon: "bell" });

  const [data, podcastsRes, liveRes, settingsRes] = await Promise.all([
    loadData("data/media.json"),
    supabase.from("podcasts").select("*").order("created_at", { ascending: false }),
    supabase.from("media_live").select("*").eq("id", 1).maybeSingle(),
    supabase.from("user_settings").select("autoplay_next").eq("user_id", authUser.id).maybeSingle(),
  ]);

  const live = liveRes.data;
  const liveUrl = safeUrl(live?.stream_url);
  const isLiveNow = Boolean(live?.is_live && liveUrl);
  const autoplayNext = Boolean(settingsRes.data?.autoplay_next);

  // ---- Tiles ----------------------------------------------------------------
  const tilesMount = document.getElementById("media-tiles");
  tilesMount.innerHTML = data.tiles
    .map((tile, i) => {
      const isLiveTile = tile.action === "live";
      const sub = isLiveTile && live ? (live.is_live ? "Live now" : live.schedule_text || tile.sub) : tile.sub;
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
        if (isLiveNow) {
          openPlayer([{ title: "Live service", subtitle: live.schedule_text || "Flood Church", url: liveUrl }], 0);
        } else {
          alert(`We\u2019re not live right now.${live?.schedule_text ? " Services: " + live.schedule_text + "." : ""}`);
        }
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
        <div class="podcast-play" data-index="${i}" role="button" tabindex="0" style="display:flex;align-items:center;gap:14px;flex:1;min-width:0;cursor:pointer;">
          <div class="mic">${ICONS.mic}</div>
          <div>
            <div class="p-title">${escapeHtml(p.title)}</div>
            <div class="p-sub">${escapeHtml(p.sub || "")}</div>
          </div>
        </div>
        <button class="icon-btn download-btn" aria-label="Save to Downloads" data-title="${escapeHtml(p.title)}" style="width:32px;height:32px;flex-shrink:0;">
          ${ICONS.downloads}
        </button>
      </div>`
      )
      .join("") || `<p style="color:var(--text-dim);font-size:14px;padding:12px 4px;">No podcasts posted yet.</p>`;

  const podcastItems = podcasts.map((p) => ({ title: p.title, subtitle: p.sub || "", url: p.audio_url }));
  podcastsMount.querySelectorAll(".podcast-play").forEach((el) => {
    const go = () => openPlayer(podcastItems, Number(el.dataset.index), { autoplayNext });
    el.addEventListener("click", go);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        go();
      }
    });
  });

  podcastsMount.querySelectorAll(".download-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const title = btn.dataset.title;
      btn.disabled = true;
      const { error } = await supabase
        .from("downloads")
        .insert({ user_id: authUser.id, title, kind: "podcast" });
      btn.disabled = false;
      if (error) {
        alert(`Couldn't save "${title}": ${error.message}`);
        return;
      }
      btn.style.color = "var(--blue)";
    });
  });
}
