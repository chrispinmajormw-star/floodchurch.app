// _shared/gateway.ts — the ONLY file that knows how to talk to the payment gateway (PayChangu).
// To use a different gateway later (e.g. Flutterwave), write another object with the same two
// methods, createCheckout and verify; nothing else needs to change.
//
// NOTE: the request/response field names below follow PayChangu's published "standard checkout"
// API. Always confirm them against https://developer.paychangu.com with a TEST key before taking
// real money (the setup steps in the update notes include a test payment).

export type CheckoutInput = {
  amount: number;
  currency: string;
  email: string;
  firstName: string;
  lastName: string;
  txRef: string;
  callbackUrl: string; // the gateway calls this (our webhook) when the payment finishes
  returnUrl: string; // where the member's browser is sent back to
  title: string;
  description: string;
  fund: string;
};

export type Verification = {
  state: "success" | "pending" | "failed";
  amount: number;
  currency: string;
  method: string | null;
};

export interface Gateway {
  name: string;
  createCheckout(input: CheckoutInput): Promise<{ checkoutUrl: string }>;
  verify(txRef: string): Promise<Verification>;
}

export class GatewayError extends Error {}

function pickMethod(data: Record<string, unknown>): string | null {
  const auth = (data.authorization ?? {}) as Record<string, unknown>;
  const raw = auth.provider ?? auth.channel ?? data.channel ?? data.payment_channel ?? null;
  const text = typeof raw === "string" ? raw.trim().slice(0, 60) : "";
  return text || null;
}

export function mapState(status: unknown): Verification["state"] {
  const s = String(status ?? "").toLowerCase();
  if (["success", "successful", "completed", "paid"].includes(s)) return "success";
  if (["failed", "cancelled", "canceled", "declined", "expired", "error"].includes(s)) return "failed";
  return "pending";
}

export function paychangu(secretKey: string, baseUrl = "https://api.paychangu.com"): Gateway {
  const base = baseUrl.replace(/\/+$/, "");
  const headers = { Authorization: `Bearer ${secretKey}`, Accept: "application/json", "Content-Type": "application/json" };

  return {
    name: "paychangu",

    async createCheckout(input) {
      let res: Response;
      try {
        res = await fetch(`${base}/payment`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            amount: String(input.amount),
            currency: input.currency,
            email: input.email,
            first_name: input.firstName,
            last_name: input.lastName,
            callback_url: input.callbackUrl,
            return_url: input.returnUrl,
            tx_ref: input.txRef,
            customization: { title: input.title.slice(0, 60), description: input.description.slice(0, 120) },
            meta: { fund: input.fund },
          }),
        });
      } catch (_e) {
        throw new GatewayError("Couldn't reach the payment service.");
      }
      const body = await res.json().catch(() => null);
      const url = body?.data?.checkout_url;
      if (!res.ok || typeof url !== "string" || !/^https:\/\//i.test(url)) {
        throw new GatewayError(String(body?.message ?? `The payment service returned an error (${res.status}).`));
      }
      return { checkoutUrl: url };
    },

    async verify(txRef) {
      let res: Response;
      try {
        res = await fetch(`${base}/verify-payment/${encodeURIComponent(txRef)}`, { method: "GET", headers });
      } catch (_e) {
        throw new GatewayError("Couldn't reach the payment service.");
      }
      // The gateway doesn't know this payment (the member never got as far as paying): still pending.
      if (res.status === 404) return { state: "pending", amount: 0, currency: "", method: null };
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.data) throw new GatewayError(String(body?.message ?? `Verification failed (${res.status}).`));
      const data = body.data as Record<string, unknown>;
      return {
        state: mapState(data.status),
        amount: Number(data.amount),
        currency: String(data.currency ?? "MWK").toUpperCase(),
        method: pickMethod(data),
      };
    },
  };
}

/** Checks the gateway's signature on a webhook: HMAC-SHA256 of the raw body, as hex. */
export async function signatureValid(rawBody: string, header: string | null, secret: string): Promise<boolean> {
  if (!header || !secret) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  const expected = Array.from(mac).map((b) => b.toString(16).padStart(2, "0")).join("");
  const given = header.trim().toLowerCase();
  if (given.length !== expected.length) return false;
  let diff = 0; // compare without stopping at the first difference, so timing reveals nothing
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}
