#!/usr/bin/env node
// gate-lint.mjs : audit whether a ledger is worth passing.
// Zero dependencies. Node 16+.
//
// The checker and the Stop hook decide whether gates were met. Neither asks
// whether the gates were worth meeting. A gate reading "the entire feature
// works perfectly" with `CHECK: echo ok` and `EXPECT: ok` passes the checker,
// the parent re-verification and the hook, because the oracle is real, runs,
// and returns what it promised. Authoring is the one step in the enforcement
// hierarchy that is still pure prose discipline, and this lints it.
//
// This never executes a CHECK. It reads the ledger and judges its oracles.
//
//   node gate-lint.mjs [options] <ledger.md ...>
//     --strict   treat warnings as failures
//     --json     machine-readable findings
//
// exit codes: 0 clean, 1 findings, 2 usage or parse error.
//
// Usable as a gate, so a ledger can require its own quality:
//   CHECK: node scripts/gate-lint.mjs GATES.md
//   EXPECT: LINT OK

import { readFileSync } from "node:fs";
import { parseGates } from "./lib/gates.mjs";

const HELP = `usage: gate-lint.mjs [--strict] [--json] <ledger.md ...>

Audit gate quality, not gate completion. Report oracles that cannot fail,
expectations satisfied by their own command, titles that name an activity
instead of an outcome, and ledgers outside the size band in
references/gates.md. Never executes a CHECK.

exit codes: 0 clean, 1 findings, 2 usage or parse error.`;

const KNOWN_OPTIONS = new Set(["--strict", "--json", "--help", "-h"]);

const args = process.argv.slice(2);
if (!args.length) {
  console.error(HELP);
  process.exit(2);
}
if (args.includes("--help") || args.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}
for (const arg of args) {
  if (arg.startsWith("--") && !KNOWN_OPTIONS.has(arg)) {
    console.error("gate-lint: unknown option " + arg);
    console.error("run gate-lint.mjs --help for usage");
    process.exit(2);
  }
}
const strict = args.includes("--strict");
const asJson = args.includes("--json");
const files = args.filter((a) => !a.startsWith("-"));
if (!files.length) {
  console.error("gate-lint: name at least one ledger file");
  process.exit(2);
}

// An oracle whose output is fixed by its own text observes nothing.
const SELF_DETERMINING = /^\s*(echo|printf|true|:|exit\s+0)\b/;
// Tokens that appear in failure output as readily as in success output.
const WEAK_EXPECT = new Set([
  "ok", "okay", "done", "pass", "passed", "success", "successful", "succeeded",
  "complete", "completed", "finished", "yes", "true", "0", "good", "fine", "working",
]);
// Openings that name an activity rather than an outcome a stranger could judge.
const ACTIVITY_START = /^(work(ing)? on|improve|enhance|handle|support|ensure|make sure|try|attempt|look (at|into)|investigate|consider|review|refactor|clean ?up|polish|update|tidy|address|deal with|add support)\b/i;
// A slash wrapped EXPECT is read as a regular expression. That is correct for
// a pattern and wrong for a literal path, whose dots then match any character.
// An unescaped inner slash is the tell: patterns rarely carry one, paths do.
const PATH_LIKE = /[^\\]\//;

const findings = [];
const add = (file, level, gate, rule, message) =>
  findings.push({ file, level, gate: gate || null, rule, message });

let parseFailed = false;

for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    console.error("gate-lint: cannot read " + file + ": " + error.message);
    process.exit(2);
  }

  const doc = parseGates(text);
  if (doc.errors.length) {
    // A ledger the shared parser rejects cannot be judged on quality.
    parseFailed = true;
    for (const error of doc.errors) add(file, "error", null, "parse", error);
    continue;
  }

  const live = doc.gates.filter((gate) => !doc.abandoned.has(gate.id));
  const runnable = live.filter((gate) => gate.check);

  for (const gate of live) {
    const { id, title, check, expect } = gate;

    if (check && SELF_DETERMINING.test(check)) {
      add(file, "error", id, "tautological-check",
        'CHECK cannot fail: "' + check + '" produces its output regardless of the system');
    }

    // "CHECK: node build.mjs --banner DONE" with "EXPECT: DONE" passes because
    // the command prints the expectation, not because the outcome holds.
    if (check && expect) {
      const literal = gate.expectation && gate.expectation.kind === "text"
        ? expect
        : gate.expectation && gate.expectation.source;
      if (literal && literal.length >= 2 && check.includes(literal)) {
        add(file, "error", id, "expect-echoes-check",
          'EXPECT "' + literal + '" appears verbatim in its own CHECK, so the command guarantees its own pass');
      }
    }

    if (expect && WEAK_EXPECT.has(expect.trim().toLowerCase())) {
      add(file, "warn", id, "weak-expect",
        'EXPECT "' + expect + '" also appears in failure output; match a line only success can print');
    }

    if (gate.expectation && gate.expectation.kind === "regex" && PATH_LIKE.test(gate.expectation.source)) {
      add(file, "warn", id, "path-read-as-regex",
        'EXPECT "' + expect + '" looks like a literal path but is read as a regular expression, so its dots are wildcards');
    }

    if (!check) {
      add(file, "warn", id, "manual-gate",
        "no CHECK, so this outcome is judged by hand and its evidence is only as good as the reader");
      if (/\d/.test(title)) {
        add(file, "warn", id, "unmeasured-number",
          'title states a number that nothing measures: "' + title + '"');
      }
    }

    if (ACTIVITY_START.test(title)) {
      add(file, "warn", id, "activity-not-outcome",
        'names an activity, not an outcome a stranger could judge: "' + title + '"');
    }
  }

  // references/gates.md: five to twelve gates per leaf is the useful range.
  if (live.length && live.length < 5) {
    add(file, "warn", null, "thin-ledger",
      live.length + " live gates, under five, which usually means the leaf is under-specified");
  }
  if (live.length > 12) {
    add(file, "warn", null, "fat-ledger",
      live.length + " live gates, over twelve, which usually means this should have been two leaves");
  }
  if (live.length && runnable.length / live.length < 0.5) {
    add(file, "warn", null, "mostly-manual",
      runnable.length + "/" + live.length + " gates are runnable; a mostly manual ledger is prose with checkboxes");
  }
}

const errors = findings.filter((f) => f.level === "error");
const warnings = findings.filter((f) => f.level === "warn");
const failed = errors.length > 0 || (strict && warnings.length > 0);

if (asJson) {
  console.log(JSON.stringify({
    ok: !failed,
    errors: errors.length,
    warnings: warnings.length,
    findings,
  }, null, 2));
} else {
  let lastFile = null;
  for (const finding of findings) {
    if (finding.file !== lastFile) {
      console.log(finding.file);
      lastFile = finding.file;
    }
    const label = finding.level === "error" ? "ERROR" : "WARN ";
    const who = finding.gate ? finding.gate + ": " : "";
    console.log("  " + label + " " + who + finding.message + "  [" + finding.rule + "]");
  }
  console.log(findings.length
    ? "LINT FINDINGS: " + errors.length + " error(s), " + warnings.length + " warning(s)"
    : "LINT OK");
}

process.exit(parseFailed ? 2 : failed ? 1 : 0);
