// Builds the CLI without going through npm workspaces, so `npm install -g github:zevqi/zlearn` works:
// npm refuses workspace commands during a global install, and the build runs as part of that install (the "prepare" step).
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "packages", "cli");
const require = createRequire(path.join(root, "package.json"));

let tsc;
for (const from of [root, cli]) {
  try {
    tsc = require.resolve("typescript/bin/tsc", { paths: [from] });
    break;
  } catch {
    // try the next location
  }
}
if (!tsc) {
  // Already built (a published tarball ships dist), so there is nothing to do.
  if (fs.existsSync(path.join(cli, "dist", "cli.js"))) process.exit(0);
  console.error("zlearn: TypeScript was not found, so the CLI could not be built. Run: npm install, then npm run build:cli");
  process.exit(1);
}
const r = spawnSync(process.execPath, [tsc, "-p", path.join(cli, "tsconfig.json")], { cwd: cli, stdio: "inherit" });
process.exit(r.status ?? 1);
