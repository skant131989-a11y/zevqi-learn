import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Agent mode: no API key. The coding agent (Codex, Cursor, Claude Code, anything that runs a shell command) writes the lesson and
// hands it to `zlearn lesson add`. Capture comes from git, so no per-tool hooks are involved.

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");
const run = (args, { cwd, env, input } = {}) => spawnSync(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, NO_COLOR: "1", ...env }, input, encoding: "utf8" });

const LESSON = {
  summary: "Adds a greeting helper that falls back to a default for an empty name.",
  files: [
    { path: "src/a.js", note: "New helper that builds the greeting." },
    { path: "src/not-changed.js", note: "The agent mentions a file that did not change." },
  ],
  decisions: ["Empty names fall back to a default."],
  depends: ["Callers pass a string."],
  risks: ["A null name would throw."],
  questions: [
    { kind: "Why", q: "Why fall back to a default?", options: ["Speed", "Avoid an empty greeting", "Logging", "Caching"], answer: 1, why: "An empty greeting looks broken." },
    { kind: "Failure case", q: "What happens for null?", options: ["Default", "It throws", "Empty string", "undefined"], answer: 1, why: "null has no trim()." },
    { kind: "Assumption", q: "What does it assume?", options: ["A string input", "A number", "An array", "Nothing"], answer: 0, why: "It calls trim()." },
  ],
};

function project() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "zl-home-"));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "zl-repo-"));
  const env = { ZLEARN_HOME: home, ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", ZLEARN_API_KEY: "" };
  const git = (...a) => execFileSync("git", ["-c", "user.email=a@b.c", "-c", "user.name=t", ...a], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  git("init", "-q");
  fs.mkdirSync(path.join(repo, "src"));
  fs.writeFileSync(path.join(repo, "src", "a.js"), "export const a = 1;\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  return { home, repo, env, git };
}

test("init with no API key installs the agent instructions once, and keeps everything else in the files", () => {
  const { repo, env } = project();
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "# My rules\n\nUse tabs.\n");
  fs.writeFileSync(path.join(repo, "CLAUDE.md"), "# Claude\n\nBe brief.\n");
  const init = run(["init", "--no-prompt"], { cwd: repo, env });
  assert.equal(init.status, 0, init.stderr);
  assert.match(init.stdout, /no API key is needed/i);

  const agents = fs.readFileSync(path.join(repo, "AGENTS.md"), "utf8");
  assert.ok(agents.startsWith("# My rules\n\nUse tabs.\n"), "existing instructions are untouched and come first");
  assert.equal(agents.split("<!-- zlearn:start -->").length - 1, 1);
  assert.match(agents, /zlearn lesson add/);
  assert.match(agents, /Failure case/);
  assert.match(agents, /Skip this step if `zlearn` is not installed/, "teammates without zlearn are not affected");
  const claude = fs.readFileSync(path.join(repo, "CLAUDE.md"), "utf8");
  assert.ok(claude.startsWith("# Claude\n\nBe brief.\n") && /^@AGENTS\.md$/m.test(claude), "CLAUDE.md imports AGENTS.md so Claude Code reads it too");

  run(["init", "--no-prompt"], { cwd: repo, env });
  assert.equal(fs.readFileSync(path.join(repo, "AGENTS.md"), "utf8"), agents, "running init again changes nothing");
  assert.equal(fs.readFileSync(path.join(repo, "CLAUDE.md"), "utf8"), claude);

  const doctor = JSON.parse(run(["doctor", "--json"], { cwd: repo, env }).stdout);
  assert.equal(doctor.ok, true, JSON.stringify(doctor));
  assert.ok(doctor.checks.some((c) => /No API key: your coding agent writes lessons/.test(c.label)));

  const un = run(["uninstall"], { cwd: repo, env });
  assert.equal(un.status, 0, un.stderr);
  assert.equal(fs.readFileSync(path.join(repo, "AGENTS.md"), "utf8"), "# My rules\n\nUse tabs.\n", "uninstall removes only what zlearn added");
  assert.equal(fs.readFileSync(path.join(repo, "CLAUDE.md"), "utf8"), "# Claude\n\nBe brief.\n");
});

test("init creates the files when they do not exist, and uninstall deletes files that held nothing else", () => {
  const { repo, env } = project();
  run(["init", "--no-prompt"], { cwd: repo, env });
  assert.ok(fs.existsSync(path.join(repo, "AGENTS.md")) && fs.existsSync(path.join(repo, "CLAUDE.md")));
  run(["uninstall"], { cwd: repo, env });
  assert.ok(!fs.existsSync(path.join(repo, "AGENTS.md")) && !fs.existsSync(path.join(repo, "CLAUDE.md")), "files zlearn created are removed again");
});

test("with an API key, init leaves AGENTS.md alone unless --agents is given", () => {
  const { repo, env } = project();
  run(["init", "--no-prompt"], { cwd: repo, env: { ...env, ANTHROPIC_API_KEY: "test-key" } });
  assert.ok(!fs.existsSync(path.join(repo, "AGENTS.md")));
  run(["init", "--no-prompt", "--agents"], { cwd: repo, env: { ...env, ANTHROPIC_API_KEY: "test-key" } });
  assert.ok(fs.existsSync(path.join(repo, "AGENTS.md")));
  const off = project();
  run(["init", "--no-prompt", "--no-agents"], { cwd: off.repo, env: off.env });
  assert.ok(!fs.existsSync(path.join(off.repo, "AGENTS.md")), "--no-agents opts out");
});

test("lesson add: the agent's lesson is saved against the files git says changed, and can be taken", () => {
  const { repo, env } = project();
  run(["init", "--no-prompt"], { cwd: repo, env });
  assert.match(run(["lesson", "schema"], { cwd: repo, env }).stdout, /"questions"/);

  fs.writeFileSync(path.join(repo, "src", "a.js"), "export const a = (n) => (n ?? '').trim() || 'friend';\n");
  const add = run(["lesson", "add", "--json"], { cwd: repo, env, input: JSON.stringify(LESSON) });
  assert.equal(add.status, 0, add.stderr);
  const out = JSON.parse(add.stdout);
  assert.deepEqual(out.files, ["src/a.js"]);
  assert.equal(out.questions, 3);

  const dir = path.join(repo, ".zlearn", "lessons");
  const saved = JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]), "utf8"));
  assert.equal(saved.status, "pending");
  assert.equal(saved.explainer, "agent");
  assert.deepEqual(saved.changedFiles, ["src/a.js"], "the files come from git, not from the agent");
  assert.deepEqual(saved.files.map((f) => f.path), ["src/a.js"], "a file the agent mentions but did not change is dropped");
  const blob = execFileSync("git", ["hash-object", "src/a.js"], { cwd: repo, encoding: "utf8" }).trim().slice(0, 12);
  assert.deepEqual(saved.revs, { "src/a.js": blob }, "the fingerprint is taken from the file, not from the agent");
  assert.deepEqual(saved.questions.map((q) => q.kind), ["Why", "Failure case", "Assumption"]);
  assert.match(run(["status"], { cwd: repo, env }).stdout, /1.*waiting for review/);

  const quiz = run(["learn"], { cwd: repo, env, input: "b\nb\na\ny\n" });
  assert.equal(quiz.status, 0, quiz.stderr);
  assert.match(quiz.stdout, /explained by your coding agent/);
  assert.match(quiz.stdout, /Passed 3\/3/);
});

test("lesson add: falls back to the last commit when the agent already committed, and honours --commit and --files", () => {
  const { repo, env, git } = project();
  run(["init", "--no-prompt"], { cwd: repo, env });
  fs.writeFileSync(path.join(repo, "src", "a.js"), "export const a = 2;\n");
  fs.writeFileSync(path.join(repo, "src", "b.js"), "export const b = 1;\n");
  git("add", "-A");
  git("commit", "-qm", "agent work");
  const lesson = { ...LESSON, files: [{ path: "src/a.js", note: "n" }, { path: "src/b.js", note: "n" }] };
  const a = JSON.parse(run(["lesson", "add", "--json"], { cwd: repo, env, input: JSON.stringify(lesson) }).stdout);
  assert.deepEqual(a.files.sort(), ["src/a.js", "src/b.js"], "nothing uncommitted, so the last commit is used");
  const b = JSON.parse(run(["lesson", "add", "--json", "--commit", "HEAD"], { cwd: repo, env, input: JSON.stringify(lesson) }).stdout);
  assert.equal(b.files.length, 2);
  const c = JSON.parse(run(["lesson", "add", "--json", "--files", "src/b.js"], { cwd: repo, env, input: JSON.stringify(lesson) }).stdout);
  assert.deepEqual(c.files, ["src/b.js"]);
});

test("lesson add: bad input is refused with a clear message and saves nothing", () => {
  const { repo, env } = project();
  run(["init", "--no-prompt"], { cwd: repo, env });
  fs.writeFileSync(path.join(repo, "src", "a.js"), "export const a = 3;\n");
  const dir = path.join(repo, ".zlearn", "lessons");
  const count = () => (fs.existsSync(dir) ? fs.readdirSync(dir).length : 0);

  let r = run(["lesson", "add"], { cwd: repo, env, input: "" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Pipe the lesson JSON/);
  r = run(["lesson", "add"], { cwd: repo, env, input: "this is not json" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /not valid JSON/);
  r = run(["lesson", "add"], { cwd: repo, env, input: JSON.stringify({ summary: "No questions here" }) });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no usable questions/);
  r = run(["lesson", "add"], { cwd: repo, env, input: JSON.stringify({ ...LESSON, questions: [{ q: "x", options: ["a", "b"], answer: 7, why: "" }] }) });
  assert.equal(r.status, 2, "an answer index that does not exist is rejected");
  r = run(["lesson", "nonsense"], { cwd: repo, env, input: "{}" });
  assert.equal(r.status, 2);
  assert.equal(count(), 0, "nothing was saved");

  // nothing changed and no commits to point at
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "zl-empty-"));
  execFileSync("git", ["init", "-q"], { cwd: empty });
  run(["init", "--no-prompt"], { cwd: empty, env });
  r = run(["lesson", "add"], { cwd: empty, env, input: JSON.stringify(LESSON) });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no changed files/);
});

test("without an API key the Stop hook starts nothing, and never fails", () => {
  const { repo, env } = project();
  run(["init", "--no-prompt"], { cwd: repo, env });
  run(["hook", "post-tool"], { cwd: repo, env, input: JSON.stringify({ session_id: "s", cwd: repo, tool_name: "Write", tool_input: { file_path: path.join(repo, "src", "a.js") } }) });
  const stop = run(["hook", "stop"], { cwd: repo, env, input: JSON.stringify({ session_id: "s", cwd: repo, hook_event_name: "Stop" }) });
  assert.equal(stop.status, 0);
  assert.equal(stop.stdout, "");
  assert.ok(!fs.existsSync(path.join(repo, ".zlearn", "jobs")), "no background explanation job was queued");
});

test("explain without a key points to the key-free way", () => {
  const { repo, env } = project();
  run(["init", "--no-prompt", "--no-agents"], { cwd: repo, env });
  fs.writeFileSync(path.join(repo, "src", "a.js"), "export const a = 4;\n");
  const out = run(["explain"], { cwd: repo, env });
  assert.notEqual(out.status, 0);
  assert.match(out.stderr, /No API key/);
  assert.match(out.stderr, /zlearn init --agents/);
});

test("the disclosure matches reality: with no key it says nothing is sent to a model provider, with a key it names where the diff goes", () => {
  const a = project();
  const noKey = run(["init", "--no-prompt"], { cwd: a.repo, env: a.env });
  assert.match(noKey.stdout, /No API key is set, so nothing is sent to any model provider/);
  assert.doesNotMatch(noKey.stdout, /To anthropic, using your own API key/, "it does not describe a provider that is not in use");
  const b = project();
  const keyed = run(["init", "--no-prompt"], { cwd: b.repo, env: { ...b.env, ANTHROPIC_API_KEY: "test-key" } });
  assert.match(keyed.stdout, /To anthropic, using your own API key/);
  assert.match(keyed.stdout, /Nowhere else/);
});
