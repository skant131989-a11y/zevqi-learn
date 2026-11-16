import readline from "node:readline/promises";
import { loadProject } from "./config.js";
import { complete, listLessons, type Lesson } from "./lessons.js";
import { maybeNudge } from "./nudge.js";
import { bar, computeStats } from "./stats.js";
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
  const before = computeStats(listLessons(root));
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
  printProgress(before, computeStats(listLessons(root)), done.status === "passed");
  await syncLesson(done, cfg.share);
  maybeNudge(root);
  return done;
}

export async function syncLesson(lesson: Lesson, share: "scores" | "summaries") {
  const result = await pushRecords([toRecord(lesson, share)]);
  if (result.error) console.log(c.dim(`(team sync queued: ${result.error})`));
}

/** Short reward line after a quiz: XP earned, streak and level. Rewards understanding, never guilt. */
function printProgress(before: ReturnType<typeof computeStats>, after: ReturnType<typeof computeStats>, passed: boolean) {
  const gained = after.xp - before.xp;
  const parts = [c.bold(`+${gained} XP`)];
  if (after.streak > 0) parts.push(c.yellow(`${after.streak}-day streak`));
  parts.push(`Level ${after.level} ${after.levelName}`);
  console.log(parts.join(c.dim("  ·  ")));
  console.log(c.cyan(bar(after.levelProgress)) + c.dim(after.xpToNext ? `  ${after.xpToNext} XP to next level` : "  top level"));
  if (after.level > before.level) console.log(c.green(`Level up! You are now a ${after.levelName}.`));
  else if (passed && after.streak > before.streak && after.streak >= 3) console.log(c.green(`${after.streak} days in a row. Keep it going.`));
}
