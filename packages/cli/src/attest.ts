import readline from "node:readline/promises";
import { loadProject } from "./config.js";
import { fileRevs } from "./git.js";
import { newLessonId, RESPONSES, saveLesson, setResponse, type Lesson, type Response } from "./lessons.js";
import { pushRecords, toRecord } from "./team.js";
import { c } from "./util.js";

// Attested review: no model. The developer reads the real change, describes it in their own words, and says whether they
// understand it. That is evidence that a person read and engaged with the change. It is not graded and it is not a test.
// Their answers stay on their machine. Only the file paths, a content fingerprint and their own call are shared.

export const PROMPTS = [
  "In your own words, what does this change do?",
  "What could go wrong, or what happens when it fails?",
  "What does it depend on, or what did you have to assume?",
] as const;
export const MIN_ANSWER = 15;
const MAX_DIFF_LINES = 400;

/** An answer that is too short, or the same as another, is not a description. A cheap guard against clicking through, and easy to fake on purpose. */
export function answerProblem(answer: string, earlier: string[]): string | null {
  const a = answer.replace(/\s+/g, " ").trim();
  if (a.length < MIN_ANSWER) return `Say a little more (at least ${MIN_ANSWER} characters).`;
  if (earlier.some((e) => e.toLowerCase() === a.toLowerCase())) return "That is the same as an earlier answer. Describe this part separately.";
  return null;
}

export async function attestReview(root: string, included: string[], text: string, commits: number): Promise<Lesson | null> {
  const cfg = loadProject(root);
  console.log("\n" + c.bold(c.cyan(`Read this change (the last ${commits} commit${commits === 1 ? "" : "s"} touching ${included.length} file${included.length === 1 ? "" : "s"})`)));
  const lines = text.split("\n");
  console.log(lines.slice(0, MAX_DIFF_LINES).join("\n"));
  if (lines.length > MAX_DIFF_LINES) console.log(c.dim(`\n[… ${lines.length - MAX_DIFF_LINES} more lines. Read the rest with: git log -p -n ${commits} -- ${included.join(" ")}]`));
  console.log("\n" + c.bold("Describe it in your own words. Your answers stay on your machine, and nothing here is graded."));

  const rl = readline.createInterface({ input: process.stdin });
  const it = rl[Symbol.asyncIterator]();
  const ask = async (prompt: string): Promise<string | null> => {
    process.stdout.write(prompt);
    const n = await it.next();
    return n.done ? null : String(n.value);
  };
  const answers: string[] = [];
  let response: Response = "understood";
  let note: string | undefined;
  try {
    for (let i = 0; i < PROMPTS.length; i++) {
      for (let tries = 0; ; tries++) {
        const a = await ask(`\n${i + 1}. ${PROMPTS[i]}\n   > `);
        if (a === null) throw new Error("Input closed before the review was finished. Nothing was recorded.");
        const problem = answerProblem(a, answers);
        if (!problem) {
          answers.push(a.replace(/\s+/g, " ").trim());
          break;
        }
        console.log(c.yellow("   " + problem));
        if (tries >= 4) throw new Error("No usable answer. Nothing was recorded.");
      }
    }
    const call = await ask(c.dim("\nDo you feel you understand this change? [Y]es / [c]larification needed / [i]nvestigate further (Enter = yes): "));
    const key = (call ?? "").trim().toLowerCase()[0] || "y";
    response = RESPONSES[key] ?? "understood";
    if (response !== "understood") note = (await ask(c.dim("What is unclear? One line, optional: "))) ?? undefined;
  } finally {
    rl.close();
  }

  const now = new Date().toISOString();
  const lesson: Lesson = {
    id: newLessonId(),
    createdAt: now,
    completedAt: now,
    repo: "",
    files: included.map((path) => ({ path, note: "" })),
    changedFiles: included,
    summary: `Attested review of ${included.length} file${included.length === 1 ? "" : "s"}.`,
    questions: [],
    status: "passed",
    kind: "review",
    explainer: "none",
    revs: fileRevs(root, included),
    attest: answers,
  };
  const { repoName } = await import("./git.js");
  lesson.repo = repoName(root);
  saveLesson(root, lesson);
  const done = setResponse(root, lesson, response, note);
  const sync = await pushRecords([toRecord(done, cfg.share)]);
  console.log("\n" + c.green("✓") + (response === "understood" ? " Recorded: you read this change and described it in your own words." : " Recorded as an open question. It will not count as evidence of understanding until you follow up."));
  if (response !== "understood") console.log(c.dim(`When you have looked into it, run: zlearn review ${included[0] ?? "<file>"}`));
  if (sync.error) console.log(c.dim(`(team sync queued: ${sync.error})`));
  console.log(c.dim("This is evidence that you engaged with the change, not a score or a test. Your answers were not sent."));
  return done;
}
