# Gate file format

The machine-readable contract between "I say it is done" and "it is done".
Both bundled scripts (`gate-check.mjs`, `stop-hook.mjs`) parse exactly this
format, so any deviation weakens enforcement.

## Format

```markdown
# Gates: <scope name>

Scope: <one line>

- [ ] G1: <outcome>
  CHECK: <shell command>
  EXPECT: <substring or /regex/>
  EVIDENCE: pending

- [ ] G2: <manual outcome>
  EVIDENCE: pending

ABANDON: G2 <reason, only if a gate had to be surrendered>
```

## Parsing rules

- A gate starts at a line matching `- [ ]` or `- [x]` (case-insensitive x).
- Indented `CHECK:`, `EXPECT:`, `EVIDENCE:` lines up to the next gate belong
  to the gate above them.
- `EXPECT:` is a plain substring match against the command's combined
  stdout+stderr, unless wrapped in slashes, then it is a JavaScript regex
  (e.g. `/8\/8 passed/`).
- `ABANDON: G<n> <reason>` anywhere in the file marks that gate as
  honestly surrendered. Tools treat it as resolved but reports must list it.

## What counts as UNMET

A gate is unmet if any of these hold:

1. Its box is unchecked, and no ABANDON line names it.
2. Its box is checked but `EVIDENCE:` still reads `pending`. A checkbox is a
   claim; evidence is the proof. Checked-without-evidence is the exact
   failure mode this system exists to catch, so it counts as worse than
   unchecked, not better.

## Writing good gates

- **State outcomes, not activities.** "All 8 planets clickable" is checkable.
  "Work on planet interaction" is not.
- **Prefer runnable gates.** Every CHECK you write converts model-tokens of
  self-assessment into a free shell command. If you cannot think of a CHECK,
  ask whether the outcome is observable at all; if it is not, sharpen it.
- **Make EXPECT decisive.** Match the line that can only appear on success
  (`8/8 passed`), not one that appears either way (`done`).
- **Give a negative gate a positive control.** A gate proving absence is usually
  written `cmd && echo FOUND || echo NOT_FOUND`, whose passing token comes from the
  failure branch: a missing file, a wrong path or a malformed pattern all report
  absence. Before trusting one, run its CHECK against a case you know contains the
  thing and confirm it fails. A gate that has never failed has not been tested.
- **Never make a supplied number the EXPECT.** When a brief hands you a figure to
  cross check, gate on measuring the figure, not on matching it. `EXPECT: 7` makes
  agreement with the brief the definition of success, so a contradicting measurement
  of your own reads as your failure and invites you to bend it.
- **Look at which gates ended up manual.** Checkability and risk are anti correlated:
  the outcomes hardest to prove by command are usually the ones most likely to be
  silently wrong. If one gate is manual, check whether it is also the riskiest outcome
  in the leaf, and try harder to make that one runnable.
- **Cap evidence.** gate-check records the deciding tail of output. When
  filling manual evidence by hand, quote the deciding lines or cite
  `file:line`, never paste a log.
- **Five to twelve gates per leaf** is the useful range. Two gates means the
  leaf is under-specified; twenty means the leaf should have been two leaves.

## Numbers rule

Any number that will appear in a final report deserves its own gate with a
CHECK that measures it. Measured runs of v1 showed reports whose only false
claims were numbers stated from memory. If a number matters enough to
report, it matters enough to measure at report time.
