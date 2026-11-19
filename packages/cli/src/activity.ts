import path from "node:path";
import { projectDir } from "./config.js";
import { readJson, writeJson } from "./util.js";

/**
 * The last time a Zevqi hook ran in this repository. Hooks are silent by design, so without this a developer cannot tell
 * "the hooks are not loaded" from "nothing has happened yet". `zevqi doctor` reads it. It holds a time and an event name,
 * and for edits the file path, and it never leaves the machine.
 */
export type HookActivity = { at: string; event: "post-tool" | "stop" | "commit-gate"; file?: string };

const activityFile = (root: string) => path.join(projectDir(root), "hook-activity.json");

export function recordHookActivity(root: string, event: HookActivity["event"], file?: string): void {
  try {
    writeJson(activityFile(root), { at: new Date().toISOString(), event, ...(file ? { file } : {}) });
  } catch {
    // never let bookkeeping break a hook
  }
}

export function lastHookActivity(root: string): HookActivity | null {
  return readJson<HookActivity | null>(activityFile(root), null);
}
