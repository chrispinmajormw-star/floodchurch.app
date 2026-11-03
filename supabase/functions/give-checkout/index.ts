// give-checkout — starts a gift. The app sends { fund, amount }; we check it, record the attempt, and
// hand back the address of the gateway's secure payment page. (In test mode there is no gateway: the
// gift is recorded straight away, marked as a demo.)
//
// Deploy: npx supabase functions deploy give-checkout --no-verify-jwt
import { CORS, getCaller, json, serviceClient } from "../_shared/http.ts";
import { paychangu, GatewayError } from "../_shared/gateway.ts";
import { completeDemo, createAttempt, currentMode, fundIsValid, minimumAmount, newTxRef, validateAmount } from "../_shared/giving.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  try {
    const caller = await getCaller(req);
    if (!caller) return json({ error: "Please sign in again." }, 401);

    const mode = currentMode();
    if (mode === "off") {
      return json({ error: "Online giving isn\u2019t switched on yet. Please give at church, or ask the church office." }, 503);
    }

    const body = await req.json().catch(() => ({}));
    const fund = typeof body.fund === "string" ? body.fund.trim() : "";
    const amount = body.amount;

    const db = serviceClient();
    const amountProblem = validateAmount(amount, await minimumAmount(db));
    if (amountProblem) return json({ error: amountProblem }, 400);
    if (!fund || !(await fundIsValid(db, fund))) return json({ error: "Please choose one of the funds." }, 400);

    const txRef = newTxRef();
    await createAttempt(db, { txRef, userId: caller.id, fund, amount, provider: mode === "live" ? "paychangu" : "demo" });

    if (mode === "demo") {
      await completeDemo(db, txRef);
      return json({ mode: "demo", tx_ref: txRef });
    }

    const site = (Deno.env.get("SITE_URL") ?? "https://floodchurch.us.ci").replace(/\/+$/, "");
    const gateway = paychangu(Deno.env.get("PAYCHANGU_SECRET_KEY")!, Deno.env.get("PAYCHANGU_API_BASE") ?? undefined);
    const [firstName, ...rest] = caller.name.split(/\s+/);
    try {
      const { checkoutUrl } = await gateway.createCheckout({
        amount, currency: "MWK", email: caller.email, firstName: firstName || "Member", lastName: rest.join(" ") || "Flood",
        txRef, fund, title: "Flood Church giving", description: `${fund} gift`,
        callbackUrl: `${Deno.env.get("SUPABASE_URL")}/functions/v1/give-webhook`,
        returnUrl: `${site}/give-result.html?tx_ref=${encodeURIComponent(txRef)}`,
      });
      return json({ mode: "live", tx_ref: txRef, checkout_url: checkoutUrl });
    } catch (e) {
      await db.from("payment_attempts").update({ status: "failed", provider_status: "could_not_start" }).eq("tx_ref", txRef);
      console.error("give-checkout: gateway refused to start the payment:", e instanceof GatewayError ? e.message : e);
      return json({ error: "We couldn\u2019t start the payment right now. Please try again in a moment." }, 502);
    }
  } catch (e) {
    console.error("give-checkout failed:", e);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
