import path from "node:path";
import { projectDir } from "./config.js";
import { readJson, writeJson } from "./util.js";
const activityFile = (root) => path.join(projectDir(root), "hook-activity.json");
export function recordHookActivity(root, event, file) {
    try {
        writeJson(activityFile(root), { at: new Date().toISOString(), event, ...(file ? { file } : {}) });
    }
    catch {
        // never let bookkeeping break a hook
    }
}
export function lastHookActivity(root) {
    return readJson(activityFile(root), null);
}
