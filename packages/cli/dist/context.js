import fs from "node:fs";
import { apiKey, loadProject, projectDir, providerOf, loadGlobal, saveProject } from "./config.js";
import { repoRoot } from "./git.js";
import { aiDisclosure, c, fail } from "./util.js";
export const flagStr = (v) => (typeof v === "string" ? v : undefined);
export function needRoot() {
    const root = repoRoot(process.cwd());
    if (!root)
        fail("Run this inside a git repository.", 2, "cd into your project first.");
    return root;
}
export function needEnabled() {
    const root = needRoot();
    if (!fs.existsSync(projectDir(root)))
        fail("zlearn is not enabled here yet.", 2, "Run: zlearn init");
    return root;
}
/** Print machine-readable JSON when `--json` is set, otherwise run the human renderer. */
export function emit(ctx, data, human) {
    if (ctx.json)
        console.log(JSON.stringify(data, null, 2));
    else
        human();
}
/** Installs from before the disclosure existed see it once, then it is recorded. Never blocks. */
export function ensureAiNotice(root) {
    const cfg = loadProject(root);
    if (cfg.aiNotice)
        return;
    console.log(c.dim(aiDisclosure(providerOf(loadGlobal()), cfg.maxFiles, Boolean(apiKey(loadGlobal())))) + "\n");
    saveProject(root, { ...cfg, aiNotice: new Date().toISOString() });
}
