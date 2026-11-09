import { defineAction, z, type ActionsModule, type Ctx } from "@hatch/space-sdk";
import { and, desc, eq } from "drizzle-orm";
import * as schema from "./schema";
import { isRazorpayConfigured } from "./razorpay";

const TRACKS = ["AI/ML", "Cyber Security", "Web Development", "Student Innovation"] as const;
const trackSchema = z.enum(TRACKS);
const emailSchema = z.string().trim().toLowerCase().email().max(200);
// "Today" for deadline logic is the current date in India (Asia/Kolkata),
// not UTC — a deadline dated 20 Nov stays open until the end of 20 Nov IST.
const todayStr = () => {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
};
// Indian mobile numbers: exactly 10 digits, first digit 6–9, stored with
// the +91 country prefix. Accepts the digits with or without +91 / 91 / 0
// prefixes and common separators; returns the canonical "+91XXXXXXXXXX"
// form, or null when the input is not a valid Indian mobile.
const INDIAN_MOBILE_ERROR = "Please enter a valid Indian mobile number: +91 followed by exactly 10 digits, starting with 6, 7, 8, or 9 (for example, +91 98765 43210).";
function normalizeIndianMobile(raw: string): string | null {
  let d = raw.replace(/[\s()-]/g, "");
  if (d.startsWith("+91")) d = d.slice(3);
  else if (d.startsWith("91") && d.length === 12) d = d.slice(2);
  else if (d.startsWith("0") && d.length === 11) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? `+91${d}` : null;
}
// Indian Rupees with Indian digit grouping (₹1,00,000 style), currency INR.
const fmtINR = (n: number) => `₹${n.toLocaleString("en-IN")}`;
// Razorpay integration lives in server/src/razorpay.ts — this is display copy only.
// Indian payment methods, in the order they are presented everywhere.
const PAYMENT_METHODS_LINE = "Payments are made via Razorpay using UPI (PhonePe, Paytm, Google Pay, or BHIM UPI), Indian debit and credit cards, netbanking with Indian banks, or Indian wallets such as Paytm Wallet, PhonePe Wallet, Amazon Pay, and Mobikwik. For UPI payments, please keep your UPI reference / UTR number ready to share as your payment reference.";
// Settings dates (YYYY-MM-DD, India) rendered in Indian format for email
// copy, e.g. "Mon, 9 Nov 2026". The date is read as midnight IST so the
// weekday can never shift across timezones.
const fmtDateIN = (iso: string) => {
  const d = new Date(`${iso}T00:00:00+05:30`);
  return d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", year: "numeric" });
};
const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const enc = new TextEncoder();
const hexOf = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const bytesFromHex = (hex: string) => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};
async function sha(v: string): Promise<string> {
  return hexOf(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(v))));
}
const randomHex = (n: number) => hexOf(crypto.getRandomValues(new Uint8Array(n)));
async function hashPassword(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: bytesFromHex(salt), iterations: 100000, hash: "SHA-256" }, key, 256);
  return hexOf(new Uint8Array(bits));
}
const newSalt = () => randomHex(16);
async function passwordsMatch(password: string, salt: string, hash: string): Promise<boolean> {
  return (await hashPassword(password, salt)) === hash;
}
const makeCode = () => {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => chars[b % chars.length] ?? "A").join("");
};
const fail = (message: string) => ({ ok: false as const, error: message });

// Poster-style registration acknowledgement. The same poster design
// renders in two payment states from ONE template (the payment-state
// slot): "pending" at first registration — Razorpay is not integrated
// yet and a submitted UTR is only recorded for organizer review, so the
// poster reads "Payment — Pending Verification" and never claims a
// payment was confirmed — and "verified", sent once when an organizer
// verifies the team's payment (and, later, the variant a
// signature-verified Razorpay payment will send). The first-registration
// poster is queued exactly once (registerTeam / joinTeam); sign-in and
// portal loads never queue it again. The email carries a full HTML
// poster plus this plain-text alternative with the same details.
type AckDetails = {
  name: string; email: string; phone?: string | null; teamName: string; code: string; track: string;
  college: string; reference: string; paymentRef?: string; feeInr?: number | null; isJoin: boolean;
  paymentState: "pending" | "verified";
  memberCount: number; minTeamSize: number; maxTeamSize: number;
  eventStart: string; registrationDeadline: string; round1Deadline: string;
  whatsappNumber?: string | null;
};
const ACK_SUBJECT_PENDING = "SPACExPRO Hackathon — Registration Successful";
const ACK_SUBJECT_VERIFIED = "SPACExPRO Hackathon — Payment Verified — You're Confirmed";
const ackSubject = (state: "pending" | "verified") => (state === "verified" ? ACK_SUBJECT_VERIFIED : ACK_SUBJECT_PENDING);

function registrationAckText(d: AckDetails): string {
  const verified = d.paymentState === "verified";
  const paymentNote = verified
    ? "Your payment has been verified by an organizer. Your team's place is confirmed — no further payment action is needed."
    : d.paymentRef
      ? "Your payment reference has been recorded for review by an organizer. No payment has been confirmed. Your payment status will remain pending verification until it has been reviewed and verified."
      : "No payment reference was provided. Your payment status remains pending verification until a reference has been submitted and reviewed by an organizer. No payment has been confirmed.";
  const keepCode = d.isJoin
    ? "Please keep your team code safe for future reference, and share it only with members of your team."
    : "Please keep your team code safe, and share it only with members of your team. Your teammates will need this code to join your team.";
  return [
    "SPACExPRO HACKATHON",
    verified ? "YOU'RE IN — PAYMENT VERIFIED" : "YOU'RE IN — REGISTRATION RECEIVED",
    "",
    `Dear ${d.name},`,
    "",
    verified
      ? `Great news — the payment for team ${d.teamName} has been verified. Your registration for the SPACExPRO Hackathon is fully confirmed.`
      : d.isJoin
        ? "Thank you for joining the SPACExPRO Hackathon. Your registration has been completed successfully — here is your poster with everything in one place."
        : "Thank you for registering for the SPACExPRO Hackathon. Your registration has been completed successfully — here is your poster with everything in one place.",
    "",
    "========================================",
    `TEAM CODE:  ${d.code}`,
    "========================================",
    "",
    `Participant: ${d.name} (${d.email})`,
    ...(d.phone ? [`Mobile: ${d.phone}`] : []),
    `Team Name: ${d.teamName}`,
    `Team: ${d.memberCount} member${d.memberCount === 1 ? "" : "s"} registered so far (teams of ${d.minTeamSize}–${d.maxTeamSize})`,
    `Track: ${d.track}`,
    `College: ${d.college}`,
    `Registration Reference: ${d.reference}`,
    ...(d.feeInr != null ? [`Registration Fee: ${fmtINR(d.feeInr)} (INR), payable per team`] : []),
    `Event Starts: ${fmtDateIN(d.eventStart)} (IST)`,
    `Registration Closes: ${fmtDateIN(d.registrationDeadline)} (IST)`,
    `Round 1 Submission Due: ${fmtDateIN(d.round1Deadline)} (IST)`,
    "",
    verified ? "PAYMENT — VERIFIED ✓" : "PAYMENT — PENDING VERIFICATION",
    `Payment Reference: ${d.paymentRef || "Not provided"}`,
    paymentNote,
    "",
    PAYMENT_METHODS_LINE,
    "",
    "What happens next:",
    `1. ${keepCode}`,
    "2. Sign in to the Team Portal using the email address and password you registered with, where you can view your team details, deadlines, and submissions.",
    `3. Prepare your Round 1 submission — it is due on ${fmtDateIN(d.round1Deadline)} (IST). Please check the Team Portal regularly for organizer announcements.`,
    "",
    `Questions? Write to us at space.x.pro.7@gmail.com${d.whatsappNumber ? `, or reach us on WhatsApp at ${d.whatsappNumber}` : ""}.`,
    "If you did not register for the SPACExPRO Hackathon, please contact us at space.x.pro.7@gmail.com.",
    "",
    "Warm regards,",
    "SPACExPRO Hackathon Team",
    "space.x.pro.7@gmail.com",
  ].join("\n");
}

const escHtml = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// HTML poster: table-based layout, inline CSS only, no external images;
// solid colours with CSS gradients only as progressive enhancement, so
// it renders as a dark, gold-framed poster even in strict email clients.
// Display type uses a web-safe stack (Syne cannot be loaded in email).
function registrationAckHtml(d: AckDetails): string {
  const verified = d.paymentState === "verified";
  const DISPLAY = "'Arial Black','Helvetica Neue',Helvetica,Arial,sans-serif";
  const BODYF = "'Helvetica Neue',Helvetica,Arial,sans-serif";
  const goldGrad = "background-color:#F5C542;background:linear-gradient(100deg,#AA771C,#FFD700 30%,#F5C542 48%,#FCF6BA 55%,#FFD700 78%,#AA771C);";
  const row = (label: string, value: string, last = false) =>
    `<tr><td style="padding:9px 0;${last ? "" : "border-bottom:1px solid #241B08;"}font-family:${BODYF};font-size:12px;letter-spacing:2px;color:#CFC4A5;">${label}</td><td align="right" style="padding:9px 0 9px 16px;${last ? "" : "border-bottom:1px solid #241B08;"}font-family:${BODYF};font-size:14px;font-weight:bold;color:#FFFDF5;">${escHtml(value)}</td></tr>`;
  const paymentBlock = verified
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #F5C542;border-radius:10px;background-color:#0E0E10;"><tr><td style="padding:16px 18px;font-family:${BODYF};"><div style="font-size:12px;letter-spacing:3px;color:#F5C542;font-weight:bold;">PAYMENT — VERIFIED &#10003;</div><div style="margin-top:6px;font-size:14px;line-height:21px;color:#F0E7CE;">Your payment has been verified by an organizer. Your team&#8217;s place is <b style="color:#FFFDF5;">confirmed</b> — no further payment action is needed.</div><div style="margin-top:6px;font-size:13px;color:#CFC4A5;">Payment reference: <b style="color:#FFFDF5;">${escHtml(d.paymentRef || "Verified on file")}</b></div></td></tr></table>`
    : d.paymentRef
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #AA771C;border-radius:10px;background-color:#0B0A06;"><tr><td style="padding:16px 18px;font-family:${BODYF};"><div style="font-size:12px;letter-spacing:3px;color:#FCF6BA;font-weight:bold;">PAYMENT — PENDING VERIFICATION</div><div style="margin-top:6px;font-size:14px;line-height:21px;color:#F0E7CE;">Your payment reference has been recorded and is <b style="color:#FFFDF5;">awaiting verification</b> by an organizer. No payment has been confirmed yet — we will email you again the moment it is verified.</div><div style="margin-top:6px;font-size:13px;color:#CFC4A5;">Payment reference (UTR): <b style="color:#FFFDF5;">${escHtml(d.paymentRef)}</b></div></td></tr></table>`
      : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #AA771C;border-radius:10px;background-color:#0B0A06;"><tr><td style="padding:16px 18px;font-family:${BODYF};"><div style="font-size:12px;letter-spacing:3px;color:#FCF6BA;font-weight:bold;">PAYMENT — PENDING VERIFICATION</div><div style="margin-top:6px;font-size:14px;line-height:21px;color:#F0E7CE;">No payment reference has been submitted for your team yet, so there is nothing to verify. Add your UPI reference / UTR in the <b style="color:#FFFDF5;">Team Portal</b> after you pay — your payment status stays pending verification until an organizer verifies it. No payment has been confirmed.</div><div style="margin-top:6px;font-size:13px;color:#CFC4A5;">Payment reference (UTR): <b style="color:#FFFDF5;">Not submitted yet</b></div></td></tr></table>`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>SPACExPRO Hackathon — ${verified ? "Payment Verified" : "Registration Successful"}</title></head>
<body style="margin:0;padding:0;background-color:#030304;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#030304;"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background-color:#070708;border:2px solid #BF953F;border-radius:14px;">
<tr><td style="padding:3px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #3A2F16;border-radius:11px;background-color:#070708;"><tr><td style="padding:34px 30px 30px 30px;">
<div style="text-align:center;font-family:${DISPLAY};font-size:24px;font-weight:900;letter-spacing:5px;color:#FFFDF5;">SPACE<span style="color:#F5C542;">x</span>PRO</div>
<div style="text-align:center;margin-top:4px;font-family:${BODYF};font-size:11px;letter-spacing:6px;color:#CFC4A5;">H A C K A T H O N</div>
<table role="presentation" width="120" cellpadding="0" cellspacing="0" align="center" style="margin:18px auto 0 auto;"><tr><td height="2" style="font-size:0;line-height:0;${goldGrad}">&nbsp;</td></tr></table>
<div style="text-align:center;margin-top:22px;font-family:${DISPLAY};font-size:34px;line-height:40px;font-weight:900;color:#FFFDF5;">You&#8217;re in<span style="color:#F5C542;">.</span></div>
<div style="text-align:center;margin-top:8px;font-family:${BODYF};font-size:15px;line-height:22px;color:#F0E7CE;">${verified ? `Dear ${escHtml(d.name)}, the payment for your team has been <b style="color:#FFFDF5;">verified</b>. Your SPACExPRO Hackathon registration is fully confirmed.` : `Dear ${escHtml(d.name)}, your SPACExPRO Hackathon registration is complete. Everything you need is on this poster — keep it safe.`}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;border:1px dashed #BF953F;border-radius:12px;background-color:#030304;"><tr><td align="center" style="padding:20px 14px 22px 14px;">
<div style="font-family:${BODYF};font-size:11px;letter-spacing:5px;color:#CFC4A5;">YOUR TEAM CODE</div>
<div style="margin-top:8px;font-family:${DISPLAY};font-size:44px;line-height:50px;font-weight:900;letter-spacing:10px;color:#FFD700;">${escHtml(d.code)}</div>
<div style="margin-top:6px;font-family:${BODYF};font-size:13px;color:#F0E7CE;">Team <b style="color:#FFFDF5;">${escHtml(d.teamName)}</b> &nbsp;&#183;&nbsp; Ref <b style="color:#FFFDF5;">${escHtml(d.reference)}</b></div>
<div style="margin-top:4px;font-family:${BODYF};font-size:12px;color:#CFC4A5;">Share this code only with your teammates — they need it to join your team.</div>
</td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px;">
${row("PARTICIPANT", d.name)}
${row("TRACK", d.track)}
${row("COLLEGE", d.college)}
${row("TEAM SO FAR", `${d.memberCount} member${d.memberCount === 1 ? "" : "s"} registered · teams of ${d.minTeamSize}–${d.maxTeamSize}`)}
${row("EVENT STARTS", `${fmtDateIN(d.eventStart)} · IST`)}
${row("ROUND 1 DUE", `${fmtDateIN(d.round1Deadline)} · IST`, true)}
</table>
<div style="margin-top:20px;">${paymentBlock}</div>
${d.feeInr != null ? `<div style="margin-top:10px;text-align:center;font-family:${BODYF};font-size:12px;color:#CFC4A5;">Registration fee: ${fmtINR(d.feeInr)} (INR) per team · Paid via Razorpay — UPI (PhonePe, Paytm, Google Pay, BHIM UPI), Indian cards, netbanking, or Indian wallets.</div>` : ""}
<div style="margin-top:24px;font-family:${BODYF};font-size:12px;letter-spacing:3px;color:#F5C542;font-weight:bold;">WHAT HAPPENS NEXT</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;font-family:${BODYF};font-size:14px;line-height:21px;color:#F0E7CE;">
<tr><td width="26" valign="top" style="color:#FFD700;font-weight:bold;">1.</td><td style="padding-bottom:8px;">Keep your team code safe — it is your team&#8217;s key for joining, sign-in recovery, and submissions.</td></tr>
<tr><td width="26" valign="top" style="color:#FFD700;font-weight:bold;">2.</td><td style="padding-bottom:8px;">Sign in to the <b style="color:#FFFDF5;">Team Portal</b> with the email and password you registered with to see deadlines, announcements, and your payment status.</td></tr>
<tr><td width="26" valign="top" style="color:#FFD700;font-weight:bold;">3.</td><td>Build your Round 1 submission — due <b style="color:#FFFDF5;">${fmtDateIN(d.round1Deadline)} (IST)</b>. Registration closes ${fmtDateIN(d.registrationDeadline)} (IST).</td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;border-top:1px solid #3A2F16;"><tr><td align="center" style="padding-top:18px;font-family:${BODYF};font-size:13px;line-height:20px;color:#CFC4A5;">
Questions? Write to <a href="mailto:space.x.pro.7@gmail.com" style="color:#F5C542;text-decoration:none;font-weight:bold;">space.x.pro.7@gmail.com</a>${d.whatsappNumber ? `<br>or reach us on WhatsApp at ${escHtml(d.whatsappNumber)}` : ""}<br>
<span style="color:#FFFDF5;font-weight:bold;">— Team SPACExPRO</span><br>
<span style="font-size:11px;color:#8A7D5C;">This poster was emailed from space.x.pro.7@gmail.com. If you did not register for the SPACExPRO Hackathon, please let us know at that address.</span>
</td></tr></table>
</td></tr></table></td></tr>
</table>
</td></tr></table>
</body></html>`;
}

// Queues an email in the outbox with a one-time delivery token, so only the
// delivery agent holding that token can mark it sent or failed. Returns the
// row id and token, or null if the row could not be created.
async function queueEmail(
  db: ReturnType<Ctx["db"]>,
  values: { recipient: string; subject: string; body: string; htmlBody?: string; kind: string; relatedId?: number },
) {
  const token = randomHex(16);
  const inserted = await db
    .insert(schema.emailOutbox)
    .values({ ...values, status: "pending", deliveryToken: token })
    .returning({ id: schema.emailOutbox.id });
  const row = inserted[0];
  if (!row) return null;
  return { id: row.id, token };
}

// Email delivery — owner-authorized connected path (authorized by the
// owner on 2026-11-06: "fix everything and connect everything like gmail
// acknowledgement"). Queued emails are dispatched by a dedicated delivery
// task (the owner's own agent) that sends exactly ONE queued message —
// only that message's recipient, subject, and body — from the owner's
// connected Gmail mailbox (space.x.pro.7@gmail.com), verifies the send in
// the mailbox's sent mail, and only then calls confirmEmailDelivered
// with the one-time delivery token, which is what flips the row to
// "sent". If the mailbox is not connected, the send is declined or
// blocked (for example by the mailbox's per-send approval), or the send
// cannot be verified, the task calls reportEmailDeliveryBlocked and the
// row is marked "failed" honestly — never "sent". No mailbox credentials
// are stored in this artifact or sent to the client, and no bulk export
// of participant data ever takes place: each dispatch carries a single
// message only.
async function dispatchEmail(
  ctx: Ctx,
  queued: { id: number; token: string } | null,
  recipient: string,
  subject: string,
  body: string,
  htmlBody?: string | null,
) {
  if (!queued) return;
  const message = [
    "You are the email delivery agent for the SPACExPRO Hackathon web artifact (slug: orbitx-hackathon). The site owner has explicitly authorized automatic delivery of the site's queued emails through their connected Gmail mailbox.",
    "",
    "Deliver exactly ONE queued email, exactly as written below. Do not change the recipient, subject, or body, and do not send anything else.",
    "",
    `Recipient: ${recipient}`,
    `Subject: ${subject}`,
    "Plain-text body:",
    body,
    ...(htmlBody
      ? [
          "",
          "HTML body (poster design — this is the primary body to send; the plain-text body above is its text alternative with the same details):",
          htmlBody,
        ]
      : []),
    "",
    "Steps:",
    "1. Follow the Gmail connector instructions: run `status` first. If Gmail is not connected, skip to step 4 (blocked) with the reason \"Gmail is not connected\". Send from the space.x.pro.7@gmail.com account: run `accounts`, find the account whose display_name is space.x.pro.7@gmail.com, and pass its account id with --account on every Gmail command.",
    htmlBody
      ? "2. This email has an HTML poster body. Send it as a multipart/alternative message so mail clients get BOTH parts: write a complete MIME file to /tmp/spacexpro-email-" + queued.id + ".eml containing the headers To, Subject, MIME-Version: 1.0, and Content-Type: multipart/alternative with a boundary of your choosing; part 1 is text/plain; charset=utf-8 holding the plain-text body exactly as given, part 2 is text/html; charset=utf-8 holding the HTML body exactly as given. Then send it with the raw Gmail API: hatch_gws_cli gmail users messages send --params '{\"userId\":\"me\"}' --upload /tmp/spacexpro-email-" + queued.id + ".eml --account <account id>. If the raw multipart send fails for a tooling reason, fall back ONCE to: hatch_gws_cli gmail +send --to <recipient> --subject <subject> --body <the HTML body exactly as given> --html --account <account id>. This exact send is pre-authorized by the owner for this task. If the send is declined or blocked (for example, an approval was not given), do not retry it and do not substitute another message — go to step 4 (blocked) with a short reason."
      : "2. Send the email with the Gmail connector: hatch_gws_cli gmail +send --to <recipient> --subject <subject> --body <body>, single-quoting the subject and body exactly as given above. This exact send is pre-authorized by the owner for this task. If the send is declined or blocked (for example, an approval was not given), do not retry it and do not substitute another message — go to step 4 (blocked) with a short reason.",
    "3. Verify the send: search the mailbox's sent mail for a message to the recipient with this exact subject (for example, +triage --query 'in:sent to:<recipient>' and match the subject), and note the sent message's ID.",
    "4. Report the result by calling this artifact's action with artifact.invoke_action (slug \"orbitx-hackathon\"):",
    `   - Verified sent: call confirmEmailDelivered with {"id": ${queued.id}, "token": "${queued.token}", "messageId": "<the sent message id from step 3>"}.`,
    `   - Could not send or could not verify: call reportEmailDeliveryBlocked with {"id": ${queued.id}, "token": "${queued.token}", "reason": "<one short sentence>"}.`,
    "Never mark the email sent without a verified successful send. Do not read, search, or modify any other mail. Reply with one short line confirming the outcome.",
  ].join("\n");
  try {
    await ctx.agent.spawnTask(message, { expectsAction: "confirmEmailDelivered" });
  } catch {
    // The delivery task could not be started. The email stays "pending"
    // in the organizer outbox, where the organizer can retry delivery.
  }
}

async function ensureSettings(db: ReturnType<Ctx["db"]>) {
  const rows = await db.select().from(schema.settings).limit(1);
  const existing = rows[0];
  if (existing) return existing;
  const start = todayStr();
  const inserted = await db
    .insert(schema.settings)
    .values({
      id: 1,
      eventStart: start,
      registrationDeadline: addDays(start, 14),
      round1Deadline: addDays(start, 21),
      round2Deadline: addDays(start, 28),
      finalistDate: addDays(start, 35),
      minTeamSize: 2,
      maxTeamSize: 4,
      weightInnovation: 30,
      weightTechnical: 30,
      weightImpact: 20,
      weightPresentation: 20,
      resultsPublished: false,
      contactEmail: "space.x.pro.7@gmail.com",
    })
    .returning();
  const created = inserted[0];
  if (!created) throw new Error("The event settings could not be initialized. Please try again.");
  return created;
}

async function getSession(ctx: Ctx, token: string) {
  const db = ctx.db<typeof schema>();
  const rows = await db.select().from(schema.sessions).where(eq(schema.sessions.tokenHash, await sha(token)));
  const s = rows[0];
  if (!s || s.expiresAt.getTime() < Date.now()) return null;
  return s;
}

async function requireRole(ctx: Ctx, token: string, role: "participant" | "organizer") {
  const s = await getSession(ctx, token);
  if (!s || s.userType !== role) throw new Error("Not authorized. Please sign in.");
  return s;
}

const settingsOut = z.object({
  eventStart: z.string(), registrationDeadline: z.string(), round1Deadline: z.string(),
  round2Deadline: z.string(), finalistDate: z.string(), minTeamSize: z.number(),
  maxTeamSize: z.number(), weightInnovation: z.number(), weightTechnical: z.number(),
  weightImpact: z.number(), weightPresentation: z.number(), resultsPublished: z.boolean(),
  contactEmail: z.string(), whatsappNumber: z.string().nullable(), registrationFeeInr: z.number().nullable(),
  registrationCountOverride: z.number().nullable(),
});
const teamOut = z.object({
  id: z.number(), name: z.string(), code: z.string(), track: trackSchema, college: z.string(),
  paymentRef: z.string().nullable(), paymentStatus: z.enum(["pending_review", "verified", "rejected"]),
  paymentNote: z.string().nullable(), qualified: z.boolean(), finalistSlot: z.string().nullable(),
  createdAt: z.string(), memberCount: z.number(),
});
const memberOut = z.object({
  id: z.number(), teamId: z.number(), name: z.string(), email: z.string(), phone: z.string().nullable(), college: z.string(),
  degree: z.enum(["B.Tech", "M.Tech"]), track: trackSchema, isLeader: z.boolean(),
  ideaTitle: z.string().nullable(), ideaDescription: z.string().nullable(),
  problemStatement: z.string().nullable(), intendedUsers: z.string().nullable(),
});

const participantFields = {
  name: z.string().trim().min(2).max(100),
  email: emailSchema,
  phone: z.string().trim().min(1).max(20),
  college: z.string().trim().min(2).max(150),
  degree: z.enum(["B.Tech", "M.Tech"]),
  password: z.string().min(8).max(100),
  ideaTitle: z.string().trim().max(150).optional(),
  ideaDescription: z.string().trim().max(2000).optional(),
  problemStatement: z.string().trim().max(2000).optional(),
  intendedUsers: z.string().trim().max(500).optional(),
};

function ideaCheck(track: string, f: { ideaTitle?: string; ideaDescription?: string; problemStatement?: string; intendedUsers?: string }) {
  if (track === "Student Innovation") {
    if (!f.ideaTitle || !f.ideaDescription || !f.problemStatement || !f.intendedUsers) {
      return "For the Student Innovation track, please provide an idea title, a description, a problem statement, and the intended users.";
    }
  }
  return null;
}

export const Actions = {
  getPublic: defineAction({
    description: "Returns public event settings, announcements, counts, and integration status.",
    request: z.object({}),
    response: z.object({
      settings: settingsOut,
      announcements: z.array(z.object({ id: z.number(), title: z.string(), body: z.string(), audience: z.string(), createdAt: z.string() })),
      teamCount: z.number(), participantCount: z.number(), organizerCount: z.number(),
      displayRegistrationCount: z.number(),
      integrations: z.object({ emailConfigured: z.boolean(), razorpayConfigured: z.boolean() }),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const s = await ensureSettings(db);
      const ann = await db.select().from(schema.announcements).orderBy(desc(schema.announcements.id)).limit(20);
      const teamRows = await db.select({ id: schema.teams.id }).from(schema.teams);
      const partRows = await db.select({ id: schema.participants.id }).from(schema.participants);
      const orgRows = await db.select({ id: schema.organizers.id }).from(schema.organizers);
      const liveTeamCount = teamRows.length;
      const override = s.registrationCountOverride ?? null;
      const displayRegistrationCount = override != null ? override : liveTeamCount;
      return {
        settings: {
          eventStart: s.eventStart, registrationDeadline: s.registrationDeadline, round1Deadline: s.round1Deadline,
          round2Deadline: s.round2Deadline, finalistDate: s.finalistDate, minTeamSize: s.minTeamSize,
          maxTeamSize: s.maxTeamSize, weightInnovation: s.weightInnovation, weightTechnical: s.weightTechnical,
          weightImpact: s.weightImpact, weightPresentation: s.weightPresentation,
          resultsPublished: s.resultsPublished, contactEmail: s.contactEmail, whatsappNumber: s.whatsappNumber, registrationFeeInr: s.registrationFeeInr,
          registrationCountOverride: override,
        },
        announcements: ann.filter((a) => a.audience === "all").map((a) => ({ id: a.id, title: a.title, body: a.body, audience: a.audience, createdAt: a.createdAt.toISOString() })),
        teamCount: liveTeamCount, participantCount: partRows.length, organizerCount: orgRows.length,
        displayRegistrationCount,
        // Email delivery path is wired: queued messages are dispatched
        // automatically through the owner's connected Gmail mailbox
        // (space.x.pro.7@gmail.com) and marked sent only after a verified
        // send. Razorpay remains unconnected — no keys, no webhook — so
        // payments stay Pending Verification.
        // Razorpay integration lives in server/src/razorpay.ts (razorpayConfigured is derived there from the env vars).
        integrations: { emailConfigured: true, razorpayConfigured: isRazorpayConfigured() },
      };
    },
  }),

  lookupTeamByCode: defineAction({
    description: "Looks up a team by invitation code for the join flow.",
    request: z.object({ code: z.string().trim().min(4).max(20) }),
    response: z.object({ ok: z.boolean(), error: z.string().optional(), team: z.object({ id: z.number(), name: z.string(), track: trackSchema, college: z.string(), memberCount: z.number() }).optional() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.teams).where(eq(schema.teams.code, args.code.trim().toUpperCase()));
      const team = rows[0];
      if (!team) return { ok: false, error: "No team was found with that invitation code. Please check the code and try again." };
      const members = await db.select().from(schema.participants).where(eq(schema.participants.teamId, team.id));
      return { ok: true, team: { id: team.id, name: team.name, track: team.track, college: team.college, memberCount: members.length } };
    },
  }),

  submitEnquiry: defineAction({
    description: "Stores an enquiry and emails a copy to the organizer inbox via the owner's connected Gmail mailbox; the outbox row is marked sent only by the delivery-token callback after a verified send.",
    request: z.object({ name: z.string().trim().min(2).max(100), email: emailSchema, message: z.string().trim().min(5).max(3000) }),
    response: z.object({ ok: z.boolean(), error: z.string().optional(), id: z.number().optional(), emailStatus: z.string().optional() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const s = await ensureSettings(db);
      const inserted = await db.insert(schema.enquiries).values({ name: args.name, email: args.email, message: args.message }).returning({ id: schema.enquiries.id });
      const row = inserted[0];
      if (!row) return fail("Your enquiry could not be saved. Please try again.");
      const subject = "SPACExPRO Hackathon — New Enquiry";
      const body = [
        "Dear SPACExPRO Team,",
        "",
        "A new enquiry has been submitted through the SPACExPRO Hackathon website. The details are as follows:",
        "",
        `Name: ${args.name}`,
        `Email: ${args.email}`,
        "",
        "Message:",
        args.message,
        "",
        "Please reply directly to the sender at the email address shown above.",
        "",
        "Warm regards,",
        "SPACExPRO Hackathon Website",
      ].join("\n");
      const queued = await queueEmail(db, { recipient: s.contactEmail, subject, body, kind: "enquiry", relatedId: row.id });
      await dispatchEmail(ctx, queued, s.contactEmail, subject, body);
      ctx.invalidateQueries();
      return { ok: true, id: row.id, emailStatus: "pending" };
    },
  }),

  registerTeam: defineAction({
    description: "Creates a team and registers its leader, with a unique invitation code, and emails the acknowledgement to the participant via the owner's connected Gmail mailbox; the outbox row is marked sent only by the delivery-token callback after a verified send.",
    request: z.object({ teamName: z.string().trim().min(2).max(100), track: trackSchema, paymentRef: z.string().trim().max(100).optional(), ...participantFields }),
    response: z.object({ ok: z.boolean(), error: z.string().optional(), teamCode: z.string().optional(), reference: z.string().optional(), emailStatus: z.string().optional(), teamId: z.number().optional() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const s = await ensureSettings(db);
      if (todayStr() > s.registrationDeadline) return fail("Registration is now closed, as the registration deadline has passed.");
      const phone = normalizeIndianMobile(args.phone);
      if (!phone) return fail(INDIAN_MOBILE_ERROR);
      const ideaErr = ideaCheck(args.track, args);
      if (ideaErr) return fail(ideaErr);
      const dup = await db.select().from(schema.participants).where(eq(schema.participants.email, args.email));
      if (dup[0]) return fail("This email address is already registered. Please sign in to the Team Portal, or register with a different email address.");
      const salt = newSalt();
      let code = makeCode();
      for (let i = 0; i < 8; i++) {
        const clash = await db.select().from(schema.teams).where(eq(schema.teams.code, code));
        if (!clash[0]) break;
        code = makeCode();
      }
      const teamRows = await db.insert(schema.teams).values({ name: args.teamName, code, track: args.track, college: args.college, paymentRef: args.paymentRef || null, paymentStatus: "pending_review" }).returning();
      const team = teamRows[0];
      if (!team) return fail("Your team could not be created. Please try again.");
      await db.insert(schema.participants).values({
        teamId: team.id, name: args.name, email: args.email, phone, college: args.college, degree: args.degree,
        track: args.track, passwordHash: await hashPassword(args.password, salt), salt, isLeader: true,
        ideaTitle: args.ideaTitle || null, ideaDescription: args.ideaDescription || null,
        problemStatement: args.problemStatement || null, intendedUsers: args.intendedUsers || null,
      });
      const ackDetails: AckDetails = {
        name: args.name, email: args.email, phone, teamName: args.teamName, code,
        track: args.track, college: args.college, reference: `SPX-${team.id}`,
        paymentRef: args.paymentRef, feeInr: s.registrationFeeInr, isJoin: false,
        paymentState: "pending", memberCount: 1, minTeamSize: s.minTeamSize, maxTeamSize: s.maxTeamSize,
        eventStart: s.eventStart, registrationDeadline: s.registrationDeadline, round1Deadline: s.round1Deadline,
        whatsappNumber: s.whatsappNumber,
      };
      const subject = ackSubject("pending");
      const body = registrationAckText(ackDetails);
      const htmlBody = registrationAckHtml(ackDetails);
      const queued = await queueEmail(db, { recipient: args.email, subject, body, htmlBody, kind: "registration_ack", relatedId: team.id });
      await dispatchEmail(ctx, queued, args.email, subject, body, htmlBody);
      ctx.invalidateQueries();
      return { ok: true, teamCode: code, reference: `SPX-${team.id}`, emailStatus: "pending", teamId: team.id };
    },
  }),

  joinTeam: defineAction({
    description: "Adds a participant to an existing team using its invitation code.",
    request: z.object({ code: z.string().trim().min(4).max(20), track: trackSchema, ...participantFields }),
    response: z.object({ ok: z.boolean(), error: z.string().optional(), teamName: z.string().optional(), reference: z.string().optional(), emailStatus: z.string().optional() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const s = await ensureSettings(db);
      if (todayStr() > s.registrationDeadline) return fail("Registration is now closed, as the registration deadline has passed.");
      const teamRows = await db.select().from(schema.teams).where(eq(schema.teams.code, args.code.trim().toUpperCase()));
      const team = teamRows[0];
      if (!team) return fail("No team was found with that invitation code. Please check the code and try again.");
      if (args.track !== team.track) return fail(`This team is registered in the ${team.track} track. Please select that track to join the team.`);
      const phone = normalizeIndianMobile(args.phone);
      if (!phone) return fail(INDIAN_MOBILE_ERROR);
      const ideaErr = ideaCheck(team.track, args);
      if (ideaErr) return fail(ideaErr);
      const dup = await db.select().from(schema.participants).where(eq(schema.participants.email, args.email));
      if (dup[0]) return fail("This email address is already registered. Each participant may belong to only one team, so please sign in to the Team Portal.");
      const members = await db.select().from(schema.participants).where(eq(schema.participants.teamId, team.id));
      if (members.length >= s.maxTeamSize) return fail(`This team is already full. The maximum team size is ${s.maxTeamSize} members.`);
      const salt = newSalt();
      await db.insert(schema.participants).values({
        teamId: team.id, name: args.name, email: args.email, phone, college: args.college, degree: args.degree,
        track: team.track, passwordHash: await hashPassword(args.password, salt), salt, isLeader: false,
        ideaTitle: args.ideaTitle || null, ideaDescription: args.ideaDescription || null,
        problemStatement: args.problemStatement || null, intendedUsers: args.intendedUsers || null,
      });
      const ackDetails: AckDetails = {
        name: args.name, email: args.email, phone, teamName: team.name, code: team.code,
        track: team.track, college: args.college, reference: `SPX-${team.id}`,
        paymentRef: team.paymentRef ?? undefined, feeInr: s.registrationFeeInr, isJoin: true,
        paymentState: team.paymentStatus === "verified" ? "verified" : "pending",
        memberCount: members.length + 1, minTeamSize: s.minTeamSize, maxTeamSize: s.maxTeamSize,
        eventStart: s.eventStart, registrationDeadline: s.registrationDeadline, round1Deadline: s.round1Deadline,
        whatsappNumber: s.whatsappNumber,
      };
      const subject = ackSubject(ackDetails.paymentState);
      const body = registrationAckText(ackDetails);
      const htmlBody = registrationAckHtml(ackDetails);
      const queued = await queueEmail(db, { recipient: args.email, subject, body, htmlBody, kind: "registration_ack", relatedId: team.id });
      await dispatchEmail(ctx, queued, args.email, subject, body, htmlBody);
      ctx.invalidateQueries();
      return { ok: true, teamName: team.name, reference: `SPX-${team.id}`, emailStatus: "pending" };
    },
  }),

  signIn: defineAction({
    description: "Signs in a participant or organizer and returns a session token.",
    request: z.object({ email: emailSchema, password: z.string().min(1), role: z.enum(["participant", "organizer"]) }),
    response: z.object({ ok: z.boolean(), error: z.string().optional(), token: z.string().optional(), name: z.string().optional(), teamId: z.number().optional(), teamCode: z.string().optional() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      if (args.role === "organizer") {
        const rows = await db.select().from(schema.organizers).where(eq(schema.organizers.email, args.email));
        const org = rows[0];
        if (!org || !(await passwordsMatch(args.password, org.salt, org.passwordHash))) return fail("The email address or password entered is incorrect. Please try again.");
        const token = randomHex(32);
        await db.insert(schema.sessions).values({ tokenHash: await sha(token), userType: "organizer", userId: org.id, teamId: null, expiresAt: new Date(Date.now() + 7 * 86400000) });
        return { ok: true, token, name: org.displayName };
      }
      const rows = await db.select().from(schema.participants).where(eq(schema.participants.email, args.email));
      const p = rows[0];
      if (!p || !(await passwordsMatch(args.password, p.salt, p.passwordHash))) return fail("The email address or password entered is incorrect. Please try again.");
      const teamRows = await db.select().from(schema.teams).where(eq(schema.teams.id, p.teamId));
      const token = randomHex(32);
      await db.insert(schema.sessions).values({ tokenHash: await sha(token), userType: "participant", userId: p.id, teamId: p.teamId, expiresAt: new Date(Date.now() + 7 * 86400000) });
      return { ok: true, token, name: p.name, teamId: p.teamId, teamCode: teamRows[0]?.code };
    },
  }),

  signOut: defineAction({
    description: "Ends a session token.",
    request: z.object({ token: z.string() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, await sha(args.token)));
      return { ok: true };
    },
  }),

  requestPasswordReset: defineAction({
    description: "Creates a time-limited password reset code and emails it via the owner's connected Gmail mailbox; the outbox row is marked sent only by the delivery-token callback after a verified send.",
    request: z.object({ email: emailSchema, role: z.enum(["participant", "organizer"]) }),
    response: z.object({ ok: z.boolean(), delivery: z.string() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      let exists = false;
      if (args.role === "organizer") {
        exists = Boolean((await db.select().from(schema.organizers).where(eq(schema.organizers.email, args.email)))[0]);
      } else {
        exists = Boolean((await db.select().from(schema.participants).where(eq(schema.participants.email, args.email)))[0]);
      }
      // Identical response whether or not the account exists; the code is
      // never returned to the caller. It travels only through the dispatched
      // email.
      if (!exists) return { ok: true, delivery: "pending" };
      const code = makeCode() + makeCode().slice(0, 2);
      await db.insert(schema.resetTokens).values({ userType: args.role, email: args.email, tokenHash: await sha(code), expiresAt: new Date(Date.now() + 3600000) });
      const subject = "SPACExPRO Hackathon — Password Reset Code";
      const body = [
        "Hello,",
        "",
        "We have received a request to reset the password for your SPACExPRO Hackathon account.",
        "",
        `Your password reset code is: ${code}`,
        "",
        "This code will expire in one hour. Please enter it on the password reset page, together with your new password.",
        "If you did not request a password reset, please ignore this message. For your security, please do not share this code with anyone.",
        "",
        "Warm regards,",
        "SPACExPRO Hackathon Team",
        "space.x.pro.7@gmail.com",
      ].join("\n");
      const queued = await queueEmail(db, { recipient: args.email, subject, body, kind: "password_reset" });
      await dispatchEmail(ctx, queued, args.email, subject, body);
      return { ok: true, delivery: "pending" };
    },
  }),

  confirmEmailDelivered: defineAction({
    description: "Delivery-agent callback: marks a queued email sent after it has actually been sent from a connected mailbox. Requires the one-time delivery token.",
    request: z.object({ id: z.number().int(), token: z.string().min(1), messageId: z.string().max(200).optional() }),
    response: z.object({ ok: z.boolean(), error: z.string().optional() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.emailOutbox).where(eq(schema.emailOutbox.id, args.id));
      const row = rows[0];
      if (!row || !row.deliveryToken || row.deliveryToken !== args.token) return fail("Delivery could not be verified for this email. Please try again.");
      await db.update(schema.emailOutbox).set({ status: "sent", deliveryToken: null }).where(eq(schema.emailOutbox.id, row.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  reportEmailDeliveryBlocked: defineAction({
    description: "Delivery-agent callback: marks a queued email failed when no connected mailbox can send it. Requires the one-time delivery token.",
    request: z.object({ id: z.number().int(), token: z.string().min(1), reason: z.string().trim().max(300) }),
    response: z.object({ ok: z.boolean(), error: z.string().optional() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.emailOutbox).where(eq(schema.emailOutbox.id, args.id));
      const row = rows[0];
      if (!row || !row.deliveryToken || row.deliveryToken !== args.token) return fail("Delivery could not be verified for this email. Please try again.");
      await db.update(schema.emailOutbox).set({ status: "failed", deliveryToken: null }).where(eq(schema.emailOutbox.id, row.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  retryEmailDelivery: defineAction({
    description: "Re-queues a pending or failed outbox email (marks it pending with a fresh delivery token) and dispatches delivery again through the owner's connected Gmail mailbox. Organizer only; the row is marked sent only by the delivery-token callback after a verified send.",
    request: z.object({ token: z.string(), id: z.number().int() }),
    response: z.object({ ok: z.boolean(), error: z.string().optional() }),
    async handler(ctx, args) {
      await requireRole(ctx, args.token, "organizer");
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.emailOutbox).where(eq(schema.emailOutbox.id, args.id));
      const row = rows[0];
      if (!row) return fail("The requested email could not be found.");
      const token = randomHex(16);
      await db.update(schema.emailOutbox).set({ status: "pending", deliveryToken: token }).where(eq(schema.emailOutbox.id, row.id));
      await dispatchEmail(ctx, { id: row.id, token }, row.recipient, row.subject, row.body, row.htmlBody);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  resetPassword: defineAction({
    description: "Resets a password with an emailed reset code, or, for participants, with their team invitation code as ownership proof.",
    request: z.object({ email: emailSchema, role: z.enum(["participant", "organizer"]), code: z.string().trim().min(4).max(20).optional(), teamCode: z.string().trim().min(4).max(20).optional(), newPassword: z.string().min(8).max(100) }),
    response: z.object({ ok: z.boolean(), error: z.string().optional() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      let tokenRow: typeof schema.resetTokens.$inferSelect | undefined;
      if (args.code) {
        const rows = await db.select().from(schema.resetTokens).where(eq(schema.resetTokens.tokenHash, await sha(args.code.trim().toUpperCase())));
        tokenRow = rows[0];
        if (!tokenRow || tokenRow.used || tokenRow.email !== args.email || tokenRow.userType !== args.role || tokenRow.expiresAt.getTime() < Date.now()) {
          return fail("The reset code entered is invalid or has expired. Please request a new code.");
        }
      } else if (args.role === "participant" && args.teamCode) {
        // Ownership-verified recovery without email: the invitation code is
        // known only to team members, and the account email must belong to
        // that team. Organizers have no team code, so this path is closed
        // to them; their recovery is the emailed code only.
        const parts = await db.select().from(schema.participants).where(eq(schema.participants.email, args.email));
        const part = parts[0];
        if (!part) return fail("Your identity could not be verified. Please check the email address and team invitation code, and try again.");
        const teamRows = await db.select().from(schema.teams).where(eq(schema.teams.id, part.teamId));
        const team = teamRows[0];
        if (!team || team.code !== args.teamCode.trim().toUpperCase()) {
          return fail("Your identity could not be verified. Please check the email address and team invitation code, and try again.");
        }
      } else {
        return fail("Please provide either the reset code sent by email or, for participants, your team invitation code.");
      }
      const salt = newSalt();
      const hash = await hashPassword(args.newPassword, salt);
      if (args.role === "organizer") {
        const orgs = await db.select().from(schema.organizers).where(eq(schema.organizers.email, args.email));
        const org = orgs[0];
        if (!org) return fail("No account was found for the email address provided.");
        await db.update(schema.organizers).set({ passwordHash: hash, salt }).where(eq(schema.organizers.id, org.id));
        await db.delete(schema.sessions).where(and(eq(schema.sessions.userType, "organizer"), eq(schema.sessions.userId, org.id)));
      } else {
        const parts = await db.select().from(schema.participants).where(eq(schema.participants.email, args.email));
        const p = parts[0];
        if (!p) return fail("No account was found for the email address provided.");
        await db.update(schema.participants).set({ passwordHash: hash, salt }).where(eq(schema.participants.id, p.id));
        await db.delete(schema.sessions).where(and(eq(schema.sessions.userType, "participant"), eq(schema.sessions.userId, p.id)));
      }
      if (tokenRow) await db.update(schema.resetTokens).set({ used: true }).where(eq(schema.resetTokens.id, tokenRow.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  setupOrganizer: defineAction({
    description: "Creates the first (owner) organizer account; only possible when none exists.",
    request: z.object({ email: emailSchema, password: z.string().min(8).max(100), displayName: z.string().trim().min(2).max(100) }),
    response: z.object({ ok: z.boolean(), error: z.string().optional() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const existing = await db.select().from(schema.organizers);
      if (existing.length > 0) return fail("An organizer account already exists. Please ask an existing organizer to add your account.");
      const salt = newSalt();
      await db.insert(schema.organizers).values({ email: args.email, passwordHash: await hashPassword(args.password, salt), salt, displayName: args.displayName, role: "owner" });
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  getTeamPortal: defineAction({
    description: "Returns the signed-in participant's team, submissions, results, and announcements.",
    request: z.object({ token: z.string() }),
    response: z.object({
      team: teamOut, members: z.array(memberOut),
      round1: z.object({ idea: z.string(), problem: z.string(), solution: z.string(), intendedUsers: z.string(), techStack: z.string(), presentationLink: z.string().nullable(), description: z.string().nullable(), updatedAt: z.string() }).nullable(),
      round2: z.object({ prototypeDesc: z.string(), githubLink: z.string().nullable(), demoVideoLink: z.string().nullable(), readmeText: z.string(), installInstructions: z.string(), rolesText: z.string(), limitations: z.string(), updatedAt: z.string() }).nullable(),
      settings: settingsOut,
      announcements: z.array(z.object({ id: z.number(), title: z.string(), body: z.string(), audience: z.string(), createdAt: z.string() })),
      averageScore: z.number().nullable(), scoreCount: z.number(),
    }),
    async handler(ctx, args) {
      const sess = await requireRole(ctx, args.token, "participant");
      const db = ctx.db<typeof schema>();
      const teamRows = await db.select().from(schema.teams).where(eq(schema.teams.id, sess.teamId ?? -1));
      const team = teamRows[0];
      if (!team) throw new Error("Team not found.");
      const s = await ensureSettings(db);
      const members = await db.select().from(schema.participants).where(eq(schema.participants.teamId, team.id));
      const r1 = (await db.select().from(schema.submissionsRound1).where(eq(schema.submissionsRound1.teamId, team.id)))[0];
      const r2 = (await db.select().from(schema.submissionsRound2).where(eq(schema.submissionsRound2.teamId, team.id)))[0];
      const ann = await db.select().from(schema.announcements).orderBy(desc(schema.announcements.id)).limit(20);
      const visible = ann.filter((a) => a.audience === "all" || a.audience === "teams" || (a.audience === "finalists" && team.qualified));
      const teamScores = await db.select().from(schema.scores).where(eq(schema.scores.teamId, team.id));
      const w = (sc: typeof teamScores[number]) => (sc.innovation * s.weightInnovation + sc.technical * s.weightTechnical + sc.impact * s.weightImpact + sc.presentation * s.weightPresentation) / 100;
      const avg = teamScores.length ? teamScores.reduce((a, sc) => a + w(sc), 0) / teamScores.length : null;
      return {
        team: { id: team.id, name: team.name, code: team.code, track: team.track, college: team.college, paymentRef: team.paymentRef, paymentStatus: team.paymentStatus, paymentNote: team.paymentNote, qualified: team.qualified, finalistSlot: team.finalistSlot, createdAt: team.createdAt.toISOString(), memberCount: members.length },
        members: members.map((m) => ({ id: m.id, teamId: m.teamId, name: m.name, email: m.email, phone: m.phone, college: m.college, degree: m.degree, track: m.track, isLeader: m.isLeader, ideaTitle: m.ideaTitle, ideaDescription: m.ideaDescription, problemStatement: m.problemStatement, intendedUsers: m.intendedUsers })),
        round1: r1 ? { idea: r1.idea, problem: r1.problem, solution: r1.solution, intendedUsers: r1.intendedUsers, techStack: r1.techStack, presentationLink: r1.presentationLink, description: r1.description, updatedAt: r1.updatedAt.toISOString() } : null,
        round2: r2 ? { prototypeDesc: r2.prototypeDesc, githubLink: r2.githubLink, demoVideoLink: r2.demoVideoLink, readmeText: r2.readmeText, installInstructions: r2.installInstructions, rolesText: r2.rolesText, limitations: r2.limitations, updatedAt: r2.updatedAt.toISOString() } : null,
        settings: { eventStart: s.eventStart, registrationDeadline: s.registrationDeadline, round1Deadline: s.round1Deadline, round2Deadline: s.round2Deadline, finalistDate: s.finalistDate, minTeamSize: s.minTeamSize, maxTeamSize: s.maxTeamSize, weightInnovation: s.weightInnovation, weightTechnical: s.weightTechnical, weightImpact: s.weightImpact, weightPresentation: s.weightPresentation, resultsPublished: s.resultsPublished, contactEmail: s.contactEmail, whatsappNumber: s.whatsappNumber, registrationFeeInr: s.registrationFeeInr, registrationCountOverride: s.registrationCountOverride ?? null },
        announcements: visible.map((a) => ({ id: a.id, title: a.title, body: a.body, audience: a.audience, createdAt: a.createdAt.toISOString() })),
        averageScore: avg, scoreCount: teamScores.length,
      };
    },
  }),

  saveSubmission1: defineAction({
    description: "Saves or updates the team's Round 1 submission.",
    request: z.object({ token: z.string(), idea: z.string().trim().min(3).max(2000), problem: z.string().trim().min(3).max(3000), solution: z.string().trim().min(3).max(3000), intendedUsers: z.string().trim().min(2).max(1000), techStack: z.string().trim().min(2).max(1000), presentationLink: z.string().trim().max(500).optional(), description: z.string().trim().max(3000).optional() }),
    response: z.object({ ok: z.boolean(), error: z.string().optional() }),
    async handler(ctx, args) {
      const sess = await requireRole(ctx, args.token, "participant");
      const db = ctx.db<typeof schema>();
      const teamId = sess.teamId ?? -1;
      const existing = (await db.select().from(schema.submissionsRound1).where(eq(schema.submissionsRound1.teamId, teamId)))[0];
      const vals = { idea: args.idea, problem: args.problem, solution: args.solution, intendedUsers: args.intendedUsers, techStack: args.techStack, presentationLink: args.presentationLink || null, description: args.description || null, updatedAt: new Date() };
      if (existing) await db.update(schema.submissionsRound1).set(vals).where(eq(schema.submissionsRound1.id, existing.id));
      else await db.insert(schema.submissionsRound1).values({ teamId, ...vals, submittedAt: new Date() });
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  saveSubmission2: defineAction({
    description: "Saves or updates the team's Round 2 submission; qualified teams only.",
    request: z.object({ token: z.string(), prototypeDesc: z.string().trim().min(3).max(3000), githubLink: z.string().trim().max(500).optional(), demoVideoLink: z.string().trim().max(500).optional(), readmeText: z.string().trim().min(3).max(5000), installInstructions: z.string().trim().min(3).max(3000), rolesText: z.string().trim().min(3).max(2000), limitations: z.string().trim().min(3).max(3000) }),
    response: z.object({ ok: z.boolean(), error: z.string().optional() }),
    async handler(ctx, args) {
      const sess = await requireRole(ctx, args.token, "participant");
      const db = ctx.db<typeof schema>();
      const teamId = sess.teamId ?? -1;
      const team = (await db.select().from(schema.teams).where(eq(schema.teams.id, teamId)))[0];
      if (!team?.qualified) return fail("Round 2 is open only to qualified teams. Your team has not been selected for Round 2 yet.");
      const existing = (await db.select().from(schema.submissionsRound2).where(eq(schema.submissionsRound2.teamId, teamId)))[0];
      const vals = { prototypeDesc: args.prototypeDesc, githubLink: args.githubLink || null, demoVideoLink: args.demoVideoLink || null, readmeText: args.readmeText, installInstructions: args.installInstructions, rolesText: args.rolesText, limitations: args.limitations, updatedAt: new Date() };
      if (existing) await db.update(schema.submissionsRound2).set(vals).where(eq(schema.submissionsRound2.id, existing.id));
      else await db.insert(schema.submissionsRound2).values({ teamId, ...vals, submittedAt: new Date() });
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  updatePaymentRef: defineAction({
    description: "Updates the team's payment transaction reference for organizer review.",
    request: z.object({ token: z.string(), paymentRef: z.string().trim().min(3).max(100) }),
    response: z.object({ ok: z.boolean(), error: z.string().optional() }),
    async handler(ctx, args) {
      const sess = await requireRole(ctx, args.token, "participant");
      const db = ctx.db<typeof schema>();
      await db.update(schema.teams).set({ paymentRef: args.paymentRef, paymentStatus: "pending_review", paymentNote: null }).where(eq(schema.teams.id, sess.teamId ?? -1));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  getOrganizerData: defineAction({
    description: "Returns all organizer data: teams, participants, scores, judges, enquiries, and outbox.",
    request: z.object({ token: z.string() }),
    response: z.object({
      settings: settingsOut,
      organizers: z.array(z.object({ id: z.number(), email: z.string(), displayName: z.string(), role: z.string() })),
      teams: z.array(teamOut.extend({ members: z.array(memberOut), hasRound1: z.boolean(), hasRound2: z.boolean(), averageScore: z.number().nullable(), scoreCount: z.number() })),
      enquiries: z.array(z.object({ id: z.number(), name: z.string(), email: z.string(), message: z.string(), status: z.string(), createdAt: z.string() })),
      outbox: z.array(z.object({ id: z.number(), recipient: z.string(), subject: z.string(), kind: z.string(), status: z.string(), createdAt: z.string() })),
      judges: z.array(z.object({ id: z.number(), name: z.string(), email: z.string(), expertise: z.string() })),
      assignments: z.array(z.object({ id: z.number(), judgeId: z.number(), teamId: z.number() })),
      scores: z.array(z.object({ id: z.number(), judgeId: z.number(), teamId: z.number(), round: z.number(), innovation: z.number(), technical: z.number(), impact: z.number(), presentation: z.number(), notes: z.string().nullable(), createdAt: z.string() })),
      announcements: z.array(z.object({ id: z.number(), title: z.string(), body: z.string(), audience: z.string(), createdAt: z.string() })),
      round1: z.array(z.object({ teamId: z.number(), idea: z.string(), techStack: z.string(), updatedAt: z.string() })),
      round2: z.array(z.object({ teamId: z.number(), prototypeDesc: z.string(), githubLink: z.string().nullable(), updatedAt: z.string() })),
    }),
    async handler(ctx, args) {
      await requireRole(ctx, args.token, "organizer");
      const db = ctx.db<typeof schema>();
      const s = await ensureSettings(db);
      const orgs = await db.select().from(schema.organizers);
      const teamRows = await db.select().from(schema.teams).orderBy(desc(schema.teams.id));
      const allMembers = await db.select().from(schema.participants);
      const allScores = await db.select().from(schema.scores);
      const r1 = await db.select().from(schema.submissionsRound1);
      const r2 = await db.select().from(schema.submissionsRound2);
      const w = (sc: typeof allScores[number]) => (sc.innovation * s.weightInnovation + sc.technical * s.weightTechnical + sc.impact * s.weightImpact + sc.presentation * s.weightPresentation) / 100;
      const teams = teamRows.map((t) => {
        const members = allMembers.filter((m) => m.teamId === t.id);
        const sc = allScores.filter((x) => x.teamId === t.id && x.round === 1);
        return {
          id: t.id, name: t.name, code: t.code, track: t.track, college: t.college, paymentRef: t.paymentRef,
          paymentStatus: t.paymentStatus, paymentNote: t.paymentNote, qualified: t.qualified, finalistSlot: t.finalistSlot,
          createdAt: t.createdAt.toISOString(), memberCount: members.length,
          members: members.map((m) => ({ id: m.id, teamId: m.teamId, name: m.name, email: m.email, phone: m.phone, college: m.college, degree: m.degree, track: m.track, isLeader: m.isLeader, ideaTitle: m.ideaTitle, ideaDescription: m.ideaDescription, problemStatement: m.problemStatement, intendedUsers: m.intendedUsers })),
          hasRound1: r1.some((x) => x.teamId === t.id), hasRound2: r2.some((x) => x.teamId === t.id),
          averageScore: sc.length ? sc.reduce((a, x) => a + w(x), 0) / sc.length : null, scoreCount: sc.length,
        };
      });
      const enq = await db.select().from(schema.enquiries).orderBy(desc(schema.enquiries.id));
      const out = await db.select().from(schema.emailOutbox).orderBy(desc(schema.emailOutbox.id)).limit(100);
      const judgeRows = await db.select().from(schema.judges);
      const assignRows = await db.select().from(schema.judgeAssignments);
      const ann = await db.select().from(schema.announcements).orderBy(desc(schema.announcements.id));
      return {
        settings: { eventStart: s.eventStart, registrationDeadline: s.registrationDeadline, round1Deadline: s.round1Deadline, round2Deadline: s.round2Deadline, finalistDate: s.finalistDate, minTeamSize: s.minTeamSize, maxTeamSize: s.maxTeamSize, weightInnovation: s.weightInnovation, weightTechnical: s.weightTechnical, weightImpact: s.weightImpact, weightPresentation: s.weightPresentation, resultsPublished: s.resultsPublished, contactEmail: s.contactEmail, whatsappNumber: s.whatsappNumber, registrationFeeInr: s.registrationFeeInr, registrationCountOverride: s.registrationCountOverride ?? null },
        organizers: orgs.map((o) => ({ id: o.id, email: o.email, displayName: o.displayName, role: o.role })),
        teams,
        enquiries: enq.map((e) => ({ id: e.id, name: e.name, email: e.email, message: e.message, status: e.status, createdAt: e.createdAt.toISOString() })),
        outbox: out.map((o) => ({ id: o.id, recipient: o.recipient, subject: o.subject, kind: o.kind, status: o.status, createdAt: o.createdAt.toISOString() })),
        judges: judgeRows.map((j) => ({ id: j.id, name: j.name, email: j.email, expertise: j.expertise })),
        assignments: assignRows.map((a) => ({ id: a.id, judgeId: a.judgeId, teamId: a.teamId })),
        scores: allScores.map((sc) => ({ id: sc.id, judgeId: sc.judgeId, teamId: sc.teamId, round: sc.round, innovation: sc.innovation, technical: sc.technical, impact: sc.impact, presentation: sc.presentation, notes: sc.notes, createdAt: sc.createdAt.toISOString() })),
        announcements: ann.map((a) => ({ id: a.id, title: a.title, body: a.body, audience: a.audience, createdAt: a.createdAt.toISOString() })),
        round1: r1.map((x) => ({ teamId: x.teamId, idea: x.idea, techStack: x.techStack, updatedAt: x.updatedAt.toISOString() })),
        round2: r2.map((x) => ({ teamId: x.teamId, prototypeDesc: x.prototypeDesc, githubLink: x.githubLink, updatedAt: x.updatedAt.toISOString() })),
      };
    },
  }),

  updateSettings: defineAction({
    description: "Updates organizer-configured event dates, team sizes, scoring weights, contact email, WhatsApp support number, registration fee (INR), and registration count display override.",
    request: z.object({ token: z.string(), eventStart: z.string(), registrationDeadline: z.string(), round1Deadline: z.string(), round2Deadline: z.string(), finalistDate: z.string(), minTeamSize: z.number().int().min(1).max(10), maxTeamSize: z.number().int().min(1).max(10), weightInnovation: z.number().int().min(0).max(100), weightTechnical: z.number().int().min(0).max(100), weightImpact: z.number().int().min(0).max(100), weightPresentation: z.number().int().min(0).max(100), contactEmail: emailSchema, whatsappNumber: z.string().trim().max(20).optional(), registrationFeeInr: z.number().int().min(0).max(10000000).nullable().optional(), registrationCountOverride: z.number().int().min(0).max(1000000).nullable().optional() }),
    response: z.object({ ok: z.boolean(), error: z.string().optional() }),
    async handler(ctx, args) {
      await requireRole(ctx, args.token, "organizer");
      const db = ctx.db<typeof schema>();
      const s = await ensureSettings(db);
      if (args.minTeamSize > args.maxTeamSize) return fail("The minimum team size cannot be greater than the maximum team size.");
      if (args.weightInnovation + args.weightTechnical + args.weightImpact + args.weightPresentation !== 100) return fail("The scoring weights must add up to 100%.");
      // WhatsApp support number is optional: blank clears it (no public
      // WhatsApp link is shown); a value must be a valid Indian mobile and
      // is stored with its +91 prefix.
      let whatsappNumber: string | null = s.whatsappNumber;
      if (args.whatsappNumber !== undefined) {
        if (args.whatsappNumber === "") whatsappNumber = null;
        else {
          const normalized = normalizeIndianMobile(args.whatsappNumber);
          if (!normalized) return fail(`WhatsApp support number: ${INDIAN_MOBILE_ERROR}`);
          whatsappNumber = normalized;
        }
      }
      const registrationFeeInr = args.registrationFeeInr === undefined ? s.registrationFeeInr : args.registrationFeeInr;
      const registrationCountOverride = args.registrationCountOverride === undefined ? (s.registrationCountOverride ?? null) : args.registrationCountOverride;
      if (registrationCountOverride != null && (!Number.isInteger(registrationCountOverride) || registrationCountOverride < 0)) return fail("Registration count must be a whole number of 0 or more, or left blank to show the live count.");
      const vals = { eventStart: args.eventStart, registrationDeadline: args.registrationDeadline, round1Deadline: args.round1Deadline, round2Deadline: args.round2Deadline, finalistDate: args.finalistDate, minTeamSize: args.minTeamSize, maxTeamSize: args.maxTeamSize, weightInnovation: args.weightInnovation, weightTechnical: args.weightTechnical, weightImpact: args.weightImpact, weightPresentation: args.weightPresentation, contactEmail: args.contactEmail, whatsappNumber, registrationFeeInr, registrationCountOverride };
      await db.update(schema.settings).set({ ...vals, updatedAt: new Date() }).where(eq(schema.settings.id, s.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  addOrganizer: defineAction({
    description: "Adds an approved organizer account; at most three organizers in total.",
    request: z.object({ token: z.string(), email: emailSchema, password: z.string().min(8).max(100), displayName: z.string().trim().min(2).max(100) }),
    response: z.object({ ok: z.boolean(), error: z.string().optional() }),
    async handler(ctx, args) {
      await requireRole(ctx, args.token, "organizer");
      const db = ctx.db<typeof schema>();
      const existing = await db.select().from(schema.organizers);
      if (existing.length >= 3) return fail("Organizer access is limited to the owner and two approved organizer accounts (three in total).");
      if (existing.some((o) => o.email === args.email)) return fail("This email address is already registered as an organizer.");
      const salt = newSalt();
      await db.insert(schema.organizers).values({ email: args.email, passwordHash: await hashPassword(args.password, salt), salt, displayName: args.displayName, role: "organizer" });
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  // Razorpay integration lives in server/src/razorpay.ts — a verified Razorpay payment should end by marking the team verified through this same transition.
  verifyPayment: defineAction({
    description: "Marks a team's payment verified or rejected after organizer review. The first time a payment becomes verified, the confirmed-variant poster acknowledgement is queued to the team leader via the owner's connected Gmail mailbox; it is marked sent only by the delivery-token callback after a verified send.",
    request: z.object({ token: z.string(), teamId: z.number().int(), status: z.enum(["verified", "rejected"]), note: z.string().trim().max(500).optional() }),
    response: z.object({ ok: z.boolean(), error: z.string().optional() }),
    async handler(ctx, args) {
      await requireRole(ctx, args.token, "organizer");
      const db = ctx.db<typeof schema>();
      const before = (await db.select().from(schema.teams).where(eq(schema.teams.id, args.teamId)))[0];
      if (!before) return fail("The requested team could not be found.");
      await db.update(schema.teams).set({ paymentStatus: args.status, paymentNote: args.note || null }).where(eq(schema.teams.id, args.teamId));
      // Confirmed poster: exactly once per team, on the first transition
      // into "verified". Re-verification toggles (verified → rejected →
      // verified) never queue a second copy.
      if (args.status === "verified" && before.paymentStatus !== "verified") {
        const prior = await db.select({ id: schema.emailOutbox.id }).from(schema.emailOutbox)
          .where(and(eq(schema.emailOutbox.kind, "payment_verified_ack"), eq(schema.emailOutbox.relatedId, before.id)));
        if (!prior[0]) {
          const members = await db.select().from(schema.participants).where(eq(schema.participants.teamId, before.id));
          const leader = members.find((m) => m.isLeader) ?? members[0];
          if (leader) {
            const s = await ensureSettings(db);
            const ackDetails: AckDetails = {
              name: leader.name, email: leader.email, phone: leader.phone, teamName: before.name, code: before.code,
              track: before.track, college: before.college, reference: `SPX-${before.id}`,
              paymentRef: before.paymentRef ?? undefined, feeInr: s.registrationFeeInr, isJoin: false,
              paymentState: "verified", memberCount: members.length, minTeamSize: s.minTeamSize, maxTeamSize: s.maxTeamSize,
              eventStart: s.eventStart, registrationDeadline: s.registrationDeadline, round1Deadline: s.round1Deadline,
              whatsappNumber: s.whatsappNumber,
            };
            const subject = ackSubject("verified");
            const body = registrationAckText(ackDetails);
            const htmlBody = registrationAckHtml(ackDetails);
            const queued = await queueEmail(db, { recipient: leader.email, subject, body, htmlBody, kind: "payment_verified_ack", relatedId: before.id });
            await dispatchEmail(ctx, queued, leader.email, subject, body, htmlBody);
          }
        }
      }
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  createAnnouncement: defineAction({
    description: "Creates an organizer announcement.",
    request: z.object({ token: z.string(), title: z.string().trim().min(2).max(150), body: z.string().trim().min(2).max(3000), audience: z.enum(["all", "teams", "finalists"]) }),
    response: z.object({ ok: z.boolean(), error: z.string().optional() }),
    async handler(ctx, args) {
      await requireRole(ctx, args.token, "organizer");
      const db = ctx.db<typeof schema>();
      await db.insert(schema.announcements).values({ title: args.title, body: args.body, audience: args.audience });
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  deleteAnnouncement: defineAction({
    description: "Deletes an organizer announcement.",
    request: z.object({ token: z.string(), id: z.number().int() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      await requireRole(ctx, args.token, "organizer");
      const db = ctx.db<typeof schema>();
      await db.delete(schema.announcements).where(eq(schema.announcements.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  createJudge: defineAction({
    description: "Adds a judge.",
    request: z.object({ token: z.string(), name: z.string().trim().min(2).max(100), email: emailSchema, expertise: z.string().trim().min(2).max(200) }),
    response: z.object({ ok: z.boolean(), error: z.string().optional() }),
    async handler(ctx, args) {
      await requireRole(ctx, args.token, "organizer");
      const db = ctx.db<typeof schema>();
      await db.insert(schema.judges).values({ name: args.name, email: args.email, expertise: args.expertise });
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  assignJudge: defineAction({
    description: "Assigns a judge to a team for review.",
    request: z.object({ token: z.string(), judgeId: z.number().int(), teamId: z.number().int() }),
    response: z.object({ ok: z.boolean(), error: z.string().optional() }),
    async handler(ctx, args) {
      await requireRole(ctx, args.token, "organizer");
      const db = ctx.db<typeof schema>();
      const existing = await db.select().from(schema.judgeAssignments).where(and(eq(schema.judgeAssignments.judgeId, args.judgeId), eq(schema.judgeAssignments.teamId, args.teamId)));
      if (existing[0]) return fail("This judge is already assigned to the selected team.");
      await db.insert(schema.judgeAssignments).values({ judgeId: args.judgeId, teamId: args.teamId });
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  submitScore: defineAction({
    description: "Records weighted-criteria scores from a judge for a team and round.",
    request: z.object({ token: z.string(), judgeId: z.number().int(), teamId: z.number().int(), round: z.number().int().min(1).max(2), innovation: z.number().int().min(0).max(10), technical: z.number().int().min(0).max(10), impact: z.number().int().min(0).max(10), presentation: z.number().int().min(0).max(10), notes: z.string().trim().max(1000).optional() }),
    response: z.object({ ok: z.boolean(), error: z.string().optional() }),
    async handler(ctx, args) {
      await requireRole(ctx, args.token, "organizer");
      const db = ctx.db<typeof schema>();
      const vals = { judgeId: args.judgeId, teamId: args.teamId, round: args.round, innovation: args.innovation, technical: args.technical, impact: args.impact, presentation: args.presentation, notes: args.notes };
      const existing = await db.select().from(schema.scores).where(and(eq(schema.scores.judgeId, vals.judgeId), eq(schema.scores.teamId, vals.teamId), eq(schema.scores.round, vals.round)));
      const prior = existing[0];
      if (prior) {
        await db.update(schema.scores).set({ innovation: vals.innovation, technical: vals.technical, impact: vals.impact, presentation: vals.presentation, notes: vals.notes || null }).where(eq(schema.scores.id, prior.id));
      } else {
        await db.insert(schema.scores).values({ ...vals, notes: vals.notes || null });
      }
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  runTop30Selection: defineAction({
    description: "Selects the top 30 scored Round 1 teams as qualified for Round 2.",
    request: z.object({ token: z.string() }),
    response: z.object({ ok: z.boolean(), qualifiedCount: z.number(), error: z.string().optional() }),
    async handler(ctx, args) {
      await requireRole(ctx, args.token, "organizer");
      const db = ctx.db<typeof schema>();
      const s = await ensureSettings(db);
      const allScores = await db.select().from(schema.scores).where(eq(schema.scores.round, 1));
      const w = (sc: typeof allScores[number]) => (sc.innovation * s.weightInnovation + sc.technical * s.weightTechnical + sc.impact * s.weightImpact + sc.presentation * s.weightPresentation) / 100;
      const byTeam = new Map<number, number[]>();
      for (const sc of allScores) {
        const arr = byTeam.get(sc.teamId) ?? [];
        arr.push(w(sc));
        byTeam.set(sc.teamId, arr);
      }
      const ranked = [...byTeam.entries()].map(([teamId, arr]) => ({ teamId, avg: arr.reduce((a, b) => a + b, 0) / arr.length })).sort((a, b) => b.avg - a.avg).slice(0, 30);
      const allTeams = await db.select().from(schema.teams);
      for (const t of allTeams) {
        await db.update(schema.teams).set({ qualified: ranked.some((r) => r.teamId === t.id) }).where(eq(schema.teams.id, t.id));
      }
      ctx.invalidateQueries();
      return { ok: true, qualifiedCount: ranked.length };
    },
  }),

  publishResults: defineAction({
    description: "Publishes or hides selection results for participants.",
    request: z.object({ token: z.string(), published: z.boolean() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      await requireRole(ctx, args.token, "organizer");
      const db = ctx.db<typeof schema>();
      const s = await ensureSettings(db);
      await db.update(schema.settings).set({ resultsPublished: args.published, updatedAt: new Date() }).where(eq(schema.settings.id, s.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  setFinalistSlot: defineAction({
    description: "Sets a qualified team's finalist schedule slot.",
    request: z.object({ token: z.string(), teamId: z.number().int(), slot: z.string().trim().max(200) }),
    response: z.object({ ok: z.boolean(), error: z.string().optional() }),
    async handler(ctx, args) {
      await requireRole(ctx, args.token, "organizer");
      const db = ctx.db<typeof schema>();
      await db.update(schema.teams).set({ finalistSlot: args.slot || null }).where(eq(schema.teams.id, args.teamId));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  updateEnquiryStatus: defineAction({
    description: "Updates an enquiry's handling status.",
    request: z.object({ token: z.string(), id: z.number().int(), status: z.enum(["new", "read", "replied"]) }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      await requireRole(ctx, args.token, "organizer");
      const db = ctx.db<typeof schema>();
      await db.update(schema.enquiries).set({ status: args.status }).where(eq(schema.enquiries.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  removeParticipant: defineAction({
    description: "Removes a participant from their team (organizer only).",
    request: z.object({ token: z.string(), participantId: z.number().int() }),
    response: z.object({ ok: z.boolean(), error: z.string().optional() }),
    async handler(ctx, args) {
      await requireRole(ctx, args.token, "organizer");
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.participants).where(eq(schema.participants.id, args.participantId));
      const p = rows[0];
      if (!p) return fail("The selected participant could not be found.");
      await db.delete(schema.sessions).where(and(eq(schema.sessions.userType, "participant"), eq(schema.sessions.userId, p.id)));
      await db.delete(schema.participants).where(eq(schema.participants.id, p.id));
      const remaining = await db.select().from(schema.participants).where(eq(schema.participants.teamId, p.teamId));
      if (remaining.length === 0) {
        await db.delete(schema.submissionsRound1).where(eq(schema.submissionsRound1.teamId, p.teamId));
        await db.delete(schema.submissionsRound2).where(eq(schema.submissionsRound2.teamId, p.teamId));
        await db.delete(schema.teams).where(eq(schema.teams.id, p.teamId));
      }
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
} satisfies ActionsModule;
