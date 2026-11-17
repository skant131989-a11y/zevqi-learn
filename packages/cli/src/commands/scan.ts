import { repoName, scanLog, trackedFiles } from "../git.js";
import { buildScan, parseLog, summarize } from "../scan.js";
import { pushScan, resolveTeam } from "../team.js";
import { c, fail } from "../util.js";
import { emit, flagStr, needRoot, type Command } from "../context.js";

/**
 * `zlearn scan`: a map of who has changed which files, from git history. It needs no model, no API key and no setup by your
 * teammates. Only counts, dates and pseudonymous author ids leave your machine: no code, no commit messages, no emails.
 */
export const scan: Command = {
  name: "scan",
  group: "Teams",
  summary: "Map who holds the knowledge of each file, from git history (no key needed)",
  usage: "zlearn scan [--months 12] [--names] [--dry-run] [--json]",
  examples: [
    "zlearn scan --dry-run          # see exactly what would be sent, and send nothing",
    "zlearn scan                    # upload to your team dashboard",
    "zlearn scan --names            # also share author names (never emails)",
  ],
  async run(ctx) {
    const root = needRoot();
    const months = Math.max(1, Math.min(60, Number(flagStr(ctx.flags.months)) || 12));
    const names = Boolean(ctx.flags.names);
    const dry = Boolean(ctx.flags["dry-run"]);

    const commits = parseLog(scanLog(root, months));
    if (commits.length === 0) return void console.log(`No commits found in the last ${months} months.`);
    const payload = buildScan(repoName(root), commits, trackedFiles(root), { names });
    if (payload.files.length === 0) return void console.log("No source files in that history.");
    const s = summarize(payload);

    if (dry) {
      return void emit(ctx, { dryRun: true, summary: s, sample: { ...payload, files: payload.files.slice(0, 3), people: payload.people.slice(0, 3) } }, () => {
        console.log(`${c.bold("Dry run")}: nothing is sent. This is what a scan of ${c.bold(payload.repo)} would upload.\n`);
        console.log(JSON.stringify({ ...payload, files: payload.files.slice(0, 3), people: payload.people.slice(0, 3) }, null, 2));
        console.log(c.dim(`\n…and ${Math.max(0, payload.files.length - 3)} more files and ${Math.max(0, payload.people.length - 3)} more people in the same format (${Math.round(JSON.stringify(payload).length / 1024)} KB in total).`));
        console.log(c.dim(`Never included: source code, commit messages, email addresses${names ? "" : ", author names"}.`));
      });
    }

    const team = resolveTeam();
    if (!team) {
      emit(ctx, { uploaded: false, summary: s }, () => {
        printSummary(s);
        console.log(c.yellow("\nNot uploaded: you are not on a team yet.") + c.dim(" Run: zlearn team join --server <url> --key <key> --email <you>"));
      });
      return;
    }
    let res: { saved: number; people: number };
    try {
      res = await pushScan(payload);
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e), 1, "Your scan was not uploaded. Try again, or use --dry-run to inspect it.");
    }
    emit(ctx, { uploaded: true, ...res, summary: s }, () => {
      printSummary(s);
      console.log(`\n${c.green("✓")} Uploaded ${res.saved} files and ${res.people} people to your team dashboard (Knowledge map).`);
      console.log(c.dim(`Shared: paths, commit counts, dates and pseudonymous author ids${names ? ", and author names" : ""}. Not shared: code, commit messages, emails.`));
      console.log(`See your knowledge map: ${c.cyan(`${team.server.replace(/\/$/, "")}/account`)}`);
    });
  },
};

function printSummary(s: ReturnType<typeof summarize>) {
  console.log(`${c.bold(`${s.commits} commits`)} · ${s.files} files · ${s.people} people`);
  console.log(`${s.soleAuthorFiles} file${s.soleAuthorFiles === 1 ? "" : "s"} with a single author across 3+ commits · ${s.aiCommits} commit${s.aiCommits === 1 ? "" : "s"} marked AI-assisted (${s.aiShare}%)`);
  console.log(c.dim("AI-assisted is only counted when the commit says so, so the real share is probably higher."));
}
