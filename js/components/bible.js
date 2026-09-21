// components/bible.js — renders the Bible page from data/bible.json,
// with real per-user progress from Supabase's reading_plan_progress table.
import { bootApp, loadData } from "../App.js";
import { requireAuth } from "../auth.js";
import { supabase } from "../supabaseClient.js";

const STEP = 5; // percent added each time "Mark today's reading" is tapped

export async function renderBible() {
  const authUser = await requireAuth();
  if (!authUser) return;

  bootApp({ rightIcon: "bookmark" });

  const [data, progressRes] = await Promise.all([
    loadData("data/bible.json"),
    supabase.from("reading_plan_progress").select("*").eq("user_id", authUser.id),
  ]);

  const progressByTitle = {};
  (progressRes.data || []).forEach((row) => {
    progressByTitle[row.plan_title] = row.percent;
  });

  document.getElementById("daily-text").textContent = data.dailyReading.text;
  document.getElementById("daily-ref").textContent = data.dailyReading.reference;

  const plansMount = document.getElementById("plans");

  function plansHTML() {
    return data.readingPlans
      .map((plan) => {
        const percent = progressByTitle[plan.title] ?? plan.percent;
        return `
      <div class="plan-card">
        <div class="plan-top">
          <b>${plan.title}</b>
          <span>${plan.duration}</span>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${percent}%"></div></div>
        <div class="plan-top" style="margin-top:8px; margin-bottom:0;">
          <span class="plan-percent">${percent}% complete</span>
          <button class="chip" data-plan="${plan.title}" style="padding:6px 12px;">Mark today's reading</button>
        </div>
      </div>`;
      })
      .join("");
  }

  function wireButtons() {
    plansMount.querySelectorAll("[data-plan]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const title = btn.dataset.plan;
        const current = progressByTitle[title] ?? data.readingPlans.find((p) => p.title === title).percent;
        const next = Math.min(100, current + STEP);

        btn.disabled = true;
        const { error } = await supabase
          .from("reading_plan_progress")
          .upsert(
            { user_id: authUser.id, plan_title: title, percent: next, updated_at: new Date().toISOString() },
            { onConflict: "user_id,plan_title" }
          );
        btn.disabled = false;

        if (error) {
          alert(`Couldn't save progress: ${error.message}`);
          return;
        }
        progressByTitle[title] = next;
        plansMount.innerHTML = plansHTML();
        wireButtons();
      });
    });
  }

  plansMount.innerHTML = plansHTML();
  wireButtons();
}
