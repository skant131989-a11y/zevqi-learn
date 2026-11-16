import readline from "node:readline/promises";
import { loadProject } from "./config.js";
import { complete, type Lesson } from "./lessons.js";
import { pushRecords, toRecord } from "./team.js";
import { c } from "./util.js";

const LETTERS = ["A", "B", "C", "D"];

export function printLesson(lesson: Lesson) {
  console.log("\n" + c.bold(c.cyan("What your agent changed")));
  console.log(lesson.summary + "\n");
  for (const f of lesson.files) console.log(`  ${c.bold(f.path)}\n    ${c.dim(f.note)}`);
}

/** Interactive terminal quiz. Returns the completed lesson. */
export async function runQuiz(root: string, lesson: Lesson): Promise<Lesson> {
  const cfg = loadProject(root);
  printLesson(lesson);
  console.log("\n" + c.bold(`Quick check (${lesson.questions.length} questions, ${Math.round(cfg.passRatio * 100)}% to pass)`));
  const rl = readline.createInterface({ input: process.stdin });
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (prompt: string): Promise<string | null> => {
    process.stdout.write(prompt);
    const next = await lines.next();
    return next.done ? null : String(next.value);
  };
  let correct = 0;
  try {
    for (let i = 0; i < lesson.questions.length; i++) {
      const q = lesson.questions[i];
      console.log(`\n${c.bold(`${i + 1}. ${q.q}`)}`);
      q.options.forEach((o, n) => console.log(`   ${LETTERS[n]}) ${o}`));
      let pick = -1;
      while (pick < 0) {
        const answer = await ask(c.dim("   Your answer (A-D): "));
        if (answer === null) throw new Error("Input closed before the quiz was finished.");
        const raw = answer.trim().toUpperCase();
        const idx = LETTERS.indexOf(raw[0] ?? "");
        if (idx >= 0 && idx < q.options.length) pick = idx;
      }
      if (pick === q.answer) {
        correct += 1;
        console.log(c.green("   Correct. ") + c.dim(q.why));
      } else {
        console.log(c.red(`   Not quite. Answer: ${LETTERS[q.answer]}. `) + c.dim(q.why));
      }
    }
  } finally {
    rl.close();
  }
  const done = complete(root, lesson, correct, cfg.passRatio);
  console.log("\n" + (done.status === "passed" ? c.green(`Passed ${correct}/${done.total}.`) : c.yellow(`${correct}/${done.total}. Re-read the summary, then run zlearn learn again.`)));
  await syncLesson(done, cfg.share);
  return done;
}

export async function syncLesson(lesson: Lesson, share: "scores" | "summaries") {
  const result = await pushRecords([toRecord(lesson, share)]);
  if (result.error) console.log(c.dim(`(team sync queued: ${result.error})`));
}
