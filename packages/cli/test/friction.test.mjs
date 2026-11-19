// One-command behaviour: `zevqi` on its own, `zevqi ui` opening at the waiting lesson, port fallback, the end-of-quiz summary, and
// proof that hooks fired (`zevqi doctor`, `zevqi doctor --live`). Real git, real hook calls, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const CLI = path.join(DIST, "cli.js");
const NOOPEN = { ZEVQI_NO_OPEN: "1", NO_COLOR: "1" };

function run(args, { cwd, env, input } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, ...NOOPEN, ...env }, input, encoding: "utf8" });
}
function runAsync(args, { cwd, env } = {}) {
  const p = spawn(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, ...NOOPEN, ...env } });
  let stdout = "";
  let stderr = "";
  p.stdout.on("data", (d) => (stdout += d));
  p.stderr.on("data", (d) => (stderr += d));
  const done = new Promise((resolve) => p.on("close", (status) => resolve({ status, stdout, stderr })));
  return { p, done, out: () => stdout };
}
const waitFor = async (fn, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
};

function makeRepo() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "zf-home-"));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "zf-repo-"));
  const env = { ZLEARN_HOME: home };
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "--allow-empty", "-qm", "init"], { cwd: repo });
  fs.mkdirSync(path.join(repo, "src"));
  for (const f of ["a.js", "b.js"]) fs.writeFileSync(path.join(repo, "src", f), `export const ${f[0]} = 1;\n`);
  return { repo, env };
}
const enable = ({ repo, env }) => assert.equal(run(["init", "--yes", "--no-agents"], { cwd: repo, env }).status, 0);
const lessonJson = (file) =>
  JSON.stringify({
    summary: `Adds ${file}. It exports one constant.`,
    files: [{ path: file, note: "New constant." }],
    decisions: [],
    depends: [],
    risks: [],
    questions: [
      { kind: "Why", q: "What does it export?", options: ["A constant", "A class", "Nothing", "A route"], answer: 0, why: "One constant." },
      { kind: "Why", q: "How many exports?", options: ["One", "Two", "Three", "None"], answer: 0, why: "One." },
    ],
  });
const addLesson = (r, file) => {
  const out = run(["lesson", "add", "--files", file], { cwd: r.repo, env: r.env, input: lessonJson(file) });
  assert.equal(out.status, 0, out.stdout + out.stderr);
  return /l_[a-f0-9]+/.exec(out.stdout)[0];
};
const hookEdit = (r, file) =>
  run(["hook", "post-tool"], { cwd: r.repo, env: r.env, input: JSON.stringify({ session_id: "s", cwd: r.repo, hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path: path.join(r.repo, file) } }) });

test("zevqi on its own: help where Zevqi is off, status where it is on", () => {
  const r = makeRepo();
  const off = run([], { cwd: r.repo, env: r.env });
  assert.equal(off.status, 0);
  assert.match(off.stdout, /Usage/, "no Zevqi here: the help");
  enable(r);
  const on = run([], { cwd: r.repo, env: r.env });
  assert.equal(on.status, 0);
  assert.match(on.stdout, /waiting for review/, "Zevqi is on: the status");
  assert.doesNotMatch(on.stdout, /Usage/);
  addLesson(r, "src/a.js");
  const waiting = run([], { cwd: r.repo, env: r.env });
  assert.match(waiting.stdout, /1\b.*waiting for review/, "not a terminal, so it shows the status instead of opening a dashboard");
  assert.match(run(["--help"], { cwd: r.repo, env: r.env }).stdout, /Usage/, "--help is still the help");
});

test("zevqi ui: lands on the oldest waiting lesson, and the home page shows progress", async () => {
  const r = makeRepo();
  enable(r);
  const first = addLesson(r, "src/a.js");
  await new Promise((res) => setTimeout(res, 20));
  addLesson(r, "src/b.js");
  const ui = runAsync(["ui", "--port", String(40000 + Math.floor(Math.random() * 2000))], { cwd: r.repo, env: r.env });
  try {
    const line = await waitFor(() => /zevqi dashboard: (http\S+)/.exec(ui.out())?.[1]);
    assert.ok(line, ui.out());
    assert.ok(line.includes(`/lesson/${first}?t=`), `opens the oldest waiting lesson: ${line}`);
    assert.doesNotMatch(ui.out(), /Opened your browser/, "no browser is launched when ZEVQI_NO_OPEN is set");
    const home = await (await fetch(line.replace(`/lesson/${first}`, "/"))).text();
    assert.match(home, /2<\/b> waiting for review/);
    assert.match(home, /0 of 2 AI-changed files reviewed/);
  } finally {
    ui.p.kill();
  }
});

test("zevqi ui with nothing waiting opens the home page, and a port you asked for must be that port", async () => {
  const r = makeRepo();
  enable(r);
  const port = 42000 + Math.floor(Math.random() * 2000);
  const ui = runAsync(["ui", "--port", String(port), "--no-open"], { cwd: r.repo, env: { ...r.env, ZEVQI_NO_OPEN: "" } });
  try {
    const line = await waitFor(() => /zevqi dashboard: (http\S+)/.exec(ui.out())?.[1]);
    assert.ok(line && !line.includes("/lesson/"), line);
    // the same port again must fail with a readable message instead of a stack trace
    const second = await runAsync(["ui", "--port", String(port)], { cwd: r.repo, env: r.env }).done;
    assert.equal(second.status, 1);
    assert.match(second.stderr, /could not start the dashboard on port/);
    assert.doesNotMatch(second.stderr, /at .*\.js:\d+/, "no stack trace");
  } finally {
    ui.p.kill();
  }
});

test("the dashboard server moves to the next free port when the default is busy", async () => {
  const { startServer, pageUrl } = await import(pathToFileURL(path.join(DIST, "server.js")).href);
  const busy = net.createServer();
  const port = await new Promise((resolve) => busy.listen(0, "127.0.0.1", () => resolve(busy.address().port)));
  let got = null;
  const srv = startServer(os.tmpdir(), port, (u) => (got = u), { tries: 5 });
  try {
    await waitFor(() => got);
    assert.ok(got, "started somewhere");
    assert.doesNotMatch(got, new RegExp(`:${port}/`), "not on the busy port");
    assert.equal(pageUrl(got, "/map").includes("/map?t="), true);
    let failed = null;
    const srv2 = startServer(os.tmpdir(), port, () => undefined, { tries: 1, onError: (e) => (failed = e.code) });
    await waitFor(() => failed);
    assert.equal(failed, "EADDRINUSE");
    srv2.close();
  } finally {
    srv.close();
    busy.close();
  }
});

test("answering a lesson in the browser returns where you stand and the next lesson", async () => {
  const r = makeRepo();
  enable(r);
  const one = addLesson(r, "src/a.js");
  await new Promise((res) => setTimeout(res, 20));
  const two = addLesson(r, "src/b.js");
  const ui = runAsync(["ui", "--port", String(44000 + Math.floor(Math.random() * 2000))], { cwd: r.repo, env: r.env });
  try {
    const base = await waitFor(() => /zevqi dashboard: (http\S+)/.exec(ui.out())?.[1]);
    const token = new URL(base).searchParams.get("t");
    const origin = new URL(base).origin;
    const answer = (id) => fetch(`${origin}/api/answer?t=${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, correct: 2, response: "understood" }) }).then((x) => x.json());
    const a = await answer(one);
    assert.equal(a.status, "passed");
    assert.equal(a.nextId, two, "points at the lesson still waiting");
    assert.match(a.line, /1 of 2 AI-changed files reviewed\. 1 lesson still waiting/);
    const doneOne = await (await fetch(`${origin}/lesson/${one}?t=${token}`)).text();
    assert.ok(doneOne.includes(`/lesson/${two}?t=`) && /Next lesson/.test(doneOne), "a finished lesson links to the next waiting one");
    const b = await answer(two);
    assert.equal(b.nextId, null);
    assert.match(b.line, /2 of 2 AI-changed files reviewed\. Nothing else is waiting/);
    const finished = await (await fetch(`${origin}/lesson/${one}?t=${token}`)).text();
    assert.match(finished, /See your knowledge map/, "with nothing left, it points at the map");
  } finally {
    ui.p.kill();
  }
});

test("the commit gate tells you the one word to type", () => {
  const r = makeRepo();
  enable(r);
  addLesson(r, "src/a.js");
  const out = run(["hook", "commit-gate"], { cwd: r.repo, env: r.env, input: JSON.stringify({ cwd: r.repo, tool_name: "Bash", tool_input: { command: "git commit -m x" } }) });
  assert.match(out.stdout, /Run \\"zevqi\\" in a terminal/);
  assert.doesNotMatch(out.stdout, /zevqi learn/);
});

test("doctor says whether the hooks have ever run, and --live waits for a real one", async () => {
  const r = makeRepo();
  enable(r);
  const before = run(["doctor"], { cwd: r.repo, env: r.env });
  assert.match(before.stdout, /Hooks have not run in this repo yet/);
  assert.match(before.stdout, /Hook program found/);
  assert.equal(before.status, 0, "never having run is information, not a failure");

  // nothing fires: a clear failure with what to try
  const none = run(["doctor", "--live", "--wait", "1"], { cwd: r.repo, env: r.env });
  assert.equal(none.status, 1);
  assert.match(none.stdout, /No hook ran/);
  assert.match(none.stdout, /Restart Claude Code/);

  // an edit arrives while doctor is waiting
  const live = runAsync(["doctor", "--live", "--wait", "30"], { cwd: r.repo, env: r.env });
  await waitFor(() => /Waiting up to/.test(live.out()));
  await new Promise((res) => setTimeout(res, 700)); // the wait starts counting now
  hookEdit(r, "src/a.js");
  const res = await live.done;
  assert.equal(res.status, 0, res.stdout);
  assert.match(res.stdout, /The hooks are live: post-tool ran for src\/a\.js/);

  const after = run(["doctor"], { cwd: r.repo, env: r.env });
  assert.match(after.stdout, /Hooks last ran .*post-tool: src\/a\.js/);
});

test("doctor fails loudly when a hook points at a zevqi that is gone", () => {
  const r = makeRepo();
  enable(r);
  const file = path.join(r.repo, ".claude", "settings.local.json");
  const s = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const groups of Object.values(s.hooks)) for (const g of groups) for (const h of g.hooks) h.args = h.args.map((a) => (a.endsWith("cli.js") ? path.join(os.tmpdir(), "gone", "dist", "cli.js") : a));
  fs.writeFileSync(file, JSON.stringify(s));
  const out = run(["doctor"], { cwd: r.repo, env: r.env });
  assert.equal(out.status, 1);
  assert.match(out.stdout, /✗ Hook program found/);
  assert.match(out.stdout, /Run: zevqi init/);
});

test("setup ends with the one step that is easy to miss", () => {
  // the setup flow needs a team server, so check the wording where it lives
  const src = fs.readFileSync(path.join(DIST, "commands", "quickstart.js"), "utf8");
  assert.match(src, /One step left/);
  assert.match(src, /Restart Claude Code in this folder once/);
  assert.match(src, /zevqi doctor --live/);
});

test("the browser is opened only for the local dashboard address, and never in CI or with --no-open", async () => {
  const { openBrowser, shouldOpenBrowser } = await import(pathToFileURL(path.join(DIST, "open.js")).href);
  assert.equal(openBrowser("https://evil.example/"), false, "only http://127.0.0.1 is ever launched");
  assert.equal(openBrowser("http://127.0.0.1:4317/?t=abc&calc"), false, "no extra characters can reach the shell");
  assert.equal(openBrowser("http://localhost:4317/"), false);
  assert.equal(shouldOpenBrowser({ "no-open": true }, {}), false);
  assert.equal(shouldOpenBrowser({}, { CI: "true" }), false);
  assert.equal(shouldOpenBrowser({}, { ZEVQI_NO_OPEN: "1" }), false);
  if (process.platform !== "linux") assert.equal(shouldOpenBrowser({}, {}), true);
});
