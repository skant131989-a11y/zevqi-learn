import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { toPosix } from "./util.js";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
}

/**
 * The real, canonical form of a path: resolves symlinks, Windows 8.3 short names (RUNNER~1) and case differences.
 * Works for files that do not exist yet (a new file the agent is about to write) by canonicalising the nearest existing parent.
 * Used so an edited file can always be matched to the repository root that git reports.
 */
export function canonicalPath(p: string): string {
  const abs = path.resolve(p);
  try {
    return fs.realpathSync.native(abs);
  } catch {
    const parent = path.dirname(abs);
    if (parent === abs) return abs;
    return path.join(canonicalPath(parent), path.basename(abs));
  }
}

export function repoRoot(cwd: string): string | null {
  try {
    return path.resolve(git(cwd, ["rev-parse", "--show-toplevel"]).trim());
  } catch {
    return null;
  }
}

export function repoName(root: string): string {
  try {
    const url = git(root, ["config", "--get", "remote.origin.url"]).trim();
    const m = url.match(/([^/:]+\/[^/]+?)(?:\.git)?$/);
    if (m) return m[1];
  } catch {
    // no remote
  }
  return path.basename(root);
}

export function hasHead(root: string): boolean {
  try {
    git(root, ["rev-parse", "--verify", "HEAD"]);
    return true;
  } catch {
    return false;
  }
}

const PER_FILE = 12_000;
const TOTAL = 60_000;

/** Unified diff of the given files against HEAD; untracked files are included as additions. Truncated for the AI call. */
export function diffForFiles(root: string, files: string[]): { text: string; included: string[] } {
  let total = 0;
  const parts: string[] = [];
  const included: string[] = [];
  const head = hasHead(root);
  for (const file of files) {
    if (total >= TOTAL) break;
    const rel = toPosix(path.relative(root, path.resolve(root, file)));
    if (rel.startsWith("..")) continue;
    let chunk = "";
    try {
      chunk = head ? git(root, ["diff", "HEAD", "--", rel]) : git(root, ["diff", "--cached", "--", rel]);
    } catch {
      chunk = "";
    }
    if (!chunk.trim()) {
      // untracked or already committed: show current content as an addition
      try {
        const abs = path.join(root, rel);
        const stat = fs.statSync(abs);
        if (stat.isFile() && stat.size < 2_000_000) {
          const body = fs.readFileSync(abs, "utf8");
          if (!body.includes("\u0000")) chunk = `diff --git a/${rel} b/${rel}\nnew file\n--- /dev/null\n+++ b/${rel}\n` + body.split("\n").map((l) => "+" + l).join("\n");
        }
      } catch {
        chunk = "";
      }
    }
    if (!chunk.trim()) continue;
    if (chunk.length > PER_FILE) chunk = chunk.slice(0, PER_FILE) + "\n[... truncated ...]\n";
    parts.push(chunk);
    included.push(rel);
    total += chunk.length;
  }
  return { text: parts.join("\n"), included };
}

/**
 * Content fingerprint (git blob hash, 12 hex characters) of each file as it is on disk right now. The team server compares these
 * to learn whether a file changed after someone reviewed it. Unreadable or deleted files are left out.
 */
export function fileRevs(root: string, files: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of files) {
    try {
      const h = git(root, ["hash-object", "--", f]).trim();
      if (/^[a-f0-9]{40,64}$/.test(h)) out[f] = h.slice(0, 12);
    } catch {
      // deleted or unreadable: no fingerprint
    }
  }
  return out;
}

/**
 * The recent history of some files as patches: the last `commits` commits that touched each file, plus any uncommitted change.
 * Used by `zevqi review`, so a developer can understand changes they did not write (or wrote long ago). Truncated for the AI call.
 */
export function diffForHistory(root: string, files: string[], commits = 5): { text: string; included: string[] } {
  const parts: string[] = [];
  const included: string[] = [];
  let total = 0;
  for (const file of files) {
    if (total >= TOTAL) break;
    const rel = toPosix(path.relative(root, path.resolve(root, file)));
    if (rel.startsWith("..")) continue;
    let chunk = "";
    try {
      if (hasHead(root)) chunk += git(root, ["diff", "HEAD", "--", rel]);
    } catch {
      // ignore
    }
    try {
      chunk += git(root, ["log", "-p", "--no-color", `-n${commits}`, "--format=commit %h %an: %s", "--", rel]);
    } catch {
      // ignore
    }
    if (!chunk.trim()) continue;
    if (chunk.length > PER_FILE * 2) chunk = chunk.slice(0, PER_FILE * 2) + "\n[... truncated ...]\n";
    parts.push(`### ${rel}\n${chunk}`);
    included.push(rel);
    total += chunk.length;
  }
  return { text: parts.join("\n"), included };
}

/** The base a branch review compares with: the one given, else the first of origin/main, origin/master, main, master that exists. Null if none does. */
export function branchBase(root: string, base?: string): string | null {
  for (const ref of [base, "origin/main", "origin/master", "main", "master"]) {
    if (!ref) continue;
    try {
      git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
      return ref;
    } catch {
      // try the next one
    }
  }
  return null;
}

/** What this branch changes compared with its base, file by file (a merge-base diff, like a pull request shows). */
export function diffForBranch(root: string, base: string, files: string[]): { text: string; included: string[] } {
  const parts: string[] = [];
  const included: string[] = [];
  let total = 0;
  for (const file of files) {
    if (total >= TOTAL) break;
    const rel = toPosix(path.relative(root, path.resolve(root, file)));
    if (rel.startsWith("..")) continue;
    let chunk = "";
    try {
      chunk = git(root, ["diff", "--no-color", `${base}...HEAD`, "--", rel]);
    } catch {
      // ignore
    }
    if (!chunk.trim()) continue;
    if (chunk.length > PER_FILE * 2) chunk = chunk.slice(0, PER_FILE * 2) + "\n[... truncated ...]\n";
    parts.push(`### ${rel}\n${chunk}`);
    included.push(rel);
    total += chunk.length;
  }
  return { text: parts.join("\n"), included };
}

/** Files with uncommitted changes among these. A review fingerprints files as they are on disk, so they must match what was committed. */
export function dirtyAmong(root: string, files: string[]): string[] {
  if (files.length === 0) return [];
  try {
    return git(root, ["status", "--porcelain", "--", ...files])
      .split("\n")
      .map((l) => l.slice(3).trim())
      .filter(Boolean)
      .map(toPosix);
  } catch {
    return [];
  }
}

export function headSha(root: string): string | null {
  try {
    return git(root, ["rev-parse", "HEAD"]).trim();
  } catch {
    return null;
  }
}

/** Raw history for `zevqi scan`: one record per non-merge commit with its author, date, subject, body and changed files. */
export function scanLog(root: string, months = 12, maxCommits = 30000): string {
  try {
    return git(root, ["-c", "core.quotepath=off", "log", "--no-merges", `--since=${months}.months`, `-n${maxCommits}`, "--name-only", "--format=%x1e%H%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%b%x1f"]);
  } catch {
    return "";
  }
}

/** Files in the repository right now (tracked by git), so a scan ignores files that were deleted or renamed away. */
export function trackedFiles(root: string): Set<string> | null {
  try {
    return new Set(git(root, ["-c", "core.quotepath=off", "ls-files"]).split("\n").map((l) => l.trim()).filter(Boolean).map(toPosix));
  } catch {
    return null;
  }
}

/** Files touched by one commit (default HEAD). Empty when the ref does not exist or the repository has no commits. */
export function filesInCommit(root: string, ref = "HEAD"): string[] {
  if (!/^[A-Za-z0-9._\/~^@{}-]{1,100}$/.test(ref)) return [];
  try {
    return git(root, ["diff-tree", "--no-commit-id", "--name-only", "-r", "--root", ref]).split("\n").map((l) => l.trim()).filter(Boolean).map(toPosix);
  } catch {
    return [];
  }
}

/** Files with uncommitted changes (modified, staged or untracked), for a manual `zevqi explain`. */
export function changedFiles(root: string): string[] {
  const out = new Set<string>();
  const run = (args: string[]) => {
    try {
      for (const line of git(root, args).split("\n")) if (line.trim()) out.add(toPosix(line.trim()));
    } catch {
      // ignore
    }
  };
  if (hasHead(root)) run(["diff", "--name-only", "HEAD"]);
  run(["ls-files", "--others", "--exclude-standard"]);
  return [...out].filter((f) => !f.startsWith(".zlearn/") && !f.startsWith(".claude/"));
}

/** Distinct committers (by name and email) on the current branch in the last N days. 0 if git cannot say. */
export function contributorCount(root: string, days = 90): number {
  try {
    const out = git(root, ["shortlog", "-sne", "HEAD", `--since=${days}.days`]);
    return out.split("\n").filter((l) => l.trim()).length;
  } catch {
    return 0;
  }
}

/**
 * Files changed on this branch compared with a base ref (merge-base diff, like a pull request shows).
 * Falls back through origin/main, main and the previous commit so it works in most CI checkouts.
 */
export function changedSince(root: string, base?: string): string[] {
  const candidates = [base, "origin/main", "origin/master", "main", "master", "HEAD~1"].filter((b): b is string => Boolean(b));
  for (const ref of candidates) {
    try {
      const out = git(root, ["diff", "--name-only", "--diff-filter=ACMR", `${ref}...HEAD`]);
      return out.split("\n").map((l) => l.trim()).filter(Boolean).map(toPosix);
    } catch {
      // try the next candidate
    }
  }
  return [];
}
