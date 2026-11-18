// The rename: the package is "zevqi", it installs both commands, old settings keep working, and the words are Zevqi's.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..");
const dist = path.resolve(here, "..", "dist");
const cli = path.join(dist, "cli.js");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

test("the package is named zevqi and installs two commands that run the same file", () => {
  assert.equal(pkg.name, "zevqi");
  assert.deepEqual(Object.keys(pkg.bin).sort(), ["zevqi", "zlearn"]);
  assert.equal(pkg.bin.zevqi, pkg.bin.zlearn, "both names point at one program");
  assert.ok(fs.existsSync(path.join(root, pkg.bin.zevqi)), "the program exists in the built output");
  assert.ok(pkg.files.includes("packages/cli/dist"), "the built output is what gets published");
});

test("the version in the package and the version the tool reports are the same", () => {
  const r = spawnSync(process.execPath, [cli, "--version"], { encoding: "utf8" });
  assert.equal(r.stdout.trim(), pkg.version);
});

test("settings: ZEVQI_ names win, and the older ZLEARN_ names still work", async () => {
  const { envVar } = await import(pathToFileURL(path.join(dist, "env.js")).href);
  const keep = { z: process.env.ZEVQI_TEAM_KEY, l: process.env.ZLEARN_TEAM_KEY };
  try {
    delete process.env.ZEVQI_TEAM_KEY;
    delete process.env.ZLEARN_TEAM_KEY;
    assert.equal(envVar("TEAM_KEY"), undefined, "nothing set");
    process.env.ZLEARN_TEAM_KEY = "zlt_old";
    assert.equal(envVar("TEAM_KEY"), "zlt_old", "an existing ZLEARN_ setup keeps working");
    process.env.ZEVQI_TEAM_KEY = "zlt_new";
    assert.equal(envVar("TEAM_KEY"), "zlt_new", "the new name wins when both are set");
    process.env.ZEVQI_TEAM_KEY = "";
    assert.equal(envVar("TEAM_KEY"), "zlt_old", "an empty new name falls back to the old one");
  } finally {
    if (keep.z === undefined) delete process.env.ZEVQI_TEAM_KEY; else process.env.ZEVQI_TEAM_KEY = keep.z;
    if (keep.l === undefined) delete process.env.ZLEARN_TEAM_KEY; else process.env.ZLEARN_TEAM_KEY = keep.l;
  }
});

test("help speaks as Zevqi and shows the zevqi command", () => {
  const r = spawnSync(process.execPath, [cli, "help"], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  const out = r.stdout + r.stderr;
  assert.match(out, /Zevqi/);
  assert.match(out, /Usage\s+zevqi <command>/);
  assert.match(out, /zevqi help <command>/);
  assert.doesNotMatch(out, /zlearn <command>|zlearn help/, "the old command name is not what we teach any more");
  // and a command's own help shows the new name in its examples
  const sub = spawnSync(process.execPath, [cli, "help", "setup"], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  assert.match(sub.stdout, /zevqi setup --key/);
});

test("the old command name still works when typed (same program, same commands)", () => {
  // both names reach the same dist/cli.js, so a command typed either way is the same command
  const r = spawnSync(process.execPath, [cli, "help", "setup"], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  assert.match(r.stdout, /--key <teamKey>/);
});

test("the settings folder keeps its old name, so nobody's existing setup is orphaned", () => {
  const config = fs.readFileSync(path.resolve(here, "..", "src", "config.ts"), "utf8");
  assert.match(config, /\.zlearn/);
});

test("text written into customers' repos keeps the markers and the old command, so every installed version can read it", () => {
  const agents = fs.readFileSync(path.resolve(here, "..", "src", "agents.ts"), "utf8");
  assert.match(agents, /<!-- zlearn:start -->/);
  assert.match(agents, /zlearn lesson add/);
});
