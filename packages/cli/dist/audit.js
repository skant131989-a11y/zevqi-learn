// `zevqi audit`: a one-page read-out of how much of a codebase rests on too few people, from git history alone. It runs entirely on
// your machine and sends nothing. It uses the same plain rules as the team dashboard's knowledge map, and it states what it cannot know.
//
// THE RULES (also printed in the report):
//  - one author: exactly one person has ever changed the file, over 3 or more commits.
//  - owner inactive: one person made 60% or more of the commits and has made no commit anywhere in the repository for 90 days.
//  - dormant: 3 or more commits, but none for 180 days.
//  - sensitive: the path looks like authentication, billing, infrastructure, data or deployment code (a guess from the name).
//  - high: (sensitive AND any flag) OR (one author AND owner inactive). There is no score.
// It cannot tell whether anyone understands a file (that needs review evidence), who really wrote a commit when people share an
// identity, or which commits an AI wrote unless the commit says so (only some tools add a mark), so AI figures are a minimum.
const DAY = 86_400_000;
export const INACTIVE_DAYS = 90;
export const DORMANT_DAYS = 180;
const SENSITIVE = /(auth|login|session|token|secret|crypto|billing|payment|invoice|refund|ledger|checkout|security|permission|\biam\b|terraform|infra|migration|schema|database|deploy|workflows|dockerfile)/i;
const NOT_SENSITIVE_DIR = /(^|\/)(components|styles|stories|__tests__|tests?|docs?)\//i;
const NOT_SENSITIVE_FILE = /\.(md|css|scss|svg|png)$|\.(test|spec)\.[tj]sx?$/i;
export const isSensitive = (path) => SENSITIVE.test(path) && !NOT_SENSITIVE_DIR.test(path) && !NOT_SENSITIVE_FILE.test(path);
const dirOf = (p) => {
    const i = p.lastIndexOf("/");
    return i < 0 ? "(root)" : p.slice(0, i);
};
export function buildAudit(p, opts) {
    const now = opts.now ?? Date.now();
    const lastOf = new Map(p.people.map((x) => [x.id, x.last]));
    const nameOf = new Map(p.people.map((x) => [x.id, x.name]));
    const inactive = (id) => {
        const last = lastOf.get(id);
        return !last || now - Date.parse(last) > INACTIVE_DAYS * DAY;
    };
    const soleBy = new Map();
    const byDir = new Map();
    const top = [];
    let oneAuthor = 0;
    let oneAuthorSensitive = 0;
    let ownerInactive = 0;
    let dormant = 0;
    let high = 0;
    let aiFiles = 0;
    for (const f of p.files) {
        const total = f.authors.reduce((a, x) => a + x.commits, 0) || f.commits;
        const lead = [...f.authors].sort((a, b) => b.commits - a.commits)[0];
        const share = lead ? lead.commits / Math.max(1, total) : 0;
        const sensitive = isSensitive(f.path);
        const sole = f.authors.length === 1 && f.commits >= 3;
        const inactiveOwner = Boolean(lead && share >= 0.6 && inactive(lead.id) && f.commits >= 3);
        const age = now - Date.parse(f.last);
        const isDormant = f.commits >= 3 && age > DORMANT_DAYS * DAY;
        const why = [];
        if (sole)
            why.push(`only one person has ever changed it (${f.commits} commits)`);
        if (inactiveOwner)
            why.push(`its main author has not committed for ${INACTIVE_DAYS}+ days`);
        if (isDormant)
            why.push(`untouched for ${Math.floor(age / DAY)} days`);
        const level = why.length === 0 ? null : (sensitive && why.length > 0) || (sole && inactiveOwner) ? "high" : "medium";
        if (sole) {
            oneAuthor++;
            if (sensitive)
                oneAuthorSensitive++;
            if (lead)
                soleBy.set(lead.id, (soleBy.get(lead.id) ?? 0) + 1);
        }
        if (inactiveOwner)
            ownerInactive++;
        if (isDormant)
            dormant++;
        if (level === "high")
            high++;
        if (f.ai > 0)
            aiFiles++;
        const d = byDir.get(dirOf(f.path)) ?? { files: 0, oneAuthor: 0, high: 0 };
        d.files++;
        if (sole)
            d.oneAuthor++;
        if (level === "high")
            d.high++;
        byDir.set(dirOf(f.path), d);
        if (level)
            top.push({ path: f.path, level, why, sensitive });
    }
    let big = null;
    for (const [id, n] of soleBy)
        if (!big || n > big.n)
            big = { id, n };
    const aiCommits = p.people.reduce((a, x) => a + x.ai, 0);
    const rank = { high: 1, medium: 0 };
    return {
        repo: p.repo,
        generatedAt: new Date(now).toISOString(),
        months: opts.months,
        since: p.since,
        commits: p.commits,
        people: p.people.length,
        files: p.files.length,
        ai: { commits: aiCommits, share: p.commits ? Math.round((aiCommits / p.commits) * 100) : 0, files: aiFiles },
        oneAuthor,
        oneAuthorSensitive,
        ownerInactive,
        dormant,
        high,
        largestDependency: big
            ? { files: big.n, share: p.files.length ? Math.round((big.n / p.files.length) * 1000) / 10 : 0, inactive: inactive(big.id), ...(opts.names && nameOf.get(big.id) ? { name: nameOf.get(big.id) } : {}) }
            : { files: 0, share: 0, inactive: false },
        areas: [...byDir.entries()]
            .map(([dir, v]) => ({ dir, ...v }))
            .filter((a) => a.oneAuthor > 0)
            .sort((a, b) => b.high - a.high || b.oneAuthor - a.oneAuthor || a.dir.localeCompare(b.dir))
            .slice(0, 8),
        top: top.sort((a, b) => rank[b.level] - rank[a.level] || Number(b.sensitive) - Number(a.sensitive) || a.path.localeCompare(b.path)).slice(0, 12),
    };
}
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
/** Where the rules and limits are stated, in plain words, so the report can be read without this source. */
export const AUDIT_NOTES = [
    "One author means exactly one person has ever changed the file, over 3 or more commits.",
    `Owner inactive means one person made 60% or more of its commits and has made no commit in the repository for ${INACTIVE_DAYS}+ days.`,
    `Dormant means 3 or more commits, but none for ${DORMANT_DAYS} days.`,
    "Sensitive is a guess from the file path: authentication, billing, infrastructure, data and deployment code.",
    "AI-assisted is counted only when a commit says so (a co-author line or a generated-with note). Many tools leave no mark, so the real share is higher.",
    "Git shows who changed a file, not who understands it. Whether the people who are left can explain it needs review evidence, which this report does not have.",
];
export function renderText(a, c) {
    const L = [];
    L.push(`${c.bold("Zevqi audit")}  ${a.repo}  ${c.dim(`last ${a.months} months · ${a.commits} commits · ${a.people} ${a.people === 1 ? "person" : "people"}`)}`);
    L.push(c.dim("Runs on this machine. Reads git history only: no source code, no network, nothing sent."), "");
    if (a.files === 0) {
        L.push("No source files with history in that window.");
        return L.join("\n");
    }
    const row = (label, n, extra = "") => `  ${String(n).padStart(5)}  ${label}${extra ? c.dim("  " + extra) : ""}`;
    L.push(`${c.bold(String(a.files))} source files with history`);
    L.push(row("only ever changed by one person", a.oneAuthor, `${pct(a.oneAuthor, a.files)}% of files`));
    L.push(row("of those, in sensitive areas (auth, billing, infra, data)", a.oneAuthorSensitive));
    L.push(row("main author has gone quiet for 90+ days", a.ownerInactive));
    L.push(row("untouched for 180+ days", a.dormant));
    L.push(row("high level (see rules below)", a.high));
    L.push(`  ${String(a.ai.commits).padStart(5)}  commits marked AI-assisted ${c.dim(`${a.ai.share}% of commits, ${a.ai.files} files; a minimum`)}`);
    L.push("");
    if (a.largestDependency.files > 0) {
        const who = a.largestDependency.name ? a.largestDependency.name : "one person";
        L.push(`${c.bold("Largest single dependency:")} ${a.largestDependency.files} files (${a.largestDependency.share}% of the code) rest on ${who}${a.largestDependency.inactive ? c.red(", who has been quiet for 90+ days") : ""}.`, "");
    }
    if (a.areas.length) {
        L.push(c.bold("Where knowledge is thinnest"));
        for (const x of a.areas.slice(0, 6))
            L.push(`  ${x.dir.padEnd(34).slice(0, 34)} ${String(x.oneAuthor).padStart(3)} of ${String(x.files).padEnd(3)} rest on one person${x.high ? c.yellow(`  ${x.high} high`) : ""}`);
        L.push("");
    }
    if (a.top.length) {
        L.push(c.bold("Files to look at first"));
        for (const f of a.top.slice(0, 8))
            L.push(`  ${f.level === "high" ? c.red("high  ") : "medium"} ${f.path}${f.sensitive ? c.dim("  (sensitive)") : ""}`, c.dim(`         ${f.why.join("; ")}`));
        L.push("");
    }
    L.push(c.dim("What this cannot tell you: " + AUDIT_NOTES[AUDIT_NOTES.length - 1]));
    return L.join("\n");
}
const esc = (s) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
/** One self-contained page: no scripts, no external files, no requests. It prints cleanly to PDF. */
export function renderHtml(a, version) {
    const stat = (label, value, hint = "") => `<div class="stat"><div class="l">${esc(label)}</div><div class="v">${esc(value)}</div>${hint ? `<div class="h">${esc(hint)}</div>` : ""}</div>`;
    const who = a.largestDependency.name ? esc(a.largestDependency.name) : "one person";
    const lead = a.files === 0
        ? "No source files with history were found in that window."
        : `<strong>${a.oneAuthor}</strong> of ${a.files} source files (${pct(a.oneAuthor, a.files)}%) have only ever been changed by one person${a.oneAuthorSensitive ? `, and <strong>${a.oneAuthorSensitive}</strong> of those are in sensitive areas` : ""}. ${a.largestDependency.files ? `The biggest single dependency is ${a.largestDependency.files} files (${a.largestDependency.share}% of the code) resting on ${who}${a.largestDependency.inactive ? ", who has not committed for 90+ days" : ""}. ` : ""}${a.ownerInactive ? `${a.ownerInactive} files have a main author who has gone quiet. ` : ""}${a.ai.commits ? `At least ${a.ai.share}% of commits are marked as AI-assisted.` : ""}`;
    const areas = a.areas.map((x) => `<tr><td><code>${esc(x.dir)}</code></td><td class="n">${x.oneAuthor} of ${x.files}</td><td class="n">${x.high || ""}</td></tr>`).join("");
    const top = a.top.map((f) => `<tr><td><code>${esc(f.path)}</code>${f.sensitive ? ' <span class="tag">sensitive</span>' : ""}</td><td>${f.level}</td><td class="why">${esc(f.why.join("; "))}</td></tr>`).join("");
    const utm = "utm_source=cli&utm_medium=audit_report&utm_campaign=audit";
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Zevqi audit - ${esc(a.repo)}</title>
<style>
:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f1f5f9;font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a}
main{max-width:820px;margin:24px auto;background:#fff;border-radius:16px;padding:36px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
h1{font-size:26px;margin:8px 0 2px}h2{font-size:15px;margin:28px 0 8px}p{margin:8px 0}.sub{color:#475569;font-size:14px}.brand{font-weight:600;font-size:14px}
.lead{background:#f8fafc;border-radius:12px;padding:16px 18px;font-size:16px;margin-top:18px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-top:18px}.stat{border:1px solid #e2e8f0;border-radius:12px;padding:12px}
.l{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;font-weight:600}.v{font-size:28px;font-weight:700}.h{font-size:12px;color:#64748b}
table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;border-bottom:1px solid #e2e8f0;padding:6px 8px 6px 0}
td{border-bottom:1px solid #f1f5f9;padding:6px 8px 6px 0;vertical-align:top}.n{text-align:right;white-space:nowrap}.why{color:#475569;font-size:12px}code{font:12px ui-monospace,Menlo,Consolas,monospace}
.tag{font-size:10px;background:#fef3c7;color:#92400e;border-radius:6px;padding:1px 5px}.notes{font-size:12.5px;color:#475569;padding-left:18px}
.cta{margin-top:28px;border:1px solid #fed7aa;background:#fff7ed;border-radius:12px;padding:16px}.cta a{color:#c2410c;font-weight:600}
footer{margin-top:24px;font-size:11.5px;color:#64748b}
@media print{body{background:#fff}main{box-shadow:none;margin:0;max-width:none;padding:0}.cta{break-inside:avoid}tr{break-inside:avoid}@page{size:A4;margin:14mm}}
</style></head><body><main>
<div class="brand">Zevqi · AI code risk audit</div>
<h1>${esc(a.repo)}</h1>
<div class="sub">Generated ${esc(a.generatedAt.slice(0, 10))} from the last ${a.months} months of git history (${a.commits} commits, ${a.people} ${a.people === 1 ? "person" : "people"}). Produced on a developer's machine; nothing was uploaded.</div>
<p class="lead">${lead}</p>
<div class="grid">
${stat("Files with history", String(a.files))}
${stat("One author only", String(a.oneAuthor), `${pct(a.oneAuthor, a.files)}% of files`)}
${stat("In sensitive areas", String(a.oneAuthorSensitive), "auth, billing, infra, data")}
${stat("Main author quiet", String(a.ownerInactive), "no commit for 90+ days")}
${stat("High level", String(a.high), "rules below, no score")}
${stat("AI-assisted commits", `${a.ai.share}%`, "a minimum")}
</div>
${areas ? `<h2>Where knowledge is thinnest</h2><table><thead><tr><th>Area</th><th class="n">Rest on one person</th><th class="n">High</th></tr></thead><tbody>${areas}</tbody></table>` : ""}
${top ? `<h2>Files to look at first</h2><table><thead><tr><th>File</th><th>Level</th><th>Why</th></tr></thead><tbody>${top}</tbody></table>` : ""}
<h2>How to read this</h2>
<ul class="notes">${AUDIT_NOTES.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>
<div class="cta"><strong>What this report cannot show:</strong> whether the people who are left actually understand these files. The free CLI records that as review evidence on each AI change, and the team view shows which files are covered, which depend on one reviewer, and what would be left if someone went. <a href="https://zevqi.com/trial?${utm}">Start a free team trial</a>, no card.</div>
<footer>Zevqi ${esc(version)} · zevqi.com · A team signal, not an audit of any person and not a compliance certificate. Do not use it for individual performance reviews.</footer>
</main></body></html>
`;
}
