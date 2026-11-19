// components/saved-sermons.js — lists the signed-in user's saved sermons.
import { bootApp } from "../App.js";
import { ICONS } from "../icons.js";
import { requireAuth } from "../auth.js";
import { supabase } from "../supabaseClient.js";

export async function renderSavedSermons() {
  const authUser = await requireAuth();
  if (!authUser) return;

  bootApp({ back: true, backHref: "profile.html", rightIcon: null, title: "Saved Sermons" });

  const listMount = document.getElementById("saved-list");
  const emptyMsg = document.getElementById("saved-empty");

  const { data, error } = await supabase
    .from("saved_sermons")
    .select("*")
    .eq("user_id", authUser.id)
    .order("created_at", { ascending: false });

  if (error) {
    listMount.innerHTML = `<p style="color:var(--red);font-size:14px;">Couldn't load saved sermons: ${error.message}</p>`;
    return;
  }

  if (!data.length) {
    emptyMsg.style.display = "block";
    return;
  }

  listMount.innerHTML = data
    .map(
      (s) => `
    <div class="list-row" data-id="${s.id}">
      <div class="row-icon">${ICONS.bookmark}</div>
      <div class="row-body"><p class="row-title">${s.sermon_title}</p></div>
      <button class="icon-btn remove-btn" aria-label="Remove" style="width:32px;height:32px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>`
    )
    .join("");

  listMount.querySelectorAll(".remove-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const row = e.target.closest(".list-row");
      const id = row.dataset.id;
      const { error: delError } = await supabase.from("saved_sermons").delete().eq("id", id);
      if (delError) {
        alert(`Couldn't remove: ${delError.message}`);
        return;
      }
      row.remove();
      if (!listMount.children.length) emptyMsg.style.display = "block";
    });
  });
}
