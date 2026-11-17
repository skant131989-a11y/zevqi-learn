# Contributing to zlearn

Thanks for helping. This is a small, focused codebase, so changes are quick to review.

## Setup

Requires Node 20+ and git.

```bash
git clone https://github.com/zevqi/zlearn
cd zlearn
npm install
npm test
```

`npm test` builds the CLI and runs three suites:

| Suite | What it checks |
|---|---|
| `test/unit.test.mjs` | Argument parsing, XP and streak maths, scoring, helpers |
| `test/cli.test.mjs` | The command-line contract: help, errors, exit codes, `--json`, secrets never printed |
| `test/e2e.test.mjs` | Real git repo, real hook flow, a mock AI server: hooks to lesson to quiz to gate |

## Project layout

```
packages/cli/src
  cli.ts            entry point: parse, dispatch, print errors
  commands/         one file per command group (setup, daily, team, hook)
  context.ts        shared types and helpers for commands
  stats.ts          streaks, XP and levels (same rules as the team dashboard)
  hooks.ts          the three Claude Code hooks and background explain job
  lessons.ts        lesson storage, scoring, knowledge map
  ai.ts             model calls (Anthropic or any OpenAI-compatible endpoint)
  team.ts           optional team sync with an outbox queue
  server.ts         local dashboard on 127.0.0.1
```

## Guidelines

- **Never slow or break the agent.** Hooks must exit 0 and push slow work to a background process.
- **Never print secrets.** Use `mask()` for anything that could be a key.
- **No new runtime dependencies** without a strong reason. The CLI has none today.
- **Honest copy.** If something is not built, say so. Do not claim guarantees the code does not give.
- **Add a test** for behaviour you change. Prefer the unit or CLI-contract suite over e2e when you can.
- Keep output friendly to `NO_COLOR` and to `--json` where a command already supports it.

## Pull requests

1. Open an issue first for anything larger than a small fix.
2. Keep the change focused, with a short description of what and why.
3. Make sure `npm run typecheck -w zevqi-learn` and `npm test` pass.
4. Update `CHANGELOG.md` under "Unreleased".

By contributing you agree your work is licensed under the MIT licence.
