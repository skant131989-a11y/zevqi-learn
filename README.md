# zlearn

**Understand the code your AI agent writes, as fast as it writes it.**

[![CI](https://github.com/skant131989-a11y/zevqi-learn/actions/workflows/ci.yml/badge.svg)](https://github.com/skant131989-a11y/zevqi-learn/actions/workflows/ci.yml)
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

Requires Node 20+ and git. The package is not on npm yet, so run it from source:

```bash
git clone https://github.com/skant131989-a11y/zevqi-learn
cd zevqi-learn && npm install && npm run build:cli
npm link -w zevqi-learn        # makes the `zlearn` command available
```

## Quick start

```bash
cd your-project
zlearn init                    # installs the hooks; offers to save your API key (input hidden)
zlearn doctor                  # checks everything is wired up
```

Restart Claude Code (or open `/hooks`), then code as usual. When your agent finishes a turn, a lesson is built in the background. Take it whenever you like:

```bash
zlearn status                  # what is waiting
zlearn learn                   # terminal quiz
zlearn stats                   # streak, XP and level
zlearn ui                      # local dashboard on 127.0.0.1
```

You bring your own model key. `ZLEARN_API_KEY` is preferred, then `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`, then the key saved by `zlearn config set apiKey`.

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
| `zlearn learn [id]` | Take the quiz for the oldest un-reviewed change. |
| `zlearn explain` | Explain your current uncommitted changes now. |
| `zlearn status [--json]` | What is waiting, and which files nobody has reviewed. |
| `zlearn stats [--json]` | Your streak, XP and level for this project. |
| `zlearn ui [--port 4317]` | Local dashboard (lessons, quiz, knowledge map). |
| `zlearn gate off\|warn\|block` | What happens when you commit with un-reviewed AI changes. |
| `zlearn config show` / `set apiKey\|provider\|model\|baseUrl [value]` | Settings. `set apiKey` prompts with hidden input. |
| `zlearn doctor [--json]` | Checks that everything is wired up. |
| `zlearn team join\|status\|sync\|leave` | Share scores with your team. |
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

## Privacy

- **Your code goes only to the AI provider you configure**, using your own API key. It is never sent to a zlearn server.
- **The team server only receives** file paths, lesson ids, scores, timestamps and your name and email. Short summaries are shared only if you set `share` to `summaries` in `.zlearn/config.json`.
- **No telemetry.** The CLI makes no analytics calls.
- Local data lives in `.zlearn/` (git-ignored automatically). Your API key is read from the environment, or stored with owner-only permissions in `~/.zlearn/config.json`.
- The local dashboard listens on `127.0.0.1` only and requires a random per-run token.

See [SECURITY.md](SECURITY.md) for how to report a vulnerability.

## Honest limitations

- **Scores are self-reported.** Quizzes run on the developer's own machine, so a determined person can fake a pass. It is a learning aid and a team signal, not an audit. Do not use it for performance reviews.
- **An AI explains AI.** Explanations and questions can be wrong or shallow. Treat them as a prompt to read the code, not a replacement for it.
- **Claude Code first.** Codex and Cursor use different hook systems and are not supported yet. Outside Claude Code you can still run `zlearn explain` after any change.
- Large diffs are truncated before being sent to the model (about 60 KB total).
- Not yet verified against every Claude Code version. If a hook does not fire, run `zlearn doctor` and open `/hooks` in Claude Code.

## Development

```bash
npm install
npm test            # unit + CLI contract + end-to-end (mock AI, real git, real hook flow)
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [CHANGELOG](CHANGELOG.md).

## License

MIT. See [LICENSE](LICENSE).
