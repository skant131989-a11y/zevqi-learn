import type { Lesson } from "./lessons.js";

// Local progress: streaks, XP and levels. Same rules as the team dashboard, so numbers match everywhere.
// XP rewards understanding, never volume alone: a passed lesson is worth 20, a perfect score +10, an honest attempt 5.

export const LEVELS = ["Rookie", "Reader", "Tracer", "Navigator", "Architect", "Sage"] as const;
const DAY = 86_400_000;

export type Stats = {
  xp: number;
  level: number;
  levelName: string;
  /** 0..1 progress toward the next level (1 at the top level). */
  levelProgress: number;
  /** XP still needed for the next level; 0 at the top level. */
  xpToNext: number;
  streak: number;
  bestStreak: number;
  passed: number;
  failed: number;
  pending: number;
  filesUnderstood: number;
  weekPassed: number;
};

export function lessonXp(l: Pick<Lesson, "status" | "correct" | "total">): number {
  if (l.status === "passed") return 20 + (l.correct != null && l.total != null && l.correct === l.total ? 10 : 0);
  return l.status === "failed" ? 5 : 0;
}

export function levelFor(xp: number): { level: number; progress: number; toNext: number } {
  const level = Math.min(LEVELS.length, Math.floor(Math.sqrt(xp / 60)) + 1);
  if (level >= LEVELS.length) return { level, progress: 1, toNext: 0 };
  const floor = 60 * (level - 1) ** 2;
  const ceil = 60 * level ** 2;
  return { level, progress: Math.max(0, Math.min(1, (xp - floor) / (ceil - floor))), toNext: Math.max(0, ceil - xp) };
}

const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Consecutive UTC days with a passed lesson, ending today or yesterday (a streak survives until the end of the next day). */
export function streaks(days: Set<string>, now: number): { current: number; best: number } {
  let best = 0;
  let run = 0;
  let prev: number | null = null;
  for (const d of [...days].sort()) {
    const t = Date.parse(d);
    run = prev !== null && t - prev === DAY ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  let current = 0;
  let cursor = Date.parse(dayKey(now));
  if (!days.has(dayKey(cursor))) cursor -= DAY;
  while (days.has(dayKey(cursor))) {
    current++;
    cursor -= DAY;
  }
  return { current, best };
}

export function computeStats(lessons: Lesson[], now = Date.now()): Stats {
  const days = new Set<string>();
  const files = new Set<string>();
  let xp = 0;
  let passed = 0;
  let failed = 0;
  let pending = 0;
  let weekPassed = 0;
  for (const l of lessons) {
    xp += lessonXp(l);
    if (l.status === "passed") {
      passed++;
      const t = Date.parse(l.completedAt ?? l.createdAt);
      days.add(dayKey(t));
      l.changedFiles.forEach((f) => files.add(f));
      if (now - t < 7 * DAY) weekPassed++;
    } else if (l.status === "failed") failed++;
    else pending++;
  }
  const lv = levelFor(xp);
  const st = streaks(days, now);
  return {
    xp,
    level: lv.level,
    levelName: LEVELS[lv.level - 1]!,
    levelProgress: lv.progress,
    xpToNext: lv.toNext,
    streak: st.current,
    bestStreak: st.best,
    passed,
    failed,
    pending,
    filesUnderstood: files.size,
    weekPassed,
  };
}

/** A fixed-width progress bar such as `███████░░░░░`. */
export function bar(fraction: number, width = 20): string {
  const filled = Math.max(0, Math.min(width, Math.round(fraction * width)));
  return "█".repeat(filled) + "░".repeat(width - filled);
}
