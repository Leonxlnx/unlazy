# Gates: <branch name> (integration)

Scope: children <list child leaves/branches> merged into one working whole

- [ ] N1: every child leaf's gates file is fully checked (no unchecked boxes, no pending evidence)
  CHECK: node <skill-dir>/scripts/gate-check.mjs --status gates/leaf-<a>.md gates/leaf-<b>.md
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

<!--
Branch gates exist because finished parts do not imply a finished whole.
Do not mark N1 by trusting child reports: re-run their checks yourself
(verification hierarchy, references/orchestration.md).
-->
