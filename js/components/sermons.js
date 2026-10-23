// components/sermons.js — the full Sermons library. Tap a sermon to play it in the app
// (YouTube links and uploaded video/audio); the bookmark saves it to Profile → Saved sermons.
import { bootApp } from "../App.js";
import { ICONS } from "../icons.js";
import { requireAuth } from "../auth.js";
import { supabase } from "../supabaseClient.js";
import { youtubeThumbnail } from "../player.js";
import { escapeHtml } from "../util.js";

const THUMB_GRADIENTS = [
  "linear-gradient(160deg, #1fb6c9, #0a4a52)",
  "linear-gradient(160deg, #a8500f, #241205)",
  "linear-gradient(160deg, #6b4fd6, #1c1240)",
  "linear-gradient(160deg, #2f8bff, #0b1d3a)",
];

function thumbBackground(sermon, i) {
  const picture = youtubeThumbnail(sermon.video_url);
  const gradient = THUMB_GRADIENTS[i % THUMB_GRADIENTS.length];
  return picture ? `url('${picture}') center/cover no-repeat, ${gradient}` : gradient;
}

export async function renderSermons() {
  const authUser = await requireAuth();
  if (!authUser) return;

  bootApp({ back: true, backHref: "media.html", rightIcon: null, title: "Sermons" });

  const mount = document.getElementById("sermon-list");
  const emptyMsg = document.getElementById("sermon-empty");

  const [sermonsRes, savedRes] = await Promise.all([
    supabase.from("sermons").select("*").order("created_at", { ascending: false }).limit(100),
    supabase.from("saved_sermons").select("sermon_title").eq("user_id", authUser.id),
  ]);

  if (sermonsRes.error) {
    mount.innerHTML = `<p style="color:var(--red);font-size:14px;">${escapeHtml(sermonsRes.error.message)}</p>`;
    return;
  }

  const sermons = sermonsRes.data || [];
  if (!sermons.length) {
    emptyMsg.style.display = "block";
    return;
  }

  const saved = new Set((savedRes.data || []).map((r) => r.sermon_title));

  mount.innerHTML = sermons
    .map(
      (s, i) => `
    <div class="sermon-row" data-index="${i}" role="button" tabindex="0">
      <div class="sermon-row-thumb" style="background:${thumbBackground(s, i)}">
        <span class="sermon-playicon">${ICONS.playFilled}</span>
      </div>
      <div class="sermon-row-body">
        <p class="sermon-title">${escapeHtml(s.title)}</p>
        <p class="sermon-sub">${escapeHtml([s.speaker, s.duration].filter(Boolean).join(" \u00b7 "))}</p>
      </div>
      <button class="icon-btn sermon-row-save${saved.has(s.title) ? " saved" : ""}" data-title="${escapeHtml(s.title)}" aria-label="Save sermon">${ICONS.bookmark}</button>
    </div>`
    )
    .join("");

  mount.querySelectorAll(".sermon-row").forEach((row) => {
    const go = () => {
      location.href = `watch.html?kind=sermon&id=${encodeURIComponent(sermons[Number(row.dataset.index)].id)}`;
    };
    row.addEventListener("click", go);
    row.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && e.target === row) {
        e.preventDefault();
        go();
      }
    });
  });

  // Bookmark: tap to save, tap again to remove.
  mount.querySelectorAll(".sermon-row-save").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const title = btn.dataset.title;
      const isSaved = btn.classList.contains("saved");
      btn.disabled = true;
      const { error } = isSaved
        ? await supabase.from("saved_sermons").delete().eq("user_id", authUser.id).eq("sermon_title", title)
        : await supabase.from("saved_sermons").insert({ user_id: authUser.id, sermon_title: title });
      btn.disabled = false;
      if (error) {
        alert(`Couldn't ${isSaved ? "remove" : "save"} "${title}": ${error.message}`);
        return;
      }
      btn.classList.toggle("saved", !isSaved);
    });
  });
}
