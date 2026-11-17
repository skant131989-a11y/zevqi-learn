import fs from "node:fs";
import path from "node:path";
import { projectDir } from "./config.js";
import { readJson, uid, writeJson } from "./util.js";
export const RESPONSES = { y: "understood", c: "clarify", i: "investigate" };
const lessonsDir = (root) => path.join(projectDir(root), "lessons");
const bufferFile = (root) => path.join(projectDir(root), "buffer.json");
export function recordEdit(root, file, sessionId) {
    const buf = readJson(bufferFile(root), { files: {} });
    buf.sessionId = sessionId || buf.sessionId;
    buf.files[file] = new Date().toISOString();
    writeJson(bufferFile(root), buf);
}
/** Take the edits recorded so far and clear the buffer (so the next turn starts fresh). */
export function takeBuffer(root) {
    const buf = readJson(bufferFile(root), { files: {} });
    if (Object.keys(buf.files).length === 0)
        return null;
    try {
        fs.rmSync(bufferFile(root), { force: true });
    }
    catch {
        // ignore
    }
    return buf;
}
export function saveLesson(root, lesson) {
    writeJson(path.join(lessonsDir(root), `${lesson.id}.json`), lesson);
}
export function newLessonId() {
    return uid("l_");
}
export function listLessons(root) {
    let names = [];
    try {
        names = fs.readdirSync(lessonsDir(root)).filter((n) => n.endsWith(".json"));
    }
    catch {
        return [];
    }
    return names
        .map((n) => readJson(path.join(lessonsDir(root), n), null))
        .filter((l) => Boolean(l && l.id))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function getLesson(root, id) {
    if (!/^l_[a-f0-9]+$/.test(id))
        return null;
    return readJson(path.join(lessonsDir(root), `${id}.json`), null);
}
export function pending(root) {
    return listLessons(root).filter((l) => l.status === "pending");
}
export function complete(root, lesson, correct, passRatio) {
    const total = lesson.questions.length;
    const next = { ...lesson, correct, total, status: total > 0 && correct / total >= passRatio - 1e-9 ? "passed" : "failed", completedAt: new Date().toISOString() };
    saveLesson(root, next);
    return next;
}
/** Records how the developer felt about a finished lesson. */
export function setResponse(root, lesson, response, note) {
    const next = { ...lesson, response, ...(note ? { note: note.replace(/\s+/g, " ").trim().slice(0, 300) } : {}) };
    saveLesson(root, next);
    return next;
}
/** Per-file view: how often AI changed it and whether you have passed a lesson covering it. */
export function knowledgeMap(root) {
    const map = new Map();
    for (const lesson of listLessons(root)) {
        for (const file of lesson.changedFiles) {
            const entry = map.get(file) ?? { path: file, changes: 0, passed: 0, open: 0, lastChange: lesson.createdAt };
            entry.changes += 1;
            if (lesson.status === "passed")
                entry.passed += 1;
            else
                entry.open += 1;
            if (lesson.createdAt > entry.lastChange)
                entry.lastChange = lesson.createdAt;
            map.set(file, entry);
        }
    }
    return [...map.values()].sort((a, b) => b.open - a.open || b.lastChange.localeCompare(a.lastChange));
}
