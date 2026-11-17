import path from "node:path";
import { loadProject, projectDir } from "../config.js";
import { canonicalPath, changedFiles, diffForHistory, fileRevs, repoName } from "../git.js";
import { explainDiff } from "../ai.js";
import { attestReview } from "../attest.js";
import { apiKey, loadGlobal } from "../config.js";
import { newLessonId, saveLesson } from "../lessons.js";
import { pushRecords, toRecord } from "../team.js";
import { AiError, explainJob, hooksInstalled } from "../hooks.js";
import { getLesson, knowledgeMap, listLessons, pending } from "../lessons.js";
import { maybeNudge } from "../nudge.js";
import { runQuiz } from "../quiz.js";
import { startServer } from "../server.js";
import { bar, computeStats } from "../stats.js";
import { c, fail, timeAgo, uid, writeJson } from "../util.js";
import { emit, ensureAiNotice, flagStr, needEnabled, needRoot } from "../context.js";
export const explain = {
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
            }
            catch (e) {
                writeJson(path.join(projectDir(root), "last-error.json"), { at: new Date().toISOString(), message: e instanceof Error ? e.message : String(e) });
            }
            return;
        }
        const root = needEnabled();
        ensureAiNotice(root);
        const files = changedFiles(root);
        if (files.length === 0)
            return void console.log("No uncommitted changes to explain.");
        const jobId = uid("job_");
        writeJson(path.join(projectDir(root), "jobs", `${jobId}.json`), { files });
        console.log(c.dim(`Explaining ${files.length} changed file${files.length === 1 ? "" : "s"}…`));
        try {
            const lesson = await explainJob(root, jobId);
            if (!lesson)
                return void console.log("Nothing to explain.");
            console.log(`${c.green("✓")} Lesson ready. Run: ${c.bold("zlearn learn")}`);
        }
        catch (e) {
            fail(e instanceof AiError ? e.message : String(e));
        }
    },
};
export const learn = {
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
        if (!lesson)
            return void console.log(id ? "No such lesson." : `${c.green("✓")} Nothing waiting. You are up to date.`);
        await runQuiz(root, lesson);
        const left = pending(root).length;
        if (left)
            console.log(c.dim(`${left} more waiting. Run zlearn learn again.`));
    },
};
export const review = {
    name: "review",
    group: "Daily use",
    summary: "Review recent committed changes to files (a teammate's, or your own from earlier) and add your evidence",
    usage: "zlearn review <file...> [--commits 5] [--no-ai]",
    examples: [
        "zlearn review src/payments/refund.ts",
        "zlearn review src/auth/session.ts src/auth/tokens.ts --commits 3",
    ],
    async run(ctx) {
        const root = needEnabled();
        ensureAiNotice(root);
        const wanted = ctx.args.map((f) => f.trim()).filter(Boolean);
        if (wanted.length === 0)
            fail("Name the files to review.", 2, "Example: zlearn review src/payments/refund.ts");
        const commits = Math.max(1, Math.min(20, Number(flagStr(ctx.flags.commits)) || 5));
        const cfg = loadProject(root);
        // Canonical paths on both sides: a Windows short name (RUNNER~1) or a symlinked cwd must not make a file look like it is outside the repo.
        const files = wanted.slice(0, cfg.maxFiles).map((f) => path.relative(canonicalPath(root), canonicalPath(path.resolve(process.cwd(), f))).split(path.sep).join("/"));
        const { text, included } = diffForHistory(root, files, commits);
        if (!text.trim())
            return void console.log("No git history found for those files. Check the paths, and that the changes are committed.");
        // With a model key the review is AI-written questions. Without one (or with --no-ai) you read the change and describe it yourself.
        if (ctx.flags["no-ai"] || !apiKey(loadGlobal())) {
            try {
                await attestReview(root, included, text, commits);
            }
            catch (e) {
                fail(e instanceof Error ? e.message : String(e));
            }
            return;
        }
        console.log(c.dim(`Reading the last ${commits} commit${commits === 1 ? "" : "s"} for ${included.length} file${included.length === 1 ? "" : "s"}…`));
        try {
            const explanation = await explainDiff(text, included, repoName(root), "review");
            const lesson = {
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
        }
        catch (e) {
            fail(e instanceof AiError ? e.message : String(e));
        }
    },
};
export const status = {
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
            for (const l of open.slice(0, 5))
                console.log(`  ${c.dim(timeAgo(l.createdAt).padEnd(8))} ${l.changedFiles.slice(0, 3).join(", ")}${l.changedFiles.length > 3 ? "…" : ""}  ${c.dim(l.id)}`);
            if (blind.length)
                console.log(c.yellow("Not reviewed yet: ") + blind.slice(0, 5).map((f) => f.path).join(", "));
        });
        maybeNudge(root, { json: ctx.json });
    },
};
export const stats = {
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
            if (s.pending)
                console.log(c.dim(`${s.pending} lesson${s.pending === 1 ? "" : "s"} waiting. Run zlearn learn.`));
            else if (s.streak === 0)
                console.log(c.dim("Pass a lesson today to start a streak."));
        });
        maybeNudge(root, { json: ctx.json });
    },
};
export const ui = {
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
