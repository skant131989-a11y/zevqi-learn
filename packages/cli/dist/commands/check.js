import fs from "node:fs";
import { changedSince, repoName } from "../git.js";
import { checkFiles, resolveTeam } from "../team.js";
import { c, fail } from "../util.js";
import { emit, flagStr, needRoot } from "../context.js";
const ICON = { blind: "✗", stale: "✗", single: "!", covered: "✓", unknown: "·" };
const RANK = { high: 3, medium: 2, low: 1, none: 0 };
const rank = (f) => RANK[f.level ?? "none"] ?? 0;
const reason = (f) => f.reasons?.[0];
/** Does this file break the chosen policy? */
function violates(f, failOn) {
    if (failOn === "unreviewed")
        return f.unreviewed;
    if (failOn === "blind")
        return f.status === "blind" || f.status === "stale"; // no current evidence: never reviewed, or changed since
    return false;
}
export const check = {
    name: "check",
    group: "Teams",
    summary: "Pull-request gate: which changed files have AI changes nobody has understood",
    usage: "zevqi check [--base <ref>] [--files a.ts,b.ts] [--fail-on none|unreviewed|blind] [--strict] [--json]",
    examples: [
        "zevqi check --base origin/main",
        "zevqi check --base origin/main --fail-on unreviewed     # exit 1 if a changed file has un-reviewed AI changes",
        "ZEVQI_TEAM_KEY=zlt_… zevqi check --fail-on blind       # in CI, no `team join` needed",
    ],
    async run(ctx) {
        const failOn = (flagStr(ctx.flags["fail-on"]) ?? "none");
        if (!["none", "unreviewed", "blind"].includes(failOn))
            fail("--fail-on must be none, unreviewed or blind", 2);
        const strict = Boolean(ctx.flags.strict);
        const root = needRoot();
        const explicit = flagStr(ctx.flags.files);
        const base = flagStr(ctx.flags.base) ?? (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : undefined);
        const files = (explicit ? explicit.split(",").map((f) => f.trim()).filter(Boolean) : changedSince(root, base)).filter((f) => !f.startsWith(".zlearn/") && !f.startsWith(".claude/"));
        if (files.length === 0)
            return void emit(ctx, { files: [], totals: { files: 0 } }, () => console.log(`${c.green("✓")} No changed files to check.`));
        const result = await checkFiles(files, repoName(root));
        if ("error" in result) {
            // An outage or a missing key should not silently pass a strict gate, but it must not break a normal pipeline either.
            if (result.setup)
                fail(result.error, 2, "Set ZEVQI_TEAM_KEY (and ZEVQI_SERVER if you self-host), or run: zevqi team join");
            console.error(c.yellow(`zevqi check skipped: ${result.error}`));
            if (strict)
                process.exitCode = 3;
            return;
        }
        const bad = result.files.filter((f) => violates(f, failOn));
        const interesting = result.files.filter((f) => f.status !== "covered" && f.status !== "unknown");
        const t = result.totals;
        emit(ctx, { ...result, failOn, failed: bad.length > 0 }, () => {
            console.log(`${c.bold("zevqi check")} · ${result.team.name} · ${t.files} changed file${t.files === 1 ? "" : "s"}`);
            for (const f of interesting.sort((a, b) => Number(b.unreviewed) - Number(a.unreviewed) || rank(b) - rank(a))) {
                const tag = f.unreviewed ? c.red("un-reviewed AI change") : f.status === "blind" ? c.red("never reviewed") : f.status === "stale" ? c.red("reviewed, but changed since") : c.yellow("only one person has reviewed this");
                console.log(`  ${f.status === "blind" || f.unreviewed ? c.red(ICON[f.status]) : c.yellow(ICON[f.status])} ${f.path}  ${c.dim("·")} ${tag}`);
                if (reason(f))
                    console.log(`      ${c.dim(reason(f))}`);
            }
            console.log(`${c.dim(`${t.covered} covered · ${t.single} one reviewer · ${t.blind} never reviewed · ${t.stale ?? 0} out of date · ${t.unreviewed} un-reviewed · ${t.unknown} not AI-changed`)}`);
            if (bad.length)
                console.log(c.red(`\n✗ ${bad.length} file${bad.length === 1 ? " breaks" : "s break"} the "${failOn}" policy. Run zevqi learn and pass the lessons, then push again.`));
            else
                console.log(c.green(`\n✓ ${failOn === "none" ? "Report only" : `Passes the "${failOn}" policy`}.`));
            const server = resolveTeam()?.server;
            if (interesting.length && server)
                console.log(c.dim(`Details and who can review these: ${server.replace(/\/$/, "")}/account`));
        });
        // GitHub Actions: inline annotations and a job summary.
        if (process.env.GITHUB_ACTIONS === "true" && !ctx.json) {
            for (const f of interesting) {
                const level = violates(f, failOn) ? "error" : "warning";
                const msg = reason(f) ?? (f.unreviewed ? "AI-written change has not been reviewed by anyone on the team" : f.status === "blind" ? "No one on the team has passed a lesson on this file" : "Only one person has reviewed this file");
                console.log(`::${level} file=${f.path}::${msg}`);
            }
        }
        const summaryFile = process.env.GITHUB_STEP_SUMMARY;
        if (summaryFile) {
            const rows = interesting.map((f) => `| \`${f.path}\` | ${f.unreviewed ? "un-reviewed AI change" : f.status === "blind" ? "never reviewed" : f.status === "stale" ? "out of date" : "one reviewer"} | ${f.level ?? ""} | ${reason(f) ?? ""} |`).join("\n");
            const md = `### zevqi check\n\n**${t.files}** changed file(s): ${t.covered} covered, ${t.single} one reviewer, ${t.blind} never reviewed, ${t.stale ?? 0} out of date, ${t.unreviewed} un-reviewed.\n\n${interesting.length ? `| File | Evidence | Level | Why |\n|---|---|---|---|\n${rows}\n` : "Nothing needs attention.\n"}\n${bad.length ? `**Failed** the \`${failOn}\` policy.\n` : ""}`;
            try {
                fs.appendFileSync(summaryFile, md);
            }
            catch {
                // the summary is a nicety
            }
        }
        if (bad.length)
            process.exitCode = 1;
    },
};
