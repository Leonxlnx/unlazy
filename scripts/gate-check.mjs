#!/usr/bin/env node
// gate-check.mjs : run the CHECK commands in gate files, flip boxes, record evidence.
// Zero dependencies. Node 16+. Part of the unlazy skill (v2).
//
// Usage:
//   node gate-check.mjs [file ...]          run unmet gates' checks, update files
//   node gate-check.mjs --status [file ...] report only, change nothing
//   node gate-check.mjs --reverify [...]    re-run every CHECK command, including
//                                           gates already marked met; uncheck any
//                                           whose evidence does not reproduce
//   node gate-check.mjs --timeout 60 ...    per-check timeout in seconds (default 120)
//
// Files default to GATES.md plus gates/*.md in the current directory.
// Exit codes: 0 = all gates met (or honestly abandoned), 1 = unmet gates remain,
//             2 = usage or parse error.

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const USAGE = `usage: gate-check.mjs [--status | --reverify] [--timeout <seconds>] [file ...]
  --status     report only, change nothing
  --reverify   re-run every CHECK command, including gates already marked met;
               uncheck any whose evidence does not reproduce
  --timeout N  per-check timeout in seconds (default 120, must be > 0)
Files default to GATES.md plus gates/*.md in the current directory.`;

const args = process.argv.slice(2);
const statusOnly = args.includes("--status");
const reverify = args.includes("--reverify");

function usageError(message) {
  console.error(`gate-check: ${message}`);
  console.error(USAGE);
  process.exit(2);
}

if (statusOnly && reverify) usageError("--status and --reverify are mutually exclusive");

const KNOWN_FLAGS = new Set(["--status", "--reverify", "--timeout"]);
const unknownFlag = args.find(a => a.startsWith("--") && !KNOWN_FLAGS.has(a));
if (unknownFlag) usageError(`unknown flag ${unknownFlag}`);

let timeoutSec = 120;
for (let i = 0; i < args.length; i++) {
  if (args[i] !== "--timeout") continue;
  const raw = args[i + 1];
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    usageError(`--timeout needs a positive number of seconds, got ${raw === undefined ? "nothing" : JSON.stringify(raw)}`);
  }
  timeoutSec = n; // last occurrence wins
}

// Every value directly following a --timeout occurrence belongs to that flag,
// never to the file list.
const timeoutValueIdx = new Set();
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--timeout") timeoutValueIdx.add(i + 1);
}
const fileArgs = args.filter((a, i) => !a.startsWith("--") && !timeoutValueIdx.has(i));

function defaultFiles(dir) {
  const found = [];
  const top = join(dir, "GATES.md");
  if (existsSync(top)) found.push(top);
  const gdir = join(dir, "gates");
  if (existsSync(gdir)) {
    for (const f of readdirSync(gdir).sort()) {
      if (f.endsWith(".md")) found.push(join(gdir, f));
    }
  }
  return found;
}

const files = fileArgs.length ? fileArgs : defaultFiles(process.cwd());
if (!files.length) {
  console.error("gate-check: no gate files found (GATES.md or gates/*.md)");
  process.exit(2);
}

const GATE_RE = /^- \[( |x|X)\] (.*)$/;
const ATTR_RE = /^\s+(CHECK|EXPECT|EVIDENCE):\s?(.*)$/;
const ABANDON_RE = /^ABANDON:\s*(\S+)\s*(.*)$/;
const FENCE_RE = /^\s*```/;

function parse(lines) {
  const gates = [];
  const abandoned = new Map(); // id -> reason
  const warnings = [];
  let cur = null;
  let inFence = false;
  lines.forEach((line, i) => {
    if (FENCE_RE.test(line)) { inFence = !inFence; return; }
    if (inFence) return;
    const g = line.match(GATE_RE);
    if (g) {
      // Fallback id matches stop-hook.mjs (first 24 chars of the title when no
      // "ID:" prefix exists) so an ABANDON line resolves the same way in both.
      const id = (g[2].match(/^(\S+?):/) || [null, g[2].trim().slice(0, 24)])[1];
      cur = {
        line: i, checked: g[1].toLowerCase() === "x",
        title: g[2].trim().replace(/^\S+?:\s*/, ""),
        id,
        check: null, expect: null, evidence: null, evidenceLine: -1,
      };
      gates.push(cur);
      return;
    }
    if (/^(CHECK|EXPECT|EVIDENCE):/.test(line)) {
      warnings.push(`line ${i + 1}: unindented ${line.split(":")[0]} is ignored; indent attribute lines with spaces`);
    }
    const a = cur && line.match(ATTR_RE);
    if (a) {
      const key = a[1].toLowerCase();
      cur[key] = a[2].trim();
      if (key === "evidence") cur.evidenceLine = i;
      return;
    }
    const ab = line.match(ABANDON_RE);
    if (ab) abandoned.set(ab[1].replace(/:$/, ""), ab[2] || "(no reason)");
    if (/^#|^- /.test(line) && !g) cur = null;
  });
  return { gates, abandoned, warnings };
}

function expectMatches(expect, output) {
  const rx = expect.match(/^\/(.+)\/([a-z]*)$/);
  if (rx) {
    try { return new RegExp(rx[1], rx[2]).test(output); } catch { return false; }
  }
  return output.includes(expect);
}

function tail(output, max = 200) {
  const lines = output.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const last = lines.slice(-2).join(" | ");
  return (last || "(no output)").slice(0, max);
}

let totalUnmet = 0;
let totalMet = 0;
let totalAbandoned = 0;
let totalReverified = 0;

for (const file of files) {
  let text;
  try { text = readFileSync(file, "utf8"); } catch (e) {
    console.error(`gate-check: cannot read ${file}: ${e.message}`);
    process.exit(2);
  }
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const { gates, abandoned, warnings } = parse(lines);
  for (const w of warnings) console.error(`gate-check: ${file}: ${w}`);
  if (!gates.length) {
    console.log(`${file}: no gates found`);
    continue;
  }
  let changed = false;

  for (const gate of gates) {
    const isAbandoned = abandoned.has(gate.id);
    const pendingEvidence = !gate.evidence || /^pending$/i.test(gate.evidence);
    if (isAbandoned) { totalAbandoned++; continue; }

    const wasMet = gate.checked && !pendingEvidence;
    // Run checks for gates that are unchecked, checked but missing evidence,
    // or (with --reverify) already met: a parent must not trust self-reports.
    const needsRun = !statusOnly && gate.check && (!gate.checked || pendingEvidence || reverify);
    if (needsRun) {
      if (reverify && wasMet) totalReverified++;
      const res = spawnSync(gate.check, {
        shell: true, encoding: "utf8", timeout: timeoutSec * 1000,
        maxBuffer: 8 * 1024 * 1024,
      });
      const output = `${res.stdout || ""}\n${res.stderr || ""}`;
      // With an EXPECT, the match decides (a check may exit non-zero by design);
      // without one, the exit code decides.
      const ok = gate.expect ? expectMatches(gate.expect, output) : res.status === 0;
      if (ok) {
        lines[gate.line] = lines[gate.line].replace(/^- \[ \]/, "- [x]");
        if (gate.evidenceLine !== -1) {
          const indent = lines[gate.evidenceLine].match(/^\s*/)[0];
          lines[gate.evidenceLine] = `${indent}EVIDENCE: ${tail(output)}`;
        } else {
          // A runnable gate with no EVIDENCE line has nowhere to record its
          // proof; insert one after its attribute block and keep the line
          // indices of later gates valid.
          let insertAt = gate.line + 1;
          while (insertAt < lines.length && ATTR_RE.test(lines[insertAt])) insertAt++;
          lines.splice(insertAt, 0, `  EVIDENCE: ${tail(output)}`);
          for (const g2 of gates) {
            if (g2 === gate) continue;
            if (g2.line >= insertAt) g2.line++;
            if (g2.evidenceLine >= insertAt) g2.evidenceLine++;
          }
          gate.evidenceLine = insertAt;
        }
        gate.checked = true;
        gate.evidence = tail(output);
        changed = true;
        console.log(`  PASS ${gate.id}: ${gate.title}`);
      } else {
        const why = res.error ? res.error.message : tail(output);
        if (reverify && wasMet) {
          // The recorded evidence does not reproduce: demote the gate back to
          // unmet. EVIDENCE must read exactly "pending"; both parsers treat
          // any other value as present evidence.
          lines[gate.line] = lines[gate.line].replace(/^- \[[xX]\]/, "- [ ]");
          if (gate.evidenceLine !== -1) {
            const indent = lines[gate.evidenceLine].match(/^\s*/)[0];
            lines[gate.evidenceLine] = `${indent}EVIDENCE: pending`;
          }
          gate.checked = false;
          gate.evidence = "pending";
          changed = true;
          console.log(`  FAIL ${gate.id}: ${gate.title} (reverify: previously marked met)\n       ${why}`);
        } else {
          console.log(`  FAIL ${gate.id}: ${gate.title}\n       ${why}`);
        }
      }
    }

    const evidenceNow = gate.evidence && !/^pending$/i.test(gate.evidence);
    if (gate.checked && evidenceNow) totalMet++;
    else {
      totalUnmet++;
      if (statusOnly) {
        const why = !gate.checked ? "unchecked" : "checked but EVIDENCE pending";
        console.log(`  UNMET ${gate.id} (${why}): ${gate.title}`);
      }
    }
  }

  if (changed) {
    try { writeFileSync(file, lines.join(eol)); } catch (e) {
      console.error(`gate-check: cannot write ${file}: ${e.message}`);
      process.exit(2);
    }
  }
  console.log(`${file}: ${gates.length} gates`);
}

const reverifiedNote = totalReverified ? `, reverified: ${totalReverified}` : "";
if (totalUnmet === 0) {
  console.log(`ALL MET (${totalMet} met${totalAbandoned ? `, ${totalAbandoned} abandoned` : ""}${reverifiedNote})`);
  process.exit(0);
} else {
  console.log(`UNMET: ${totalUnmet} (met: ${totalMet}${totalAbandoned ? `, abandoned: ${totalAbandoned}` : ""}${reverifiedNote})`);
  process.exit(1);
}
