# Changelog

All notable changes to zlearn. Versions follow [semver](https://semver.org).

## Unreleased

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
