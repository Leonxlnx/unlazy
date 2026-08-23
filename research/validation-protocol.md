# Validation protocol and historical limitations

## Status of the historical six-run comparison

The v2 design was informed by a maintainer-run exploratory comparison described in earlier README versions:

- two build tasks
- three conditions per task: no skill, tree 3, and tree 6
- one fresh folder and session per condition
- independent review, adversarial verification, and browser testing

Earlier documentation reported output-token ratios, self-found defect counts, one live failure, and report-number errors. This repository does not contain the exact prompts, model and harness versions, transcripts, token logs, output repositories, reviewer forms, browser recordings, or calculation code for those six runs. The reported numbers therefore cannot be independently reproduced or audited from source.

Treat the historical comparison as design provenance only. It is too small for broad model claims and must not be described as proof that unlazy causes a specific improvement or cost multiplier.

## Minimum protocol for a reproducible rerun

### 1. Pre-register the comparison

Record before execution:

- exact unlazy commit and condition definitions
- task prompts and any shared input assets
- agent product, model id, model snapshot if exposed, reasoning setting, and permissions
- operating system, runtime versions, browser, package manager, and network policy
- timeout, retry, and failure-handling rules
- metrics, scoring rubric, reviewer instructions, and exclusion criteria
- randomization order and the planned number of independent repetitions

Use more than one run per task and condition. A single run in each cell cannot distinguish the condition from run-to-run variation.

### 2. Isolate each run

Use a fresh session and fresh working copy for every run. Give each condition the same task body, tool access, time limits, and environment except for the intervention being tested. Do not let artifacts or reviewer notes from one run become visible to another.

Archive:

- the exact initial prompt and every follow-up
- full agent and tool transcript
- starting and ending repository commits
- dependency manifests and lockfiles
- test, lint, build, and browser logs
- screenshots or recordings required by the rubric
- token and timing data as exported by the harness

Redact credentials without altering outcome-relevant content. Publish checksums for every archived artifact.

### 3. Define metrics operationally

Avoid labels such as "effort" unless tied to a measured proxy. Define each metric so another reviewer can calculate it from the archive.

Suggested measures:

- requested acceptance outcomes met before the final answer
- placeholder or deferred-work occurrences under a fixed search rule
- test, build, console, and browser failures
- defects found and fixed before delivery, with duplicate-defect rules
- false completion claims in the final report
- incorrect numeric claims, compared with a scripted measurement
- input, cached-input, and output tokens as reported by the same harness
- elapsed wall-clock time, including retries

Keep checkpoint success distinct from end-to-end task completion.

### 4. Blind and duplicate review

Remove condition labels from review artifacts where possible. Use at least two independent reviewers for subjective criteria. Record disagreements and a resolution rule. Do not tell reviewers the expected direction of the result.

Run objective checks from scripts pinned in the archive. For a negative assertion, include a known positive control that proves the assertion can fail.

### 5. Publish calculations

Provide a machine-readable row per run and a script that regenerates every table and chart. Report raw counts alongside ratios, uncertainty, exclusions, and missing data. Keep exploratory findings separate from pre-registered outcomes.

### 6. Bound the conclusion

Describe results for the tested models, snapshots, tasks, and environments. Do not generalize a small coding comparison to all agents or all substantial work. Record failures and null results as carefully as improvements.

## Repository-level validation

The current implementation has a separate deterministic test suite for parser, checker, lease, hook, installer, and portability behavior. Run it with the repository's documented test command. Those software tests validate implementation behavior; they do not validate broad claims about model psychology or task productivity.
