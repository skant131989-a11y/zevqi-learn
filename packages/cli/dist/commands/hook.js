import { commitGateHook, postToolHook, stopHook } from "../hooks.js";
/**
 * Entry point for the Claude Code hooks (`zlearn hook post-tool | stop | commit-gate`).
 * Hooks must never break the agent: every error is swallowed and the process always exits 0.
 */
export const hook = {
    name: "hook",
    group: "hidden",
    summary: "Internal: called by Claude Code hooks",
    usage: "zlearn hook post-tool | stop | commit-gate",
    async run(ctx) {
        try {
            const which = ctx.args[0];
            if (which === "post-tool")
                await postToolHook();
            else if (which === "stop")
                await stopHook(ctx.cliPath);
            else if (which === "commit-gate")
                await commitGateHook();
        }
        catch {
            // intentionally silent
        }
    },
};
