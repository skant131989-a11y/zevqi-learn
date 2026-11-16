# Changelog

All notable changes to zlearn. Versions follow [semver](https://semver.org).

## Unreleased

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
