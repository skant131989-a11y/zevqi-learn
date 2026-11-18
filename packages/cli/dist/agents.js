import fs from "node:fs";
import path from "node:path";
// One instruction block that works with any coding agent that reads AGENTS.md (Codex, Cursor and others), and with Claude Code
// through a one-line import in CLAUDE.md. The agent that just wrote the change also writes the lesson and hands it to
// `zlearn lesson add`, so no separate model key is needed. Everything zlearn adds sits between markers, so it can be updated
// and removed cleanly without touching the rest of the file.
export const START = "<!-- zlearn:start -->";
export const END = "<!-- zlearn:end -->";
const IMPORT_START = "<!-- zlearn:import -->";
const IMPORT_END = "<!-- zlearn:import-end -->";
export const BLOCK = `${START}
## Zevqi: turn your changes into a lesson

When you finish a task that changed code, and the \`zlearn\` command is available, write a short lesson for the developer and save it. Skip this step if \`zlearn\` is not installed, or if you only changed documentation or formatting.

1. Read your own diff (\`git diff\`, or \`git show HEAD\` if you already committed).
2. Pipe ONE JSON object to \`zlearn lesson add\` on stdin:

\`\`\`json
{
  "summary": "3 to 5 plain sentences: what changed and why it matters",
  "files": [{ "path": "src/a.ts", "note": "one sentence: what this file's change does" }],
  "decisions": ["up to 3 design decisions visible in the code"],
  "depends": ["up to 3 things this code relies on: modules, tables, services, caller assumptions"],
  "risks": ["up to 2 ways this could break or surprise someone, starting with what you are least sure about"],
  "questions": [
    { "kind": "Why", "q": "...", "options": ["...", "...", "...", "..."], "answer": 0, "why": "one sentence explaining the right answer" }
  ]
}
\`\`\`

3. Write exactly 3 questions: one \`Why\` (why the change was needed or is written this way), one \`Failure case\` (a concrete scenario where something goes wrong or partly fails, and what happens), and one \`Assumption\` or \`Dependency\` (what must be true for the code to be correct). Each has 4 options with exactly one correct; \`answer\` is its zero-based index, and you should vary it. Test understanding of behaviour and risk, never names or trivia. Be specific to this diff, and say plainly where you are unsure.
4. Do not include secrets or long code excerpts. Do not ask the developer to review it now: they take the questions later with \`zlearn learn\`.
${END}`;
const eolOf = (s) => (s.includes("\r\n") ? "\r\n" : "\n");
const withEol = (text, eol) => text.replace(/\r?\n/g, eol);
const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null);
function replaceOrAppend(text, block, start, end) {
    if (text === null)
        return { text: block + "\n", state: "created" };
    const eol = eolOf(text);
    const b = withEol(block, eol);
    const i = text.indexOf(start);
    const j = text.indexOf(end);
    if (i >= 0 && j > i) {
        const next = text.slice(0, i) + b + text.slice(j + end.length);
        return { text: next, state: next === text ? "unchanged" : "updated" };
    }
    const sep = text.length === 0 || text.endsWith(eol + eol) ? "" : text.endsWith(eol) ? eol : eol + eol;
    return { text: text + sep + b + eol, state: "updated" };
}
/** Adds the lesson instructions to AGENTS.md, and makes Claude Code read them through CLAUDE.md. Safe to run again. */
export function installAgentBlock(root) {
    const agentsFile = path.join(root, "AGENTS.md");
    const a = replaceOrAppend(read(agentsFile), BLOCK, START, END);
    if (a.state !== "unchanged")
        fs.writeFileSync(agentsFile, a.text);
    // Claude Code reads CLAUDE.md, not AGENTS.md, but CLAUDE.md can import another file with @path.
    const claudeFile = path.join(root, "CLAUDE.md");
    const existing = read(claudeFile);
    let claudeMd = "none";
    if (existing === null || (!/^\s*@AGENTS\.md\s*$/m.test(existing) && !existing.includes(IMPORT_START))) {
        const importBlock = `${IMPORT_START}\n@AGENTS.md\n${IMPORT_END}`;
        const c = replaceOrAppend(existing, importBlock, IMPORT_START, IMPORT_END);
        fs.writeFileSync(claudeFile, c.text);
        claudeMd = c.state;
    }
    return { agentsMd: a.state, claudeMd };
}
/** True when the lesson instructions are present in AGENTS.md. */
export function agentBlockInstalled(root) {
    const t = read(path.join(root, "AGENTS.md"));
    return Boolean(t && t.includes(START) && t.includes(END));
}
function strip(text, start, end) {
    const i = text.indexOf(start);
    const j = text.indexOf(end);
    if (i < 0 || j <= i)
        return text;
    const eol = eolOf(text);
    let before = text.slice(0, i);
    let after = text.slice(j + end.length);
    after = after.replace(/^\r?\n/, "");
    before = before.replace(/(\r?\n){2,}$/, eol).replace(/^(\r?\n)+$/, "");
    return before + after;
}
/** Removes only what zlearn added. A file that held nothing else is deleted. */
export function removeAgentBlock(root) {
    const out = { agentsMd: false, claudeMd: false };
    for (const [name, start, end, key] of [
        ["AGENTS.md", START, END, "agentsMd"],
        ["CLAUDE.md", IMPORT_START, IMPORT_END, "claudeMd"],
    ]) {
        const f = path.join(root, name);
        const t = read(f);
        if (t === null || !t.includes(start))
            continue;
        const next = strip(t, start, end);
        if (next.trim() === "")
            fs.rmSync(f, { force: true });
        else
            fs.writeFileSync(f, next.endsWith("\n") ? next : next + eolOf(t));
        out[key] = true;
    }
    return out;
}
