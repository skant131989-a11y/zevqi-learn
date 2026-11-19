import path from "node:path";
import { loadGlobal, globalDir } from "./config.js";
import { contributorCount } from "./git.js";
import { c, readJson, writeJson } from "./util.js";
import { envVar } from "./env.js";

// A gentle, honest nudge: when a repo clearly has a team but you are not on a team plan, mention what teams get.
// Rules: interactive terminals only, at most once a week, never in --json, easy to turn off, never blocks anything.

const WEEK = 7 * 86_400_000;
export const NUDGE_MIN_CONTRIBUTORS = 3;

export type NudgeInput = {
  contributors: number;
  onTeam: boolean;
  lastNudgeAt: number | null;
  now: number;
  interactive: boolean;
  disabled: boolean;
};

export function shouldNudge(i: NudgeInput): boolean {
  if (i.disabled || i.onTeam || !i.interactive) return false;
  if (i.contributors < NUDGE_MIN_CONTRIBUTORS) return false;
  return i.lastNudgeAt === null || i.now - i.lastNudgeAt >= WEEK;
}

const stateFile = () => path.join(globalDir(), "state.json");

export function maybeNudge(root: string, opts: { json?: boolean } = {}): void {
  try {
    if (opts.json) return;
    const state = readJson<{ lastNudgeAt?: number }>(stateFile(), {});
    const contributors = contributorCount(root, 90);
    const ok = shouldNudge({
      contributors,
      onTeam: Boolean(loadGlobal().team),
      lastNudgeAt: state.lastNudgeAt ?? null,
      now: Date.now(),
      interactive: Boolean(process.stdout.isTTY),
      disabled: Boolean(envVar("NO_NUDGE")) || Boolean(process.env.CI),
    });
    if (!ok) return;
    console.log(
      `\n${c.bold("Tip:")} ${contributors} people committed here in the last 90 days. On your own, Zevqi shows what ${c.bold("you")} understand.\n` +
        `Teams see shared coverage, blind spots and single points of knowledge: ${c.cyan("https://zevqi.com/trial")} ${c.dim("(30 days free, no card)")}\n` +
        c.dim("Hide this tip: export ZEVQI_NO_NUDGE=1")
    );
    writeJson(stateFile(), { ...state, lastNudgeAt: Date.now() });
  } catch {
    // a tip must never get in the way
  }
}
