// SPACExPRO — standalone dev / start server (Windows · macOS · Linux).
//
//   bun install
//   bun run dev        ->  http://localhost:3000
//
// One Bun process serves the built React client and the /actions API
// backed by a local SQLite file (app.db). No Muse host, no /opt paths,
// no OS-specific shell commands: every path is built with node:path.
import { existsSync, watch } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { Actions } from "../server/src/actions";
import { buildClient } from "./space-sdk/build";
import { openLocalDb } from "./db";

const rootDir = join(import.meta.dir, "..");
const distDir = join(rootDir, "client", "dist");
const isDev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT || 3000);
const hostname = process.env.HOST || "localhost";

const { db, dbPath } = openLocalDb(rootDir);
console.log(`[spacexpro] Database: ${dbPath}`);

// Email truthfulness in local mode: queued mail stays "pending" in the
// Organizer outbox. There is no Gmail connection in a local checkout,
// so nothing is ever marked sent here (same rule as the hosted app).
const ctx = {
  db: () => db,
  invalidateQueries: () => {},
  emit: () => {},
  executePrivileged: async () => {
    throw new Error("Privileged host calls are not available locally.");
  },
  agent: {
    spawnTask: async () => {
      console.log(
        "[spacexpro] An email was queued. Local mode has no Gmail delivery, so it stays pending in the Organizer outbox.",
      );
      return { ok: true as const, taskId: "local", agentId: "local", messageId: "local" };
    },
    send: async () => ({ ok: true as const, taskId: "local", agentId: "local", messageId: "local" }),
    status: async (taskId: string) => ({ taskId, status: "completed" }),
  },
};

async function handleAction(req: Request): Promise<Response> {
  let payload: { action?: string; args?: unknown };
  try {
    payload = (await req.json()) as typeof payload;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const name = payload.action ?? "";
  const def = (Actions as Record<string, unknown>)[name] as
    | { request: { parse: (v: unknown) => unknown }; handler: (c: unknown, a: unknown) => Promise<unknown> }
    | undefined;
  if (!def || typeof def.handler !== "function") {
    return Response.json({ error: `Unknown action: ${name}` }, { status: 404 });
  }
  try {
    const args = def.request.parse(payload.args ?? {});
    const data = await def.handler(ctx, args);
    return Response.json({ data });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const isValidation =
      e !== null && typeof e === "object" && (e as { name?: string }).name === "ZodError";
    return Response.json(
      { error: message },
      { status: isValidation ? 400 : 500 },
    );
  }
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

function serveStatic(pathname: string): Response | null {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(distDir, rel);
  if (!filePath.startsWith(distDir + sep) && filePath !== distDir) return null;
  if (existsSync(filePath) && extname(filePath)) {
    return new Response(Bun.file(filePath), {
      headers: { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" },
    });
  }
  const index = join(distDir, "index.html");
  if (existsSync(index)) {
    return new Response(Bun.file(index), { headers: { "content-type": MIME[".html"]! } });
  }
  return null;
}

let building: Promise<void> | null = null;
async function rebuild(reason: string) {
  if (building) return building;
  building = (async () => {
    try {
      await buildClient({ rootDir });
      console.log(`[spacexpro] Client rebuilt (${reason}). Refresh your browser.`);
    } catch (e) {
      console.error("[spacexpro] Client build failed:", e);
    } finally {
      building = null;
    }
  })();
  return building;
}

await rebuild("startup");
if (isDev) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const srcDir = join(rootDir, "client", "src");
  try {
    watch(srcDir, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => void rebuild("file change"), 250);
    });
    watch(join(rootDir, "client", "index.html"), () => {
      clearTimeout(timer);
      timer = setTimeout(() => void rebuild("index.html change"), 250);
    });
  } catch {
    console.log("[spacexpro] File watching unavailable; restart `bun run dev` after editing client files.");
  }
}

const server = Bun.serve({
  port,
  hostname,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/actions" || url.pathname === "/actions/") {
      if (req.method !== "POST") {
        return Response.json({ error: "POST only" }, { status: 405 });
      }
      return handleAction(req);
    }
    if (url.pathname === "/health") return Response.json({ ok: true });
    const res = serveStatic(url.pathname);
    return res ?? new Response("Not found", { status: 404 });
  },
});

console.log("");
console.log("  SPACExPRO Hackathon is running:");
console.log(`  ->  http://${hostname}:${server.port}   (this computer)`);
console.log("  ->  On a phone on the same Wi-Fi, run with HOST=0.0.0.0 and open");
console.log(`      http://<this-computer-ip>:${server.port}`);
console.log(isDev ? "  Mode: development (client rebuilds on file changes)" : "  Mode: production");
console.log("  Stop: Ctrl+C");
