import path from "node:path";
import { globalDir, loadGlobal, saveGlobal, type Share } from "./config.js";
import type { Lesson } from "./lessons.js";
import { readJson, writeJson } from "./util.js";

export type TeamConfig = NonNullable<ReturnType<typeof loadGlobal>["team"]>;

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
    ...(share === "summaries" ? { summary: lesson.summary } : {}),
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
