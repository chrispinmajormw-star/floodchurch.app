// components/give.js — the Give page. You pick a fund and an amount; pressing Give asks the server to
// start a payment and sends you to the gateway's secure page, where you choose Airtel Money, TNM Mpamba,
// card or bank. A gift is only recorded once the server has confirmed the money (see give-result.html) —
// this page never writes a gift itself.
// Funds, quick amounts and the smallest gift come from the dashboard (data/give.json is the fallback).
import { bootApp, loadData } from "../App.js";
import { requireAuth } from "../auth.js";
import { supabase } from "../supabaseClient.js";
import { getSiteSettings } from "../site-settings.js";
import { escapeHtml } from "../util.js";

/**
 * "2000, 5,000 ; 10000" → [2000, 5000, 10000]. Understands both "5000" and "5,000", ignores anything
 * that isn't a whole number of kwacha, drops repeats, and gives at most 8 buttons.
 */
export function parseAmounts(text, fallback = []) {
  // First turn thousands-style numbers (5,000 / 1,250,000) into plain digits, then split on what's left.
  const plain = String(text ?? "").replace(/(?<![\d.])\d{1,3}(?:,\d{3})+(?!\d)/g, (m) => m.replace(/,/g, ""));
  const seen = [];
  for (const piece of plain.split(/[\s,;]+/)) {
    if (!/^\d+$/.test(piece)) continue;
    const n = Number(piece);
    if (n > 0 && n <= 20000000 && !seen.includes(n)) seen.push(n);
  }
  return seen.length ? seen.slice(0, 8) : fallback;
}

/** The plain-English reason a payment couldn't be started (the server's own message when it sent one). */
async function startErrorMessage(error) {
  try {
    if (error && error.context && typeof error.context.json === "function") {
      const body = await error.context.json();
      if (body && typeof body.error === "string") return body.error;
    }
  } catch (e) {
    /* fall through */
  }
  return "We couldn\u2019t start your gift. Check your internet connection and try again.";
}

export async function renderGive() {
  const authUser = await requireAuth();
  if (!authUser) return;

  bootApp({ rightIcon: "receipt", rightHref: "giving-history.html" });

  const [data, site, fundsRes] = await Promise.all([
    loadData("data/give.json"),
    getSiteSettings(),
    supabase.from("giving_funds").select("*").order("sort_order").order("id"),
  ]);

  document.getElementById("give-verse").textContent = data.verse;

  const funds = !fundsRes.error && fundsRes.data && fundsRes.data.length
    ? fundsRes.data.map((f) => ({ name: f.name, desc: f.description || "" }))
    : data.funds.map((f) => ({ name: f.name, desc: f.desc }));
  const amounts = parseAmounts(site.give_amounts, data.amounts);
  const minAmount = Number(site.give_min_amount) > 0 ? Number(site.give_min_amount) : 500;
  const startAmount = Number(site.give_default_amount) > 0 ? Number(site.give_default_amount) : data.defaultAmount;

  const state = { fund: funds[0].name, amount: startAmount };

  // ---- Funds ----------------------------------------------------------------
  const fundGrid = document.getElementById("fund-grid");
  fundGrid.innerHTML = funds
    .map(
      (f, i) => `
      <div class="fund-card${i === 0 ? " active" : ""}" data-fund="${escapeHtml(f.name)}">
        <b>${escapeHtml(f.name)}</b>
        <span>${escapeHtml(f.desc)}</span>
      </div>`
    )
    .join("");
  fundGrid.querySelectorAll(".fund-card").forEach((el) => {
    el.addEventListener("click", () => {
      fundGrid.querySelectorAll(".fund-card").forEach((c) => c.classList.remove("active"));
      el.classList.add("active");
      state.fund = el.dataset.fund;
    });
  });

  // ---- Amounts --------------------------------------------------------------
  const amountRow = document.getElementById("amount-row");
  const amountInput = document.getElementById("amount-input");
  amountRow.innerHTML = amounts
    .map((amt) => `<div class="amount-chip${amt === startAmount ? " active" : ""}" data-amt="${amt}">${amt.toLocaleString()}</div>`)
    .join("");
  amountInput.value = startAmount;
  document.getElementById("give-min").textContent = `Smallest gift: MWK ${minAmount.toLocaleString()}`;

  amountRow.querySelectorAll(".amount-chip").forEach((el) => {
    el.addEventListener("click", () => {
      amountRow.querySelectorAll(".amount-chip").forEach((c) => c.classList.remove("active"));
      el.classList.add("active");
      state.amount = parseInt(el.dataset.amt, 10);
      amountInput.value = state.amount;
      updateSubmit();
    });
  });
  amountInput.addEventListener("input", (e) => {
    amountRow.querySelectorAll(".amount-chip").forEach((c) => c.classList.remove("active"));
    state.amount = parseInt(e.target.value || "0", 10);
    updateSubmit();
  });

  // ---- Give -------------------------------------------------------------------
  const submitBtn = document.getElementById("give-submit");
  const errorEl = document.getElementById("give-error");
  function updateSubmit() {
    const amt = Number.isFinite(state.amount) ? state.amount : 0;
    submitBtn.textContent = `Give MWK ${amt.toLocaleString()}`;
  }
  updateSubmit();

  // Coming back with the Back button from the payment page should leave a usable page.
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) {
      submitBtn.disabled = false;
      updateSubmit();
    }
  });

  submitBtn.addEventListener("click", async () => {
    if (submitBtn.disabled) return; // a second tap while the first is being processed must never start a second payment
    errorEl.textContent = "";
    if (!Number.isInteger(state.amount) || state.amount < minAmount) {
      errorEl.textContent = `Please enter at least MWK ${minAmount.toLocaleString()}.`;
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = "Starting secure payment\u2026";

    const { data: res, error } = await supabase.functions.invoke("give-checkout", { body: { fund: state.fund, amount: state.amount } });

    if (error || !res) {
      errorEl.textContent = await startErrorMessage(error);
      submitBtn.disabled = false;
      updateSubmit();
      return;
    }
    if (res.mode === "demo" && res.tx_ref) {
      location.href = `give-result.html?tx_ref=${encodeURIComponent(res.tx_ref)}`; // test mode: no gateway
      return;
    }
    if (typeof res.checkout_url === "string" && /^https:\/\//i.test(res.checkout_url)) {
      location.href = res.checkout_url; // the gateway's secure page
      return;
    }
    errorEl.textContent = "We couldn\u2019t start your gift. Please try again.";
    submitBtn.disabled = false;
    updateSubmit();
  });
}
