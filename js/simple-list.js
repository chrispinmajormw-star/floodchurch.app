// simple-list.js — shared "list of things you can apply to" logic, used by
// Discipleship, Be Involved, and Profile's Serve in the Church section.
// Tapping an item opens an application form; submitting it inserts into
// Supabase's `applications` table, visible to admins from the dashboard.
import { bootApp } from "./App.js";
import { requireAuth } from "./auth.js";
import { supabase } from "./supabaseClient.js";
import { ICONS } from "./icons.js";

/** Creates the shared application modal in the DOM once, if not already there. */
export function ensureApplyModal() {
  if (document.getElementById("apply-modal")) return;
  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.id = "apply-modal";
  modal.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-header">
        <h2 class="section-title" style="margin:0;" id="apply-modal-title">Apply</h2>
        <button class="modal-close" id="apply-modal-close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="auth-error" id="apply-error"></div>
      <div class="auth-error" id="apply-success" style="color:#8fd19e;background:rgba(80,200,120,0.1);border-color:rgba(80,200,120,0.4);"></div>
      <form id="apply-form">
        <div class="auth-field">
          <label>Full name</label>
          <input class="auth-input" type="text" id="apply-name" required>
        </div>
        <div class="auth-field">
          <label>Email address</label>
          <input class="auth-input" type="email" id="apply-email" required>
        </div>
        <div class="auth-field">
          <label>Phone number</label>
          <input class="auth-input" type="tel" id="apply-phone">
        </div>
        <div class="auth-field" id="apply-location-field">
          <label>Location</label>
          <input class="auth-input" type="text" id="apply-location">
        </div>
        <div class="auth-field">
          <label id="apply-reason-label">Why are you interested?</label>
          <textarea class="amount-input" style="border-radius:var(--radius-md); min-height:90px; font-weight:400; font-size:14.5px;" id="apply-reason" required></textarea>
        </div>
        <button class="btn btn-primary auth-submit" type="submit" id="apply-submit">Submit application</button>
      </form>
    </div>`;
  document.body.appendChild(modal);

  modal.querySelector("#apply-modal-close").addEventListener("click", () => modal.classList.remove("open"));
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.remove("open");
  });
}

/**
 * Wires click-to-apply behavior onto every `[data-name]` element inside
 * `container`. Call `ensureApplyModal()` once before this on the page.
 */
export function wireApplyRows(container, { authUser, profileName, category, requireLocation = true }) {
  const modal = document.getElementById("apply-modal");
  const form = document.getElementById("apply-form");
  const errorBox = document.getElementById("apply-error");
  const successBox = document.getElementById("apply-success");
  const submitBtn = document.getElementById("apply-submit");
  const locationField = document.getElementById("apply-location-field");
  const locationInput = document.getElementById("apply-location");

  container.querySelectorAll("[data-name]").forEach((el) => {
    el.addEventListener("click", () => {
      const itemName = el.dataset.name;
      document.getElementById("apply-modal-title").textContent = `Apply — ${itemName}`;
      document.getElementById("apply-reason-label").textContent = `Why are you interested in ${itemName}?`;
      document.getElementById("apply-name").value = profileName || "";
      document.getElementById("apply-email").value = authUser.email || "";
      document.getElementById("apply-phone").value = "";
      locationInput.value = "";
      document.getElementById("apply-reason").value = "";
      locationField.style.display = requireLocation ? "block" : "none";
      locationInput.required = requireLocation;
      errorBox.classList.remove("show");
      successBox.classList.remove("show");
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit application";
      form.dataset.itemName = itemName;
      modal.classList.add("open");
    });
  });

  form.onsubmit = async (e) => {
    e.preventDefault();
    errorBox.classList.remove("show");
    successBox.classList.remove("show");
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting…";

    const { error: insertError } = await supabase.from("applications").insert({
      category,
      item_name: form.dataset.itemName,
      user_id: authUser.id,
      name: document.getElementById("apply-name").value.trim(),
      email: document.getElementById("apply-email").value.trim(),
      phone: document.getElementById("apply-phone").value.trim(),
      location: requireLocation ? locationInput.value.trim() : null,
      reason: document.getElementById("apply-reason").value.trim(),
    });

    if (insertError) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit application";
      errorBox.textContent = insertError.message;
      errorBox.classList.add("show");
      return;
    }

    successBox.textContent = "Application submitted! Someone from the church will be in touch.";
    successBox.classList.add("show");
    submitBtn.textContent = "Submitted ✓";
    setTimeout(() => modal.classList.remove("open"), 1400);
  };
}

/** Full standalone page renderer — used by Discipleship and Be Involved. */
export async function renderSimpleListPage({
  table,
  title,
  backHref = "profile.html",
  mountId,
  emptyId,
  category,
  requireLocation = true,
}) {
  const authUser = await requireAuth();
  if (!authUser) return;

  bootApp({ back: true, backHref, rightIcon: null, title });
  ensureApplyModal();

  const mount = document.getElementById(mountId);
  const emptyMsg = emptyId ? document.getElementById(emptyId) : null;

  const [{ data, error }, { data: profile }] = await Promise.all([
    supabase.from(table).select("*").order("sort_order"),
    supabase.from("profiles").select("name").eq("id", authUser.id).maybeSingle(),
  ]);

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
    .map(
      (row) => `
    <div class="list-row" style="cursor:pointer;" data-name="${row.name}">
      <div class="row-body">
        <p class="row-title">${row.name}</p>
        ${row.description ? `<p class="row-sub">${row.description}</p>` : ""}
      </div>
      <div class="chevron">${ICONS.chevron}</div>
    </div>`
    )
    .join("");

  wireApplyRows(mount, { authUser, profileName: profile?.name, category, requireLocation });
}
