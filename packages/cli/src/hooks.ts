import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { explainDiff, AiError } from "./ai.js";
import { apiKey, loadGlobal, loadProject, projectDir } from "./config.js";
import { canonicalPath, diffForFiles, fileRevs, repoName, repoRoot } from "./git.js";
import { recordHookActivity } from "./activity.js";
import { listLessons, newLessonId, pending, recordEdit, saveLesson, takeBuffer, type Lesson } from "./lessons.js";
import { pushRecords, toRecord } from "./team.js";
import { readJson, readStdin, toPosix, uid, writeJson } from "./util.js";

type HookInput = {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: { file_path?: string; notebook_path?: string; command?: string; path?: string };
};

function parse(raw: string): HookInput {
  try {
    return JSON.parse(raw) as HookInput;
  } catch {
    return {};
  }
}

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

/** PostToolUse: remember which files the agent touched. Must be fast and silent. */
export async function postToolHook() {
  const input = parse(await readStdin());
  if (!input.tool_name || !EDIT_TOOLS.has(input.tool_name)) return;
  const file = input.tool_input?.file_path || input.tool_input?.notebook_path || input.tool_input?.path;
  if (!file) return;
  const root = repoRoot(input.cwd || process.cwd());
  if (!root) return;
  if (!fs.existsSync(projectDir(root))) return; // Zevqi is not enabled in this repo
  const relForLog = toPosix(path.relative(canonicalPath(root), canonicalPath(path.resolve(input.cwd || root, file))));
  recordHookActivity(root, "post-tool", relForLog.startsWith("..") ? undefined : relForLog);
  // Compare canonical paths so short names (C:\Users\RUNNER~1), case differences and symlinks cannot hide an edit.
  const rel = toPosix(path.relative(canonicalPath(root), canonicalPath(path.resolve(input.cwd || root, file))));
  if (rel.startsWith("..") || rel.startsWith(".zlearn") || rel.startsWith(".claude")) return;
  recordEdit(root, rel, input.session_id);
}

/** Stop: the agent finished a turn. Start the explanation in the background so Claude is never slowed down. */
export async function stopHook(cliPath: string) {
  const input = parse(await readStdin());
  const root = repoRoot(input.cwd || process.cwd());
  if (!root || !fs.existsSync(projectDir(root))) return;
  recordHookActivity(root, "stop");
  // No API key means your coding agent writes the lessons (zevqi lesson add), so there is no background explanation to start.
  if (!apiKey(loadGlobal())) return;
  const buf = takeBuffer(root);
  if (!buf) return;
  const jobId = uid("job_");
  writeJson(path.join(projectDir(root), "jobs", `${jobId}.json`), { root, sessionId: buf.sessionId, files: Object.keys(buf.files) });
  const child = spawn(process.execPath, [cliPath, "explain", "--job", jobId, "--root", root], { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
}

/** The background job: turn the changed files into a lesson. */
export async function explainJob(root: string, jobId: string): Promise<Lesson | null> {
  const jobFile = path.join(projectDir(root), "jobs", `${jobId}.json`);
  const job = readJson<{ sessionId?: string; files: string[] } | null>(jobFile, null);
  if (!job) return null;
  const cfg = loadProject(root);
  const files = job.files.slice(0, cfg.maxFiles);
  const { text, included } = diffForFiles(root, files);
  try {
    fs.rmSync(jobFile, { force: true });
  } catch {
    // ignore
  }
  if (!text.trim()) return null;
  const repo = repoName(root);
  const explanation = await explainDiff(text, included, repo);
  const lesson: Lesson = {
    id: newLessonId(),
    createdAt: new Date().toISOString(),
    repo,
    sessionId: job.sessionId,
    changedFiles: included,
    files: explanation.files,
    summary: explanation.summary,
    questions: explanation.questions,
    status: "pending",
    kind: "change",
    revs: fileRevs(root, included),
    decisions: explanation.decisions,
    depends: explanation.depends,
    risks: explanation.risks,
  };
  saveLesson(root, lesson);
  await pushRecords([toRecord(lesson, cfg.share)]);
  return lesson;
}

export { AiError };

/** PreToolUse on `git commit`: warn or block while AI changes are still un-reviewed. */
export async function commitGateHook() {
  const input = parse(await readStdin());
  const command = input.tool_input?.command ?? "";
  if (input.tool_name !== "Bash" || !/\bgit\s+(?:-[^\s]+\s+)*commit\b/.test(command)) return;
  const root = repoRoot(input.cwd || process.cwd());
  if (!root || !fs.existsSync(projectDir(root))) return;
  const cfg = loadProject(root);
  if (cfg.gate === "off") return;
  const open = pending(root);
  if (open.length === 0) return;
  const files = new Set(open.flatMap((l) => l.changedFiles));
  const message = `${open.length} AI change${open.length === 1 ? "" : "s"} touching ${files.size} file${files.size === 1 ? "" : "s"} not reviewed yet. Run "zevqi" in a terminal (about 2 minutes), then commit.`;
  if (cfg.gate === "block") {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: `zevqi: ${message} To skip once, run: zevqi gate off` } }));
  } else {
    process.stdout.write(JSON.stringify({ systemMessage: `zevqi: ${message}` }));
  }
}

// ── installing the hooks into Claude Code settings ─────────────────────────────────────────────

type HookEntry = { type: "command"; command: string; args: string[]; timeout?: number; if?: string };
type Group = { matcher?: string; hooks: HookEntry[] };

const MARK = "zevqi-learn";

export function settingsPath(root: string, scope: "local" | "shared" | "global"): string {
  if (scope === "global") return path.join(os.homedir(), ".claude", "settings.json");
  return path.join(root, ".claude", scope === "shared" ? "settings.json" : "settings.local.json");
}

function ours(group: Group): boolean {
  return group.hooks?.some((h) => h.args?.some((a) => /zevqi-learn|[\\/]dist[\\/]cli\.js/.test(a)) && h.args.includes("hook"));
}

export function installHooks(root: string, scope: "local" | "shared" | "global", cliPath: string): string {
  const file = settingsPath(root, scope);
  const settings = readJson<Record<string, any>>(file, {});
  settings.hooks = settings.hooks ?? {};
  const add = (event: string, group: Group) => {
    const groups: Group[] = (settings.hooks[event] ?? []).filter((g: Group) => !ours(g));
    groups.push(group);
    settings.hooks[event] = groups;
  };
  const cmd = (sub: string, timeout: number, extra: Partial<HookEntry> = {}): HookEntry => ({ type: "command", command: process.execPath, args: [cliPath, "hook", sub], timeout, ...extra });
  add("PostToolUse", { matcher: "Edit|Write|MultiEdit|NotebookEdit", hooks: [cmd("post-tool", 10)] });
  add("Stop", { hooks: [cmd("stop", 10)] });
  add("PreToolUse", { matcher: "Bash", hooks: [cmd("commit-gate", 10, { if: "Bash(git commit*)" })] });
  writeJson(file, settings);
  return file;
}

export function uninstallHooks(root: string, scope: "local" | "shared" | "global"): string {
  const file = settingsPath(root, scope);
  const settings = readJson<Record<string, any>>(file, {});
  for (const event of Object.keys(settings.hooks ?? {})) {
    settings.hooks[event] = (settings.hooks[event] as Group[]).filter((g) => !ours(g));
    if (settings.hooks[event].length === 0) delete settings.hooks[event];
  }
  if (settings.hooks && Object.keys(settings.hooks).length === 0) delete settings.hooks;
  writeJson(file, settings);
  return file;
}

export function hooksInstalled(root: string): string[] {
  return (["local", "shared", "global"] as const).filter((scope) => {
    const s = readJson<Record<string, any>>(settingsPath(root, scope), {});
    return Object.values(s.hooks ?? {}).some((groups) => (groups as Group[]).some(ours));
  });
}

/** The zevqi program each installed hook points at. A hook whose program has moved or been uninstalled fails silently, so doctor checks them. */
export function hookCliPaths(root: string): { scope: string; cliPath: string }[] {
  const out: { scope: string; cliPath: string }[] = [];
  for (const scope of ["local", "shared", "global"] as const) {
    const s = readJson<Record<string, any>>(settingsPath(root, scope), {});
    for (const groups of Object.values(s.hooks ?? {})) {
      for (const g of groups as Group[]) {
        if (!ours(g)) continue;
        for (const h of g.hooks) {
          const cliPath = h.args?.find((a) => /[\\/]dist[\\/]cli\.js$/.test(a));
          if (cliPath && !out.some((x) => x.scope === scope && x.cliPath === cliPath)) out.push({ scope, cliPath });
        }
      }
    }
  }
  return out;
}

export { MARK, listLessons };
