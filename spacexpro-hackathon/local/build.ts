// Cross-platform build: `bun run build` (no shell chaining, so it works
// in Windows PowerShell / cmd, macOS and Linux alike).
// Builds the client bundle and type-checks + bundles the server actions.
import { join } from "node:path";
import { buildClient } from "./space-sdk/build";

const rootDir = join(import.meta.dir, "..");
process.chdir(rootDir);

await buildClient({ rootDir });
console.log("[spacexpro] Client built -> client/dist/");

const server = await Bun.build({
  entrypoints: [join(rootDir, "server", "src", "actions.ts")],
  outdir: join(rootDir, "server", "dist"),
  target: "bun",
  naming: { entry: "actions.js" },
});
if (!server.success) {
  for (const log of server.logs) console.error(log);
  process.exit(1);
}
console.log("[spacexpro] Server built -> server/dist/actions.js");
console.log("[spacexpro] Done. Run it with: bun run start");
