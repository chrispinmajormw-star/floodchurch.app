// components/devotions.js — every devotion posted so far, newest first. Tap one to read it.
import { bootApp } from "../App.js";
import { ICONS } from "../icons.js";
import { requireAuth } from "../auth.js";
import { supabase } from "../supabaseClient.js";
import { escapeHtml } from "../util.js";

function prettyDate(isoDate) {
  const d = new Date(`${isoDate}T00:00:00`);
  return isNaN(d) ? isoDate : d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

export async function renderDevotions() {
  const authUser = await requireAuth();
  if (!authUser) return;

  bootApp({ back: true, backHref: "media.html", rightIcon: null, title: "Devotions" });

  const mount = document.getElementById("devotion-list");
  const emptyMsg = document.getElementById("devotion-empty");

  const { data, error } = await supabase
    .from("devotions")
    .select("*")
    .order("devotion_date", { ascending: false })
    .limit(100);

  if (error) {
    mount.innerHTML = `<p style="color:var(--red);font-size:14px;">${escapeHtml(error.message)}</p>`;
    return;
  }
  if (!data.length) {
    emptyMsg.style.display = "block";
    return;
  }

  // The newest devotion starts open; the rest are tucked away until tapped.
  mount.innerHTML = data
    .map(
      (d, i) => `
    <details class="card devo-item"${i === 0 ? " open" : ""}>
      <summary>
        <div>
          <b>${escapeHtml(d.title)}</b>
          <span class="devo-meta">${escapeHtml(prettyDate(d.devotion_date))}${d.tag ? " \u00b7 " + escapeHtml(d.tag) : ""}</span>
        </div>
        <span class="faq-chevron">${ICONS.chevron}</span>
      </summary>
      <p class="devo-body"><b>${escapeHtml(d.reference || "")}${d.reference ? ":" : ""}</b> ${escapeHtml(d.body)}</p>
    </details>`
    )
    .join("");
}
