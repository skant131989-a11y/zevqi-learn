import type { CheckFile, CheckResult } from "./team.js";

/** Hidden marker at the top of the pull request comment, so the GitHub Action can update one comment instead of adding a new one each push. */
export const COMMENT_MARKER = "<!-- zevqi-check -->";

const MAX_ROWS = 25;

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
const evidence = (f: CheckFile) => (f.unreviewed ? "un-reviewed AI change" : f.status === "blind" ? "never reviewed" : f.status === "stale" ? "reviewed, changed since" : "one reviewer");
const ask = (f: CheckFile) => (f.suggested ?? []).map((s) => s.name).join(", ");

/** Does this file need attention in the report (it has gaps)? */
export const needsAttention = (f: CheckFile) => f.status !== "covered" && f.status !== "unknown";

/**
 * The text of the pull request comment (and the job summary). Plain Markdown, no HTML other than the hidden marker.
 * `failedPaths` are the files that break the chosen policy.
 */
export function checkMarkdown(result: CheckResult, failOn: string, failedPaths: string[], server?: string): string {
  const t = result.totals;
  const files = result.files.filter(needsAttention);
  const failed = new Set(failedPaths);
  const sorted = [...files].sort((a, b) => Number(failed.has(b.path)) - Number(failed.has(a.path)) || Number(b.unreviewed) - Number(a.unreviewed));

  const headline = failedPaths.length
    ? `✗ ${failedPaths.length} changed file${failedPaths.length === 1 ? " breaks" : "s break"} the \`${failOn}\` policy`
    : files.length
      ? `${files.length} changed file${files.length === 1 ? " has" : "s have"} gaps in review evidence`
      : "✓ Every changed file has current review evidence, or was not changed by AI";

  const lines: string[] = [COMMENT_MARKER, `## Zevqi check: ${headline}`, ""];
  lines.push(`${t.files} changed file${t.files === 1 ? "" : "s"}: ${t.covered} covered, ${t.single} with one reviewer, ${t.blind} never reviewed, ${t.stale ?? 0} out of date, ${t.unreviewed} with un-reviewed AI changes.`, "");

  if (sorted.length) {
    const shown = sorted.slice(0, MAX_ROWS);
    lines.push("| File | Evidence | Why | Ask |", "|---|---|---|---|");
    for (const f of shown) lines.push(`| \`${cell(f.path)}\` | ${evidence(f)}${failed.has(f.path) ? " (fails policy)" : ""} | ${cell(f.reasons?.[0] ?? "")} | ${cell(ask(f))} |`);
    if (sorted.length > shown.length) lines.push("", `…and ${sorted.length - shown.length} more.`);
    lines.push("");
  }

  lines.push(
    failedPaths.length
      ? `Run \`zevqi review <file>\` or \`zevqi learn\` and record that you understood the change, then push again.`
      : files.length
        ? "Report only: this check does not block the merge."
        : "",
  );
  const base = server ? server.replace(/\/$/, "") : "https://zevqi.com";
  lines.push("", `<sub>Zevqi shows which files your team has demonstrably understood. Review evidence expires when a file changes. [Team dashboard](${base}/account) · source code never leaves your machine.</sub>`);
  return lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n") + "\n";
}
