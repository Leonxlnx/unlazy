#!/usr/bin/env node
// gate-check.mjs : run the CHECK commands in gate files, flip boxes, record evidence.
// Zero dependencies. Node 16+. Part of the unlazy skill (v2).
//
// Usage:
//   node gate-check.mjs [file ...]          run unmet gates' checks, update files
//   node gate-check.mjs --status [file ...] report only, change nothing
//   node gate-check.mjs --timeout 60 ...    per-check timeout in seconds (default 120)
//
// Files default to GATES.md plus gates/*.md in the current directory.
// Exit codes: 0 = all gates met (or honestly abandoned), 1 = unmet gates remain,
//             2 = usage or parse error.

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const args = process.argv.slice(2);
const statusOnly = args.includes("--status");
let timeoutSec = 120;
const tIdx = args.indexOf("--timeout");
if (tIdx !== -1) timeoutSec = Number(args[tIdx + 1]) || 120;
const fileArgs = args.filter((a, i) => !a.startsWith("--") && i !== tIdx + 1);

function defaultFiles(dir) {
  const found = [];
  const top = join(dir, "GATES.md");
  if (existsSync(top)) found.push(top);
  const gdir = join(dir, "gates");
  if (existsSync(gdir)) {
    for (const f of readdirSync(gdir)) {
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

function parse(lines) {
  const gates = [];
  const abandoned = new Map(); // id -> reason
  let cur = null;
  lines.forEach((line, i) => {
    const g = line.match(GATE_RE);
    if (g) {
      const id = (g[2].match(/^(\S+?):/) || [null, `line${i + 1}`])[1];
      cur = {
        line: i, checked: g[1].toLowerCase() === "x",
        title: g[2].trim().replace(/^\S+?:\s*/, ""),
        id,
        check: null, expect: null, evidence: null, evidenceLine: -1,
      };
      gates.push(cur);
      return;
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
  return { gates, abandoned };
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

for (const file of files) {
  let text;
  try { text = readFileSync(file, "utf8"); } catch (e) {
    console.error(`gate-check: cannot read ${file}: ${e.message}`);
    process.exit(2);
  }
  const lines = text.split(/\r?\n/);
  const { gates, abandoned } = parse(lines);
  if (!gates.length) {
    console.log(`${file}: no gates found`);
    continue;
  }
  let changed = false;

  for (const gate of gates) {
    const isAbandoned = abandoned.has(gate.id);
    const pendingEvidence = !gate.evidence || /^pending$/i.test(gate.evidence);

    if (isAbandoned) { totalAbandoned++; continue; }

    // Run checks for gates that are unchecked, or checked but missing evidence.
    const needsRun = !statusOnly && gate.check && (!gate.checked || pendingEvidence);
    if (needsRun) {
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
        }
        gate.checked = true;
        gate.evidence = tail(output);
        changed = true;
        console.log(`  PASS ${gate.id}: ${gate.title}`);
      } else {
        const why = res.error ? res.error.message : tail(output);
        console.log(`  FAIL ${gate.id}: ${gate.title}\n       ${why}`);
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

  if (changed) writeFileSync(file, lines.join("\n"));
  console.log(`${file}: ${gates.length} gates`);
}

if (totalUnmet === 0) {
  console.log(`ALL MET (${totalMet} met${totalAbandoned ? `, ${totalAbandoned} abandoned` : ""})`);
  process.exit(0);
} else {
  console.log(`UNMET: ${totalUnmet} (met: ${totalMet}${totalAbandoned ? `, abandoned: ${totalAbandoned}` : ""})`);
  process.exit(1);
}
