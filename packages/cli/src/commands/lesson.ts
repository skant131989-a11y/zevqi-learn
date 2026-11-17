import { loadProject } from "../config.js";
import { AiError, validate } from "../ai.js";
import { changedFiles, fileRevs, filesInCommit, repoName } from "../git.js";
import { newLessonId, saveLesson, type Lesson } from "../lessons.js";
import { pushRecords, toRecord } from "../team.js";
import { c, fail, readStdin } from "../util.js";
import { emit, flagStr, needEnabled, type Command } from "../context.js";

const SCHEMA = `{
  "summary": "3 to 5 plain sentences: what changed and why it matters",
  "files": [{ "path": "src/a.ts", "note": "one sentence: what this file's change does" }],
  "decisions": ["up to 3 design decisions visible in the code"],
  "depends": ["up to 3 things this code relies on"],
  "risks": ["up to 2 ways this could break or surprise someone"],
  "questions": [
    { "kind": "Why | Failure case | Assumption | Dependency", "q": "...", "options": ["...", "...", "...", "..."], "answer": 0, "why": "..." }
  ]
}`;

/**
 * `zlearn lesson add`: save a lesson that the developer's own coding agent wrote (Codex, Cursor, Claude Code, anything that can run
 * a shell command). It replaces the separate model call, so no API key is needed. The files come from git, not from the agent,
 * so a lesson can only describe files that really changed.
 */
export const lesson: Command = {
  name: "lesson",
  group: "Daily use",
  summary: "Save a lesson your coding agent wrote (JSON on stdin), so no API key is needed",
  usage: "zlearn lesson add [--files a.ts,b.ts] [--commit <ref>] [--json]  |  zlearn lesson schema",
  examples: ["zlearn lesson schema", "cat lesson.json | zlearn lesson add", "cat lesson.json | zlearn lesson add --commit HEAD"],
  async run(ctx) {
    const sub = ctx.args[0];
    if (sub === "schema") return void console.log(SCHEMA);
    if (sub !== "add") fail("Usage: zlearn lesson add  (lesson JSON on stdin)  |  zlearn lesson schema", 2);

    const root = needEnabled();
    const raw = await readStdin();
    if (!raw.trim()) fail("Pipe the lesson JSON on stdin.", 2, "See the format: zlearn lesson schema");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      fail("The lesson is not valid JSON.", 2, "See the format: zlearn lesson schema");
    }

    // Which files does this lesson cover? Explicit, a commit, or what is changed right now (falling back to the last commit).
    // Files zlearn itself manages are never "the change" when detected automatically. An explicit --files list is always respected.
    const own = new Set(["AGENTS.md", "CLAUDE.md", ".gitignore"]);
    const hidden = (f: string) => f.startsWith(".zlearn/") || f.startsWith(".claude/") || own.has(f);
    const explicit = flagStr(ctx.flags.files);
    const commit = flagStr(ctx.flags.commit);
    let files = explicit ? explicit.split(",").map((f) => f.trim()).filter(Boolean) : commit ? filesInCommit(root, commit) : changedFiles(root);
    if (!explicit && !commit && files.filter((f) => !hidden(f)).length === 0) files = filesInCommit(root, "HEAD");
    const cfg = loadProject(root);
    files = (explicit ? files : files.filter((f) => !hidden(f))).slice(0, cfg.maxFiles);
    if (files.length === 0) fail("There are no changed files to attach this lesson to.", 1, "Pass --files a.ts,b.ts or --commit <ref>.");

    let explanation;
    try {
      explanation = validate(parsed, files);
    } catch (e) {
      fail(e instanceof AiError ? e.message : String(e), 2, "See the format: zlearn lesson schema");
    }

    const repo = repoName(root);
    const made: Lesson = {
      id: newLessonId(),
      createdAt: new Date().toISOString(),
      repo,
      files: explanation.files,
      changedFiles: files,
      summary: explanation.summary,
      questions: explanation.questions,
      status: "pending",
      kind: "change",
      explainer: "agent",
      revs: fileRevs(root, files),
      decisions: explanation.decisions,
      depends: explanation.depends,
      risks: explanation.risks,
    };
    saveLesson(root, made);
    const sync = await pushRecords([toRecord(made, cfg.share)]);
    emit(ctx, { id: made.id, files, questions: made.questions.length, synced: sync.sent > 0, queued: sync.queued }, () => {
      console.log(`${c.green("✓")} Lesson ${made.id} saved for ${files.length} file${files.length === 1 ? "" : "s"} (${made.questions.length} questions). Take it with: ${c.bold("zlearn learn")}`);
      if (sync.error) console.log(c.dim(`(team sync queued: ${sync.error})`));
    });
  },
};
