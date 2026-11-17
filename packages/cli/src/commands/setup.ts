import fs from "node:fs";
import { apiKey, ensureGitignore, globalConfigPath, loadGlobal, loadProject, projectDir, providerOf, saveGlobal, saveProject, type Gate } from "../config.js";
import { agentBlockInstalled, installAgentBlock, removeAgentBlock } from "../agents.js";
import { repoRoot } from "../git.js";
import { hooksInstalled, installHooks, settingsPath, uninstallHooks } from "../hooks.js";
import { aiDisclosure, askLine, c, fail, mask, readSecret } from "../util.js";
import { emit, flagStr, needEnabled, needRoot, type Command, type Context } from "../context.js";

const scopeOf = (ctx: Context) => (ctx.flags.global ? "global" : ctx.flags.shared ? "shared" : "local");
const GATES: Gate[] = ["off", "warn", "block"];

export const init: Command = {
  name: "init",
  group: "Setup",
  summary: "Turn zlearn on in this repo (installs the Claude Code hooks)",
  usage: "zlearn init [--shared | --global] [--gate off|warn|block] [--agents | --no-agents] [--no-prompt | --yes]",
  examples: ["zlearn init", "zlearn init --shared --gate block"],
  async run(ctx) {
    const root = needRoot();
    const gate = flagStr(ctx.flags.gate);
    if (gate && !GATES.includes(gate as Gate)) fail(`--gate must be one of: ${GATES.join(", ")}`, 2);
    const existing = loadProject(root);
    if (!existing.aiNotice) {
      console.log(c.bold(aiDisclosure(providerOf(loadGlobal()), existing.maxFiles, Boolean(apiKey(loadGlobal())))) + "\n");
      // Only a configured model key sends anything to a provider, so only then is a confirmation needed.
      if (apiKey(loadGlobal()) && process.stdin.isTTY && !ctx.flags["no-prompt"] && !ctx.flags.yes) {
        const answer = await askLine("Continue? [Y/n] ");
        if (/^n/i.test(answer.trim())) fail("Nothing was installed.", 1, "Run zlearn init again when you are ready.");
      }
    }
    saveProject(root, { ...existing, ...(gate ? { gate: gate as Gate } : {}), aiNotice: existing.aiNotice ?? new Date().toISOString() });
    ensureGitignore(root);
    const file = installHooks(root, scopeOf(ctx), ctx.cliPath);
    console.log(`${c.green("✓")} zlearn is on. Hooks added to ${c.dim(file)}`);

    if (!apiKey(loadGlobal())) {
      if (process.stdin.isTTY && !ctx.flags["no-prompt"]) {
        console.log("\nzlearn uses your own model key. It is stored on this machine only (owner-readable file).");
        const key = await readSecret("Paste your API key (input hidden, Enter to skip): ");
        if (key) {
          saveGlobal({ ...loadGlobal(), apiKey: key });
          console.log(`${c.green("✓")} Saved ${c.dim(mask(key))} to ${c.dim(globalConfigPath())}`);
        }
      }
    }
    // No key (or --agents): let the coding agent that wrote the change write the lesson too. Works with Codex, Cursor and Claude Code.
    if (ctx.flags.agents || (!apiKey(loadGlobal()) && !ctx.flags["no-agents"])) {
      const r = installAgentBlock(root);
      console.log(`${c.green("✓")} Your coding agent will write the lessons, so no API key is needed. Instructions ${r.agentsMd} in ${c.dim("AGENTS.md")}${r.claudeMd !== "none" ? `, import ${r.claudeMd} in ${c.dim("CLAUDE.md")}` : ""}.`);
      console.log(c.dim("Commit those files so every agent on the project sees them. Works with Codex, Cursor and Claude Code. Prefer zlearn to explain changes itself? Run: zlearn config set apiKey"));
      console.log(c.dim("Also no key needed: zlearn scan (who holds the knowledge of each file, from git) and zlearn review <file> (you describe a change in your own words)."));
    }
    console.log(c.dim("\nRestart Claude Code (or open /hooks) so it picks up the hooks. After your agent finishes a turn, run: zlearn learn"));
  },
};

export const uninstall: Command = {
  name: "uninstall",
  group: "Setup",
  summary: "Remove the hooks (your lessons stay in .zlearn/)",
  usage: "zlearn uninstall [--shared | --global]",
  run(ctx) {
    const root = needRoot();
    const file = uninstallHooks(root, scopeOf(ctx));
    const removed = removeAgentBlock(root);
    console.log(`Removed zlearn hooks from ${file}${removed.agentsMd ? ", and the lesson instructions from AGENTS.md" : ""}. Your lessons stay in ${projectDir(root)}.`);
  },
};

export const gate: Command = {
  name: "gate",
  group: "Daily use",
  summary: "What happens when you commit with un-reviewed AI changes",
  usage: "zlearn gate <off|warn|block>",
  examples: ["zlearn gate warn"],
  run(ctx) {
    const root = needEnabled();
    const mode = ctx.args[0];
    if (!GATES.includes(mode as Gate)) fail("Use: zlearn gate off|warn|block", 2);
    saveProject(root, { ...loadProject(root), gate: mode as Gate });
    console.log(`Commit gate: ${c.bold(mode!)}`);
  },
};

export const config: Command = {
  name: "config",
  group: "Setup",
  summary: "Show or change settings (API key, provider, model)",
  usage: "zlearn config show | zlearn config set <apiKey|provider|model|baseUrl> [value]",
  examples: ["zlearn config show", "zlearn config set apiKey          # prompts, input hidden", "zlearn config set model claude-haiku-4-5-20251001"],
  async run(ctx) {
    const cfg = loadGlobal();
    const [sub, key, value] = ctx.args;
    if (!sub || sub === "show") {
      const k = apiKey(cfg);
      const view = { provider: providerOf(cfg), model: cfg.model ?? "(default)", baseUrl: cfg.baseUrl ?? "(default)", apiKey: mask(k), team: cfg.team ? { server: cfg.team.server, email: cfg.team.email } : null, file: globalConfigPath() };
      return void console.log(JSON.stringify(view, null, 2));
    }
    if (sub === "set" && key) {
      if (!["apiKey", "provider", "model", "baseUrl"].includes(key)) fail("Settable keys: apiKey, provider, model, baseUrl", 2);
      let v = value;
      if (!v && key === "apiKey") v = await readSecret("API key (input hidden): ");
      if (!v) fail(`Give a value: zlearn config set ${key} <value>`, 2);
      if (key === "provider" && !["anthropic", "openai"].includes(v)) fail("provider must be anthropic or openai", 2);
      (cfg as Record<string, unknown>)[key] = v;
      saveGlobal(cfg);
      console.log(`${c.green("✓")} Saved ${key}${key === "apiKey" ? ` (${mask(v)})` : ""}.`);
      return;
    }
    fail("Usage: zlearn config show | zlearn config set <key> [value]", 2);
  },
};

export const doctor: Command = {
  name: "doctor",
  group: "Setup",
  summary: "Check that everything is wired up",
  usage: "zlearn doctor [--json]",
  run(ctx) {
    const root = repoRoot(process.cwd());
    const cfg = loadGlobal();
    const checks: { ok: boolean; label: string; fix?: string }[] = [];
    const add = (ok: boolean, label: string, fix?: string) => checks.push({ ok, label, fix });
    add(Number(process.versions.node.split(".")[0]) >= 20, `Node ${process.versions.node}`, "Node 20 or newer is required");
    add(Boolean(root), "Inside a git repository", "run this in your project");
    if (root) {
      add(fs.existsSync(projectDir(root)), "zlearn enabled in this repo", "zlearn init");
      const where = hooksInstalled(root);
      add(where.length > 0, `Claude Code hooks installed${where.length ? ` (${where.join(", ")})` : ""}`, "zlearn init");
    }
    const agentMode = Boolean(root && agentBlockInstalled(root));
    // A key is optional: scan, attested review and agent-written lessons all work without one.
    add(true, apiKey(cfg) ? `API key found (${providerOf(cfg)}), so zlearn can write questions itself` : agentMode ? "No API key: your coding agent writes lessons (AGENTS.md instructions installed)" : "No API key: zlearn scan and zlearn review work without one (add a key for AI-written questions)");
    add(true, cfg.team ? `Team: ${cfg.team.server}` : "Team: not connected (optional)");

    emit(ctx, { ok: checks.every((x) => x.ok), checks }, () => {
      for (const x of checks) console.log(`${x.ok ? c.green("✓") : c.red("✗")} ${x.label}${x.ok || !x.fix ? "" : c.dim(`  → ${x.fix}`)}`);
      if (root) for (const s of hooksInstalled(root)) console.log(c.dim(`   ${settingsPath(root, s as "local")}`));
    });
    if (checks.some((x) => !x.ok)) process.exitCode = 1;
  },
};
