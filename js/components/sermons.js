// components/sermons.js — the Sermons library.
//   • Search ............. by title, speaker or series
//   • Video / Audio tabs . video = sermons posted as video; audio = podcasts and audio-only sermons
//   • Series chips ....... pick a series (e.g. "Kick-Off Series") to see just those
//   • Each row shows the date it was preached; tapping opens the Now playing page.
// The bookmark saves a sermon (Profile → Saved sermons); the shortcuts jump to Saved and Downloads.
import { bootApp } from "../App.js";
import { ICONS } from "../icons.js";
import { requireAuth } from "../auth.js";
import { supabase } from "../supabaseClient.js";
import { parseMedia, youtubeThumbnail } from "../player.js";
import { escapeHtml } from "../util.js";

const GRADIENTS = [
  "linear-gradient(160deg, #1fb6c9, #0a4a52)",
  "linear-gradient(160deg, #a8500f, #241205)",
  "linear-gradient(160deg, #6b4fd6, #1c1240)",
  "linear-gradient(160deg, #2f8bff, #0b1d3a)",
];

/** "22 Oct 2026". A plain date (2026-10-22) is read as that day on the phone, never shifted by time zones. */
export function formatDate(value) {
  if (!value) return "";
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
  return isNaN(d) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

const sortKey = (item) => {
  const t = new Date(item.date).getTime();
  return isNaN(t) ? 0 : t;
};

export async function renderSermons() {
  const authUser = await requireAuth();
  if (!authUser) return;

  bootApp({ back: true, backHref: "media.html", rightIcon: null, title: "Sermons" });

  const listMount = document.getElementById("sermon-list");
  const emptyMsg = document.getElementById("sermon-empty");
  const countEl = document.getElementById("sermon-count");
  const chipsMount = document.getElementById("series-chips");
  const searchInput = document.getElementById("sermon-search");

  document.getElementById("sermon-shortcuts").innerHTML = `
    <a class="chip" href="saved-sermons.html">${ICONS.bookmark} Saved</a>
    <a class="chip" href="downloads.html">${ICONS.downloads} Downloads</a>`;

  const [sermonsRes, podcastsRes, savedRes] = await Promise.all([
    supabase.from("sermons").select("*").order("created_at", { ascending: false }).limit(200),
    supabase.from("podcasts").select("*").order("created_at", { ascending: false }).limit(200),
    supabase.from("saved_sermons").select("sermon_title").eq("user_id", authUser.id),
  ]);

  if (sermonsRes.error) {
    listMount.innerHTML = `<p style="color:var(--red);font-size:14px;">${escapeHtml(sermonsRes.error.message)}</p>`;
    return;
  }

  // One list for both kinds, newest first.
  const items = [
    ...(sermonsRes.data || []).map((s) => ({
      kind: "sermon", id: s.id, title: s.title, speaker: s.speaker || "", duration: s.duration || "",
      url: s.video_url, series: (s.series || "").trim(), date: s.sermon_date || s.created_at,
      media: parseMedia(s.video_url).kind,
    })),
    ...(podcastsRes.error ? [] : podcastsRes.data || []).map((p) => ({
      kind: "podcast", id: p.id, title: p.title, speaker: p.sub || "", duration: "",
      url: p.audio_url, series: "", date: p.created_at, media: "audio",
    })),
  ].sort((a, b) => sortKey(b) - sortKey(a));

  const saved = new Set((savedRes.data || []).map((r) => r.sermon_title));
  const state = { tab: "video", series: "", query: "" };

  const inTab = (it) => (state.tab === "audio" ? it.media === "audio" : it.kind === "sermon" && it.media !== "audio");

  function thumbBackground(it, i) {
    const picture = it.kind === "sermon" ? youtubeThumbnail(it.url) : null;
    const gradient = GRADIENTS[i % GRADIENTS.length];
    return picture ? `url('${picture}') center/cover no-repeat, ${gradient}` : gradient;
  }

  function renderChips() {
    const seriesNames = [...new Set(items.filter(inTab).map((it) => it.series).filter(Boolean))];
    if (!seriesNames.length) {
      chipsMount.innerHTML = "";
      chipsMount.hidden = true;
      return;
    }
    chipsMount.hidden = false;
    const chip = (label, value) => `<button class="chip${state.series === value ? " active" : ""}" data-series="${escapeHtml(value)}">${escapeHtml(label)}</button>`;
    chipsMount.innerHTML = chip("All", "") + seriesNames.map((n) => chip(n, n)).join("");
  }

  function renderList() {
    const q = state.query.trim().toLowerCase();
    const shown = items.filter(
      (it) =>
        inTab(it) &&
        (!state.series || it.series === state.series) &&
        (!q || [it.title, it.speaker, it.series].some((f) => String(f || "").toLowerCase().includes(q)))
    );

    const one = shown.length === 1;
    const noun = state.tab === "audio" ? (one ? "audio message" : "audio messages") : one ? "video" : "videos";
    countEl.textContent = shown.length ? `${shown.length} ${noun}` : "";
    emptyMsg.style.display = shown.length ? "none" : "block";
    if (!shown.length) {
      emptyMsg.textContent = q
        ? `No ${state.tab} sermons match \u201c${state.query.trim()}\u201d.`
        : state.series
          ? `No ${state.tab} sermons in ${state.series} yet.`
          : state.tab === "audio"
            ? "No audio messages yet."
            : "No sermons posted yet.";
    }

    listMount.innerHTML = shown
      .map((it, i) => {
        const isAudio = it.media === "audio";
        const sub = [formatDate(it.date), it.speaker].filter(Boolean).join(" \u00b7 ");
        return `
      <div class="sermon-row" data-kind="${it.kind}" data-id="${escapeHtml(it.id)}" role="button" tabindex="0">
        <div class="sermon-row-thumb" style="background:${thumbBackground(it, i)}">
          <span class="sermon-playicon">${isAudio ? ICONS.mic : ICONS.playFilled}</span>
          ${it.duration ? `<span class="sermon-duration">${escapeHtml(it.duration)}</span>` : ""}
        </div>
        <div class="sermon-row-body">
          <p class="sermon-title">${escapeHtml(it.title)}</p>
          <p class="sermon-sub">${escapeHtml(sub)}</p>
          ${it.series ? `<span class="series-tag">${escapeHtml(it.series)}</span>` : ""}
        </div>
        ${it.kind === "sermon" ? `<button class="icon-btn sermon-row-save${saved.has(it.title) ? " saved" : ""}" data-title="${escapeHtml(it.title)}" aria-label="Save sermon">${ICONS.bookmark}</button>` : ""}
      </div>`;
      })
      .join("");
  }

  function refresh() {
    renderChips();
    renderList();
  }

  // ---- interactions -------------------------------------------------------------
  searchInput.addEventListener("input", () => {
    state.query = searchInput.value;
    renderList();
  });

  document.querySelectorAll(".seg").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.tab = btn.dataset.tab;
      state.series = "";
      document.querySelectorAll(".seg").forEach((b) => {
        const on = b === btn;
        b.classList.toggle("active", on);
        b.setAttribute("aria-selected", String(on));
      });
      refresh();
    });
  });

  chipsMount.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-series]");
    if (!chip) return;
    state.series = chip.dataset.series;
    refresh();
  });

  listMount.addEventListener("click", async (e) => {
    const save = e.target.closest(".sermon-row-save");
    if (save) {
      e.stopPropagation();
      const title = save.dataset.title;
      const isSaved = save.classList.contains("saved");
      save.disabled = true;
      const { error } = isSaved
        ? await supabase.from("saved_sermons").delete().eq("user_id", authUser.id).eq("sermon_title", title)
        : await supabase.from("saved_sermons").insert({ user_id: authUser.id, sermon_title: title });
      save.disabled = false;
      if (error) {
        alert(`Couldn't ${isSaved ? "remove" : "save"} "${title}": ${error.message}`);
        return;
      }
      if (isSaved) saved.delete(title);
      else saved.add(title);
      save.classList.toggle("saved", !isSaved);
      return;
    }
    const row = e.target.closest(".sermon-row");
    if (row) location.href = `watch.html?kind=${row.dataset.kind}&id=${encodeURIComponent(row.dataset.id)}`;
  });

  listMount.addEventListener("keydown", (e) => {
    const row = e.target.closest(".sermon-row");
    if (row && e.target === row && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      location.href = `watch.html?kind=${row.dataset.kind}&id=${encodeURIComponent(row.dataset.id)}`;
    }
  });

  refresh();
}
