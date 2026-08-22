# Changelog

## 2.1.0 (2026-08-22)

Gate enforcement becomes safe to run in parallel: one scope per pipeline, file
ownership as a checked lease, and gate files that survive being written while
another run is in flight. Every item below is covered by a test in
`tests/run-tests.mjs` (26 tests, run with `node tests/run-tests.mjs`).

Fixed, in order of severity:

- **`gate-check.mjs` silently dropped its first file argument** unless
  `--timeout` happened to be passed. The arg filter excluded index `tIdx + 1`,
  and `tIdx` is `-1` when `--timeout` is absent, so index `0` was always
  removed. A call naming two leaves ran only the second and printed
  `ALL MET (1 met)`; a call naming one leaf ran none of them, fell back to
  discovery, and ran the whole tree. A false completion signal from the tool
  whose job is preventing false completion signals. Replaced with a real
  argument parser; unknown options now exit 2 instead of being read as files.
- **Gate files were discovered by one glob over the working directory**, so any
  run touched every gates file present. Concurrent leaves executed each other's
  CHECK commands, wrote each other's `EVIDENCE:` lines and flipped each other's
  boxes: a leaf could certify a sibling it had never read. Discovery is now
  scoped to one pipeline and never crosses a scope boundary.
- **The Stop hook blocked on gates the session did not own.** It scanned the
  whole directory, so a finished pipeline was blocked by an unrelated one, named
  the offending gate as a bare `G1` (unique only within a file), and shared one
  `.unlazy-hook-state.json` progress counter across all pipelines, letting them
  reset and exhaust each other's loop guard. The hook now resolves one scope,
  keeps a counter per scope, reports file-qualified ids, and allows the stop
  when it cannot tell whose pipeline it is looking at.
- **Gate ids differed between the two scripts.** `gate-check` fell back to
  `line<N>` for a gate with no `Gn:` prefix while `stop-hook` fell back to the
  first 24 characters of the title, so such a gate had two identities and could
  not be reliably abandoned. Both now share one parser.
- **`install-hooks.mjs` identified its own entries by the literal word "unlazy"
  in the hook script's path.** Vendoring or renaming the skill made it stack
  duplicate Stop entries and report "nothing to remove" on uninstall. It now
  matches the hook script's actual path, and still recognises entries written by
  upstream v2.0.
- **Gate files were written back from a whole-file snapshot** taken before the
  checks ran, so a concurrent edit to a different gate in the same file was
  erased. Writes now re-read under a lock, apply only the gates that run
  resolved, and replace the file by atomic rename.

New:

- **Scopes.** A pipeline lives at `.unlazy/<scope>/` with its own gates, status
  log, loop-guard counter and session binding. Selected by `--scope`,
  `UNLAZY_SCOPE`, a session binding, or being the only pipeline present. When
  several exist and none resolves, the tools refuse rather than guess.
- **File-ownership leases.** `OWNS:` in a gates file plus `--claim` turns
  `PLAN.md`'s "no two leaves own the same file" into a checked constraint;
  overlap is refused with exit 3 and names the holder. `--release` frees them.
- **`CWD:`** runs a single check somewhere other than the root, for a pipeline
  whose checks belong in a subproject.
- **`--log`** appends one line to the scope's status log, so `PLAN.md` is never
  read-modify-written by concurrent leaves.
- **`--bind`, `--list-scopes`, `--status`, `--root`, `--cwd`, `--help`**.
- **`scripts/lib/gates.mjs`**: parsing, scope resolution, locking and leases in
  one place, imported by both scripts.
- **`tests/run-tests.mjs`**: 30 zero-dependency behavioural tests covering the
  argument parser, scope isolation, refusal-on-ambiguity, concurrent-edit
  survival, lease conflicts, per-scope hook counters and hook installation.
- **`references/parallel.md`**: scopes, leases, and what is still the driver's
  job.

How many leaves run at once, and in what order, is deliberately left out: it
belongs to the dispatcher, and rolling dispatch beats any batching this layer
could impose.

Unchanged: the method, the four passes, the report audit, the verification
hierarchy, the token-economy rules, and the legacy layout: `GATES.md` plus
`gates/*.md` in the working directory still works, so solo mode needs no
migration.

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
