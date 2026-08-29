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
// exit codes: 0 no strict failures, 1 strict findings, 2 usage or parse error.
//
// Usable as a gate, so a ledger can require its own quality:
//   CHECK: node scripts/gate-lint.mjs GATES.md
//   EXPECT: LINT OK

import { parseGates, readStableRegularFile } from "./lib/gates.mjs";

const HELP = `usage: gate-lint.mjs [--strict] [--json] <ledger.md ...>

Audit gate quality, not gate completion. Report lexical signs of fixed-output
oracles, weak expectations, manual measurements, and titles that name an
activity instead of an outcome. Never executes a CHECK.

exit codes: 0 no strict failures, 1 strict findings, 2 usage or parse error.`;

const KNOWN_OPTIONS = new Set(["--strict", "--json", "--help", "-h"]);
const MAX_GATE_LEDGER_BYTES = 8 * 1024 * 1024;
const MAX_REPORTED_FINDINGS = 64;
const MAX_REPORT_BYTES = 256 * 1024;
const TRUNCATION_MARKER = "...[truncated]";

// Findings and CLI diagnostics can contain repository-controlled filenames,
// gate text, parser messages, or argv. Escape terminal controls at those data
// boundaries instead of rewriting complete output, so help text, structural
// newlines, and JSON indentation retain their intended formatting.
const TERMINAL_CONTROL = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/;
function terminalSafe(value, maxBytes = 1024) {
  const pieces = [];
  const sizes = [];
  let bytes = 0;
  let truncated = false;
  for (const character of String(value)) {
    let piece = character;
    if (TERMINAL_CONTROL.test(character)) {
      const code = character.codePointAt(0);
      const prefix = code <= 0xff ? "\\x" : "\\u";
      const width = code <= 0xff ? 2 : 4;
      piece = prefix + code.toString(16).padStart(width, "0");
    }
    const size = Buffer.byteLength(piece, "utf8");
    if (bytes + size > maxBytes) { truncated = true; break; }
    pieces.push(piece);
    sizes.push(size);
    bytes += size;
  }
  if (!truncated) return pieces.join("");
  const markerBytes = Buffer.byteLength(TRUNCATION_MARKER, "utf8");
  while (pieces.length && bytes + markerBytes > maxBytes) {
    pieces.pop();
    bytes -= sizes.pop();
  }
  return pieces.join("") + TRUNCATION_MARKER;
}

const args = process.argv.slice(2);
if (!args.length) {
  console.error(HELP);
  process.exit(2);
}
// `--` makes every following token a filename, including literal files named
// `--help` and `-h`. Only scan the option prefix for the help flags.
const positionalIndex = args.indexOf("--");
const optionPrefix = positionalIndex === -1 ? args : args.slice(0, positionalIndex);
if (optionPrefix.includes("--help") || optionPrefix.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}
let strict = false;
let asJson = false;
let positional = false;
const files = [];
for (const arg of args) {
  if (!positional && arg === "--") { positional = true; continue; }
  if (!positional && KNOWN_OPTIONS.has(arg)) {
    if (arg === "--strict") strict = true;
    else if (arg === "--json") asJson = true;
    continue;
  }
  if (!positional && arg.startsWith("-")) {
    console.error("gate-lint: unknown option " + terminalSafe(arg, 512));
    console.error("run gate-lint.mjs --help for usage");
    process.exit(2);
  }
  files.push(arg);
}
if (!files.length) {
  console.error("gate-lint: name at least one ledger file");
  process.exit(2);
}

// This is deliberately advisory and whole-command only. Shell text beginning
// with `echo` can still chain a real verifier, and argv containing EXPECT says
// nothing about what the called program prints or whether it exits zero.
const FIXED_OUTPUT_COMMAND = /^\s*(?:(?:echo|printf)(?:\s+[^&|;]*)?|true|:|exit\s+0)\s*$/i;
// Tokens that appear in failure output as readily as in success output.
const WEAK_EXPECT = new Set([
  "ok", "okay", "done", "pass", "passed", "success", "successful", "succeeded",
  "complete", "completed", "finished", "yes", "true", "0", "good", "fine", "working",
]);
// Openings that name an activity rather than an outcome a stranger could judge.
const ACTIVITY_START = /^(work(ing)? on|improve|enhance|handle|support|ensure|make sure|try|attempt|look (at|into)|investigate|consider|review|refactor|clean ?up|polish|update|tidy|address|deal with|add support)\b/i;
const findings = [];
let errorCount = 0;
let warningCount = 0;
let findingCount = 0;
const add = (file, level, gate, rule, message) => {
  findingCount++;
  if (level === "error") errorCount++;
  else if (level === "warn") warningCount++;
  if (findings.length >= MAX_REPORTED_FINDINGS) return;
  findings.push({
    file: terminalSafe(file, 512),
    level: terminalSafe(level, 16),
    gate: gate ? terminalSafe(gate, 128) : null,
    rule: terminalSafe(rule, 64),
    message: terminalSafe(message, 1024),
  });
};

let parseFailed = false;

for (const file of files) {
  let text;
  try {
    // Explicit lint targets may intentionally live outside the current
    // working directory, so constrain file kind and size without a root.
    text = readStableRegularFile(file, {
      maxBytes: MAX_GATE_LEDGER_BYTES,
      label: "gate ledger",
    });
  } catch (error) {
    console.error("gate-lint: cannot read " + terminalSafe(file, 512) + ": " + terminalSafe(error.message, 1024));
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

    if (check && FIXED_OUTPUT_COMMAND.test(check)) {
      add(file, "warn", id, "tautological-check",
        'CHECK looks like a fixed-output command: "' + check + '"; use an oracle that observes the named outcome');
    }

    if (expect && WEAK_EXPECT.has(expect.trim().toLowerCase())) {
      add(file, "warn", id, "weak-expect",
        'EXPECT "' + expect + '" also appears in failure output; match a line only success can print');
    }

    if (gate.expectation && gate.expectation.kind === "regex" && gate.expectation.pathLike) {
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

  if (live.length && runnable.length / live.length < 0.5) {
    add(file, "warn", null, "mostly-manual",
      runnable.length + "/" + live.length + " gates are runnable; a mostly manual ledger is prose with checkboxes");
  }
}

const failed = errorCount > 0 || (strict && warningCount > 0);

if (asJson) {
  const report = {
    ok: !failed,
    errors: errorCount,
    warnings: warningCount,
    findings: [...findings],
    truncated: findingCount > findings.length,
    omittedFindings: findingCount - findings.length,
  };
  let output = JSON.stringify(report, null, 2);
  while (Buffer.byteLength(output, "utf8") > MAX_REPORT_BYTES && report.findings.length) {
    report.findings.pop();
    report.truncated = true;
    report.omittedFindings = findingCount - report.findings.length;
    output = JSON.stringify(report, null, 2);
  }
  console.log(output);
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
  const omitted = findingCount - findings.length;
  if (omitted) console.log("... [report truncated: " + omitted + " finding(s) omitted]");
  if (!failed) {
    console.log(warningCount ? "LINT OK (" + warningCount + " warning(s))" : "LINT OK");
  } else {
    console.log("LINT FINDINGS: " + errorCount + " error(s), " + warningCount + " warning(s)");
  }
}

// Let Node drain stdout before exiting. A forced process.exit() can truncate a
// large report when stdout is an asynchronous POSIX pipe.
process.exitCode = parseFailed ? 2 : failed ? 1 : 0;
