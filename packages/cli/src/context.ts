import fs from "node:fs";
import { projectDir } from "./config.js";
import { repoRoot } from "./git.js";
import { fail } from "./util.js";

export type Flags = Record<string, string | true>;

export interface Context {
  /** Positional arguments after the command name. */
  args: string[];
  flags: Flags;
  /** `--json`: machine-readable output where a command supports it. */
  json: boolean;
  /** Absolute path of this CLI's entry file (hooks re-invoke it). */
  cliPath: string;
  version: string;
}

export type CommandGroup = "Setup" | "Daily use" | "Teams" | "hidden";

export interface Command {
  name: string;
  aliases?: string[];
  group: CommandGroup;
  summary: string;
  usage: string;
  examples?: string[];
  run(ctx: Context): Promise<void> | void;
}

export const flagStr = (v: string | true | undefined): string | undefined => (typeof v === "string" ? v : undefined);

export function needRoot(): string {
  const root = repoRoot(process.cwd());
  if (!root) fail("Run this inside a git repository.", 2, "cd into your project first.");
  return root;
}

export function needEnabled(): string {
  const root = needRoot();
  if (!fs.existsSync(projectDir(root))) fail("zlearn is not enabled here yet.", 2, "Run: zlearn init");
  return root;
}

/** Print machine-readable JSON when `--json` is set, otherwise run the human renderer. */
export function emit(ctx: Context, data: unknown, human: () => void): void {
  if (ctx.json) console.log(JSON.stringify(data, null, 2));
  else human();
}
