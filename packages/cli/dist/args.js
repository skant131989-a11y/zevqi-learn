/** Minimal, dependency-free argument parser: positionals plus `--flag` and `--flag value` (also `--flag=value`). */
export function parseArgs(argv) {
    const out = { _: [], flags: {} };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--") {
            out._.push(...argv.slice(i + 1));
            break;
        }
        if (a.startsWith("--")) {
            const eq = a.indexOf("=");
            if (eq > 2) {
                out.flags[a.slice(2, eq)] = a.slice(eq + 1);
                continue;
            }
            const key = a.slice(2);
            const next = argv[i + 1];
            if (next !== undefined && !next.startsWith("--")) {
                out.flags[key] = next;
                i++;
            }
            else
                out.flags[key] = true;
        }
        else
            out._.push(a);
    }
    return out;
}
export const str = (v) => (typeof v === "string" ? v : undefined);
