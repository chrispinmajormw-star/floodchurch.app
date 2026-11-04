// _shared/giving.ts — the rules of giving, in one place:
//   • what's an allowed amount / fund
//   • starting a payment attempt
//   • finishing it (checking with the gateway, then recording the gift exactly once)
// A gift is written to the `gifts` table ONLY here, and ONLY after the money is confirmed
// (or, in test mode, as a clearly marked "demo" gift).
import type { Gateway } from "./gateway.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export const MAX_AMOUNT = 20_000_000;
export const DEFAULT_MIN = 500;
const FALLBACK_FUNDS = ["Tithe", "Offering", "Limitless Transformation", "Missions"];
const EXPIRE_AFTER_MS = 48 * 3600 * 1000;

export type Mode = "live" | "demo" | "off";

/** live = real money (gateway keys are set) · demo = test, no money · off = giving not switched on yet */
export function currentMode(): Mode {
  if (Deno.env.get("PAYCHANGU_SECRET_KEY")) return "live";
  if ((Deno.env.get("GIVING_DEMO") ?? "").toLowerCase() === "on") return "demo";
  return "off";
}

export function newTxRef(): string {
  return "FLD-" + crypto.randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase();
}

export function validateAmount(amount: unknown, min: number): string | null {
  if (typeof amount !== "number" || !Number.isFinite(amount) || !Number.isInteger(amount)) return "Please enter a whole number of kwacha.";
  if (amount < min) return `The smallest gift is MWK ${min.toLocaleString("en-US")}.`;
  if (amount > MAX_AMOUNT) return `That's more than we can take online in one gift (MWK ${MAX_AMOUNT.toLocaleString("en-US")}). Please contact the church office.`;
  return null;
}

export async function minimumAmount(db: Db): Promise<number> {
  const { data } = await db.from("site_settings").select("give_min_amount").eq("id", 1).maybeSingle();
  const n = Number(data?.give_min_amount);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MIN;
}

export async function fundIsValid(db: Db, name: string): Promise<boolean> {
  const { data, error } = await db.from("giving_funds").select("name").eq("name", name);
  if (error || !Array.isArray(data) || data.length === 0) return FALLBACK_FUNDS.includes(name); // table not set up yet
  return data.length > 0;
}

export async function createAttempt(db: Db, a: { txRef: string; userId: string; fund: string; amount: number; provider: string }) {
  const { error } = await db.from("payment_attempts").insert({
    tx_ref: a.txRef, user_id: a.userId, fund: a.fund, amount: a.amount, currency: "MWK", provider: a.provider, status: "pending",
  });
  if (error) throw new Error(`Could not start the payment: ${error.message}`);
}

export async function getAttempt(db: Db, txRef: string) {
  const { data, error } = await db.from("payment_attempts").select("*").eq("tx_ref", txRef);
  if (error) throw new Error(error.message);
  return Array.isArray(data) && data.length ? data[0] : null;
}

async function markAttempt(db: Db, txRef: string, patch: Record<string, unknown>) {
  const { error } = await db.from("payment_attempts").update(patch).eq("tx_ref", txRef);
  if (error) throw new Error(`Could not update the payment: ${error.message}`);
}

/** Writes the gift. A repeat (same reference) is fine and is ignored, so nothing is ever counted twice. */
async function recordGift(db: Db, attempt: Record<string, unknown>, provider: string, method: string | null) {
  const { error } = await db.from("gifts").insert({
    user_id: attempt.user_id, fund: attempt.fund, amount: attempt.amount, currency: attempt.currency ?? "MWK",
    payment_method: method ?? (provider === "demo" ? "Test (no money)" : "Online"), tx_ref: attempt.tx_ref, provider,
  });
  if (error && error.code !== "23505") throw new Error(`Could not record the gift: ${error.message}`);
}

export type Outcome = { state: "completed" | "pending" | "failed" | "unknown"; attempt: Record<string, unknown> | null };

/** Test mode: record straight away, flagged as a demo gift (no money moved). */
export async function completeDemo(db: Db, txRef: string): Promise<Outcome> {
  const attempt = await getAttempt(db, txRef);
  if (!attempt) return { state: "unknown", attempt: null };
  await recordGift(db, attempt, "demo", "Test (no money)");
  await markAttempt(db, txRef, { status: "completed", provider_status: "demo", payment_method: "Test (no money)", completed_at: new Date().toISOString() });
  return { state: "completed", attempt: { ...attempt, status: "completed" } };
}

/** Asks the gateway what happened to a payment and brings our records up to date. Safe to call repeatedly. */
export async function finalizeAttempt(db: Db, gateway: Gateway | null, txRef: string): Promise<Outcome> {
  const attempt = await getAttempt(db, txRef);
  if (!attempt) return { state: "unknown", attempt: null };
  if (attempt.status === "completed") return { state: "completed", attempt };
  if (attempt.provider === "demo") return { state: attempt.status === "failed" ? "failed" : "pending", attempt };
  if (!gateway) return { state: "pending", attempt }; // can't check right now: leave it for the webhook / next try

  let v;
  try {
    v = await gateway.verify(txRef);
  } catch (_e) {
    return { state: "pending", attempt }; // gateway unreachable: don't call it failed
  }

  if (v.state === "success") {
    if (Number(v.amount) !== Number(attempt.amount) || (v.currency || "MWK") !== (attempt.currency ?? "MWK")) {
      await markAttempt(db, txRef, { status: "failed", provider_status: "amount_mismatch" });
      return { state: "failed", attempt: { ...attempt, status: "failed" } };
    }
    await recordGift(db, attempt, attempt.provider as string, v.method);
    await markAttempt(db, txRef, { status: "completed", provider_status: "success", payment_method: v.method, completed_at: new Date().toISOString() });
    return { state: "completed", attempt: { ...attempt, status: "completed", payment_method: v.method } };
  }

  if (v.state === "failed") {
    if (attempt.status !== "failed") await markAttempt(db, txRef, { status: "failed", provider_status: "failed" });
    return { state: "failed", attempt: { ...attempt, status: "failed" } };
  }

  // Still pending. Never-finished attempts eventually close themselves.
  const age = Date.now() - new Date(String(attempt.created_at ?? Date.now())).getTime();
  if (age > EXPIRE_AFTER_MS) {
    await markAttempt(db, txRef, { status: "failed", provider_status: "expired" });
    return { state: "failed", attempt: { ...attempt, status: "failed" } };
  }
  return { state: "pending", attempt };
}
