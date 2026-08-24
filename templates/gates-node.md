# Gates: <branch name> integration

Scope: integrate children <explicit child ids> into one verified result

- [ ] N1: every named child leaf is reverified from its exact ledger
  CHECK: node <skill-dir>/scripts/gate-check.mjs --root . --cwd . --reverify --jobs 1 .unlazy/<scope>/gates/leaf-<a>.md .unlazy/<scope>/gates/leaf-<b>.md
  EXPECT: ALL MET
  EVIDENCE: pending

- [ ] N2: child interfaces match the contract in PLAN.md
  CHECK: node scripts/verify-interfaces.mjs
  EXPECT: interface verification passed
  EVIDENCE: pending

- [ ] N3: cross-child behavior works end to end
  CHECK: node scripts/verify-integration.mjs
  EXPECT: integration verification passed
  EVIDENCE: pending

- [ ] N4: affected sibling behavior has not regressed
  CHECK: node scripts/verify-regressions.mjs
  EXPECT: regression verification passed
  EVIDENCE: pending

- [ ] N5: every direct child ownership lease was released after parent verification
  EVIDENCE: pending

- [ ] N6: consequential manual outcomes from the children were reviewed at branch level
  EVIDENCE: pending

<!--
Replace every placeholder before running the checker.

N1 must name every direct child explicitly and use --reverify, not --status.
Status reports old evidence without executing it. Keep --jobs 1 unless the child
checks are independent and deterministic parallel execution is intentional.
If a child reports an abandonment, N1 exits 1 with `HANDOFF REQUIRED`. Mark the
branch ABANDONED and surface the handoff; never rewrite that result as completion.

Branch paths use node-<id>.md. Leaf paths use leaf-<id>.md. Branch completion
requires integration evidence; a set of locally complete leaves is not enough.

For N5, run this once for each direct child after verification and record the
outputs as manual evidence:

node <skill-dir>/scripts/gate-check.mjs --scope <scope> --leaf leaf-<id> --release

Drop N5 only when no child claimed ownership. See references/orchestration.md
and references/parallel.md.
-->
