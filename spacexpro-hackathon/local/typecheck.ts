// Cross-platform typecheck: `bun run typecheck`.
// Spawns tsc for the client and server projects from a Bun script
// instead of a shell `&&` chain (which fails in Windows PowerShell 5.1).
import { join } from "node:path";

const rootDir = join(import.meta.dir, "..");
let failed = false;
for (const proj of ["client/tsconfig.json", "server/tsconfig.json"]) {
  const proc = Bun.spawn(
    ["bun", "x", "tsc", "--noEmit", "-p", join(rootDir, proj)],
    { cwd: rootDir, stdout: "inherit", stderr: "inherit" },
  );
  const code = await proc.exited;
  if (code !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
