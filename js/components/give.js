// components/give.js — renders the Give page from data/give.json and
// handles the fund / amount / payment-method selection state.
// On submit it writes a real row to Supabase's `gifts` table.
import { bootApp, loadData } from "../App.js";
import { requireAuth } from "../auth.js";
import { supabase } from "../supabaseClient.js";

export async function renderGive() {
  const authUser = await requireAuth();
  if (!authUser) return;

  bootApp({ rightIcon: "receipt" });

  const data = await loadData("data/give.json");

  document.getElementById("give-verse").textContent = data.verse;

  const state = {
    fund: data.funds[0].name,
    amount: data.defaultAmount,
    pay: data.paymentMethods[0],
  };

  // Funds
  const fundGrid = document.getElementById("fund-grid");
  fundGrid.innerHTML = data.funds
    .map(
      (f, i) => `
      <div class="fund-card${i === 0 ? " active" : ""}" data-fund="${f.name}">
        <b>${f.name}</b>
        <span>${f.desc}</span>
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

  // Amounts
  const amountRow = document.getElementById("amount-row");
  amountRow.innerHTML = data.amounts
    .map(
      (amt) =>
        `<div class="amount-chip${amt === data.defaultAmount ? " active" : ""}" data-amt="${amt}">${amt.toLocaleString()}</div>`
    )
    .join("");

  const amountInput = document.getElementById("amount-input");
  amountInput.value = data.defaultAmount;

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

  // Payment methods
  const payMount = document.getElementById("pay-methods");
  payMount.innerHTML = data.paymentMethods
    .map(
      (name, i) => `
      <div class="pay-method${i === 0 ? "" : " dim"}" data-pay="${name}">
        <span>${name}</span>
        <span class="${i === 0 ? "radio-dot" : "radio-empty"}"></span>
      </div>`
    )
    .join("");

  payMount.querySelectorAll(".pay-method").forEach((el) => {
    el.addEventListener("click", () => {
      payMount.querySelectorAll(".pay-method").forEach((c) => {
        c.classList.add("dim");
        c.querySelector(".radio-dot, .radio-empty").outerHTML = '<span class="radio-empty"></span>';
      });
      el.classList.remove("dim");
      el.querySelector(".radio-dot, .radio-empty").outerHTML = '<span class="radio-dot"></span>';
      state.pay = el.dataset.pay;
    });
  });

  // Submit
  const submitBtn = document.getElementById("give-submit");
  function updateSubmit() {
    const amt = isNaN(state.amount) ? 0 : state.amount;
    submitBtn.textContent = `Give MWK ${amt.toLocaleString()}`;
  }
  updateSubmit();

  submitBtn.addEventListener("click", async () => {
    if (!state.amount || state.amount <= 0) {
      alert("Enter an amount greater than zero.");
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = "Processing…";

    const { error } = await supabase.from("gifts").insert({
      user_id: authUser.id,
      fund: state.fund,
      amount: state.amount,
      payment_method: state.pay,
    });

    submitBtn.disabled = false;
    updateSubmit();

    if (error) {
      alert(`Something went wrong saving your gift: ${error.message}`);
      return;
    }
    alert(
      `Thank you! MWK ${state.amount.toLocaleString()} to ${state.fund} via ${state.pay} has been recorded.\n\n(This demo records the gift in the database — no real payment was processed.)`
    );
  });
}
