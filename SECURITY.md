# Security policy

## Reporting a vulnerability

Please report security issues privately by email to **hello@zevqi.com** with the subject `Security report`.
Do not open a public issue for a vulnerability.

Include what you found, how to reproduce it, and the version (`zevqi --version`). We acknowledge reports within
2 business days, aim to fix confirmed issues quickly, and credit reporters who want credit.

Please do not test against other people's team data or the hosted service beyond what is needed to demonstrate the issue.

## What Zevqi does with your data

- **Source code** is sent only to the model provider you configure, using your own API key. It is never sent to a Zevqi server.
- **Team sync** (optional) sends file paths, lesson ids, statuses, quiz scores, timestamps and the member's name and email. Lesson summaries are shared only if you set `share` to `summaries` in `.zlearn/config.json`.
- **The CLI makes no analytics or telemetry calls.**
- **Your API key** is read from the environment (`ZLEARN_API_KEY`, then your provider's variable) or stored in `~/.zlearn/config.json` with owner-only permissions. `zevqi config show` never prints more than the first 6 characters.
- **The local dashboard** (`zevqi ui`) binds to `127.0.0.1`, requires a random per-run token, and checks the `Host` header.
- **Hooks** run in Claude Code, always exit successfully, and do their slow work in a detached background process.

## Known limitations

- Quiz scores are self-reported. They are a team signal, not an audit.
- Lessons are written by a language model and can be wrong. Treat them as a prompt to read the code.
- Hooks execute commands on your machine. Review `.claude/settings*.json` like any other code before sharing it.

## Supported versions

Security fixes land in the latest release.
