# Plan: <task>

Scope: <pipeline id; this file lives at .unlazy/<scope>/PLAN.md>
Depth: tree <N>   Mode: orchestrated
Budget note: <what a competent single pass would take; context, not arithmetic>

## Contract

Decided BEFORE fan-out. Everything a leaf could get wrong about its neighbors:

- Interfaces: <function signatures, file formats, API shapes>
- Data ownership: <which leaf owns which files; no two leaves share a file.
  Each leaf repeats its share as an OWNS: header in its own gates file, so the
  claim is checked by --claim rather than trusted>
- Naming and conventions: <casing, folder layout, error handling style>

## Tree

Each leaf's gates file carries its own `OWNS:` header, so ownership is claimed
and checked per leaf rather than trusted from this table.

- 1 <task>
  - 1.1 <branch> .......... gates/node-1.1.md
    - 1.1.1 <leaf> ........ gates/leaf-1.1.1.md
    - 1.1.2 <leaf> ........ gates/leaf-1.1.2.md
  - 1.2 <branch> .......... gates/node-1.2.md
    - 1.2.1 <leaf> ........ gates/leaf-1.2.1.md
    - 1.2.2 <leaf> ........ gates/leaf-1.2.2.md

## Status log

The log lives in `.unlazy/<scope>/status.log`, not in this file, and is appended
to one line at a time:

```
node <skill-dir>/scripts/gate-check.mjs --scope <scope> --log "leaf-1.1.1 verified, 7/7"
```

Appending instead of rewriting is what makes it safe for several leaves to
report at once, and keeps the stable prefix cheap to re-read.
