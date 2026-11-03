// offline-audio.js — saving podcasts and audio sermons ON THE PHONE so they play with no internet.
//   • downloadAudio .......... fetches the file (with progress, can be cancelled) and keeps it
//   • openSavedAudio ......... gives the player the saved copy to play
//   • bindDownloadButton ..... the Download / progress / Downloaded button used on pages
// Files are stored in the browser's own storage (the "flood-audio" cache); a small list of what is saved
// (title, size, …) is kept beside it so the Downloads page works even with no connection. This is
// per phone, and only ever holds the church's public audio.
import { ICONS } from "./icons.js";
import { escapeHtml } from "./util.js";

export const AUDIO_CACHE = "flood-audio";
const INDEX_KEY = "flood-audio-index";

const hasCaches = () => typeof caches !== "undefined" && caches && typeof caches.open === "function";
export const audioSupported = () => hasCaches();

// ---------------------------------------------------------------- what's saved on this phone
function readIndex() {
  try {
    const list = JSON.parse(localStorage.getItem(INDEX_KEY));
    return Array.isArray(list) ? list.filter((x) => x && typeof x.url === "string") : [];
  } catch (e) {
    return [];
  }
}
function writeIndex(list) {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(list));
  } catch (e) {
    /* the files are still saved; only the list couldn't be updated */
  }
}

/** Newest first. */
export function savedList() {
  return readIndex().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}
export const isSavedLocally = (url) => readIndex().some((x) => x.url === url);
export const totalBytes = () => readIndex().reduce((sum, x) => sum + (Number(x.bytes) || 0), 0);

export function formatBytes(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1048576).toFixed(1)} MB`;
  return `${(b / 1073741824).toFixed(2)} GB`;
}

/** Drops list entries whose file the browser has since removed (e.g. the phone cleared its storage). */
export async function verifyIndex() {
  if (!hasCaches()) return savedList();
  try {
    const cache = await caches.open(AUDIO_CACHE);
    const keep = [];
    for (const entry of readIndex()) if (await cache.match(entry.url)) keep.push(entry);
    if (keep.length !== readIndex().length) writeIndex(keep);
  } catch (e) {
    /* leave the list as it is */
  }
  return savedList();
}

// ---------------------------------------------------------------- download / play / remove
/**
 * Downloads `item.url` and keeps it. item = { url, title, subtitle, kind, id }.
 * onProgress(bytesSoFar, totalBytes — 0 if unknown). Pass an AbortSignal to allow cancelling.
 * Resolves with the size in bytes; throws an Error with a plain-English message.
 */
export async function downloadAudio(item, { onProgress, signal } = {}) {
  if (!hasCaches()) throw new Error("This phone\u2019s browser can\u2019t save files for offline use.");

  let res;
  try {
    res = await fetch(item.url, { mode: "cors", signal });
  } catch (e) {
    if (e && e.name === "AbortError") throw e;
    throw new Error("Couldn\u2019t download. Check your connection and try again. If it keeps failing, the audio\u2019s host may not allow saving.");
  }
  if (!res.ok) throw new Error(`Couldn\u2019t download (error ${res.status}).`);

  const total = Number(res.headers.get("content-length")) || 0;
  const type = res.headers.get("content-type") || "audio/mpeg";
  let blob;
  if (res.body && typeof res.body.getReader === "function") {
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      if (onProgress) onProgress(got, total);
    }
    blob = new Blob(chunks, { type });
  } else {
    blob = await res.blob();
    if (onProgress) onProgress(blob.size, blob.size);
  }
  if (!blob.size) throw new Error("The download came back empty. Please try again.");

  try {
    const cache = await caches.open(AUDIO_CACHE);
    await cache.put(item.url, new Response(blob, { status: 200, headers: { "Content-Type": type, "Content-Length": String(blob.size) } }));
  } catch (e) {
    throw new Error(e && e.name === "QuotaExceededError" ? "There isn\u2019t enough space on this phone for this download." : "Couldn\u2019t save the file on this phone.");
  }

  const list = readIndex().filter((x) => x.url !== item.url);
  list.push({ url: item.url, title: item.title || "Audio", subtitle: item.subtitle || "", kind: item.kind || "podcast", id: item.id || "", bytes: blob.size, savedAt: Date.now() });
  writeIndex(list);

  // Ask the browser not to throw saved files away when the phone is short on space (best effort).
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  } catch (e) {}
  return blob.size;
}

/** A playable address for the saved copy (or null when there isn't one). Release it with URL.revokeObjectURL. */
export async function openSavedAudio(url) {
  if (!hasCaches() || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return null;
  try {
    const cache = await caches.open(AUDIO_CACHE);
    const hit = await cache.match(url);
    return hit ? URL.createObjectURL(await hit.blob()) : null;
  } catch (e) {
    return null;
  }
}

export async function removeAudio(url) {
  if (hasCaches()) {
    try {
      await (await caches.open(AUDIO_CACHE)).delete(url);
    } catch (e) {}
  }
  writeIndex(readIndex().filter((x) => x.url !== url));
}

export async function removeAllAudio() {
  if (hasCaches()) {
    try {
      await caches.delete(AUDIO_CACHE);
    } catch (e) {}
  }
  writeIndex([]);
}

/** True when the phone says it's on mobile data (browsers that can't tell are treated as Wi-Fi). */
export function onMobileData() {
  const c = typeof navigator !== "undefined" ? navigator.connection : null;
  return Boolean(c && c.type === "cellular");
}

// ---------------------------------------------------------------- the button
/**
 * Turns an existing <button> into a Download button for `item`:
 *   Download  →  Downloading… 42% (tap to cancel)  →  Downloaded ✓ (tap to remove)
 * `compact` shows just the icon / percentage (for small round buttons in lists).
 * `wifiOnly` asks before using mobile data. Returns { destroy() }.
 */
export function bindDownloadButton(btn, item, { wifiOnly = false, compact = false, onChange } = {}) {
  let controller = null;
  let pct = null;

  function paint() {
    const saved = isSavedLocally(item.url);
    btn.classList.toggle("saved", saved);
    btn.classList.toggle("busy", Boolean(controller));
    if (controller) {
      const label = pct === null ? "Downloading\u2026" : `${pct}%`;
      btn.innerHTML = compact ? `<span class="pct">${pct === null ? "\u2026" : pct + "%"}</span>` : `${label} \u00b7 Cancel`;
      btn.setAttribute("aria-label", "Cancel download");
    } else if (saved) {
      btn.innerHTML = compact ? ICONS.check : `${ICONS.check} Downloaded`;
      btn.setAttribute("aria-label", "Downloaded. Tap to remove from this phone");
    } else {
      btn.innerHTML = compact ? ICONS.downloads : `${ICONS.downloads} Download`;
      btn.setAttribute("aria-label", `Download ${escapeHtml(item.title || "audio")} to listen offline`);
    }
  }

  async function onClick(e) {
    if (e) e.stopPropagation();
    if (controller) {
      controller.abort();
      return;
    }
    if (isSavedLocally(item.url)) {
      if (confirm(`Remove \u201c${item.title || "this audio"}\u201d from this phone?`)) {
        await removeAudio(item.url);
        paint();
        if (onChange) onChange();
      }
      return;
    }
    if (wifiOnly && onMobileData() && !confirm("You\u2019re on mobile data and \u201cDownload over Wi-Fi only\u201d is on. Download anyway?")) return;

    controller = new AbortController();
    pct = null;
    paint();
    try {
      await downloadAudio(item, {
        signal: controller.signal,
        onProgress: (got, total) => {
          const next = total ? Math.min(99, Math.floor((got / total) * 100)) : null;
          if (next !== pct) {
            pct = next;
            paint();
          }
        },
      });
    } catch (err) {
      if (!err || err.name !== "AbortError") alert(err && err.message ? err.message : "Couldn\u2019t download.");
    } finally {
      controller = null;
      pct = null;
      paint();
      if (onChange) onChange();
    }
  }

  btn.addEventListener("click", onClick);
  paint();
  return {
    // cancel: false lets a download in progress carry on (e.g. when you tap another item on the page)
    destroy({ cancel = true } = {}) {
      if (controller && cancel) controller.abort();
      btn.removeEventListener("click", onClick);
    },
  };
}

/** A ready-made "Download" chip added to `container` (used under the player). */
export function mountDownloadChip(container, item, options = {}) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "chip download-chip";
  container.appendChild(btn);
  const binding = bindDownloadButton(btn, item, options);
  return {
    destroy(options) {
      binding.destroy(options);
      btn.remove();
    },
  };
}
