// components/help.js — renders an expandable FAQ list from data/faq.json.
import { bootApp, loadData } from "../App.js";
import { requireAuth } from "../auth.js";
import { ICONS } from "../icons.js";

export async function renderHelp() {
  const authUser = await requireAuth();
  if (!authUser) return;

  bootApp({ back: true, backHref: "settings.html", rightIcon: null, title: "Help" });

  const data = await loadData("data/faq.json");
  const mount = document.getElementById("faq-list");

  mount.innerHTML = data.faqs
    .map(
      (item, i) => `
    <div class="card faq-item" style="margin-bottom:12px;">
      <button class="faq-question" data-index="${i}">
        <span>${item.q}</span>
        <span class="faq-chevron">${ICONS.chevron}</span>
      </button>
      <div class="faq-answer" id="faq-answer-${i}">${item.a}</div>
    </div>`
    )
    .join("");

  mount.querySelectorAll(".faq-question").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = btn.closest(".faq-item");
      item.classList.toggle("open");
    });
  });
}
