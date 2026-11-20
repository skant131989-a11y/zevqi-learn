import { c } from "../util.js";
import { config, doctor, gate, init, uninstall } from "./setup.js";
import { explain, learn, review, stats, status, ui } from "./daily.js";
import { team } from "./team.js";
import { check } from "./check.js";
import { lesson } from "./lesson.js";
import { scan } from "./scan.js";
import { audit } from "./audit.js";
import { setup } from "./quickstart.js";
import { hook } from "./hook.js";
export const COMMANDS = [setup, init, uninstall, config, doctor, learn, review, lesson, scan, audit, explain, status, stats, ui, gate, team, check, hook];
export function findCommand(name) {
    return COMMANDS.find((cmd) => cmd.name === name || cmd.aliases?.includes(name));
}
const GROUPS = ["Setup", "Daily use", "Teams"];
export function renderHelp(version) {
    const lines = [`${c.bold("Zevqi")} ${version}  understand the code your AI agent writes, as fast as it writes it.`, "", `${c.bold("Usage")}  zevqi <command> [options]`];
    for (const group of GROUPS) {
        lines.push("", c.bold(group));
        for (const cmd of COMMANDS.filter((x) => x.group === group))
            lines.push(`  ${cmd.name.padEnd(10)} ${cmd.summary}`);
    }
    lines.push("", c.dim("Run `zevqi help <command>` for details. Add --json to status, stats, doctor and team status for scripts."), c.dim("Docs: https://zevqi.com/docs"));
    return lines.join("\n");
}
export function renderCommandHelp(cmd) {
    const lines = [`${c.bold(`zevqi ${cmd.name}`)}  ${cmd.summary}`, "", `${c.bold("Usage")}  ${cmd.usage}`];
    if (cmd.examples?.length)
        lines.push("", c.bold("Examples"), ...cmd.examples.map((e) => `  ${e}`));
    return lines.join("\n");
}
/** Closest known command for a typo, or undefined. */
export function suggest(input) {
    const names = COMMANDS.filter((x) => x.group !== "hidden").flatMap((x) => [x.name, ...(x.aliases ?? [])]);
    let best;
    for (const name of names) {
        const d = distance(input, name);
        if (d <= 2 && (!best || d < best.d))
            best = { name, d };
    }
    return best?.name;
}
function distance(a, b) {
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++)
        dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
    }
    return dp[a.length][b.length];
}
