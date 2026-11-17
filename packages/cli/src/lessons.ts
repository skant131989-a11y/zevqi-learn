import fs from "node:fs";
import path from "node:path";
import { projectDir } from "./config.js";
import type { Question } from "./ai.js";
import { readJson, uid, writeJson } from "./util.js";

export type Lesson = {
  id: string;
  createdAt: string;
  repo: string;
  sessionId?: string;
  files: { path: string; note: string }[];
  changedFiles: string[];
  summary: string;
  questions: Question[];
  status: "pending" | "passed" | "failed";
  correct?: number;
  total?: number;
  completedAt?: string;
  /** "change": the agent's own edits. "review": recent committed changes the developer chose to review (a teammate's, or their own from earlier). */
  kind?: "change" | "review";
  /** Content fingerprint (git blob hash, shortened) of each file when the lesson was made. Lets the team server tell when a file changed after a review. */
  revs?: Record<string, string>;
  decisions?: string[];
  depends?: string[];
  risks?: string[];
  /** The developer's own call after the quiz. "clarify" and "investigate" do not count as evidence of understanding. */
  response?: Response;
  /** What is unclear, in the developer's words. Only synced when sharing is set to summaries. */
  note?: string;
};

export type Response = "understood" | "clarify" | "investigate";
export const RESPONSES: Record<string, Response> = { y: "understood", c: "clarify", i: "investigate" };

export type Buffer = { sessionId?: string; files: Record<string, string> };

const lessonsDir = (root: string) => path.join(projectDir(root), "lessons");
const bufferFile = (root: string) => path.join(projectDir(root), "buffer.json");

export function recordEdit(root: string, file: string, sessionId?: string) {
  const buf = readJson<Buffer>(bufferFile(root), { files: {} });
  buf.sessionId = sessionId || buf.sessionId;
  buf.files[file] = new Date().toISOString();
  writeJson(bufferFile(root), buf);
}

/** Take the edits recorded so far and clear the buffer (so the next turn starts fresh). */
export function takeBuffer(root: string): Buffer | null {
  const buf = readJson<Buffer>(bufferFile(root), { files: {} });
  if (Object.keys(buf.files).length === 0) return null;
  try {
    fs.rmSync(bufferFile(root), { force: true });
  } catch {
    // ignore
  }
  return buf;
}

export function saveLesson(root: string, lesson: Lesson) {
  writeJson(path.join(lessonsDir(root), `${lesson.id}.json`), lesson);
}

export function newLessonId(): string {
  return uid("l_");
}

export function listLessons(root: string): Lesson[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(lessonsDir(root)).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  return names
    .map((n) => readJson<Lesson | null>(path.join(lessonsDir(root), n), null))
    .filter((l): l is Lesson => Boolean(l && l.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getLesson(root: string, id: string): Lesson | null {
  if (!/^l_[a-f0-9]+$/.test(id)) return null;
  return readJson<Lesson | null>(path.join(lessonsDir(root), `${id}.json`), null);
}

export function pending(root: string): Lesson[] {
  return listLessons(root).filter((l) => l.status === "pending");
}

export function complete(root: string, lesson: Lesson, correct: number, passRatio: number): Lesson {
  const total = lesson.questions.length;
  const next: Lesson = { ...lesson, correct, total, status: total > 0 && correct / total >= passRatio - 1e-9 ? "passed" : "failed", completedAt: new Date().toISOString() };
  saveLesson(root, next);
  return next;
}

/** Records how the developer felt about a finished lesson. */
export function setResponse(root: string, lesson: Lesson, response: Response, note?: string): Lesson {
  const next: Lesson = { ...lesson, response, ...(note ? { note: note.replace(/\s+/g, " ").trim().slice(0, 300) } : {}) };
  saveLesson(root, next);
  return next;
}

export type FileKnowledge = { path: string; changes: number; passed: number; open: number; lastChange: string };

/** Per-file view: how often AI changed it and whether you have passed a lesson covering it. */
export function knowledgeMap(root: string): FileKnowledge[] {
  const map = new Map<string, FileKnowledge>();
  for (const lesson of listLessons(root)) {
    for (const file of lesson.changedFiles) {
      const entry = map.get(file) ?? { path: file, changes: 0, passed: 0, open: 0, lastChange: lesson.createdAt };
      entry.changes += 1;
      if (lesson.status === "passed") entry.passed += 1;
      else entry.open += 1;
      if (lesson.createdAt > entry.lastChange) entry.lastChange = lesson.createdAt;
      map.set(file, entry);
    }
  }
  return [...map.values()].sort((a, b) => b.open - a.open || b.lastChange.localeCompare(a.lastChange));
}
