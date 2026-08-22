# Gates: <branch name> (integration)

Scope: children <list child leaves/branches> merged into one working whole

- [ ] N1: every child leaf's gates file is fully checked (no unchecked boxes, no pending evidence)
  CHECK: node <skill-dir>/scripts/gate-check.mjs --status .unlazy/<scope>/gates/leaf-<a>.md .unlazy/<scope>/gates/leaf-<b>.md
  EXPECT: ALL MET
  EVIDENCE: pending

- [ ] N2: interfaces match the contract in PLAN.md
  CHECK: <build / typecheck / import test command>
  EXPECT: <success marker>
  EVIDENCE: pending

- [ ] N3: cross-child behavior works end to end
  CHECK: <integration test, smoke script, or curl sequence>
  EXPECT: <success marker>
  EVIDENCE: pending

- [ ] N4: nothing regressed in siblings this merge touched
  CHECK: <targeted re-run of affected sibling checks>
  EXPECT: <success marker>
  EVIDENCE: pending

- [ ] N5: no leaf still holds a file-ownership lease from this branch
  CHECK: node <skill-dir>/scripts/gate-check.mjs --scope <scope> --release
  EXPECT: released
  EVIDENCE: pending

<!--
Branch gates exist because finished parts do not imply a finished whole.
Do not mark N1 by trusting child reports: re-run their checks yourself
(verification hierarchy, references/orchestration.md).

N1 names its children explicitly rather than relying on discovery, so a child
added later cannot slip past this gate unnoticed. Naming files also keeps the
check inside this branch: an unqualified run would cover the whole pipeline.

Drop N5 if this branch's leaves never claimed ownership.
-->
