// components/help.js — expandable FAQ list (from the faqs table, falling back to
// data/faq.json if the table isn't there yet) and contact buttons that use the
// church office email/phone saved in the admin dashboard.
import { bootApp, loadData } from "../App.js";
import { requireAuth } from "../auth.js";
import { ICONS } from "../icons.js";
import { supabase } from "../supabaseClient.js";
import { getSiteSettings } from "../site-settings.js";
import { escapeHtml } from "../util.js";

export async function renderHelp() {
  const authUser = await requireAuth();
  if (!authUser) return;

  bootApp({ back: true, backHref: "settings.html", rightIcon: null, title: "Help" });

  const [faqRes, site] = await Promise.all([
    supabase.from("faqs").select("*").order("sort_order"),
    getSiteSettings(),
  ]);

  let faqs = !faqRes.error && faqRes.data && faqRes.data.length
    ? faqRes.data.map((r) => ({ q: r.question, a: r.answer }))
    : null;
  if (!faqs) {
    try {
      faqs = (await loadData("data/faq.json")).faqs;
    } catch (e) {
      faqs = [];
    }
  }

  const mount = document.getElementById("faq-list");
  mount.innerHTML = faqs
    .map(
      (item, i) => `
    <div class="card faq-item" style="margin-bottom:12px;">
      <button class="faq-question" data-index="${i}">
        <span>${escapeHtml(item.q)}</span>
        <span class="faq-chevron">${ICONS.chevron}</span>
      </button>
      <div class="faq-answer" id="faq-answer-${i}">${escapeHtml(item.a)}</div>
    </div>`
    )
    .join("");

  mount.querySelectorAll(".faq-question").forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.closest(".faq-item").classList.toggle("open");
    });
  });

  // Contact buttons
  const actions = [];
  if (site.contact_email) {
    actions.push(
      `<a class="btn btn-primary" href="mailto:${escapeHtml(site.contact_email)}" style="width:100%; justify-content:center;">Email the office</a>`
    );
  }
  if (site.contact_phone) {
    actions.push(
      `<a class="btn btn-primary" href="tel:${escapeHtml(site.contact_phone.replace(/\s+/g, ""))}" style="width:100%; justify-content:center;">Call the office</a>`
    );
  }
  document.getElementById("contact-actions").innerHTML = actions.length
    ? actions.join("")
    : `<p style="color:var(--text-dim); font-size:13.5px; margin:0;">The office's contact details haven't been added yet — please ask at the church on Sunday.</p>`;
}
