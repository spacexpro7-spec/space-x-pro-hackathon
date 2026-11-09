// Standalone client bundler for SPACExPRO (local edition).
// Same output shape as the Muse-hosted build (client/index.html ->
// client/dist/) but with no host guard and no machine-specific paths:
// it runs anywhere Bun runs — Windows, macOS and Linux.
import { rm } from "node:fs/promises";
import { basename, join } from "node:path";
// @ts-ignore - bun-plugin-tailwind ships with Bun; types are optional.
import tailwindPlugin from "bun-plugin-tailwind";

export async function buildClient(options: { rootDir?: string } = {}) {
  const root = options.rootDir ?? process.cwd();
  const entry = join(root, "client", "index.html");
  const outdir = join(root, "client", "dist");
  await rm(outdir, { force: true, recursive: true });
  const result = await Bun.build({
    entrypoints: [entry],
    outdir,
    minify: true,
    target: "browser",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    naming: {
      asset: "assets/[name]-[hash].[ext]",
      chunk: "assets/[name]-[hash].[ext]",
      entry: "[name].[ext]",
    },
    plugins: [tailwindPlugin],
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error("buildClient() failed; see logged diagnostics above");
  }
  // Re-prefix bare imported-asset URLs to ./assets/... (same fix the
  // hosted build applies: Bun emits asset files under assets/ but
  // references them bare in the JS/CSS/HTML output).
  const assetFiles = result.outputs
    .filter((o) => o.kind === "asset")
    .map((o) => basename(o.path));
  for (const output of result.outputs) {
    if (!/\.(js|css|html)$/.test(output.path)) continue;
    let text = await output.text();
    let changed = false;
    for (const name of assetFiles) {
      const bare = `./${name}`;
      if (text.includes(bare)) {
        text = text.split(bare).join(`./assets/${name}`);
        changed = true;
      }
    }
    if (changed) await Bun.write(output.path, text);
  }
  return result;
}
