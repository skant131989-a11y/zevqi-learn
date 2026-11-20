import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const CLI = path.join(DIST, "cli.js");
const load = (rel) => import(pathToFileURL(path.join(DIST, rel)).href);
const run = (args, { cwd, env } = {}) => spawnSync(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, NO_COLOR: "1", ...env }, encoding: "utf8" });

const NOW = Date.parse("2026-11-20T12:00:00Z");
const DAY = 86_400_000;
const d = (ago) => new Date(NOW - ago * DAY).toISOString().slice(0, 10);
const A = "a_aaaaaaaaaa";
const B = "a_bbbbbbbbbb";
const C = "a_cccccccccc";
const file = (p, authors, ai, lastAgo) => ({ path: p, commits: authors.reduce((a, [, n]) => a + n, 0), ai, first: d(300), last: d(lastAgo), authors: authors.map(([id, commits]) => ({ id, commits, last: d(lastAgo) })) });
const people = [{ id: A, name: "Ana", commits: 40, ai: 6, last: d(2) }, { id: B, name: "Bo", commits: 20, ai: 0, last: d(5) }, { id: C, name: "Cy", commits: 10, ai: 0, last: d(200) }];
const payload = (files) => ({ repo: "acme/web", since: d(330), commits: 70, files, people });

test("audit counts one-author, inactive-owner, dormant and sensitive files by the documented rules", async () => {
  const { buildAudit } = await load("audit.js");
  const a = buildAudit(
    payload([
      file("src/ui.ts", [[A, 3]], 0, 5), // one author, active
      file("services/auth/login.ts", [[A, 4]], 2, 5), // one author, sensitive -> high
      file("lib/old.ts", [[C, 5]], 0, 200), // one author, owner inactive -> high
      file("lib/shared.ts", [[A, 3], [B, 3]], 0, 5), // two authors
      file("lib/tiny.ts", [[A, 2]], 0, 5), // only 2 commits: not "one author"
      file("lib/dormant.ts", [[A, 2], [B, 2]], 0, 250), // dormant
    ]),
    { now: NOW, months: 12 },
  );
  assert.equal(a.files, 6);
  assert.equal(a.oneAuthor, 3);
  assert.equal(a.oneAuthorSensitive, 1);
  assert.equal(a.ownerInactive, 1);
  assert.equal(a.dormant, 2, "old.ts (200 days) and dormant.ts (250 days)");
  assert.equal(a.high, 2);
  assert.equal(a.ai.files, 1);
  assert.deepEqual(a.top.slice(0, 2).map((f) => f.path).sort(), ["lib/old.ts", "services/auth/login.ts"]);
});

test("the largest dependency is a count and share, and names nobody unless asked", async () => {
  const { buildAudit } = await load("audit.js");
  const files = [file("a.ts", [[A, 3]], 0, 5), file("b.ts", [[A, 3]], 0, 5), file("c.ts", [[B, 3]], 0, 5)];
  const anon = buildAudit(payload(files), { now: NOW, months: 12 });
  assert.equal(anon.largestDependency.files, 2);
  assert.equal(anon.largestDependency.share, 66.7);
  assert.ok(!JSON.stringify(anon).includes("Ana") && !JSON.stringify(anon).includes(A), "no name or id in the result");
  const named = buildAudit(payload(files), { now: NOW, months: 12, names: true });
  assert.equal(named.largestDependency.name, "Ana");
});

test("the page is one self-contained file with no scripts or external requests, and escapes paths", async () => {
  const { buildAudit, renderHtml } = await load("audit.js");
  const a = buildAudit(payload([file("services/auth/<img src=x onerror=alert(1)>.ts", [[A, 3]], 0, 5)]), { now: NOW, months: 12 });
  const html = renderHtml(a, "9.9.9");
  assert.ok(!/<script/i.test(html), "no script tags");
  assert.ok(!/src=["']https?:/i.test(html) && !/<link/i.test(html), "no external files");
  assert.ok(!html.includes("<img src=x"), "path is escaped");
  assert.ok(html.includes("&lt;img src=x"), "escaped form is present");
  assert.ok(html.includes("utm_source=cli&utm_medium=audit_report"), "the one link carries its source");
  assert.ok(/not a compliance certificate/.test(html), "it says what it is not");
});

test("zevqi audit reads a real repository, writes the page, and sends nothing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zq-audit-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "ignore", env: { ...process.env, GIT_AUTHOR_NAME: "Dev One", GIT_AUTHOR_EMAIL: "one@x.dev", GIT_COMMITTER_NAME: "Dev One", GIT_COMMITTER_EMAIL: "one@x.dev" } });
  git("init", "-q");
  fs.mkdirSync(path.join(dir, "billing"));
  for (let i = 0; i < 4; i++) {
    fs.writeFileSync(path.join(dir, "billing", "invoice.ts"), `export const v = ${i};\n`);
    git("add", "-A");
    git("commit", "-q", "-m", `change ${i}`, ...(i === 1 ? ["-m", "Co-Authored-By: Claude <noreply@anthropic.com>"] : []));
  }
  const r = run(["audit", "--json"], { cwd: dir });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.files, 1);
  assert.equal(j.oneAuthor, 1);
  assert.equal(j.oneAuthorSensitive, 1, "billing/ is a sensitive area");
  assert.equal(j.ai.commits, 1);
  assert.ok(!r.stdout.includes("one@x.dev") && !r.stdout.includes("Dev One"), "no email or name in the output");

  const out = path.join(dir, "report.html");
  const h = run(["audit", "--html", "report.html"], { cwd: dir });
  assert.equal(h.status, 0, h.stderr);
  assert.ok(fs.existsSync(out) && /billing\/invoice\.ts/.test(fs.readFileSync(out, "utf8")));
  assert.ok(/Runs on this machine/.test(h.stdout) && /Wrote/.test(h.stdout));
  const outside = run(["audit"], { cwd: os.tmpdir() });
  assert.notEqual(outside.status, 0, "outside a repository it fails with a message");
});
