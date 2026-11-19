// components/giving-history.js — lists the signed-in user's recorded gifts.
import { bootApp } from "../App.js";
import { ICONS } from "../icons.js";
import { requireAuth } from "../auth.js";
import { supabase } from "../supabaseClient.js";

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export async function renderGivingHistory() {
  const authUser = await requireAuth();
  if (!authUser) return;

  bootApp({ back: true, backHref: "profile.html", rightIcon: null, title: "Giving" });

  const listMount = document.getElementById("giving-list");
  const emptyMsg = document.getElementById("giving-empty");
  const totalEl = document.getElementById("giving-total");

  const { data, error } = await supabase
    .from("gifts")
    .select("*")
    .eq("user_id", authUser.id)
    .order("created_at", { ascending: false });

  if (error) {
    listMount.innerHTML = `<p style="color:var(--red);font-size:14px;">Couldn't load your giving history: ${error.message}</p>`;
    return;
  }

  const total = data.reduce((sum, g) => sum + Number(g.amount), 0);
  totalEl.textContent = `Total given: MWK ${total.toLocaleString()}`;

  if (!data.length) {
    emptyMsg.style.display = "block";
    return;
  }

  listMount.innerHTML = data
    .map(
      (g) => `
    <div class="list-row" style="cursor:default;">
      <div class="row-icon">${ICONS.heart}</div>
      <div class="row-body">
        <p class="row-title">${g.fund} \u00b7 MWK ${Number(g.amount).toLocaleString()}</p>
        <p class="row-sub">${formatDate(g.created_at)} \u00b7 ${g.payment_method || "\u2014"}</p>
      </div>
    </div>`
    )
    .join("");
}
