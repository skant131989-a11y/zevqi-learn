# zevqi-learn (`zlearn`)

Understand the code your AI agent writes, as fast as it writes it.

AI coding agents like Claude Code can change a dozen files in a minute. Reviewing all of it line by line is slow, and skipping it builds up what people call *comprehension debt*: code your team runs but nobody can explain. `zlearn` turns every agent turn into a short lesson and a 3-question check, so you actually know what changed before you commit.

```
agent edits files ──► zlearn explains the change in plain language ──► you answer 3 quick questions ──► (optional) your team sees who understands what
```

## How it works

1. `zlearn init` adds three [Claude Code hooks](https://code.claude.com/docs/en/hooks) to your project:
   - **PostToolUse** (Edit/Write): quietly remembers which files the agent touched.
   - **Stop**: when the agent finishes a turn, starts a background job that explains the change. It never slows the agent down.
   - **PreToolUse** on `git commit`: warns (or blocks, if you choose) while AI changes are un-reviewed.
2. A lesson appears: a plain-English summary, a note per file, and 3 questions about behaviour, edge cases and risk.
3. `zlearn learn` runs the quiz in your terminal. `zlearn ui` shows it in a local web page, plus a map of which files you've actually reviewed.

## Install and set up

Requires Node 20+ and git. The package is not on npm yet; for now run it from source:

```bash
git clone https://github.com/skant131989-a11y/zevqi-learn
cd zevqi-learn && npm install && npm run build:cli
npm link -w zevqi-learn          # makes the `zlearn` command available

cd your-project
export ANTHROPIC_API_KEY=sk-ant-...     # or OPENAI_API_KEY; you bring your own key
zlearn init                              # restart Claude Code afterwards
```

Then code with your agent as usual. When it finishes a turn: `zlearn learn`.

## Commands

| Command | What it does |
|---|---|
| `zlearn init [--shared\|--global] [--gate off\|warn\|block]` | Turn it on in this repo and install the hooks. |
| `zlearn learn [id]` | Take the quiz for the oldest un-reviewed change. |
| `zlearn explain` | Explain your current uncommitted changes now. |
| `zlearn status` | What is waiting for review, and which files nobody has reviewed. |
| `zlearn ui` | Local dashboard on `127.0.0.1` (lessons, quiz, knowledge map). |
| `zlearn gate off\|warn\|block` | What happens when you commit with un-reviewed AI changes. |
| `zlearn config set apiKey\|provider\|model\|baseUrl <value>` | Settings. Prefer environment variables for keys. |
| `zlearn doctor` | Checks that everything is wired up. |
| `zlearn uninstall` | Removes the hooks (your lessons stay in `.zlearn/`). |

## Teams

A hosted team dashboard shows who understands which parts of the codebase, which files nobody has reviewed ("blind spots"), and which are understood by only one person.

```bash
zlearn team create --server https://zevqi.com --name "Acme" --secret <create-secret>   # prints a team key + admin dashboard link
zlearn team join   --server https://zevqi.com --key zlt_... --email you@acme.io
```

Lessons then sync automatically after each quiz. The team server is not part of this open-source repo.

## Privacy

- **Your code goes only to the AI provider you configure**, using your own API key. It is never sent to a zlearn server.
- **The team server only receives** file paths, scores and timestamps. Short summaries are shared only if you set `share` to `summaries` in `.zlearn/config.json`.
- Local data lives in `.zlearn/` (git-ignored automatically). Your API key is read from the environment, or stored with owner-only permissions in `~/.zlearn/config.json`.
- The local dashboard listens on `127.0.0.1` only and requires a random per-run token.

## Honest limitations

- **Scores are self-reported.** Quizzes run on the developer's own machine, so a determined person can fake a pass. It is a learning aid and a team signal, not an audit.
- **An AI explains AI.** Explanations and questions can be wrong or shallow. Treat them as a prompt to read the code, not a replacement for it.
- **Claude Code first.** Codex and Cursor use different hook systems and are not supported yet.
- Large diffs are truncated before being sent to the model (about 60 KB total).
- Not yet tested against every Claude Code version. If a hook does not fire, run `zlearn doctor` and open `/hooks` in Claude Code.

## Development

```bash
npm install
npm test        # builds the CLI and runs the end-to-end tests (mock AI, real git, real hook flow)
```

## License

MIT. See [LICENSE](LICENSE).
