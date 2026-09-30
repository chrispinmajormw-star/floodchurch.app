// simple-list.js — shared renderer for pages that are just "a list of named
// things, each optionally linking somewhere" (Discipleship, Be Involved).
// A row with a link opens it in a new tab; without one, it shows a friendly
// "not set up yet" message — same pattern as Serve in the Church.
import { bootApp } from "./App.js";
import { requireAuth } from "./auth.js";
import { supabase } from "./supabaseClient.js";
import { ICONS } from "./icons.js";

export async function renderSimpleListPage({ table, title, backHref = "profile.html", mountId, emptyId }) {
  const authUser = await requireAuth();
  if (!authUser) return;

  bootApp({ back: true, backHref, rightIcon: null, title });

  const mount = document.getElementById(mountId);
  const emptyMsg = emptyId ? document.getElementById(emptyId) : null;

  const { data, error } = await supabase.from(table).select("*").order("sort_order");

  if (error) {
    mount.innerHTML = `<p style="color:var(--red);font-size:14px;">${error.message}</p>`;
    return;
  }

  const rows = data || [];
  if (!rows.length) {
    if (emptyMsg) emptyMsg.style.display = "block";
    return;
  }

  mount.innerHTML = rows
    .map((row) => {
      const inner = `
        <div class="row-body">
          <p class="row-title">${row.name}</p>
          ${row.description ? `<p class="row-sub">${row.description}</p>` : ""}
        </div>
        <div class="chevron">${ICONS.chevron}</div>`;
      return row.link
        ? `<a class="list-row" href="${row.link}" target="_blank" rel="noopener">${inner}</a>`
        : `<div class="list-row" style="cursor:pointer;" data-noform="${row.name}">${inner}</div>`;
    })
    .join("");

  mount.querySelectorAll("[data-noform]").forEach((el) => {
    el.addEventListener("click", () => {
      alert(`${el.dataset.noform} isn't set up yet — check back soon.`);
    });
  });
}
