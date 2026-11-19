import { knowledgeMap, pending } from "./lessons.js";
export function reviewProgress(root) {
    const files = knowledgeMap(root);
    const open = [...pending(root)].reverse(); // oldest first
    return {
        filesTotal: files.length,
        filesUnderstood: files.filter((f) => f.open === 0 && f.passed > 0).length,
        filesWaiting: files.filter((f) => f.open > 0).length,
        waiting: open.length,
        nextId: open[0]?.id ?? null,
    };
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
/** One line for the end of a quiz, in the terminal and in the browser. */
export function progressLine(p) {
    if (p.filesTotal === 0)
        return "";
    const head = `${p.filesUnderstood} of ${plural(p.filesTotal, "AI-changed file", "AI-changed files")} reviewed`;
    return p.waiting > 0 ? `${head}. ${plural(p.waiting, "lesson", "lessons")} still waiting.` : `${head}. Nothing else is waiting.`;
}
