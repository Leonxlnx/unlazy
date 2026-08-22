# Gates: <leaf or task name>

OWNS: <globs this leaf may write, e.g. src/api/**, tests/api/*.test.ts>

Scope: <one line: what this unit of work delivers>

- [ ] G1: <observable outcome, stated so a stranger could judge it>
  CHECK: <shell command that proves it>
  EXPECT: <substring the command output must contain, or /regex/>
  EVIDENCE: pending

- [ ] G2: <an outcome proven somewhere other than the root>
  CHECK: <command>
  EXPECT: <the line that can only appear on success>
  CWD: <subdirectory>
  EVIDENCE: pending

- [ ] G3: <manual gate, when no command can prove it>
  EVIDENCE: pending

<!--
Rules (full spec in references/gates.md):
- One box per outcome. Boxes are flipped by gate-check.mjs when CHECK output
  matches EXPECT, or by hand for manual gates.
- A checked box with EVIDENCE still reading "pending" counts as UNMET.
- Evidence is the deciding lines only, never a full log.
- EXPECT must match a line that can only appear on success. "done" appears
  either way; "8/8 passed" does not.
- CWD: <dir> runs one check somewhere other than the root.
- OWNS is only needed when leaves run in parallel: it makes file ownership
  checkable via --claim instead of promised in PLAN.md. See references/parallel.md.
- If a gate becomes impossible, do not delete it. Add a line:
    ABANDON: G<n> <reason>
  and report it. Visible surrender is honest; silent scope-narrowing is not.
-->
