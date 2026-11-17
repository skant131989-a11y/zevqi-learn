import crypto from "node:crypto";
// `zlearn scan`: a summary of git history per file. It needs no model and no developer action. Only counts, dates and pseudonymous
// author ids leave the machine: never code, never commit messages, never email addresses.
/** A commit that says an AI tool helped write it. Only some tools add such a mark, so this undercounts. */
export const AI_MARK = /co-authored-by:[^\n]*\b(claude|anthropic|copilot|cursor|codex|openai|gemini|aider)\b|generated with \[?claude code|🤖 generated with/i;
const BOT = /\[bot\]|dependabot|renovate|github-actions|greenkeeper|snyk-bot/i;
const SKIP = /(^|\/)(node_modules|vendor|dist|build|\.next|coverage|\.git)\/|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Cargo\.lock|go\.sum|composer\.lock)$|\.(min\.js|min\.css|map|snap|lock|svg|png|jpe?g|gif|ico|pdf|woff2?|ttf|zip|gz)$/i;
export const LIMITS = { files: 5000, authorsPerFile: 8, people: 500 };
/** A stable, anonymous id for a person: a hash of their email. It is pseudonymous, not anonymous: anyone who already knows an email can recompute it. */
export const authorId = (email) => "a_" + crypto.createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 10);
/** Parses `git log --name-only --format=%x1e%H%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%b%x1f`. */
export function parseLog(raw) {
    const out = [];
    for (const rec of raw.split("\x1e")) {
        if (!rec.trim())
            continue;
        const parts = rec.split("\x1f");
        if (parts.length < 7)
            continue;
        const [hash, name, email, date, subject, body, rest] = parts;
        if (BOT.test(name) || BOT.test(email))
            continue;
        const files = rest.split("\n").map((l) => l.trim()).filter(Boolean);
        if (files.length === 0 || !/^\d{4}-\d{2}-\d{2}/.test(date))
            continue;
        out.push({ hash: hash.trim(), name: name.trim(), email: email.trim(), date: date.slice(0, 10), ai: AI_MARK.test(`${subject}\n${body}`), files });
    }
    return out;
}
/** Rolls commits up per file. `tracked` (the files that exist now) drops deleted and renamed-away paths. */
export function buildScan(repo, commits, tracked, opts) {
    const files = new Map();
    const people = new Map();
    let since = "";
    for (const c of commits) {
        const id = authorId(c.email);
        if (!since || c.date < since)
            since = c.date;
        const p = people.get(id) ?? { name: c.name, nameDate: c.date, commits: 0, ai: 0, last: c.date };
        p.commits++;
        if (c.ai)
            p.ai++;
        if (c.date > p.last)
            p.last = c.date;
        if (c.date >= p.nameDate) {
            p.name = c.name;
            p.nameDate = c.date;
        }
        people.set(id, p);
        for (const path of c.files) {
            if (SKIP.test(path) || (tracked && !tracked.has(path)))
                continue;
            const f = files.get(path) ?? { commits: 0, ai: 0, first: c.date, last: c.date, authors: new Map() };
            f.commits++;
            if (c.ai)
                f.ai++;
            if (c.date < f.first)
                f.first = c.date;
            if (c.date > f.last)
                f.last = c.date;
            const a = f.authors.get(id) ?? { commits: 0, last: c.date };
            a.commits++;
            if (c.date > a.last)
                a.last = c.date;
            f.authors.set(id, a);
            files.set(path, f);
        }
    }
    const list = [...files.entries()]
        .sort((a, b) => b[1].commits - a[1].commits || a[0].localeCompare(b[0]))
        .slice(0, LIMITS.files)
        .map(([path, f]) => ({
        path, commits: f.commits, ai: f.ai, first: f.first, last: f.last,
        authors: [...f.authors.entries()].sort((a, b) => b[1].commits - a[1].commits).slice(0, LIMITS.authorsPerFile).map(([id, a]) => ({ id, commits: a.commits, last: a.last })),
    }));
    const ppl = [...people.entries()]
        .sort((a, b) => b[1].commits - a[1].commits)
        .slice(0, LIMITS.people)
        .map(([id, p]) => ({ id, ...(opts.names ? { name: p.name } : {}), commits: p.commits, ai: p.ai, last: p.last }));
    return { repo, since, commits: commits.length, files: list, people: ppl };
}
/** A quick local read-out, using the same plain rules as the dashboard's first two. */
export function summarize(p) {
    const sole = p.files.filter((f) => f.authors.length === 1 && f.commits >= 3).length;
    const ai = p.people.reduce((a, x) => a + x.ai, 0);
    return { commits: p.commits, files: p.files.length, people: p.people.length, soleAuthorFiles: sole, aiCommits: ai, aiShare: p.commits ? Math.round((ai / p.commits) * 100) : 0 };
}
