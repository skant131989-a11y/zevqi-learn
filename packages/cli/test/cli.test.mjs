import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, "..", "dist", "cli.js");
const PKG = JSON.parse(fs.readFileSync(path.join(HERE, "..", "package.json"), "utf8"));

const run = (args, { cwd, env } = {}) =>
  spawnSync(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, NO_COLOR: "1", ...env }, encoding: "utf8" });

test("--version matches package.json", () => {
  const r = run(["--version"]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), PKG.version);
});

test("help lists every public command and hides internals", () => {
  const r = run(["help"]);
  assert.equal(r.status, 0);
  for (const name of ["init", "learn", "explain", "status", "stats", "ui", "gate", "team", "doctor", "config", "uninstall"]) assert.match(r.stdout, new RegExp(`\\b${name}\\b`), name);
  assert.doesNotMatch(r.stdout, /post-tool/);
});

test("per-command help works both ways", () => {
  for (const args of [["help", "learn"], ["learn", "--help"]]) {
    const r = run(args);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Usage/);
    assert.match(r.stdout, /zlearn learn/);
  }
});

test("unknown command exits 2 and suggests the closest match", () => {
  const r = run(["lern"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Unknown command "lern"/);
  assert.match(r.stderr, /Did you mean: zlearn learn/);
});

test("commands that need a repo fail clearly outside git", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zl-nogit-"));
  const r = run(["status"], { cwd: dir });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /git repository/);
});

test("init validates --gate and doctor/stats/status support --json", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "zl-home-"));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "zl-repo-"));
  const env = { ZLEARN_HOME: home, ZLEARN_API_KEY: "test-key" };
  execFileSync("git", ["init", "-q"], { cwd: repo });

  const bad = run(["init", "--gate", "nope"], { cwd: repo, env });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /--gate must be one of/);

  assert.equal(run(["init", "--no-prompt"], { cwd: repo, env }).status, 0);

  const stats = run(["stats", "--json"], { cwd: repo, env });
  assert.equal(stats.status, 0);
  const s = JSON.parse(stats.stdout);
  assert.equal(s.xp, 0);
  assert.equal(s.level, 1);
  assert.equal(s.levelName, "Rookie");

  const status = JSON.parse(run(["status", "--json"], { cwd: repo, env }).stdout);
  assert.equal(status.waiting, 0);
  assert.equal(status.gate, "warn");
  assert.ok(Array.isArray(status.hooks) && status.hooks.length > 0);

  const doctor = run(["doctor", "--json"], { cwd: repo, env });
  const d = JSON.parse(doctor.stdout);
  assert.equal(d.ok, true);
  assert.ok(d.checks.every((c) => c.ok));
});

test("config show never prints the full API key", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "zl-home-"));
  const r = run(["config", "show"], { env: { ZLEARN_HOME: home, ZLEARN_API_KEY: "sk-ant-super-secret-key-1234567890" } });
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stdout, /super-secret/);
  assert.match(r.stdout, /sk-ant…/);
});

test("config set rejects unknown keys and bad providers", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "zl-home-"));
  assert.equal(run(["config", "set", "nope", "x"], { env: { ZLEARN_HOME: home } }).status, 2);
  assert.equal(run(["config", "set", "provider", "mystery"], { env: { ZLEARN_HOME: home } }).status, 2);
  assert.equal(run(["config", "set", "provider", "openai"], { env: { ZLEARN_HOME: home } }).status, 0);
});

test("hooks never fail, even on garbage input", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "zl-home-"));
  for (const which of ["post-tool", "stop", "commit-gate"]) {
    const r = spawnSync(process.execPath, [CLI, "hook", which], { env: { ...process.env, ZLEARN_HOME: home }, input: "not json {{{", encoding: "utf8" });
    assert.equal(r.status, 0, `${which} must exit 0`);
  }
});

// ── team join verifies the key with the server ───────────────────────────────────────────────────
import http from "node:http";
import { spawn } from "node:child_process";

const runAsync = (args, env) =>
  new Promise((resolve) => {
    const p = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, NO_COLOR: "1", ...env } });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("close", (status) => resolve({ status, stdout, stderr }));
  });

test("team join rejects a bad key, accepts a good one, and tolerates an offline server", async (t) => {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization });
    res.setHeader("content-type", "application/json");
    if (req.headers.authorization === "Bearer zlt_goodkeygoodkeygoodkey1234") return void res.end(JSON.stringify({ team: { name: "Acme" }, members: [], blindSpots: [], totals: {} }));
    res.statusCode = 401;
    res.end(JSON.stringify({ error: "Invalid team key." }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}`;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "zl-home-"));
  const env = { ZLEARN_HOME: home };
  const saved = () => (fs.existsSync(path.join(home, "config.json")) ? JSON.parse(fs.readFileSync(path.join(home, "config.json"), "utf8")).team : undefined);

  const bad = await runAsync(["team", "join", "--server", url, "--key", "zlt_wrongwrongwrongwrong123", "--email", "a@b.co"], env);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /not recognised/);
  assert.equal(saved(), undefined, "a bad key must not be saved");

  const good = await runAsync(["team", "join", "--server", url, "--key", "zlt_goodkeygoodkeygoodkey1234", "--email", "a@b.co"], env);
  assert.equal(good.status, 0, good.stderr);
  assert.match(good.stdout, /Joined Acme/);
  assert.equal(saved()?.email, "a@b.co");
  assert.ok(seen.every((s) => s.url === "/api/learn/v1/summary"), "only the summary endpoint is called when joining");

  const home2 = fs.mkdtempSync(path.join(os.tmpdir(), "zl-home-"));
  const offline = await runAsync(["team", "join", "--server", "http://127.0.0.1:1", "--key", "zlt_goodkeygoodkeygoodkey1234", "--email", "a@b.co"], { ZLEARN_HOME: home2 });
  assert.equal(offline.status, 0);
  assert.match(offline.stdout, /could not reach/);
});
