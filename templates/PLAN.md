# Plan: <task>

Depth: tree <N>   Mode: orchestrated
Budget note: <what a competent single pass would take; context, not arithmetic>

## Contract

Decided BEFORE fan-out. Everything a leaf could get wrong about its neighbors:

- Interfaces: <function signatures, file formats, API shapes>
- Data ownership: <which leaf owns which files; no two leaves share a file>
- Naming and conventions: <casing, folder layout, error handling style>

## Tree

- 1 <task>
  - 1.1 <branch> .......... gates/node-1.1.md
    - 1.1.1 <leaf> ........ gates/leaf-1.1.1.md
    - 1.1.2 <leaf> ........ gates/leaf-1.1.2.md
  - 1.2 <branch> .......... gates/node-1.2.md
    - 1.2.1 <leaf> ........ gates/leaf-1.2.1.md
    - 1.2.2 <leaf> ........ gates/leaf-1.2.2.md

## Status log

Append-only. One line per event: leaf started, leaf verified, gate abandoned.
Never rewrite lines above; appending keeps the file cheap to re-read and diff.

- <timestamp or step> plan written, contract fixed
