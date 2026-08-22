# Gate file format

The machine-readable contract between "I say it is done" and "it is done".
`gate-check.mjs` and `stop-hook.mjs` both parse this format through one shared
implementation (`scripts/lib/gates.mjs`), so the two can never disagree about
what a gate is or what its id is. Any deviation from the format weakens
enforcement.

## Format

```markdown
# Gates: <scope name>

OWNS: <globs this unit is allowed to write>

Scope: <one line>

- [ ] G1: <outcome>
  CHECK: <shell command>
  EXPECT: <substring or /regex/>
  EVIDENCE: pending

- [ ] G2: <outcome proven somewhere other than the root>
  CHECK: npm run build
  EXPECT: built in
  CWD: packages/web
  EVIDENCE: pending

- [ ] G3: <manual outcome>
  EVIDENCE: pending

ABANDON: G3 <reason, only if a gate had to be surrendered>
```

## Parsing rules

- A gate starts at a line matching `- [ ]` or `- [x]` (case-insensitive x).
- Indented `CHECK:`, `EXPECT:`, `EVIDENCE:`, `CWD:` lines up to the next gate
  belong to the gate above them.
- `OWNS:` is a file-level header, read only before the first gate, and takes a
  comma-separated list of globs.
- `EXPECT:` is a plain substring match against the command's combined
  stdout+stderr, unless wrapped in slashes, then it is a JavaScript regex
  (e.g. `/8\/8 passed/`).
- `CWD:` runs that one check in that directory, resolved against `--cwd` (or the
  root when `--cwd` is absent).
- `ABANDON: G<n> <reason>` anywhere in the file marks that gate as honestly
  surrendered. Tools treat it as resolved but reports must list it.

## Gate ids

A gate's id is the token before the first colon in its title (`G1`, `N3`), or
`L<line number>` when there is none. Always write an explicit id: it is what
`ABANDON` refers to.

Ids are unique **within a file**, not across a tree, so both tools report them
qualified by file stem: `leaf-1.2.1:G3`, `node-1.1:N2`. Use the qualified form
in reports and when telling a leaf which gate to go finish. Inside a gates file,
`ABANDON: G3` still means that file's G3.

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
- **Assert the positive string, never the absence of an error.** A CHECK that
  pipes (`npm test | tail`) reports the *last* command's status, so a killed
  build reads as success. Either set `-o pipefail`, or let `EXPECT` require the
  line that can only appear on success.
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

## Concurrency

`OWNS:` is what makes a leaf's file ownership checkable instead of a promise in
`PLAN.md`. It is not required for solo mode. Full detail in
[parallel.md](parallel.md).
