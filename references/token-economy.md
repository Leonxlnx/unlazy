# Token economy

Spend model attention on implementation and judgment. Move repeated, deterministic verification into commands and keep orchestration context narrow.

## Keep enforcement cheap

- **Use runnable checks.** External command execution does not itself require model inference. The agent still spends context on the command, returned output, failure interpretation, and evidence review.
- **Cap evidence.** Store resolved environment facts plus the automatic output fingerprint, never raw successful output or a full build log.
- **Keep the Stop hook scan-only.** The hook itself does not call a model. A block causes another agent continuation, which does consume model work, so keep the six-block no-progress guard and make each block actionable.
- **Use sequential checks by default.** Raise `--jobs` only for independent checks when wall-clock savings justify harder failure diagnosis.

## Keep contexts focused

- Give a leaf the shared contract and its own ledger, not the driver's transcript or unrelated leaf outputs.
- Keep `SKILL.md` limited to the core workflow. Load method, gate, orchestration, and parallel references only when the selected mode needs them.
- Append events to `status.log`. Do not repeatedly regenerate a large plan when one line records the event.
- Keep failure logs local and summarize only non-sensitive decisive facts when a manual report needs them; automatic success evidence already contains a digest and byte count.

## Mark where reasoning matters, then let the router assign the model

Unlazy decides *which* leaves need strong reasoning; it does not choose the model.
Tag these as `Tier: judgment` in the PLAN dispatch table and leave the concrete
model to the host's routing:

- contracts and architecture
- security and compatibility boundaries
- branch integration
- manual high-risk gates
- parent re-verification and final claim audit

Everything else is `Tier: mechanical`, and only after its pattern and acceptance
gates are fixed. Declaring the tier is unlazy's job; binding a tier to a model is
the router's, so do not hard-code a model name in a leaf brief or in this skill.

## Avoid false economy

Do not save time by skipping approval, negative controls, parent re-verification, or integration gates. Those checks exist because a fast false completion costs more than a direct failure.

Do not orchestrate a task that one focused session can implement and verify cleanly. Conversely, do not keep an entire build in one context merely to avoid subagent overhead when independent leaves and contracts are clear.

## Measurement claims

Earlier unlazy documentation gave exact token and effort ratios from a six-run exploratory comparison. The raw prompts, traces, outputs, and scoring records are not present in this repository, so those numbers are not reproducible here. Do not use them as product guarantees. A protocol for a future reproducible rerun is in [../research/validation-protocol.md](../research/validation-protocol.md).
