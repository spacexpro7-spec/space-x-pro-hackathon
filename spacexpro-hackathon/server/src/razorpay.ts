// ============================================================================
//  RAZORPAY — THE ONE AND ONLY RAZORPAY INTEGRATION POINT
//  File: server/src/razorpay.ts
// ============================================================================
//  >>> INTEGRATOR: START HERE. Every Razorpay change belongs in THIS file. <<<
//  Nothing else in the codebase talks to Razorpay. Other files only carry a
//  one-line pointer comment back to this file.
//
//  STATUS TODAY (no behaviour is wired up yet):
//  - No real keys are stored anywhere in this codebase — ever.
//  - No checkout UI exists and no order is created.
//  - Until the steps below are done, the site uses the manual flow:
//    a participant submits a UPI reference / UTR, an organizer verifies it
//    in the Organizer area, and every payment honestly shows
//    "Pending Verification" (see `verifyPayment` in ./actions.ts).
//
//  TO INTEGRATE (3 steps — full walkthrough in README.md, "Integrating
//  Razorpay"):
//    1. Set the three environment variables named in the CONFIG block
//       below (names are also listed, grouped, in .env.example).
//    2. Fill in the three TODO stubs in this file: createRazorpayOrder,
//       verifyRazorpayPaymentSignature (helper already implemented), and
//       handleRazorpayWebhook.
//    3. From the payment flow, call these helpers, and only after a
//       signature / webhook has been verified, set the team's
//       paymentStatus to "verified" — the existing code then sends the
//       "Payment Verified" poster email to the team leader automatically.
//       Never mark a payment verified from the browser's success callback
//       alone, and NEVER send RAZORPAY_KEY_SECRET or
//       RAZORPAY_WEBHOOK_SECRET to the frontend — only the publishable
//       KEY ID may be used by checkout in the browser.
// ============================================================================

// ---------------------------------------------------------------------------
// 1. CONFIG — read from environment variables ONLY (no hard-coded keys)
// ---------------------------------------------------------------------------
// INTEGRATOR: paste/write nothing here. Just set these variables in the
// hosting environment:
//   RAZORPAY_KEY_ID        — e.g. the "Key Id" from Razorpay Dashboard
//   RAZORPAY_KEY_SECRET    — the matching secret (server-side only)
//   RAZORPAY_WEBHOOK_SECRET — the secret you set on the Razorpay webhook
export type RazorpayConfig = {
  keyId: string | null;
  keySecret: string | null;
  webhookSecret: string | null;
  /** True only when ALL three values are present in the environment. */
  configured: boolean;
};

function envValue(name: string): string | null {
  // Works in both the Bun runtime (process.env) and plain Node.
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const v = env?.[name]?.trim();
  return v ? v : null;
}

export function getRazorpayConfig(): RazorpayConfig {
  const keyId = envValue("RAZORPAY_KEY_ID");
  const keySecret = envValue("RAZORPAY_KEY_SECRET");
  const webhookSecret = envValue("RAZORPAY_WEBHOOK_SECRET");
  return { keyId, keySecret, webhookSecret, configured: Boolean(keyId && keySecret && webhookSecret) };
}

/** razorpayConfigured-style flag: false until all three env vars are set. */
export function isRazorpayConfigured(): boolean {
  return getRazorpayConfig().configured;
}

// ---------------------------------------------------------------------------
// 2. AMOUNTS — Razorpay charges in PAISE (1 rupee = 100 paise)
// ---------------------------------------------------------------------------
/** Razorpay's minimum order amount: 100 paise (= ₹1). */
export const RAZORPAY_MIN_AMOUNT_PAISE = 100;
export const RAZORPAY_CURRENCY = "INR" as const;

/**
 * Convert the organizer Settings registration fee (whole rupees, the
 * `registrationFeeInr` value in the settings table) to paise.
 * Returns null when there is no fee set or it is below the minimum, so
 * the caller can refuse to create an order instead of guessing an amount.
 */
export function feeRupeesToPaise(feeInr: number | null | undefined): number | null {
  if (feeInr == null || !Number.isFinite(feeInr)) return null;
  const paise = Math.round(feeInr * 100);
  return paise >= RAZORPAY_MIN_AMOUNT_PAISE ? paise : null;
}

// ---------------------------------------------------------------------------
// 3. TODO STUB — CREATE ORDER (server-side only)
// ---------------------------------------------------------------------------
export type CreateRazorpayOrderInput = {
  /** Amount in PAISE — use feeRupeesToPaise(settings.registrationFeeInr). */
  amountPaise: number;
  /** Your own reference for this order, e.g. the team's SPX- reference. */
  receipt: string;
  notes?: Record<string, string>;
};
export type RazorpayOrder = { id: string; amountPaise: number; currency: typeof RAZORPAY_CURRENCY; receipt: string };

export async function createRazorpayOrder(_input: CreateRazorpayOrderInput): Promise<RazorpayOrder> {
  // TODO(razorpay): INTEGRATOR — write the Orders API call HERE, and only here.
  //   What to paste/write: a server-side POST to
  //   https://api.razorpay.com/v1/orders with HTTP Basic auth
  //   (username = config.keyId, password = config.keySecret) and a JSON
  //   body { amount: input.amountPaise, currency: "INR",
  //   receipt: input.receipt, notes: input.notes }.
  //   (Equivalently: `new Razorpay({ key_id, key_secret }).orders.create(...)`
  //   if you add the official `razorpay` npm package yourself.)
  //   Validate input.amountPaise >= RAZORPAY_MIN_AMOUNT_PAISE first, store
  //   the returned order `id` against the team, and return it. The browser
  //   then opens Razorpay Checkout with that order id + the KEY ID only.
  const config = getRazorpayConfig();
  if (!config.configured) {
    throw new Error("Razorpay is not configured: set RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET in the environment first. See server/src/razorpay.ts.");
  }
  throw new Error("Razorpay order creation is not implemented yet — complete the TODO in createRazorpayOrder in server/src/razorpay.ts.");
}

// ---------------------------------------------------------------------------
// 4. VERIFY PAYMENT SIGNATURE — helper implemented, wiring is the TODO
// ---------------------------------------------------------------------------
// Razorpay's checkout signature is: hex( HMAC-SHA256(
//   key_secret,  order_id + "|" + payment_id ) )
// This helper implements exactly that check (constant-time compare) using
// Web Crypto, which both Bun and the space runtime provide. It returns
// false — never throws — when Razorpay is not configured or the inputs
// are incomplete, so a failed check can never accidentally pass.
const sigEnc = new TextEncoder();
function sigHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", sigEnc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, sigEnc.encode(message));
  return sigHex(new Uint8Array(sig));
}
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyRazorpayPaymentSignature(input: {
  orderId: string; paymentId: string; signature: string;
}): Promise<boolean> {
  // TODO(razorpay): INTEGRATOR — no code to write in this helper; WIRE IT UP.
  //   What to do: after Razorpay Checkout returns razorpay_order_id,
  //   razorpay_payment_id and razorpay_signature to your callback, call
  //   this function on the SERVER with those three values. Only when it
  //   returns true may you set the team's paymentStatus to "verified"
  //   (which fires the existing "Payment Verified" poster email).
  const { keySecret } = getRazorpayConfig();
  if (!keySecret || !input.orderId || !input.paymentId || !input.signature) return false;
  const expected = await hmacSha256Hex(keySecret, `${input.orderId}|${input.paymentId}`);
  return constantTimeEqual(expected, input.signature.toLowerCase());
}

// ---------------------------------------------------------------------------
// 5. TODO STUB — WEBHOOK HANDLER (server-side only)
// ---------------------------------------------------------------------------
export async function verifyRazorpayWebhookSignature(input: {
  /** The RAW request body, exactly as received — do not re-serialise JSON. */
  rawBody: string;
  /** The value of the `x-razorpay-signature` request header. */
  signature: string;
}): Promise<boolean> {
  // Same HMAC-SHA256 scheme as above, but keyed with the WEBHOOK secret
  // (not the key secret) and signed over the raw body.
  const { webhookSecret } = getRazorpayConfig();
  if (!webhookSecret || !input.rawBody || !input.signature) return false;
  const expected = await hmacSha256Hex(webhookSecret, input.rawBody);
  return constantTimeEqual(expected, input.signature.toLowerCase());
}

export async function handleRazorpayWebhook(input: {
  rawBody: string; signature: string;
}): Promise<{ handled: boolean; reason: string }> {
  // TODO(razorpay): INTEGRATOR — write the webhook handling HERE.
  //   What to paste/write:
  //   1. Expose ONE HTTPS endpoint in the hosting layer (outside these
  //      typed actions, because Razorpay posts a raw body + header, not
  //      an action call) and register its URL in the Razorpay Dashboard
  //      with the same secret stored in RAZORPAY_WEBHOOK_SECRET.
  //   2. In that endpoint, read the raw body and the
  //      `x-razorpay-signature` header and pass both to this function.
  //   3. Below, after verifyRazorpayWebhookSignature() passes, parse the
  //      JSON event: on "payment.captured" / "order.paid", look the team
  //      up by the order/payment reference you stored in step 3 (create
  //      order), then set its paymentStatus to "verified" exactly the
  //      way `verifyPayment` in ./actions.ts does — that transition is
  //      what queues the "Payment Verified" poster email, once only.
  //      On "payment.failed", leave the status as-is (or record the
  //      note) — never mark a failed payment verified.
  //   4. Return HTTP 200 quickly; do not trust any webhook whose
  //      signature check fails — return { handled: false } instead.
  const ok = await verifyRazorpayWebhookSignature(input);
  if (!ok) return { handled: false, reason: "Webhook signature check failed or Razorpay is not configured — event ignored." };
  return { handled: false, reason: "Webhook signature verified, but no event handling is implemented yet — complete the TODO in handleRazorpayWebhook in server/src/razorpay.ts." };
}
// ============================================================================
//  END OF RAZORPAY SECTION — there is no other Razorpay code to find.
// ============================================================================
