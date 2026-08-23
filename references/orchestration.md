# Orchestrated mode

Use orchestrated mode when one context cannot hold the task and its verification at full attention. Keep the driver responsible for planning, dispatch, independent verification, integration, and the root report.

## Declare states and paths

Use these leaf states only:

- `WAITING`: one or more ids in `Needs` are not yet `VERIFIED`
- `READY`: dependencies are verified and ownership is available
- `IN-FLIGHT`: dispatched and not yet independently verified
- `VERIFIED`: parent re-verification passed and manual gates were reviewed
- `ABANDONED`: at least one required gate has a recorded handoff; never treat this as full completion

Use `OPEN`, `VERIFIED`, or `ABANDONED` for branches. Store leaf ledgers as `gates/leaf-<id>.md` and integration ledgers as `gates/node-<id>.md`. Do not label a branch path as `leaf-*`.

## Driver loop

1. **Plan before fan-out.** Create `.unlazy/<scope>/PLAN.md`, `.unlazy/<scope>/GATES.md`, and one ledger per leaf and branch from the templates. Fix interfaces, naming, toolchain, dependencies, and exact ownership before dispatch.
2. **Inspect and approve checks.** Run `gate-check --status` on every inherited ledger. Review each `CHECK:`, `EXPECT:`, and `CWD:`, including called scripts. Determine the shell and inherited `PATH`; a new oracle with no exact approval prints its resolved values during a normal run without executing. Use `--approve` only after inspection, and do not treat normal mode as a dry run once approval exists.
3. **Claim every concurrent leaf.** Run:

   ```text
   node <skill-dir>/scripts/gate-check.mjs --scope <scope> --leaf leaf-1.2.1 --claim
   ```

   A refused claim means the split is not safe for concurrent dispatch. Change the plan or run the work sequentially; never bypass the refusal.
4. **Dispatch ready leaves.** Give each leaf only the shared contract, its exact ownership and dependencies, its own ledger, and the four-pass completion rule. Do not leak unrelated leaf histories.
5. **Verify each return independently.** Re-run the returned leaf's runnable gates, including already checked gates:

   ```text
   node <skill-dir>/scripts/gate-check.mjs --root . --cwd . --reverify .unlazy/<scope>/gates/leaf-1.2.1.md
   ```

   `--status` alone is not re-verification. If an approved oracle changed, inspect it and approve the new oracle before continuing. Review manual gates directly and try to refute at least one passed gate.
6. **Append status and roll forward.** Record the result without rewriting history:

   ```text
   node <skill-dir>/scripts/gate-check.mjs --scope <scope> --log "leaf-1.2.1 verified"
   ```

   Mark the leaf `VERIFIED`, promote newly unblocked leaves from `WAITING` to `READY`, and dispatch them without waiting for unrelated in-flight leaves.
7. **Integrate bottom-up.** Work each `node-*.md` ledger only after all named children return. Reverify the children, then run interface, end-to-end, and regression checks.
8. **Release and report.** Release all scope leases after final verification. Report only when the root ledger is met. Surface every abandonment and remeasure every reported count.

## Check concurrency

Gate checks run sequentially by default (`--jobs 1`). This is the easiest transcript to debug and is the compatibility behavior.

Use `--jobs <N>` only when runnable gates are independent and parallel execution reduces wall-clock time:

```text
node <skill-dir>/scripts/gate-check.mjs --root . --cwd . --reverify --jobs 4 .unlazy/<scope>/gates/leaf-1.1.1.md .unlazy/<scope>/gates/leaf-1.1.2.md
```

The limit is rolling: start another check when one finishes instead of waiting for a fixed batch. Output and file updates remain deterministic in ledger order. `--jobs` controls command execution, not subagent dispatch and not dependency readiness.

## Rolling dispatch

Treat dispatch as a loop:

```text
while an unverified leaf remains:
  dispatch each READY leaf whose ownership is claimed
  wait for the next leaf to return
  reverify that leaf and review its manual evidence
  append status and update its declared state
  promote each WAITING leaf whose Needs are all VERIFIED
```

Do not invent a dependency during dispatch. Add it to `PLAN.md`, correct the affected states, and record the change. Prefer independent leaves, but do not force independence where an interface must be established first.

## Verification hierarchy

1. **Leaf self-check:** catches ordinary incompleteness but remains self-certification.
2. **Parent `--reverify`:** executes each runnable oracle again instead of trusting old or manually written evidence.
3. **Branch integration:** catches locally correct children that do not compose.
4. **Optional Stop hook:** blocks the driver from ending while its resolved pipeline remains unmet. It scans ledgers; it does not execute checks or validate their meaning.

The parent must use the same required toolchain and declared shell. If the environment differs, record and resolve the mismatch instead of accepting old evidence.

## Manual gates

Automation cannot prove every user-facing or judgment-heavy outcome. For each manual gate:

- cite the exact artifact, location, measurement, or reviewer decision
- review consequences, not only visual polish
- obtain independent review for high-risk outcomes when feasible
- keep the gate unmet if evidence is ambiguous

Do not call a leaf `VERIFIED` merely because every runnable gate passed.

## When not to orchestrate

Stay solo when one focused context can implement and verify the task without hiding independent deliverables. Orchestration has planning and integration overhead; use it for attention isolation, not ceremony.
