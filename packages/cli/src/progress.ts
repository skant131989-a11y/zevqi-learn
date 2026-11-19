import { knowledgeMap, pending } from "./lessons.js";

/** Where the developer stands after a quiz: how much of what the agent changed they have reviewed, and what is next. Local only. */
export type Progress = { filesTotal: number; filesUnderstood: number; filesWaiting: number; waiting: number; nextId: string | null };

export function reviewProgress(root: string): Progress {
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

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One line for the end of a quiz, in the terminal and in the browser. */
export function progressLine(p: Progress): string {
  if (p.filesTotal === 0) return "";
  const head = `${p.filesUnderstood} of ${plural(p.filesTotal, "AI-changed file", "AI-changed files")} reviewed`;
  return p.waiting > 0 ? `${head}. ${plural(p.waiting, "lesson", "lessons")} still waiting.` : `${head}. Nothing else is waiting.`;
}
