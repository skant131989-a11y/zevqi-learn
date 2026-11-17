# zlearn

**Understand the code your AI agent writes, as fast as it writes it.**

[![CI](https://github.com/zevqi/zlearn/actions/workflows/ci.yml/badge.svg)](https://github.com/zevqi/zlearn/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-orange.svg)](LICENSE)
![Node 20+](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)

AI coding agents like Claude Code can change a dozen files in a minute. Reviewing all of it line by line is slow, and skipping it builds *comprehension debt*: code your team runs but nobody can explain. `zlearn` is the human-in-the-loop layer for agentic coding. It turns every agent turn into a short lesson and a three-question check, so you know what changed before you commit, and your team can see which parts of the codebase anyone has demonstrably understood.

```
agent edits files ──► zlearn explains the change ──► you answer 3 questions ──► your team sees who understands what
```

```text
$ zlearn learn

What your agent changed
Charging an invoice now retries up to five times when the gateway times out, using the same idempotency key…

1. Why does the retry loop now cap at 5 attempts?
   A) To avoid double-charging when the gateway times out
   B) To reduce log volume
   C) Because the SDK requires it
   Your answer (A-D): a
   Correct. Idempotency keys make the retry safe.

Passed 3/3.
+30 XP  ·  4-day streak  ·  Level 2 Reader
███████████░░░░░░░░░  54 XP to next level
```

## Install

Requires Node 20+ and git. In your project folder, with your team key (from your team admin or your Zevqi dashboard), one paste does everything: installs zlearn, joins your team, turns it on in this repository and uploads your first knowledge map. It works in macOS, Linux and Windows PowerShell.

```bash
npm install -g zlearn-cli; zlearn setup --key <your-team-key>
```

No team? Install it, then `zlearn init` and `zlearn scan --dry-run` to see what a scan finds. Nothing is sent anywhere. No API key is needed for any of this.

Prefer to read and build it yourself? The npm package is [`zlearn-cli`](https://www.npmjs.com/package/zlearn-cli), and you can also install straight from GitHub with `npm install -g github:zevqi/zlearn`, or build from source:

```bash
git clone https://github.com/zevqi/zlearn
cd zlearn/packages/cli && npm install && npm run build
npm link                       # makes the `zlearn` command available
```

## Quick start

```bash
cd your-project
zlearn setup --key <your-team-key>   # join your team, turn zlearn on, scan this repository
zlearn scan --dry-run                # see exactly what a scan would share, and send nothing
zlearn review src/payments/refund.ts # read a change and describe it in your own words
zlearn doctor                        # checks everything is wired up
```

**No model key is needed.** The git scan, attested reviews, the pull-request gate and agent-written lessons all work without one. Add your own key only if you want zlearn to write diff-specific questions:

Restart Claude Code (or open `/hooks`), then code as usual. When your agent finishes a turn, a lesson is built in the background. Take it whenever you like:

```bash
zlearn status                  # what is waiting
zlearn learn                   # terminal quiz
zlearn stats                   # streak, XP and level
zlearn ui                      # local dashboard on 127.0.0.1
```

The key is optional and yours: `ZLEARN_API_KEY` is preferred, then `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`, then the key saved by `zlearn config set apiKey`. It is billed by your provider, never by us.

## How it works

`zlearn init` adds three [Claude Code hooks](https://code.claude.com/docs/en/hooks) to your project:

| Hook | What it does |
|---|---|
| **PostToolUse** (Edit/Write) | Quietly remembers which files the agent touched. |
| **Stop** | When the agent finishes a turn, starts a detached background job that explains the change. It never slows the agent down. |
| **PreToolUse** on `git commit` | Warns (or blocks, if you choose) while AI changes are un-reviewed. |

Every hook always exits successfully, so zlearn can never break your session.

## Commands

| Command | What it does |
|---|---|
| `zlearn init [--shared\|--global] [--gate off\|warn\|block]` | Turn it on in this repo and install the hooks. |
| `zlearn setup --key <teamKey> [--email <you>]` | One command: join your team, turn zlearn on here, and upload the first knowledge map. |
| `zlearn scan [--months 12] [--names] [--dry-run]` | Map who holds the knowledge of each file from git history. No model, no key. Shares counts, dates and pseudonymous author ids, never code, messages or emails. |
| `zlearn lesson add` | Save a lesson your coding agent wrote (JSON on stdin), so no key is needed. |
| `zlearn learn [id]` | Take the quiz for the oldest un-reviewed change, then say whether you understand it. |
| `zlearn review <file...> [--commits 5]` | Review the recent committed changes to files (a teammate's, or your own from earlier) and add your own evidence. |
| `zlearn explain` | Explain your current uncommitted changes now. |
| `zlearn status [--json]` | What is waiting, and which files nobody has reviewed. |
| `zlearn stats [--json]` | Your streak, XP and level for this project. |
| `zlearn ui [--port 4317]` | Local dashboard (lessons, quiz, knowledge map). |
| `zlearn gate off\|warn\|block` | What happens when you commit with un-reviewed AI changes. |
| `zlearn config show` / `set apiKey\|provider\|model\|baseUrl [value]` | Settings. `set apiKey` prompts with hidden input. |
| `zlearn doctor [--json]` | Checks that everything is wired up. |
| `zlearn team join\|status\|sync\|leave` | Share scores with your team. |
| `zlearn check [--base <ref>] [--fail-on unreviewed\|blind]` | Pull-request gate: which changed files have AI changes nobody understands. |
| `zlearn uninstall` | Removes the hooks (your lessons stay in `.zlearn/`). |

Run `zlearn help <command>` for details. `--json` works on `status`, `stats`, `doctor` and `team status`. The CLI respects `NO_COLOR`.

## Progress that rewards understanding

Each quiz earns XP (**+20** for a pass, **+10** for a perfect score, **+5** for an honest attempt). Consecutive days with a passed lesson build a streak, and XP levels you up from Rookie through Reader, Tracer, Navigator and Architect to Sage. It is there to make understanding a habit. There are no guilt notifications and nothing is shared unless you join a team.

## Teams

A hosted team dashboard shows who understands which parts of the codebase, which AI-changed files nobody has reviewed (blind spots), which are understood by only one person, coverage over time, streaks and more.

- **Try it free for 7 days**, no card: <https://zevqi.com/trial>
- **Explore a live demo**: <https://zevqi.com/demo/dashboard>
- **Pricing**: <https://zevqi.com/pricing>

```bash
zlearn team join --server https://zevqi.com --key zlt_... --email you@company.com
```

Lessons then sync automatically after each quiz. The team server is a hosted service and is not part of this open-source repository.

### Gate pull requests in CI

`zlearn check` asks your team server which files a pull request changes that still have AI-written changes nobody on the team has understood. It sends only file paths and the repository name, uses a team key from `ZLEARN_TEAM_KEY` (no `team join` needed in CI), and prints inline GitHub annotations and a job summary.

```yaml
# .github/workflows/zlearn.yml
name: zlearn check
on: pull_request
jobs:
  understand:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: git clone --depth 1 https://github.com/zevqi/zlearn /tmp/zlearn && cd /tmp/zlearn && npm ci && npm run build:cli
      - run: node /tmp/zlearn/packages/cli/dist/cli.js check --base origin/${{ github.base_ref }} --fail-on unreviewed
        env:
          ZLEARN_TEAM_KEY: ${{ secrets.ZLEARN_TEAM_KEY }}
```

Policies: `--fail-on none` (default, report only), `unreviewed` (fail if a changed file has an AI change nobody has reviewed), `blind` (fail if nobody has ever understood a changed file). A server outage never breaks your pipeline unless you pass `--strict`. Exit codes: 0 ok, 1 policy failed, 2 usage error, 3 outage with `--strict`.

## Privacy

- **With no API key, no code is sent anywhere.** If you add one, the diff of the changed files goes only to the AI provider you configure, under your own account, and `zlearn init` says so first. Code is never sent to a zlearn server.
- **`zlearn scan` sends** file paths, commit counts, first and last change dates, how many commits carry an AI co-author mark, and authors as pseudonymous ids (a hash of the email, not the email). Author names only with `--names`. Never code, commit messages or emails. `zlearn scan --dry-run` shows the exact payload and sends nothing.
- **The team server only receives** file paths, a content fingerprint of each file (a git blob hash, so it can tell when a file changed), lesson ids, scores, your own answer (understood or needs clarification), timestamps and your name and email. Summaries and the note about what is unclear are shared only if you set `share` to `summaries` in `.zlearn/config.json`.
- **`zlearn init` tells you exactly what goes to your model provider** before it installs anything: the diff of the files your agent changed (new files in full, about 60 KB per lesson). Do not use zlearn on code your provider agreement does not allow you to send.
- **No telemetry.** The CLI makes no analytics calls.
- Local data lives in `.zlearn/` (git-ignored automatically). Your API key is read from the environment, or stored with owner-only permissions in `~/.zlearn/config.json`.
- The local dashboard listens on `127.0.0.1` only and requires a random per-run token.

See [SECURITY.md](SECURITY.md) for how to report a vulnerability.

## Honest limitations

- **Scores and answers are self-reported.** Quizzes run on the developer's own machine, so a determined person can fake a pass. It is evidence that someone engaged with a change, not proof of competence, and not an audit. Do not use it for performance reviews.
- **An AI explains AI.** Explanations and questions can be wrong or shallow. Treat them as a prompt to read the code, not a replacement for it.
- **Claude Code first.** Codex and Cursor use different hook systems and are not supported yet. Outside Claude Code you can still run `zlearn explain` after any change.
- Large diffs are truncated before being sent to the model (about 60 KB total).
- The hook configuration matches Claude Code's documented settings schema (matcher groups, `command` + `args`, the `if` filter, `systemMessage` and `permissionDecision` output), checked against the official docs on 17 November 2026. It has not been exercised live on every Claude Code version. If a hook does not fire, run `zlearn doctor` and open `/hooks` in Claude Code.

## Development

```bash
npm install
npm test            # unit + CLI contract + end-to-end (mock AI, real git, real hook flow)
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [CHANGELOG](CHANGELOG.md).

## License

MIT. See [LICENSE](LICENSE).
