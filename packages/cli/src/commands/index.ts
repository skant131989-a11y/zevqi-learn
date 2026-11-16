import { c } from "../util.js";
import type { Command, CommandGroup } from "../context.js";
import { config, doctor, gate, init, uninstall } from "./setup.js";
import { explain, learn, stats, status, ui } from "./daily.js";
import { team } from "./team.js";
import { hook } from "./hook.js";

export const COMMANDS: Command[] = [init, uninstall, config, doctor, learn, explain, status, stats, ui, gate, team, hook];

export function findCommand(name: string): Command | undefined {
  return COMMANDS.find((cmd) => cmd.name === name || cmd.aliases?.includes(name));
}

const GROUPS: CommandGroup[] = ["Setup", "Daily use", "Teams"];

export function renderHelp(version: string): string {
  const lines = [`${c.bold("zlearn")} ${version}  understand the code your AI agent writes, as fast as it writes it.`, "", `${c.bold("Usage")}  zlearn <command> [options]`];
  for (const group of GROUPS) {
    lines.push("", c.bold(group));
    for (const cmd of COMMANDS.filter((x) => x.group === group)) lines.push(`  ${cmd.name.padEnd(10)} ${cmd.summary}`);
  }
  lines.push("", c.dim("Run `zlearn help <command>` for details. Add --json to status, stats, doctor and team status for scripts."), c.dim("Docs: https://zevqi.com/docs"));
  return lines.join("\n");
}

export function renderCommandHelp(cmd: Command): string {
  const lines = [`${c.bold(`zlearn ${cmd.name}`)}  ${cmd.summary}`, "", `${c.bold("Usage")}  ${cmd.usage}`];
  if (cmd.examples?.length) lines.push("", c.bold("Examples"), ...cmd.examples.map((e) => `  ${e}`));
  return lines.join("\n");
}

/** Closest known command for a typo, or undefined. */
export function suggest(input: string): string | undefined {
  const names = COMMANDS.filter((x) => x.group !== "hidden").flatMap((x) => [x.name, ...(x.aliases ?? [])]);
  let best: { name: string; d: number } | undefined;
  for (const name of names) {
    const d = distance(input, name);
    if (d <= 2 && (!best || d < best.d)) best = { name, d };
  }
  return best?.name;
}

function distance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length]![b.length]!;
}
