// components/watch.js — the "Now playing" page. A sermon, podcast or the live stream plays
// right here in the page (not in a pop-up). You see the picture and press Play; nothing starts
// by itself. Below the player is an "Up next" list; tapping one switches to it.
//   watch.html?kind=sermon&id=…   watch.html?kind=podcast&id=…   watch.html?kind=live
import { bootApp } from "../App.js";
import { ICONS } from "../icons.js";
import { requireAuth } from "../auth.js";
import { supabase } from "../supabaseClient.js";
import { mountPlayer, parseMedia, youtubeThumbnail } from "../player.js";
import { escapeHtml, safeUrl } from "../util.js";

const GRADIENTS = [
  "linear-gradient(160deg, #1fb6c9, #0a4a52)",
  "linear-gradient(160deg, #a8500f, #241205)",
  "linear-gradient(160deg, #6b4fd6, #1c1240)",
  "linear-gradient(160deg, #2f8bff, #0b1d3a)",
];

const KINDS = {
  sermon: { table: "sermons", urlField: "video_url", sub: (r) => [r.speaker, r.duration].filter(Boolean).join(" \u00b7 "), title: "Sermon", back: "sermons.html", list: "More sermons" },
  podcast: { table: "podcasts", urlField: "audio_url", sub: (r) => r.sub || "", title: "Podcast", back: "media.html", list: "More podcasts" },
};

export async function renderWatch() {
  const authUser = await requireAuth();
  if (!authUser) return;

  const params = new URLSearchParams(location.search);
  const kind = params.get("kind") === "podcast" ? "podcast" : params.get("kind") === "live" ? "live" : "sermon";
  const wantedId = params.get("id");
  const cfg = KINDS[kind];

  bootApp({ back: true, backHref: cfg ? cfg.back : "media.html", rightIcon: null, title: cfg ? cfg.title : "Live" });
  const root = document.getElementById("watch-root");

  const settingsRes = await supabase.from("user_settings").select("autoplay_next").eq("user_id", authUser.id).maybeSingle();
  const autoplayNext = Boolean(settingsRes.data?.autoplay_next);

  // ---- What are we playing? ---------------------------------------------------
  let items = [];
  if (kind === "live") {
    const { data: live } = await supabase.from("media_live").select("*").eq("id", 1).maybeSingle();
    if (!live?.is_live || !safeUrl(live.stream_url)) {
      root.innerHTML = `<h1 class="page-title">Live service</h1><p class="page-sub">We\u2019re not live right now.${live?.schedule_text ? " Services: " + escapeHtml(live.schedule_text) + "." : ""}</p>`;
      return;
    }
    items = [{ id: "live", title: "Live service", subtitle: live.schedule_text || "Flood Church", url: live.stream_url }];
  } else {
    const { data, error } = await supabase.from(cfg.table).select("*").order("created_at", { ascending: false }).limit(50);
    if (error) {
      root.innerHTML = `<p style="color:var(--red);font-size:14px;">${escapeHtml(error.message)}</p>`;
      return;
    }
    items = (data || []).map((r) => ({ id: r.id, title: r.title, subtitle: cfg.sub(r), url: r[cfg.urlField] }));
  }

  let index = wantedId ? items.findIndex((i) => i.id === wantedId) : 0;
  if (!items.length || index < 0) {
    root.innerHTML = `<h1 class="page-title">Not found</h1><p class="page-sub">We couldn\u2019t find that one. It may have been removed.</p><a class="btn btn-primary" href="${cfg ? cfg.back : "media.html"}">Go back</a>`;
    return;
  }

  root.innerHTML = `
    <div id="watch-player"></div>
    <h1 class="watch-title" id="watch-title"></h1>
    <p class="watch-sub" id="watch-sub"></p>
    <div id="watch-upnext"></div>`;
  const playerMount = document.getElementById("watch-player");
  const upNext = document.getElementById("watch-upnext");
  let player = null;

  const playable = (i) => parseMedia(items[i].url).kind !== "external";
  const nextPlayable = (from, dir) => {
    for (let i = from + dir; i >= 0 && i < items.length; i += dir) if (playable(i)) return i;
    return -1;
  };

  function thumbFor(item, i) {
    const picture = youtubeThumbnail(item.url);
    const gradient = GRADIENTS[i % GRADIENTS.length];
    return picture ? `url('${picture}') center/cover no-repeat, ${gradient}` : gradient;
  }

  function renderUpNext() {
    if (items.length < 2) {
      upNext.innerHTML = "";
      return;
    }
    upNext.innerHTML =
      `<h2 class="section-title">${cfg ? cfg.list : "Up next"}</h2>` +
      items
        .map(
          (it, i) => `
      <div class="sermon-row${i === index ? " now" : ""}" data-index="${i}" role="button" tabindex="0">
        <div class="sermon-row-thumb" style="background:${thumbFor(it, i)}">
          <span class="sermon-playicon">${kind === "podcast" ? ICONS.mic : ICONS.playFilled}</span>
        </div>
        <div class="sermon-row-body">
          <p class="sermon-title">${escapeHtml(it.title)}</p>
          <p class="sermon-sub">${i === index ? "Now playing" : escapeHtml(it.subtitle || "")}</p>
        </div>
      </div>`
        )
        .join("");
    upNext.querySelectorAll(".sermon-row").forEach((row) => {
      const go = () => {
        const i = Number(row.dataset.index);
        if (i === index) return;
        show(i, false);
        window.scrollTo({ top: 0, behavior: "smooth" });
      };
      row.addEventListener("click", go);
      row.addEventListener("keydown", (e) => {
        if ((e.key === "Enter" || e.key === " ") && e.target === row) {
          e.preventDefault();
          go();
        }
      });
    });
  }

  /** Shows one item. `autoplay` is true ONLY when the last one finished and "Auto-play next" is on. */
  function show(i, autoplay) {
    if (player) player.destroy();
    index = i;
    const item = items[i];
    document.getElementById("watch-title").textContent = item.title;
    document.getElementById("watch-sub").textContent = item.subtitle || "";
    if (kind !== "live" && item.id) {
      try {
        history.replaceState(null, "", `watch.html?kind=${kind}&id=${encodeURIComponent(item.id)}`);
      } catch (e) {}
    }
    const prev = nextPlayable(i, -1);
    const next = nextPlayable(i, 1);
    player = mountPlayer(playerMount, item, {
      autoplay,
      onEnded: () => {
        if (autoplayNext && next >= 0) show(next, true);
      },
      onPrev: prev >= 0 ? () => show(prev, true) : null,
      onNext: next >= 0 ? () => show(next, true) : null,
    });
    renderUpNext();
  }

  show(index, false);
}
