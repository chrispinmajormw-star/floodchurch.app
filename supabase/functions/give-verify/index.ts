// give-verify — the page a member lands on after paying asks "did it go through?". We check with the
// gateway (never trusting the browser) and record the gift if the money is confirmed. Safe to call
// again and again.
//
// Deploy: npx supabase functions deploy give-verify --no-verify-jwt
import { CORS, getCaller, json, serviceClient } from "../_shared/http.ts";
import { paychangu } from "../_shared/gateway.ts";
import { finalizeAttempt, getAttempt } from "../_shared/giving.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  try {
    const caller = await getCaller(req);
    if (!caller) return json({ error: "Please sign in again." }, 401);

    const body = await req.json().catch(() => ({}));
    const txRef = typeof body.tx_ref === "string" ? body.tx_ref.trim() : "";
    if (!txRef) return json({ error: "Missing payment reference." }, 400);

    const db = serviceClient();
    const mine = await getAttempt(db, txRef);
    if (!mine || mine.user_id !== caller.id) return json({ error: "We couldn\u2019t find that payment." }, 404); // never reveal other members' payments

    const key = Deno.env.get("PAYCHANGU_SECRET_KEY");
    const gateway = key ? paychangu(key, Deno.env.get("PAYCHANGU_API_BASE") ?? undefined) : null;
    const { state, attempt } = await finalizeAttempt(db, gateway, txRef);

    return json({
      state,
      demo: attempt?.provider === "demo",
      fund: attempt?.fund ?? mine.fund,
      amount: Number(attempt?.amount ?? mine.amount),
      method: attempt?.payment_method ?? null,
    });
  } catch (e) {
    console.error("give-verify failed:", e);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
