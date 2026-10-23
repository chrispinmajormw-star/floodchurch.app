// player.js — plays sermons and podcasts inside the app, in a sheet that slides up.
//   • YouTube (and Vimeo) links ... shown in an embedded player
//   • Uploaded video / audio files . played with the phone's own controls, with
//                                     speed control and "pick up where you left off"
//   • Anything else ................ opens in a new tab (it can't be played in-app)
// Audio and video keep their place per file, and show lock-screen controls
// (Android) while playing. Tapping Next — or finishing a track, when "Auto-play next
// sermon" is on in Settings — moves along the list.
import { ICONS } from "./icons.js";
import { escapeHtml, safeUrl } from "./util.js";

const SPEEDS = [1, 1.25, 1.5, 2, 0.75];
const POS_PREFIX = "flood-pos:";
const SPEED_KEY = "flood-speed";
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv)$/i;
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i;

/** Works out what kind of link this is: youtube | vimeo | video | audio | external. */
export function parseMedia(rawUrl) {
  const url = safeUrl(rawUrl);
  if (!url || !/^https?:/i.test(url)) return { kind: "external", url: null };
  let u;
  try {
    u = new URL(url);
  } catch (e) {
    return { kind: "external", url };
  }
  const host = u.hostname.replace(/^(www|m)\./, "");

  if (host === "youtu.be") {
    const id = u.pathname.slice(1).split("/")[0];
    if (YT_ID.test(id)) return { kind: "youtube", id, url };
  }
  if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "music.youtube.com") {
    const v = u.searchParams.get("v");
    if (v && YT_ID.test(v)) return { kind: "youtube", id: v, url };
    const m = u.pathname.match(/^\/(?:embed|live|shorts|v)\/([A-Za-z0-9_-]{11})/);
    if (m) return { kind: "youtube", id: m[1], url };
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const m = u.pathname.match(/(?:^\/|\/video\/)(\d+)/);
    if (m) return { kind: "vimeo", id: m[1], url };
  }
  if (VIDEO_EXT.test(u.pathname)) return { kind: "video", url };
  if (AUDIO_EXT.test(u.pathname)) return { kind: "audio", url };
  return { kind: "external", url };
}

/** A real picture for a YouTube link (null for anything else). */
export function youtubeThumbnail(rawUrl) {
  const m = parseMedia(rawUrl);
  return m.kind === "youtube" ? `https://img.youtube.com/vi/${m.id}/hqdefault.jpg` : null;
}

// ---------------------------------------------------------------------------
const state = { items: [], index: 0, autoplayNext: false, media: null, lastSaved: 0, ytListener: null };
let els = null;

function ensureModal() {
  if (els && document.body.contains(els.overlay)) return els;
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay player-overlay";
  overlay.id = "player-modal";
  overlay.innerHTML = `
    <div class="modal-sheet player-sheet" role="dialog" aria-modal="true" aria-labelledby="player-title">
      <div class="modal-header">
        <div class="player-titles">
          <h2 class="section-title" id="player-title" style="margin:0;"></h2>
          <p class="player-sub" id="player-sub"></p>
        </div>
        <button class="modal-close" id="player-close" aria-label="Close player">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="player-stage" id="player-stage"></div>
      <div class="player-controls" id="player-controls">
        <button class="chip" id="player-prev">&larr; Previous</button>
        <button class="chip" id="player-speed" title="Playback speed">1&times;</button>
        <button class="chip" id="player-next">Next &rarr;</button>
      </div>
      <p class="player-note" id="player-note"></p>
    </div>`;
  document.body.appendChild(overlay);

  els = {
    overlay,
    title: overlay.querySelector("#player-title"),
    sub: overlay.querySelector("#player-sub"),
    stage: overlay.querySelector("#player-stage"),
    controls: overlay.querySelector("#player-controls"),
    prev: overlay.querySelector("#player-prev"),
    next: overlay.querySelector("#player-next"),
    speed: overlay.querySelector("#player-speed"),
    note: overlay.querySelector("#player-note"),
  };
  overlay.querySelector("#player-close").addEventListener("click", closePlayer);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closePlayer();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("open")) closePlayer();
  });
  els.prev.addEventListener("click", () => step(-1));
  els.next.addEventListener("click", () => step(1));
  els.speed.addEventListener("click", cycleSpeed);
  return els;
}

const savedSpeed = () => {
  const n = Number(localStorage.getItem(SPEED_KEY));
  return SPEEDS.includes(n) ? n : 1;
};

function cycleSpeed() {
  const next = SPEEDS[(SPEEDS.indexOf(savedSpeed()) + 1) % SPEEDS.length];
  localStorage.setItem(SPEED_KEY, String(next));
  els.speed.innerHTML = `${next}&times;`;
  if (state.media) state.media.playbackRate = next;
}

const posKey = (m) => POS_PREFIX + (m.currentSrc || m.src);

function savePosition(force = false) {
  const m = state.media;
  if (!m || !(m.currentTime > 0)) return;
  const now = Date.now();
  if (!force && now - state.lastSaved < 5000) return;
  state.lastSaved = now;
  try {
    localStorage.setItem(posKey(m), String(Math.floor(m.currentTime)));
  } catch (e) {}
}

/** Stops whatever is playing and removes it from the page. */
function teardown() {
  savePosition(true);
  if (state.media) {
    try {
      state.media.pause();
    } catch (e) {}
    state.media = null;
  }
  if (state.ytListener) {
    window.removeEventListener("message", state.ytListener);
    state.ytListener = null;
  }
  if (els) els.stage.innerHTML = "";
  if ("mediaSession" in navigator) {
    try {
      navigator.mediaSession.metadata = null;
    } catch (e) {}
  }
}

function nextPlayableIndex(from, dir) {
  for (let i = from + dir; i >= 0 && i < state.items.length; i += dir) {
    if (parseMedia(state.items[i].url).kind !== "external") return i;
  }
  return -1;
}

function step(dir) {
  const i = nextPlayableIndex(state.index, dir);
  if (i >= 0) play(i);
}

function handleEnded() {
  if (state.media) localStorage.removeItem(posKey(state.media));
  if (state.autoplayNext) step(1);
}

function setMediaSession(item, media) {
  if (!("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: item.title || "Flood Church",
      artist: item.subtitle || "Flood Church",
      artwork: [{ src: "assets/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    });
    const set = (action, fn) => {
      try {
        navigator.mediaSession.setActionHandler(action, fn);
      } catch (e) {}
    };
    set("play", () => media.play());
    set("pause", () => media.pause());
    set("seekbackward", () => (media.currentTime = Math.max(0, media.currentTime - 10)));
    set("seekforward", () => (media.currentTime = Math.min(media.duration || Infinity, media.currentTime + 30)));
    set("previoustrack", nextPlayableIndex(state.index, -1) >= 0 ? () => step(-1) : null);
    set("nexttrack", nextPlayableIndex(state.index, 1) >= 0 ? () => step(1) : null);
  } catch (e) {}
}

function attachMedia(media, item) {
  state.media = media;
  state.lastSaved = 0;
  media.playbackRate = savedSpeed();
  media.addEventListener("loadedmetadata", () => {
    const pos = Number(localStorage.getItem(posKey(media)));
    // Pick up where you left off — unless you were basically finished.
    if (pos > 5 && (!isFinite(media.duration) || pos < media.duration - 10)) media.currentTime = pos;
    media.playbackRate = savedSpeed();
  });
  media.addEventListener("timeupdate", () => savePosition(false));
  media.addEventListener("pause", () => savePosition(true));
  media.addEventListener("ended", handleEnded);
  media.addEventListener("error", () => {
    els.note.innerHTML = "This file couldn\u2019t be played. Check your connection, or ask the church office if it\u2019s been removed.";
  });
  setMediaSession(item, media);
  const started = media.play();
  if (started && typeof started.catch === "function") started.catch(() => {});
}

function listenForYouTubeEnd(iframe) {
  state.ytListener = (e) => {
    let host = "";
    try {
      host = new URL(e.origin).hostname;
    } catch (err) {
      return;
    }
    if (!/(^|\.)youtube(-nocookie)?\.com$/.test(host)) return;
    let data;
    try {
      data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
    } catch (err) {
      return;
    }
    if (!data) return;
    if ((data.event === "onStateChange" && data.info === 0) || (data.event === "infoDelivery" && data.info && data.info.playerState === 0)) {
      handleEnded();
    }
  };
  window.addEventListener("message", state.ytListener);
  iframe.addEventListener("load", () => {
    try {
      iframe.contentWindow.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), "*");
    } catch (e) {}
  });
}

function play(index) {
  const item = state.items[index];
  const info = parseMedia(item.url);
  if (info.kind === "external") {
    if (info.url) window.open(info.url, "_blank");
    return;
  }

  ensureModal();
  teardown();
  state.index = index;
  els.title.textContent = item.title || "Now playing";
  els.sub.textContent = item.subtitle || "";
  els.note.innerHTML = "";

  const isDirect = info.kind === "audio" || info.kind === "video";
  els.speed.hidden = !isDirect;
  els.speed.innerHTML = `${savedSpeed()}&times;`;
  els.prev.hidden = nextPlayableIndex(index, -1) < 0;
  els.next.hidden = nextPlayableIndex(index, 1) < 0;
  els.controls.hidden = els.prev.hidden && els.next.hidden && !isDirect;

  if (info.kind === "youtube") {
    const origin = encodeURIComponent(location.origin);
    els.stage.innerHTML = `<div class="player-frame"><iframe title="${escapeHtml(item.title || "Video")}" src="https://www.youtube-nocookie.com/embed/${info.id}?autoplay=1&rel=0&playsinline=1&enablejsapi=1&origin=${origin}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`;
    listenForYouTubeEnd(els.stage.querySelector("iframe"));
    els.note.innerHTML = `Video not showing? <a href="${escapeHtml(info.url)}" target="_blank" rel="noopener">Open it in YouTube</a>`;
  } else if (info.kind === "vimeo") {
    els.stage.innerHTML = `<div class="player-frame"><iframe title="${escapeHtml(item.title || "Video")}" src="https://player.vimeo.com/video/${info.id}?autoplay=1" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>`;
    els.note.innerHTML = `<a href="${escapeHtml(info.url)}" target="_blank" rel="noopener">Open it on Vimeo</a>`;
  } else if (info.kind === "video") {
    els.stage.innerHTML = `<div class="player-frame"><video controls playsinline preload="metadata" src="${escapeHtml(info.url)}"></video></div>`;
    attachMedia(els.stage.querySelector("video"), item);
  } else {
    els.stage.innerHTML = `<div class="player-art">${ICONS.mic}</div><audio class="player-audio" controls preload="metadata" src="${escapeHtml(info.url)}"></audio>`;
    attachMedia(els.stage.querySelector("audio"), item);
  }

  els.overlay.classList.add("open");
}

/**
 * Opens the player. `items` is a list like [{ title, subtitle, url }]; it starts at `startIndex`
 * and Next/Previous (and auto-play) move along that list.
 */
export function openPlayer(items, startIndex = 0, { autoplayNext = false } = {}) {
  if (!items || !items.length) return;
  state.items = items;
  state.autoplayNext = Boolean(autoplayNext);
  play(Math.min(Math.max(startIndex, 0), items.length - 1));
}

export function closePlayer() {
  if (!els) return;
  teardown();
  els.overlay.classList.remove("open");
}
