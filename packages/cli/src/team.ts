import path from "node:path";
import { globalDir, loadGlobal, saveGlobal, type Share } from "./config.js";
import type { Lesson } from "./lessons.js";
import { readJson, writeJson } from "./util.js";

export type TeamConfig = NonNullable<ReturnType<typeof loadGlobal>["team"]>;

/** Team credentials for CI: ZLEARN_TEAM_KEY (+ ZLEARN_SERVER) win over the saved team, so no `team join` is needed in a pipeline. */
export function resolveTeam(): { server: string; key: string } | null {
  const key = process.env.ZLEARN_TEAM_KEY;
  if (key) return { server: process.env.ZLEARN_SERVER || loadGlobal().team?.server || "https://zevqi.com", key };
  const t = loadGlobal().team;
  return t ? { server: t.server, key: t.key } : null;
}

export type CheckFile = { path: string; status: "unknown" | "blind" | "stale" | "single" | "covered"; owners: number; unreviewed: boolean; level: "none" | "low" | "medium" | "high"; reasons: string[]; lastChange: string | null };
export type CheckResult = { team: { name: string }; files: CheckFile[]; totals: { files: number; unreviewed: number; blind: number; stale?: number; single: number; covered: number; unknown: number } };

/** Ask the team server which of these files have AI changes nobody has understood. */
export async function checkFiles(files: string[], repo: string): Promise<CheckResult | { error: string; setup?: boolean }> {
  const team = resolveTeam();
  if (!team) return { error: "No team key found.", setup: true };
  try {
    return (await call(team, "POST", "/api/learn/v1/check", { files, repo })) as CheckResult;
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export type RecordPayload = {
  id: string;
  repo: string;
  files: string[];
  status: "pending" | "passed" | "failed";
  correct: number | null;
  total: number | null;
  createdAt: string;
  completedAt: string | null;
  summary?: string;
  revs?: Record<string, string>;
  response?: "understood" | "clarify" | "investigate";
  openQuestions?: string[];
};

const outbox = () => path.join(globalDir(), "outbox.json");

export function toRecord(lesson: Lesson, share: Share): RecordPayload {
  return {
    id: lesson.id,
    repo: lesson.repo,
    files: lesson.changedFiles,
    status: lesson.status,
    correct: lesson.correct ?? null,
    total: lesson.total ?? lesson.questions.length,
    createdAt: lesson.createdAt,
    completedAt: lesson.completedAt ?? null,
    ...(lesson.revs && Object.keys(lesson.revs).length ? { revs: lesson.revs } : {}),
    ...(lesson.response ? { response: lesson.response } : {}),
    // What is unclear is the developer's own text about the code, so it leaves the machine only when they chose to share summaries.
    ...(share === "summaries" ? { summary: lesson.summary, ...(lesson.note ? { openQuestions: [lesson.note] } : {}) } : {}),
  };
}

async function call(team: { server: string; key: string }, method: string, route: string, body?: unknown): Promise<any> {
  const res = await fetch(`${team.server.replace(/\/$/, "")}${route}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${team.key}` },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `Team server returned ${res.status}`);
  return json;
}

export async function createTeam(server: string, name: string, secret?: string): Promise<{ teamKey: string; dashboardUrl: string; inviteHint: string }> {
  const res = await fetch(`${server.replace(/\/$/, "")}/api/learn/v1/teams`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(secret ? { "x-create-secret": secret } : {}) },
    body: JSON.stringify({ name }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `Team server returned ${res.status}`);
  return json;
}

export type KeyCheck = { ok: true; teamName?: string } | { ok: false; reason: "invalid" | "unreachable"; message: string };

/** Confirms a team key with the server before saving it, so a typo fails now instead of at the first sync. */
export async function checkTeamKey(server: string, key: string): Promise<KeyCheck> {
  try {
    const res = await fetch(`${server.replace(/\/$/, "")}/api/learn/v1/summary`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) });
    if (res.status === 401) return { ok: false, reason: "invalid", message: "That team key was not recognised. Check it with your admin." };
    const json = (await res.json().catch(() => ({}))) as { team?: { name?: string } };
    if (!res.ok) return { ok: false, reason: "unreachable", message: `The team server answered ${res.status}.` };
    return { ok: true, teamName: json.team?.name };
  } catch (e) {
    return { ok: false, reason: "unreachable", message: e instanceof Error ? e.message : String(e) };
  }
}

export function joinTeam(server: string, key: string, email: string, name?: string) {
  const cfg = loadGlobal();
  cfg.team = { server, key, email, name };
  saveGlobal(cfg);
}

export function leaveTeam() {
  const cfg = loadGlobal();
  delete cfg.team;
  saveGlobal(cfg);
}

/** Upload lessons to the team dashboard. Failed uploads are queued and retried on the next sync. */
export async function pushRecords(records: RecordPayload[]): Promise<{ sent: number; queued: number; error?: string }> {
  const team = loadGlobal().team;
  if (!team) return { sent: 0, queued: 0 };
  const queued = readJson<RecordPayload[]>(outbox(), []);
  const all = [...queued, ...records];
  if (all.length === 0) return { sent: 0, queued: 0 };
  // Same lesson may be queued twice (pending, then passed): keep the latest state per id.
  const latest = new Map<string, RecordPayload>();
  for (const r of all) latest.set(r.id, r);
  const batch = [...latest.values()];
  try {
    await call(team, "POST", "/api/learn/v1/records", { member: { email: team.email, name: team.name }, lessons: batch });
    writeJson(outbox(), []);
    return { sent: batch.length, queued: 0 };
  } catch (e) {
    writeJson(outbox(), batch.slice(-500));
    return { sent: 0, queued: batch.length, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function teamSummary(): Promise<any> {
  const team = loadGlobal().team;
  if (!team) throw new Error("Not connected to a team. Run: zlearn team join --server <url> --key <key> --email <you>");
  return call(team, "GET", "/api/learn/v1/summary");
}
