# Changelog

All notable changes to Zevqi (formerly zlearn). Versions follow [semver](https://semver.org).

## Unreleased

## 0.5.1

### Changed
- Package metadata only: the repository, homepage and issue links on the npm page now point at github.com/zevqi/zevqi (the repository was renamed from zlearn). No behaviour change.

## 0.5.0

### Changed
- **The product is now called Zevqi.** The npm package is `zevqi` and the command is `zevqi`: `npm install -g zevqi; zevqi setup --key <your-team-key>`. The old name was shared by several unrelated products, which made this one hard to find.
- **`zlearn` still works.** The package installs both commands, `zevqi` and `zlearn`, and they run the same program. Nothing you set up with 0.4.x stops working.
- Everything the tool prints says Zevqi and shows `zevqi …` commands.
- **Settings:** `ZEVQI_TEAM_KEY`, `ZEVQI_SERVER`, `ZEVQI_API_KEY`, `ZEVQI_PROVIDER`, `ZEVQI_MODEL`, `ZEVQI_HOME` and `ZEVQI_NO_NUDGE` are accepted. The older `ZLEARN_*` names keep working, and the new name wins if both are set.
- **Unchanged on purpose:** the `.zlearn/` folder (so existing lessons stay where they are) and the markers and `zlearn lesson add` line in the `AGENTS.md` block, so a teammate on an older version can still read what 0.5 wrote.
- The old package `zlearn-cli` is deprecated and points here.

## 0.4.1

### Changed
- **Honest wording for author ids.** `zlearn scan` now says it shares *pseudonymous* author ids, not anonymous ones. They are a short one-way hash of the author's email: no email or name can be read back out, but anyone who already has a list of candidate emails could hash them and compare. What is sent is unchanged. The `--dry-run` output, the setup disclosure and the README use the new wording.

## 0.4.0

### Added
- **`zlearn setup`: the whole first run in one command.** Joins your team, turns zlearn on in this repository and uploads the first knowledge map, with numbered steps and a dashboard link at the end. The email comes from `git config`, the key from `--key` or `ZLEARN_TEAM_KEY`. Install and setup are one paste: `npm install -g zlearn-cli; zlearn setup --key <teamKey>`. Published to npm as `zlearn-cli`.
- **`zlearn scan`: a knowledge map from git history.** No model, no key, nothing for teammates to do. Uploads per-file commit counts, dates, AI co-author marks and anonymous author ids (hashes, never emails; names only with `--names`). `--dry-run` shows the exact payload and sends nothing. Bots are skipped, and deleted files, lockfiles and generated files are left out.
- **Attested review without a model.** `zlearn review <file>` with no API key (or `--no-ai`) shows you the real change and asks you to describe it in your own words. Not graded. Your words stay on your machine; only the path, a content fingerprint and your own call are shared. Too-short and repeated answers are asked again.
- **`zlearn lesson add`: lessons written by your own coding agent.** `zlearn init` with no API key adds a block to `AGENTS.md` (and a one-line import in `CLAUDE.md`) so Codex, Cursor or Claude Code write the lesson themselves. The files come from git, so a lesson can only describe files that really changed.
- Dashboard links after `team join`, `scan` and `check`.

### Changed
- **A model key is now optional.** `zlearn doctor` no longer fails without one, and `zlearn init` asks for confirmation only when a key is configured, because only then is anything sent to a provider.
- `zlearn check` is unchanged for older servers.

## 0.3.0

### Added
- **Evidence, not just scores.** After the questions, zlearn asks "Do you feel you understand this change?" with three answers: understood, need clarification, need further investigation. Only "understood" counts as evidence for your team. A short note on what is unclear stays on your machine unless you set `share` to `summaries`. The local `zlearn ui` page has the same choice.
- **Content fingerprints.** Each lesson records a git blob hash for every file, and syncs it. The team server uses it to tell when a file changed after someone reviewed it, so old reviews expire instead of counting forever. No code is sent.
- `zlearn review <file...> [--commits 5]`: review the recent committed changes to files, such as a teammate's, and add your own evidence. This is how a second person covers a file.
- Better lessons: questions are tagged (Why, Failure case, Assumption, Dependency) and the explanation lists decisions in the code, what it depends on and what could break.
- A plain-language disclosure of what is sent to your model provider, shown by `zlearn init` (and once, without blocking, for older installs). `--yes` or `--no-prompt` skips the confirmation.
- `zlearn check` shows out-of-date files (reviewed once, changed since) and the reason for each flag. `--fail-on blind` now also fails on out-of-date files.

### Changed
- Older team servers still work. A lesson without fingerprints or an answer is treated as before.

### Added (earlier, unreleased)
- `zlearn check`: a pull-request gate. Lists the files a branch changes and asks the team server which have AI changes nobody has understood. `--fail-on unreviewed|blind`, GitHub annotations and job summary, `ZLEARN_TEAM_KEY` for CI, soft-fails on outages unless `--strict`.

### Fixed
- Hooks now match edited files to the repository by canonical path, so Windows short names (such as `RUNNER~1`), case differences and symlinks can no longer make an edit invisible. Found by CI on Windows.

## 0.2.0

### Added
- `zlearn stats`: your streak, XP and level for the project. The same rules power the team dashboard.
- After each quiz: XP earned, streak and level progress, with a level-up message.
- `--json` output for `status`, `stats`, `doctor` and `team status`, for scripts and CI.
- `zlearn help <command>` and `zlearn <command> --help` with usage and examples.
- Typo suggestions ("Did you mean: zlearn learn?").
- Hidden API-key entry: `zlearn init` and `zlearn config set apiKey` prompt without echoing the key.
- `NO_COLOR` and `FORCE_COLOR` support.
- Proper exit codes: `2` for usage errors, `1` for failures. `zlearn doctor` exits `1` when a check fails.
- `zlearn team join` verifies the team key with the server before saving it, and tolerates an offline server (lessons queue locally).
- A gentle weekly tip when a repo has 3+ recent contributors and you are not on a team (interactive terminals only; hide with `ZLEARN_NO_NUDGE=1`).

### Changed
- The CLI is now split into small command modules instead of one large file.
- `zlearn --version` reads the version from `package.json`.
- Errors print a short hint for the next step.

### Tests and tooling
- Unit and CLI-contract test suites alongside the end-to-end test (24 tests).
- GitHub Actions CI on Linux and Windows, Node 20 and 22.
- `SECURITY.md`, `CONTRIBUTING.md`, issue and pull request templates.

## 0.1.0

- First release: Claude Code hooks, background lesson generation, terminal quiz, local dashboard, commit gate and optional team sync.
