// components/media.js — renders the Media page from data/media.json
import { bootApp, loadData } from "../App.js";
import { ICONS } from "../icons.js";
import { requireAuth } from "../auth.js";

export async function renderMedia() {
  const authUser = await requireAuth();
  if (!authUser) return;

  bootApp({ rightIcon: "bell" });

  const data = await loadData("data/media.json");

  const tilesMount = document.getElementById("media-tiles");
  tilesMount.innerHTML = data.tiles
    .map(
      (tile) => `
      <div class="media-tile">
        <div class="tile-icon">${ICONS[tile.icon]}</div>
        <div>
          <div class="tile-title">${tile.title}</div>
          <div class="tile-sub">${tile.sub}</div>
        </div>
      </div>`
    )
    .join("");

  const podcastsMount = document.getElementById("podcasts");
  podcastsMount.innerHTML = data.podcasts
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
}
