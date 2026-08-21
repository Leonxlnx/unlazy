#!/usr/bin/env node
// gate-check.mjs : run the CHECK commands in gate files, flip boxes, record evidence.
// Zero dependencies. Node 16+. Part of the unlazy skill (v2).
//
// Usage:
//   node gate-check.mjs [file ...]          run unmet gates' checks, update files
//   node gate-check.mjs --status [file ...] report only, change nothing
//   node gate-check.mjs --timeout 60 ...    per-check timeout in seconds (default 120)
//   node gate-check.mjs --jobs 4 ...        max concurrent checks (default 1 = sequential)
//
// Files default to GATES.md plus gates/*.md in the current directory. For
// orchestrated mode, pass explicit leaf files so only that leaf is checked.
// Exit codes: 0 = all gates met (or honestly abandoned), 1 = unmet gates remain,
//             2 = usage or parse error.

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";

const args = process.argv.slice(2);
const statusOnly = args.includes("--status");
let timeoutSec = 120;
const tIdx = args.indexOf("--timeout");
if (tIdx !== -1) timeoutSec = Number(args[tIdx + 1]) || 120;
let jobs = 1;
const jIdx = args.indexOf("--jobs");
if (jIdx !== -1) {
  const n = Number(args[jIdx + 1]);
  if (Number.isInteger(n) && n >= 1) jobs = n;
  else { console.error("gate-check: --jobs requires a positive integer"); process.exit(2); }
}
// File args are positional args that are not the value following --timeout/--jobs.
const skipValueIdx = new Set([tIdx + 1, jIdx + 1].filter(i => i >= 0 && i < args.length));
const fileArgs = args.filter((a, i) => !a.startsWith("--") && i !== tIdx && i !== jIdx && !skipValueIdx.has(i));

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
        file: null,
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

// ---------------------------------------------------------------------------
// Async execution with a concurrency limiter. Replaces the old synchronous
// spawnSync loop: checks now run concurrently up to --jobs at a time, which
// turns a wall-clock-long sequential verify into a fast parallel one. Output
// is buffered per-process and resolved via Promise.all.
// ---------------------------------------------------------------------------

function runCheck(cmd, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(cmd, { shell: true, encoding: "utf8" });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      if (!settled) {
        settled = true;
        resolve({ stdout, stderr, status: null, error: { message: "timeout" } });
      }
    }, timeoutMs);

    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (err) => {
      clearTimeout(timer);
      if (!settled) { settled = true; resolve({ stdout, stderr, status: null, error: err }); }
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      if (!settled) { settled = true; resolve({ stdout, stderr, status, error: null }); }
    });
    child.on("exit", (status) => {
      clearTimeout(timer);
      if (!settled) { settled = true; resolve({ stdout, stderr, status, error: null }); }
    });
  });
}

async function runAll(pendingChecks, jobs) {
  // Sliding-window concurrency: launch up to `jobs` simultaneously.
  const results = new Array(pendingChecks.length);
  let next = 0;
  async function worker() {
    while (true) {
      const myIdx = next++;
      if (myIdx >= pendingChecks.length) return;
      results[myIdx] = await runCheck(pendingChecks[myIdx].gate.check, timeoutSec * 1000);
    }
  }
  const workers = [];
  const n = Math.min(jobs, pendingChecks.length || 1);
  for (let i = 0; i < n; i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Main: gather gate files, parse, build the list of gates needing a check,
// run checks concurrently, then apply results (flip boxes, write evidence),
// and tally.
// ---------------------------------------------------------------------------

let totalUnmet = 0;
let totalMet = 0;
let totalAbandoned = 0;

// Load and parse every file first.
const fileData = [];
for (const file of files) {
  let text;
  try { text = readFileSync(file, "utf8"); } catch (e) {
    console.error(`gate-check: cannot read ${file}: ${e.message}`);
    process.exit(2);
  }
  const lines = text.split(/\r?\n/);
  const { gates, abandoned } = parse(lines);
  for (const g of gates) g.file = file;
  fileData.push({ file, lines, gates, abandoned });
  if (!gates.length) console.log(`${file}: no gates found`);
}

// Collect every gate that actually needs a monitor run across all files,
// preserving order so the results array lines up.
const pendingChecks = [];
for (const fd of fileData) {
  for (const gate of fd.gates) {
    const isAbandoned = fd.abandoned.has(gate.id);
    const pendingEvidence = !gate.evidence || /^pending$/i.test(gate.evidence);
    if (isAbandoned) continue; // abandoned gates resolved below
    const needsRun = !statusOnly && gate.check && (!gate.checked || pendingEvidence);
    if (needsRun) pendingChecks.push({ gate });
  }
}

// Run them concurrently (or sequentially when jobs=1).
const checkResults = await runAll(pendingChecks, jobs);
let resultPtr = 0;

for (const fd of fileData) {
  let changed = false;

  for (const gate of fd.gates) {
    const isAbandoned = fd.abandoned.has(gate.id);
    if (isAbandoned) { totalAbandoned++; continue; }

    const pendingEvidence = !gate.evidence || /^pending$/i.test(gate.evidence);
    const needsRun = !statusOnly && gate.check && (!gate.checked || pendingEvidence);

    if (needsRun) {
      const res = checkResults[resultPtr++];
      const output = `${res.stdout || ""}\n${res.stderr || ""}`;
      // With an EXPECT, the match decides (a check may exit non-zero by design);
      // without one, the exit code decides.
      const ok = gate.expect ? expectMatches(gate.expect, output) : res.status === 0;
      if (ok) {
        fd.lines[gate.line] = fd.lines[gate.line].replace(/^- \[ \]/, "- [x]");
        if (gate.evidenceLine !== -1) {
          const indent = fd.lines[gate.evidenceLine].match(/^\s*/)[0];
          fd.lines[gate.evidenceLine] = `${indent}EVIDENCE: ${tail(output)}`;
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

  if (changed) writeFileSync(fd.file, fd.lines.join("\n"));
  console.log(`${fd.file}: ${fd.gates.length} gates`);
}

if (totalUnmet === 0) {
  console.log(`ALL MET (${totalMet} met${totalAbandoned ? `, ${totalAbandoned} abandoned` : ""})`);
  process.exit(0);
} else {
  console.log(`UNMET: ${totalUnmet} (met: ${totalMet}${totalAbandoned ? `, abandoned: ${totalAbandoned}` : ""})`);
  process.exit(1);
}
