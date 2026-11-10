# Claude Fable 5.2: long tasks

Read this reference when tuning unlazy for Fable 5.2. Keep the core gate and approval contracts unchanged. This is an integration recipe, not a measured performance claim. Official guidance was checked on 2026-11-10.

## Choose effort through the host

Anthropic recommends `medium` for interactive work and `high` for difficult, long agentic tasks. Test `xhigh` only where it improves your outcomes. Fable 5.1 effort settings need fresh evaluation; prompting 5.2 to think less is not a reliable substitute for the effort control. See [the official prompting guide](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-2#calibrate-effort).

Apply these settings only through a documented control exposed by the actual host. A skill cannot switch models or effort by declaring them in prose. Record the observed setting or `unavailable`; do not report an intended setting as selected. Start a fresh session for changed configuration when required by the host.

## Keep work moving within its scope

Fable 5.2 can stop early on long tasks, especially at lower effort. Its delegation can also grow with the surrounding instructions. Review old blanket delegation and caution rules before adding more. See [the prompting guide](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-2#finish-the-whole-task).

Use the ledger to choose the next unmet outcome. Diagnose an ordinary error, retry an authorized read when safe, or continue independent work while a dependency waits. A timeout after a remote mutation needs a state check before any retry. Preserve unlazy's inspected approval for runnable checks; a reviewer note cannot grant it. Keep external publication and other consequential actions within the user's actual authorization.

Delegate only a bounded deliverable that benefits from isolation, parallel work, or independent judgment. Honor the configured concurrency limit. Brief the worker with its ownership, inputs, acceptance outcome, and return artifact. Keep verification with the parent; more workers are not evidence of completion.

## Resume from evidence

Before an interruption, record the objective and later amendments, repository and branch, HEAD, uncommitted paths, gate locations, observed checks, unresolved dependencies, approvals and their scope, live worker handles, and the next action. Use an existing handoff rather than creating a second ledger. Record observable facts, not private reasoning.

On return, compare the handoff with the live working tree and current request. Inspect changed paths first. A handoff that names an earlier HEAD is a lead, not current proof. Reverify affected outcomes and preserve someone else's uncommitted work. Continue authorized independent outcomes while a required review remains pending. Do not mark the task complete merely because the session ended.

## Keep API history valid

For harness authors, Fable 5.2 enforces the preserved-thinking prefix check on all accounts. Keep earlier messages, system configuration, tools, and thinking blocks intact; use supported context editing or compaction when shortening history. A Markdown handoff is not a way to repair incompatible API history. See [the migration guide](https://platform.claude.com/docs/en/models/fable-5-2/migration-guide).

## Evaluate the adaptation

Use [the focused scenarios](../research/fable-5-2-eval.md) before claiming improvement. Track acceptance outcomes, false completion, unnecessary approvals, delegation, elapsed time, and measured usage. Compare one instruction change at a time. A document review or a different model's simulation is not a Fable 5.2 benchmark.
