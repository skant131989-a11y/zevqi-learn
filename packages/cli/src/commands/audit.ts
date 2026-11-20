import fs from "node:fs";
import path from "node:path";
import { repoName, scanLog, trackedFiles } from "../git.js";
import { AUDIT_NOTES, buildAudit, renderHtml, renderText } from "../audit.js";
import { buildScan, parseLog } from "../scan.js";
import { VERSION } from "../version.js";
import { c, fail } from "../util.js";
import { emit, flagStr, needRoot, type Command } from "../context.js";

/**
 * `zevqi audit`: how much of this codebase rests on too few people, from git history alone. It needs no setup, no team, no key and no
 * network. Nothing is uploaded: it is a read-out for you, and an optional one-page file you can hand to a colleague.
 */
export const audit: Command = {
  name: "audit",
  group: "Teams",
  summary: "One-page read-out of knowledge risk in this repository, from git history (nothing is sent)",
  usage: "zevqi audit [--months 12] [--html [file]] [--names] [--json]",
  examples: [
    "zevqi audit                      # read-out in the terminal",
    "zevqi audit --html               # also write zevqi-audit.html, one page you can share or print to PDF",
    "zevqi audit --html report.html   # choose the file name",
    "zevqi audit --names              # name the person the largest dependency rests on (default: \"one person\")",
  ],
  async run(ctx) {
    const root = needRoot();
    const months = Math.max(1, Math.min(60, Number(flagStr(ctx.flags.months)) || 12));
    const names = Boolean(ctx.flags.names);

    const commits = parseLog(scanLog(root, months));
    if (commits.length === 0) return void console.log(`No commits found in the last ${months} months.`);
    const payload = buildScan(repoName(root), commits, trackedFiles(root), { names });
    const result = buildAudit(payload, { months, names });

    let wrote: string | null = null;
    if (ctx.flags.html) {
      const target = path.resolve(process.cwd(), flagStr(ctx.flags.html) || "zevqi-audit.html");
      try {
        fs.writeFileSync(target, renderHtml(result, VERSION), "utf8");
        wrote = target;
      } catch (e) {
        fail(`Could not write ${target}: ${e instanceof Error ? e.message : String(e)}`, 1, "Choose another path with --html <file>.");
      }
    }

    emit(ctx, { ...result, rules: AUDIT_NOTES, wrote }, () => {
      console.log(renderText(result, c));
      if (wrote) console.log(`\n${c.green("✓")} Wrote ${wrote}. It is one self-contained page: open it in a browser, share it, or print it to PDF.`);
      else if (result.files > 0) console.log(c.dim("\nWant a one-page version to share? Run: zevqi audit --html"));
      if (result.files > 0) console.log(c.dim("To see who actually understands these files, and what changes when someone leaves: https://zevqi.com/trial?utm_source=cli&utm_medium=audit&utm_campaign=audit"));
    });
  },
};
