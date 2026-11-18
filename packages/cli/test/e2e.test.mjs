import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");
const EXPLANATION = {
  summary: "Adds a greeting helper that returns a friendly message. It guards against an empty name.",
  decisions: ["An empty name falls back to a default instead of throwing."],
  depends: ["Callers pass a string."],
  risks: ["A null name would throw."],
  files: [{ path: "src/greet.js", note: "New helper that builds the greeting." }],
  questions: [
    { kind: "Failure case", q: "What does greet return when the name is empty?", options: ["Hello, friend", "An error", "undefined", "null"], answer: 0, why: "Empty names fall back to a default." },
    { kind: "Why", q: "Why is the name trimmed?", options: ["To ignore stray spaces", "To save memory", "To sort names", "For logging"], answer: 0, why: "Whitespace-only names count as empty." },
    { kind: "Dependency", q: "Where is the helper exported from?", options: ["src/greet.js", "index.html", "package.json", "a CDN"], answer: 0, why: "It lives in src/greet.js." },
  ],
};

function startMockAi() {
  const calls = { n: 0, lastBody: "" };
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      calls.n += 1;
      calls.lastBody = raw;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(EXPLANATION) }] }));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, calls, url: `http://127.0.0.1:${server.address().port}` })));
}

function run(args, { cwd, env, input } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, ...env }, input, encoding: "utf8" });
}

// spawnSync blocks this process, so anything that talks to a mock server in this same process must use the async runner.
function runAsync(args, { cwd, env, input } = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, NO_COLOR: "1", ...env } });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("close", (status) => resolve({ status, stdout, stderr }));
    if (input !== undefined) p.stdin.end(input);
  });
}

async function waitFor(fn, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

test("hooks -> lesson -> gate -> quiz", async (t) => {
  const ai = await startMockAi();
  t.after(() => ai.server.close());
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "zl-home-"));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "zl-repo-"));
  const env = { ZLEARN_HOME: home, ANTHROPIC_API_KEY: "test-key", ANTHROPIC_BASE_URL: ai.url };
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "--allow-empty", "-qm", "init"], { cwd: repo });
  fs.mkdirSync(path.join(repo, "src"));
  fs.writeFileSync(path.join(repo, "src", "greet.js"), "export const greet = (n) => `Hello, ${n.trim() || 'friend'}`;\n");

  // 1. init installs hooks, creates config, ignores .zlearn
  const init = run(["init", "--gate", "warn"], { cwd: repo, env });
  assert.equal(init.status, 0, init.stderr);
  assert.match(init.stdout, /What Zevqi sends/, "init says plainly what goes to the model provider");
  assert.match(init.stdout, /Nowhere else/);
  assert.ok(JSON.parse(fs.readFileSync(path.join(repo, ".zlearn", "config.json"), "utf8")).aiNotice, "the disclosure is recorded");
  const settings = JSON.parse(fs.readFileSync(path.join(repo, ".claude", "settings.local.json"), "utf8"));
  assert.deepEqual(Object.keys(settings.hooks).sort(), ["PostToolUse", "PreToolUse", "Stop"]);
  assert.equal(settings.hooks.PostToolUse[0].matcher, "Edit|Write|MultiEdit|NotebookEdit");
  assert.equal(settings.hooks.PreToolUse[0].hooks[0].if, "Bash(git commit*)");
  assert.match(fs.readFileSync(path.join(repo, ".gitignore"), "utf8"), /\.zlearn\//);
  run(["init"], { cwd: repo, env });
  const again = JSON.parse(fs.readFileSync(path.join(repo, ".claude", "settings.local.json"), "utf8"));
  assert.equal(again.hooks.PostToolUse.length, 1, "re-running init must not duplicate hooks");

  // 2. PostToolUse records the edit silently
  const post = run(["hook", "post-tool"], { cwd: repo, env, input: JSON.stringify({ session_id: "s1", cwd: repo, hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path: path.join(repo, "src", "greet.js") } }) });
  assert.equal(post.status, 0);
  assert.equal(post.stdout, "");
  const buffer = JSON.parse(fs.readFileSync(path.join(repo, ".zlearn", "buffer.json"), "utf8"));
  assert.ok(buffer.files["src/greet.js"]);
  run(["hook", "post-tool"], { cwd: repo, env, input: JSON.stringify({ cwd: repo, tool_name: "Read", tool_input: { file_path: path.join(repo, "x") } }) });
  run(["hook", "post-tool"], { cwd: repo, env, input: JSON.stringify({ cwd: repo, tool_name: "Write", tool_input: { file_path: path.join(os.tmpdir(), "outside.js") } }) });
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(repo, ".zlearn", "buffer.json"), "utf8")).files), ["src/greet.js"]);

  // 3. Stop hook returns immediately and a lesson appears in the background
  const t0 = Date.now();
  const stop = run(["hook", "stop"], { cwd: repo, env, input: JSON.stringify({ session_id: "s1", cwd: repo, hook_event_name: "Stop" }) });
  assert.equal(stop.status, 0);
  assert.ok(Date.now() - t0 < 3000, "Stop hook must not wait for the AI");
  const lessonsDir = path.join(repo, ".zlearn", "lessons");
  const lessonFile = await waitFor(() => fs.existsSync(lessonsDir) && fs.readdirSync(lessonsDir)[0]);
  assert.ok(lessonFile, "lesson was not created");
  const lesson = JSON.parse(fs.readFileSync(path.join(lessonsDir, lessonFile), "utf8"));
  assert.equal(lesson.status, "pending");
  assert.deepEqual(lesson.changedFiles, ["src/greet.js"]);
  assert.equal(lesson.questions.length, 3);
  assert.deepEqual(lesson.questions.map((q) => q.kind), ["Failure case", "Why", "Dependency"], "question kinds are kept");
  assert.equal(lesson.kind, "change");
  const blob = execFileSync("git", ["hash-object", "src/greet.js"], { cwd: repo, encoding: "utf8" }).trim().slice(0, 12);
  assert.deepEqual(lesson.revs, { "src/greet.js": blob }, "the lesson records a content fingerprint of each file");
  assert.deepEqual(lesson.decisions, ["An empty name falls back to a default instead of throwing."]);
  assert.match(ai.calls.lastBody, /Failure case/, "the model is asked for failure-case questions");
  assert.ok(ai.calls.lastBody.includes("src/greet.js") && ai.calls.lastBody.includes("untrusted"));
  assert.ok(!fs.existsSync(path.join(repo, ".zlearn", "buffer.json")), "buffer should be cleared after Stop");

  // 4. commit gate: warn, block, off
  const commit = JSON.stringify({ cwd: repo, tool_name: "Bash", tool_input: { command: 'git commit -m "x"' } });
  const warn = run(["hook", "commit-gate"], { cwd: repo, env, input: commit });
  assert.match(JSON.parse(warn.stdout).systemMessage, /1 AI change/);
  run(["gate", "block"], { cwd: repo, env });
  const block = JSON.parse(run(["hook", "commit-gate"], { cwd: repo, env, input: commit }).stdout);
  assert.equal(block.hookSpecificOutput.permissionDecision, "deny");
  const notCommit = run(["hook", "commit-gate"], { cwd: repo, env, input: JSON.stringify({ cwd: repo, tool_name: "Bash", tool_input: { command: "git status" } }) });
  assert.equal(notCommit.stdout, "");
  run(["gate", "off"], { cwd: repo, env });
  assert.equal(run(["hook", "commit-gate"], { cwd: repo, env, input: commit }).stdout, "");

  // 5. status, then the quiz (answers piped in): A, A, B -> 2 of 3 right
  assert.match(run(["status"], { cwd: repo, env }).stdout, /1.*waiting for review/);
  // then the developer's own call: "c" = needs clarification, with a note
  const quiz = run(["learn"], { cwd: repo, env, input: "a\nA\nb\nc\nwhy trim at all?\n" });
  assert.equal(quiz.status, 0, quiz.stderr);
  assert.match(quiz.stdout, /Passed 2\/3/);
  assert.match(quiz.stdout, /will not count as evidence/);
  assert.match(quiz.stdout, /zevqi review src\/greet\.js/);
  const done = JSON.parse(fs.readFileSync(path.join(lessonsDir, lessonFile), "utf8"));
  assert.equal(done.status, "passed");
  assert.equal(done.correct, 2);
  assert.equal(done.response, "clarify");
  assert.equal(done.note, "why trim at all?");
  assert.match(run(["learn"], { cwd: repo, env }).stdout, /up to date/);

  // 6. hooks never fail the agent, even with garbage input
  assert.equal(run(["hook", "post-tool"], { cwd: repo, env, input: "not json" }).status, 0);
  assert.equal(run(["hook", "stop"], { cwd: os.tmpdir(), env, input: "{}" }).status, 0);

  // 7. uninstall removes only our hooks
  const file = path.join(repo, ".claude", "settings.local.json");
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, "utf8")), permissions: { allow: ["Bash(ls)"] } }));
  run(["uninstall"], { cwd: repo, env });
  const after = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(after.hooks, undefined);
  assert.deepEqual(after.permissions.allow, ["Bash(ls)"]);
});

test("missing API key fails clearly", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "zl-home-"));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "zl-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  const env = { ZLEARN_HOME: home, ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "" };
  run(["init"], { cwd: repo, env });
  fs.writeFileSync(path.join(repo, "a.js"), "x\n".repeat(50_000));
  const out = run(["explain"], { cwd: repo, env });
  assert.notEqual(out.status, 0);
  assert.match(out.stderr, /No API key/);
});


test("review: a teammate's committed change becomes a lesson, and the evidence reaches the team server", async (t) => {
  const ai = await startMockAi();
  t.after(() => ai.server.close());
  const records = [];
  const team = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/learn/v1/summary") return void res.end(JSON.stringify({ team: { name: "Acme" }, members: [], blindSpots: [], totals: {} }));
      if (req.url === "/api/learn/v1/records") {
        records.push(JSON.parse(raw));
        return void res.end(JSON.stringify({ saved: 1 }));
      }
      res.statusCode = 404;
      res.end("{}");
    });
  });
  await new Promise((r) => team.listen(0, "127.0.0.1", r));
  t.after(() => team.close());
  const teamUrl = `http://127.0.0.1:${team.address().port}`;

  const home = fs.mkdtempSync(path.join(os.tmpdir(), "zl-home-"));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "zl-repo-"));
  const env = { ZLEARN_HOME: home, ANTHROPIC_API_KEY: "test-key", ANTHROPIC_BASE_URL: ai.url };
  const git = (...a) => execFileSync("git", ["-c", "user.email=a@b.c", "-c", "user.name=Teammate", ...a], { cwd: repo, encoding: "utf8" });
  git("init", "-q");
  fs.mkdirSync(path.join(repo, "src"));
  fs.writeFileSync(path.join(repo, "src", "pay.js"), "export const pay = (a) => a;\n");
  git("add", "-A");
  git("commit", "-qm", "add pay");
  fs.writeFileSync(path.join(repo, "src", "pay.js"), "export const pay = (a) => { if (a <= 0) throw new Error('bad'); return a; };\n");
  git("commit", "-qam", "validate amount");

  assert.equal(run(["init", "--no-prompt"], { cwd: repo, env }).status, 0);
  assert.equal((await runAsync(["team", "join", "--server", teamUrl, "--key", "zlt_reviewkeyreviewkeyreview123", "--email", "me@acme.dev", "--name", "Me"], { cwd: repo, env })).status, 0);

  // an install from before the disclosure existed sees it once, on the next command that uses the model, and it never blocks
  const cfgPath = path.join(repo, ".zlearn", "config.json");
  const legacy = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  delete legacy.aiNotice;
  fs.writeFileSync(cfgPath, JSON.stringify(legacy));
  const firstRun = await runAsync(["review", "src/pay.js"], { cwd: repo, env, input: "a\nA\nA\ny\n" });
  assert.equal(firstRun.status, 0, firstRun.stderr);
  assert.match(firstRun.stdout, /What Zevqi sends/, "older installs are told once");
  assert.ok(JSON.parse(fs.readFileSync(cfgPath, "utf8")).aiNotice);
  fs.rmSync(path.join(repo, ".zlearn", "lessons"), { recursive: true, force: true });
  records.length = 0;

  // scores only (the default): the fingerprint and the answer are sent, but not the developer's own words
  let out = await runAsync(["review", "src/pay.js", "--commits", "2"], { cwd: repo, env, input: "a\nA\nA\ni\nnot sure about the failure path\n" });
  assert.equal(out.status, 0, out.stderr);
  assert.doesNotMatch(out.stdout, /What Zevqi sends/, "the disclosure is shown once, not every time");
  assert.match(ai.calls.lastBody, /recent committed changes/, "the model is told these are committed changes being reviewed");
  assert.match(ai.calls.lastBody, /validate amount/, "the commit history of the file is what gets explained");
  const lessons = fs.readdirSync(path.join(repo, ".zlearn", "lessons")).map((f) => JSON.parse(fs.readFileSync(path.join(repo, ".zlearn", "lessons", f), "utf8")));
  assert.equal(lessons.length, 1);
  assert.equal(lessons[0].kind, "review");
  assert.equal(lessons[0].response, "investigate");
  const blob = git("hash-object", "src/pay.js").trim().slice(0, 12);
  assert.deepEqual(lessons[0].revs, { "src/pay.js": blob }, "the review fingerprints the file as it is now");
  const sent = records.flatMap((r) => r.lessons).find((l) => l.status === "passed");
  assert.ok(sent, "the finished lesson was synced");
  assert.deepEqual(sent.revs, { "src/pay.js": blob });
  assert.equal(sent.response, "investigate");
  assert.equal(sent.openQuestions, undefined, "the developer's note stays on their machine unless they share summaries");
  assert.equal(sent.summary, undefined);
  assert.ok(!JSON.stringify(records).includes("export const pay"), "source code is never sent");

  // sharing summaries: the note goes with it
  const cfgFile = path.join(repo, ".zlearn", "config.json");
  fs.writeFileSync(cfgFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfgFile, "utf8")), share: "summaries" }));
  out = await runAsync(["review", "src/pay.js"], { cwd: repo, env, input: "a\nA\nA\nc\nwhat if the amount is a string?\n" });
  assert.equal(out.status, 0, out.stderr);
  const last = records[records.length - 1].lessons.find((l) => l.response === "clarify");
  assert.deepEqual(last.openQuestions, ["what if the amount is a string?"]);

  // paths are resolved from where you are, not from the repository root
  out = await runAsync(["review", "pay.js", "--commits", "1"], { cwd: path.join(repo, "src"), env, input: "a\nA\nA\ny\n" });
  assert.equal(out.status, 0, out.stderr);
  const newest = fs.readdirSync(path.join(repo, ".zlearn", "lessons")).map((f) => JSON.parse(fs.readFileSync(path.join(repo, ".zlearn", "lessons", f), "utf8"))).sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0];
  assert.deepEqual(newest.changedFiles, ["src/pay.js"], "a path typed relative to a subfolder maps to the repository path");

  // usage errors
  assert.equal((await runAsync(["review"], { cwd: repo, env })).status, 2, "review needs file names");
  assert.match((await runAsync(["review", "src/never-committed.js"], { cwd: repo, env })).stdout, /No git history/);
});
