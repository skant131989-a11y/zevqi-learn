import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const CLI = path.join(DIST, "cli.js");
const load = (rel) => import(pathToFileURL(path.join(DIST, rel)).href);
const run = (args, { cwd, env, input } = {}) => spawnSync(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, NO_COLOR: "1", ...env }, input, encoding: "utf8" });
const runAsync = (args, { cwd, env, input } = {}) =>
  new Promise((resolve) => {
    const p = spawn(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, NO_COLOR: "1", ...env } });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("close", (status) => resolve({ status, stdout, stderr }));
    if (input !== undefined) p.stdin.end(input);
  });

const RS = "\x1e";
const US = "\x1f";
const rec = (hash, name, email, date, subject, body, files) => `${RS}${hash}${US}${name}${US}${email}${US}${date}T10:00:00+00:00${US}${subject}${US}${body}${US}\n\n${files.join("\n")}\n`;

test("parseLog reads commits, flags AI co-author marks, and skips bots", async () => {
  const { parseLog, AI_MARK } = await load("scan.js");
  const raw =
    rec("a1", "Ana", "ana@x.dev", "2026-05-01", "add refunds", "Co-Authored-By: Claude <noreply@anthropic.com>", ["src/refund.ts", "src/ledger.ts"]) +
    rec("a2", "Bo", "bo@x.dev", "2026-05-02", "fix", "plain commit", ["src/ledger.ts"]) +
    rec("a3", "dependabot[bot]", "bot@x.dev", "2026-05-03", "bump", "", ["package.json"]) +
    rec("a4", "Cy", "cy@x.dev", "2026-05-04", "feat", "🤖 Generated with [Claude Code](https://claude.com/claude-code)", ["src/a.ts"]);
  const commits = parseLog(raw);
  assert.deepEqual(commits.map((c) => c.hash), ["a1", "a2", "a4"], "the bot commit is skipped");
  assert.deepEqual(commits.map((c) => c.ai), [true, false, true]);
  assert.deepEqual(commits[0].files, ["src/refund.ts", "src/ledger.ts"]);
  assert.equal(commits[0].date, "2026-05-01");
  assert.ok(AI_MARK.test("Co-authored-by: GitHub Copilot <x>") && !AI_MARK.test("I used a claude-shaped mug"), "only an explicit mark counts");
  assert.deepEqual(parseLog(""), []);
  assert.deepEqual(parseLog(`${RS}garbage`), [], "malformed records are ignored");
});

test("buildScan rolls up per file, keeps emails and messages out, and honours --names", async () => {
  const { parseLog, buildScan, authorId, summarize } = await load("scan.js");
  const raw =
    rec("c1", "Ana Lopez", "ana@secret-corp.com", "2026-01-10", "SECRET subject", "SECRET body", ["src/a.ts", "package-lock.json", "gone.ts"]) +
    rec("c2", "Ana Lopez", "ana@secret-corp.com", "2026-02-10", "x", "Co-Authored-By: Claude", ["src/a.ts"]) +
    rec("c3", "Ana Lopez", "ana@secret-corp.com", "2026-03-10", "x", "", ["src/a.ts", "src/b.ts"]) +
    rec("c4", "Bo Chen", "bo@secret-corp.com", "2026-03-11", "x", "", ["src/b.ts"]);
  const tracked = new Set(["src/a.ts", "src/b.ts", "package-lock.json"]);
  const p = buildScan("acme/web", parseLog(raw), tracked, { names: false });
  const text = JSON.stringify(p);
  assert.ok(!text.includes("secret-corp.com") && !text.includes("SECRET") && !text.includes("Ana Lopez") && !text.includes("Bo Chen"), "no emails, messages or names by default");
  assert.deepEqual(p.files.map((f) => f.path), ["src/a.ts", "src/b.ts"], "lockfiles and deleted files are left out");
  const a = p.files.find((f) => f.path === "src/a.ts");
  assert.equal(a.commits, 3);
  assert.equal(a.ai, 1);
  assert.equal(a.first, "2026-01-10");
  assert.equal(a.last, "2026-03-10");
  assert.deepEqual(a.authors, [{ id: authorId("ana@secret-corp.com"), commits: 3, last: "2026-03-10" }]);
  assert.match(authorId("ANA@secret-corp.com"), /^a_[a-f0-9]{10}$/);
  assert.equal(authorId("ANA@secret-corp.com"), authorId(" ana@secret-corp.com "), "the id is stable across case and spaces");
  assert.equal(p.since, "2026-01-10");
  assert.equal(p.commits, 4);
  const named = buildScan("acme/web", parseLog(raw), tracked, { names: true });
  assert.ok(named.people.some((x) => x.name === "Ana Lopez") && !JSON.stringify(named).includes("secret-corp.com"), "names only on request, and never emails");
  assert.equal(summarize(p).soleAuthorFiles, 1, "a.ts has one author across 3 commits");
});

function startTeam() {
  const got = { scans: [], records: [] };
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/learn/v1/summary") return void res.end(JSON.stringify({ team: { name: "Acme" }, members: [], blindSpots: [], totals: {} }));
      if (req.url === "/api/learn/v1/scan") {
        got.scans.push(JSON.parse(raw));
        return void res.end(JSON.stringify({ saved: got.scans.at(-1).files.length, people: got.scans.at(-1).people.length }));
      }
      if (req.url === "/api/learn/v1/records") {
        got.records.push(JSON.parse(raw));
        return void res.end(JSON.stringify({ saved: 1 }));
      }
      res.statusCode = 404;
      res.end("{}");
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, got, url: `http://127.0.0.1:${server.address().port}` })));
}

function repoWithHistory() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "zl-home-"));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "zl-repo-"));
  const env = { ZLEARN_HOME: home, ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", ZLEARN_API_KEY: "" };
  const commit = (who, email, msg, files) => {
    for (const [f, body] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true });
      fs.writeFileSync(path.join(repo, f), body);
    }
    execFileSync("git", ["add", "-A"], { cwd: repo });
    execFileSync("git", ["-c", `user.name=${who}`, "-c", `user.email=${email}`, "commit", "-qm", msg], { cwd: repo });
  };
  execFileSync("git", ["init", "-q"], { cwd: repo });
  commit("Ana Lopez", "ana@secret-corp.com", "start billing", { "src/billing.js": "export const v = 1;\n" });
  commit("Ana Lopez", "ana@secret-corp.com", "more billing\n\nCo-Authored-By: Claude <noreply@anthropic.com>", { "src/billing.js": "export const v = 2;\n" });
  commit("Ana Lopez", "ana@secret-corp.com", "even more billing", { "src/billing.js": "export const v = 3;\n", "src/util.js": "export const u = 1;\n" });
  commit("Bo Chen", "bo@secret-corp.com", "util work", { "src/util.js": "export const u = 2;\n" });
  return { home, repo, env };
}

test("scan --dry-run shows what would be sent and sends nothing; scan uploads only counts and anonymous ids", async (t) => {
  const team = await startTeam();
  t.after(() => team.server.close());
  const { repo, env } = repoWithHistory();

  const dry = await runAsync(["scan", "--dry-run", "--json"], { cwd: repo, env });
  assert.equal(dry.status, 0, dry.stderr);
  const d = JSON.parse(dry.stdout);
  assert.equal(d.dryRun, true);
  assert.equal(d.summary.files, 2);
  assert.equal(d.summary.soleAuthorFiles, 1, "billing.js has one author across 3 commits");
  assert.equal(d.summary.aiCommits, 1);
  assert.equal(team.got.scans.length, 0, "a dry run sends nothing");

  const notOnTeam = await runAsync(["scan"], { cwd: repo, env });
  assert.equal(notOnTeam.status, 0);
  assert.match(notOnTeam.stdout, /Not uploaded: you are not on a team/);

  const join = await runAsync(["team", "join", "--server", team.url, "--key", "zlt_scankeyscankeyscankey123456", "--email", "me@acme.dev"], { cwd: repo, env });
  assert.equal(join.status, 0, join.stderr);
  const up = await runAsync(["scan"], { cwd: repo, env });
  assert.equal(up.status, 0, up.stderr);
  assert.match(up.stdout, /Uploaded 2 files and 2 people/);
  const sent = team.got.scans[0];
  const text = JSON.stringify(sent);
  assert.ok(!text.includes("secret-corp.com") && !/Ana|Bo Chen|start billing|export const/.test(text), "no emails, names, commit messages or code were sent");
  assert.equal(sent.files.find((f) => f.path === "src/billing.js").authors.length, 1);
  assert.ok(sent.people.every((p) => /^a_[a-f0-9]{10}$/.test(p.id) && p.name === undefined));

  const named = await runAsync(["scan", "--names"], { cwd: repo, env });
  assert.equal(named.status, 0);
  assert.ok(team.got.scans[1].people.some((p) => p.name === "Ana Lopez"));
  assert.ok(!JSON.stringify(team.got.scans[1]).includes("secret-corp.com"), "names, never emails");
});

test("scan reports clearly when there is nothing to scan or the server refuses", async (t) => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "zl-empty-"));
  execFileSync("git", ["init", "-q"], { cwd: empty });
  const env = { ZLEARN_HOME: fs.mkdtempSync(path.join(os.tmpdir(), "zl-home-")) };
  assert.match(run(["scan"], { cwd: empty, env }).stdout, /No commits found/);
  assert.notEqual(run(["scan"], { cwd: os.tmpdir(), env }).status, 0, "needs a git repository");

  const refuse = http.createServer((req, res) => {
    req.resume();
    res.statusCode = 402;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "This team plan has ended." }));
  });
  await new Promise((r) => refuse.listen(0, "127.0.0.1", r));
  t.after(() => refuse.close());
  const { repo, env: env2 } = repoWithHistory();
  const out = await runAsync(["scan"], { cwd: repo, env: { ...env2, ZLEARN_TEAM_KEY: "zlt_refusekeyrefusekeyrefuse123", ZLEARN_SERVER: `http://127.0.0.1:${refuse.address().port}` } });
  assert.equal(out.status, 1);
  assert.match(out.stderr, /plan has ended/);
});

test("review with no API key: you read the change and describe it, nothing is graded, and your words stay local", async (t) => {
  const team = await startTeam();
  t.after(() => team.server.close());
  const { repo, env } = repoWithHistory();
  run(["init", "--no-prompt", "--no-agents"], { cwd: repo, env });
  await runAsync(["team", "join", "--server", team.url, "--key", "zlt_attestkeyattestkeyattest123", "--email", "me@acme.dev"], { cwd: repo, env });

  const answers = [
    "It adds the billing totals and now doubles the value on every run",
    "If the value is not a number the totals silently become wrong",
    "It assumes callers pass integers and that the util module is loaded first",
  ];
  const out = await runAsync(["review", "src/billing.js", "--commits", "3"], { cwd: repo, env, input: answers.join("\n") + "\ny\n" });
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /Read this change/);
  assert.match(out.stdout, /export const v/, "the real change is shown to the reader");
  assert.match(out.stdout, /not a score or a test/);

  const dir = path.join(repo, ".zlearn", "lessons");
  const saved = JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]), "utf8"));
  assert.equal(saved.explainer, "none");
  assert.equal(saved.kind, "review");
  assert.equal(saved.status, "passed");
  assert.deepEqual(saved.attest, answers, "the developer's words are kept locally");
  assert.equal(saved.response, "understood");
  const blob = execFileSync("git", ["hash-object", "src/billing.js"], { cwd: repo, encoding: "utf8" }).trim().slice(0, 12);
  assert.deepEqual(saved.revs, { "src/billing.js": blob });

  const sent = team.got.records.flatMap((r) => r.lessons).find((l) => l.status === "passed");
  assert.ok(sent, "the attested review was synced");
  assert.equal(sent.total, null, "no score is sent");
  assert.equal(sent.correct, null);
  assert.equal(sent.response, "understood");
  assert.deepEqual(sent.revs, { "src/billing.js": blob });
  assert.ok(!JSON.stringify(team.got.records).includes("doubles the value"), "the developer's own words were not sent");
});

test("attested review refuses clicking through, records an open question when asked, and --no-ai works with a key", async (t) => {
  const { answerProblem, PROMPTS } = await load("attest.js");
  assert.match(answerProblem("ok", []), /a little more/);
  assert.match(answerProblem("This is a long enough answer", ["this is a long enough answer"]), /same as an earlier/);
  assert.equal(answerProblem("A different and long enough answer", ["something else entirely"]), null);
  assert.equal(PROMPTS.length, 3);

  const { repo, env } = repoWithHistory();
  run(["init", "--no-prompt", "--no-agents"], { cwd: repo, env });
  // too-short answers are asked again, then accepted when real; "c" records an open question
  const input = ["ok", "It changes the billing total and rounds it", "It can fail when the input is empty and then returns nothing", "It relies on the util helper being imported before use", "c", "why does it round?"].join("\n") + "\n";
  const out = await runAsync(["review", "src/billing.js"], { cwd: repo, env: { ...env, ANTHROPIC_API_KEY: "test-key" }, input: input.replace("ok\n", "ok\n"), });
  // with a key, review uses the model (not available here), so force the no-model path
  assert.notEqual(out.status, 0, "with a key and no model server, the AI path is used and fails");
  const forced = await runAsync(["review", "src/billing.js", "--no-ai"], { cwd: repo, env: { ...env, ANTHROPIC_API_KEY: "test-key" }, input });
  assert.equal(forced.status, 0, forced.stderr);
  assert.match(forced.stdout, /Say a little more/);
  assert.match(forced.stdout, /Recorded as an open question/);
  const dir = path.join(repo, ".zlearn", "lessons");
  const lessons = fs.readdirSync(dir).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
  assert.ok(lessons.some((l) => l.explainer === "none" && l.response === "clarify" && l.note === "why does it round?"));

  const closed = await runAsync(["review", "src/billing.js"], { cwd: repo, env, input: "It does one thing only\n" });
  assert.notEqual(closed.status, 0, "if input ends before the review is finished nothing is recorded");
  assert.match(closed.stderr, /Nothing was recorded/);
});

test("doctor is happy without an API key, because scan and review need none", () => {
  const { repo, env } = repoWithHistory();
  run(["init", "--no-prompt", "--no-agents"], { cwd: repo, env });
  const d = JSON.parse(run(["doctor", "--json"], { cwd: repo, env }).stdout);
  assert.equal(d.ok, true, JSON.stringify(d));
});

test("setup: one command joins the team, turns zlearn on and uploads the first knowledge map", async (t) => {
  const team = await startTeam();
  t.after(() => team.server.close());
  const { repo, env } = repoWithHistory();

  const out = await runAsync(["setup", "--key", "zlt_setupkeysetupkeysetupkey123", "--email", "me@acme.dev", "--server", team.url], { cwd: repo, env });
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /1\/3\s+Joining your team/);
  assert.match(out.stdout, /Joined Acme as me@acme.dev/);
  assert.match(out.stdout, /2\/3\s+Turning zlearn on/);
  assert.match(out.stdout, /3\/3\s+Mapping who holds the knowledge/);
  assert.match(out.stdout, /Uploaded 2 files and 2 people/);
  assert.match(out.stdout, /Setup complete/);
  assert.ok(out.stdout.includes(team.url + "/account"), "it ends with the dashboard link");
  assert.match(out.stdout, /zlearn review <file>/, "and the next command to copy");

  assert.ok(fs.existsSync(path.join(repo, ".zlearn", "config.json")), "zlearn is on in the repository");
  assert.ok(fs.existsSync(path.join(repo, ".claude", "settings.local.json")), "the Claude Code hooks are installed");
  assert.equal(team.got.scans.length, 1, "the first scan was uploaded");
  assert.ok(!JSON.stringify(team.got.scans).includes("secret-corp.com"));

  // run again with nothing: it remembers the team, so no key or email is needed
  const again = await runAsync(["setup", "--skip-scan"], { cwd: repo, env });
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /1\/2\s+Joining your team/);
  assert.equal(team.got.scans.length, 1, "--skip-scan uploads nothing");
});

test("setup: the email comes from git config, the key from the environment, and a bad key saves nothing", async (t) => {
  const team = await startTeam();
  t.after(() => team.server.close());
  const { repo, env } = repoWithHistory();
  execFileSync("git", ["config", "user.email", "fromgit@acme.dev"], { cwd: repo });

  const noKey = await runAsync(["setup"], { cwd: repo, env: { ...env, ZLEARN_SERVER: team.url } });
  assert.equal(noKey.status, 2);
  assert.match(noKey.stderr, /team key is needed/);

  const ok = await runAsync(["setup", "--skip-scan"], { cwd: repo, env: { ...env, ZLEARN_TEAM_KEY: "zlt_envkeyenvkeyenvkeyenvkey123", ZLEARN_SERVER: team.url } });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /as fromgit@acme.dev/);

  const rejecting = http.createServer((req, res) => {
    req.resume();
    res.statusCode = 401;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "Invalid team key." }));
  });
  await new Promise((r) => rejecting.listen(0, "127.0.0.1", r));
  t.after(() => rejecting.close());
  const home2 = fs.mkdtempSync(path.join(os.tmpdir(), "zl-home-"));
  const bad = await runAsync(["setup", "--key", "zlt_wrongwrongwrongwrongwrong1", "--email", "a@b.co", "--server", `http://127.0.0.1:${rejecting.address().port}`], { cwd: repo, env: { ...env, ZLEARN_HOME: home2 } });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /not recognised/);
  assert.ok(!fs.existsSync(path.join(home2, "config.json")), "a bad key is not saved");
});

test("setup outside a git repository still joins the team and says what to do next", async (t) => {
  const team = await startTeam();
  t.after(() => team.server.close());
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "zl-home-"));
  const out = await runAsync(["setup", "--key", "zlt_nogitkeynogitkeynogitkey1234", "--email", "a@b.co", "--server", team.url], { cwd: os.tmpdir(), env: { ZLEARN_HOME: home } });
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /Joined Acme/);
  assert.match(out.stdout, /not inside a git repository/);
  assert.match(out.stdout, /cd your-project/);
});
