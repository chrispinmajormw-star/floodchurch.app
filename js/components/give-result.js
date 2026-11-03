// components/give-result.js — where you land after paying. It asks the server "did the money arrive?"
// (the server checks with the gateway — this page never decides that itself) and tells you plainly.
// Mobile-money approvals can take a few minutes, so while it's pending the page keeps checking.
import { bootApp } from "../App.js";
import { ICONS } from "../icons.js";
import { requireAuth } from "../auth.js";
import { supabase } from "../supabaseClient.js";
import { escapeHtml } from "../util.js";

const RECHECK_MS = 4000;
const MAX_AUTO_CHECKS = 8;

export async function renderGiveResult() {
  const authUser = await requireAuth();
  if (!authUser) return;

  bootApp({ back: true, backHref: "give.html", rightIcon: null, title: "Your gift" });
  const root = document.getElementById("give-result");
  const txRef = new URLSearchParams(location.search).get("tx_ref");

  const card = (icon, title, body, buttons = "", extra = "") =>
    (root.innerHTML = `
    <div class="result-card">
      <div class="result-icon ${icon.cls}">${icon.svg}</div>
      <h1 class="result-title">${title}</h1>
      <p class="result-body">${body}</p>
      ${extra}
      <div class="result-actions">${buttons}</div>
    </div>`);
  const ok = { cls: "ok", svg: ICONS.check };
  const wait = { cls: "wait", svg: ICONS.clock };
  const bad = { cls: "bad", svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>' };
  const link = (href, label, primary) => `<a class="btn ${primary ? "btn-primary" : "btn-ghost-dark"}" href="${href}">${label}</a>`;

  if (!txRef) {
    card(bad, "We couldn\u2019t find that payment", "Please start again from the Give page.", link("give.html", "Go to Give", true));
    return;
  }

  const showChecking = () => card(wait, "Confirming your gift\u2026", "Please wait a moment while we check that the payment went through.");

  /** Asks the server. Returns { state, … } or { error }. */
  async function check() {
    const { data, error } = await supabase.functions.invoke("give-verify", { body: { tx_ref: txRef } });
    if (error || !data) return { error: true };
    return data;
  }

  function show(res, canRecheck = true) {
    if (res.error) {
      card(wait, "We couldn\u2019t check right now", "Please check your internet connection. If you already paid, your gift will still be recorded once we can confirm it.",
        `<button class="btn btn-primary" id="recheck">Check again</button>${link("index.html", "Back to Home", false)}`);
    } else if (res.state === "completed") {
      const amount = `MWK ${Number(res.amount).toLocaleString()}`;
      card(ok, "Thank you!", `Your gift of <b>${escapeHtml(amount)}</b> to <b>${escapeHtml(res.fund)}</b> has been received.${res.method && !res.demo ? ` <span class="result-method">Paid with ${escapeHtml(res.method)}.</span>` : ""}`,
        `${link("giving-history.html", "See my giving", true)}${link("index.html", "Done", false)}`,
        res.demo ? '<p class="result-demo"><b>Test mode.</b> No real money was taken, and this isn\u2019t a real gift.</p>' : "");
    } else if (res.state === "failed") {
      card(bad, "The payment didn\u2019t go through", `No gift has been recorded. If money was taken from your account, please contact the church office and quote this reference: <b>${escapeHtml(txRef)}</b>.`,
        `${link("give.html", "Try again", true)}${link("connect.html", "Contact the church", false)}`);
    } else {
      card(wait, "Almost there", "We haven\u2019t had confirmation yet. If you approved the payment on your phone, it can take a few minutes. You can leave this page \u2014 your gift will appear in your giving history as soon as it\u2019s confirmed.",
        `${canRecheck ? '<button class="btn btn-primary" id="recheck">Check again</button>' : ""}${link("index.html", "Back to Home", false)}`);
    }
    const again = document.getElementById("recheck");
    if (again) again.addEventListener("click", run);
  }

  async function run() {
    showChecking();
    let res = await check();
    for (let i = 0; i < MAX_AUTO_CHECKS && !res.error && res.state === "pending"; i++) {
      show(res, false); // tell them it's pending while we keep trying quietly
      await new Promise((r) => setTimeout(r, RECHECK_MS));
      res = await check();
    }
    show(res, true);
  }

  await run();
}
