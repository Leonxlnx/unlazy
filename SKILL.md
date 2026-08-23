---
name: unlazy
description: Enforces completion discipline for substantial autonomous work by writing acceptance gates before execution, decomposing work with the Depth Tree, running approved checks, and re-verifying evidence before reporting. Use when Codex faces a long or multi-part task, work that has returned half-done, an exhaustive audit or build, parallel leaves or pipelines, or explicit triggers such as /unlazy, $unlazy, "tree N", "gates", and "do not stop until it is done".
---

# Unlazy

Make incomplete work visible and make completion testable. Prove outcomes against a ledger instead of relying on a confident done report.

## Write gates before real work

Create `GATES.md` from [templates/gates-leaf.md](templates/gates-leaf.md) before implementing. State one observable outcome per gate. Give every runnable gate an indented `CHECK:` and `EXPECT:`; use a manual gate only when no command can decide the outcome.

Treat `CHECK:` as code. Before executing an inherited ledger, parse it without running anything and read every command and called script:

```text
node <skill-dir>/scripts/gate-check.mjs --status GATES.md
```

Approve only commands you wrote or understand, then run them explicitly:

```text
node <skill-dir>/scripts/gate-check.mjs --approve GATES.md
```

When an oracle has no existing approval, a normal run prints `CHECK:`, `EXPECT:`, resolved `CWD:`, resolved shell, and `PATH`, then leaves that command unexecuted. Approvals live under `~/.unlazy/approved` by default. They bind the ledger, gate, command, expectation, resolved working directory and shell, timeout, output and regex limits, platform, and full inherited `PATH`. Changing any bound input requires approval again. Read [SECURITY.md](SECURITY.md) before running checks from an untrusted repository.

Count a runnable gate as met only when its process exits zero and its `EXPECT:` matches combined output. Record the resolved shell, working directory, exit status, and decisive output as evidence. Count a checked box with missing or pending evidence as unmet.

Do not silently remove an impossible gate. Add `ABANDON: <id> <non-empty reason>` and surface it in the final report. A malformed ledger, a ledger with no gates, a duplicate id, or a blank abandonment reason is an error, not completion. Read [references/gates.md](references/gates.md) for the full format and authoring rules.

## Pick the smallest fitting mode

- **Solo:** Use one `GATES.md` for a focused task that fits one working session.
- **Orchestrated:** For a build or deep review, read [references/method.md](references/method.md) and [references/orchestration.md](references/orchestration.md). Write the contract and tree before fan-out. Give every leaf and branch its own gates file.
- **Parallel:** Before dispatching concurrent leaves or pipelines, also read [references/parallel.md](references/parallel.md). Declare disjoint `OWNS:` paths and claim them. Treat scopes and leases as coordination, never as filesystem isolation or a security boundary.

Keep check execution sequential by default. Use `--jobs <N>` only for independent runnable gates when deterministic parallel verification saves wall-clock time. Continue printing and recording results in gate order.

## Build the Depth Tree

1. Split at natural task boundaries. Use the requested depth only while each leaf remains a coherent deliverable.
2. Give each leaf a narrow contract, exact file ownership, and its own ledger.
3. Give each branch integration gates for child verification, interface compatibility, end-to-end behavior, and regressions.
4. Dispatch only leaves whose declared dependencies are verified and whose ownership claim succeeded.
5. Re-run each returned leaf's runnable gates with `--reverify`; do not mistake `--status` for re-execution.

Use rolling dispatch: when a verified leaf unblocks another, dispatch the newly ready leaf without waiting for unrelated in-flight work. Keep states and dependencies in `PLAN.md`; append events to the scope status log.

## Work each leaf in four passes

1. Implement the complete deliverable. Leave no placeholders or deferred remainder.
2. Re-read it as a domain expert and replace the cheap version of each part.
3. Hunt correctness, integration, portability, performance, and evidence defects. Fix what you find.
4. Apply low-cost polish, then repeat until a full improvement pass finds nothing.

Finish a leaf only after the pass is clean and every gate is met with evidence or visibly abandoned.

## Author gates that can fail honestly

Remember that the checker proves only the declared command oracle. It cannot infer whether an English gate title describes what the command actually measures.

- Use a decisive success-only token and require both zero exit and `EXPECT:`.
- Exercise a negative check against a known positive control before trusting absence.
- Measure figures independently; do not copy a supplied number into `EXPECT:` as its own proof.
- Review consequential manual gates with evidence proportional to risk. Try to make the riskiest outcome runnable, but do not claim that manual status and risk generally correlate.
- Prefer portable Node scripts. Do not assume `grep`, `tail`, or `tr` exists on stock Windows.
- Re-run with the same declared shell and required toolchain. Treat an environment mismatch as a failed verification, not as evidence.

## Audit the final report

Re-measure every number and completion claim immediately before reporting. Use qualified ids such as `leaf-1.2.1:G3`. Report the measured met, unmet, and abandoned counts and surface every abandonment. Do not compose a done report while any required gate remains unmet.

## Install the optional Claude Code Stop hook carefully

Offer the hook once when structural stop enforcement would materially help. Never install it without the user's consent:

```text
node <skill-dir>/scripts/install-hooks.mjs
```

The hook returns Claude Code's top-level `decision: "block"` response while this session's resolved pipeline has unmet gates. Its own session-keyed progress guard releases after six consecutive blocks without ledger progress. Remove it with `--uninstall`.

Default installation writes machine-specific project-local settings. Keep `.claude/settings.local.json`, `.unlazy/`, and `.unlazy-hook-state.json` in the project's ignore rules. Shared installation contains absolute Node and hook-script paths and is usually not portable across machines. Read [SECURITY.md](SECURITY.md) before choosing an install target.

## Spend attention where it compounds

Keep leaf briefs to the contract and one ledger. Append status instead of rewriting history. Use stronger reasoning for design, integration, and verification; use cheaper execution only for genuinely mechanical leaves. Read [references/token-economy.md](references/token-economy.md) for the detailed rules.

Do not create gates for a trivial edit or factual reply. Use this discipline when the cost of quiet incompleteness justifies the ledger.
