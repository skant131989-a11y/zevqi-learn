import fs from "node:fs";
import { apiKey, ensureGitignore, globalConfigPath, loadGlobal, loadProject, projectDir, providerOf, saveGlobal, saveProject } from "../config.js";
import { agentBlockInstalled, installAgentBlock, removeAgentBlock } from "../agents.js";
import { repoRoot } from "../git.js";
import { lastHookActivity } from "../activity.js";
import { hookCliPaths, hooksInstalled, installHooks, settingsPath, uninstallHooks } from "../hooks.js";
import { aiDisclosure, askLine, c, fail, mask, readSecret, timeAgo } from "../util.js";
import { emit, flagStr, needEnabled, needRoot } from "../context.js";
const scopeOf = (ctx) => (ctx.flags.global ? "global" : ctx.flags.shared ? "shared" : "local");
const GATES = ["off", "warn", "block"];
export const init = {
    name: "init",
    group: "Setup",
    summary: "Turn Zevqi on in this repo (installs the Claude Code hooks)",
    usage: "zevqi init [--shared | --global] [--gate off|warn|block] [--agents | --no-agents] [--no-prompt | --yes]",
    examples: ["zevqi init", "zevqi init --shared --gate block"],
    async run(ctx) {
        const root = needRoot();
        const gate = flagStr(ctx.flags.gate);
        if (gate && !GATES.includes(gate))
            fail(`--gate must be one of: ${GATES.join(", ")}`, 2);
        const existing = loadProject(root);
        if (!existing.aiNotice) {
            console.log(c.bold(aiDisclosure(providerOf(loadGlobal()), existing.maxFiles, Boolean(apiKey(loadGlobal())))) + "\n");
            // Only a configured model key sends anything to a provider, so only then is a confirmation needed.
            if (apiKey(loadGlobal()) && process.stdin.isTTY && !ctx.flags["no-prompt"] && !ctx.flags.yes) {
                const answer = await askLine("Continue? [Y/n] ");
                if (/^n/i.test(answer.trim()))
                    fail("Nothing was installed.", 1, "Run zevqi init again when you are ready.");
            }
        }
        saveProject(root, { ...existing, ...(gate ? { gate: gate } : {}), aiNotice: existing.aiNotice ?? new Date().toISOString() });
        ensureGitignore(root);
        const file = installHooks(root, scopeOf(ctx), ctx.cliPath);
        console.log(`${c.green("✓")} Zevqi is on. Hooks added to ${c.dim(file)}`);
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
            console.log(c.dim("Commit those files so every agent on the project sees them. Works with Codex, Cursor and Claude Code. Prefer Zevqi to explain changes itself? Run: zevqi config set apiKey"));
            console.log(c.dim("Also no key needed: zevqi scan (who holds the knowledge of each file, from git) and zevqi review <file> (you describe a change in your own words)."));
        }
        console.log(c.dim("\nRestart Claude Code (or open /hooks) so it picks up the hooks. After your agent finishes a turn, run: zevqi learn"));
    },
};
export const uninstall = {
    name: "uninstall",
    group: "Setup",
    summary: "Remove the hooks (your lessons stay in .zlearn/)",
    usage: "zevqi uninstall [--shared | --global]",
    run(ctx) {
        const root = needRoot();
        const file = uninstallHooks(root, scopeOf(ctx));
        const removed = removeAgentBlock(root);
        console.log(`Removed zevqi hooks from ${file}${removed.agentsMd ? ", and the lesson instructions from AGENTS.md" : ""}. Your lessons stay in ${projectDir(root)}.`);
    },
};
export const gate = {
    name: "gate",
    group: "Daily use",
    summary: "What happens when you commit with un-reviewed AI changes",
    usage: "zevqi gate <off|warn|block>",
    examples: ["zevqi gate warn"],
    run(ctx) {
        const root = needEnabled();
        const mode = ctx.args[0];
        if (!GATES.includes(mode))
            fail("Use: zevqi gate off|warn|block", 2);
        saveProject(root, { ...loadProject(root), gate: mode });
        console.log(`Commit gate: ${c.bold(mode)}`);
    },
};
export const config = {
    name: "config",
    group: "Setup",
    summary: "Show or change settings (API key, provider, model)",
    usage: "zevqi config show | zevqi config set <apiKey|provider|model|baseUrl> [value]",
    examples: ["zevqi config show", "zevqi config set apiKey          # prompts, input hidden", "zevqi config set model claude-haiku-4-5-20251001"],
    async run(ctx) {
        const cfg = loadGlobal();
        const [sub, key, value] = ctx.args;
        if (!sub || sub === "show") {
            const k = apiKey(cfg);
            const view = { provider: providerOf(cfg), model: cfg.model ?? "(default)", baseUrl: cfg.baseUrl ?? "(default)", apiKey: mask(k), team: cfg.team ? { server: cfg.team.server, email: cfg.team.email } : null, file: globalConfigPath() };
            return void console.log(JSON.stringify(view, null, 2));
        }
        if (sub === "set" && key) {
            if (!["apiKey", "provider", "model", "baseUrl"].includes(key))
                fail("Settable keys: apiKey, provider, model, baseUrl", 2);
            let v = value;
            if (!v && key === "apiKey")
                v = await readSecret("API key (input hidden): ");
            if (!v)
                fail(`Give a value: zevqi config set ${key} <value>`, 2);
            if (key === "provider" && !["anthropic", "openai"].includes(v))
                fail("provider must be anthropic or openai", 2);
            cfg[key] = v;
            saveGlobal(cfg);
            console.log(`${c.green("✓")} Saved ${key}${key === "apiKey" ? ` (${mask(v)})` : ""}.`);
            return;
        }
        fail("Usage: zevqi config show | zevqi config set <key> [value]", 2);
    },
};
export const doctor = {
    name: "doctor",
    group: "Setup",
    summary: "Check that everything is wired up",
    usage: "zevqi doctor [--json] [--live [--wait 120]]",
    examples: ["zevqi doctor", "zevqi doctor --live      # then ask your agent to edit any file; this confirms the hooks fired"],
    async run(ctx) {
        const root = repoRoot(process.cwd());
        const cfg = loadGlobal();
        const checks = [];
        const add = (ok, label, fix) => checks.push({ ok, label, fix });
        add(Number(process.versions.node.split(".")[0]) >= 20, `Node ${process.versions.node}`, "Node 20 or newer is required");
        add(Boolean(root), "Inside a git repository", "run this in your project");
        if (root) {
            add(fs.existsSync(projectDir(root)), "Zevqi enabled in this repo", "zevqi init");
            const where = hooksInstalled(root);
            add(where.length > 0, `Claude Code hooks installed${where.length ? ` (${where.join(", ")})` : ""}`, "zevqi init");
            // A hook whose program has moved (a reinstall, a new Node version) fails silently, so check each one still exists.
            for (const h of hookCliPaths(root))
                add(fs.existsSync(h.cliPath), `Hook program found (${h.scope})`, `the hooks point at ${h.cliPath}, which is missing. Run: zevqi init`);
            const seen = fs.existsSync(projectDir(root)) ? lastHookActivity(root) : null;
            add(true, seen ? `Hooks last ran ${timeAgo(seen.at)} (${seen.event}${seen.file ? `: ${seen.file}` : ""})` : "Hooks have not run in this repo yet. Restart Claude Code, then let your agent edit a file (zevqi doctor --live confirms it)");
        }
        const agentMode = Boolean(root && agentBlockInstalled(root));
        // A key is optional: scan, attested review and agent-written lessons all work without one.
        add(true, apiKey(cfg) ? `API key found (${providerOf(cfg)}), so Zevqi can write questions itself` : agentMode ? "No API key: your coding agent writes lessons (AGENTS.md instructions installed)" : "No API key: zevqi scan and zevqi review work without one (add a key for AI-written questions)");
        add(true, cfg.team ? `Team: ${cfg.team.server}` : "Team: not connected (optional)");
        emit(ctx, { ok: checks.every((x) => x.ok), checks }, () => {
            for (const x of checks)
                console.log(`${x.ok ? c.green("✓") : c.red("✗")} ${x.label}${x.ok || !x.fix ? "" : c.dim(`  → ${x.fix}`)}`);
            if (root)
                for (const s of hooksInstalled(root))
                    console.log(c.dim(`   ${settingsPath(root, s)}`));
        });
        if (checks.some((x) => !x.ok))
            process.exitCode = 1;
        // --live: the only real proof the hooks work is seeing one fire. Wait for the next hook event from the agent.
        if (ctx.flags.live && !ctx.json) {
            if (!root || !fs.existsSync(projectDir(root)))
                return void console.log(c.red("\nZevqi is not enabled here, so there is nothing to wait for. Run: zevqi init"));
            const waitSec = Math.max(1, Math.min(600, Number(flagStr(ctx.flags.wait)) || 120));
            const since = Date.now();
            console.log(`\nWaiting up to ${waitSec}s. In Claude Code, in this folder, ask your agent to edit any file (a comment is enough).`);
            const deadline = since + waitSec * 1000;
            while (Date.now() < deadline) {
                const seen = lastHookActivity(root);
                if (seen && Date.parse(seen.at) >= since) {
                    console.log(c.green(`✓ The hooks are live: ${seen.event} ran${seen.file ? ` for ${seen.file}` : ""}.`));
                    console.log(c.dim(apiKey(cfg) ? "With your API key, a lesson is written in the background when the agent finishes its turn." : "Without an API key your agent writes the lesson (AGENTS.md); run zevqi once it has finished."));
                    return;
                }
                await new Promise((r) => setTimeout(r, 500));
            }
            console.log(c.red("✗ No hook ran. Claude Code did not call Zevqi."));
            console.log("  1. Restart Claude Code in this folder (hooks are read when it starts), or open /hooks to check they are listed.");
            console.log("  2. Make sure you opened Claude Code in this repository folder, not a parent or sub-folder.");
            console.log(`  3. Check the hook settings file above exists, then run ${c.bold("zevqi init")} again.`);
            process.exitCode = 1;
        }
    },
};
