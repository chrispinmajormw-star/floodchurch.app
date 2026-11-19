// components/auth-recovery.js — "Forgot password?" and "Choose a new password".
//
//   forgot-password.html : the person enters their email → Supabase emails them a link.
//   reset-password.html  : the link brings them here; they choose a new password.
//
// Supabase signs the person in with a one-time "recovery" session when they open the emailed link, and
// that session is what allows the password to be changed. The link works once and expires.
import "./auth-recovery.module.css";
import "../globals.module.css";
import { supabase } from "../supabaseClient.js";
import { applyPageClass, applySavedTheme } from "../util.js";

const MIN_PASSWORD = 8;

const $ = (id) => document.getElementById(id);
const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function showError(message) {
  const box = $("auth-error");
  if (!box) return;
  box.textContent = message;
  box.classList.toggle("show", Boolean(message));
}

const isRateLimit = (error) => Boolean(error) && (error.status === 429 || /rate limit|too many|security purposes/i.test(String(error.message || "")));

// ---------------------------------------------------------------------------------------------
// forgot-password.html
// ---------------------------------------------------------------------------------------------
/** @param {{cooldownSeconds?: number}} [options]  how long "Send again" is switched off after sending (default 60) */
export function renderForgotPassword({ cooldownSeconds = 60 } = {}) {
  applyPageClass("auth-recovery-page");
  applySavedTheme();
  const form = $("forgot-form");
  const input = $("email");
  const button = $("submit-btn");
  const note = $("auth-note");
  let busy = false;
  let timer = null;

  const fromLink = new URLSearchParams(location.search).get("email");
  if (fromLink) input.value = fromLink;

  function startCooldown() {
    let left = cooldownSeconds;
    button.disabled = true;
    const tick = () => {
      if (left <= 0) {
        clearInterval(timer);
        button.disabled = false;
        button.textContent = "Send the link again";
        return;
      }
      button.textContent = `Send again in ${left}s`;
      left--;
    };
    tick();
    timer = setInterval(tick, 1000);
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy || button.disabled) return;
    showError("");
    const email = input.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showError("Please enter the email address you signed up with.");
      return;
    }

    busy = true;
    button.disabled = true;
    button.textContent = "Sending…";
    // The emailed link brings the person back to reset-password.html next to this page.
    const redirectTo = new URL("reset-password.html", location.href).href;

    let error = null;
    try {
      ({ error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo }));
    } catch (e2) {
      error = { message: "network" };
    }
    busy = false;

    if (error) {
      button.disabled = false;
      button.textContent = "Send reset link";
      showError(
        isRateLimit(error)
          ? "We\u2019ve sent a lot of emails just now. Please wait a few minutes and try again."
          : "We couldn\u2019t send the email right now. Check your internet connection and try again."
      );
      return;
    }

    // The same message whether or not an account exists for this email, so nobody can use this page to
    // find out who has an account.
    note.hidden = false;
    note.innerHTML = `<b>Check your email.</b><br>If there is an account for <b>${escapeHtml(email)}</b>, we\u2019ve sent a link to choose a new password. It can take a few minutes, so look in your spam folder too. The link works once and expires after about an hour.`;
    startCooldown();
  });
}

// ---------------------------------------------------------------------------------------------
// reset-password.html
// ---------------------------------------------------------------------------------------------
/** @param {{waitMs?: number}} [options]  how long to wait for the emailed link to be recognised (default 3000) */
export async function renderResetPassword(): Promise<void>({ waitMs = 3000 } = {}) {
  const panels = { checking: $("reset-checking"), expired: $("reset-expired"), form: $("reset-form"), done: $("reset-done") };
  let stage = "checking";
  const show = (name) => {
    stage = name;
    for (const [key, el] of Object.entries(panels)) el.hidden = key !== name;
    $("reset-title").hidden = name === "done" || name === "expired"; // those two panels carry their own heading text
    if (name !== "form") showError("");
  };
  show("checking");

  // 1) The link itself may say it's no good (used already, or too old).
  const fromHash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const fromQuery = new URLSearchParams(location.search);
  if (fromHash.get("error") || fromHash.get("error_code") || fromQuery.get("error") || fromQuery.get("error_code")) {
    show("expired");
    return;
  }

  // 2) Supabase turns a good link into a temporary signed-in session. Wait for it (briefly).
  supabase.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY" && stage !== "done") show("form");
  });
  let session = null;
  try {
    ({ data: { session } } = await supabase.auth.getSession());
  } catch (e) {
    session = null;
  }
  if (session && stage === "checking") show("form");
  if (stage === "checking") {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    if (stage === "checking") show("expired");
  }

  // 3) Save the new password.
  const form = $("reset-form");
  const first = $("new-password");
  const second = $("confirm-password");
  const button = $("submit-btn");
  let busy = false;

  $("show-passwords").addEventListener("change", (e) => {
    first.type = second.type = e.target.checked ? "text" : "password";
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;
    showError("");
    if (first.value.length < MIN_PASSWORD) return showError(`Please use at least ${MIN_PASSWORD} characters.`);
    if (first.value !== second.value) return showError("The two passwords don\u2019t match. Please type them again.");

    busy = true;
    button.disabled = true;
    button.textContent = "Saving…";
    let error = null;
    try {
      ({ error } = await supabase.auth.updateUser({ password: first.value }));
    } catch (e2) {
      error = { message: "network" };
    }
    busy = false;
    button.disabled = false;
    button.textContent = "Save new password";

    if (error) {
      const msg = String(error.message || "");
      if (/same|different from the old|new password should be different/i.test(msg)) return showError("Please choose a password you haven\u2019t used before.");
      if (/session|jwt|not authenticated|expired|invalid.*token/i.test(msg)) return show("expired");
      if (/weak|at least|characters|password/i.test(msg) && msg !== "network") return showError(msg);
      return showError("We couldn\u2019t save your new password. Check your internet connection and try again.");
    }

    first.value = second.value = "";
    try {
      await supabase.auth.signOut({ scope: "others" }); // anyone else signed in with the old password is signed out
    } catch (e3) {
      /* not essential */
    }
    history.replaceState(null, "", location.pathname); // take the one-time link's code out of the address bar
    show("done");
  });
}
