#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { parseArgs } from "./args.js";
import { findCommand, renderCommandHelp, renderHelp, suggest } from "./commands/index.js";
import { c, CliError, fail } from "./util.js";
import { VERSION } from "./version.js";
const CLI_PATH = fileURLToPath(import.meta.url);
export async function main(argv) {
    const { _: pos, flags } = parseArgs(argv);
    const name = pos[0];
    if (flags.version || name === "version" || name === "--version")
        return void console.log(VERSION);
    if (!name || (name === "help" && !pos[1]))
        return void console.log(renderHelp(VERSION));
    if (name === "help") {
        const target = findCommand(pos[1]);
        if (!target)
            fail(`Unknown command "${pos[1]}".`, 2, "Run: zlearn help");
        return void console.log(renderCommandHelp(target));
    }
    const cmd = findCommand(name);
    if (!cmd) {
        const near = suggest(name);
        fail(`Unknown command "${name}".`, 2, near ? `Did you mean: zlearn ${near}?` : "Run: zlearn help");
    }
    if (flags.help)
        return void console.log(renderCommandHelp(cmd));
    const ctx = { args: pos.slice(1), flags, json: Boolean(flags.json), cliPath: CLI_PATH, version: VERSION };
    await cmd.run(ctx);
}
main(process.argv.slice(2)).catch((e) => {
    if (e instanceof CliError) {
        console.error(c.red(`zlearn: ${e.message}`));
        if (e.hint)
            console.error(c.dim(e.hint));
        process.exitCode = e.code;
        return;
    }
    console.error(c.red(`zlearn: ${e instanceof Error ? e.message : String(e)}`));
    process.exitCode = 1;
});
