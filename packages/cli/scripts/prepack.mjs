// Copies the repository README and LICENSE into the package folder so `npm pack` / `npm publish` include them.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..", "..");
for (const file of ["README.md", "LICENSE"]) fs.copyFileSync(path.join(root, file), path.join(here, "..", file));
