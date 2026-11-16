import path from "node:path";
import { loadProject, projectDir } from "../config.js";
import { changedFiles } from "../git.js";
import { AiError, explainJob, hooksInstalled } from "../hooks.js";
import { getLesson, knowledgeMap, listLessons, pending } from "../lessons.js";
import { maybeNudge } from "../nudge.js";
import { runQuiz } from "../quiz.js";
import { startServer } from "../server.js";
import { bar, computeStats } from "../stats.js";
import { c, fail, timeAgo, uid, writeJson } from "../util.js";
import { emit, flagStr, needEnabled, needRoot, type Command } from "../context.js";

export const explain: Command = {
  name: "explain",
  group: "Daily use",
  summary: "Explain your current uncommitted changes now",
  usage: "zlearn explain",
  async run(ctx) {
    // Internal: the Stop hook launches `zlearn explain --job <id> --root <dir>` as a detached background process.
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
    const files = changedFiles(root);
    if (files.length === 0) return void console.log("No uncommitted changes to explain.");
    const jobId = uid("job_");
    writeJson(path.join(projectDir(root), "jobs", `${jobId}.json`), { files });
    console.log(c.dim(`Explaining ${files.length} changed file${files.length === 1 ? "" : "s"}…`));
    try {
      const lesson = await explainJob(root, jobId);
      if (!lesson) return void console.log("Nothing to explain.");
      console.log(`${c.green("✓")} Lesson ready. Run: ${c.bold("zlearn learn")}`);
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
  usage: "zlearn learn [lessonId]",
  async run(ctx) {
    const root = needEnabled();
    const open = pending(root).reverse();
    const id = ctx.args[0];
    const lesson = id ? getLesson(root, id) : open[0];
    if (!lesson) return void console.log(id ? "No such lesson." : `${c.green("✓")} Nothing waiting. You are up to date.`);
    await runQuiz(root, lesson);
    const left = pending(root).length;
    if (left) console.log(c.dim(`${left} more waiting. Run zlearn learn again.`));
  },
};

export const status: Command = {
  name: "status",
  group: "Daily use",
  summary: "What is waiting for review, and which files nobody has reviewed",
  usage: "zlearn status [--json]",
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
  usage: "zlearn stats [--json]",
  run(ctx) {
    const root = needEnabled();
    const s = computeStats(listLessons(root));
    emit(ctx, s, () => {
      console.log(`${c.bold(`Level ${s.level} · ${s.levelName}`)}   ${c.cyan(bar(s.levelProgress))}  ${s.xp} XP${s.xpToNext ? c.dim(`  (${s.xpToNext} to next level)`) : c.dim("  (top level)")}`);
      console.log(`${c.bold("Streak")}        ${s.streak > 0 ? c.yellow(`${s.streak} day${s.streak === 1 ? "" : "s"}`) : c.dim("none yet")}  ${c.dim(`best ${s.bestStreak}`)}`);
      console.log(`${c.bold("Understood")}    ${s.filesUnderstood} file${s.filesUnderstood === 1 ? "" : "s"} · ${s.passed} lesson${s.passed === 1 ? "" : "s"} passed · ${s.weekPassed} in the last 7 days`);
      if (s.pending) console.log(c.dim(`${s.pending} lesson${s.pending === 1 ? "" : "s"} waiting. Run zlearn learn.`));
      else if (s.streak === 0) console.log(c.dim("Pass a lesson today to start a streak."));
    });
    maybeNudge(root, { json: ctx.json });
  },
};

export const ui: Command = {
  name: "ui",
  group: "Daily use",
  summary: "Open the local dashboard in your browser",
  usage: "zlearn ui [--port 4317]",
  run(ctx) {
    const root = needEnabled();
    const port = Number(flagStr(ctx.flags.port)) || 4317;
    startServer(root, port, (url) => console.log(`zlearn dashboard: ${c.cyan(url)}\n${c.dim("Press Ctrl+C to stop.")}`));
  },
};
