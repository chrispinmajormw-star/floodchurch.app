// components/bible.js — renders the Bible page from data/bible.json
import { bootApp, loadData } from "../App.js";
import { requireAuth } from "../auth.js";

export async function renderBible() {
  const authUser = await requireAuth();
  if (!authUser) return;

  bootApp({ rightIcon: "bookmark" });

  const data = await loadData("data/bible.json");

  document.getElementById("daily-text").textContent = data.dailyReading.text;
  document.getElementById("daily-ref").textContent = data.dailyReading.reference;

  const plansMount = document.getElementById("plans");
  plansMount.innerHTML = data.readingPlans
    .map(
      (plan) => `
      <div class="plan-card">
        <div class="plan-top">
          <b>${plan.title}</b>
          <span>${plan.duration}</span>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${plan.percent}%"></div></div>
        <div class="plan-percent">${plan.percent}% complete</div>
      </div>`
    )
    .join("");
}
