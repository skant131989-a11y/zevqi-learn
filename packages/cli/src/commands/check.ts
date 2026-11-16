import fs from "node:fs";
import { changedSince, repoName } from "../git.js";
import { checkFiles, type CheckFile } from "../team.js";
import { c, fail } from "../util.js";
import { emit, flagStr, needRoot, type Command } from "../context.js";

type FailOn = "none" | "unreviewed" | "blind";

const ICON: Record<CheckFile["status"], string> = { blind: "✗", single: "!", covered: "✓", unknown: "·" };

/** Does this file break the chosen policy? */
function violates(f: CheckFile, failOn: FailOn): boolean {
  if (failOn === "unreviewed") return f.unreviewed;
  if (failOn === "blind") return f.status === "blind";
  return false;
}

export const check: Command = {
  name: "check",
  group: "Teams",
  summary: "Pull-request gate: which changed files have AI changes nobody has understood",
  usage: "zlearn check [--base <ref>] [--files a.ts,b.ts] [--fail-on none|unreviewed|blind] [--strict] [--json]",
  examples: [
    "zlearn check --base origin/main",
    "zlearn check --base origin/main --fail-on unreviewed     # exit 1 if a changed file has un-reviewed AI changes",
    "ZLEARN_TEAM_KEY=zlt_… zlearn check --fail-on blind       # in CI, no `team join` needed",
  ],
  async run(ctx) {
    const failOn = (flagStr(ctx.flags["fail-on"]) ?? "none") as FailOn;
    if (!["none", "unreviewed", "blind"].includes(failOn)) fail("--fail-on must be none, unreviewed or blind", 2);
    const strict = Boolean(ctx.flags.strict);

    const root = needRoot();
    const explicit = flagStr(ctx.flags.files);
    const base = flagStr(ctx.flags.base) ?? (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : undefined);
    const files = (explicit ? explicit.split(",").map((f) => f.trim()).filter(Boolean) : changedSince(root, base)).filter((f) => !f.startsWith(".zlearn/") && !f.startsWith(".claude/"));
    if (files.length === 0) return void emit(ctx, { files: [], totals: { files: 0 } }, () => console.log(`${c.green("✓")} No changed files to check.`));

    const result = await checkFiles(files, repoName(root));
    if ("error" in result) {
      // An outage or a missing key should not silently pass a strict gate, but it must not break a normal pipeline either.
      if (result.setup) fail(result.error, 2, "Set ZLEARN_TEAM_KEY (and ZLEARN_SERVER if you self-host), or run: zlearn team join");
      console.error(c.yellow(`zlearn check skipped: ${result.error}`));
      if (strict) process.exitCode = 3;
      return;
    }

    const bad = result.files.filter((f) => violates(f, failOn));
    const interesting = result.files.filter((f) => f.status !== "covered" && f.status !== "unknown");
    const t = result.totals;

    emit(ctx, { ...result, failOn, failed: bad.length > 0 }, () => {
      console.log(`${c.bold("zlearn check")} · ${result.team.name} · ${t.files} changed file${t.files === 1 ? "" : "s"}`);
      for (const f of interesting.sort((a, b) => Number(b.unreviewed) - Number(a.unreviewed) || b.risk - a.risk)) {
        const tag = f.unreviewed ? c.red("un-reviewed AI change") : f.status === "blind" ? c.red("no one understands this") : c.yellow("only one person understands this");
        console.log(`  ${f.status === "blind" || f.unreviewed ? c.red(ICON[f.status]) : c.yellow(ICON[f.status])} ${f.path}  ${c.dim("·")} ${tag}`);
      }
      console.log(`${c.dim(`${t.covered} covered · ${t.single} one owner · ${t.blind} blind · ${t.unreviewed} un-reviewed · ${t.unknown} not AI-changed`)}`);
      if (bad.length) console.log(c.red(`\n✗ ${bad.length} file${bad.length === 1 ? " breaks" : "s break"} the "${failOn}" policy. Run zlearn learn and pass the lessons, then push again.`));
      else console.log(c.green(`\n✓ ${failOn === "none" ? "Report only" : `Passes the "${failOn}" policy`}.`));
    });

    // GitHub Actions: inline annotations and a job summary.
    if (process.env.GITHUB_ACTIONS === "true" && !ctx.json) {
      for (const f of interesting) {
        const level = violates(f, failOn) ? "error" : "warning";
        const msg = f.unreviewed ? "AI-written change has not been reviewed by anyone on the team" : f.status === "blind" ? "No one on the team has passed a lesson on this file" : "Only one person understands this file";
        console.log(`::${level} file=${f.path}::${msg}`);
      }
    }
    const summaryFile = process.env.GITHUB_STEP_SUMMARY;
    if (summaryFile) {
      const rows = interesting.map((f) => `| \`${f.path}\` | ${f.unreviewed ? "un-reviewed AI change" : f.status === "blind" ? "no owner" : "one owner"} | ${f.risk} |`).join("\n");
      const md = `### zlearn check\n\n**${t.files}** changed file(s): ${t.covered} covered, ${t.single} one owner, ${t.blind} blind spots, ${t.unreviewed} un-reviewed.\n\n${interesting.length ? `| File | Status | Risk |\n|---|---|---|\n${rows}\n` : "Nothing needs attention.\n"}\n${bad.length ? `**Failed** the \`${failOn}\` policy.\n` : ""}`;
      try {
        fs.appendFileSync(summaryFile, md);
      } catch {
        // the summary is a nicety
      }
    }

    if (bad.length) process.exitCode = 1;
  },
};
