import { execFileSync } from "node:child_process";
import { loadGlobal } from "../config.js";
import { repoRoot } from "../git.js";
import { checkTeamKey, joinTeam, resolveTeam } from "../team.js";
import { c, fail } from "../util.js";
import { flagStr } from "../context.js";
import { hooksInstalled } from "../hooks.js";
import { init } from "./setup.js";
import { scan } from "./scan.js";
import { envVar } from "../env.js";
const gitEmail = () => {
    try {
        return execFileSync("git", ["config", "user.email"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || undefined;
    }
    catch {
        return undefined;
    }
};
/** The page a person lands on after setup. Signing in with an email code takes them to their dashboard. */
export const dashboardUrl = (server) => `${server.replace(/\/$/, "")}/account`;
/**
 * `zevqi setup`: the whole first run in one command. Joins the team, turns Zevqi on in this repository and uploads the first
 * git knowledge map. Each step says what it did and what is next; a failing step never undoes the ones before it.
 */
export const setup = {
    name: "setup",
    group: "Setup",
    summary: "One command: join your team, turn Zevqi on here, and scan this repository",
    usage: "zevqi setup --key <teamKey> [--email <you>] [--server <url>] [--name <you>] [--names] [--skip-scan]",
    examples: ["zevqi setup --key zlt_… --email you@company.com", "ZEVQI_TEAM_KEY=zlt_… zevqi setup      # the email comes from git config"],
    async run(ctx) {
        const key = flagStr(ctx.flags.key) ?? envVar("TEAM_KEY") ?? loadGlobal().team?.key;
        if (!key)
            fail("A team key is needed.", 2, "Pass --key <teamKey> (your team admin has it), or set ZEVQI_TEAM_KEY.");
        const server = flagStr(ctx.flags.server) ?? envVar("SERVER") ?? loadGlobal().team?.server ?? "https://zevqi.com";
        const email = flagStr(ctx.flags.email) ?? loadGlobal().team?.email ?? gitEmail();
        if (!email)
            fail("Your email is needed.", 2, "Pass --email you@company.com (or set it once with: git config --global user.email you@company.com).");
        const steps = ctx.flags["skip-scan"] ? 2 : 3;
        // 1. join the team
        console.log(c.bold(`\n1/${steps}  Joining your team`));
        const check = await checkTeamKey(server, key);
        if (!check.ok && check.reason === "invalid")
            fail(check.message, 1, "Nothing was saved. Ask your team admin for the key, or rotate it in the dashboard under Settings.");
        joinTeam(server, key, email, flagStr(ctx.flags.name));
        console.log(check.ok ? `${c.green("✓")} Joined ${check.teamName ? c.bold(check.teamName) : "the team"} as ${email}` : `${c.yellow("!")} Saved your team, but ${server} did not answer just now (${check.message}). Everything will queue and sync later.`);
        // 2. turn it on in this repository
        const root = repoRoot(process.cwd());
        if (!root) {
            console.log(`\n${c.yellow("!")} You are not inside a git repository, so the team is joined but nothing else was set up.`);
            console.log(`  Next: ${c.bold("cd your-project")} then run ${c.bold("zevqi setup")} again (it remembers your team).`);
            return;
        }
        console.log(c.bold(`\n2/${steps}  Turning Zevqi on in this repository`));
        const sub = (flags) => ({ ...ctx, args: [], flags, json: false });
        await init.run(sub({ "no-prompt": true, ...(ctx.flags.agents ? { agents: true } : {}), ...(ctx.flags["no-agents"] ? { "no-agents": true } : {}) }));
        // 3. the first knowledge map
        if (!ctx.flags["skip-scan"]) {
            console.log(c.bold(`\n3/${steps}  Mapping who holds the knowledge of each file (from git history)`));
            try {
                await scan.run(sub({ ...(ctx.flags.names ? { names: true } : {}) }));
            }
            catch (e) {
                console.log(`${c.yellow("!")} The scan did not finish: ${e instanceof Error ? e.message : String(e)}. Run ${c.bold("zevqi scan")} again later.`);
            }
        }
        const t = resolveTeam();
        console.log(`\n${c.green("✓ Setup complete.")}`);
        console.log(`  See your knowledge map:   ${c.cyan(dashboardUrl(t?.server ?? server))}  ${c.dim("(sign in with your email, then Open dashboard)")}`);
        console.log(`  Understand a file:        ${c.bold("zevqi review <file>")}`);
        // The one thing that is easy to miss: Claude Code only reads hooks when it starts.
        console.log(c.bold("\nOne step left"));
        if (hooksInstalled(root).length > 0) {
            console.log(`  Restart Claude Code in this folder once (or open /hooks), so it loads the hooks.`);
            console.log(`  After that there is nothing to remember: when your agent finishes, run ${c.bold("zevqi")} and it opens what is waiting.`);
            console.log(c.dim(`  Not sure it works? ${"zevqi doctor --live"} waits for your agent's next edit and confirms the hooks fired.`));
        }
        else {
            console.log(`  No Claude Code hooks were installed. After your agent changes code, run ${c.bold("zevqi")} and it opens what is waiting.`);
        }
    },
};
