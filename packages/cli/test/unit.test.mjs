import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const load = (rel) => import(pathToFileURL(path.join(DIST, rel)).href);

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-17T12:00:00Z");
const iso = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString();
const lesson = (over) => ({ id: "l_1", createdAt: iso(1), repo: "r", files: [], changedFiles: ["a.ts"], summary: "", questions: [], status: "passed", correct: 2, total: 3, completedAt: iso(1), ...over });

test("parseArgs handles positionals, flags, = form and terminator", async () => {
  const { parseArgs } = await load("args.js");
  assert.deepEqual(parseArgs(["learn", "l_abc"]), { _: ["learn", "l_abc"], flags: {} });
  assert.deepEqual(parseArgs(["init", "--gate", "block", "--shared"]).flags, { gate: "block", shared: true });
  assert.deepEqual(parseArgs(["ui", "--port=9000"]).flags, { port: "9000" });
  assert.deepEqual(parseArgs(["a", "--", "--not-a-flag"])._, ["a", "--not-a-flag"]);
  assert.equal(parseArgs(["--json"]).flags.json, true);
});

test("levelFor follows the XP curve and caps at the top level", async () => {
  const { levelFor, LEVELS } = await load("stats.js");
  assert.equal(levelFor(0).level, 1);
  assert.equal(levelFor(59).level, 1);
  assert.equal(levelFor(60).level, 2);
  assert.equal(levelFor(240).level, 3);
  assert.equal(levelFor(1_000_000).level, LEVELS.length);
  assert.equal(levelFor(1_000_000).toNext, 0);
  const mid = levelFor(90);
  assert.ok(mid.progress > 0 && mid.progress < 1);
});

test("computeStats awards XP for understanding", async () => {
  const { computeStats } = await load("stats.js");
  const s = computeStats(
    [
      lesson({ id: "l_1", correct: 3, total: 3 }), // 20 + 10 perfect
      lesson({ id: "l_2", correct: 2, total: 3 }), // 20
      lesson({ id: "l_3", status: "failed", correct: 1, total: 3 }), // 5
      lesson({ id: "l_4", status: "pending", correct: undefined, total: undefined }), // 0
    ],
    NOW
  );
  assert.equal(s.xp, 55);
  assert.equal(s.passed, 2);
  assert.equal(s.failed, 1);
  assert.equal(s.pending, 1);
  assert.equal(s.filesUnderstood, 1);
});

test("streaks count consecutive days and survive until the end of the next day", async () => {
  const { computeStats } = await load("stats.js");
  const days = (...ds) => ds.map((d, i) => lesson({ id: `l_${i}`, completedAt: iso(d), createdAt: iso(d) }));
  assert.equal(computeStats(days(0, 1, 2), NOW).streak, 3, "today, yesterday, day before");
  assert.equal(computeStats(days(1, 2), NOW).streak, 2, "still alive if today has no lesson yet");
  assert.equal(computeStats(days(2, 3), NOW).streak, 0, "broken after a full missed day");
  const gap = computeStats(days(0, 1, 5, 6, 7, 8), NOW);
  assert.equal(gap.streak, 2);
  assert.equal(gap.bestStreak, 4);
});

test("weekPassed only counts the last 7 days", async () => {
  const { computeStats } = await load("stats.js");
  const s = computeStats([lesson({ id: "l_1", completedAt: iso(1) }), lesson({ id: "l_2", completedAt: iso(10) })], NOW);
  assert.equal(s.weekPassed, 1);
});

test("bar renders a fixed-width progress bar", async () => {
  const { bar } = await load("stats.js");
  assert.equal(bar(0, 10), "░".repeat(10));
  assert.equal(bar(1, 10), "█".repeat(10));
  assert.equal(bar(0.5, 10), "█████░░░░░");
  assert.equal(bar(5, 4), "████", "clamps above 1");
});

test("complete() applies the pass ratio with float tolerance", async () => {
  const { complete } = await load("lessons.js");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zl-unit-"));
  const base = lesson({ status: "pending", questions: [{}, {}, {}], correct: undefined, total: undefined });
  assert.equal(complete(root, base, 2, 2 / 3).status, "passed", "2 of 3 passes at 2/3");
  assert.equal(complete(root, base, 1, 2 / 3).status, "failed");
  assert.equal(complete(root, { ...base, questions: [] }, 0, 2 / 3).status, "failed", "no questions never passes");
});

test("util helpers", async () => {
  const { mask, escapeHtml, toPosix, timeAgo } = await load("util.js");
  assert.equal(mask("sk-ant-secret-value"), "sk-ant…");
  assert.equal(mask(undefined), "(not set)");
  assert.equal(escapeHtml(`<a href="x">&'</a>`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
  assert.equal(toPosix("a\\b\\c.ts"), "a/b/c.ts");
  assert.equal(timeAgo(new Date().toISOString()), "just now");
  assert.match(timeAgo(new Date(Date.now() - 2 * 3_600_000).toISOString()), /^2h ago$/);
});

test("colour respects NO_COLOR and FORCE_COLOR", async () => {
  const { c } = await load("util.js");
  const prev = { n: process.env.NO_COLOR, f: process.env.FORCE_COLOR };
  try {
    process.env.NO_COLOR = "1";
    delete process.env.FORCE_COLOR;
    assert.equal(c.green("ok"), "ok");
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = "1";
    assert.equal(c.green("ok"), "\x1b[32mok\x1b[0m");
  } finally {
    if (prev.n === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = prev.n;
    if (prev.f === undefined) delete process.env.FORCE_COLOR; else process.env.FORCE_COLOR = prev.f;
  }
});

test("typo suggestions", async () => {
  const { suggest } = await load("commands/index.js");
  assert.equal(suggest("lern"), "learn");
  assert.equal(suggest("statuss"), "status");
  assert.equal(suggest("zzzzzzzz"), undefined);
  assert.equal(suggest("hook"), undefined, "hidden commands are never suggested");
});

test("shouldNudge only fires for real teams, once a week, in interactive terminals", async () => {
  const { shouldNudge } = await load("nudge.js");
  const base = { contributors: 5, onTeam: false, lastNudgeAt: null, now: NOW, interactive: true, disabled: false };
  assert.equal(shouldNudge(base), true);
  assert.equal(shouldNudge({ ...base, contributors: 2 }), false, "solo or pair repos are left alone");
  assert.equal(shouldNudge({ ...base, onTeam: true }), false, "already on a team");
  assert.equal(shouldNudge({ ...base, interactive: false }), false, "never in pipes or CI");
  assert.equal(shouldNudge({ ...base, disabled: true }), false, "opt-out respected");
  assert.equal(shouldNudge({ ...base, lastNudgeAt: NOW - 2 * DAY }), false, "at most weekly");
  assert.equal(shouldNudge({ ...base, lastNudgeAt: NOW - 8 * DAY }), true);
});

test("contributorCount counts distinct committers", async () => {
  const { contributorCount } = await load("git.js");
  const { execFileSync } = await import("node:child_process");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "zl-contrib-"));
  const git = (...a) => execFileSync("git", a, { cwd: repo, stdio: "ignore" });
  git("init", "-q");
  for (const [n, e] of [["A", "a@x.io"], ["B", "b@x.io"], ["B", "b@x.io"], ["C", "c@x.io"]]) git("-c", `user.name=${n}`, "-c", `user.email=${e}`, "commit", "--allow-empty", "-qm", "x");
  assert.equal(contributorCount(repo, 90), 3);
  assert.equal(contributorCount(os.tmpdir() + "/definitely-not-a-repo-zl", 90), 0);
});

test("canonicalPath resolves dot segments, works for files that do not exist yet, and matches realpath", async () => {
  const { canonicalPath } = await load("git.js");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zl-canon-"));
  fs.mkdirSync(path.join(dir, "src"));
  const real = fs.realpathSync.native(dir);
  assert.equal(canonicalPath(dir), real);
  assert.equal(canonicalPath(path.join(dir, "src", "..", "src")), path.join(real, "src"));
  // a brand-new file inside an existing directory canonicalises through its parent
  assert.equal(canonicalPath(path.join(dir, "src", "new-file.ts")), path.join(real, "src", "new-file.ts"));
  // and so does one inside a directory that does not exist yet
  assert.equal(canonicalPath(path.join(dir, "a", "b", "c.ts")), path.join(real, "a", "b", "c.ts"));
});

test("validate keeps question kinds and the explanation's decisions, dependencies and risks", async () => {
  const { validate } = await load("ai.js");
  const ex = validate(
    {
      summary: "Adds retries.",
      files: [{ path: "a.ts", note: "retry loop" }],
      decisions: ["Retry only on timeouts", "", "x".repeat(500)],
      depends: ["The gateway honours idempotency keys"],
      risks: ["a", "b", "c"],
      questions: [
        { kind: "Failure case", q: "What if the ledger write fails?", options: ["a", "b", "c", "d"], answer: 1, why: "w" },
        { kind: "Nonsense", q: "Why?", options: ["a", "b"], answer: 0, why: "w" },
      ],
    },
    ["a.ts"]
  );
  assert.equal(ex.questions[0].kind, "Failure case");
  assert.equal(ex.questions[1].kind, undefined, "an unknown kind is dropped, not trusted");
  assert.equal(ex.decisions.length, 2, "empty items are removed");
  assert.equal(ex.decisions[1].length, 220, "items are length-limited");
  assert.equal(ex.risks.length, 2, "risks are capped at two");
  const old = validate({ summary: "s", questions: [{ q: "q", options: ["a", "b"], answer: 0, why: "w" }] }, []);
  assert.deepEqual([old.decisions, old.depends, old.risks], [[], [], []], "older model output without the new fields still works");
});

test("toRecord sends the fingerprint and the answer, and the note only when summaries are shared", async () => {
  const { toRecord } = await load("team.js");
  const l = lesson({ id: "l_9", revs: { "a.ts": "abc123def456" }, response: "clarify", note: "unclear: the retry path", summary: "Adds retries." });
  const scores = toRecord(l, "scores");
  assert.deepEqual(scores.revs, { "a.ts": "abc123def456" });
  assert.equal(scores.response, "clarify");
  assert.equal(scores.openQuestions, undefined);
  assert.equal(scores.summary, undefined);
  const shared = toRecord(l, "summaries");
  assert.deepEqual(shared.openQuestions, ["unclear: the retry path"]);
  assert.equal(shared.summary, "Adds retries.");
  const bare = toRecord(lesson({ id: "l_8" }), "scores");
  assert.equal("revs" in bare, false, "a lesson without fingerprints sends none (older lessons stay valid)");
  assert.equal("response" in bare, false);
});

test("fileRevs fingerprints files as they are on disk and skips missing ones", async () => {
  const { fileRevs } = await load("git.js");
  const { execFileSync } = await import("node:child_process");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "zl-revs-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  fs.writeFileSync(path.join(repo, "a.txt"), "one\n");
  const first = fileRevs(repo, ["a.txt", "missing.txt"]);
  assert.deepEqual(Object.keys(first), ["a.txt"]);
  assert.match(first["a.txt"], /^[a-f0-9]{12}$/);
  assert.equal(fileRevs(repo, ["a.txt"])["a.txt"], first["a.txt"], "same content, same fingerprint");
  fs.writeFileSync(path.join(repo, "a.txt"), "two\n");
  assert.notEqual(fileRevs(repo, ["a.txt"])["a.txt"], first["a.txt"], "changed content, new fingerprint");
});
