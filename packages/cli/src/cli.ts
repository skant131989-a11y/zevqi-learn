#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { apiKey, ensureGitignore, globalConfigPath, loadGlobal, loadProject, projectDir, providerOf, saveGlobal, saveProject, type Gate } from "./config.js";
import { changedFiles, repoRoot } from "./git.js";
import { AiError, commitGateHook, explainJob, hooksInstalled, installHooks, postToolHook, settingsPath, stopHook, uninstallHooks } from "./hooks.js";
import { getLesson, knowledgeMap, listLessons, pending } from "./lessons.js";
import { runQuiz } from "./quiz.js";
import { startServer } from "./server.js";
import { createTeam, joinTeam, leaveTeam, pushRecords, teamSummary, toRecord } from "./team.js";
import { c, fail, timeAgo, uid, writeJson } from "./util.js";

const CLI_PATH = fileURLToPath(import.meta.url);
const VERSION = "0.1.0";

type Args = { _: string[]; flags: Record<string, string | true> };

function parseArgs(argv: string[]): Args {
  const out: Args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out.flags[key] = next;
        i++;
      } else out.flags[key] = true;
    } else out._.push(a);
  }
  return out;
}

const HELP = `${c.bold("zlearn")} ${VERSION}: understand the code your AI agent writes, as fast as it writes it.

${c.bold("Setup")}
  zlearn init [--shared|--global] [--gate off|warn|block]   turn it on in this repo (installs the Claude Code hooks)
  zlearn uninstall [--shared|--global]                      remove the hooks
  zlearn config set <apiKey|provider|model|baseUrl> <value>
  zlearn doctor                                             check that everything is wired up

${c.bold("Daily use")}
  zlearn learn [lessonId]      take the quiz for the oldest un-reviewed change
  zlearn explain               explain your current uncommitted changes now
  zlearn status                what is waiting for review
  zlearn ui [--port 4317]      open the local dashboard in your browser
  zlearn gate <off|warn|block> what happens when you commit un-reviewed AI changes

${c.bold("Teams")}
  zlearn team create --server <url> --name <team> [--secret <s>]
  zlearn team join --server <url> --key <teamKey> --email <you> [--name <you>]
  zlearn team status | sync | leave
`;

function needRoot(): string {
  const root = repoRoot(process.cwd());
  if (!root) fail("Run this inside a git repository.");
  return root;
}

function needEnabled(): string {
  const root = needRoot();
  if (!fs.existsSync(projectDir(root))) fail("zlearn is not enabled here yet. Run: zlearn init");
  return root;
}

async function main() {
  const { _: pos, flags } = parseArgs(process.argv.slice(2));
  const cmd = pos[0];

  if (!cmd || cmd === "help" || flags.help) return void console.log(HELP);
  if (cmd === "--version" || cmd === "version" || flags.version) return void console.log(VERSION);

  if (cmd === "hook") {
    // Hooks must never break the agent: swallow every error and always exit 0.
    try {
      if (pos[1] === "post-tool") await postToolHook();
      else if (pos[1] === "stop") await stopHook(CLI_PATH);
      else if (pos[1] === "commit-gate") await commitGateHook();
    } catch {
      // intentionally silent
    }
    return;
  }

  if (cmd === "init") {
    const root = needRoot();
    const scope = flags.global ? "global" : flags.shared ? "shared" : "local";
    saveProject(root, { ...loadProject(root), ...(typeof flags.gate === "string" && ["off", "warn", "block"].includes(flags.gate) ? { gate: flags.gate as Gate } : {}) });
    ensureGitignore(root);
    const file = installHooks(root, scope, CLI_PATH);
    console.log(c.green("zlearn is on.") + ` Hooks added to ${c.dim(file)}`);
    if (!apiKey(loadGlobal())) console.log(c.yellow("Next: set an API key, e.g. ") + "export ANTHROPIC_API_KEY=...  " + c.dim("(or: zlearn config set apiKey <key>)"));
    console.log(c.dim("Restart Claude Code (or open /hooks) so it picks up the hooks. After your agent finishes a turn, run: zlearn learn"));
    return;
  }

  if (cmd === "uninstall") {
    const root = needRoot();
    const file = uninstallHooks(root, flags.global ? "global" : flags.shared ? "shared" : "local");
    console.log(`Removed zlearn hooks from ${file}. Your lessons stay in ${projectDir(root)}.`);
    return;
  }

  if (cmd === "explain" && typeof flags.job === "string") {
    const root = typeof flags.root === "string" ? flags.root : needRoot();
    try {
      await explainJob(root, flags.job);
    } catch (e) {
      writeJson(path.join(projectDir(root), "last-error.json"), { at: new Date().toISOString(), message: e instanceof Error ? e.message : String(e) });
    }
    return;
  }

  if (cmd === "explain") {
    const root = needEnabled();
    const files = changedFiles(root);
    if (files.length === 0) return void console.log("No uncommitted changes to explain.");
    const jobId = uid("job_");
    writeJson(path.join(projectDir(root), "jobs", `${jobId}.json`), { files });
    console.log(c.dim(`Explaining ${files.length} changed file${files.length === 1 ? "" : "s"}…`));
    try {
      const lesson = await explainJob(root, jobId);
      if (!lesson) return void console.log("Nothing to explain.");
      console.log(c.green("Lesson ready.") + " Run: zlearn learn");
    } catch (e) {
      fail(e instanceof AiError ? e.message : String(e));
    }
    return;
  }

  if (cmd === "learn" || cmd === "quiz") {
    const root = needEnabled();
    const open = pending(root).reverse();
    const lesson = pos[1] ? getLesson(root, pos[1]) : open[0];
    if (!lesson) return void console.log(pos[1] ? "No such lesson." : c.green("Nothing waiting. You are up to date."));
    await runQuiz(root, lesson);
    const left = pending(root).length;
    if (left) console.log(c.dim(`${left} more waiting. Run zlearn learn again.`));
    return;
  }

  if (cmd === "status") {
    const root = needEnabled();
    const lessons = listLessons(root);
    const open = lessons.filter((l) => l.status === "pending");
    const cfg = loadProject(root);
    console.log(`${c.bold(String(open.length))} waiting for review · ${lessons.filter((l) => l.status === "passed").length} passed · gate: ${cfg.gate} · hooks: ${hooksInstalled(root).join(", ") || c.red("not installed")}`);
    for (const l of open.slice(0, 5)) console.log(`  ${c.dim(timeAgo(l.createdAt).padEnd(8))} ${l.changedFiles.slice(0, 3).join(", ")}${l.changedFiles.length > 3 ? "…" : ""}  ${c.dim(l.id)}`);
    const blind = knowledgeMap(root).filter((f) => f.open > 0 && f.passed === 0).slice(0, 5);
    if (blind.length) console.log(c.yellow("Not reviewed yet: ") + blind.map((f) => f.path).join(", "));
    return;
  }

  if (cmd === "ui") {
    const root = needEnabled();
    const port = Number(flags.port) || 4317;
    startServer(root, port, (url) => console.log(`zlearn dashboard: ${c.cyan(url)}\n${c.dim("Press Ctrl+C to stop.")}`));
    return;
  }

  if (cmd === "gate") {
    const root = needEnabled();
    const mode = pos[1];
    if (!["off", "warn", "block"].includes(mode ?? "")) fail("Use: zlearn gate off|warn|block");
    saveProject(root, { ...loadProject(root), gate: mode as Gate });
    return void console.log(`Commit gate: ${mode}`);
  }

  if (cmd === "config") {
    const cfg = loadGlobal();
    if (pos[1] === "show" || !pos[1]) {
      const key = apiKey(cfg);
      return void console.log(JSON.stringify({ provider: providerOf(cfg), model: cfg.model ?? "(default)", baseUrl: cfg.baseUrl ?? "(default)", apiKey: key ? `${key.slice(0, 6)}…` : "(not set)", team: cfg.team ? { server: cfg.team.server, email: cfg.team.email } : null, file: globalConfigPath() }, null, 2));
    }
    if (pos[1] === "set" && pos[2] && pos[3]) {
      if (!["apiKey", "provider", "model", "baseUrl"].includes(pos[2])) fail("Settable keys: apiKey, provider, model, baseUrl");
      if (pos[2] === "provider" && !["anthropic", "openai"].includes(pos[3])) fail("provider must be anthropic or openai");
      (cfg as Record<string, unknown>)[pos[2]] = pos[3];
      saveGlobal(cfg);
      return void console.log(`Saved ${pos[2]}.`);
    }
    return fail("Usage: zlearn config show | zlearn config set <key> <value>");
  }

  if (cmd === "team") {
    const sub = pos[1];
    const server = typeof flags.server === "string" ? flags.server : loadGlobal().team?.server ?? "https://zevqi.com";
    if (sub === "create") {
      if (typeof flags.name !== "string") fail("Usage: zlearn team create --server <url> --name <team> [--secret <s>]");
      const res = await createTeam(server, flags.name, typeof flags.secret === "string" ? flags.secret : undefined).catch((e) => fail(e.message));
      console.log(c.green("Team created."));
      console.log(`  Team key (share with teammates, keep private): ${c.bold(res.teamKey)}`);
      console.log(`  Dashboard (admins only):                        ${c.cyan(res.dashboardUrl)}`);
      console.log(c.dim(`  Teammates join with: zlearn team join --server ${server} --key ${res.teamKey} --email <their email>`));
      return;
    }
    if (sub === "join") {
      if (typeof flags.key !== "string" || typeof flags.email !== "string") fail("Usage: zlearn team join --server <url> --key <teamKey> --email <you> [--name <you>]");
      joinTeam(server, flags.key, flags.email, typeof flags.name === "string" ? flags.name : undefined);
      return void console.log(c.green("Joined.") + ` Results sync to ${server}. By default only scores and file names are shared, never code.`);
    }
    if (sub === "leave") {
      leaveTeam();
      return void console.log("Left the team on this machine.");
    }
    if (sub === "sync") {
      const root = needEnabled();
      const cfg = loadProject(root);
      const r = await pushRecords(listLessons(root).map((l) => toRecord(l, cfg.share)));
      return void console.log(r.error ? c.red(`Sync failed: ${r.error}`) : c.green(`Synced ${r.sent} lesson${r.sent === 1 ? "" : "s"}.`));
    }
    if (sub === "status") {
      const s = await teamSummary().catch((e) => fail(e.message));
      console.log(c.bold(s.team?.name ?? "Team"));
      for (const m of s.members ?? []) console.log(`  ${String(m.email).padEnd(30)} ${m.passed} passed · ${m.pending} waiting · ${m.passRate}% pass rate`);
      if (s.blindSpots?.length) console.log(c.yellow("Blind spots (changed by AI, nobody has passed a lesson on them): ") + s.blindSpots.slice(0, 8).map((b: { path: string }) => b.path).join(", "));
      return;
    }
    return fail("Usage: zlearn team create|join|status|sync|leave");
  }

  if (cmd === "doctor") {
    const root = repoRoot(process.cwd());
    const cfg = loadGlobal();
    const ok = (b: boolean, label: string, fix = "") => console.log(`${b ? c.green("✓") : c.red("✗")} ${label}${b || !fix ? "" : c.dim(`  → ${fix}`)}`);
    ok(Number(process.versions.node.split(".")[0]) >= 20, `Node ${process.versions.node}`, "Node 20 or newer is required");
    ok(Boolean(root), "Inside a git repository", "run this in your project");
    if (root) {
      ok(fs.existsSync(projectDir(root)), "zlearn enabled in this repo", "zlearn init");
      const where = hooksInstalled(root);
      ok(where.length > 0, `Claude Code hooks installed${where.length ? ` (${where.join(", ")})` : ""}`, "zlearn init");
      if (where.length) for (const s of where) console.log(c.dim(`   ${settingsPath(root, s as "local")}`));
    }
    ok(Boolean(apiKey(cfg)), `API key found (${providerOf(cfg)})`, "export ANTHROPIC_API_KEY=… or zlearn config set apiKey <key>");
    ok(true, cfg.team ? `Team: ${cfg.team.server}` : "Team: not connected (optional)");
    return;
  }

  fail(`Unknown command "${cmd}". Run: zlearn help`);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
