// give-webhook — the gateway tells us, server to server, that a payment finished. This is what makes
// giving reliable: even if a member closes the app while their mobile-money approval is pending, the
// gift is still recorded. We check the gateway's signature, then ask the gateway directly about the
// payment (we never trust the contents of the message on its own).
//
// Deploy: npx supabase functions deploy give-webhook --no-verify-jwt
// Then paste this function's URL into PayChangu's dashboard as the webhook / callback URL, and set
// the same secret as PAYCHANGU_WEBHOOK_SECRET.
import { json, serviceClient } from "../_shared/http.ts";
import { paychangu, signatureValid } from "../_shared/gateway.ts";
import { finalizeAttempt } from "../_shared/giving.ts";

/** Every plausible place a payment reference could be in the message; only ones we know about get used. */
function candidateRefs(payload: Record<string, unknown>): string[] {
  const data = (payload.data ?? {}) as Record<string, unknown>;
  const meta = (payload.meta ?? {}) as Record<string, unknown>;
  const refs = [payload.tx_ref, data.tx_ref, meta.tx_ref, payload.reference, data.reference, payload.charge_id];
  return [...new Set(refs.filter((r): r is string => typeof r === "string" && r.length > 0 && r.length < 80))].slice(0, 5);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const secret = Deno.env.get("PAYCHANGU_WEBHOOK_SECRET");
  const key = Deno.env.get("PAYCHANGU_SECRET_KEY");
  if (!secret || !key) return json({ error: "Not configured." }, 503);

  const raw = await req.text();
  const signature = req.headers.get("Signature") ?? req.headers.get("signature");
  if (!(await signatureValid(raw, signature, secret))) return json({ error: "Bad signature." }, 401);

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw);
  } catch (_e) {
    return json({ error: "Bad message." }, 400);
  }

  try {
    const db = serviceClient();
    const gateway = paychangu(key, Deno.env.get("PAYCHANGU_API_BASE") ?? undefined);
    let processed = 0;
    for (const ref of candidateRefs(payload)) {
      const { state } = await finalizeAttempt(db, gateway, ref);
      if (state !== "unknown") processed++;
    }
    return json({ received: true, processed });
  } catch (e) {
    console.error("give-webhook failed:", e);
    return json({ error: "Try again." }, 500); // a 5xx makes the gateway send it again later
  }
});
