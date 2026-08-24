# Gates: <leaf or task name>

OWNS: <repository-relative globs this leaf may write, for example src/api/**, tests/api/**>

Scope: <one sentence describing the complete deliverable>

- [ ] G1: <observable outcome measured directly from the artifact>
  CHECK: node scripts/verify-outcome.mjs
  EXPECT: outcome verification passed
  EVIDENCE: pending

- [ ] G2: <integration outcome in a subproject>
  CHECK: node scripts/verify-integration.mjs
  EXPECT: integration verification passed
  CWD: packages/example
  EVIDENCE: pending

- [ ] G3: <manual outcome that no command can decide>
  EVIDENCE: pending

<!--
Replace every placeholder before running the checker.

Strict format:
- Use a unique explicit id for every gate.
- Indent CHECK, EXPECT, CWD, and EVIDENCE.
- Give a runnable gate both CHECK and EXPECT; give a manual gate neither.
- Success requires process exit 0 and EXPECT.
- Make EXPECT a success-only marker produced after every assertion passes.
- For an absence or negative assertion, test the same checker against a known
  positive fixture and record that control in the gate's manual review.
- Measure supplied figures from source. Do not copy a supplied number into
  EXPECT as its own proof.
- Use repository-owned Node scripts for portable examples. Declare any
  non-default shell or external tool requirement explicitly.
- Scoped and legacy discovery anchor checks at the repository root. When this
  ledger is named explicitly from `.unlazy/`, pass an explicit repository
  `--root` and `--cwd` so repository-relative commands keep the same base.
- Record exact manual evidence and review consequential manual gates by risk.
- OWNS paths must be repository-relative, complete, and disjoint from every
  concurrently dispatched leaf. Claims coordinate writers; they do not sandbox.

If a gate becomes genuinely impossible, keep the gate and add:

```text
ABANDON: G<n> <non-empty reason and handoff>
```

Surface every abandonment as a non-successful handoff in the final report; an
abandoned leaf is not complete. See references/gates.md.
-->
