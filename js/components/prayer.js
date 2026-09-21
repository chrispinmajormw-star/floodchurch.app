// components/prayer.js — submit and list the signed-in user's prayer requests.
import { bootApp } from "../App.js";
import { requireAuth } from "../auth.js";
import { supabase } from "../supabaseClient.js";

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins || 1}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export async function renderPrayer() {
  const authUser = await requireAuth();
  if (!authUser) return;

  bootApp({ back: true, backHref: "profile.html", rightIcon: null, title: "Prayer" });

  const listMount = document.getElementById("prayer-list");
  const emptyMsg = document.getElementById("prayer-empty");

  async function loadRequests() {
    const { data, error } = await supabase
      .from("prayer_requests")
      .select("*")
      .eq("user_id", authUser.id)
      .order("created_at", { ascending: false });

    if (error) {
      listMount.innerHTML = `<p style="color:var(--red);font-size:14px;">Couldn't load your requests: ${error.message}</p>`;
      return;
    }

    if (!data.length) {
      listMount.innerHTML = "";
      emptyMsg.style.display = "block";
      return;
    }
    emptyMsg.style.display = "none";
    listMount.innerHTML = data
      .map(
        (r) => `
      <div class="list-row" style="cursor:default;">
        <div class="row-body">
          <p class="row-title" style="font-weight:500; line-height:1.4;">${r.content}</p>
          <p class="row-sub">${timeAgo(r.created_at)}</p>
        </div>
      </div>`
      )
      .join("");
  }

  await loadRequests();

  const form = document.getElementById("prayer-form");
  const textarea = document.getElementById("prayer-content");
  const submitBtn = document.getElementById("prayer-submit");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const content = textarea.value.trim();
    if (!content) return;

    submitBtn.disabled = true;
    submitBtn.textContent = "Sending…";

    const { error } = await supabase
      .from("prayer_requests")
      .insert({ user_id: authUser.id, content });

    submitBtn.disabled = false;
    submitBtn.textContent = "Send request";

    if (error) {
      alert(`Couldn't send your request: ${error.message}`);
      return;
    }
    textarea.value = "";
    await loadRequests();
  });
}
