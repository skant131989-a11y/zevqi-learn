import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");
const EXPLANATION = {
  summary: "Adds a greeting helper that returns a friendly message. It guards against an empty name.",
  files: [{ path: "src/greet.js", note: "New helper that builds the greeting." }],
  questions: [
    { q: "What does greet return when the name is empty?", options: ["Hello, friend", "An error", "undefined", "null"], answer: 0, why: "Empty names fall back to a default." },
    { q: "Why is the name trimmed?", options: ["To ignore stray spaces", "To save memory", "To sort names", "For logging"], answer: 0, why: "Whitespace-only names count as empty." },
    { q: "Where is the helper exported from?", options: ["src/greet.js", "index.html", "package.json", "a CDN"], answer: 0, why: "It lives in src/greet.js." },
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
  const quiz = run(["learn"], { cwd: repo, env, input: "a\nA\nb\n" });
  assert.equal(quiz.status, 0, quiz.stderr);
  assert.match(quiz.stdout, /Passed 2\/3/);
  const done = JSON.parse(fs.readFileSync(path.join(lessonsDir, lessonFile), "utf8"));
  assert.equal(done.status, "passed");
  assert.equal(done.correct, 2);
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
