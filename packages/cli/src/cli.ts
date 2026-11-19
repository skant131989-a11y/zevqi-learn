#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { parseArgs } from "./args.js";
import { findCommand, renderCommandHelp, renderHelp, suggest } from "./commands/index.js";
import { defaultAction } from "./commands/daily.js";
import type { Context } from "./context.js";
import { c, CliError, fail } from "./util.js";
import { VERSION } from "./version.js";

const CLI_PATH = fileURLToPath(import.meta.url);

export async function main(argv: string[]): Promise<void> {
  const { _: pos, flags } = parseArgs(argv);
  const name = pos[0];

  if (flags.version || name === "version" || name === "--version") return void console.log(VERSION);
  if (!name && !flags.help) {
    // zevqi on its own: in a repo where Zevqi is on, go straight to what needs doing. Anywhere else, the help.
    const own: Context = { args: [], flags, json: Boolean(flags.json), cliPath: CLI_PATH, version: VERSION };
    if (await defaultAction(own)) return;
  }
  if (!name || (name === "help" && !pos[1])) return void console.log(renderHelp(VERSION));

  if (name === "help") {
    const target = findCommand(pos[1]!);
    if (!target) fail(`Unknown command "${pos[1]}".`, 2, "Run: zevqi help");
    return void console.log(renderCommandHelp(target));
  }

  const cmd = findCommand(name);
  if (!cmd) {
    const near = suggest(name);
    fail(`Unknown command "${name}".`, 2, near ? `Did you mean: zevqi ${near}?` : "Run: zevqi help");
  }
  if (flags.help) return void console.log(renderCommandHelp(cmd));

  const ctx: Context = { args: pos.slice(1), flags, json: Boolean(flags.json), cliPath: CLI_PATH, version: VERSION };
  await cmd.run(ctx);
}

main(process.argv.slice(2)).catch((e: unknown) => {
  if (e instanceof CliError) {
    console.error(c.red(`zevqi: ${e.message}`));
    if (e.hint) console.error(c.dim(e.hint));
    process.exitCode = e.code;
    return;
  }
  console.error(c.red(`zevqi: ${e instanceof Error ? e.message : String(e)}`));
  process.exitCode = 1;
});
