// Local SQLite setup for the standalone edition.
// Uses Bun's built-in sqlite (no native addon to compile, so the same
// code runs on Windows, macOS and Linux) + Drizzle, and applies the
// project's drizzle/*.sql migrations once, in filename order.
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as schema from "../server/src/schema";

export function openLocalDb(rootDir: string) {
  const dbPath =
    process.env.DATABASE_PATH?.trim() || join(rootDir, "app.db");
  if (dbPath !== ":memory:") {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  const sqlite = new Database(dbPath, { create: true });
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");

  sqlite.exec(
    "CREATE TABLE IF NOT EXISTS __local_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);",
  );
  const applied = new Set(
    sqlite
      .query("SELECT name FROM __local_migrations")
      .all()
      .map((r) => (r as { name: string }).name),
  );
  const drizzleDir = join(rootDir, "drizzle");
  const files = readdirSync(drizzleDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(drizzleDir, file), "utf8");
    const statements = sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    sqlite.exec("BEGIN");
    try {
      for (const stmt of statements) sqlite.exec(stmt);
      sqlite.run(
        "INSERT INTO __local_migrations (name, applied_at) VALUES (?, ?)",
        [file, Date.now()],
      );
      sqlite.exec("COMMIT");
    } catch (e) {
      sqlite.exec("ROLLBACK");
      throw new Error(`Migration ${file} failed: ${String(e)}`);
    }
  }
  const db = drizzle(sqlite, { schema });
  return { db, dbPath };
}
