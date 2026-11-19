import fs from "node:fs";
import path from "node:path";
import { loadProject, projectDir } from "../config.js";
import { branchBase, canonicalPath, changedFiles, diffForBranch, diffForHistory, dirtyAmong, fileRevs, headSha, repoName, repoRoot } from "../git.js";
import { changedSince } from "../git.js";
import { execFileSync } from "node:child_process";
import { explainDiff } from "../ai.js";
import { attestReview } from "../attest.js";
import { apiKey, loadGlobal } from "../config.js";
import { newLessonId, saveLesson, type Lesson } from "../lessons.js";
import { pushRecords, toRecord } from "../team.js";
import { AiError, explainJob, hooksInstalled } from "../hooks.js";
import { getLesson, knowledgeMap, listLessons, pending } from "../lessons.js";
import { maybeNudge } from "../nudge.js";
import { runQuiz } from "../quiz.js";
import { openBrowser, shouldOpenBrowser } from "../open.js";
import { pageUrl, startServer } from "../server.js";
import { bar, computeStats } from "../stats.js";
import { c, fail, timeAgo, uid, writeJson } from "../util.js";
import { emit, ensureAiNotice, flagStr, needEnabled, needRoot, type Command, type Context } from "../context.js";

export const explain: Command = {
  name: "explain",
  group: "Daily use",
  summary: "Explain your current uncommitted changes now",
  usage: "zevqi explain",
  async run(ctx) {
    // Internal: the Stop hook launches `zevqi explain --job <id> --root <dir>` as a detached background process.
    const job = flagStr(ctx.flags.job);
    if (job) {
      const root = flagStr(ctx.flags.root) ?? needRoot();
      try {
        await explainJob(root, job);
      } catch (e) {
        writeJson(path.join(projectDir(root), "last-error.json"), { at: new Date().toISOString(), message: e instanceof Error ? e.message : String(e) });
      }
      return;
    }
    const root = needEnabled();
    ensureAiNotice(root);
    const files = changedFiles(root);
    if (files.length === 0) return void console.log("No uncommitted changes to explain.");
    const jobId = uid("job_");
    writeJson(path.join(projectDir(root), "jobs", `${jobId}.json`), { files });
    console.log(c.dim(`Explaining ${files.length} changed file${files.length === 1 ? "" : "s"}…`));
    try {
      const lesson = await explainJob(root, jobId);
      if (!lesson) return void console.log("Nothing to explain.");
      console.log(`${c.green("✓")} Lesson ready. Run: ${c.bold("zevqi learn")}`);
    } catch (e) {
      fail(e instanceof AiError ? e.message : String(e));
    }
  },
};

export const learn: Command = {
  name: "learn",
  aliases: ["quiz"],
  group: "Daily use",
  summary: "Take the quiz for the oldest un-reviewed change",
  usage: "zevqi learn [lessonId]",
  async run(ctx) {
    const root = needEnabled();
    const open = pending(root).reverse();
    const id = ctx.args[0];
    const lesson = id ? getLesson(root, id) : open[0];
    if (!lesson) return void console.log(id ? "No such lesson." : `${c.green("✓")} Nothing waiting. You are up to date.`);
    await runQuiz(root, lesson);
    const left = pending(root).length;
    if (left) console.log(c.dim(`${left} more waiting. Run zevqi again.`));
  },
};

export const review: Command = {
  name: "review",
  group: "Daily use",
  summary: "Review recent committed changes to files (a teammate's, or your own from earlier) and add your evidence",
  usage: "zevqi review <file...> [--commits 5] [--no-ai]  |  zevqi review --branch [--base origin/main]  |  zevqi review --pr <number>",
  examples: [
    "zevqi review src/payments/refund.ts",
    "zevqi review src/auth/session.ts src/auth/tokens.ts --commits 3",
    "zevqi review --branch                 # the files this branch changes, compared with main",
    "zevqi review --pr 123                 # same, for a pull request you have checked out (gh pr checkout 123)",
  ],
  async run(ctx) {
    const root = needEnabled();
    ensureAiNotice(root);
    const branchMode = Boolean(ctx.flags.branch || ctx.flags.pr);
    const wanted = ctx.args.map((f) => f.trim()).filter(Boolean);
    if (wanted.length === 0 && !branchMode) fail("Name the files to review.", 2, "Example: zevqi review src/payments/refund.ts, or review a whole branch: zevqi review --branch");
    const commits = Math.max(1, Math.min(20, Number(flagStr(ctx.flags.commits)) || 5));
    const cfg = loadProject(root);
    let branchSource: { title: string; more: string } | undefined;
    // Canonical paths on both sides: a Windows short name (RUNNER~1) or a symlinked cwd must not make a file look like it is outside the repo.
    let files = wanted.slice(0, cfg.maxFiles).map((f) => path.relative(canonicalPath(root), canonicalPath(path.resolve(process.cwd(), f))).split(path.sep).join("/"));
    let diff: { text: string; included: string[] };
    if (branchMode) {
      // A branch or pull request review: the files it changes against its base, read as the reviewer has them checked out.
      const prNumber = flagStr(ctx.flags.pr);
      let baseFlag = flagStr(ctx.flags.base);
      if (ctx.flags.pr) {
        if (!prNumber || !/^\d+$/.test(prNumber)) fail("--pr needs the pull request number.", 2, "Example: zevqi review --pr 123");
        let info: { baseRefName?: string; headRefOid?: string };
        try {
          info = JSON.parse(execFileSync("gh", ["pr", "view", prNumber, "--json", "baseRefName,headRefOid"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
        } catch {
          return fail("Could not read that pull request with the GitHub CLI.", 1, "Install gh and sign in (gh auth login), or review the branch you have checked out with: zevqi review --branch");
        }
        if (info.headRefOid && headSha(root) !== info.headRefOid) fail(`You are not on the latest commit of pull request #${prNumber}.`, 1, `Check it out first: gh pr checkout ${prNumber}`);
        baseFlag = baseFlag ?? (info.baseRefName ? `origin/${info.baseRefName}` : undefined);
      }
      const base = branchBase(root, baseFlag);
      if (!base) fail("Could not find a base branch to compare with.", 1, "Pass one: zevqi review --branch --base origin/main");
      files = changedSince(root, base).slice(0, cfg.maxFiles);
      if (files.length === 0) return void console.log(`This branch has no changes compared with ${base}.`);
      const dirty = dirtyAmong(root, files);
      if (dirty.length) fail(`These files have uncommitted changes: ${dirty.slice(0, 5).join(", ")}.`, 1, "A review records the files as committed. Commit or stash first, so the evidence matches what gets merged.");
      diff = diffForBranch(root, base, files);
      branchSource = { title: `Read this branch (${diff.included.length} file${diff.included.length === 1 ? "" : "s"} changed compared with ${base})`, more: `git diff ${base}...HEAD` };
    } else {
      diff = diffForHistory(root, files, commits);
    }
    const { text, included } = diff;
    if (!text.trim()) return void console.log("No git history found for those files. Check the paths, and that the changes are committed.");
    // With a model key the review is AI-written questions. Without one (or with --no-ai) you read the change and describe it yourself.
    if (ctx.flags["no-ai"] || !apiKey(loadGlobal())) {
      try {
        await attestReview(root, included, text, commits, branchSource);
      } catch (e) {
        fail(e instanceof Error ? e.message : String(e));
      }
      return;
    }
    console.log(c.dim(branchSource ? `Reading the branch changes for ${included.length} file${included.length === 1 ? "" : "s"}…` : `Reading the last ${commits} commit${commits === 1 ? "" : "s"} for ${included.length} file${included.length === 1 ? "" : "s"}…`));
    try {
      const explanation = await explainDiff(text, included, repoName(root), "review");
      const lesson: Lesson = {
        id: newLessonId(),
        createdAt: new Date().toISOString(),
        repo: repoName(root),
        files: explanation.files,
        changedFiles: included,
        summary: explanation.summary,
        questions: explanation.questions,
        status: "pending",
        kind: "review",
        revs: fileRevs(root, included),
        decisions: explanation.decisions,
        depends: explanation.depends,
        risks: explanation.risks,
      };
      saveLesson(root, lesson);
      await pushRecords([toRecord(lesson, cfg.share)]);
      await runQuiz(root, lesson);
    } catch (e) {
      fail(e instanceof AiError ? e.message : String(e));
    }
  },
};

export const status: Command = {
  name: "status",
  group: "Daily use",
  summary: "What is waiting for review, and which files nobody has reviewed",
  usage: "zevqi status [--json]",
  run(ctx) {
    const root = needEnabled();
    const lessons = listLessons(root);
    const open = lessons.filter((l) => l.status === "pending");
    const cfg = loadProject(root);
    const blind = knowledgeMap(root).filter((f) => f.open > 0 && f.passed === 0);
    const hooks = hooksInstalled(root);
    emit(ctx, { waiting: open.length, passed: lessons.filter((l) => l.status === "passed").length, gate: cfg.gate, hooks, waitingLessons: open.map((l) => ({ id: l.id, files: l.changedFiles, createdAt: l.createdAt })), blindSpots: blind.map((f) => f.path) }, () => {
      console.log(`${c.bold(String(open.length))} waiting for review · ${lessons.filter((l) => l.status === "passed").length} passed · gate: ${cfg.gate} · hooks: ${hooks.join(", ") || c.red("not installed")}`);
      for (const l of open.slice(0, 5)) console.log(`  ${c.dim(timeAgo(l.createdAt).padEnd(8))} ${l.changedFiles.slice(0, 3).join(", ")}${l.changedFiles.length > 3 ? "…" : ""}  ${c.dim(l.id)}`);
      if (blind.length) console.log(c.yellow("Not reviewed yet: ") + blind.slice(0, 5).map((f) => f.path).join(", "));
    });
    maybeNudge(root, { json: ctx.json });
  },
};

export const stats: Command = {
  name: "stats",
  group: "Daily use",
  summary: "Your streak, XP and level for this project",
  usage: "zevqi stats [--json]",
  run(ctx) {
    const root = needEnabled();
    const s = computeStats(listLessons(root));
    emit(ctx, s, () => {
      console.log(`${c.bold(`Level ${s.level} · ${s.levelName}`)}   ${c.cyan(bar(s.levelProgress))}  ${s.xp} XP${s.xpToNext ? c.dim(`  (${s.xpToNext} to next level)`) : c.dim("  (top level)")}`);
      console.log(`${c.bold("Streak")}        ${s.streak > 0 ? c.yellow(`${s.streak} day${s.streak === 1 ? "" : "s"}`) : c.dim("none yet")}  ${c.dim(`best ${s.bestStreak}`)}`);
      console.log(`${c.bold("Understood")}    ${s.filesUnderstood} file${s.filesUnderstood === 1 ? "" : "s"} · ${s.passed} lesson${s.passed === 1 ? "" : "s"} passed · ${s.weekPassed} in the last 7 days`);
      if (s.pending) console.log(c.dim(`${s.pending} lesson${s.pending === 1 ? "" : "s"} waiting. Run zevqi learn.`));
      else if (s.streak === 0) console.log(c.dim("Pass a lesson today to start a streak."));
    });
    maybeNudge(root, { json: ctx.json });
  },
};

export const ui: Command = {
  name: "ui",
  group: "Daily use",
  summary: "Open the local dashboard in your browser, at the lesson waiting for you",
  usage: "zevqi ui [--port 4317] [--no-open]",
  run(ctx) {
    openDashboard(needEnabled(), ctx.flags);
  },
};

/** Starts the local dashboard and opens it. With a lesson waiting, the browser lands on that lesson. */
function openDashboard(root: string, flags: Record<string, string | true>): void {
  const explicit = flagStr(flags.port);
  const next = [...pending(root)].reverse()[0];
  startServer(
    root,
    Number(explicit) || 4317,
    (base) => {
      const target = next ? pageUrl(base, `/lesson/${next.id}`) : base;
      console.log(`zevqi dashboard: ${c.cyan(target)}`);
      if (shouldOpenBrowser(flags) && openBrowser(target)) console.log(c.dim(next ? "Opened your browser at the lesson that is waiting." : "Opened your browser."));
      console.log(c.dim("Press Ctrl+C to stop."));
    },
    {
      tries: explicit ? 1 : 10, // the default port moves on to the next free one; a port you asked for must be that port
      onError: (e, port) => {
        console.error(c.red(`zevqi: could not start the dashboard on port ${port} (${e.code ?? e.message}).`));
        console.error(c.dim("Try another port: zevqi ui --port 4400"));
        process.exitCode = 1;
      },
    }
  );
}

/**
 * `zevqi` on its own. In a repository where Zevqi is on: lessons waiting open the dashboard (in a terminal), otherwise the status.
 * Returns false when there is nothing to do here, and the caller shows the help instead.
 */
export async function defaultAction(ctx: Context): Promise<boolean> {
  const root = repoRoot(process.cwd());
  if (!root || !fs.existsSync(projectDir(root))) return false;
  if (!ctx.json && process.stdout.isTTY && pending(root).length > 0) {
    openDashboard(root, ctx.flags);
    return true;
  }
  await status.run(ctx);
  return true;
}
