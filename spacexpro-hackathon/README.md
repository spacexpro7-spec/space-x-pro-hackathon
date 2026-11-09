# SPACExPRO Hackathon — Source Code

A full-stack hackathon platform: public home page, team registration
(create a team or join with an invitation code), a Team Portal for
participants, and a hidden, organizer-only area for managing teams,
payments review, judging, announcements, enquiries, and event settings.

Tracks: AI/ML · Cyber Security · Web Development · Student Innovation.
Prize: an 11-inch iPad with A16 chip for every winning team member.
Enquiries: space.x.pro.7@gmail.com

This ZIP is the complete project source, current as of 9 November 2026.

**Standalone edition (fixed 9 Nov 2026):** this package now runs on its
own — **Windows, macOS and Linux** — with only Bun installed. Earlier
ZIPs could not run outside Muse at all: `package.json` had **no `dev`
script** (so `bun run dev` failed with "script not found"), and the
`@hatch/space-sdk` dependency pointed at a Muse-machine-only path
(`file:/opt/hatch/...`) that does not exist on a personal computer, so
`bun install` failed too. It was never a Windows-only project — the
missing pieces were the dev script and that hosted SDK. Both are now
included in the box (see `local/` below), and the site is fully
responsive on desktop, iPhone and Android. Quick start: **START-HERE.txt**.
It contains **no live data** — no database file, no participant or
organizer records, and no secrets. See "What is not included" below.

> Internal note: the Muse artifact slug remains `orbitx-hackathon`
> (see `space.json`) for continuity; it is never shown to visitors.
> All user-visible branding is SPACExPRO, and new registrations receive
> `SPX-` references.

---

## Folder structure

```
spacexpro-hackathon/
├── README.md               ← this file
├── .env.example            ← environment variable names (no values)
├── package.json            ← dependencies and build/typecheck scripts
├── bun.lock                ← locked dependency versions (Bun)
├── bunfig.toml             ← Bun install configuration
├── tsconfig.base.json      ← shared TypeScript compiler settings
├── space.json              ← Muse web-artifact metadata (slug, runtime; not used locally)
├── AGENTS.md               ← notes for working on this artifact in Muse
├── DATA-PLAN.md            ← data sources, provenance, and design history
├── icon.webp               ← app icon
├── START-HERE.txt          ← 1-page quick start (Windows / Mac / phone testing)
├── local/                  ← standalone runtime (no Muse host needed)
│   ├── dev.ts              ← `bun run dev` / `bun run start` server (site + /actions API)
│   ├── db.ts               ← local SQLite (app.db) + migration runner
│   ├── build.ts            ← `bun run build`
│   ├── typecheck.ts        ← `bun run typecheck`
│   └── space-sdk/          ← local replacement for @hatch/space-sdk
│                             (the hosted package lived at a Muse-only
│                             file:/opt/hatch/... path — the reason
│                             installs failed on personal computers)
│
├── client/                 ← React frontend
│   ├── index.html          ← HTML shell (fonts load non-blocking)
│   ├── build.mjs           ← client bundle build (via @hatch/space-sdk)
│   ├── tsconfig.json
│   └── src/
│       ├── main.tsx        ← entry point (React root + query client)
│       ├── App.tsx         ← the whole UI: Home, Register, Team Portal,
│       │                     Organizer area, motion system, theme usage
│       ├── api.ts          ← typed RPC client for the server actions
│       ├── theme.css       ← design tokens and all styling
│       │                     (Black & Shining Gold palette, Syne + Inter)
│       ├── globals.d.ts    ← asset module declarations
│       └── assets/
│           └── ipad-11-original.jpg  ← prize photo (Apple official image)
│
├── server/                 ← backend (runs on the Muse space runtime)
│   ├── tsconfig.json
│   └── src/
│       ├── actions.ts      ← all server actions: registration, sign-in,
│       │                     submissions, scoring, organizer admin,
│       │                     email outbox + delivery callbacks
│       ├── razorpay.ts     ← ★ THE Razorpay integration point — the ONLY
│       │                     file to edit to connect Razorpay (config,
│       │                     create-order / verify-signature / webhook
│       │                     stubs, all TODO-marked). See "Integrating
│       │                     Razorpay" below.
│       └── schema.ts       ← Drizzle ORM schema (all tables)
│
└── drizzle/                ← SQL migrations (schema only, no data)
    ├── 0001_initial.sql
    ├── 0002_orbitx_schema.sql
    ├── 0003_add_delivery_token_to_email_outbox.sql
    ├── 0004_india_focus_phone_whatsapp_fee.sql
    ├── 0005_add_registration_count_override.sql
    ├── 0006_switch_contact_email_to_spacexpro_mailbox.sql
    ├── 0007_add_html_body_to_email_outbox_for_poster_acknowledgement.sql
    └── meta/_journal.json
```

## Tech stack

- **Runtime / tooling:** Bun 1.3, TypeScript (strict)
- **Frontend:** React 19, TanStack React Query, Tailwind CSS 4
- **Backend:** typed server actions via `@hatch/space-sdk`
- **Database:** SQLite via Drizzle ORM (schema in `server/src/schema.ts`,
  migrations in `drizzle/`)
- **Validation:** Zod schemas on every action

## Integrating Razorpay

**Everything Razorpay lives in exactly one file: `server/src/razorpay.ts`.**
You do not need to hunt through the codebase — open that file and follow
its banner comments. Every other Razorpay mention in the code is a
one-line pointer back to that file.

**Set these environment variables** (names only — listed grouped under
`# Razorpay` in `.env.example`; never commit real values):

- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`

**The 3 steps** (each is a TODO-marked stub inside `razorpay.ts`):

1. **Create order** — `createRazorpayOrder(...)`: on the server, create a
   Razorpay order for the registration fee from Organizer Settings
   (`registrationFeeInr`, in rupees). Razorpay amounts are in **paise**
   (₹1 = 100 paise, minimum 100 paise) — `feeRupeesToPaise(...)` in the
   same file converts for you. Store the returned order id with the team.
2. **Checkout** — the browser opens Razorpay Checkout with that order id
   and the **Key Id only**. The Key Secret and Webhook Secret must never
   reach the frontend — they stay on the server, in the environment.
3. **Verify** — on the server, check the payment with
   `verifyRazorpayPaymentSignature(...)` (already implemented: HMAC-SHA256
   of `order_id + "|" + payment_id` with the Key Secret) and/or the
   webhook in `handleRazorpayWebhook(...)` (signed with the Webhook
   Secret). Only a payment that passes verification may be marked
   verified.

**What you get for free once a payment is marked verified:** the existing
code sends the "Payment Verified" poster acknowledgement email to the
team leader automatically (once only) — the same transition the
organizer's manual **Verify Payment** button uses today (see
`verifyPayment` in `server/src/actions.ts`).

**Until the keys are set:** `razorpayConfigured` stays `false`, no
checkout exists, and nothing changes for visitors — the site honestly
shows **"Pending Verification"** and participants use the manual flow:
pay, then submit the UPI reference / UTR for an organizer to verify.

## Current features

- **SPACExPRO branding:** every user-visible surface — page title,
  preloader, header/footer wordmarks, hero, marquee, Register, Team
  Portal, Organizer area, FAQs, CSV filenames, and all email
  subjects/bodies/signatures — reads SPACExPRO. Contact and enquiries
  use space.x.pro.7@gmail.com everywhere.
- **Poster acknowledgement email:** on first registration (create or
  join, exactly once) the participant receives a poster-style email
  from space.x.pro.7@gmail.com — near-black card in a double gold
  frame, "You're in." headline, the team code large in gold at the
  centre, plus participant/team name, SPX- reference, track, college,
  event and Round 1 dates in IST, the payment block, and next steps.
  The on-screen success screen mirrors the same poster design and has
  a Copy Team Code button. Migration 0007 adds the `html_body` column
  that carries the poster HTML alongside the plain-text version.
  Payment wording stays truthful: "Payment — Pending Verification"
  until a payment is verified, when a "Payment Verified" variant of
  the same poster is sent to the team leader, once only.
- **India-focused usage:** payment methods are presented UPI-first
  (PhonePe, Paytm, Google Pay, BHIM UPI) via Razorpay, then Indian
  cards, netbanking, and wallets; the UPI reference / UTR number is the
  payment reference. Registration requires an Indian mobile number
  (fixed +91 prefix, exactly 10 digits starting 6–9, validated in the
  form and again on the server). Dates and times use Asia/Kolkata
  (IST) with Indian date formatting. An organizer can set a
  registration fee in ₹ (rendered with Indian digit grouping, e.g.
  ₹1,00,000) and an optional WhatsApp support number in Organizer
  Settings; both are empty by default and nothing is shown until set.
- **Registration count box:** a small box below Sign In in the header
  shows the live number of registered teams. An organizer can set a
  display override ("Registration count (display override)" in
  Organizer Settings, migration 0005); clearing it returns the box to
  the live count.
- **Sign-in resilience:** sign-in and read queries retry transient
  connection drops with backoff, failures show clear actionable
  messages (never raw transport errors), a failed page load preserves
  the session behind a "Try Again" state, and queries refetch when
  the connection returns.
- **Headline word-wrap fix:** headline letters are grouped into whole
  words for the per-letter animation, so lines only ever break at
  spaces — words are never split mid-word across lines.
- **Horizontal tracks showcase:** on desktop the four track cards are
  pinned and travel sideways driven by the section's on-screen
  position, so the travel works in any scroll container; on mobile
  and under reduced-motion the cards stack and stay fully reachable.
- **Email delivery:** queued mail lives in the `email_outbox` table.
  On queue, a delivery task sends that one message through the
  owner's connected Gmail mailbox (space.x.pro.7@gmail.com), verifies
  the send in Sent mail, and only then confirms delivery with a
  one-time token — a row is marked `sent` only after that verified
  callback. This covers first-registration poster acknowledgements
  (create + join), enquiries to space.x.pro.7@gmail.com, and
  password-reset codes. If a send is not approved or cannot be
  verified, the row stays pending/failed and is never marked sent.
  No mail credentials are stored in this codebase.
- **Payments honesty:** Razorpay is not connected yet — no keys
  or verified webhook exist. All Razorpay code lives in one clearly
  marked file, `server/src/razorpay.ts` (config + TODO stubs; see
  "Integrating Razorpay" above). Participants submit a payment
  reference, an organizer verifies it manually, and every payment
  shows "Pending Verification" until a verified webhook result
  exists.

## How to install and run (Windows · macOS · Linux)

You only need **Bun** (https://bun.sh — on Windows use the PowerShell
installer on that page, on Mac/Linux the curl installer). Node.js is
not required. There are no OS-specific steps and nothing to compile.

```sh
# 1. Extract this ZIP and open a terminal in the extracted folder
#    (the folder containing package.json)

# 2. Install dependencies
bun install

# 3. Run the app
bun run dev
```

Then open **http://localhost:3000** in your browser. That is the whole
site — home page, registration, Team Portal and the organizer area —
backed by a local SQLite database file (`app.db`, created automatically
on first run from the migrations in `drizzle/`; delete it any time to
start again with an empty database).

Other commands:

```sh
bun run build       # production bundles -> client/dist + server/dist
bun run start       # same server as dev, run after a build
bun run typecheck   # TypeScript check for client + server
```

Useful optional settings (environment variables — see `.env.example`):

- `PORT` — port to serve on (default `3000`).
- `HOST` — set to `0.0.0.0` to open the site on a phone connected to
  the same Wi-Fi: run `bun run dev`, then on the phone open
  `http://<your-computer-ip>:3000`.
- `DATABASE_PATH` — where the SQLite file lives (default `./app.db`).

How it works locally: `bun run dev` starts `local/dev.ts`, a single Bun
server that (1) creates/migrates `app.db`, (2) builds the React client
(and rebuilds it automatically when you edit files under
`client/src/`), and (3) serves the site and the `/actions` API on one
port. The Muse-hosted `@hatch/space-sdk` package is replaced by the
small local implementation in `local/space-sdk/` (same API surface the
app uses — actions, query client, client bundler), referenced from
`package.json` with a relative `file:` path that resolves on every OS.
All scripts are Bun/TypeScript programs, never shell command chains,
so they behave identically in Windows PowerShell / cmd, macOS Terminal
and Linux shells.

Two honest local-mode differences from the hosted site:

- **Email:** locally there is no Gmail connection, so acknowledgement
  and enquiry emails stay **pending** in the Organizer outbox and are
  never marked sent. Everything else (registration, sign-in, payments
  review, judging) works end-to-end.
- **Payments:** Razorpay is still not connected (see below) — payment
  status stays **Pending Verification** until an organizer verifies a
  submitted UPI reference / UTR, exactly as on the hosted site.

## Environment variables

With **one exception**, the application code reads no environment
variables: `server/src/razorpay.ts` — the single Razorpay integration
point — reads `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and
`RAZORPAY_WEBHOOK_SECRET` from the environment (see "Integrating
Razorpay" above). Everything else the app needs (event dates, team-size
limits, scoring weights, contact email, registration fee, WhatsApp
number, registration-count override) lives in the database `settings`
table and is edited from the Organizer area.

`.env.example` lists the variable names a hosting environment may
provide, with the three Razorpay names grouped under `# Razorpay`.
It contains names only — no values, and no secret values are shipped
anywhere in this ZIP.

## First-time setup

- **Organizer access:** the organizer area is not linked from public
  navigation. Use the discreet "Organizer sign-in" footer link or the
  "Are you an organizer?" link on the Team Portal sign-in; in a
  regular browser tab, appending `#organizer` to the page URL also
  works. If no organizer account exists yet, the sign-in page offers
  "Create the owner account here" — account creation is capped at
  the owner plus two approved organizers, enforced server-side.
- **Event dates:** verify the dates in Organizer → Settings before
  opening registrations; the countdown and schedule read from there.

## What is not included (deliberately excluded)

- `node_modules/` and the Bun install cache — reinstall with
  `bun install`
- Build outputs — `client/dist/`, `client/dist-cvm/`, `server/dist/`,
  `.space-build*/`, `*.tsbuildinfo`
- The live database — `app.db` (plus `-wal` / `-shm`) and all real
  participant, organizer, team, and enquiry records. Only the schema
  (`server/src/schema.ts`) and migrations (`drizzle/`) are included.
- Audit screenshots/reports and other build-time artifacts
- Any secret or credential values — passwords are only ever stored in
  the live database as salted hashes; none are present here
