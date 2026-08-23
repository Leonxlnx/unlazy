# Contributing

Thanks for improving unlazy. Keep changes focused, testable, portable, and honest about their evidence.

## Welcome changes

- parser, checker, hook, installer, concurrency, and portability fixes
- sharper gate-authoring or orchestration guidance
- regression tests for reported behavior
- recent research that directly supports a narrowly worded claim
- compatibility fixes for agents that consume `SKILL.md`

## Ground rules

1. **Keep enforcement structural.** Completion is decided by valid ledgers, current evidence, parent re-verification, and integration checks.
2. **Treat the format as one contract.** A ledger-format change must update the shared parser, checker, hook, templates, references, and tests together.
3. **Fail closed on malformed completion state.** Invalid input must not become `ALL MET` or a silent Stop-hook allow unless the documented security boundary requires a diagnostic allow.
4. **Treat `CHECK:` as code.** Preserve explicit approval, approval invalidation, and non-executing status behavior. Do not weaken the trust boundary for convenience.
5. **Keep Node 16 compatibility and zero runtime dependencies.** Use Node standard-library APIs available on the supported floor. Test Windows, macOS, and Linux behavior when changing shell, path, newline, file-lock, or installer code.
6. **Make claims exact.** Use primary research or official platform documentation when available. Distinguish a checkpoint metric from end-to-end success, an overall fit from a subset fit, and exploratory observations from reproducible results.
7. **Keep skill metadata valid.** `SKILL.md` frontmatter contains only `name` and a trigger-rich third-person `description`. Keep `agents/openai.yaml` aligned and do not add icon paths without real assets.
8. **Use imperative skill prose and progressive disclosure.** Keep core workflow in `SKILL.md`; put detailed contracts in directly linked references.
9. **Use no em dash or en dash.** Use a hyphen, colon, or sentence break.
10. **Preserve unrelated user configuration.** Installer changes must validate container shapes, update atomically, and remove only unlazy's own handlers.

## Tests

Install no dependencies. Run:

```text
npm test
```

For script changes, add a regression that fails before the fix. Cover the relevant adversarial boundaries, including:

- explicit one-file and multi-file targeting in different option orders
- status versus re-verification and changed-oracle invalidation
- zero gates, duplicates, incomplete attributes, fences, indentation, CRLF, and abandonment reasons
- exit `0` plus `EXPECT:`, timeouts, missing commands, output limits, and evidence insertion
- approval storage outside the repository and binding for ledger, gate, command, expectation, working directory, shell, timeout, limits, platform, and `PATH`
- platform shell defaults, explicit shell override, inherited PATH, and paths containing spaces
- sequential default and deterministic bounded `--jobs`
- simultaneous conflicting lease claims, conservative glob overlap, unsafe paths, unknown leaves, and release
- concurrent gate updates and concurrent session-keyed hook state
- Stop-hook block, progress reset, six-block release, all-met cleanup, ambiguity, and session routing
- installer install, idempotence, moved paths, target-shape refusal, unrelated-handler preservation, and uninstall

Run syntax checks and the skill validator as part of final verification. Keep tests deterministic and isolated from real user settings.

## Documentation changes

For a behavioral claim, link the exact source and state only what it supports. Keep the README source list ordered by the latest public version or publication date. If a source has no date, label it instead of guessing.

Do not add new benchmark ratios without the artifacts and calculation script needed to reproduce them. Follow [research/validation-protocol.md](research/validation-protocol.md).

## Security reports

Read [SECURITY.md](SECURITY.md). Do not publish credentials or a sensitive proof of concept in a public issue.

## Pull requests

Explain the failure, the contract after the change, and the exact regression evidence. Keep unrelated refactors out of the patch. Update `CHANGELOG.md` under the unreleased target when user-visible behavior changes.
