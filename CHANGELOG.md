# Changelog

## 2.0.0 (2026-08-10)

Enforcement moved from prose into files, checks and an optional hook. Motivated by a controlled six-run test of v1 (two build tasks, three conditions each, independent code review plus adversarial verification plus live browser testing) whose headline results are in the README.

Breaking change to the method's semantics:

- The Depth Tree is now a decomposition tool, not an effort multiplier. Measured runs ignored the 2^(N-1) arithmetic (tree 6 cost about 1.0-1.5x tree 3). Depth now follows the task's natural joints; effort per leaf is enforced by that leaf's gates.

New:

- **Rule zero: gates before work.** Acceptance criteria go into `GATES.md` / `gates/*.md` as checkboxes with runnable `CHECK:` / `EXPECT:` lines and mandatory evidence. Done means the ledger is full, not that the output feels finished.
- **`scripts/gate-check.mjs`**: runs CHECK commands, flips boxes only on EXPECT match, records capped evidence, treats checked-without-evidence as unmet. Zero dependencies, Node 16+.
- **`scripts/stop-hook.mjs`** (Claude Code, optional): Stop hook that blocks ending the turn while gates are unmet. Progress-aware loop guard: counter resets when gate files change, releases with a warning after 6 blocked stops without progress, honors `ABANDON: <gate> <reason>` as an honest exit.
- **`scripts/install-hooks.mjs`**: idempotent install/uninstall into project `settings.local.json` (default), shared `settings.json` (`--shared`) or `~/.claude/settings.json` (`--global`).
- **Orchestrated mode** for tree 4+: `PLAN.md` contract fixed before fan-out, one gates file per leaf and per branch, leaves run as fresh subagents, parent re-runs each leaf's checks (self-certification counts for nothing). Templates in `templates/`.
- **Report audit rule**: every number in a final report is re-measured at report time or labeled unverified. In testing, wrong numbers in confident reports were the single most reproducible failure that survived v1.
- **Token economy** guidance, measured: checks as subprocesses instead of model re-reading, capped evidence, lean leaf briefs, append-only status logs, model tiering for mechanical leaves.
- References split out for progressive disclosure: `references/method.md`, `references/gates.md`, `references/orchestration.md`, `references/token-economy.md`.

Kept from v1: the four work passes, contracts before fan-out, continuation forcing (now mechanical: run gate-check, refute one passed gate), finish one line of attack, do not simulate work you can do, resource-anxiety rule (now with a concrete handover path), full-sweep counting.

## 1.0.0 (2026-08-10)

Initial release.

- SKILL.md with the Depth Tree method as the core: estimate T once at the root, split binary N layers deep, every leaf gets the full T, iterate each leaf until a pass finds nothing to improve.
- Nine enforcement rules grounded in 2025-2026 research on model laziness, underthinking, overthinking, long-horizon degradation and context anxiety.
- Spec-compliant frontmatter (name, description, license, metadata) so the skill loads in Claude Code, OpenAI Codex CLI, Cursor and the skills CLI (`npx skills add Leonxlnx/unlazy`).
- README with install matrix, method explanation, and an annotated research list.
