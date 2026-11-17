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

const runAsync = (args, env, cwd) =>
  new Promise((resolve) => {
    const p = spawn(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, NO_COLOR: "1", ...env } });
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

// ── zlearn check (PR gate) ───────────────────────────────────────────────────────────────────────
test("zlearn check reports risky files, honours --fail-on, and fails soft on outages", async (t) => {
  const asked = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url !== "/api/learn/v1/check" || req.headers.authorization !== "Bearer zlt_cikeycikeycikeycikey1234") {
        res.statusCode = 401;
        return void res.end(JSON.stringify({ error: "Invalid team key." }));
      }
      const body = JSON.parse(raw);
      asked.push(body);
      const status = { "src/risky.ts": ["blind", 0, true, "high", "Nobody on the team has passed a lesson on this file yet."], "src/solo.ts": ["single", 1, false, "low", "Only Priya has current review evidence for this file."], "src/ok.ts": ["covered", 3, false, "none"], "src/new.ts": ["stale", 0, false, "medium", "Changed 2 days ago, after Ana's last passing lesson."] };
      const files = body.files.map((p) => {
        const [s, owners, unreviewed, level, why] = status[p] ?? ["unknown", 0, false, "none"];
        return { path: p, status: s, owners, unreviewed, level, reasons: why ? [why] : [], lastChange: null };
      });
      const count = (f) => files.filter(f).length;
      res.end(JSON.stringify({ team: { name: "Acme" }, files, totals: { files: files.length, unreviewed: count((f) => f.unreviewed), blind: count((f) => f.status === "blind"), stale: count((f) => f.status === "stale"), single: count((f) => f.status === "single"), covered: count((f) => f.status === "covered"), unknown: count((f) => f.status === "unknown") } }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}`;

  const home = fs.mkdtempSync(path.join(os.tmpdir(), "zl-home-"));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "zl-repo-"));
  const git = (...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t.io", ...a], { cwd: repo, stdio: "ignore" });
  git("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(repo, "README.md"), "x\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  git("checkout", "-qb", "feature");
  fs.mkdirSync(path.join(repo, "src"));
  for (const f of ["risky", "solo", "ok", "new"]) fs.writeFileSync(path.join(repo, "src", `${f}.ts`), `export const ${f} = 1;\n`);
  git("add", "-A");
  git("commit", "-qm", "feature");

  const env = { ZLEARN_HOME: home, ZLEARN_TEAM_KEY: "zlt_cikeycikeycikeycikey1234", ZLEARN_SERVER: url };

  const report = await runAsync(["check", "--base", "main"], env, repo);
  assert.equal(report.status, 0, report.stderr);
  assert.match(report.stdout, /src\/risky\.ts/);
  assert.match(report.stdout, /un-reviewed AI change/);
  assert.match(report.stdout, /src\/solo\.ts/);
  assert.match(report.stdout, /src\/new\.ts[^\n]*reviewed, but changed since/, "an out-of-date review is called out");
  assert.match(report.stdout, /Changed 2 days ago, after Ana/, "the reason the server gave is shown");
  assert.match(report.stdout, /1 out of date/);
  assert.doesNotMatch(report.stdout, /src\/ok\.ts/, "covered files are not listed");
  assert.deepEqual(asked[0].files.sort(), ["src/new.ts", "src/ok.ts", "src/risky.ts", "src/solo.ts"], "sends exactly the files the branch changed");

  assert.equal((await runAsync(["check", "--base", "main", "--fail-on", "unreviewed"], env, repo)).status, 1, "un-reviewed AI change fails the gate");
  assert.equal((await runAsync(["check", "--base", "main", "--fail-on", "blind"], env, repo)).status, 1, "a blind spot fails the blind policy");
  assert.equal((await runAsync(["check", "--files", "src/new.ts", "--fail-on", "blind"], env, repo)).status, 1, "a file reviewed once but changed since also has no current evidence");
  assert.equal((await runAsync(["check", "--files", "src/ok.ts,src/solo.ts", "--fail-on", "unreviewed"], env, repo)).status, 0, "clean files pass");
  assert.equal((await runAsync(["check", "--fail-on", "sometimes"], env, repo)).status, 2, "bad policy is a usage error");

  const json = JSON.parse((await runAsync(["check", "--base", "main", "--fail-on", "unreviewed", "--json"], env, repo)).stdout);
  assert.equal(json.failed, true);
  assert.equal(json.totals.unreviewed, 1);

  const gh = await runAsync(["check", "--base", "main"], { ...env, GITHUB_ACTIONS: "true" }, repo);
  assert.match(gh.stdout, /::warning file=src\/risky\.ts::/);
  const ghFail = await runAsync(["check", "--base", "main", "--fail-on", "unreviewed"], { ...env, GITHUB_ACTIONS: "true" }, repo);
  assert.match(ghFail.stdout, /::error file=src\/risky\.ts::/);

  const noKey = await runAsync(["check", "--base", "main"], { ZLEARN_HOME: home }, repo);
  assert.equal(noKey.status, 2);
  assert.match(noKey.stderr, /ZLEARN_TEAM_KEY/);

  const down = await runAsync(["check", "--base", "main", "--fail-on", "unreviewed"], { ...env, ZLEARN_SERVER: "http://127.0.0.1:1" }, repo);
  assert.equal(down.status, 0, "an outage must not break a normal pipeline");
  assert.match(down.stderr, /skipped/);
  assert.equal((await runAsync(["check", "--base", "main", "--strict"], { ...env, ZLEARN_SERVER: "http://127.0.0.1:1" }, repo)).status, 3, "--strict fails on an outage");
});
