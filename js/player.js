// player.js — plays sermons, podcasts and the live stream INSIDE a page (see watch.html).
// Nothing ever starts by itself: you see the picture and press Play.
//   • YouTube / Vimeo ........ a big thumbnail with a Play button; pressing it loads the player
//   • Uploaded video / audio . the phone's own player with its Play button, plus a speed button
//                              and "pick up where you left off"
//   • Anything else .......... can't play in-app, so it offers an "Open link" button
// Audio and video keep their place per file and show lock-screen controls (Android).
import { ICONS } from "./icons.js";
import { escapeHtml, safeUrl } from "./util.js";

const SPEEDS = [1, 1.25, 1.5, 2, 0.75];
const POS_PREFIX = "flood-pos:";
const SPEED_KEY = "flood-speed";
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv)$/i;
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i;
const FALLBACK_BG = "linear-gradient(160deg, #2f8bff, #0b1d3a)";

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

const savedSpeed = () => {
  const n = Number(localStorage.getItem(SPEED_KEY));
  return SPEEDS.includes(n) ? n : 1;
};
const posKey = (m) => POS_PREFIX + (m.currentSrc || m.src);

/**
 * Draws the player for one item into `container`.
 *   item ......... { title, subtitle, url }
 *   autoplay ..... start straight away (only used when moving on to the next item
 *                  because "Auto-play next" is on — never on first opening a page)
 *   onEnded ...... called when the item finishes
 *   onPrev/onNext  lock-screen "previous/next" buttons (optional)
 * Returns { destroy() } — stops playback and clears the container.
 */
export function mountPlayer(container, item, { autoplay = false, onEnded, onPrev, onNext } = {}) {
  const info = parseMedia(item.url);
  let media = null;
  let ytListener = null;
  let lastSaved = 0;

  container.innerHTML = `<div class="watch-stage"></div><div class="watch-tools" hidden></div><p class="watch-note"></p>`;
  const stage = container.querySelector(".watch-stage");
  const tools = container.querySelector(".watch-tools");
  const note = container.querySelector(".watch-note");

  function savePosition(force = false) {
    if (!media || !(media.currentTime > 0)) return;
    const now = Date.now();
    if (!force && now - lastSaved < 5000) return;
    lastSaved = now;
    try {
      localStorage.setItem(posKey(media), String(Math.floor(media.currentTime)));
    } catch (e) {}
  }

  function finished() {
    if (media) localStorage.removeItem(posKey(media));
    if (onEnded) onEnded();
  }

  function setMediaSession(m) {
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
      set("play", () => m.play());
      set("pause", () => m.pause());
      set("seekbackward", () => (m.currentTime = Math.max(0, m.currentTime - 10)));
      set("seekforward", () => (m.currentTime = Math.min(m.duration || Infinity, m.currentTime + 30)));
      set("previoustrack", onPrev || null);
      set("nexttrack", onNext || null);
    } catch (e) {}
  }

  /** Audio / video files: the phone's own controls, no autoplay unless asked. */
  function attachMedia(el) {
    media = el;
    media.playbackRate = savedSpeed();
    media.addEventListener("loadedmetadata", () => {
      const pos = Number(localStorage.getItem(posKey(media)));
      // Pick up where you left off — unless you were basically finished.
      if (pos > 5 && (!isFinite(media.duration) || pos < media.duration - 10)) media.currentTime = pos;
      media.playbackRate = savedSpeed();
    });
    media.addEventListener("timeupdate", () => savePosition(false));
    media.addEventListener("pause", () => savePosition(true));
    media.addEventListener("ended", finished);
    media.addEventListener("error", () => {
      note.textContent = "This file couldn\u2019t be played. Check your connection, or ask the church office if it\u2019s been removed.";
    });
    setMediaSession(media);

    tools.hidden = false;
    tools.innerHTML = `<button type="button" class="chip" data-speed title="Playback speed">${savedSpeed()}&times;</button>`;
    tools.querySelector("[data-speed]").addEventListener("click", (e) => {
      const next = SPEEDS[(SPEEDS.indexOf(savedSpeed()) + 1) % SPEEDS.length];
      localStorage.setItem(SPEED_KEY, String(next));
      e.currentTarget.innerHTML = `${next}&times;`;
      media.playbackRate = next;
    });

    if (autoplay) {
      const started = media.play();
      if (started && typeof started.catch === "function") started.catch(() => {});
    }
  }

  function listenForYouTubeEnd(iframe) {
    ytListener = (e) => {
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
        finished();
      }
    };
    window.addEventListener("message", ytListener);
    iframe.addEventListener("load", () => {
      try {
        iframe.contentWindow.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), "*");
      } catch (e) {}
    });
  }

  /** The picture with a big Play button. Pressing it loads the embedded player. */
  function showPoster(background, load) {
    stage.innerHTML = `<button type="button" class="watch-poster" aria-label="Play ${escapeHtml(item.title || "video")}" style="background:${background}"><span class="watch-play">${ICONS.playFilled}</span></button>`;
    stage.querySelector(".watch-poster").addEventListener("click", load);
  }

  function loadYouTube() {
    const origin = encodeURIComponent(location.origin);
    stage.innerHTML = `<div class="watch-frame"><iframe title="${escapeHtml(item.title || "Video")}" src="https://www.youtube-nocookie.com/embed/${info.id}?autoplay=1&rel=0&playsinline=1&enablejsapi=1&origin=${origin}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`;
    listenForYouTubeEnd(stage.querySelector("iframe"));
  }

  function loadVimeo() {
    stage.innerHTML = `<div class="watch-frame"><iframe title="${escapeHtml(item.title || "Video")}" src="https://player.vimeo.com/video/${info.id}?autoplay=1" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>`;
  }

  if (info.kind === "youtube") {
    const picture = youtubeThumbnail(info.url);
    const background = picture ? `url('${picture}') center/cover no-repeat, ${FALLBACK_BG}` : FALLBACK_BG;
    if (autoplay) loadYouTube();
    else showPoster(background, loadYouTube);
    note.innerHTML = `Video not showing? <a href="${escapeHtml(info.url)}" target="_blank" rel="noopener">Open it in YouTube</a>`;
  } else if (info.kind === "vimeo") {
    if (autoplay) loadVimeo();
    else showPoster(FALLBACK_BG, loadVimeo);
    note.innerHTML = `<a href="${escapeHtml(info.url)}" target="_blank" rel="noopener">Open it on Vimeo</a>`;
  } else if (info.kind === "video") {
    stage.innerHTML = `<div class="watch-frame"><video controls playsinline preload="metadata" src="${escapeHtml(info.url)}"></video></div>`;
    attachMedia(stage.querySelector("video"));
  } else if (info.kind === "audio") {
    stage.innerHTML = `<div class="watch-art">${ICONS.mic}</div><audio class="watch-audio" controls preload="metadata" src="${escapeHtml(info.url)}"></audio>`;
    attachMedia(stage.querySelector("audio"));
  } else {
    stage.innerHTML = `<div class="watch-external"><p>This link can\u2019t play inside the app.</p>${info.url ? `<a class="btn btn-primary" href="${escapeHtml(info.url)}" target="_blank" rel="noopener">Open link</a>` : ""}</div>`;
  }

  return {
    destroy() {
      savePosition(true);
      if (media) {
        try {
          media.pause();
        } catch (e) {}
        media = null;
      }
      if (ytListener) {
        window.removeEventListener("message", ytListener);
        ytListener = null;
      }
      if ("mediaSession" in navigator) {
        try {
          navigator.mediaSession.metadata = null;
        } catch (e) {}
      }
      container.innerHTML = "";
    },
  };
}
