// components/media.js — renders tiles from data/media.json, but the
// podcasts list and Live TV status come from live Supabase data.
import { bootApp, loadData } from "../App.js";
import { ICONS } from "../icons.js";
import { requireAuth } from "../auth.js";
import { supabase } from "../supabaseClient.js";

export async function renderMedia() {
  const authUser = await requireAuth();
  if (!authUser) return;

  bootApp({ rightIcon: "bell" });

  const [data, podcastsRes, liveRes] = await Promise.all([
    loadData("data/media.json"),
    supabase.from("podcasts").select("*").order("created_at", { ascending: false }),
    supabase.from("media_live").select("*").eq("id", 1).maybeSingle(),
  ]);

  const live = liveRes.data;

  const tilesMount = document.getElementById("media-tiles");
  tilesMount.innerHTML = data.tiles
    .map((tile) => {
      const isLiveTile = tile.title === "Live TV";
      const sub = isLiveTile && live ? (live.is_live ? "Live now" : live.schedule_text || tile.sub) : tile.sub;
      const clickable = isLiveTile && live?.is_live && live.stream_url;
      return `
      <div class="media-tile"${clickable ? ` data-live-url="${live.stream_url}" style="cursor:pointer;"` : ""}>
        <div class="tile-icon">${ICONS[tile.icon]}</div>
        <div>
          <div class="tile-title">${tile.title}${isLiveTile && live?.is_live ? ' <span style="color:var(--red);font-size:11px;font-weight:800;">&bull; LIVE</span>' : ""}</div>
          <div class="tile-sub">${sub}</div>
        </div>
      </div>`;
    })
    .join("");

  tilesMount.querySelectorAll("[data-live-url]").forEach((el) => {
    el.addEventListener("click", () => window.open(el.dataset.liveUrl, "_blank"));
  });

  const podcasts = podcastsRes.data || [];
  const podcastsMount = document.getElementById("podcasts");
  podcastsMount.innerHTML =
    podcasts
      .map(
        (p) => `
      <div class="podcast-row">
        <a href="${p.audio_url}" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:14px;flex:1;min-width:0;text-decoration:none;color:inherit;">
          <div class="mic">${ICONS.mic}</div>
          <div>
            <div class="p-title">${p.title}</div>
            <div class="p-sub">${p.sub || ""}</div>
          </div>
        </a>
        <button class="icon-btn download-btn" aria-label="Download" data-title="${p.title}" style="width:32px;height:32px;flex-shrink:0;">
          ${ICONS.downloads}
        </button>
      </div>`
      )
      .join("") || `<p style="color:var(--text-dim);font-size:14px;padding:12px 4px;">No podcasts posted yet.</p>`;

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
        alert(`Couldn't download "${title}": ${error.message}`);
        return;
      }
      btn.style.color = "var(--blue)";
    });
  });
}
