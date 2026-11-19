// poster-viewer.js — shows a poster / flyer full screen, right inside the app.
//
//   openPoster({ url, title })   opens it (returns false if the link isn't a safe https image address)
//   closePoster()                closes it
//   posterUrl(value)             a safe https address, or null
//
// Tap the poster to zoom in (drag to look around); pinch to zoom further. The phone's Back button, the ✕,
// the Escape key and a tap on the dark background all close it. If the picture can't load (no signal), a short
// message and a "Try again" button appear instead of an empty screen.
import { ICONS } from "./icons.js";
import { safeUrl } from "./util.js";

/** Only https pictures: an http picture would be blocked by the browser, and anything else isn't a picture. */
export function posterUrl(value) {
  const u = safeUrl(value);
  return u && /^https:\/\//i.test(u) ? u : null;
}

let overlay = null;
let lastFocus = null;
let pushed = false;
let savedOverflow = "";
let current = { url: "", title: "" };

function el(id) {
  return overlay.querySelector(`#${id}`);
}

function build() {
  pushed = false;
  lastFocus = null;
  overlay = document.createElement("div");
  overlay.className = "poster-viewer";
  overlay.id = "poster-viewer";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Poster");
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="poster-bar">
      <p class="poster-title" id="poster-title"></p>
      <div class="poster-actions">
        <button type="button" class="poster-btn" id="poster-share" aria-label="Share" hidden>${ICONS.share}</button>
        <a class="poster-btn" id="poster-open" target="_blank" rel="noopener" aria-label="Open full size">${ICONS.external}</a>
        <button type="button" class="poster-btn" id="poster-close" aria-label="Close">${ICONS.x}</button>
      </div>
    </div>
    <div class="poster-stage" id="poster-stage">
      <div class="poster-spinner" id="poster-spinner" aria-hidden="true"></div>
      <img class="poster-img" id="poster-img" alt="" draggable="false">
      <div class="poster-error" id="poster-error" hidden>
        <p>Couldn't load the poster. Check your connection and try again.</p>
        <button type="button" class="btn btn-primary" id="poster-retry">Try again</button>
      </div>
    </div>
    <p class="poster-hint" id="poster-hint">Tap the poster to zoom</p>`;
  document.body.appendChild(overlay);

  const stage = el("poster-stage");
  const img = el("poster-img");

  el("poster-close").addEventListener("click", closePoster);
  stage.addEventListener("click", (e) => {
    if (e.target === stage) closePoster(); // a tap on the dark background
  });
  img.addEventListener("click", () => {
    const zoomed = stage.classList.toggle("zoomed");
    el("poster-hint").textContent = zoomed ? "Drag to look around · tap to zoom out" : "Tap the poster to zoom";
    if (zoomed) {
      stage.scrollLeft = (stage.scrollWidth - stage.clientWidth) / 2;
      stage.scrollTop = 0;
    }
  });
  img.addEventListener("load", () => {
    el("poster-spinner").hidden = true;
    el("poster-error").hidden = true;
    img.hidden = false;
  });
  img.addEventListener("error", () => {
    el("poster-spinner").hidden = true;
    img.hidden = true;
    el("poster-error").hidden = false;
  });
  el("poster-retry").addEventListener("click", () => load(withRetry(current.url)));
  el("poster-share").addEventListener("click", async () => {
    try {
      await navigator.share({ title: current.title, url: current.url });
    } catch (e) {
      /* they closed the share sheet: nothing to do */
    }
  });
}

/** The same address with a throw-away marker, so the browser really asks again. */
function withRetry(url) {
  return url + (url.includes("?") ? "&" : "?") + "retry=" + Date.now();
}

function load(src) {
  el("poster-spinner").hidden = false;
  el("poster-error").hidden = true;
  const img = el("poster-img");
  img.hidden = true;
  img.src = src;
}

function onKey(e) {
  if (e.key === "Escape") closePoster();
}

/** The phone's Back button: closes the poster instead of leaving the page. */
function onPop() {
  if (isPosterOpen()) {
    pushed = false;
    hide();
  }
}

function hide() {
  if (!overlay) return;
  overlay.hidden = true;
  overlay.classList.remove("open");
  el("poster-stage").classList.remove("zoomed");
  el("poster-img").removeAttribute("src");
  document.documentElement.style.overflow = savedOverflow;
  document.removeEventListener("keydown", onKey);
  if (lastFocus && lastFocus.focus) lastFocus.focus();
  lastFocus = null;
}

/** Is our viewer part of the page being shown right now? */
function onThisPage() {
  return Boolean(overlay) && overlay.ownerDocument === document && overlay.isConnected;
}

export function isPosterOpen() {
  return onThisPage() && !overlay.hidden; // only while it is really on the screen
}

export function openPoster({ url, title = "Poster" } = {}) {
  const safe = posterUrl(url);
  if (!safe) return false;
  if (!onThisPage()) build();
  if (isPosterOpen()) return true;

  current = { url: safe, title: String(title || "Poster") };
  lastFocus = document.activeElement;
  el("poster-title").textContent = current.title;
  overlay.setAttribute("aria-label", `Poster: ${current.title}`);
  el("poster-img").alt = `Poster for ${current.title}`;
  el("poster-open").href = safe;
  el("poster-share").hidden = typeof navigator === "undefined" || typeof navigator.share !== "function";
  el("poster-hint").textContent = "Tap the poster to zoom";
  el("poster-stage").classList.remove("zoomed");

  savedOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = "hidden"; // the page behind doesn't scroll
  overlay.hidden = false;
  requestAnimationFrame(() => overlay.classList.add("open"));
  load(safe);
  el("poster-close").focus();

  document.addEventListener("keydown", onKey);
  window.addEventListener("popstate", onPop);
  try {
    history.pushState({ floodPoster: true }, ""); // so the Back button closes the poster first
    pushed = true;
  } catch (e) {
    pushed = false;
  }
  return true;
}

export function closePoster() {
  if (!isPosterOpen()) return;
  const wasPushed = pushed;
  pushed = false;
  hide();
  if (wasPushed && history.state && history.state.floodPoster) history.back(); // take our extra step back out of the history
}
