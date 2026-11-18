import { loadGlobal, loadProject } from "../config.js";
import { listLessons } from "../lessons.js";
import { checkTeamKey, createTeam, joinTeam, leaveTeam, pushRecords, teamSummary, toRecord } from "../team.js";
import { c, fail } from "../util.js";
import { emit, flagStr, needEnabled, type Command } from "../context.js";

const server = (flags: Record<string, string | true>) => flagStr(flags.server) ?? loadGlobal().team?.server ?? "https://zevqi.com";

export const team: Command = {
  name: "team",
  group: "Teams",
  summary: "Share scores with your team (create, join, status, sync, leave)",
  usage: [
    "zevqi team join   --server <url> --key <teamKey> --email <you> [--name <you>]",
    "zevqi team status [--json]",
    "zevqi team sync | leave",
    "zevqi team create --server <url> --name <team> [--secret <s>]   (self-hosted servers)",
  ].join("\n       "),
  examples: ["zevqi team join --server https://zevqi.com --key zlt_… --email you@company.com"],
  async run(ctx) {
    const sub = ctx.args[0];
    const url = server(ctx.flags);

    if (sub === "create") {
      const name = flagStr(ctx.flags.name);
      if (!name) fail("Usage: zevqi team create --server <url> --name <team> [--secret <s>]", 2);
      const res = await createTeam(url, name, flagStr(ctx.flags.secret)).catch((e: Error) => fail(e.message));
      console.log(c.green("Team created."));
      console.log(`  Team key (share with teammates, keep private): ${c.bold(res.teamKey)}`);
      console.log(`  Dashboard (admins only):                        ${c.cyan(res.dashboardUrl)}`);
      console.log(c.dim(`  Teammates join with: zevqi team join --server ${url} --key ${res.teamKey} --email <their email>`));
      return;
    }
    if (sub === "join") {
      const key = flagStr(ctx.flags.key);
      const email = flagStr(ctx.flags.email);
      if (!key || !email) fail("Usage: zevqi team join --server <url> --key <teamKey> --email <you> [--name <you>]", 2);
      const check = await checkTeamKey(url, key);
      if (!check.ok && check.reason === "invalid") fail(check.message, 1, "Nothing was saved.");
      joinTeam(url, key, email, flagStr(ctx.flags.name));
      if (check.ok) {
        console.log(`${c.green("✓")} Joined ${check.teamName ? c.bold(check.teamName) : "the team"}. Results sync to ${url}. By default only scores and file names are shared, never code.`);
        console.log(c.dim(`Next: zevqi scan (maps who holds the knowledge of each file) or zevqi setup (does it all in this repo).`));
      }
      else console.log(`${c.yellow("!")} Saved, but could not reach ${url} just now (${check.message}). Lessons will queue locally and sync later.`);
      return;
    }
    if (sub === "leave") {
      leaveTeam();
      console.log("Left the team on this machine.");
      return;
    }
    if (sub === "sync") {
      const root = needEnabled();
      const cfg = loadProject(root);
      const r = await pushRecords(listLessons(root).map((l) => toRecord(l, cfg.share)));
      if (r.error) fail(`Sync failed: ${r.error}`);
      console.log(`${c.green("✓")} Synced ${r.sent} lesson${r.sent === 1 ? "" : "s"}.`);
      return;
    }
    if (sub === "status") {
      const s = await teamSummary().catch((e: Error) => fail(e.message));
      emit(ctx, s, () => {
        console.log(c.bold(s.team?.name ?? "Team"));
        for (const m of s.members ?? []) console.log(`  ${String(m.email).padEnd(30)} ${m.passed} passed · ${m.pending} waiting · ${m.passRate}% pass rate`);
        if (s.blindSpots?.length) console.log(c.yellow("Blind spots (changed by AI, nobody has passed a lesson on them): ") + s.blindSpots.slice(0, 8).map((b: { path: string }) => b.path).join(", "));
      });
      return;
    }
    fail("Usage: zevqi team create|join|status|sync|leave", 2);
  },
};
