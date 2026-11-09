import { Fragment, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SpaceActionError, actionRetryDelay, shouldRetryAction } from "@hatch/space-sdk/client";
import { api, type ApiResponse } from "./api";
import ipadImg from "./assets/ipad-11-original.jpg";

type View = "home" | "register" | "portal" | "organizer" | "preview";
type Session = { token: string; role: "participant" | "organizer"; name: string };
type PublicData = ApiResponse<typeof api, "getPublic">;
type PortalData = ApiResponse<typeof api, "getTeamPortal">;
type OrgData = ApiResponse<typeof api, "getOrganizerData">;

const TRACKS = [
  { name: "AI/ML", desc: "Intelligent applications that learn, reason, and support better decisions.", glyph: "◈" },
  { name: "Cyber Security", desc: "Defensive security solutions that protect people, data, and systems.", glyph: "⬢" },
  { name: "Web Development", desc: "Useful web experiences that are fast, accessible, and enjoyable to use.", glyph: "◐" },
  { name: "Student Innovation", desc: "Original student ideas that offer new answers to problems that matter.", glyph: "✦" },
] as const;

const inputCls = "w-full rounded-md border border-[var(--border)] bg-[#0A0A0B] px-3.5 py-3 text-[15px] text-[var(--text)] placeholder:text-[var(--muted)] shadow-[0_1px_2px_rgba(0,0,0,0.45)] transition-colors focus:border-[var(--accent2)]";
const labelCls = "block font-letter text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--dim)]";
const btnPrimary = "inline-flex items-center justify-center gap-2.5 rounded-full gold-flow px-6 py-3 text-sm font-semibold text-[#0A0A0A] shadow-[0_12px_30px_rgba(245,197,66,0.35),0_0_0_1px_rgba(245,197,66,0.25)] transition-all duration-300 hover:-translate-y-0.5 hover:brightness-110 hover:shadow-[0_16px_36px_rgba(255,215,0,0.35),0_0_0_1px_rgba(245,197,66,0.35)] disabled:opacity-50 disabled:transform-none";
const btnGhost = "inline-flex items-center justify-center gap-2 rounded-full border border-[rgba(255,215,0,0.55)] bg-[rgba(5,5,6, 0.90)] px-6 py-3 text-sm font-semibold text-[var(--text)] backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-[var(--accent2)] hover:shadow-[0_10px_28px_rgba(245,197,66,0.45)] disabled:opacity-50 disabled:transform-none";
const cardCls = "reveal reveal-unfold sharp card-hover border border-[var(--border)] bg-[linear-gradient(145deg,#070708,#0A0A0B_52%,#0E0E10)] p-5 shadow-[0_10px_30px_rgba(0,0,0,0.45)] sm:p-6 backdrop-blur-[3px]";

/**
 * THE orbit system — the single fixed configuration for the hero solar
 * system. Exactly three orbits, defined once, rendered once, by
 * OrbitVisual only. The canvas (HeroCanvas) draws stars/glow only and
 * must never draw orbit paths or planets, and no mobile-only decoration
 * may add rings: a previous layout had both systems drawing at different
 * centres (3 canvas ellipses + 3 DOM rings) plus a 2-ring mobile
 * decoration, which read as extra orbits appearing "sometimes".
 */
const ORBITS = [
  { size: "inset-0", ring: "orbit-ring-glow" },
  { size: "inset-[14%]", ring: "" },
  { size: "inset-[28%]", ring: "" },
] as const;

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = () => typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches;

/**
 * Connection resilience. The page talks to its server through the host's
 * live gateway connection; when that connection drops or reconnects
 * mid-request, action calls fail with raw transport errors (for example
 * "Gateway WebSocket reconnecting"). Those raw strings must never reach
 * the reader, and a brief drop must not strand anyone: read queries
 * retry transport failures with backoff, sign-in retries them too (it is
 * safe — it only creates a session), and every failure surfaces as
 * clear, actionable copy with the form's contents left intact.
 */
const TRANSPORT_MESSAGE = "The connection was interrupted. Please check your internet connection and try again — everything you have entered is still here.";
function errorMessageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return "";
}
function isTransportError(e: unknown): boolean {
  if (e instanceof SpaceActionError) return e.status >= 500 || e.retrySafe;
  if (e instanceof TypeError) return true;
  const m = errorMessageOf(e);
  return /gateway|websocket|failed to fetch|network|load failed|space is no longer available|timed out|aborted/i.test(m);
}
function friendlyError(e: unknown, fallback: string): string {
  if (isTransportError(e)) return TRANSPORT_MESSAGE;
  const raw = errorMessageOf(e);
  // Server-side handler messages arrive wrapped as "action <name> error:
  // <message>"; those messages are written for readers, so show them.
  const stripped = raw.replace(/^action [A-Za-z]+ error: /, "").trim();
  if (stripped !== raw && stripped.length > 0 && stripped.length <= 300) return stripped;
  return fallback;
}
async function withTransportRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await Promise.race([
        fn(),
        new Promise<never>((_, reject) => { setTimeout(() => reject(new TypeError("Request timed out")), 20000); }),
      ]);
    } catch (e) {
      lastErr = e;
      if (!isTransportError(e) || i === attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, 700 * (i + 1) + Math.random() * 300));
    }
  }
  throw lastErr;
}
// Retry policy for this app's read queries: the SDK default (explicit
// pre-invocation failures only), extended to transport failures — reads
// are idempotent, so re-reading after a dropped connection is safe.
const readRetry = (failureCount: number, error: unknown) => shouldRetryAction(failureCount, error) || (isTransportError(error) && failureCount < 3);

/**
 * The scroll container is NOT the window. The host renders the artifact
 * inside a fixed, overflow:auto root element ([data-generated-space-root]);
 * the document itself never scrolls, so window.scrollY stays 0 and
 * window.scrollTo does nothing. Every scroll read, write, and listener
 * below must go through these helpers, which target that element (with a
 * window fallback for any host that does scroll the document).
 */
function scrollContainer(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-generated-space-root]");
}
function currentScrollY(): number {
  const el = scrollContainer();
  return el ? el.scrollTop : window.scrollY;
}
function maxScrollY(): number {
  const el = scrollContainer();
  return el
    ? Math.max(0, el.scrollHeight - el.clientHeight)
    : Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
}
function scrollToTop(): void {
  const el = scrollContainer();
  if (el) el.scrollTo({ top: 0, behavior: "instant" });
  else window.scrollTo({ top: 0, behavior: "instant" });
}
/** Scroll the host scroll container to an in-page section (e.g. the prize).
 * window.scrollTo does nothing in this host, so the offset is computed
 * against the container's own scroll position. */
function scrollToId(id: string): void {
  const target = document.getElementById(id);
  if (!target) return;
  const el = scrollContainer();
  if (el) el.scrollTo({ top: el.scrollTop + target.getBoundingClientRect().top - 76, behavior: reducedMotion() ? "instant" : "smooth" });
  else target.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
}
function addScrollListener(fn: () => void): () => void {
  const el = scrollContainer();
  if (el) {
    el.addEventListener("scroll", fn, { passive: true });
    return () => el.removeEventListener("scroll", fn);
  }
  window.addEventListener("scroll", fn, { passive: true });
  return () => window.removeEventListener("scroll", fn);
}

/** Rolling digit: re-mounts on change so the new digit slides up into its mask. */
function DigitRoll({ digit }: { digit: string }) {
  return (
    <span className="digit-window" aria-hidden="true">
      <span key={digit} className="digit-roll">{digit}</span>
    </span>
  );
}
function RollingNumber({ value }: { value: number }) {
  const s = String(value).padStart(2, "0");
  return (
    <span className="tabular-nums" aria-hidden="true">
      {s.split("").map((d, i) => <DigitRoll key={i} digit={d} />)}
    </span>
  );
}

/** Count-up number for organizer stats; static when reduced motion is on. */
function CountUp({ value, suffix }: { value: number; suffix?: string }) {
  const [n, setN] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (reducedMotion()) { setN(value); return; }
    let raf = 0; let started = false;
    const io = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting || started) return;
      started = true; io.disconnect();
      // Start the clock from the first rAF callback timestamp, not from
      // performance.now(): the two can come from different time origins
      // in the hosting frame, and a negative (t - t0) then cubes into a
      // huge negative count (seen as a large negative team total after a
      // view change). Clamp both ways, as the preloader counter does.
      let t0: number | null = null;
      const tick = (t: number) => {
        if (t0 === null) t0 = t;
        const p = Math.max(0, Math.min(1, (t - t0) / 900));
        const eased = 1 - Math.pow(1 - p, 3);
        setN(Math.round(value * eased));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, { threshold: 0.4 });
    if (ref.current) io.observe(ref.current);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [value]);
  return <span ref={ref}>{n}{suffix}</span>;
}

/** Roll-text label: duplicates the text so it rolls upward on hover. */
function RollText({ text, className }: { text: string; className?: string }) {
  return (
    <span className={`roll ${className ?? ""}`}>
      <span className="roll-inner"><span>{text}</span><span aria-hidden="true">{text}</span></span>
    </span>
  );
}

/** Per-letter 3D flip/roll-in for major headlines. Each letter rolls up
 * on a perspective plane with a per-letter stagger (--i). When `active`
 * is given (hero, gated on the preloader boot flag) it drives .is-in
 * directly; otherwise an IntersectionObserver fires it once on entry.
 * The full text stays on the parent aria-label so screen readers hear
 * the heading once, not letter by letter. */
function LetterFlip({ text, active }: { text: string; active?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (active !== undefined) { el.classList.toggle("is-in", active); return; }
    if (reducedMotion()) { el.classList.add("is-in"); return; }
    const io = new IntersectionObserver((en) => {
      if (en[0]?.isIntersecting) { el.classList.add("is-in"); io.disconnect(); }
    }, { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, [active]);
  // Chars are grouped into word wrappers (.letter-word, atomic inline-blocks
  // joined by real spaces): line breaks may only fall at spaces, never inside
  // a word. A flat per-char split let the browser break lines between any two
  // letters, slicing words across lines ("winnin/g", "ch/allenge") — the
  // cut-off-font defect. The stagger index still runs across the whole text,
  // counting each space as one step so the roll rhythm is unchanged.
  let offset = 0;
  const words = text.split(" ").map((word) => {
    const start = offset;
    offset += word.length + 1;
    return { word, start };
  });
  return (
    <span ref={ref} className="letter-flip" aria-label={text}>
      {words.map(({ word, start }, wi) => (
        <Fragment key={wi}>
          <span className="letter-word" aria-hidden="true">
            {word.split("").map((ch, ci) => (
              <span key={ci} aria-hidden="true" className="letter-flip-char" style={{ "--i": start + ci } as React.CSSProperties}>{ch}</span>
            ))}
          </span>
          {wi < words.length - 1 ? " " : null}
        </Fragment>
      ))}
    </span>
  );
}

/** Magnetic wrapper: nudges its child toward the pointer on fine pointers only. */
function Magnetic({ children, strength = 7 }: { children: ReactNode; strength?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !finePointer() || reducedMotion()) return;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      el.style.transform = `translate3d(${(dx / r.width) * strength}px, ${(dy / r.height) * strength}px, 0)`;
    };
    const leave = () => { el.style.transform = "translate3d(0,0,0)"; };
    el.addEventListener("pointermove", move, { passive: true });
    el.addEventListener("pointerleave", leave);
    return () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerleave", leave); };
  }, [strength]);
  return <span ref={ref} className="magnetic">{children}</span>;
}

/**
 * Scroll telemetry: one rAF loop drives the progress bar, the --sp/--sv CSS
 * variables (consumed by the marquee skew and giant text), and the pointer glow.
 * Transform/opacity only; nothing here forces layout per frame beyond the
 * document-height read, which is cached and refreshed on resize.
 */
function useScrollTelemetry() {
  useEffect(() => {
    if (reducedMotion()) return;
    let raf = 0; let lastY = currentScrollY(); let lastT = performance.now(); let vel = 0;
    let docH = 1;
    const measure = () => { docH = Math.max(1, maxScrollY()); };
    measure();
    const loop = (t: number) => {
      const y = currentScrollY();
      measure();
      const dt = Math.max(1, t - lastT);
      const inst = (y - lastY) / dt;
      vel += (inst - vel) * 0.14;
      lastY = y; lastT = t;
      const clamped = Math.max(-1, Math.min(1, vel * 1.4));
      document.documentElement.style.setProperty("--sv", clamped.toFixed(3));
      document.documentElement.style.setProperty("--sp", (docH ? y / docH : 0).toFixed(4));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    window.addEventListener("resize", measure, { passive: true });
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", measure); };
  }, []);
}

/**
 * Scrolling is intentionally native. A previous version intercepted every
 * wheel event on desktop and lerped the page toward a target with
 * per-frame window.scrollTo calls; that fought the CSS smooth-scroll on
 * <html>, snapped keyboard/scrollbar scrolls back to the lerp target, and
 * could leave its "active" flag set across a view/menu transition, after
 * which no wheel event would ever move the page again. Native scrolling
 * works for mouse, trackpad, keyboard, scrollbar, touch, and assistive
 * technology, in and out of the hosting iframe. The remaining motion
 * (reveals, marquee velocity, pinned showcase, cursor, canvas) only
 * observes scroll position; it never drives or blocks it. View changes
 * still jump to the top instantly in go() below, covered by the wipe.
 */

/** Keyboard scrolling for the real scroll container: PageDown/PageUp, End,
 * Home, and Space only scroll the document when focus is not inside an
 * editable or interactive control (where the key already has a job). */
function useKeyboardScroll() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable], button, a, [role='button'], [role='tab']")) return;
      const el = scrollContainer();
      if (!el) return;
      const page = el.clientHeight * 0.9;
      let top: number | null = null;
      if (e.key === "PageDown" || (e.key === " " && !e.shiftKey)) top = el.scrollTop + page;
      else if (e.key === "PageUp" || (e.key === " " && e.shiftKey)) top = el.scrollTop - page;
      else if (e.key === "End") top = el.scrollHeight;
      else if (e.key === "Home") top = 0;
      else return;
      e.preventDefault();
      el.scrollTo({ top: Math.max(0, Math.min(maxScrollY(), top)), behavior: reducedMotion() ? "instant" : "smooth" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** Delegated tilt: one pointer handler sets --rx/--ry/--gx/--gy on .tilt cards. */
function useTiltDelegation() {
  useEffect(() => {
    if (!finePointer() || reducedMotion()) return;
    let current: HTMLElement | null = null;
    const move = (e: PointerEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.(".tilt") as HTMLElement | null;
      if (el !== current) {
        if (current) { current.style.setProperty("--rx", "0deg"); current.style.setProperty("--ry", "0deg"); }
        current = el;
      }
      if (!current) return;
      const r = current.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      current.style.setProperty("--rx", `${((0.5 - py) * 7).toFixed(2)}deg`);
      current.style.setProperty("--ry", `${((px - 0.5) * 9).toFixed(2)}deg`);
      current.style.setProperty("--gx", `${(px * 100).toFixed(1)}%`);
      current.style.setProperty("--gy", `${(py * 100).toFixed(1)}%`);
    };
    const leave = () => {
      if (current) { current.style.setProperty("--rx", "0deg"); current.style.setProperty("--ry", "0deg"); current = null; }
    };
    document.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerleave", leave);
    return () => { document.removeEventListener("pointermove", move); document.removeEventListener("pointerleave", leave); };
  }, []);
}

/** Parallax for [data-parallax-speed] elements: translateY only, rAF-throttled. */
function useParallax() {
  useEffect(() => {
    if (reducedMotion()) return;
    let raf = 0; let ticking = false;
    const apply = () => {
      ticking = false;
      const vh = window.innerHeight;
      document.querySelectorAll<HTMLElement>("[data-parallax-speed]").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.bottom < -80 || r.top > vh + 80) return;
        const progress = (r.top + r.height / 2 - vh / 2) / vh;
        const speed = Number(el.dataset.parallaxSpeed ?? 0);
        el.style.setProperty("--py", (progress * speed).toFixed(3));
        el.style.transform = `translate3d(0, ${(progress * speed * 22).toFixed(1)}px, 0)`;
      });
    };
    const onScroll = () => { if (!ticking) { ticking = true; raf = requestAnimationFrame(apply); } };
    apply();
    const offScroll = addScrollListener(onScroll);
    window.addEventListener("resize", onScroll, { passive: true });
    return () => { cancelAnimationFrame(raf); offScroll(); window.removeEventListener("resize", onScroll); };
  }, []);
}

// Dates are organizer-set calendar dates in India: they are read as
// midnight IST (Asia/Kolkata) and always rendered in Indian format
// (e.g. "Wed, 4 Nov, 2026"). Instants are rendered in IST and labelled.
function fmtDate(iso: string) {
  const d = new Date(`${iso}T00:00:00+05:30`);
  return d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", year: "numeric" });
}
function fmtDateTime(iso: string) {
  return `${new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })} IST`;
}
// Today's date in India (YYYY-MM-DD), for deadline comparisons.
function istTodayStr(): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
// Indian Rupees with Indian digit grouping (₹1,00,000 style), currency INR.
const fmtINR = (n: number) => `₹${n.toLocaleString("en-IN")}`;
// Razorpay integration lives in server/src/razorpay.ts — this list is display copy only, no checkout code belongs here.
// Indian payment methods, in presentation order: UPI first (naming the
// Indian UPI apps), then Indian cards, netbanking, and Indian wallets.
const PAYMENT_METHODS: { name: string; detail: string }[] = [
  { name: "UPI", detail: "PhonePe, Paytm, Google Pay, or BHIM UPI" },
  { name: "Cards", detail: "Indian debit and credit cards" },
  { name: "Netbanking", detail: "All major Indian banks" },
  { name: "Wallets", detail: "Paytm Wallet, PhonePe Wallet, Amazon Pay, Mobikwik" },
];
function PaymentMethods() {
  return (
    <ol className="mt-3 space-y-1.5 text-sm">
      {PAYMENT_METHODS.map((m, i) => (
        <li key={m.name} className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-letter text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--accent2)]">{i + 1}. {m.name}</span>
          <span className="text-[var(--dim)]">{m.detail}</span>
        </li>
      ))}
    </ol>
  );
}
// Shown only when the organizer has set a WhatsApp support number in
// Settings; renders nothing at all when no number is configured.
function WhatsAppLink({ number, className }: { number: string | null | undefined; className?: string }) {
  if (!number) return null;
  const digits = number.replace(/\D/g, "");
  if (!digits) return null;
  return (
    <a href={`https://wa.me/${digits}`} target="_blank" rel="noreferrer" className={className ?? "font-semibold text-[var(--accent2)] underline decoration-[rgba(255,215,0,0.4)] underline-offset-4 transition-colors hover:text-[#FFD700]"}>
      Chat on WhatsApp
    </a>
  );
}
function loadSession(): Session | null {
  try { const raw = localStorage.getItem("orbitx_session"); return raw ? (JSON.parse(raw) as Session) : null; } catch { return null; }
}
function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      <span className="mt-1.5 block">{children}</span>
      {hint ? <span className="mt-1 block text-xs text-[var(--muted)]">{hint}</span> : null}
    </label>
  );
}
function Notice({ kind, children }: { kind: "info" | "warn" | "good" | "bad"; children: ReactNode }) {
  const cls = kind === "warn" ? "border-[#AA771C]/60 bg-[#1A1408]" : kind === "good" ? "border-[#FFD700]/40 bg-[#0E0E10]" : kind === "bad" ? "border-[#FF8F7D]/40 bg-[#1F0E0E]" : "border-[#FCF6BA]/40 bg-[#0A0A0B]";
  return <div role={kind === "bad" ? "alert" : "status"} className={`notice-in rounded-xl border px-4 py-3 text-sm leading-relaxed text-[var(--dim)] ${cls}`}>{children}</div>;
}
function Pill({ text, tone }: { text: string; tone: "good" | "warn" | "bad" | "neutral" }) {
  const cls = tone === "good" ? "bg-[#0E0E10] text-[#F5C542] border-[#FFD700]/40" : tone === "warn" ? "bg-[#1A1408] text-[#E3D9BE] border-[#AA771C]/50" : tone === "bad" ? "bg-[#1F0E0E] text-[#FF8F7D] border-[#3A2F16]/60" : "bg-[#121212] text-[var(--dim)] border-[var(--border)]";
  return <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{text}</span>;
}
function paymentPill(status: string) {
  if (status === "verified") return <Pill text="Payment Verified" tone="good" />;
  if (status === "rejected") return <Pill text="Payment Rejected" tone="bad" />;
  return <Pill text="Payment Pending Review" tone="warn" />;
}
function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
function csvCell(v: string | number | null | undefined) {
  const s = String(v ?? "");
  return `"${s.replaceAll('"', '""')}"`;
}

function useCountdown(targetLabel: string, targetIso: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const target = new Date(`${targetIso}T00:00:00+05:30`).getTime();
  const diff = Math.max(0, target - now);
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  return { label: targetLabel, days, hours, mins, secs, passed: diff <= 0 };
}

function OrbitVisual() {
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (reducedMotion()) return;
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--px", (((e.clientX - r.left) / r.width - 0.5) * 2).toFixed(3));
    e.currentTarget.style.setProperty("--py", (((e.clientY - r.top) / r.height - 0.5) * 2).toFixed(3));
  };
  // Placement (2026-11-09 fix): below md the visual stacks in flow under the
  // hero text, as before. At md+ it is positioned absolutely against the
  // hero container instead of living in the hero grid's second track: with
  // the real Syne font loaded, the headline word's min-content (~1046px at
  // desktop sizes) grows the first grid track past its 1.15fr share and
  // squeezes the second track to a sliver, pushing the solar system off the
  // right edge (font-blocked previews masked this — the fallback font's
  // headline is ~half the width). Absolute placement anchors the system to
  // the container's right content edge, below the headline block, so the
  // whole planet, all three rings and both pills stay in frame at every
  // width regardless of grid track sizing. The grid and headline are
  // untouched; the empty second track simply stays empty.
  return (
    <div aria-hidden="true" data-cursor="Explore" onPointerMove={onMove} className="hero-tilt relative mx-auto aspect-square w-full max-w-[340px] md:absolute md:right-6 md:top-[28rem] md:mx-0 md:max-w-[280px] lg:top-[24rem] lg:max-w-[340px]">
      <div className="orbit-tilt-3d">
        {ORBITS.map((o) => (
          <div key={o.size} className={`orbit-ring ${o.ring} absolute ${o.size}`} />
        ))}
        <div className="orbit-spin absolute inset-0">
          <span className="absolute left-1/2 top-0 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#E8A87C] shadow-[0_0_18px_rgba(245,197,66,0.85)]" />
        </div>
        <div className="orbit-spin-slow absolute inset-[14%]">
          <span className="absolute bottom-[6%] right-[10%] h-3 w-3 rounded-full bg-[#FFD700] shadow-[0_0_14px_rgba(255,215,0,0.85)]" />
        </div>
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="planet-gold h-28 w-28 rounded-full bg-[radial-gradient(circle_at_32%_28%,#FCF6BA,#E8A87C_30%,#F5C542_46%,#FFD700_68%,#AA771C)] shadow-[0_0_50px_rgba(245,197,66,0.28),0_0_32px_rgba(252,246,186,0.22)] ring-1 ring-[#FCF6BA]/70" />
      </div>
      <div className="absolute bottom-2 left-2 h-10 w-10 rounded-full bg-[radial-gradient(circle_at_35%_30%,#F5E6A8,#F5C542_55%,#AA771C)] shadow-[0_0_22px_rgba(245,197,66,0.60)]" />
      <span className="glass-chip -top-1 right-0 sm:right-2">Top <b>30</b>&nbsp;→ Round 2</span>
      <span className="glass-chip glass-chip--2 glass-chip--rose bottom-8 -left-1 sm:left-0">Prize · <b>iPad · A16</b></span>
    </div>
  );
}

function Kicker({ children }: { children: ReactNode }) {
  return <p className="kicker">{children}</p>;
}

/** Light-sweep divider between sections: ignites (gold line scales in)
    when it scrolls into view, via the existing .reveal observer. */
function LightDivider() {
  return <div aria-hidden="true" className="reveal light-divider mx-auto w-full max-w-6xl px-4 sm:px-6" />;
}

/** Gold dust motes rising through the hero (CSS-only, deterministic
    positions; hidden on touch/small screens and reduced-motion). */
const GOLD_DUST = [
  { left: "6%", delay: "0s", dur: "9s", size: 5 },
  { left: "14%", delay: "2.2s", dur: "11s", size: 3 },
  { left: "22%", delay: "4.1s", dur: "10s", size: 6 },
  { left: "31%", delay: "1.1s", dur: "12s", size: 4 },
  { left: "38%", delay: "5.4s", dur: "9s", size: 3 },
  { left: "47%", delay: "0.6s", dur: "10.5s", size: 5 },
  { left: "55%", delay: "3.3s", dur: "11.5s", size: 4 },
  { left: "63%", delay: "6.2s", dur: "9.5s", size: 6 },
  { left: "71%", delay: "1.8s", dur: "10s", size: 3 },
  { left: "79%", delay: "4.7s", dur: "12s", size: 5 },
  { left: "86%", delay: "0.3s", dur: "9s", size: 4 },
  { left: "93%", delay: "2.9s", dur: "11s", size: 3 },
  { left: "18%", delay: "7.1s", dur: "10s", size: 4 },
  { left: "68%", delay: "8.0s", dur: "11s", size: 5 },
] as const;
function GoldDust() {
  return (
    <div aria-hidden="true" className="gold-dust">
      {GOLD_DUST.map((d, i) => (
        <span key={i} style={{ left: d.left, width: d.size, height: d.size, animationDelay: d.delay, animationDuration: d.dur } as React.CSSProperties} />
      ))}
    </div>
  );
}

function Preloader({ onBooted }: { onBooted: () => void }) {
  const [pct, setPct] = useState(0);
  const [phase, setPhase] = useState<"counting" | "exiting" | "gone">("counting");
  const doneRef = useRef(false);
  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onBooted();
    setPhase("exiting");
    setTimeout(() => setPhase("gone"), 720);
  };
  useEffect(() => {
    if (reducedMotion()) { setPct(100); const t = setTimeout(finish, 120); return () => clearTimeout(t); }
    // Eased counter: fast start, slow settle — the Lusion percentage preloader.
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      // Clamp both ways: a skewed animation-frame timestamp (seen after a
      // reload in the hosting frame) must never show a negative percentage.
      const p = Math.max(0, Math.min(1, (t - t0) / 1500));
      const eased = 1 - Math.pow(1 - p, 3);
      setPct(Math.round(eased * 100));
      if (p < 1) raf = requestAnimationFrame(tick);
      else setTimeout(finish, 160);
    };
    raf = requestAnimationFrame(tick);
    const hard = setTimeout(finish, 2400);
    return () => { cancelAnimationFrame(raf); clearTimeout(hard); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (phase === "gone") return null;
  const statuses = ["Calibrating orbit", "Loading tracks", "Charging the iPad glow", "Ready to launch"];
  const status = statuses[Math.min(statuses.length - 1, Math.floor(pct / 26))];
  return (
    <div aria-hidden="true" className={`preloader fixed inset-0 z-[200] ${phase === "exiting" ? "is-exiting" : ""}`}>
      <div className="preloader-curtain preloader-curtain-top absolute inset-0 bg-[#030304]" />
      <div className="preloader-curtain preloader-curtain-bottom absolute inset-0 bg-[#070708]" />
      <div className="preloader-content relative flex h-full flex-col justify-between p-6 sm:p-10">
        <div className="flex items-baseline justify-between">
          <p className="font-display text-lg font-semibold tracking-[-0.02em]"><span className="headline-gradient">SPACExPRO</span><span className="text-[var(--rosegold)]">.</span></p>
          <p className="font-letter text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Hackathon — Loading</p>
        </div>
        <div>
          <p className="font-letter text-[11px] uppercase tracking-[0.22em] text-[var(--accent2)]">{status}…</p>
          <p className="font-display headline-gradient mt-2 text-[clamp(4rem,18vw,9rem)] font-extrabold leading-none tracking-[-0.05em] tabular-nums">{pct}<span>%</span></p>
          <div className="mt-5 h-px w-full bg-[rgba(255,215,0,0.28)]"><div className="preloader-bar h-px bg-[linear-gradient(90deg,#AA771C,#FFD700,#F5C542,#FCF6BA,#E8A87C,#FFD700,#AA771C)]" style={{ width: `${pct}%` }} /></div>
        </div>
      </div>
    </div>
  );
}

function CustomCursor() {
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const echoRefs = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const labelRef = useRef<HTMLSpanElement>(null);
  const [label, setLabel] = useState("");
  const [hovering, setHovering] = useState(false);
  useEffect(() => {
    if (!finePointer() || reducedMotion()) return;
    let x = -100; let y = -100; let rx = -100; let ry = -100; let raf = 0;
    // Cursor echo: three ghost rings trail the cursor at increasing
    // lag (fine pointers only; never rendered on touch).
    const echoes = [
      { x: -100, y: -100, k: 0.1, el: echoRefs[0]?.current },
      { x: -100, y: -100, k: 0.06, el: echoRefs[1]?.current },
      { x: -100, y: -100, k: 0.035, el: echoRefs[2]?.current },
    ];
    const move = (e: MouseEvent) => {
      x = e.clientX; y = e.clientY;
      const t = e.target as HTMLElement | null;
      const labelled = t?.closest?.("[data-cursor]") as HTMLElement | null;
      const field = t?.closest?.("input, textarea, select");
      const interactive = t?.closest?.("button, a, [role='tab'], [role='button']");
      setLabel(labelled && !field ? (labelled.dataset.cursor ?? "") : "");
      setHovering(Boolean(interactive && !field));
      const hidden = Boolean(field);
      dotRef.current?.classList.toggle("is-hidden", hidden);
      ringRef.current?.classList.toggle("is-hidden", hidden);
      for (const e of echoes) e.el?.classList.toggle("is-hidden", hidden);
    };
    const loop = () => {
      rx += (x - rx) * 0.16; ry += (y - ry) * 0.16;
      if (dotRef.current) dotRef.current.style.transform = `translate(${x}px, ${y}px)`;
      if (ringRef.current) ringRef.current.style.transform = `translate(${rx}px, ${ry}px)`;
      for (const e of echoes) {
        e.x += (x - e.x) * e.k; e.y += (y - e.y) * e.k;
        if (e.el) e.el.style.transform = `translate(${e.x}px, ${e.y}px)`;
      }
      raf = requestAnimationFrame(loop);
    };
    window.addEventListener("mousemove", move, { passive: true });
    raf = requestAnimationFrame(loop);
    return () => { window.removeEventListener("mousemove", move); cancelAnimationFrame(raf); };
  }, []);
  useEffect(() => {
    ringRef.current?.classList.toggle("is-label", label.length > 0);
    ringRef.current?.classList.toggle("is-hover", hovering && !label);
    if (labelRef.current) labelRef.current.textContent = label;
  }, [label, hovering]);
  if (!finePointer()) return null;
  const echoSizes = [
    { size: 28, opacity: 0.55 },
    { size: 20, opacity: 0.4 },
    { size: 13, opacity: 0.3 },
  ];
  return (<>
    {echoSizes.map((e, i) => (
      <div key={i} ref={echoRefs[i]} aria-hidden="true" className="cursor-echo" style={{ width: e.size, height: e.size, margin: `-${e.size / 2}px 0 0 -${e.size / 2}px`, opacity: e.opacity }} />
    ))}
    <div ref={dotRef} aria-hidden="true" className="cursor-dot" /><div ref={ringRef} aria-hidden="true" className="cursor-ring"><span ref={labelRef} aria-hidden="true" className="cursor-label">{label}</span></div></>);
}

function HeroCanvas({ heroRef }: { heroRef: React.RefObject<HTMLElement | null> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let ctx: CanvasRenderingContext2D | null = null;
    try { ctx = canvas.getContext("2d"); } catch { return; }
    if (!ctx) return;
    const reduced = reducedMotion();
    const small = window.innerWidth < 640;
    const dpr = Math.min(window.devicePixelRatio || 1, small ? 1.25 : 1.6);
    // Scene objects are created exactly once per mount. The resize handler
    // only re-sizes the backing store; it must never re-create stars or
    // orbit/planet objects (a previous shape of this code re-derived
    // geometry on resize, which compounded with a second draw loop).
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(r.width * dpr));
      canvas.height = Math.max(1, Math.floor(r.height * dpr));
    };
    resize();
    type Star = { x: number; y: number; z: number; r: number; tw: number; warm: number };
    const stars: Star[] = Array.from({ length: small ? 70 : 130 }, () => ({
      x: Math.random(), y: Math.random(), z: 0.25 + Math.random() * 0.75,
      r: 0.5 + Math.random() * 1.5, tw: Math.random() * Math.PI * 2,
      warm: Math.random() < 0.22 ? 1 : 0,
    }));
    let mx = 0.5; let my = 0.45; let tx = 0.5; let ty = 0.45;
    let visible = true; let cancelled = false;
    let raf = 0; let running = false; let last = performance.now();
    let shoot: { x: number; y: number; vx: number; vy: number; life: number } | null = null;
    let nextShoot = performance.now() + 2600;
    const onPointer = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      tx = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      ty = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    };
    const section = heroRef.current;
    section?.addEventListener("pointermove", onPointer, { passive: true });
    const draw = (t: number) => {
      const c = ctx; if (!c) return;
      if (cancelled) { running = false; raf = 0; return; }
      if (!visible || document.hidden) { running = false; raf = 0; return; }
      const dt = Math.min(50, t - last); last = t;
      mx += (tx - mx) * 0.045; my += (ty - my) * 0.045;
      const w = canvas.width; const h = canvas.height;
      c.clearRect(0, 0, w, h);
      // Pointer gold glow: champagne core, bright-gold + bronze halo. No orbit
      // paths and no planets are drawn here — the solar system lives
      // solely in OrbitVisual (ORBITS, exactly three rings). Drawing a
      // second system on this canvas at a different centre is what
      // produced the phantom extra orbits.
      const glowX = mx * w; const glowY = my * h;
      const neb = c.createRadialGradient(glowX, glowY, 0, glowX, glowY, Math.max(w, h) * (small ? 0.18 : 0.38));
      // On phones the hero is several times taller than wide, so even a
      // 0.26-radius glow centred at 45% height blankets the chips/CTA/
      // countdown zone and reads as an olive wash over the near-black
      // base; small screens get a tighter radius and halved alphas.
      neb.addColorStop(0, small ? "rgba(252,246,186,0.025)" : "rgba(252,246,186,0.05)");
      neb.addColorStop(0.45, small ? "rgba(245,197,66,0.01)" : "rgba(245,197,66,0.02)");
      neb.addColorStop(0.7, small ? "rgba(252,246,186,0.005)" : "rgba(252,246,186,0.01)");
      neb.addColorStop(1, "rgba(255,215,0,0)");
      c.fillStyle = neb; c.fillRect(0, 0, w, h);
      // Constellation links + stars, parallaxed by pointer depth.
      // Tunnel depth: each star's distance from the centre grows slowly
      // with time (frac loops 0->1) and its brightness fades in/out at
      // the loop edges, so the field reads as flying forward forever.
      for (let i = 0; i < stars.length; i++) {
        const st = stars[i];
        if (!st) continue;
        const frac = reduced ? 0.5 : ((st.tw / (Math.PI * 2) + t * 0.000035 * st.z) % 1);
        const tunnel = 0.55 + frac * 0.95;
        const px = (0.5 + (st.x - 0.5) * tunnel + (mx - 0.5) * 0.06 * st.z) * w;
        const py = (0.5 + (st.y - 0.5) * tunnel + (my - 0.5) * 0.06 * st.z) * h;
        const a = (0.22 + 0.5 * (0.5 + 0.5 * Math.sin(st.tw + t * 0.0012))) * (reduced ? 1 : 0.3 + 0.7 * Math.sin(Math.PI * frac));
        c.beginPath();
        c.arc(px, py, st.r * dpr * st.z + 0.4, 0, Math.PI * 2);
        c.fillStyle = st.warm ? `rgba(245,197,66,${a.toFixed(3)})` : `rgba(207,196,165,${(a * 0.75).toFixed(3)})`;
        c.fill();
        if (i < stars.length - 1 && st.z > 0.6) {
          const n = stars[i + 1];
          if (n) {
            const nfrac = reduced ? 0.5 : ((n.tw / (Math.PI * 2) + t * 0.000035 * n.z) % 1);
            const ntunnel = 0.55 + nfrac * 0.95;
            const nx = (0.5 + (n.x - 0.5) * ntunnel + (mx - 0.5) * 0.06 * n.z) * w;
            const ny = (0.5 + (n.y - 0.5) * ntunnel + (my - 0.5) * 0.06 * n.z) * h;
            const dist = Math.hypot(nx - px, ny - py);
            if (dist < 90 * dpr) {
              c.beginPath(); c.moveTo(px, py); c.lineTo(nx, ny);
              c.strokeStyle = `rgba(255,215,0,${(0.08 * (1 - dist / (90 * dpr))).toFixed(3)})`;
              c.lineWidth = dpr * 0.6; c.stroke();
            }
          }
        }
      }
      // Shooting star
      if (!shoot && t > nextShoot && !reduced) {
        shoot = { x: Math.random() * w * 0.7 + w * 0.2, y: Math.random() * h * 0.3, vx: -0.55 * dpr, vy: 0.28 * dpr, life: 1 };
        nextShoot = t + 3800 + Math.random() * 3200;
      }
      if (shoot) {
        shoot.x += shoot.vx * dt * 0.9; shoot.y += shoot.vy * dt * 0.9; shoot.life -= dt / 750;
        const tail = c.createLinearGradient(shoot.x, shoot.y, shoot.x - shoot.vx * 90, shoot.y - shoot.vy * 90);
        tail.addColorStop(0, `rgba(255,215,0,${Math.max(0, shoot.life).toFixed(3)})`);
        tail.addColorStop(1, "rgba(252,246,186,0)");
        c.strokeStyle = tail; c.lineWidth = 1.6 * dpr;
        c.beginPath(); c.moveTo(shoot.x, shoot.y); c.lineTo(shoot.x - shoot.vx * 90, shoot.y - shoot.vy * 90); c.stroke();
        if (shoot.life <= 0) shoot = null;
      }
      if (reduced) { running = false; raf = 0; return; }
      raf = requestAnimationFrame(draw);
    };
    // Single-loop guard: visibility/IntersectionObserver restarts must
    // never start a second rAF chain while one is already running (two
    // chains drawing the same canvas produced offset duplicate imagery).
    const start = () => {
      if (cancelled || running || !visible || document.hidden) return;
      running = true; last = performance.now();
      raf = requestAnimationFrame(draw);
    };
    const io = new IntersectionObserver((en) => {
      visible = en[0]?.isIntersecting ?? true;
      if (visible) start();
    }, { threshold: 0 });
    io.observe(canvas);
    const onVis = () => { if (!document.hidden) start(); };
    document.addEventListener("visibilitychange", onVis);
    if (reduced) draw(performance.now());
    else start();
    window.addEventListener("resize", resize);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf); running = false; io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("resize", resize);
      section?.removeEventListener("pointermove", onPointer);
    };
  }, [heroRef]);
  return <canvas ref={ref} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />;
}

function Marquee() {
  const items = ["Build beyond limits", "Ship the future", "SPACExPRO Hackathon", "11-inch iPad · A16", "AI / ML", "Cyber Security", "Web Development", "Student Innovation"];
  const trackRef = useRef<HTMLDivElement>(null);
  const trackRef2 = useRef<HTMLDivElement>(null);
  const row = (key: string) => (
    <span key={key} className="flex items-center">
      {items.map((t) => (
        <span key={t} className="flex items-center gap-6 pr-6 font-display text-sm font-bold uppercase tracking-[0.18em] sm:text-base">
          {t}<span aria-hidden="true" className="text-[#FCF6BA]">✦</span>
        </span>
      ))}
    </span>
  );
  const rowRev = (key: string) => (
    <span key={key} className="flex items-center">
      {[...items].reverse().map((t) => (
        <span key={t} className="flex items-center gap-6 pr-6 font-display text-sm font-bold uppercase tracking-[0.18em] sm:text-base">
          {t}<span aria-hidden="true" className="text-[#FCF6BA]">✦</span>
        </span>
      ))}
    </span>
  );
  // Second marquee row: same stream, opposite direction, slower — the
  // counter-running rows read as two depths of one stream.
  useEffect(() => {
    if (reducedMotion()) return;
    const track = trackRef2.current;
    if (!track) return;
    let raf = 0; let x = 0; let visible = true; let half = 1;
    const measure = () => { half = Math.max(1, track.scrollWidth / 2); };
    measure();
    const io = new IntersectionObserver((en) => { visible = en[0]?.isIntersecting ?? true; }, { threshold: 0 });
    io.observe(track);
    let lastT = performance.now();
    const loop = (t: number) => {
      if (!visible || document.hidden) { raf = requestAnimationFrame(loop); return; }
      const dt = Math.min(50, t - lastT); lastT = t;
      x += 42 * (dt / 1000);
      if (x >= 0) x -= half;
      track.style.transform = `translate3d(${x.toFixed(1)}px, 0, 0)`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    window.addEventListener("resize", measure, { passive: true });
    return () => { cancelAnimationFrame(raf); io.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  useEffect(() => {
    if (reducedMotion()) return;
    const track = trackRef.current;
    if (!track) return;
    let raf = 0; let x = 0; let lastY = currentScrollY(); let lastT = performance.now(); let vel = 0;
    let visible = true; let half = 1;
    const measure = () => { half = Math.max(1, track.scrollWidth / 2); };
    measure();
    const io = new IntersectionObserver((en) => { visible = en[0]?.isIntersecting ?? true; }, { threshold: 0 });
    io.observe(track);
    const loop = (t: number) => {
      if (!visible || document.hidden) { raf = requestAnimationFrame(loop); return; }
      const dt = Math.min(50, t - lastT); lastT = t;
      const inst = (currentScrollY() - lastY) / Math.max(1, dt); lastY = currentScrollY();
      vel += (inst - vel) * 0.08;
      // Base drift + scroll velocity: fast scroll speeds it up, scrolling up reverses it.
      const speed = 55 + Math.min(320, Math.abs(vel) * 620);
      const dir = vel < -0.25 ? 1 : -1;
      x += dir * speed * (dt / 1000);
      if (x <= -half) x += half;
      if (x >= 0) x -= half;
      track.style.transform = `translate3d(${x.toFixed(1)}px, 0, 0)`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    window.addEventListener("resize", measure, { passive: true });
    return () => { cancelAnimationFrame(raf); io.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  if (reducedMotion()) {
    return (
      <div aria-hidden="true" className="marquee border-y border-[rgba(245,197,66,0.35)] bg-[linear-gradient(90deg,#050505,#0A0A0A_46%,#050505_78%,#050505)] py-3.5 text-[#FFFDF5] shadow-[0_10px_30px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(252,246,186,0.20)]">
        <div className="marquee-static">{items.map((t) => <span key={t} className="font-display text-sm font-bold uppercase tracking-[0.18em]">{t}</span>)}</div>
        <div className="marquee-static marquee-row-2 mt-2 border-t border-[rgba(245,197,66,0.18)] pt-2">{[...items].reverse().map((t) => <span key={t} className="font-display text-sm font-bold uppercase tracking-[0.18em]">{t}</span>)}</div>
      </div>
    );
  }
  return (
    <div aria-hidden="true" className="marquee border-y border-[rgba(245,197,66,0.35)] bg-[linear-gradient(90deg,#050505,#0A0A0A_46%,#050505_78%,#050505)] py-3.5 text-[#FFFDF5] shadow-[0_10px_30px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(252,246,186,0.20)]">
      <div className="marquee-skew">
        <div ref={trackRef} className="marquee-track">{row("a")}{row("b")}</div>
      </div>
      <div className="marquee-row-2 border-t border-[rgba(245,197,66,0.18)] pt-3.5">
        <div ref={trackRef2} className="marquee-track">{rowRev("c")}{rowRev("d")}</div>
      </div>
    </div>
  );
}

function useRevealArmed() {
  useEffect(() => {
    document.documentElement.classList.add("reveal-armed");
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add("is-visible"); io.unobserve(e.target); }
    }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    const observeAll = () => document.querySelectorAll(".reveal:not(.is-visible)").forEach((el) => io.observe(el));
    observeAll();
    const mo = new MutationObserver(observeAll);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => { io.disconnect(); mo.disconnect(); };
  }, []);
}

function Ambience() {
  const glowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!finePointer() || reducedMotion()) return;
    let x = -600; let y = -600; let gx = -600; let gy = -600; let raf = 0; let on = false;
    const move = (e: PointerEvent) => {
      x = e.clientX; y = e.clientY;
      if (!on) { on = true; glowRef.current?.classList.add("is-on"); }
    };
    const loop = () => {
      gx += (x - gx) * 0.06; gy += (y - gy) * 0.06;
      if (glowRef.current) glowRef.current.style.transform = `translate3d(${gx}px, ${gy}px, 0)`;
      raf = requestAnimationFrame(loop);
    };
    window.addEventListener("pointermove", move, { passive: true });
    raf = requestAnimationFrame(loop);
    return () => { window.removeEventListener("pointermove", move); cancelAnimationFrame(raf); };
  }, []);
  return (
    <>
      <div aria-hidden="true" className="nebula" />
      <div aria-hidden="true" className="depth-veil" />
      <div ref={glowRef} aria-hidden="true" className="pointer-glow" />
      <div aria-hidden="true" className="grain" />
    </>
  );
}

function ScrollProgress() {
  return (
    <div aria-hidden="true" className="scroll-progress"><div className="scroll-progress-bar" /></div>
  );
}

/**
 * Shared view-transition overlay for every navigation (Home, Register,
 * Team Portal, Organizer, Preview) — one diagonal pass, bottom-right →
 * top-left. Cover: the clip-path polygon grows from a point at the
 * bottom-right corner until the screen is fully covered, its leading
 * edge travelling diagonally to the top-left (the view swaps underneath
 * at full cover, unchanged at 520ms). Reveal: the same polygon collapses
 * to a point at the top-left, so the panel exits toward the top-left
 * and the uncovered area appears from the bottom-right first. The label
 * sits inside its own identically clipped layer, so it only appears
 * where the panel has already covered. The overlay mounts in the
 * collapsed bottom-right state and flips to full on the next frames, so
 * the cover sweep actually animates instead of appearing instantly.
 */
function TransitionOverlay({ phase, label }: { phase: "idle" | "cover" | "reveal"; label: string }) {
  const [diagonal, setDiagonal] = useState<"start" | "full" | "exit">("start");
  // Layout effect (before paint): the first painted frame of a cover must
  // already be the collapsed bottom-right point, never the previous
  // top-left exit point, so the sweep always originates at bottom-right.
  useLayoutEffect(() => {
    if (phase === "idle") return;
    if (phase === "cover") {
      setDiagonal("start");
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(() => setDiagonal("full")); });
      return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
    }
    setDiagonal("exit");
  }, [phase]);
  if (phase === "idle") return null;
  const covering = phase === "cover";
  const panelCls = diagonal === "full" ? "is-full" : diagonal === "exit" ? "is-exit" : "";
  return (
    <div aria-hidden="true" className="transition-overlay fixed inset-0 z-[150]">
      <div className={`transition-panel absolute inset-0 bg-[#030304] ${panelCls}`} />
      <div className={`transition-panel absolute inset-0 bg-[linear-gradient(120deg,#050505_0%,#121212_42%,#AA771C_50%,#F5C542_56%,#FCF6BA_60%,#FFD700_66%,#0A0A0A_100%)] ${panelCls}`} style={{ transitionDelay: covering ? "60ms" : "0ms" }}>
        {Array.from({ length: 12 }, (_, i) => (
          <span key={i} aria-hidden="true" className="transition-streak" style={{ left: `${(i * 8 + 4) % 88}%`, top: `${(i * 13 + 6) % 80}%`, "--d": `${(i % 6) * 0.05}s` } as React.CSSProperties} />
        ))}
      </div>
      <div className={`transition-panel relative flex h-full flex-col items-center justify-center gap-3 ${panelCls}`} style={{ transitionDelay: covering ? "90ms" : "0ms" }}>
        <p className="transition-label font-display text-[clamp(2rem,7vw,4rem)] font-semibold tracking-[-0.02em] text-[#FFFDF5] [text-shadow:0_2px_20px_rgba(0,0,0,0.85)]" style={{ opacity: covering ? 1 : 0, letterSpacing: covering ? "-0.04em" : "0.08em" }}>{label}</p>
        <p className="transition-label font-letter text-[11px] uppercase tracking-[0.28em] text-[#F5E6A8]" style={{ opacity: covering ? 1 : 0 }}>SPACExPRO Hackathon</p>
      </div>
    </div>
  );
}

function FooterWordmark() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((en) => {
      if (en[0]?.isIntersecting) { el.classList.add("is-visible"); io.disconnect(); }
    }, { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} aria-hidden="true" data-cursor="SPACExPRO" className="wordmark mt-4 text-center font-display text-[12.5vw] font-semibold leading-none sm:text-[10.5vw] lg:text-[7.5rem]">
      <span className="outline-word block">SPACExPRO</span>
      <span className="wordmark-fill" aria-hidden="true">SPACExPRO</span>
    </div>
  );
}

function HomeView({ data, go, booted }: { data: PublicData; go: (v: View) => void; booted: boolean }) {
  const s = data.settings;
  const today = istTodayStr();
  const target = today < s.eventStart ? { label: "Hackathon begins in", iso: s.eventStart }
    : today <= s.registrationDeadline ? { label: "Registration closes in", iso: s.registrationDeadline }
    : today <= s.finalistDate ? { label: "Finalist showcase in", iso: s.finalistDate }
    : { label: "Hackathon", iso: s.finalistDate };
  const cd = useCountdown(target.label, target.iso);
  const closed = today > s.registrationDeadline;
  const heroRef = useRef<HTMLElement | null>(null);
  const showcaseRef = useRef<HTMLElement | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [showcaseIndex, setShowcaseIndex] = useState(0);
  // Pinned horizontal showcase: translate the track with scroll progress on
  // desktop; on mobile the CSS stacks the cards and this transform is cleared.
  // Progress is read from the section's viewport-relative rect, which is
  // correct no matter which element actually scrolls (the host's fixed root
  // container, the document, or an outer shell). Scroll is therefore heard
  // on BOTH the container and the window in the capture phase — capture
  // receives scroll events from every scrolling descendant — and a rAF poll,
  // gated by an IntersectionObserver so it only runs while the section is
  // near the viewport, covers hosts whose scrolling fires no event this page
  // can hear. The previous version listened only to the one container
  // element, so in any embedding where that element was not the scroller the
  // transform stayed frozen at 0 and the tracks never travelled sideways.
  useEffect(() => {
    if (reducedMotion()) return;
    const section = showcaseRef.current; const track = trackRef.current;
    if (!section || !track) return;
    let raf = 0; let ticking = false; let lastX = Number.NaN; let lastIdx = -1; let polling = false; let pollRaf = 0;
    const apply = () => {
      ticking = false;
      if (window.innerWidth < 900) { if (track.style.transform) track.style.transform = ""; return; }
      const vh = window.innerHeight;
      const rect = section.getBoundingClientRect();
      if (rect.bottom < -vh || rect.top > vh) return;
      const total = Math.max(1, rect.height - vh);
      const progress = Math.max(0, Math.min(1, -rect.top / total));
      const maxX = Math.max(0, track.scrollWidth - window.innerWidth + 48);
      const x = -progress * maxX;
      if (Number.isNaN(lastX) || Math.abs(x - lastX) >= 0.5) { lastX = x; track.style.transform = `translate3d(${x.toFixed(1)}px, 0, 0)`; }
      const idx = Math.min(TRACKS.length - 1, Math.floor(progress * TRACKS.length));
      if (idx !== lastIdx) { lastIdx = idx; setShowcaseIndex(idx); }
    };
    const onScroll = () => { if (!ticking) { ticking = true; raf = requestAnimationFrame(apply); } };
    const offScroll = addScrollListener(onScroll);
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    window.addEventListener("resize", onScroll, { passive: true });
    const poll = () => { apply(); if (polling) pollRaf = requestAnimationFrame(poll); };
    const io = new IntersectionObserver((en) => {
      const near = en[0]?.isIntersecting ?? false;
      if (near && !polling) { polling = true; pollRaf = requestAnimationFrame(poll); }
      else if (!near && polling) { polling = false; cancelAnimationFrame(pollRaf); apply(); }
    }, { rootMargin: "60% 0px 60% 0px" });
    io.observe(section);
    apply();
    return () => { cancelAnimationFrame(raf); cancelAnimationFrame(pollRaf); polling = false; io.disconnect(); offScroll(); window.removeEventListener("scroll", onScroll, { capture: true }); window.removeEventListener("resize", onScroll); };
  }, []);
  // Hero scroll-away: a subtle zoom + rise driven by the real scroll
  // container (--hz 0→1), transform-only, paused under reduced motion.
  // It observes scroll; it never drives or blocks it.
  useEffect(() => {
    if (reducedMotion()) return;
    let raf = 0; let ticking = false;
    const apply = () => {
      ticking = false;
      const el = heroRef.current;
      if (!el) return;
      const vh = window.innerHeight;
      const r = el.getBoundingClientRect();
      const p = Math.max(0, Math.min(1, -r.top / Math.max(1, vh * 0.9)));
      el.style.setProperty("--hz", p.toFixed(3));
    };
    const onScroll = () => { if (!ticking) { ticking = true; raf = requestAnimationFrame(apply); } };
    apply();
    const offScroll = addScrollListener(onScroll);
    window.addEventListener("resize", onScroll, { passive: true });
    return () => { cancelAnimationFrame(raf); offScroll(); window.removeEventListener("resize", onScroll); };
  }, []);
  const schedule = [
    { label: "Hackathon begins", date: s.eventStart, note: "The opening day of the event, as configured in Event Settings." },
    { label: "Registration closes", date: s.registrationDeadline, note: "All teams must be registered by this date." },
    { label: "Round 1 submissions due", date: s.round1Deadline, note: "Idea, problem, solution, and presentation submission." },
    { label: "Round 2 submissions due", date: s.round2Deadline, note: "Prototype, code, demo, and README submission — qualified teams only." },
    { label: "Finalist showcase", date: s.finalistDate, note: "Finalists present in their scheduled slots." },
  ];
  const [faqOpen, setFaqOpen] = useState<number | null>(0);
  const faqs = [
    { q: "Who can take part?", a: `Students enrolled in B.Tech or M.Tech programmes at colleges across India are eligible to take part. Teams must have between ${s.minTeamSize} and ${s.maxTeamSize} members, and each email address may hold only one team membership.` },
    { q: "What additional information does the Student Innovation track require?", a: "In addition to your name, email address, Indian mobile number, college, and degree, the Student Innovation track requires an idea title, a description, a problem statement, and the intended users." },
    { q: "How does payment verification work?", a: `You can pay via Razorpay using UPI (PhonePe, Paytm, Google Pay, or BHIM UPI), Indian debit and credit cards, netbanking with Indian banks, or Indian wallets.${s.registrationFeeInr != null ? ` The registration fee is ${fmtINR(s.registrationFeeInr)} (INR) per team.` : ""} Please submit your payment transaction reference (for UPI payments, the UPI reference / UTR number from your UPI app) with your registration. Your payment will remain pending verification until it has been reviewed and verified by an organizer. No payment is confirmed automatically. Automatic confirmation would require a connected Razorpay gateway and a verified webhook, which are not yet connected.` },
    { q: "Will I receive a confirmation email?", a: "Your acknowledgement will appear on screen and in the Team Portal as soon as you register. A copy is queued at registration and sent automatically to the address you registered with from the SPACExPRO Gmail mailbox (space.x.pro.7@gmail.com); it is recorded as sent only after the send has been verified." },
    { q: "How are teams selected for Round 2?", a: `Judges will score Round 1 submissions on innovation (${s.weightInnovation}%), technical quality (${s.weightTechnical}%), impact (${s.weightImpact}%), and presentation (${s.weightPresentation}%). The top 30 highest-scoring teams will qualify for Round 2.` },
    { q: "How can I ask a question about the event?", a: `Please use the enquiry form below, or email us at ${s.contactEmail}.${s.whatsappNumber ? " You can also reach us through the Chat on WhatsApp link in the contact section below." : ""}` },
  ];
  return (
    <div>
      <section
        ref={heroRef}
        onPointerMove={(e) => {
          if (reducedMotion()) return;
          const r = e.currentTarget.getBoundingClientRect();
          e.currentTarget.style.setProperty("--hx", (((e.clientX - r.left) / r.width - 0.5) * 2).toFixed(3));
          e.currentTarget.style.setProperty("--hy", (((e.clientY - r.top) / r.height - 0.5) * 2).toFixed(3));
        }}
        className="starfield relative min-h-[92svh] overflow-hidden border-b border-[var(--border)] md:min-h-screen"
      >
        <div aria-hidden="true" className="aurora-mesh" />
        <div aria-hidden="true" className="aurora-ribbon" />
        <GoldDust />
        <div aria-hidden="true" className="aurora-horizon" />
        <HeroCanvas heroRef={heroRef} />
        <div className="pointer-events-none absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-[#E8A87C]/5 blur-3xl" aria-hidden="true" />
        <div className="hero-zoom relative z-[2] mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.15fr_0.85fr] md:items-center md:py-14">
          <div>
            <p className="kicker">Begins {fmtDate(s.eventStart)} · <CountUp value={data.teamCount} /> {data.teamCount === 1 ? "team" : "teams"} registered</p>
            <h1 className="headline font-display mt-5 text-[clamp(3.1rem,9.5vw,6.4rem)] [text-shadow:0_6px_44px_rgba(245,197,66,0.35)]">
              <span className="mask"><span className={`mask-line ${booted ? "is-in" : ""}`}><LetterFlip text="SPACExPRO" active={booted} /></span></span>
              <span className="mask"><span className={`mask-line mask-line-d1 ${booted ? "is-in" : ""}`}><span className="headline-gradient">Hackathon</span><span className="text-[var(--rosegold)]">.</span></span></span>
              <span className="mask mt-3"><span className={`mask-line mask-line-d2 display-italic text-[0.52em] leading-[1.08] text-[var(--dim)] ${booted ? "is-in" : ""}`}><LetterFlip text="Build beyond limits." active={booted} /><br /><LetterFlip text="Ship the future." active={booted} /></span></span>
            </h1>
            <p className={`mt-6 max-w-xl text-lg leading-relaxed text-[var(--dim)] transition-all duration-700 ${booted ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"}`} style={{ transitionDelay: "0.4s" }}>Bring your idea, build it with your team, and present it to our judges. Every member of a winning team will receive an 11-inch iPad with A16 chip.</p>
            <div className="mt-5 flex flex-wrap gap-2" aria-label="Event highlights">
              <span className="hero-chip"><i>✦</i> 4 tracks</span>
              <span className="hero-chip"><i>✦</i> Top 30 advance</span>
              <button type="button" className="hero-chip cursor-pointer transition-colors hover:border-[#FFD700]" onClick={() => scrollToId("prize")} aria-label="See the prize — the 11-inch iPad with A16 chip"><i>✦</i> iPad for every winner</button>
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <span className="cta-pulse-wrap"><Magnetic><button type="button" data-cursor="Register" className={btnPrimary} onClick={() => go("register")} disabled={closed}>{closed ? "Registration Closed" : <>Register Your Team <span className="arrow-slide" aria-hidden="true">→</span></>}</button></Magnetic></span>
              <Magnetic strength={5}><button type="button" data-cursor="Open" className={btnGhost} onClick={() => go("portal")}>Open the Team Portal</button></Magnetic>
            </div>
            <div className="mt-8" aria-label="Countdown">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-semibold text-[var(--dim)]">{cd.label} · {fmtDate(target.iso)}</p>
                <span aria-hidden="true" className="font-letter text-[10px] uppercase tracking-[0.28em] text-[var(--muted)] md:hidden">Scroll ↓</span>
              </div>
              <div className="mt-2 flex gap-2" role="timer" aria-label={`${cd.label} ${cd.days} days ${cd.hours} hours ${cd.mins} minutes ${cd.secs} seconds`}>
                {[[cd.days, "days"], [cd.hours, "hours"], [cd.mins, "minutes"], [cd.secs, "seconds"]].map(([v, l]) => (
                  <div key={l} className="countdown-tile min-w-[62px] rounded-xl px-2.5 py-2.5 text-center sm:min-w-[68px] sm:px-3">
                    <div className="font-letter text-3xl font-semibold tabular-nums text-[#FFFDF5] [text-shadow:0_0_16px_rgba(245,197,66,0.35)]"><RollingNumber value={Number(v)} /></div>
                    <div className="font-letter text-[10px] uppercase tracking-[0.16em] text-[#D8CBA6]">{l}</div>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-[var(--muted)]">All dates are set by the organizer in Event Settings and are shown here as configured, in Indian Standard Time (IST).</p>
            </div>
          </div>
          <OrbitVisual />
        </div>
        <div aria-hidden="true" className="scroll-cue absolute bottom-5 left-1/2 z-[2] hidden -translate-x-1/2 pb-0 md:flex">
          <span className="font-letter text-[10px] uppercase tracking-[0.28em]">Scroll</span>
          <span className="scroll-cue-line" />
        </div>
        <div aria-hidden="true" className="aurora-band" />
      </section>

      <Marquee />

      <section id="prize" className="tint-prize mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-24" aria-labelledby="prize-heading">
        {/* The prize panel and photo are deliberately NOT scroll-reveal gated:
            the iPad photo is the event's key visual and must render the moment
            the section is reached, even if the reveal observer never fires
            inside the host's scroll container. */}
        {/* The prize panel carries NO tilt/sweep/3D context either: the
            delegated tilt handler and preserve-3d transform on this panel
            were part of the layer stack that left the photo frame painted
            empty black in the owner's real GPU desktop browser, so the
            panel is a plain static gold frame and the photo inside it is a
            plain block img — the plainest possible paint path. */}
        <div className="on-black grid items-center gap-10 rounded-md border border-[rgba(245,197,66,0.45)] bg-[linear-gradient(135deg,#070708,#030304_48%,#030304_78%,#070708)] p-6 shadow-[inset_0_1px_0_rgba(252,246,186,0.18),0_24px_60px_rgba(0,0,0,0.30),0_0_44px_rgba(245,197,66,0.16)] md:grid-cols-2 md:p-12">
          <div>
            <Kicker>The prize — 01</Kicker>
            <h2 id="prize-heading" className="headline font-display mt-4 text-4xl text-[#FFFDF5] sm:text-5xl"><LetterFlip text="An 11-inch iPad with A16 chip — for every winning team member." /></h2>
            <p className="mt-4 text-lg leading-relaxed text-[#FFFDF5]">This is not a single prize to be shared across a team. Every member of a winning team will receive their own 11-inch iPad with A16 chip.</p>
            <p className="mt-3 text-sm text-[#D8CBA6]">Prize details are as announced for this event. No price, retailer, or availability is stated here. Photo: Apple.</p>
          </div>
          {/* The photo renders through the plainest possible paint path: no
              parallax/float/zoom layer stack on or around the img, and no
              tilt/preserve-3d context on the panel around it. That stack
              (will-change transform + infinite float animation + JS parallax
              transform inside the preserve-3d tilt panel) repeatedly left the
              frame painted empty black in the owner's real desktop browser
              while the file loaded fine — the layers are removed, the gold
              ring frame and the photo itself are unchanged. */}
          <div className="overflow-hidden rounded-md ring-1 ring-[rgba(255,215,0,0.55)] shadow-[0_0_44px_rgba(245,197,66,0.22)]">
            <img src={ipadImg} alt="Apple's official photo of the 11-inch iPad with A16 chip in silver, yellow, pink, and blue, with one iPad on the Magic Keyboard Folio and Apple Pencil" className="block h-auto w-full" width={1370} height={1644} loading="eager" />
          </div>
        </div>
      </section>

      <section ref={showcaseRef} className="showcase-pin tint-tracks border-b border-[var(--border)]" aria-labelledby="tracks-heading">
        <div className="showcase-sticky">
          <div className="w-full py-14 md:py-0">
            <div className="mx-auto max-w-6xl px-4 sm:px-6">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <Kicker>Tracks — 02 · Scroll to travel</Kicker>
                  <h2 id="tracks-heading" className="headline font-display mt-4 max-w-3xl text-4xl sm:text-5xl"><span className="reveal reveal-wipe block"><LetterFlip text="Four tracks. One challenge: build something real." /></span></h2>
                  <div aria-hidden="true" className="rule-grow reveal mt-4" />
                </div>
                <p aria-hidden="true" className="font-display text-2xl font-semibold tabular-nums text-[var(--accent2)]">{String(showcaseIndex + 1).padStart(2, "0")} <span className="text-[var(--muted)]">/ {String(TRACKS.length).padStart(2, "0")}</span></p>
              </div>
              <div className="mt-4 h-px w-full bg-[rgba(255,215,0,0.28)]"><div className="h-px bg-[var(--accent2)] transition-all duration-300" style={{ width: `${((showcaseIndex + 1) / TRACKS.length) * 100}%` }} /></div>
            </div>
            <div ref={trackRef} className="showcase-track mt-8 px-4 sm:px-6">
              {TRACKS.map((t, i) => (
                <article key={t.name} className="showcase-card tilt sweep sharp card-hover border border-[var(--border)] bg-[linear-gradient(150deg,#101010,rgba(16,16,16,0.92)_50%,#161616)] shadow-[0_12px_32px_rgba(0,0,0,0.45)] p-6 backdrop-blur-[3px] sm:p-8" data-cursor="Explore">
                  <div className="flex items-start justify-between gap-3">
                    <div aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-full bg-[#0E0E10] text-2xl text-[#F5C542] ring-1 ring-[rgba(245,197,66,0.40)]">{t.glyph}</div>
                    <span aria-hidden="true" className="font-display text-5xl font-semibold text-[#F5C542]/15">{String(i + 1).padStart(2, "0")}</span>
                  </div>
                  <h3 className="font-display mt-6 text-2xl font-bold sm:text-3xl">{t.name}</h3>
                  <p className="mt-2 text-base leading-relaxed text-[var(--dim)]">{t.desc}</p>
                  <button type="button" className="mt-7 inline-flex items-center gap-2 text-sm font-semibold text-[var(--accent2)] transition-transform duration-300 hover:translate-x-1" onClick={() => go("register")}><span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-[var(--accent2)]" />Register for {t.name} <span className="arrow-slide" aria-hidden="true">→</span></button>
                </article>
              ))}
            </div>
            <p className="mx-auto mt-6 hidden max-w-6xl px-4 font-letter text-[11px] uppercase tracking-[0.2em] text-[var(--muted)] sm:px-6 min-[900px]:block">Keep scrolling — the tracks travel sideways</p>
          </div>
        </div>
      </section>

      <LightDivider />
      <section className="reveal tint-sand relative mx-auto max-w-6xl px-4 pb-16 sm:px-6 md:pb-24" aria-labelledby="schedule-heading">
        <div aria-hidden="true" data-parallax-speed="-0.7" className="pointer-events-none absolute hidden sm:block -right-24 top-10 h-64 w-64 rounded-full bg-[rgba(245,197,66,0.10)] blur-3xl" />
        <Kicker>Schedule — 03</Kicker>
        <h2 id="schedule-heading" className="headline font-display mt-4 text-4xl sm:text-5xl"><LetterFlip text="Schedule" /></h2>
        <div aria-hidden="true" className="rule-grow reveal mt-4" />
        <p className="mt-2 text-sm text-[var(--muted)]">The dates below are taken from the event settings. If a date is changed, this page will reflect the updated date. All dates and times are in Indian Standard Time (IST).</p>
        <ol className="mt-6 space-y-0">
          {schedule.map((item, i) => (
            <li key={item.label} style={{ transitionDelay: `${Math.min(i, 4) * 80}ms` }} className="reveal reveal-blur relative flex gap-4 border-l-2 border-[var(--accent)]/50 pb-6 pl-5 last:pb-0">
              <span aria-hidden="true" className="absolute -left-[7px] top-1 h-3 w-3 rounded-full bg-[var(--accent2)]" />
              <div className="flex flex-1 flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="font-semibold">{i + 1}. {item.label}</p>
                  <p className="text-sm text-[var(--dim)]">{item.note}</p>
                </div>
                <p className="text-sm font-semibold text-[var(--accent2)]">{fmtDate(item.date)}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <LightDivider />
      <section className="reveal tint-peach relative border-y border-[var(--border)]" aria-labelledby="rules-heading"><div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-24">
        <div aria-hidden="true" data-parallax-speed="0.6" className="pointer-events-none absolute hidden sm:block -left-24 bottom-10 h-64 w-64 rounded-full bg-[rgba(252,246,186,0.08)] blur-3xl" />
        <Kicker>Rules — 04</Kicker>
        <h2 id="rules-heading" className="headline font-display mt-4 text-4xl sm:text-5xl"><LetterFlip text="Rules" /></h2>
        <div aria-hidden="true" className="rule-grow reveal mt-4" />
        <ul className="reveal-group mt-6 grid gap-3 sm:grid-cols-2">
          {[
            "Please submit original work created during the event. Previously submitted or plagiarised work is not eligible.",
            "Cyber Security entries must be defensive in nature — focused on protection, detection, and recovery. Attacks on real systems or people are not permitted.",
            `Teams must have between ${s.minTeamSize} and ${s.maxTeamSize} members. Each participant may belong to exactly one team.`,
            "One registration is permitted per email address. Duplicate email addresses will be rejected during registration.",
            "Round 1 is an idea submission. Only the top 30 highest-scoring teams will advance to Round 2.",
            "Judges will score submissions using the published scoring weights. Selection and payment decisions are final.",
          ].map((r) => <li key={r} className={`${cardCls} reveal-rotate text-sm leading-relaxed text-[var(--dim)]`}>{r}</li>)}
        </ul>
        </div>
      </section>

      {data.announcements.length > 0 && (
      <>
      <LightDivider />
        <section className="reveal mx-auto max-w-6xl px-4 pb-16 sm:px-6" aria-labelledby="ann-heading">
          <h2 id="ann-heading" className="headline font-display text-4xl sm:text-5xl"><LetterFlip text="Announcements" /></h2>
          <div className="mt-6 grid gap-3">
            {data.announcements.map((a) => (
              <article key={a.id} className={cardCls}>
                <h3 className="font-semibold">{a.title}</h3>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-[var(--dim)]">{a.body}</p>
                <p className="mt-2 text-xs text-[var(--muted)]">{fmtDateTime(a.createdAt)}</p>
              </article>
            ))}
          </div>
        </section>
      </>
      )}

      <LightDivider />
      <section className="reveal relative mx-auto max-w-6xl px-4 pb-16 sm:px-6 md:pb-24" aria-labelledby="faq-heading">
        <div aria-hidden="true" data-parallax-speed="-0.45" className="pointer-events-none absolute hidden sm:block -right-20 top-16 h-56 w-56 rounded-full bg-[rgba(232,168,124,0.09)] blur-3xl" />
        <Kicker>FAQ — 05</Kicker>
        <h2 id="faq-heading" className="headline font-display mt-4 text-4xl sm:text-5xl"><LetterFlip text="Questions, answered" /></h2>
        <div aria-hidden="true" className="rule-grow reveal mt-4" />
        <div className="mt-6 space-y-3">
          {faqs.map((f, i) => (
            <div key={f.q} className={cardCls}>
              <button type="button" className="flex w-full items-center justify-between gap-3 text-left font-semibold" aria-expanded={faqOpen === i} onClick={() => setFaqOpen(faqOpen === i ? null : i)}>
                {f.q}<span aria-hidden="true">{faqOpen === i ? "−" : "+"}</span>
              </button>
              <div className={`faq-panel ${faqOpen === i ? "is-open" : ""}`} aria-hidden={faqOpen !== i}><div><p className="pt-2 text-sm leading-relaxed text-[var(--dim)]">{f.a}</p></div></div>
            </div>
          ))}
        </div>
      </section>

      <EnquiryForm contactEmail={s.contactEmail} whatsappNumber={s.whatsappNumber} />
    </div>
  );
}

function EnquiryForm({ contactEmail, whatsappNumber }: { contactEmail: string; whatsappNumber?: string | null }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const mut = useMutation({
    mutationFn: () => api.submitEnquiry({ name, email, message }),
    onSuccess: (r) => {
      if (!r.ok) { setError(r.error ?? "Your enquiry could not be saved. Please try again."); return; }
      setDone(true); qc.invalidateQueries({ queryKey: ["public"] });
    },
    onError: (e) => setError(friendlyError(e, "Your enquiry could not be saved. Please try again.")),
  });
  return (
    <>
      <LightDivider />
    <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6" aria-labelledby="enquiry-heading">
      <div className="reveal grid gap-10 rounded-md border border-[var(--border)] bg-[var(--surface)] p-6 md:grid-cols-2 md:p-12">
        <div>
          <Kicker>Contact — 06</Kicker>
          <h2 id="enquiry-heading" className="headline font-display mt-4 text-4xl sm:text-5xl"><LetterFlip text="Contact Us" /></h2>
          <p className="mt-4 text-lg leading-relaxed text-[var(--dim)]">Please complete the form below and we will respond to the email address you provide. Every enquiry is stored securely, and a copy is queued and sent automatically to <span className="font-semibold text-[var(--text)]">{contactEmail}</span> from the SPACExPRO Gmail mailbox; it is recorded as sent only after the send has been verified.</p>
          {whatsappNumber && <p className="mt-4 text-base text-[var(--dim)]">For a quicker reply, you can also <WhatsAppLink number={whatsappNumber} />.</p>}
        </div>
        {done ? (
          <Notice kind="good"><strong className="text-[var(--text)]">Thank you. Your enquiry has been received.</strong> We will reply to the email address you provided.</Notice>
        ) : (
          <form className="space-y-4" onSubmit={(e: FormEvent) => { e.preventDefault(); setError(""); mut.mutate(); }}>
            <Field label="Your name"><input aria-label="Your name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required /></Field>
            <Field label="Email"><input aria-label="Email" type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
            <Field label="Message"><textarea aria-label="Message" className={`${inputCls} min-h-[120px]`} value={message} onChange={(e) => setMessage(e.target.value)} required /></Field>
            {error && <Notice kind="bad">{error}</Notice>}
            <button type="submit" className={btnPrimary} disabled={mut.isPending}>{mut.isPending ? "Saving…" : "Submit Enquiry"}</button>
          </form>
        )}
      </div>
    </section>
    </>
  );
}

type ParticipantDraft = {
  name: string; email: string; phone: string; college: string; degree: "B.Tech" | "M.Tech"; password: string;
  ideaTitle: string; ideaDescription: string; problemStatement: string; intendedUsers: string;
};
const emptyDraft: ParticipantDraft = { name: "", email: "", phone: "", college: "", degree: "B.Tech", password: "", ideaTitle: "", ideaDescription: "", problemStatement: "", intendedUsers: "" };
// Indian mobile: exactly 10 digits, first digit 6–9 (the +91 prefix is
// fixed in the UI and added by the server when the number is stored).
const INDIAN_MOBILE_RE = /^[6-9]\d{9}$/;
const INDIAN_MOBILE_ERROR = "Please enter a valid Indian mobile number: +91 followed by exactly 10 digits, starting with 6, 7, 8, or 9 (for example, +91 98765 43210).";

function RegisterView({ data, onRegistered }: { data: PublicData; onRegistered: () => void }) {
  const qc = useQueryClient();
  const s = data.settings;
  const closed = istTodayStr() > s.registrationDeadline;
  const [mode, setMode] = useState<"create" | "join">("create");
  const [track, setTrack] = useState<(typeof TRACKS)[number]["name"]>("AI/ML");
  const [teamName, setTeamName] = useState("");
  const [code, setCode] = useState("");
  const [paymentRef, setPaymentRef] = useState("");
  const [draft, setDraft] = useState<ParticipantDraft>(emptyDraft);
  const [error, setError] = useState("");
  const [ack, setAck] = useState<{ teamCode: string; reference: string; teamName: string; participantName: string; email: string; phone: string; track: string; college: string; paymentRef: string; feeInr: number | null; memberCount: number; isJoin: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [lookup, setLookup] = useState<{ name: string; track: string; college: string; memberCount: number } | null>(null);
  const set = (k: keyof ParticipantDraft, v: string) => setDraft((d) => ({ ...d, [k]: v }));
  const isSI = track === "Student Innovation";
  const lookupMut = useMutation({
    mutationFn: () => api.lookupTeamByCode({ code }),
    onSuccess: (r) => {
      if (!r.ok || !r.team) { setError(r.error ?? "No team was found with that team code. Please check the code and try again."); setLookup(null); return; }
      setLookup({ name: r.team.name, track: r.team.track, college: r.team.college, memberCount: r.team.memberCount });
      setTrack(r.team.track); setError("");
    },
    onError: (e) => setError(friendlyError(e, "The team code could not be checked. Please try again.")),
  });
  const regMut = useMutation({
    mutationFn: async () => {
      const base = { ...draft, track };
      if (mode === "create") return api.registerTeam({ teamName, paymentRef: paymentRef || undefined, ...base });
      return api.joinTeam({ code, ...base });
    },
    onSuccess: (r) => {
      if (!r.ok) { setError(r.error ?? "Registration could not be completed. Please try again."); return; }
      // A new team changes the public counts (header registration box,
      // hero line) — refresh them so they update without a reload.
      qc.invalidateQueries({ queryKey: ["public"] });
      if (mode === "create" && "teamCode" in r && r.teamCode) setAck({ teamCode: r.teamCode, reference: r.reference ?? "", teamName, participantName: draft.name, email: draft.email, phone: `+91${draft.phone}`, track, college: draft.college, paymentRef: paymentRef || "Not provided", feeInr: s.registrationFeeInr, memberCount: 1, isJoin: false });
      else setAck({ teamCode: code.toUpperCase(), reference: r.reference ?? "", teamName: lookup?.name ?? teamName, participantName: draft.name, email: draft.email, phone: `+91${draft.phone}`, track, college: draft.college, paymentRef: "Recorded at team level", feeInr: s.registrationFeeInr, memberCount: (lookup?.memberCount ?? 0) + 1, isJoin: true });
    },
    onError: (e) => setError(friendlyError(e, "Registration could not be completed. Please try again.")),
  });
  if (ack) {
    const copyCode = async () => {
      try { await navigator.clipboard.writeText(ack.teamCode); setCopied(true); } catch { setCopied(false); }
    };
    return (
      <div className="view-enter mx-auto max-w-2xl px-4 py-14 sm:px-6">
        {/* Poster acknowledgement — mirrors the poster email design:
            near-black card, double gold frame, team code centrepiece. */}
        <article aria-label="Registration acknowledgement poster" className="poster-card overflow-hidden rounded-2xl border-2 border-[#BF953F] bg-[#070708] shadow-[0_24px_70px_rgba(0,0,0,0.6),0_0_44px_rgba(245,197,66,0.14)]">
          <div className="m-[3px] rounded-[10px] border border-[#3A2F16] px-5 py-8 sm:px-9 sm:py-10">
            <p className="text-center font-display text-[22px] font-extrabold tracking-[0.28em] text-[var(--text)] sm:text-2xl">SPACE<span className="text-[var(--accent2)]">x</span>PRO</p>
            <p className="mt-1 text-center font-letter text-[11px] font-semibold uppercase tracking-[0.5em] text-[var(--muted)]">Hackathon</p>
            <div aria-hidden="true" className="mx-auto mt-5 h-[2px] w-[120px] bg-[linear-gradient(100deg,#AA771C,#FFD700_30%,#F5C542_48%,#FCF6BA_55%,#FFD700_78%,#AA771C)]" />
            <h1 className="headline font-display mt-6 text-center text-4xl sm:text-5xl">You&rsquo;re in<span className="text-[var(--accent2)]">.</span></h1>
            <p className="mx-auto mt-3 max-w-md text-center leading-relaxed text-[var(--dim)]">Thank you, {ack.participantName.split(" ")[0]} — your SPACExPRO Hackathon registration is complete. This poster is on its way to {ack.email} from space.x.pro.7@gmail.com. Keep it safe.</p>
            <div className="mt-7 rounded-xl border border-dashed border-[#BF953F] bg-[#030304] px-4 py-6 text-center">
              <p className="font-letter text-[11px] font-semibold uppercase tracking-[0.4em] text-[var(--muted)]">Your Team Code</p>
              <p className="font-display mt-2 text-[clamp(2.2rem,9vw,3.4rem)] font-extrabold leading-none tracking-[0.22em] text-[#FFD700] [text-shadow:0_0_26px_rgba(255,215,0,0.35)]">{ack.teamCode}</p>
              <p className="mt-3 text-sm text-[var(--dim)]">Team <strong className="text-[var(--text)]">{ack.teamName}</strong> · Ref <strong className="text-[var(--text)]">{ack.reference}</strong></p>
              <p className="mt-1 text-xs text-[var(--muted)]">Share this code only with your teammates — they need it to join your team.</p>
              <button type="button" className={`${btnGhost} mt-4 !px-5 !py-2 text-xs`} onClick={copyCode} aria-label="Copy team code">{copied ? "Team Code Copied ✓" : "Copy Team Code"}</button>
            </div>
            <dl className="mt-6 text-sm">
              {[
                ["Participant", ack.participantName],
                ["Email", ack.email],
                ["Mobile", ack.phone],
                ["Track", ack.track],
                ["College", ack.college],
                ["Team so far", `${ack.memberCount} member${ack.memberCount === 1 ? "" : "s"} registered · teams of ${s.minTeamSize}–${s.maxTeamSize}`],
                ["Event starts", `${fmtDate(s.eventStart)} · IST`],
                ["Round 1 due", `${fmtDate(s.round1Deadline)} · IST`],
              ].map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-4 border-b border-[#241B08] py-2.5 last:border-0">
                  <dt className="shrink-0 font-letter text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">{k}</dt>
                  <dd className="text-right font-semibold text-[var(--text)]">{v}</dd>
                </div>
              ))}
              {ack.feeInr != null && (
                <div className="flex items-baseline justify-between gap-4 border-b border-[#241B08] py-2.5">
                  <dt className="shrink-0 font-letter text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Registration Fee</dt>
                  <dd className="text-right font-semibold text-[var(--text)]">{fmtINR(ack.feeInr)} (INR) per team</dd>
                </div>
              )}
            </dl>
            <div className="mt-5 rounded-[10px] border border-[#AA771C] bg-[#0B0A06] px-4 py-4 sm:px-5">
              <p className="font-letter text-xs font-bold uppercase tracking-[0.24em] text-[#FCF6BA]">Payment — Pending Verification</p>
              {ack.isJoin ? (
                <p className="mt-1.5 text-sm leading-relaxed text-[var(--dim)]">Payment is handled at team level — your team&rsquo;s payment reference and status are shown in the Team Portal. The payment status will remain pending verification until an organizer verifies it. No payment has been confirmed.</p>
              ) : ack.paymentRef === "Not provided" ? (
                <>
                  <p className="mt-1.5 text-sm leading-relaxed text-[var(--dim)]">No payment reference was submitted with this registration, so there is nothing to verify yet. Add your UPI reference / UTR in the Team Portal after you pay — your payment status stays pending verification until an organizer verifies it. No payment has been confirmed.</p>
                  <p className="mt-1.5 text-sm text-[var(--dim)]">Payment reference (UTR): <strong className="text-[var(--text)]">Not submitted yet</strong></p>
                </>
              ) : (
                <>
                  <p className="mt-1.5 text-sm leading-relaxed text-[var(--dim)]">Your payment reference has been recorded and is awaiting verification by an organizer. No payment has been confirmed yet — we will email you again the moment it is verified.</p>
                  <p className="mt-1.5 text-sm text-[var(--dim)]">Payment reference (UTR): <strong className="text-[var(--text)]">{ack.paymentRef}</strong></p>
                </>
              )}
              <div className="mt-3 border-t border-[#241B08] pt-3">
                <p className="text-sm font-semibold text-[var(--text)]">How to pay — via Razorpay</p>
                <PaymentMethods />
              </div>
            </div>
            <div className="mt-6">
              <h2 className="font-letter text-xs font-bold uppercase tracking-[0.24em] text-[var(--accent2)]">What Happens Next</h2>
              <ol className="mt-3 space-y-2.5 text-sm leading-relaxed text-[var(--dim)]">
                <li className="flex gap-3"><span className="font-display font-bold text-[#FFD700]">1.</span><span>Keep your team code safe — it is your team&rsquo;s key for joining, sign-in recovery, and submissions.</span></li>
                <li className="flex gap-3"><span className="font-display font-bold text-[#FFD700]">2.</span><span>Sign in to the Team Portal with the email and password you registered with to see deadlines, announcements, and your payment status.</span></li>
                <li className="flex gap-3"><span className="font-display font-bold text-[#FFD700]">3.</span><span>Build your Round 1 submission — due {fmtDate(s.round1Deadline)} (IST). Registration closes {fmtDate(s.registrationDeadline)} (IST).</span></li>
              </ol>
            </div>
            <div className="mt-7 border-t border-[#3A2F16] pt-5 text-center">
              <p className="text-sm text-[var(--muted)]">Questions? Write to <a href="mailto:space.x.pro.7@gmail.com" className="font-semibold text-[var(--accent2)]">space.x.pro.7@gmail.com</a>{s.whatsappNumber ? <> · <WhatsAppLink number={s.whatsappNumber} /></> : null}</p>
              <p className="mt-1 font-semibold text-[var(--text)]">— Team SPACExPRO</p>
            </div>
          </div>
        </article>
        <div className="mt-5"><Notice kind="info">This same poster has been queued for {ack.email} and is sent automatically from the SPACExPRO Gmail mailbox (space.x.pro.7@gmail.com). It is recorded as sent only after the send has been verified. Your payment status will remain pending verification until your transaction reference has been reviewed by an organizer. No payment has been confirmed.</Notice></div>
        <div className="mt-5 flex flex-wrap gap-3">
          <button type="button" className={btnPrimary} onClick={onRegistered}>Sign In to the Team Portal</button>
          <button type="button" className={btnGhost} onClick={() => { setAck(null); setCopied(false); setDraft(emptyDraft); setTeamName(""); setCode(""); setPaymentRef(""); setMode("create"); setTrack("AI/ML"); setLookup(null); setError(""); }}>Register Another Participant</button>
        </div>
      </div>
    );
  }
  return (
    <div className="view-enter tint-warm mx-auto max-w-3xl px-4 py-14 sm:px-6 md:py-20">
      <Kicker>Registration</Kicker>
      <h1 className="headline font-display mt-4 text-[clamp(2.6rem,7vw,4.5rem)]">
        <span className="mask"><span className="mask-line is-in"><LetterFlip text="Register" /></span></span>
        <span className="mask"><span className="mask-line mask-line-d1 is-in"><LetterFlip text="for SPACExPRO" /><span className="text-[var(--accent2)]">.</span></span></span>
      </h1>
      <p className="mt-2 leading-relaxed text-[var(--dim)]">Registration closes on {fmtDate(s.registrationDeadline)}. Teams must have between {s.minTeamSize} and {s.maxTeamSize} members. Each email address may hold only one team membership.</p>
      {closed && <div className="mt-4"><Notice kind="bad">Registration is now closed, as the deadline ({fmtDate(s.registrationDeadline)}) has passed. The deadline may be extended in Event Settings.</Notice></div>}
      <div className="mt-6 grid grid-cols-2 gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] p-1" role="tablist" aria-label="Registration path">
        {(["create", "join"] as const).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setError(""); }} className={`rounded-full px-4 py-2.5 text-sm font-semibold ${mode === m ? "bg-[linear-gradient(100deg,#AA771C,#FFD700_28%,#F5C542_46%,#FCF6BA_52%,#F2EFE6_58%,#E8A87C_64%,#FFD700_82%,#AA771C)] text-[#0A0A0A] shadow-[0_6px_20px_rgba(245,197,66,0.35)]" : "text-[var(--dim)]"}`}>
            {m === "create" ? "Create a Team" : "Join a Team"}
          </button>
        ))}
      </div>
      <form className="mt-6 space-y-5" onSubmit={(e: FormEvent) => { e.preventDefault(); if (!INDIAN_MOBILE_RE.test(draft.phone)) { setError(INDIAN_MOBILE_ERROR); return; } setError(""); regMut.mutate(); }}>
        {mode === "join" && (
          <div className={`${cardCls} space-y-3`}>
            <Field label="Team Code"><input aria-label="Team Code" className={`${inputCls} uppercase tracking-widest`} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} required placeholder="e.g. K7Q2XM" /></Field>
            <button type="button" className={btnGhost} onClick={() => lookupMut.mutate()} disabled={!code || lookupMut.isPending}>Find Team</button>
            {lookup && <Notice kind="good">We found <strong className="text-[var(--text)]">{lookup.name}</strong> ({lookup.track}, {lookup.college}), with {lookup.memberCount} member{lookup.memberCount === 1 ? "" : "s"} registered so far.</Notice>}
          </div>
        )}
        <div className={cardCls}>
          <h2 className="font-display text-lg font-semibold">{mode === "create" ? "Team Details" : "Your Details"}</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {mode === "create" && <Field label="Team name"><input aria-label="Team name" className={inputCls} value={teamName} onChange={(e) => setTeamName(e.target.value)} required /></Field>}
            <Field label="Track">
              <select aria-label="Track" className={inputCls} value={track} onChange={(e) => setTrack(e.target.value as typeof track)} disabled={mode === "join" && Boolean(lookup)}>
                {TRACKS.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="Full Name"><input aria-label="Full Name" className={inputCls} value={draft.name} onChange={(e) => set("name", e.target.value)} required /></Field>
            <Field label="Email"><input aria-label="Email" type="email" className={inputCls} value={draft.email} onChange={(e) => set("email", e.target.value)} required /></Field>
            <Field label="Mobile Number" hint="Indian mobile number, also used for WhatsApp updates. Enter the 10 digits after +91.">
              <span className="flex overflow-hidden rounded-md border border-[var(--border)] bg-[#0A0A0B] shadow-[0_1px_2px_rgba(0,0,0,0.45)] transition-colors focus-within:border-[var(--accent2)]">
                <span aria-hidden="true" className="flex items-center border-r border-[var(--border)] px-3 text-[15px] font-semibold text-[var(--dim)]">+91</span>
                <input aria-label="Mobile Number" type="tel" inputMode="numeric" autoComplete="tel-national" className="w-full bg-transparent px-3.5 py-3 text-[15px] text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none" value={draft.phone} onChange={(e) => set("phone", e.target.value.replace(/\D/g, "").slice(0, 10))} required placeholder="98765 43210" />
              </span>
            </Field>
            <Field label="College"><input aria-label="College" className={inputCls} value={draft.college} onChange={(e) => set("college", e.target.value)} required /></Field>
            <Field label="Degree">
              <select aria-label="Degree" className={inputCls} value={draft.degree} onChange={(e) => set("degree", e.target.value)}>
                <option value="B.Tech">B.Tech</option><option value="M.Tech">M.Tech</option>
              </select>
            </Field>
            <Field label="Portal Password" hint="At least 8 characters. You will use this email address and password to sign in to the Team Portal.">
              <input aria-label="Portal Password" type="password" className={inputCls} value={draft.password} onChange={(e) => set("password", e.target.value)} required minLength={8} autoComplete="new-password" />
            </Field>
            {mode === "create" && (
              <Field label="Payment Transaction Reference" hint="For UPI payments, enter the UPI reference / UTR number shown in PhonePe, Paytm, Google Pay, or BHIM UPI after you pay. For organizer review — your payment will remain pending verification until it has been verified. No payment is confirmed automatically.">
                <input aria-label="Payment Transaction Reference" className={inputCls} value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)} placeholder="e.g. UPI reference / UTR number" />
              </Field>
            )}
          </div>
          {mode === "create" && (
            <div className="mt-4 border-t border-[var(--border)] pt-4">
              <h3 className="font-display text-base font-semibold">How to pay — via Razorpay</h3>
              {s.registrationFeeInr != null && <p className="mt-1 text-sm text-[var(--dim)]">Registration fee: <strong className="text-[var(--text)]">{fmtINR(s.registrationFeeInr)} (INR)</strong> per team.</p>}
              <PaymentMethods />
            </div>
          )}
          {mode === "join" && <p className="mt-3 text-sm text-[var(--muted)]">Payment is handled at team level. The team's payment reference and status are shown in the Team Portal.</p>}
        </div>
        {isSI && (
          <div className={cardCls}>
            <h2 className="font-display text-lg font-semibold">Student Innovation Idea</h2>
            <p className="mt-1 text-sm text-[var(--dim)]">These fields are required for the Student Innovation track.</p>
            <div className="mt-4 space-y-4">
              <Field label="Idea Title"><input aria-label="Idea Title" className={inputCls} value={draft.ideaTitle} onChange={(e) => set("ideaTitle", e.target.value)} required /></Field>
              <Field label="Idea Description"><textarea aria-label="Idea Description" className={`${inputCls} min-h-[90px]`} value={draft.ideaDescription} onChange={(e) => set("ideaDescription", e.target.value)} required /></Field>
              <Field label="Problem Statement"><textarea aria-label="Problem Statement" className={`${inputCls} min-h-[90px]`} value={draft.problemStatement} onChange={(e) => set("problemStatement", e.target.value)} required /></Field>
              <Field label="Intended Users"><input aria-label="Intended Users" className={inputCls} value={draft.intendedUsers} onChange={(e) => set("intendedUsers", e.target.value)} required /></Field>
            </div>
          </div>
        )}
        <Notice kind="warn"><strong className="text-[var(--text)]">Payment Review.</strong> Payments are made via Razorpay using UPI, Indian cards, netbanking, or Indian wallets. Razorpay checkout is not yet connected and no verified webhook exists, so a payment reference is recorded for organizer review only. No payment is confirmed automatically, and your status will show as pending verification until an organizer verifies it.</Notice>
        {error && <Notice kind="bad">{error}</Notice>}
        <Magnetic><button type="submit" data-cursor="Register" className={btnPrimary} disabled={regMut.isPending || closed}>{regMut.isPending ? "Saving…" : mode === "create" ? <>Create Team and Register <span className="arrow-slide" aria-hidden="true">→</span></> : "Join Team"}</button></Magnetic>
      </form>
    </div>
  );
}

function AuthView({ role, session, onSession, goPortal, goRegister, goOrganizer }: { role: "participant" | "organizer"; session: Session | null; onSession: (s: Session | null) => void; goPortal: () => void; goRegister?: () => void; goOrganizer?: () => void }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"signin" | "reset" | "setup">("signin");
  const [resetCode, setResetCode] = useState("");
  const [teamCode, setTeamCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [resetRequested, setResetRequested] = useState(false);
  const [setup, setSetup] = useState({ email: "", password: "", displayName: "" });
  const [setupDone, setSetupDone] = useState(false);
  const signInMut = useMutation({
    // Sign-in only creates a session, so retrying a dropped connection is
    // safe: a brief gateway interruption no longer fails the sign-in.
    mutationFn: () => withTransportRetry(() => api.signIn({ email, password, role })),
    onSuccess: (r) => {
      if (!r.ok || !r.token) { setError(r.error ?? "Sign-in could not be completed. Please try again."); return; }
      onSession({ token: r.token, role, name: r.name ?? email });
      qc.invalidateQueries();
      goPortal();
    },
    onError: (e) => setError(friendlyError(e, "Sign-in could not be completed. Please try again.")),
  });
  const resetReqMut = useMutation({
    mutationFn: () => api.requestPasswordReset({ email, role }),
    onSuccess: () => { setResetRequested(true); },
    onError: (e) => setError(friendlyError(e, "The reset code could not be requested. Please try again.")),
  });
  const resetMut = useMutation({
    mutationFn: () => api.resetPassword({ email, role, code: resetCode || undefined, teamCode: teamCode || undefined, newPassword }),
    onSuccess: (r) => {
      if (!r.ok) { setError(r.error ?? "Your password could not be reset. Please try again."); return; }
      setMode("signin"); setError(""); setPassword(""); setResetRequested(false);
    },
    onError: (e) => setError(friendlyError(e, "Your password could not be reset. Please try again.")),
  });
  const setupMut = useMutation({
    mutationFn: () => api.setupOrganizer(setup),
    onSuccess: (r) => {
      if (!r.ok) { setError(r.error ?? "The owner account could not be created. Please try again."); return; }
      setSetupDone(true); qc.invalidateQueries({ queryKey: ["public"] });
    },
    onError: (e) => setError(friendlyError(e, "The owner account could not be created. Please try again.")),
  });
  if (session && session.role === role) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12 text-center sm:px-6">
        <p className="text-[var(--dim)]">Signed in as <strong className="text-[var(--text)]">{session.name}</strong>.</p>
        <button type="button" className={`${btnPrimary} mt-4`} onClick={goPortal}>Continue to {role === "organizer" ? "Organizer Area" : "Team Portal"}</button>
      </div>
    );
  }
  const title = role === "organizer" ? "Organizer Sign-In" : "Team Portal Sign-In";
  return (
    <div className="view-enter tint-warm mx-auto max-w-xl px-4 py-14 sm:px-6 md:py-20">
      <Kicker>{role === "organizer" ? "Restricted area" : "Team Portal"}</Kicker>
      <h1 className="headline font-display mt-4 text-[clamp(2.4rem,6vw,4rem)]">
        <span className="mask"><span className="mask-line is-in"><LetterFlip key={title} text={title} /></span></span>
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-[var(--dim)]">
        {role === "organizer"
          ? "This area is restricted to the owner and two approved organizer accounts. Participant registration does not grant organizer access."
          : "Please sign in with the email address and password you used when registering. Your team details, team code, submissions, and payment status are available here."}
      </p>
      {mode === "setup" && role === "organizer" ? (
        setupDone ? (
          <div className="mt-6"><Notice kind="good">Your owner account has been created successfully. Please sign in below.</Notice><button type="button" className={`${btnPrimary} mt-4`} onClick={() => setMode("signin")}>Go to Sign-In</button></div>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={(e: FormEvent) => { e.preventDefault(); setError(""); setupMut.mutate(); }}>
            <Notice kind="info">No organizer account exists yet. Please create the owner account here. After this, only existing organizers will be able to add the two approved organizer accounts.</Notice>
            <Field label="Display name"><input aria-label="Display name" className={inputCls} value={setup.displayName} onChange={(e) => setSetup({ ...setup, displayName: e.target.value })} required /></Field>
            <Field label="Email"><input aria-label="Email" type="email" className={inputCls} value={setup.email} onChange={(e) => setSetup({ ...setup, email: e.target.value })} required /></Field>
            <Field label="Password"><input aria-label="Password" type="password" className={inputCls} value={setup.password} onChange={(e) => setSetup({ ...setup, password: e.target.value })} required minLength={8} autoComplete="new-password" /></Field>
            {error && <Notice kind="bad">{error}</Notice>}
            <button type="submit" className={btnPrimary} disabled={setupMut.isPending}>Create Owner Account</button>
            <button type="button" className={btnGhost} onClick={() => setMode("signin")}>Back to Sign-In</button>
          </form>
        )
      ) : mode === "reset" ? (
        <form className="mt-6 space-y-4" onSubmit={(e: FormEvent) => { e.preventDefault(); setError(""); resetMut.mutate(); }}>
          <Field label="Account Email"><input aria-label="Account Email" type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
          <div className="flex flex-wrap items-end gap-3">
            <button type="button" className={btnGhost} onClick={() => { setError(""); resetReqMut.mutate(); }} disabled={!email || resetReqMut.isPending}>Request Reset Code</button>
            {resetReqMut.isPending && <span className="text-sm text-[var(--muted)]">Sending…</span>}
          </div>
          {resetRequested && (
            <Notice kind="info"><strong className="text-[var(--text)]">Reset Code Requested.</strong> If an account exists for the email address provided, a reset code has been created, queued, and is sent automatically to that address from the SPACExPRO Gmail mailbox (space.x.pro.7@gmail.com); it is recorded as sent only after the send has been verified. The code is never shown on screen. Participants may also recover their account using their team code below.</Notice>
          )}
          <Field label="Reset Code From Your Email"><input aria-label="Emailed reset code" className={`${inputCls} uppercase tracking-widest`} value={resetCode} onChange={(e) => setResetCode(e.target.value.toUpperCase())} /></Field>
          {role === "participant" && (
            <Field label="Alternatively, your team code"><input aria-label="Team code for account recovery" className={`${inputCls} uppercase tracking-widest`} value={teamCode} onChange={(e) => setTeamCode(e.target.value.toUpperCase())} /></Field>
          )}
          <Field label="New Password"><input aria-label="New Password" type="password" className={inputCls} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} autoComplete="new-password" /></Field>
          {error && <Notice kind="bad">{error}</Notice>}
          <button type="submit" className={btnPrimary} disabled={resetMut.isPending}>Reset Password and Return to Sign-In</button>
          <button type="button" className={btnGhost} onClick={() => setMode("signin")}>Back to Sign-In</button>
        </form>
      ) : (
        <form className="mt-6 space-y-4" onSubmit={(e: FormEvent) => { e.preventDefault(); setError(""); signInMut.mutate(); }}>
          <Field label="Email"><input aria-label="Email" type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></Field>
          <Field label="Password"><input aria-label="Password" type="password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" /></Field>
          {error && <Notice kind="bad">{error}</Notice>}
          <button type="submit" className={btnPrimary} disabled={signInMut.isPending}>{signInMut.isPending ? "Signing In…" : "Sign In"}</button>
          <div className="flex flex-wrap gap-3">
            <button type="button" className="text-sm font-semibold text-[var(--accent2)]" onClick={() => { setMode("reset"); setError(""); }}>Forgot your password? Reset it here</button>
            {role === "organizer" && <button type="button" className="text-sm font-semibold text-[var(--accent2)]" onClick={() => { setMode("setup"); setError(""); }}>No organizer account yet? Create the owner account here</button>}
            {role === "participant" && <button type="button" className="text-sm font-semibold text-[var(--accent2)]" onClick={() => (goRegister ?? goPortal)()}>Not registered yet? Please register first</button>}
            {role === "participant" && goOrganizer && <button type="button" className="text-sm font-semibold text-[var(--accent2)]" onClick={goOrganizer}>Are you an organizer? Open the organizer sign-in</button>}
          </div>
        </form>
      )}
    </div>
  );
}

function Round1Form({ session, initial, deadline }: { session: Session; initial: PortalData["round1"]; deadline: string }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ idea: initial?.idea ?? "", problem: initial?.problem ?? "", solution: initial?.solution ?? "", intendedUsers: initial?.intendedUsers ?? "", techStack: initial?.techStack ?? "", presentationLink: initial?.presentationLink ?? "", description: initial?.description ?? "" });
  const [msg, setMsg] = useState("");
  const mut = useMutation({
    mutationFn: () => api.saveSubmission1({ token: session.token, ...f, presentationLink: f.presentationLink || undefined, description: f.description || undefined }),
    onSuccess: (r) => { if (!r.ok) setMsg(r.error ?? "Your submission could not be saved. Please try again."); else { setMsg("Your Round 1 submission has been saved successfully."); qc.invalidateQueries({ queryKey: ["portal"] }); } },
    onError: (e) => setMsg(friendlyError(e, "Your submission could not be saved. Please try again.")),
  });
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });
  return (
    <form className="space-y-4" onSubmit={(e: FormEvent) => { e.preventDefault(); setMsg(""); mut.mutate(); }}>
      <Notice kind="info">Due on {fmtDate(deadline)}. You may edit and re-save your submission until the organizer closes submissions. A presentation link or a structured description is required — please provide at least one.</Notice>
      <Field label="Idea"><textarea aria-label="Idea" className={`${inputCls} min-h-[80px]`} value={f.idea} onChange={(e) => set("idea", e.target.value)} required /></Field>
      <Field label="Problem"><textarea aria-label="Problem" className={`${inputCls} min-h-[90px]`} value={f.problem} onChange={(e) => set("problem", e.target.value)} required /></Field>
      <Field label="Solution"><textarea aria-label="Solution" className={`${inputCls} min-h-[90px]`} value={f.solution} onChange={(e) => set("solution", e.target.value)} required /></Field>
      <Field label="Intended Users"><textarea aria-label="Intended Users" className={`${inputCls} min-h-[70px]`} value={f.intendedUsers} onChange={(e) => set("intendedUsers", e.target.value)} required /></Field>
      <Field label="Technology Stack"><input aria-label="Technology Stack" className={inputCls} value={f.techStack} onChange={(e) => set("techStack", e.target.value)} required /></Field>
      <Field label="Presentation Link"><input aria-label="Presentation Link" type="url" className={inputCls} value={f.presentationLink} onChange={(e) => set("presentationLink", e.target.value)} placeholder="https://…" /></Field>
      <Field label="Structured Description (If No Presentation Link)"><textarea aria-label="Structured description" className={`${inputCls} min-h-[90px]`} value={f.description} onChange={(e) => set("description", e.target.value)} /></Field>
      {msg && <Notice kind={msg.includes("saved") ? "good" : "bad"}>{msg}</Notice>}
      <button type="submit" className={btnPrimary} disabled={mut.isPending}>{mut.isPending ? "Saving…" : initial ? "Update Round 1 Submission" : "Save Round 1 Submission"}</button>
    </form>
  );
}

function Round2Form({ session, initial, deadline }: { session: Session; initial: PortalData["round2"]; deadline: string }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ prototypeDesc: initial?.prototypeDesc ?? "", githubLink: initial?.githubLink ?? "", demoVideoLink: initial?.demoVideoLink ?? "", readmeText: initial?.readmeText ?? "", installInstructions: initial?.installInstructions ?? "", rolesText: initial?.rolesText ?? "", limitations: initial?.limitations ?? "" });
  const [msg, setMsg] = useState("");
  const mut = useMutation({
    mutationFn: () => api.saveSubmission2({ token: session.token, ...f, githubLink: f.githubLink || undefined, demoVideoLink: f.demoVideoLink || undefined }),
    onSuccess: (r) => { if (!r.ok) setMsg(r.error ?? "Your submission could not be saved. Please try again."); else { setMsg("Your Round 2 submission has been saved successfully."); qc.invalidateQueries({ queryKey: ["portal"] }); } },
    onError: (e) => setMsg(friendlyError(e, "Your submission could not be saved. Please try again.")),
  });
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });
  return (
    <form className="space-y-4" onSubmit={(e: FormEvent) => { e.preventDefault(); setMsg(""); mut.mutate(); }}>
      <Notice kind="info">Due on {fmtDate(deadline)}. This round is open to qualified teams only.</Notice>
      <Field label="Prototype Description"><textarea aria-label="Prototype Description" className={`${inputCls} min-h-[90px]`} value={f.prototypeDesc} onChange={(e) => set("prototypeDesc", e.target.value)} required /></Field>
      <Field label="GitHub Link"><input aria-label="GitHub Link" type="url" className={inputCls} value={f.githubLink} onChange={(e) => set("githubLink", e.target.value)} placeholder="https://github.com/…" /></Field>
      <Field label="Demo Video Link"><input aria-label="Demo Video Link" type="url" className={inputCls} value={f.demoVideoLink} onChange={(e) => set("demoVideoLink", e.target.value)} placeholder="https://…" /></Field>
      <Field label="README"><textarea aria-label="README" className={`${inputCls} min-h-[110px]`} value={f.readmeText} onChange={(e) => set("readmeText", e.target.value)} required /></Field>
      <Field label="Installation Instructions"><textarea aria-label="Installation Instructions" className={`${inputCls} min-h-[90px]`} value={f.installInstructions} onChange={(e) => set("installInstructions", e.target.value)} required /></Field>
      <Field label="Roles — Who Did What"><textarea aria-label="Roles" className={`${inputCls} min-h-[80px]`} value={f.rolesText} onChange={(e) => set("rolesText", e.target.value)} required /></Field>
      <Field label="Limitations"><textarea aria-label="Limitations" className={`${inputCls} min-h-[80px]`} value={f.limitations} onChange={(e) => set("limitations", e.target.value)} required /></Field>
      {msg && <Notice kind={msg.includes("saved") ? "good" : "bad"}>{msg}</Notice>}
      <button type="submit" className={btnPrimary} disabled={mut.isPending}>{mut.isPending ? "Saving…" : initial ? "Update Round 2 Submission" : "Save Round 2 Submission"}</button>
    </form>
  );
}

function PortalView({ session, onSession, goRegister, goOrganizer }: { session: Session | null; onSession: (s: Session | null) => void; goRegister: () => void; goOrganizer: () => void }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"overview" | "round1" | "round2" | "results">("overview");
  const [payRef, setPayRef] = useState("");
  const [payMsg, setPayMsg] = useState("");
  const portal = useQuery({ queryKey: ["portal", session?.token], queryFn: () => api.getTeamPortal({ token: session?.token ?? "" }), enabled: Boolean(session?.token && session.role === "participant"), retry: readRetry, retryDelay: actionRetryDelay });
  const payMut = useMutation({
    mutationFn: () => api.updatePaymentRef({ token: session?.token ?? "", paymentRef: payRef }),
    onSuccess: (r) => { if (!r.ok) setPayMsg(r.error ?? "Your payment reference could not be updated. Please try again."); else { setPayMsg("Your payment reference has been updated successfully. The payment status is pending review."); qc.invalidateQueries({ queryKey: ["portal"] }); } },
    onError: (e) => setPayMsg(friendlyError(e, "Your payment reference could not be updated. Please try again.")),
  });
  if (!session || session.role !== "participant") {
    return <AuthView role="participant" session={session} onSession={onSession} goPortal={() => undefined} goRegister={goRegister} goOrganizer={goOrganizer} />;
  }
  if (portal.isPending) return <p className="mx-auto max-w-3xl px-4 py-12 text-[var(--dim)]">Loading your team details…</p>;
  if (portal.error || !portal.data) {
    const errText = portal.error instanceof Error ? portal.error.message : "";
    const sessionInvalid = !portal.error || /not authorized/i.test(errText);
    if (!sessionInvalid) {
      // A dropped connection is not a failed sign-in: keep the session
      // and offer a retry instead of forcing the participant out.
      return (
        <div className="mx-auto max-w-xl px-4 py-10 sm:px-6">
          <Notice kind="bad">The connection was interrupted while loading your team details. Your session is still saved on this device — please try again.</Notice>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" className={btnPrimary} onClick={() => { void portal.refetch(); }} disabled={portal.isFetching}>{portal.isFetching ? "Reconnecting…" : "Try Again"}</button>
            <button type="button" className={btnGhost} onClick={() => { onSession(null); }}>Sign In Again</button>
          </div>
        </div>
      );
    }
    return (
      <div className="mx-auto max-w-xl px-4 py-10 sm:px-6">
        <Notice kind="bad">Your session could not be verified. Please sign in again to continue.</Notice>
        <button type="button" className={`${btnGhost} mt-4`} onClick={() => { onSession(null); }}>Sign In Again</button>
      </div>
    );
  }
  const d = portal.data;
  const tabs = [["overview", "Overview"], ["round1", "Round 1"], ["round2", "Round 2"], ["results", "Results and Schedule"]] as const;
  return (
    <div className="view-enter tint-warm mx-auto max-w-4xl px-4 py-14 sm:px-6 md:py-20">
      <Kicker>Team Portal</Kicker>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="headline font-display text-[clamp(2.4rem,6vw,4rem)]">
            <span className="mask"><span className="mask-line is-in"><LetterFlip key={d.team.name} text={d.team.name} /></span></span>
          </h1>
          <p className="mt-1 text-sm text-[var(--dim)]">{d.team.track} · {d.team.college} · {d.members.length} member{d.members.length === 1 ? "" : "s"}</p>
        </div>
        <Pill text={d.team.qualified ? "Qualified for Round 2" : "Awaiting Selection"} tone={d.team.qualified ? "good" : "neutral"} />
      </div>
      <div className="mt-6 flex flex-wrap gap-2" role="tablist" aria-label="Team portal sections">
        {tabs.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`rounded-full border px-4 py-2 text-sm font-semibold ${tab === k ? "border-transparent bg-[linear-gradient(100deg,#AA771C,#FFD700_28%,#F5C542_46%,#FCF6BA_52%,#F2EFE6_58%,#E8A87C_64%,#FFD700_82%,#AA771C)] text-[#0A0A0A] shadow-[0_6px_20px_rgba(245,197,66,0.35)]" : "border-[var(--border)] text-[var(--dim)]"}`}>{label}</button>
        ))}
      </div>
      <div key={tab} className="tab-enter">
      {tab === "overview" && (
        <div className="mt-6 space-y-5">
          <div className={cardCls}>
            <h2 className="font-display text-lg font-semibold">Registration Acknowledgement</h2>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-[var(--muted)]">Team Code</dt><dd className="font-display text-lg font-bold tracking-widest text-[var(--accent2)]">{d.team.code}</dd></div>
              <div><dt className="text-[var(--muted)]">Registration Reference</dt><dd className="font-semibold">{d.team.createdAt.slice(0, 10) < "2026-11-07" ? "ORB" : "SPX"}-{d.team.id}</dd></div>
              <div><dt className="text-[var(--muted)]">Date Registered</dt><dd>{fmtDateTime(d.team.createdAt)}</dd></div>
              <div><dt className="text-[var(--muted)]">Track</dt><dd className="font-semibold">{d.team.track}</dd></div>
              <div><dt className="text-[var(--muted)]">College</dt><dd className="font-semibold">{d.team.college}</dd></div>
            </dl>
            <h3 className="mt-6 font-semibold">Team Members</h3>
            <ul className="mt-2 space-y-2">
              {d.members.map((m) => (
                <li key={m.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border)] pb-2 text-sm last:border-0">
                  <span><strong>{m.name}</strong> · {m.email}{m.phone ? ` · ${m.phone}` : ""} · {m.college} · {m.degree}{m.isLeader ? " · Team Leader" : ""}</span>
                </li>
              ))}
            </ul>
            {d.members.some((m) => m.ideaTitle) && (
              <div className="mt-4">
                <h3 className="font-semibold">Student Innovation Ideas on File</h3>
                {d.members.filter((m) => m.ideaTitle).map((m) => (
                  <p key={m.id} className="mt-1 text-sm text-[var(--dim)]"><strong className="text-[var(--text)]">{m.ideaTitle}</strong> — {m.name}: {m.problemStatement}</p>
                ))}
              </div>
            )}
          </div>
          {/* Razorpay integration lives in server/src/razorpay.ts — this card only displays status and collects the manual UTR reference. */}
          <div className={cardCls}>
            <h2 className="font-display text-lg font-semibold">Payment</h2>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
              {paymentPill(d.team.paymentStatus)}
              <span className="text-[var(--dim)]">Payment Reference: <strong className="text-[var(--text)]">{d.team.paymentRef ?? "Not provided"}</strong></span>
            </div>
            {d.settings.registrationFeeInr != null && <p className="mt-2 text-sm text-[var(--dim)]">Registration fee: <strong className="text-[var(--text)]">{fmtINR(d.settings.registrationFeeInr)} (INR)</strong> per team.</p>}
            {d.team.paymentNote && <p className="mt-2 text-sm text-[var(--dim)]">Organizer Note: {d.team.paymentNote}</p>}
            <div className="mt-4 border-t border-[var(--border)] pt-4">
              <h3 className="font-display text-base font-semibold">How to pay — via Razorpay</h3>
              <PaymentMethods />
            </div>
            <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={(e: FormEvent) => { e.preventDefault(); setPayMsg(""); payMut.mutate(); }}>
              <Field label="Update Payment Transaction Reference" hint="For UPI payments, use the UPI reference / UTR number from your UPI app."><input aria-label="Update Payment Transaction Reference" className={inputCls} value={payRef} onChange={(e) => setPayRef(e.target.value)} required placeholder="e.g. UPI reference / UTR number" /></Field>
              <button type="submit" className={btnGhost} disabled={payMut.isPending}>Submit for Review</button>
            </form>
            {payMsg && <p className="mt-2 text-sm text-[var(--dim)]">{payMsg}</p>}
            <p className="mt-3 text-xs text-[var(--muted)]">Payments are never confirmed automatically. Razorpay checkout is not yet connected, and no payment has been verified by a webhook — your status stays at pending verification until an organizer verifies your reference.</p>
          </div>
          <div className={cardCls}>
            <h2 className="font-display text-lg font-semibold">Deadlines</h2>
            <ul className="mt-3 space-y-2 text-sm text-[var(--dim)]">
              <li>Registration closes on <strong className="text-[var(--text)]">{fmtDate(d.settings.registrationDeadline)}</strong></li>
              <li>Round 1 submissions are due on <strong className="text-[var(--text)]">{fmtDate(d.settings.round1Deadline)}</strong></li>
              <li>Round 2 submissions are due on <strong className="text-[var(--text)]">{fmtDate(d.settings.round2Deadline)}</strong></li>
              <li>Finalist showcase — <strong className="text-[var(--text)]">{fmtDate(d.settings.finalistDate)}</strong></li>
            </ul>
            <p className="mt-2 text-xs text-[var(--muted)]">All dates and deadlines are in Indian Standard Time (IST).</p>
          </div>
          <div className={cardCls}>
            <h2 className="font-display text-lg font-semibold">Organizer Announcements</h2>
            {d.announcements.length === 0 ? <p className="mt-2 text-sm text-[var(--dim)]">There are no announcements at present.</p> : (
              <ul className="mt-3 space-y-3">
                {d.announcements.map((a) => (
                  <li key={a.id} className="border-b border-[var(--border)] pb-3 last:border-0">
                    <p className="font-semibold">{a.title}</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--dim)]">{a.body}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">{fmtDateTime(a.createdAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {tab === "round1" && (
        <div className="mt-6 space-y-5">
          <h2 className="font-display text-xl font-semibold">Round 1 Submission</h2>
          <Round1Form key={d.round1 ? "saved" : "new"} session={session} initial={d.round1} deadline={d.settings.round1Deadline} />
          {d.round1 && <p className="text-sm text-[var(--muted)]">Last updated on {fmtDateTime(d.round1.updatedAt)}.</p>}
        </div>
      )}
      {tab === "round2" && (
        <div className="mt-6 space-y-5">
          <h2 className="font-display text-xl font-semibold">Round 2 Submission</h2>
          {!d.team.qualified ? (
            <Notice kind="info">Round 2 is open only to qualified teams. Your team has not yet qualified. Selection results will appear under Results and Schedule once the organizer has run the top-30 selection and published the results.</Notice>
          ) : (
            <>
              <Round2Form key={d.round2 ? "saved" : "new"} session={session} initial={d.round2} deadline={d.settings.round2Deadline} />
              {d.round2 && <p className="text-sm text-[var(--muted)]">Last updated on {fmtDateTime(d.round2.updatedAt)}.</p>}
            </>
          )}
        </div>
      )}
      {tab === "results" && (
        <div className="mt-6 space-y-5">
          <div className={cardCls}>
            <h2 className="font-display text-lg font-semibold">Selection Results</h2>
            {!d.settings.resultsPublished ? (
              <p className="mt-2 text-sm leading-relaxed text-[var(--dim)]">Results have not been published yet. The organizer will run the top-30 selection based on Round 1 scores and then publish the results here.</p>
            ) : d.team.qualified ? (
              <Notice kind="good"><strong className="text-[var(--text)]">Congratulations — your team has qualified for Round 2.</strong> {d.averageScore != null ? `Average weighted Round 1 score: ${d.averageScore.toFixed(2)} / 10, based on ${d.scoreCount} score${d.scoreCount === 1 ? "" : "s"}.` : ""}</Notice>
            ) : (
              <Notice kind="info"><strong className="text-[var(--text)]">Your team was not selected for Round 2 on this occasion.</strong> Thank you for taking part in SPACExPRO. We encourage you to continue developing your idea and to watch for announcements about future events.</Notice>
            )}
          </div>
          <div className={cardCls}>
            <h2 className="font-display text-lg font-semibold">Finalist Schedule</h2>
            {d.team.finalistSlot ? <p className="mt-2 text-sm text-[var(--dim)]">Your finalist slot is: <strong className="text-[var(--text)]">{d.team.finalistSlot}</strong></p> : <p className="mt-2 text-sm text-[var(--dim)]">No finalist slot has been assigned to your team yet. Slots are assigned by the organizer for qualified teams.</p>}
            <p className="mt-2 text-sm text-[var(--dim)]">Finalist showcase date: <strong className="text-[var(--text)]">{fmtDate(d.settings.finalistDate)}</strong></p>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

const FICTIONAL_TEAMS = [
  { name: "Demo Team Aurora", track: "AI/ML", members: 4, score: 8.6, qualified: true },
  { name: "Demo Team Beacon", track: "Cyber Security", members: 3, score: 8.1, qualified: true },
  { name: "Demo Team Comet", track: "Web Development", members: 4, score: 7.4, qualified: false },
  { name: "Demo Team Drift", track: "Student Innovation", members: 2, score: 7.9, qualified: true },
];

function PreviewView({ onDisable }: { onDisable: () => void }) {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <div className="rounded-2xl border-2 border-dashed border-[#FFD700] bg-[#0E0E10] p-5">
        <p className="font-display text-lg font-bold text-[#F5C542]">FICTIONAL PREVIEW — FOR DEVELOPMENT ONLY</p>
        <p className="mt-1 text-sm leading-relaxed text-[#D8CBA6]">Every team, score, and name shown below has been invented for layout preview purposes only. No real records are shown, read, or changed here. Please disable this preview to return to real data.</p>
        <button type="button" className="mt-4 rounded-full bg-[#F5C542] px-5 py-2.5 text-sm font-bold text-[#0A0A0A] shadow-[0_8px_22px_rgba(245,197,66,0.35)]" onClick={onDisable}>Disable Fictional Preview</button>
      </div>
      <h1 className="headline font-display mt-8 text-4xl sm:text-5xl">Preview Dashboard (Fictional Data)</h1>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className={cardCls}><p className="text-sm text-[var(--muted)]">Fictional Teams</p><p className="font-display text-3xl font-bold">4</p></div>
        <div className={cardCls}><p className="text-sm text-[var(--muted)]">Fictional Participants</p><p className="font-display text-3xl font-bold">13</p></div>
        <div className={cardCls}><p className="text-sm text-[var(--muted)]">Fictional Qualified Teams</p><p className="font-display text-3xl font-bold">3</p></div>
      </div>
      <div className="mt-5 space-y-3">
        {FICTIONAL_TEAMS.map((t) => (
          <div key={t.name} className={`${cardCls} flex flex-wrap items-center justify-between gap-3`}>
            <div><p className="font-semibold">{t.name}</p><p className="text-sm text-[var(--dim)]">{t.track} · {t.members} members</p></div>
            <div className="flex items-center gap-3"><span className="text-sm text-[var(--dim)]">Score {t.score.toFixed(1)} / 10</span><Pill text={t.qualified ? "Qualified (Fictional)" : "Not Selected (Fictional)"} tone={t.qualified ? "good" : "neutral"} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OrganizerView({ session, onSession, previewOn, onPreviewToggle }: { session: Session | null; onSession: (s: Session | null) => void; previewOn: boolean; onPreviewToggle: (on: boolean) => void }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"overview" | "teams" | "scoring" | "schedule" | "comms" | "reports" | "settings" | "preview">("overview");
  const [search, setSearch] = useState("");
  const [trackFilter, setTrackFilter] = useState("All");
  const [payFilter, setPayFilter] = useState("All");
  const [msg, setMsg] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const org = useQuery({ queryKey: ["organizer", session?.token], queryFn: () => api.getOrganizerData({ token: session?.token ?? "" }), enabled: Boolean(session?.token && session.role === "organizer"), retry: readRetry, retryDelay: actionRetryDelay });
  // Organizer changes also affect the public pages (settings drive the
  // header registration-count box, the countdown, and the schedule;
  // published results and announcements are public too), so refresh both.
  const refresh = () => { qc.invalidateQueries({ queryKey: ["organizer"] }); qc.invalidateQueries({ queryKey: ["public"] }); };
  const act = <T,>(fn: () => Promise<{ ok: boolean; error?: string } & T>, done?: string) => {
    setMsg("");
    fn().then((r) => { if (!r.ok) setMsg(r.error ?? "This action could not be completed. Please try again."); else { if (done) setMsg(done); refresh(); } }).catch((e) => setMsg(friendlyError(e, "This action could not be completed. Please try again.")));
  };
  if (!session || session.role !== "organizer") {
    return <AuthView role="organizer" session={session} onSession={onSession} goPortal={() => scrollToTop()} />;
  }
  if (org.isPending) return <p className="mx-auto max-w-4xl px-4 py-12 text-[var(--dim)]">Loading organizer data… Please wait.</p>;
  if (org.error || !org.data) {
    const errText = org.error instanceof Error ? org.error.message : "";
    const sessionInvalid = !org.error || /not authorized/i.test(errText);
    if (!sessionInvalid) {
      // A dropped connection is not a failed sign-in: keep the session
      // and offer a retry instead of forcing the organizer out.
      return (
        <div className="mx-auto max-w-xl px-4 py-10 sm:px-6">
          <Notice kind="bad">The connection was interrupted while loading the organizer area. Your session is still saved on this device — please try again.</Notice>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" className={btnPrimary} onClick={() => { void org.refetch(); }} disabled={org.isFetching}>{org.isFetching ? "Reconnecting…" : "Try Again"}</button>
            <button type="button" className={btnGhost} onClick={() => onSession(null)}>Sign In Again</button>
          </div>
        </div>
      );
    }
    return (
      <div className="mx-auto max-w-xl px-4 py-10 sm:px-6">
        <Notice kind="bad">Your organizer session could not be verified. Please sign in again to continue.</Notice>
        <button type="button" className={`${btnGhost} mt-4`} onClick={() => onSession(null)}>Sign In Again</button>
      </div>
    );
  }
  const d: OrgData = org.data;
  const filtered = d.teams.filter((t) => {
    const q = search.trim().toLowerCase();
    const hay = `${t.name} ${t.code} ${t.college} ${t.members.map((m) => `${m.name} ${m.email}`).join(" ")}`.toLowerCase();
    return (!q || hay.includes(q)) && (trackFilter === "All" || t.track === trackFilter) && (payFilter === "All" || t.paymentStatus === payFilter);
  });
  const counts = {
    teams: d.teams.length,
    participants: d.teams.reduce((a, t) => a + t.members.length, 0),
    pendingPay: d.teams.filter((t) => t.paymentStatus === "pending_review").length,
    qualified: d.teams.filter((t) => t.qualified).length,
    round1: d.round1.length, round2: d.round2.length,
    enquiries: d.enquiries.filter((e) => e.status === "new").length,
  };
  const tabs = [["overview", "Overview"], ["teams", "Teams and Payments"], ["scoring", "Scoring and Judges"], ["schedule", "Finalists"], ["comms", "Announcements and Enquiries"], ["reports", "Reports"], ["settings", "Settings"], ["preview", "Preview"]] as const;
  return (
    <div className="view-enter tint-warm mx-auto max-w-6xl px-4 py-14 sm:px-6 md:py-20">
      <Kicker>Organizer — Restricted</Kicker>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="headline font-display text-[clamp(2.4rem,6vw,4rem)]">
            <span className="mask"><span className="mask-line is-in"><LetterFlip text="Organizer Area" /></span></span>
          </h1>
          <p className="mt-1 text-sm text-[var(--dim)]">Signed in as {session.name}. {d.organizers.length} of 3 organizer accounts are currently in use.</p>
        </div>
        <button type="button" className={btnGhost} onClick={() => { if (session) api.signOut({ token: session.token }); onSession(null); }}>Sign Out</button>
      </div>
      <div className="mt-6 flex flex-wrap gap-2" role="tablist" aria-label="Organizer sections">
        {tabs.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`rounded-full border px-4 py-2 text-sm font-semibold ${tab === k ? "border-transparent bg-[linear-gradient(100deg,#AA771C,#FFD700_28%,#F5C542_46%,#FCF6BA_52%,#F2EFE6_58%,#E8A87C_64%,#FFD700_82%,#AA771C)] text-[#0A0A0A] shadow-[0_6px_20px_rgba(245,197,66,0.35)]" : "border-[var(--border)] text-[var(--dim)]"}`}>{label}</button>
        ))}
      </div>
      {msg && <div className="mt-4"><Notice kind={msg.toLowerCase().includes("fail") || msg.toLowerCase().includes("already") || msg.toLowerCase().includes("limited") ? "bad" : "good"}>{msg}</Notice></div>}

      <div key={tab} className="tab-enter">
      {tab === "overview" && (
        <div className="mt-6 space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[["Teams", counts.teams], ["Participants", counts.participants], ["Payments Awaiting Review", counts.pendingPay], ["Qualified Teams", counts.qualified], ["Round 1 Submissions", counts.round1], ["New Enquiries", counts.enquiries]].map(([l, v]) => (
              <div key={l} className={`${cardCls} reveal-rotate tilt`}><p className="text-xs text-[var(--muted)]">{l}</p><p className="font-display mt-1 text-3xl font-bold"><CountUp value={Number(v)} /></p></div>
            ))}
          </div>
          <Notice kind="warn"><strong className="text-[var(--text)]">Awaiting Configuration:</strong> Razorpay keys and the webhook are not yet connected, so payments will remain pending until you verify them here. Emails are sent automatically from the connected SPACExPRO Gmail mailbox (space.x.pro.7@gmail.com) by the delivery agent; a message is marked as sent only after the send has been verified in the mailbox, and a message that cannot be sent is marked failed — it can be sent again with Retry Delivery under Announcements and Enquiries.</Notice>
          <div className={cardCls}>
            <h2 className="font-display text-lg font-semibold">Top Teams by Round 1 Average Score</h2>
            {d.teams.filter((t) => t.averageScore != null).sort((a, b) => (b.averageScore ?? 0) - (a.averageScore ?? 0)).slice(0, 5).map((t, i) => (
              <p key={t.id} className="mt-2 border-b border-[var(--border)] pb-2 text-sm last:border-0">{i + 1}. <strong>{t.name}</strong> — {t.averageScore?.toFixed(2)} / 10 ({t.scoreCount} score{t.scoreCount === 1 ? "" : "s"})</p>
            ))}
            {d.teams.every((t) => t.averageScore == null) && <p className="mt-2 text-sm text-[var(--dim)]">No Round 1 scores have been recorded yet. Please add judges, assign them to teams, and record scores under Scoring and Judges.</p>}
          </div>
          <div className={cardCls}>
            <h2 className="font-display text-lg font-semibold">Organizer Accounts ({d.organizers.length} of 3)</h2>
            <ul className="mt-2 space-y-1 text-sm text-[var(--dim)]">{d.organizers.map((o) => <li key={o.id}>{o.displayName} · {o.email} · {o.role}</li>)}</ul>
            <AddOrganizerForm token={session.token} onDone={refresh} disabled={d.organizers.length >= 3} />
          </div>
        </div>
      )}

      {tab === "teams" && (
        <div className="mt-6 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Search Teams, Members, Colleges, or Codes"><input aria-label="Search teams" className={inputCls} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" /></Field>
            <Field label="Track"><select aria-label="Filter by track" className={inputCls} value={trackFilter} onChange={(e) => setTrackFilter(e.target.value)}><option>All</option>{TRACKS.map((t) => <option key={t.name}>{t.name}</option>)}</select></Field>
            <Field label="Payment Status"><select aria-label="Filter by payment status" className={inputCls} value={payFilter} onChange={(e) => setPayFilter(e.target.value)}><option>All</option><option value="pending_review">Pending Review</option><option value="verified">Verified</option><option value="rejected">Rejected</option></select></Field>
          </div>
          {filtered.length === 0 && <Notice kind="info">No teams match your search. The organizer list starts empty; teams will appear here as participants register.</Notice>}
          {filtered.map((t) => (
            <article key={t.id} className={cardCls}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-lg font-semibold">{t.name} <span className="text-sm font-normal text-[var(--muted)]">· {t.code}</span></h3>
                  <p className="text-sm text-[var(--dim)]">{t.track} · {t.college} · Registered {fmtDateTime(t.createdAt)}</p>
                </div>
                <div className="flex flex-wrap gap-2">{paymentPill(t.paymentStatus)}<Pill text={t.qualified ? "Qualified" : "Not qualified"} tone={t.qualified ? "good" : "neutral"} /><Pill text={`Round 1 ${t.hasRound1 ? "submitted" : "missing"}`} tone={t.hasRound1 ? "good" : "neutral"} /><Pill text={`Round 2 ${t.hasRound2 ? "submitted" : "missing"}`} tone={t.hasRound2 ? "good" : "neutral"} /></div>
              </div>
              <p className="mt-2 text-sm text-[var(--dim)]">Payment Reference: <strong className="text-[var(--text)]">{t.paymentRef ?? "Not provided"}</strong>{t.paymentNote ? ` · Note: ${t.paymentNote}` : ""}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="rounded-full border border-[#FFD700] bg-[#0E0E10] px-4 py-1.5 text-sm font-semibold text-[#F5C542]" onClick={() => act(() => api.verifyPayment({ token: session.token, teamId: t.id, status: "verified" }), "The payment has been marked as verified.")}>Verify Payment</button>
                <button type="button" className="rounded-full border border-[#3A2F16] bg-[#1F0E0E] px-4 py-1.5 text-sm font-semibold text-[#FF8F7D]" onClick={() => act(() => api.verifyPayment({ token: session.token, teamId: t.id, status: "rejected", note: "The payment reference could not be verified." }), "The payment has been marked as rejected.")}>Reject Payment</button>
              </div>
              <ul className="mt-4 space-y-2">
                {t.members.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-2 text-sm">
                    <span><strong>{m.name}</strong> · {m.email} · {m.college} · {m.degree}{m.isLeader ? " · Leader" : ""}</span>
                    {confirmId === `rm-${m.id}` ? (
                      <span className="flex gap-2">
                        <button type="button" className="font-semibold text-[var(--bad)]" onClick={() => { setConfirmId(null); act(() => api.removeParticipant({ token: session.token, participantId: m.id }), "The participant has been removed."); }}>Confirm Removal</button>
                        <button type="button" className="font-semibold" onClick={() => setConfirmId(null)}>Cancel</button>
                      </span>
                    ) : (
                      <button type="button" className="font-semibold text-[var(--bad)]" onClick={() => setConfirmId(`rm-${m.id}`)}>Remove</button>
                    )}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      )}

      {tab === "scoring" && (
        <div className="mt-6 space-y-5">
          <ScoreForm token={session.token} data={d} onDone={refresh} onMsg={setMsg} />
          <div className={cardCls}>
            <h2 className="font-display text-lg font-semibold">Judges and Assignments</h2>
            {d.judges.length === 0 && <p className="mt-2 text-sm text-[var(--dim)]">No judges have been added yet. Please add a judge below.</p>}
            <ul className="mt-3 space-y-2">
              {d.judges.map((j) => {
                const assigned = d.assignments.filter((a) => a.judgeId === j.id);
                return (
                  <li key={j.id} className="border-b border-[var(--border)] pb-2 text-sm last:border-0">
                    <strong>{j.name}</strong> · {j.email} · {j.expertise} — assigned to {assigned.length} team{assigned.length === 1 ? "" : "s"}: {assigned.map((a) => d.teams.find((t) => t.id === a.teamId)?.name ?? "").join(", ") || "none"}
                  </li>
                );
              })}
            </ul>
            <JudgeForms token={session.token} data={d} onDone={refresh} onMsg={setMsg} />
          </div>
          <div className={cardCls}>
            <h2 className="font-display text-lg font-semibold">Top-30 Selection</h2>
            <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">Teams are ranked by their average weighted Round 1 score, using the weights set in Settings, and the top 30 teams are marked as qualified. Teams without scores will not be selected.</p>
            <div className="mt-3 flex flex-wrap gap-3">
              <button type="button" className={btnPrimary} onClick={() => act(async () => { const r = await api.runTop30Selection({ token: session.token }); return { ok: r.ok, error: r.error, qualifiedCount: r.qualifiedCount }; }, "The top-30 selection has been completed.")}>Run Top-30 Selection</button>
              <button type="button" className={btnGhost} onClick={() => act(() => api.publishResults({ token: session.token, published: !d.settings.resultsPublished }), d.settings.resultsPublished ? "The results have been hidden." : "The results have been published to participants.")}>{d.settings.resultsPublished ? "Hide Results" : "Publish Results"}</button>
            </div>
            <p className="mt-2 text-sm text-[var(--dim)]">Results are currently: <strong className="text-[var(--text)]">{d.settings.resultsPublished ? "published" : "not published"}</strong> · {counts.qualified} qualified team{counts.qualified === 1 ? "" : "s"}.</p>
          </div>
          <div className={cardCls}>
            <h2 className="font-display text-lg font-semibold">Recorded Scores</h2>
            {d.scores.length === 0 ? <p className="mt-2 text-sm text-[var(--dim)]">No scores have been recorded yet.</p> : (
              <ul className="mt-2 space-y-2 text-sm">
                {d.scores.map((sc) => (
                  <li key={sc.id} className="border-b border-[var(--border)] pb-2 last:border-0">{d.teams.find((t) => t.id === sc.teamId)?.name} · Round {sc.round} · {d.judges.find((j) => j.id === sc.judgeId)?.name} — Innovation {sc.innovation}, Technical {sc.technical}, Impact {sc.impact}, Presentation {sc.presentation}{sc.notes ? ` · ${sc.notes}` : ""}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {tab === "schedule" && (
        <div className="mt-6 space-y-4">
          <Notice kind="info">Finalist showcase date: {fmtDate(d.settings.finalistDate)} (set in Settings). Please assign a slot to each qualified team below.</Notice>
          {d.teams.filter((t) => t.qualified).length === 0 && <Notice kind="info">No teams have qualified yet. Please run the top-30 selection first.</Notice>}
          {d.teams.filter((t) => t.qualified).map((t) => (
            <SlotForm key={t.id} token={session.token} team={t} onDone={refresh} />
          ))}
        </div>
      )}

      {tab === "comms" && (
        <div className="mt-6 space-y-5">
          <AnnouncementForm token={session.token} onDone={refresh} onMsg={setMsg} />
          <div className={cardCls}>
            <h2 className="font-display text-lg font-semibold">Announcements</h2>
            {d.announcements.length === 0 && <p className="mt-2 text-sm text-[var(--dim)]">There are no announcements at present.</p>}
            <ul className="mt-3 space-y-3">
              {d.announcements.map((a) => (
                <li key={a.id} className="border-b border-[var(--border)] pb-3 last:border-0">
                  <p className="font-semibold">{a.title} <span className="text-xs font-normal text-[var(--muted)]">· {a.audience} · {fmtDateTime(a.createdAt)}</span></p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--dim)]">{a.body}</p>
                  {confirmId === `del-${a.id}` ? (
                    <span className="mt-2 flex gap-3 text-sm"><button type="button" className="font-semibold text-[var(--bad)]" onClick={() => { setConfirmId(null); act(() => api.deleteAnnouncement({ token: session.token, id: a.id }), "The announcement has been deleted."); }}>Confirm Deletion</button><button type="button" className="font-semibold" onClick={() => setConfirmId(null)}>Cancel</button></span>
                  ) : (
                    <button type="button" className="mt-2 text-sm font-semibold text-[var(--bad)]" onClick={() => setConfirmId(`del-${a.id}`)}>Delete</button>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <div className={cardCls}>
            <h2 className="font-display text-lg font-semibold">Enquiries ({d.enquiries.length})</h2>
            {d.enquiries.length === 0 && <p className="mt-2 text-sm text-[var(--dim)]">No enquiries have been received yet. Submissions from the home page will appear here, and a copy of each is queued and sent automatically to {d.settings.contactEmail}.</p>}
            <ul className="mt-3 space-y-3">
              {d.enquiries.map((e) => (
                <li key={e.id} className="border-b border-[var(--border)] pb-3 text-sm last:border-0">
                  <p><strong>{e.name}</strong> · {e.email} · {fmtDateTime(e.createdAt)} · <Pill text={e.status} tone={e.status === "new" ? "warn" : "neutral"} /></p>
                  <p className="mt-1 whitespace-pre-wrap text-[var(--dim)]">{e.message}</p>
                  <span className="mt-2 flex gap-3">
                    <button type="button" className="font-semibold text-[var(--accent2)]" onClick={() => act(() => api.updateEnquiryStatus({ token: session.token, id: e.id, status: "read" }), "The enquiry has been marked as read.")}>Mark as Read</button>
                    <button type="button" className="font-semibold text-[var(--accent2)]" onClick={() => act(() => api.updateEnquiryStatus({ token: session.token, id: e.id, status: "replied" }), "The enquiry has been marked as replied.")}>Mark as Replied</button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className={cardCls}>
            <h2 className="font-display text-lg font-semibold">Email Outbox</h2>
            <p className="mt-1 text-sm text-[var(--dim)]">Messages are sent automatically from the connected SPACExPRO Gmail mailbox (space.x.pro.7@gmail.com). A message is marked as sent only after the send has been verified in the mailbox. Pending or failed messages can be sent again using Retry Delivery.</p>
            <ul className="mt-3 space-y-2 text-sm">
              {d.outbox.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-2 last:border-0">
                  <span>To {o.recipient} · {o.subject} · {o.kind} · <Pill text={o.status} tone={o.status === "sent" ? "good" : "warn"} /></span>
                  {o.status !== "sent" && <button type="button" className="font-semibold text-[var(--accent2)]" onClick={() => act(() => api.retryEmailDelivery({ token: session.token, id: o.id }), "Delivery has been retried. The message has been queued again for delivery.")}>Retry Delivery</button>}
                </li>
              ))}
              {d.outbox.length === 0 && <li className="text-[var(--dim)]">The outbox is currently empty.</li>}
            </ul>
          </div>
        </div>
      )}

      {tab === "reports" && (
        <div className="mt-6 space-y-5">
          <div className={cardCls}>
            <h2 className="font-display text-lg font-semibold">Reports</h2>
            <p className="mt-1 text-sm text-[var(--dim)]">Downloads are generated from the live database records shown in this area.</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="button" className={btnPrimary} onClick={() => {
                const header = "team,code,track,college,members,payment_status,payment_ref,qualified,round1_average,has_round1,has_round2,finalist_slot\n";
                const rows = d.teams.map((t) => [t.name, t.code, t.track, t.college, t.memberCount, t.paymentStatus, t.paymentRef, t.qualified ? "yes" : "no", t.averageScore?.toFixed(2) ?? "", t.hasRound1 ? "yes" : "no", t.hasRound2 ? "yes" : "no", t.finalistSlot].map(csvCell).join(",")).join("\n");
                downloadCsv("spacexpro-teams-report.csv", header + rows);
              }}>Download Teams Report (CSV)</button>
              <button type="button" className={btnGhost} onClick={() => {
                const header = "name,email,college,degree,track,team,team_code,leader\n";
                const rows = d.teams.flatMap((t) => t.members.map((m) => [m.name, m.email, m.college, m.degree, m.track, t.name, t.code, m.isLeader ? "yes" : "no"].map(csvCell).join(","))).join("\n");
                downloadCsv("spacexpro-participants-report.csv", header + rows);
              }}>Download Participants Report (CSV)</button>
              <button type="button" className={btnGhost} onClick={() => {
                const header = "name,email,message,status,created_at\n";
                const rows = d.enquiries.map((e) => [e.name, e.email, e.message, e.status, e.createdAt].map(csvCell).join(",")).join("\n");
                downloadCsv("spacexpro-enquiries-report.csv", header + rows);
              }}>Download Enquiries Report (CSV)</button>
            </div>
          </div>
          <div className={cardCls}>
            <h2 className="font-display text-lg font-semibold">Counts by Track</h2>
            <ul className="mt-2 space-y-1 text-sm text-[var(--dim)]">
              {TRACKS.map((t) => {
                const teams = d.teams.filter((x) => x.track === t.name);
                return <li key={t.name}>{t.name}: {teams.length} teams, {teams.reduce((a, x) => a + x.members.length, 0)} participants</li>;
              })}
            </ul>
          </div>
        </div>
      )}

      {tab === "settings" && <SettingsForm token={session.token} data={d} onDone={refresh} onMsg={setMsg} />}

      {tab === "preview" && (
        <div className="mt-6 space-y-5">
          <div className={cardCls}>
            <h2 className="font-display text-lg font-semibold">Development-Only Preview</h2>
            <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">The preview shows clearly labelled fictional data and never reads or changes real records. Enable it to inspect the layout using sample teams, and disable it to return to real data.</p>
            <p className="mt-2 text-sm">Preview is currently: <strong className="text-[var(--text)]">{previewOn ? "Enabled (Fictional Data)" : "Disabled"}</strong></p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="button" className={btnPrimary} onClick={() => onPreviewToggle(true)}>Enable Fictional Preview</button>
              <button type="button" className={btnGhost} onClick={() => onPreviewToggle(false)}>Disable Fictional Preview</button>
            </div>
            {previewOn && <p className="mt-3 text-sm text-[var(--accent2)]">Preview is enabled. Please use the Preview page in the navigation to view the fictional dashboard.</p>}
          </div>
          <Notice kind="warn"><strong className="text-[var(--text)]">Integration Status:</strong> Razorpay — not connected (no keys, no webhook). Email — connected: messages are sent automatically from the owner's Gmail mailbox (space.x.pro.7@gmail.com) by the delivery agent, and a message is marked as sent only after the send has been verified in the mailbox. Database — this platform uses its own database; no separate external database connection is configured.</Notice>
        </div>
      )}
      </div>
    </div>
  );
}

function AddOrganizerForm({ token, onDone, disabled }: { token: string; onDone: () => void; disabled: boolean }) {
  const [f, setF] = useState({ email: "", password: "", displayName: "" });
  const [err, setErr] = useState("");
  const mut = useMutation({
    mutationFn: () => api.addOrganizer({ token, ...f }),
    onSuccess: (r) => { if (!r.ok) setErr(r.error ?? "The organizer could not be added. Please try again."); else { setF({ email: "", password: "", displayName: "" }); onDone(); } },
    onError: (e) => setErr(friendlyError(e, "The organizer could not be added. Please try again.")),
  });
  if (disabled) return <p className="mt-3 text-sm text-[var(--muted)]">The limit of three organizer accounts has been reached.</p>;
  return (
    <form className="mt-4 grid gap-3 sm:grid-cols-3" onSubmit={(e: FormEvent) => { e.preventDefault(); setErr(""); mut.mutate(); }}>
      <Field label="Display name"><input aria-label="New organizer display name" className={inputCls} value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} required /></Field>
      <Field label="Email"><input aria-label="New organizer email" type="email" className={inputCls} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></Field>
      <Field label="Password"><input aria-label="New organizer password" type="password" className={inputCls} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required minLength={8} autoComplete="new-password" /></Field>
      {err && <p className="text-sm text-[var(--bad)] sm:col-span-3">{err}</p>}
      <div className="sm:col-span-3"><button type="submit" className={btnGhost} disabled={mut.isPending}>Add Approved Organizer</button></div>
    </form>
  );
}

function SettingsForm({ token, data, onDone, onMsg }: { token: string; data: OrgData; onDone: () => void; onMsg: (m: string) => void }) {
  const s = data.settings;
  const [f, setF] = useState({ eventStart: s.eventStart, registrationDeadline: s.registrationDeadline, round1Deadline: s.round1Deadline, round2Deadline: s.round2Deadline, finalistDate: s.finalistDate, minTeamSize: s.minTeamSize, maxTeamSize: s.maxTeamSize, weightInnovation: s.weightInnovation, weightTechnical: s.weightTechnical, weightImpact: s.weightImpact, weightPresentation: s.weightPresentation, contactEmail: s.contactEmail });
  const [whatsappDigits, setWhatsappDigits] = useState(() => (s.whatsappNumber ?? "").replace(/\D/g, "").replace(/^91(?=\d{10}$)/, ""));
  const [feeStr, setFeeStr] = useState(() => (s.registrationFeeInr != null ? String(s.registrationFeeInr) : ""));
  const [regCountStr, setRegCountStr] = useState(() => (s.registrationCountOverride != null ? String(s.registrationCountOverride) : ""));
  const [localErr, setLocalErr] = useState("");
  const mut = useMutation({
    mutationFn: () => api.updateSettings({ token, ...f, whatsappNumber: whatsappDigits === "" ? "" : `+91${whatsappDigits}`, registrationFeeInr: feeStr.trim() === "" ? null : Number(feeStr), registrationCountOverride: regCountStr.trim() === "" ? null : Number(regCountStr) }),
    onSuccess: (r) => { if (!r.ok) onMsg(r.error ?? "Your submission could not be saved. Please try again."); else { onMsg("Your settings have been saved. The home page countdown and schedule now use these dates."); onDone(); } },
    onError: (e) => onMsg(friendlyError(e, "Your settings could not be saved. Please try again.")),
  });
  const set = (k: keyof typeof f, v: string | number) => setF({ ...f, [k]: v });
  const total = f.weightInnovation + f.weightTechnical + f.weightImpact + f.weightPresentation;
  return (
    <form className="mt-6 space-y-5" onSubmit={(e: FormEvent) => { e.preventDefault(); if (whatsappDigits !== "" && !INDIAN_MOBILE_RE.test(whatsappDigits)) { setLocalErr(`WhatsApp support number: ${INDIAN_MOBILE_ERROR}`); return; } if (feeStr.trim() !== "" && (!/^\d+$/.test(feeStr.trim()) || Number(feeStr) < 0)) { setLocalErr("Please enter the registration fee as a whole number of rupees (₹), or leave it blank."); return; } if (regCountStr.trim() !== "" && (!/^\d+$/.test(regCountStr.trim()) || Number(regCountStr) < 0)) { setLocalErr("Registration count (display override) must be a whole number of 0 or more, or left blank to show the live count."); return; } setLocalErr(""); mut.mutate(); }}>
      <div className={cardCls}>
        <h2 className="font-display text-lg font-semibold">Event Dates</h2>
        <p className="mt-1 text-sm text-[var(--dim)]">The countdown and schedule use these values. If you change a date here, the public pages will reflect the updated date.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Event Start Date"><input aria-label="Event Start Date" type="date" className={inputCls} value={f.eventStart} onChange={(e) => set("eventStart", e.target.value)} required /></Field>
          <Field label="Registration Deadline"><input aria-label="Registration Deadline" type="date" className={inputCls} value={f.registrationDeadline} onChange={(e) => set("registrationDeadline", e.target.value)} required /></Field>
          <Field label="Round 1 Deadline"><input aria-label="Round 1 Deadline" type="date" className={inputCls} value={f.round1Deadline} onChange={(e) => set("round1Deadline", e.target.value)} required /></Field>
          <Field label="Round 2 Deadline"><input aria-label="Round 2 Deadline" type="date" className={inputCls} value={f.round2Deadline} onChange={(e) => set("round2Deadline", e.target.value)} required /></Field>
          <Field label="Finalist Showcase Date"><input aria-label="Finalist Showcase Date" type="date" className={inputCls} value={f.finalistDate} onChange={(e) => set("finalistDate", e.target.value)} required /></Field>
          <Field label="Contact Email"><input aria-label="Contact Email" type="email" className={inputCls} value={f.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} required /></Field>
        </div>
      </div>
      <div className={cardCls}>
        <h2 className="font-display text-lg font-semibold">India — Payments &amp; Support</h2>
        <p className="mt-1 text-sm text-[var(--dim)]">Amounts are in Indian Rupees (₹, INR). The WhatsApp support number is optional: leave it blank and no WhatsApp link is shown anywhere on the site.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Registration Fee per Team (₹)" hint="Whole rupees, e.g. 499. Leave blank if no fee has been set — no amount is shown until you set one.">
            <span className="flex overflow-hidden rounded-md border border-[var(--border)] bg-[#0A0A0B] shadow-[0_1px_2px_rgba(0,0,0,0.45)] transition-colors focus-within:border-[var(--accent2)]">
              <span aria-hidden="true" className="flex items-center border-r border-[var(--border)] px-3 text-[15px] font-semibold text-[var(--dim)]">₹</span>
              <input aria-label="Registration Fee per Team in Rupees" type="text" inputMode="numeric" className="w-full bg-transparent px-3.5 py-3 text-[15px] text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none" value={feeStr} onChange={(e) => setFeeStr(e.target.value.replace(/[^\d]/g, "").slice(0, 8))} placeholder="Not set" />
            </span>
          </Field>
          <Field label="WhatsApp Support Number (Optional)" hint="Indian mobile number. When set, a “Chat on WhatsApp” link appears in the contact section and footer.">
            <span className="flex overflow-hidden rounded-md border border-[var(--border)] bg-[#0A0A0B] shadow-[0_1px_2px_rgba(0,0,0,0.45)] transition-colors focus-within:border-[var(--accent2)]">
              <span aria-hidden="true" className="flex items-center border-r border-[var(--border)] px-3 text-[15px] font-semibold text-[var(--dim)]">+91</span>
              <input aria-label="WhatsApp Support Number" type="tel" inputMode="numeric" className="w-full bg-transparent px-3.5 py-3 text-[15px] text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none" value={whatsappDigits} onChange={(e) => setWhatsappDigits(e.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="Not set" />
            </span>
          </Field>
        </div>
        {feeStr.trim() !== "" && /^\d+$/.test(feeStr.trim()) && <p className="mt-3 text-sm text-[var(--dim)]">This will be shown to participants as <strong className="text-[var(--text)]">{fmtINR(Number(feeStr))} (INR)</strong> per team.</p>}
        {localErr && <div className="mt-3"><Notice kind="bad">{localErr}</Notice></div>}
      </div>
      <div className={cardCls}>
        <h2 className="font-display text-lg font-semibold">Registration Count — Display Box</h2>
        <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">This controls the small registration count box shown below Sign In in the header on public pages. By default it shows the live count from the database. Set an override only if you want the box to show a different number; clear the field to return to the live count.</p>
        <p className="mt-3 text-sm text-[var(--dim)]">Live count right now: <strong className="text-[var(--text)]">{data.teams.length} {data.teams.length === 1 ? "team" : "teams"} registered</strong>{s.registrationCountOverride != null ? <> · Current override: <strong className="text-[var(--text)]">{s.registrationCountOverride}</strong></> : <> · No override set — the box is showing the live count.</>}</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Registration count (display override)" hint="Whole number, 0 or more. Leave blank to show the live database count automatically.">
            <input aria-label="Registration count display override" type="text" inputMode="numeric" className={inputCls} value={regCountStr} onChange={(e) => setRegCountStr(e.target.value.replace(/[^\d]/g, "").slice(0, 7))} placeholder="Live count (blank)" />
          </Field>
          <div className="flex items-end">
            <div role="status" aria-label="Preview of registration count box" className="inline-flex items-center gap-2 rounded-lg border border-[rgba(255,215,0,0.55)] bg-[#070708] px-3 py-2 shadow-[0_8px_20px_rgba(0,0,0,0.35)]">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#FFD700]" />
              <span className="font-letter text-[10px] font-bold uppercase tracking-[0.18em] text-[#D8CBA6]">Registrations</span>
              <span className="font-display text-[15px] font-extrabold leading-none text-[#FFD700]">{regCountStr.trim() !== "" ? regCountStr : data.teams.length}</span>
              <span className="text-[11px] text-[var(--dim)]">{(regCountStr.trim() !== "" ? Number(regCountStr) : data.teams.length) === 1 ? "team registered" : "teams registered"}</span>
            </div>
          </div>
        </div>
        {regCountStr.trim() !== "" && /^\d+$/.test(regCountStr.trim()) && <p className="mt-3 text-sm text-[var(--dim)]">While this override is set, the header box will show <strong className="text-[var(--text)]">{Number(regCountStr)} {Number(regCountStr) === 1 ? "team" : "teams"} registered</strong> instead of the live count.</p>}
      </div>
      <div className={cardCls}>
        <h2 className="font-display text-lg font-semibold">Team Sizes</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Minimum Team Size"><input aria-label="Minimum Team Size" type="number" min={1} max={10} className={inputCls} value={f.minTeamSize} onChange={(e) => set("minTeamSize", Number(e.target.value))} required /></Field>
          <Field label="Maximum Team Size"><input aria-label="Maximum Team Size" type="number" min={1} max={10} className={inputCls} value={f.maxTeamSize} onChange={(e) => set("maxTeamSize", Number(e.target.value))} required /></Field>
        </div>
      </div>
      <div className={cardCls}>
        <h2 className="font-display text-lg font-semibold">Scoring Weights (Must Total 100% — Currently {total}%)</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-4">
          <Field label="Innovation %"><input aria-label="Innovation weight percent" type="number" min={0} max={100} className={inputCls} value={f.weightInnovation} onChange={(e) => set("weightInnovation", Number(e.target.value))} required /></Field>
          <Field label="Technical %"><input aria-label="Technical weight percent" type="number" min={0} max={100} className={inputCls} value={f.weightTechnical} onChange={(e) => set("weightTechnical", Number(e.target.value))} required /></Field>
          <Field label="Impact %"><input aria-label="Impact weight percent" type="number" min={0} max={100} className={inputCls} value={f.weightImpact} onChange={(e) => set("weightImpact", Number(e.target.value))} required /></Field>
          <Field label="Presentation %"><input aria-label="Presentation weight percent" type="number" min={0} max={100} className={inputCls} value={f.weightPresentation} onChange={(e) => set("weightPresentation", Number(e.target.value))} required /></Field>
        </div>
      </div>
      <button type="submit" className={btnPrimary} disabled={mut.isPending}>{mut.isPending ? "Saving…" : "Save Settings"}</button>
    </form>
  );
}

function ScoreForm({ token, data, onDone, onMsg }: { token: string; data: OrgData; onDone: () => void; onMsg: (m: string) => void }) {
  const [teamId, setTeamId] = useState(data.teams[0]?.id ?? 0);
  const [judgeId, setJudgeId] = useState(data.judges[0]?.id ?? 0);
  const [round, setRound] = useState(1);
  const [sc, setSc] = useState({ innovation: 7, technical: 7, impact: 7, presentation: 7 });
  const [notes, setNotes] = useState("");
  const mut = useMutation({
    mutationFn: () => api.submitScore({ token, judgeId, teamId, round, ...sc, notes: notes || undefined }),
    onSuccess: (r) => { if (!r.ok) onMsg(r.error ?? "The score could not be recorded. Please try again."); else { onMsg("The score has been recorded. Submitting a score again for the same judge, team, and round will update it."); onDone(); } },
    onError: (e) => onMsg(friendlyError(e, "The score could not be recorded. Please try again.")),
  });
  if (data.teams.length === 0 || data.judges.length === 0) return <div className={cardCls}><h2 className="font-display text-lg font-semibold">Weighted Scoring</h2><p className="mt-2 text-sm text-[var(--dim)]">Please add at least one team through registration and at least one judge before recording scores. Scores range from 0 to 10 for each criterion and are weighted using the weights set in Settings.</p></div>;
  return (
    <form className={cardCls} onSubmit={(e: FormEvent) => { e.preventDefault(); mut.mutate(); }}>
      <h2 className="font-display text-lg font-semibold">Weighted Scoring</h2>
      <p className="mt-1 text-sm text-[var(--dim)]">Scoring weights: Innovation {data.settings.weightInnovation}% · Technical {data.settings.weightTechnical}% · Impact {data.settings.weightImpact}% · Presentation {data.settings.weightPresentation}%.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Field label="Team"><select aria-label="Scored team" className={inputCls} value={teamId} onChange={(e) => setTeamId(Number(e.target.value))}>{data.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
        <Field label="Judge"><select aria-label="Scoring judge" className={inputCls} value={judgeId} onChange={(e) => setJudgeId(Number(e.target.value))}>{data.judges.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}</select></Field>
        <Field label="Round"><select aria-label="Scoring round" className={inputCls} value={round} onChange={(e) => setRound(Number(e.target.value))}><option value={1}>Round 1</option><option value={2}>Round 2</option></select></Field>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {(["innovation", "technical", "impact", "presentation"] as const).map((k) => (
          <Field key={k} label={`${k[0]?.toUpperCase()}${k.slice(1)} (0–10)`}><input aria-label={`${k} score`} type="number" min={0} max={10} className={inputCls} value={sc[k]} onChange={(e) => setSc({ ...sc, [k]: Number(e.target.value) })} required /></Field>
        ))}
      </div>
      <div className="mt-4"><Field label="Judge Notes"><input aria-label="Judge Notes" className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field></div>
      <button type="submit" className={`${btnPrimary} mt-4`} disabled={mut.isPending}>Record Score</button>
    </form>
  );
}

function JudgeForms({ token, data, onDone, onMsg }: { token: string; data: OrgData; onDone: () => void; onMsg: (m: string) => void }) {
  const [judge, setJudge] = useState({ name: "", email: "", expertise: "" });
  const [assign, setAssign] = useState({ judgeId: data.judges[0]?.id ?? 0, teamId: data.teams[0]?.id ?? 0 });
  const addMut = useMutation({
    mutationFn: () => api.createJudge({ token, ...judge }),
    onSuccess: (r) => { if (!r.ok) onMsg(r.error ?? "The judge could not be added. Please try again."); else { setJudge({ name: "", email: "", expertise: "" }); onMsg("The judge has been added."); onDone(); } },
    onError: (e) => onMsg(friendlyError(e, "The judge could not be added. Please try again.")),
  });
  const assignMut = useMutation({
    mutationFn: () => api.assignJudge({ token, ...assign }),
    onSuccess: (r) => { if (!r.ok) onMsg(r.error ?? "The judge could not be assigned. Please try again."); else { onMsg("The judge has been assigned."); onDone(); } },
    onError: (e) => onMsg(friendlyError(e, "The judge could not be assigned. Please try again.")),
  });
  return (
    <div className="mt-5 grid gap-5 md:grid-cols-2">
      <form className="space-y-3" onSubmit={(e: FormEvent) => { e.preventDefault(); addMut.mutate(); }}>
        <h3 className="font-semibold">Add Judge</h3>
        <Field label="Name"><input aria-label="Judge name" className={inputCls} value={judge.name} onChange={(e) => setJudge({ ...judge, name: e.target.value })} required /></Field>
        <Field label="Email"><input aria-label="Judge email" type="email" className={inputCls} value={judge.email} onChange={(e) => setJudge({ ...judge, email: e.target.value })} required /></Field>
        <Field label="Expertise"><input aria-label="Judge expertise" className={inputCls} value={judge.expertise} onChange={(e) => setJudge({ ...judge, expertise: e.target.value })} required /></Field>
        <button type="submit" className={btnGhost} disabled={addMut.isPending}>Add Judge</button>
      </form>
      <form className="space-y-3" onSubmit={(e: FormEvent) => { e.preventDefault(); assignMut.mutate(); }}>
        <h3 className="font-semibold">Assign a Judge to a Team</h3>
        <Field label="Judge"><select aria-label="Judge to assign" className={inputCls} value={assign.judgeId} onChange={(e) => setAssign({ ...assign, judgeId: Number(e.target.value) })}>{data.judges.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}</select></Field>
        <Field label="Team"><select aria-label="Team to assign judge to" className={inputCls} value={assign.teamId} onChange={(e) => setAssign({ ...assign, teamId: Number(e.target.value) })}>{data.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
        <button type="submit" className={btnGhost} disabled={assignMut.isPending || data.judges.length === 0 || data.teams.length === 0}>Assign Judge</button>
      </form>
    </div>
  );
}

function AnnouncementForm({ token, onDone, onMsg }: { token: string; onDone: () => void; onMsg: (m: string) => void }) {
  const [f, setF] = useState({ title: "", body: "", audience: "all" as "all" | "teams" | "finalists" });
  const mut = useMutation({
    mutationFn: () => api.createAnnouncement({ token, ...f }),
    onSuccess: (r) => { if (!r.ok) onMsg(r.error ?? "The announcement could not be posted. Please try again."); else { setF({ title: "", body: "", audience: "all" }); onMsg("The announcement has been posted."); onDone(); } },
    onError: (e) => onMsg(friendlyError(e, "The announcement could not be posted. Please try again.")),
  });
  return (
    <form className={cardCls} onSubmit={(e: FormEvent) => { e.preventDefault(); mut.mutate(); }}>
      <h2 className="font-display text-lg font-semibold">Post Announcement</h2>
      <div className="mt-4 space-y-4">
        <Field label="Title"><input aria-label="Announcement title" className={inputCls} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required /></Field>
        <Field label="Message"><textarea aria-label="Announcement message" className={`${inputCls} min-h-[90px]`} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} required /></Field>
        <Field label="Audience"><select aria-label="Announcement audience" className={inputCls} value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value as typeof f.audience })}><option value="all">Everyone (public + teams)</option><option value="teams">Registered teams</option><option value="finalists">Finalists / qualified teams</option></select></Field>
      </div>
      <button type="submit" className={`${btnPrimary} mt-4`} disabled={mut.isPending}>Post Announcement</button>
    </form>
  );
}

function SlotForm({ token, team, onDone }: { token: string; team: OrgData["teams"][number]; onDone: () => void }) {
  const [slot, setSlot] = useState(team.finalistSlot ?? "");
  const [msg, setMsg] = useState("");
  const mut = useMutation({
    mutationFn: () => api.setFinalistSlot({ token, teamId: team.id, slot }),
    onSuccess: (r) => { if (!r.ok) setMsg(r.error ?? "Your submission could not be saved. Please try again."); else { setMsg("The finalist slot has been saved."); onDone(); } },
    onError: (e) => setMsg(friendlyError(e, "The finalist slot could not be saved. Please try again.")),
  });
  return (
    <form className={cardCls} onSubmit={(e: FormEvent) => { e.preventDefault(); mut.mutate(); }}>
      <h3 className="font-semibold">{team.name} <span className="text-sm font-normal text-[var(--muted)]">· {team.track}</span></h3>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <Field label="Finalist Slot (Date, Time, Room, or Link)"><input aria-label={`Finalist slot for ${team.name}`} className={inputCls} value={slot} onChange={(e) => setSlot(e.target.value)} placeholder="e.g. 9 Dec, 10:30 AM, Hall A" /></Field>
        <button type="submit" className={btnGhost} disabled={mut.isPending}>Save Slot</button>
        {msg && <span className="text-sm text-[var(--dim)]">{msg}</span>}
      </div>
    </form>
  );
}

export function App() {
  const [view, setView] = useState<View>("home");
  const viewRef = useRef<View>("home");
  viewRef.current = view;
  const [menuOpen, setMenuOpen] = useState(false);
  const [session, setSession] = useState<Session | null>(loadSession);
  const [previewOn, setPreviewOn] = useState(() => { try { return localStorage.getItem("orbitx_preview") === "on"; } catch { return false; } });
  const [booted, setBooted] = useState(false);
  const [transition, setTransition] = useState<{ phase: "idle" | "cover" | "reveal"; label: string }>({ phase: "idle", label: "" });
  const transitionRef = useRef(false);
  const qc = useQueryClient();
  const pub = useQuery({ queryKey: ["public"], queryFn: () => api.getPublic({}), retry: readRetry, retryDelay: actionRetryDelay });
  // When the device comes back online, immediately re-check anything
  // that failed while the connection was down.
  useEffect(() => {
    const onOnline = () => { void qc.refetchQueries(); };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [qc]);
  // The navigation menu is a modal dialog: Escape must dismiss it, like
  // its close buttons do.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);
  useRevealArmed();
  useScrollTelemetry();
  useKeyboardScroll();
  useTiltDelegation();
  useParallax();
  const go = (v: View) => {
    // Keep the address bar in step with the organizer route (without
    // firing a hashchange): opening the organizer sets #organizer so a
    // reload returns here, and leaving it clears a stale #organizer so a
    // later reload does not reopen the organizer area unprompted.
    try {
      if (v === "organizer") history.replaceState(null, "", "#organizer");
      else if (window.location.hash) {
        const raw = window.location.hash.replace(/^#\/?/, "").split(/[/?#]/)[0]?.trim().toLowerCase() ?? "";
        if (raw === "organizer" || raw === "organizeer") history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    } catch { /* history unavailable */ }
    // Compare against viewRef, not the `view` state: the hashchange handler
    // below captures the first render's `go`, whose `view` would be stale
    // ("home") forever, so a same-view check against it could never match.
    if (v === viewRef.current) { setMenuOpen(false); scrollToTop(); return; }
    if (reducedMotion() || transitionRef.current) {
      setView(v); setMenuOpen(false); scrollToTop(); return;
    }
    transitionRef.current = true;
    const label = v === "home" ? "SPACExPRO" : v === "register" ? "Register" : v === "portal" ? "Team Portal" : v === "organizer" ? "Organizer" : "Preview";
    setMenuOpen(false);
    setTransition({ phase: "cover", label });
    setTimeout(() => {
      setView(v);
      scrollToTop();
      setTransition({ phase: "reveal", label });
      setTimeout(() => {
        setTransition({ phase: "idle", label: "" });
        transitionRef.current = false;
      }, 520);
    }, 520);
  };
  // The organizer area is not linked from the header or menu. It opens
  // in-page from the discreet footer "Organizer sign-in" link and from the
  // Team Portal sign-in ("Are you an organizer?"), so it works inside the
  // Muse app too — there is no address bar there, and an #organizer suffix
  // added to the outer Muse URL never reaches this page's own address.
  // The unadvertised #organizer route still works in a browser tab: the
  // route is honoured on every hash change, not only on first load, because
  // appending #organizer to an already-open page only fires `hashchange`
  // (the browser does not reload). The match is normalised (#/organizer,
  // trailing slash, casing, and the common #organizeer spelling), and
  // ?organizer works too for links that strip the hash.
  useEffect(() => {
    const openFromUrl = () => {
      const raw = window.location.hash.replace(/^#\/?/, "").split(/[/?#]/)[0]?.trim().toLowerCase() ?? "";
      const viaQuery = new URLSearchParams(window.location.search).has("organizer");
      if ((raw === "organizer" || raw === "organizeer" || viaQuery) && viewRef.current !== "organizer") go("organizer");
    };
    openFromUrl();
    window.addEventListener("hashchange", openFromUrl);
    return () => window.removeEventListener("hashchange", openFromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const setSessionAndStore = (s: Session | null) => {
    setSession(s);
    try { if (s) localStorage.setItem("orbitx_session", JSON.stringify(s)); else localStorage.removeItem("orbitx_session"); } catch { /* storage unavailable */ }
  };
  const togglePreview = (on: boolean) => {
    setPreviewOn(on);
    try { localStorage.setItem("orbitx_preview", on ? "on" : "off"); } catch { /* ignore */ }
    if (on) go("preview");
  };
  const signOut = () => {
    if (session) void api.signOut({ token: session.token }).catch(() => undefined);
    setSessionAndStore(null);
    // Drop the signed-in queries outright instead of invalidating them:
    // a refetch with the just-ended session fails authorization on the
    // server and surfaces as a 500 console error during sign-out.
    qc.removeQueries({ queryKey: ["portal"] });
    qc.removeQueries({ queryKey: ["organizer"] });
    qc.invalidateQueries({ queryKey: ["public"] });
    go("home");
  };
  const nav: { id: View; label: string }[] = [
    { id: "home", label: "Home" },
    { id: "register", label: "Register" },
    { id: "portal", label: "Team Portal" },
  ];
  const data = pub.data;
  return (
    <div className="relative min-h-screen text-[var(--text)]">
      <Preloader onBooted={() => setBooted(true)} />
      <CustomCursor />
      <Ambience />
      <ScrollProgress />
      <TransitionOverlay phase={transition.phase} label={transition.label} />
      <div className="relative z-10">
      <header className="sticky top-3 z-40 px-3 pt-safe sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 rounded-full border border-[rgba(255,215,0,0.95)] bg-[linear-gradient(100deg,rgba(5,5,6,0.94),rgba(8,8,9,0.90))] py-2 pl-5 pr-2 shadow-[0_12px_36px_rgba(0,0,0,0.12),0_0_26px_rgba(245,197,66,0.30)] backdrop-blur-md">
          <button type="button" onClick={() => go("home")} aria-label="SPACExPRO Hackathon — go to Home" className="flex items-baseline gap-2">
            <span className="font-display text-lg font-semibold tracking-[-0.02em]"><span className="headline-gradient">SPACExPRO</span><span className="text-[var(--rosegold)]">.</span></span>
            <span className="hidden font-letter text-[10px] uppercase tracking-[0.22em] text-[var(--muted)] sm:inline">Hackathon</span>
          </button>
          <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
            {nav.map((n, i) => (
              <button key={n.id} type="button" onClick={() => go(n.id)} aria-current={view === n.id ? "page" : undefined} style={{ ["--sd" as string]: `${i * 0.45}s` }} className={`nav-btn ${view === n.id ? "is-active" : ""}`}>{n.label}</button>
            ))}
            {session?.role === "organizer" && (
              <button type="button" onClick={() => go("organizer")} aria-current={view === "organizer" ? "page" : undefined} style={{ ["--sd" as string]: "1.35s" }} className={`nav-btn ${view === "organizer" ? "is-active" : ""}`}>Organizer</button>
            )}
            {previewOn && <button type="button" onClick={() => go("preview")} className="rounded-full border border-[#FFD700] bg-[#0A0A0B] px-4 py-2 text-sm font-semibold text-[#F5C542]">Fictional preview</button>}
          </nav>
          <div className="flex items-center gap-2">
            {session ? (
              <>
                <span className="hidden text-sm text-[var(--dim)] lg:inline">Signed in as {session.name}</span>
                <button type="button" className="inline-flex min-h-11 items-center rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold transition-colors hover:border-[var(--accent2)]" onClick={signOut}>Sign Out</button>
              </>
            ) : (
              <button type="button" className="hidden min-h-11 items-center rounded-full gold-flow px-4 py-2 text-sm font-semibold text-[#0A0A0A] shadow-[0_8px_24px_rgba(245,197,66,0.35)] transition-all hover:brightness-110 sm:inline-flex" onClick={() => go("portal")}>Sign In</button>
            )}
            <button type="button" aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)} className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--border)] text-base font-semibold md:hidden">{menuOpen ? "✕" : "☰"}</button>
          </div>
        </div>
        {data && (() => {
          const displayCount = data.displayRegistrationCount ?? (data.settings.registrationCountOverride != null ? data.settings.registrationCountOverride : data.teamCount);
          return (
            <div className="mx-auto mt-2 flex max-w-6xl justify-end pr-1 sm:pr-2">
              <div role="status" aria-label={`${displayCount} ${displayCount === 1 ? "team" : "teams"} registered`} className="reg-count-box inline-flex max-w-full items-center gap-2 rounded-lg border border-[rgba(255,215,0,0.55)] bg-[#070708]/95 px-3 py-1.5 shadow-[0_8px_20px_rgba(0,0,0,0.45),0_0_14px_rgba(245,197,66,0.16)] backdrop-blur-md">
                <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#FFD700] shadow-[0_0_8px_rgba(255,215,0,0.9)]" />
                <span className="font-letter text-[10px] font-bold uppercase tracking-[0.18em] text-[#D8CBA6]">Registrations</span>
                <span className="font-display text-[15px] font-extrabold leading-none tracking-tight text-[#FFD700]">{displayCount}</span>
                <span className="whitespace-nowrap text-[11px] leading-none text-[var(--dim)]">{displayCount === 1 ? "team registered" : "teams registered"}</span>
              </div>
            </div>
          );
        })()}
        {menuOpen && (
          <div className="menu-overlay on-black fixed inset-0 z-[90] flex flex-col bg-[#030304]/[0.985] px-6 pb-10 pt-6 text-[#FFFDF5] backdrop-blur-md" role="dialog" aria-modal="true" aria-label="Navigation menu">
            <div className="flex items-center justify-between">
              <span className="font-display text-lg font-semibold tracking-[-0.02em]"><span className="headline-gradient">SPACExPRO</span><span className="text-[var(--rosegold)]">.</span></span>
              <button type="button" aria-label="Close navigation menu" onClick={() => setMenuOpen(false)} className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--border)] text-lg">✕</button>
            </div>
            <nav aria-label="Menu" className="mt-10 flex flex-col gap-2">
              {nav.map((n, i) => (
                <div key={n.id} className="menu-item" style={{ ["--d" as string]: `${0.08 + i * 0.08}s` }}>
                  <button type="button" onClick={() => go(n.id)} aria-current={view === n.id ? "page" : undefined} className="menu-link flex w-full items-baseline gap-4 border-b border-white/10 py-4 text-left">
                    <span className="font-letter text-xs text-[#FCF6BA]">0{i + 1}</span>
                    <span className="font-display text-5xl font-semibold tracking-[-0.02em]"><RollText text={n.label} /></span>
                  </button>
                </div>
              ))}
              {session?.role === "organizer" && (
                <div className="menu-item" style={{ ["--d" as string]: "0.34s" }}>
                  <button type="button" onClick={() => go("organizer")} className="menu-link flex w-full items-baseline gap-4 border-b border-white/10 py-4 text-left">
                    <span className="font-letter text-xs text-[#FCF6BA]">04</span>
                    <span className="font-display text-5xl font-semibold tracking-[-0.02em]"><RollText text="Organizer" /></span>
                  </button>
                </div>
              )}
              {previewOn && (
                <div className="menu-item" style={{ ["--d" as string]: "0.42s" }}>
                  <button type="button" onClick={() => go("preview")} className="menu-link flex w-full items-baseline gap-4 border-b border-white/10 py-4 text-left text-[#FCF6BA]">
                    <span className="font-letter text-xs">05</span>
                    <span className="font-display text-5xl font-semibold tracking-[-0.02em]"><RollText text="Fictional preview" /></span>
                  </button>
                </div>
              )}
              {!session && (
                <div className="menu-item" style={{ ["--d" as string]: "0.42s" }}>
                  <button type="button" onClick={() => go("portal")} className="menu-link flex w-full items-baseline gap-4 border-b border-white/10 py-4 text-left">
                    <span className="font-letter text-xs text-[#FCF6BA]">→</span>
                    <span className="font-display text-5xl font-semibold tracking-[-0.02em]"><RollText text="Sign In" /></span>
                  </button>
                </div>
              )}
            </nav>
            <p className="mt-auto font-letter text-[11px] uppercase tracking-[0.22em] text-[#FCF6BA]">Build beyond limits — Ship the future</p>
          </div>
        )}
      </header>

      <main key={view}>
        {previewOn && view !== "preview" && (
          <div className="border-b border-[#FCF6BA] bg-[#0E0E10] px-4 py-2 text-center text-sm text-[#F5C542]" role="status">
            Fictional preview is enabled — real data is hidden while the preview is active. <button type="button" className="font-bold underline" onClick={() => togglePreview(false)}>Disable Preview</button> or <button type="button" className="font-bold underline" onClick={() => go("preview")}>View Fictional Data</button>.
          </div>
        )}
        {view === "preview" && <PreviewView onDisable={() => { togglePreview(false); go("home"); }} />}
        {view === "home" && (
          pub.isPending ? <p className="mx-auto max-w-3xl px-4 py-16 text-[var(--dim)]">Loading SPACExPRO… Please wait.</p>
          : pub.error || !data ? <div className="mx-auto max-w-3xl px-4 py-16"><Notice kind="bad">The event details could not be loaded. <button type="button" className="font-bold underline" onClick={() => pub.refetch()}>Try Again</button></Notice></div>
          : <HomeView data={data} go={go} booted={booted} />
        )}
        {view === "register" && (
          pub.isPending ? <p className="mx-auto max-w-3xl px-4 py-16 text-[var(--dim)]">Loading… Please wait.</p>
          : pub.error || !data ? <div className="mx-auto max-w-3xl px-4 py-16"><Notice kind="bad">The registration settings could not be loaded. <button type="button" className="font-bold underline" onClick={() => pub.refetch()}>Try Again</button></Notice></div>
          : <RegisterView data={data} onRegistered={() => go("portal")} />
        )}
        {view === "portal" && <PortalView session={session} onSession={setSessionAndStore} goRegister={() => go("register")} goOrganizer={() => go("organizer")} />}
        {view === "organizer" && <OrganizerView session={session} onSession={setSessionAndStore} previewOn={previewOn} onPreviewToggle={togglePreview} />}
      </main>

      <footer className="on-black overflow-hidden border-t border-[#3A2F16] bg-[#030304] text-[#FFFDF5]">
        <div className="mx-auto max-w-6xl px-4 pt-12 sm:px-6">
          <p className="kicker">SPACExPRO Hackathon</p>
          <div className="marquee-skew"><FooterWordmark /></div>
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <p className="font-display font-bold">SPACExPRO Hackathon</p>
              <p className="mt-1 text-sm text-[#FFFDF5]">Build beyond limits. Ship the future.</p>
            </div>
            <div>
              <p className="font-semibold">Contact</p>
              <p className="mt-1 text-sm text-[#FFFDF5]">{data?.settings.contactEmail ?? "space.x.pro.7@gmail.com"}</p>
              {data?.settings.whatsappNumber && <p className="mt-1 text-sm text-[#FFFDF5]"><WhatsAppLink number={data.settings.whatsappNumber} className="font-semibold text-[#F5C542] underline decoration-[#3A2F16] underline-offset-4 transition-colors hover:text-[#FFD700]" /></p>}
              <p className="mt-1 text-sm text-[#FFFDF5]">To send an enquiry, please use the form on the home page.</p>
            </div>
          </div>
          <h1 className="mt-8 text-xs text-[#D8CBA6]">Action is the foundational key to all success</h1>
          <p className="pb-10 pt-3 text-xs text-[#D8CBA6]"></p>
        </div>
      </footer>
      </div>
    </div>
  );
}
