#!/usr/bin/env node
// gate-check.mjs : run the CHECK commands in gate files, flip boxes, record
// evidence. Part of the unlazy skill (v2.1, multi-pipeline).
//
// Zero dependencies. Node 18+.
//
// Usage:
//   gate-check.mjs [options] [file ...]
//
// Actions (default: run the unmet gates' checks and update the files):
//   --status              report only, change nothing
//   --claim               take ownership leases from OWNS: headers
//   --release             drop this scope's (or this leaf's) leases
//   --log "<line>"        append one line to the scope status log
//   --bind <session-id>   bind a Claude Code session to this scope, so the
//                         Stop hook guards this pipeline and no other
//   --list-scopes         list the pipelines present under .unlazy/
//
// Targeting:
//   --scope <id>          the pipeline under .unlazy/<id>/ (or UNLAZY_SCOPE)
//   --leaf <name>         which gate file the --claim/--release applies to
//   [file ...]            explicit gate files; overrides scope discovery
//
// Options:
//   --timeout S           per-check timeout in seconds (default 120)
//   --cwd DIR             default working directory for CHECK commands
//   --root DIR            where .unlazy/ lives (default process cwd)
//
// With no explicit files and no scope, a single pipeline is used automatically;
// several pipelines is an error rather than a guess, because running every
// pipeline's checks at once is how leaves end up certifying each other.
//
// Exit codes: 0 = all gates met (or honestly abandoned), 1 = unmet gates
//             remain, 2 = usage or parse error, 3 = lease conflict.

import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { exec } from "node:child_process";
import { basename, resolve, join, dirname } from "node:path";
import {
  parseGates, qualify, gateState, expectMatches, tail,
  resolveTarget, listScopes, appendStatus, withFileLock, writeAtomic,
  claimLeases, releaseLeases, scopeRoot, UNLAZY_DIR,
} from "./lib/gates.mjs";

// ------------------------------------------------------------------- args

// A real parser. The previous index-arithmetic filter silently dropped the
// first file argument whenever --timeout was absent, which made a scoped call
// fall back to "every gate file in the tree" and report ALL MET for work it
// had never looked at.
const FLAGS = new Set(["--status", "--claim", "--release", "--list-scopes", "--help", "-h"]);
const VALUED = new Set(["--scope", "--leaf", "--timeout", "--cwd", "--root", "--log", "--bind"]);

function parseArgs(argv) {
  const opt = {};
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (FLAGS.has(a)) { opt[a.replace(/^-+/, "")] = true; continue; }
    if (VALUED.has(a)) {
      const v = argv[++i];
      if (v === undefined) return { error: a + " needs a value" };
      opt[a.replace(/^-+/, "")] = v;
      continue;
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        const k = a.slice(0, eq), v = a.slice(eq + 1);
        if (VALUED.has(k)) { opt[k.replace(/^-+/, "")] = v; continue; }
      }
      return { error: "unknown option " + a };
    }
    files.push(a);
  }
  return { opt, files };
}

const parsed = parseArgs(process.argv.slice(2));
if (parsed.error) {
  console.error("gate-check: " + parsed.error);
  process.exit(2);
}
const { opt, files: fileArgs } = parsed;

if (opt.help || opt.h) {
  console.log(readFileSync(new URL(import.meta.url)).toString()
    .split(/\r?\n/).filter(l => l.startsWith("//")).map(l => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(0);
}

const root = resolve(opt.root || process.cwd());
const timeoutSec = Number(opt.timeout) > 0 ? Number(opt.timeout) : 120;
const defaultCwd = opt.cwd ? resolve(root, opt.cwd) : root;

if (opt["list-scopes"]) {
  const s = listScopes(root);
  console.log(s.length ? s.join("\n") : "(no pipelines under " + UNLAZY_DIR + "/)");
  process.exit(0);
}

// ----------------------------------------------------------------- target

const target = resolveTarget({ root, scope: opt.scope, files: fileArgs });
if (target.error) {
  console.error("gate-check: " + target.error);
  process.exit(2);
}
if (!target.files.length) {
  console.error("gate-check: no gate files found (looked for " + UNLAZY_DIR +
    "/<scope>/, then GATES.md and gates/*.md under " + root + ")");
  process.exit(2);
}
for (const f of target.files) {
  if (!existsSync(f)) {
    console.error("gate-check: no such gate file: " + f);
    process.exit(2);
  }
}
const scope = target.scope;

function load(file) {
  return Object.assign({ file }, parseGates(readFileSync(file, "utf8")));
}

// ---------------------------------------------------------------- --log

if (opt.log) {
  const p = appendStatus(root, scope, opt.log);
  console.log("appended to " + p);
  process.exit(0);
}

if (opt.bind) {
  if (!scope) {
    console.error("gate-check: --bind needs a scope (--scope <id>)");
    process.exit(2);
  }
  const p = join(scopeRoot(root, scope), "session");
  mkdirSync(dirname(p), { recursive: true });
  writeAtomic(p, String(opt.bind).trim() + "\n");
  console.log("bound session " + opt.bind + " to scope " + scope);
  process.exit(0);
}

// --------------------------------------------------- --claim / --release

if (opt.claim || opt.release) {
  if (!scope) {
    console.error("gate-check: --claim/--release need a scope (--scope <id> or a single pipeline under " + UNLAZY_DIR + "/)");
    process.exit(2);
  }
  // --release with no --leaf drops the whole pipeline's leases, which is what a
  // driver wants at the end of a run; --claim always needs one specific leaf.
  if (opt.release) {
    const n = releaseLeases(root, { scope, leaf: opt.leaf || null });
    console.log("released " + n + " lease(s) for " + scope + (opt.leaf ? "/" + opt.leaf : ""));
    process.exit(0);
  }
  const leafArg = opt.leaf || (target.files.length === 1
    ? basename(target.files[0]).replace(/\.md$/i, "")
    : null);
  if (!leafArg) {
    console.error("gate-check: --claim needs --leaf <name> when the scope holds several gate files");
    process.exit(2);
  }
  const gf = target.files.find(f => basename(f).replace(/\.md$/i, "") === leafArg) || target.files[0];
  const globs = load(gf).owns;
  if (!globs.length) {
    console.error("gate-check: " + basename(gf) + " declares no OWNS: paths, so there is nothing to claim");
    process.exit(2);
  }
  const res = claimLeases(root, { scope, leaf: leafArg, globs });
  if (!res.ok) {
    for (const c of res.conflicts) {
      console.log("CONFLICT " + c.glob + " overlaps " + c.theirGlob + " held by " + c.with);
    }
    if (res.error) console.error("gate-check: " + res.error);
    console.log("CLAIM REFUSED (" + res.conflicts.length + " conflict(s))");
    process.exit(3);
  }
  console.log("CLAIMED " + globs.length + " path(s) for " + scope + "/" + leafArg + ": " + globs.join(", "));
  process.exit(0);
}

// ------------------------------------------------------------ check runner

function runCheck(gate) {
  return new Promise((res) => {
    const cwd = gate.cwd ? resolve(defaultCwd, gate.cwd) : defaultCwd;
    exec(gate.check, {
      cwd, timeout: timeoutSec * 1000, maxBuffer: 8 * 1024 * 1024,
      windowsHide: true, encoding: "utf8",
    }, (err, stdout, stderr) => {
      const output = (stdout || "") + "\n" + (stderr || "");
      // With an EXPECT, the match decides (a check may exit non-zero by
      // design); without one, the exit code decides.
      const ok = gate.expect
        ? expectMatches(gate.expect, output)
        : !err;
      res({ ok, output, error: err && err.killed ? "timed out after " + timeoutSec + "s" : (err ? err.message : null) });
    });
  });
}

// --------------------------------------------------------------- main run

let totalMet = 0, totalUnmet = 0, totalAbandoned = 0;
const unmetIds = [];

for (const file of target.files) {
  const doc = load(file);
  if (!doc.gates.length) {
    console.log(basename(file) + ": no gates found");
    continue;
  }

  const runnable = opt.status ? [] : doc.gates.filter(g => {
    if (doc.abandoned.has(g.id)) return false;
    if (!g.check) return false;
    const st = gateState(g, doc.abandoned);
    return st === "unmet" || st === "unmet-no-evidence";
  });

  const results = [];
  for (const gate of runnable) results.push(await runCheck(gate));

  // Print in gate order regardless of completion order, so two runs of the
  // same file produce the same transcript.
  const resolved = new Map();
  runnable.forEach((g, idx) => {
    const r = results[idx];
    if (r && r.ok) {
      resolved.set(g.id, tail(r.output));
      console.log("  PASS " + qualify(file, g.id) + ": " + g.title);
    } else {
      const why = r ? (r.error || tail(r.output)) : "(not run)";
      console.log("  FAIL " + qualify(file, g.id) + ": " + g.title + "\n       " + why);
    }
  });

  if (resolved.size) {
    // Re-read under a lock and apply only the gates this run resolved, so a
    // concurrent edit to a different gate in the same file is not clobbered
    // by a stale whole-file snapshot.
    await withFileLock(root, file, () => {
      const fresh = parseGates(readFileSync(file, "utf8"));
      const lines = fresh.lines;
      let changed = false;
      for (const g of fresh.gates) {
        if (!resolved.has(g.id)) continue;
        const ev = resolved.get(g.id);
        if (/^- \[ \]/.test(lines[g.line])) {
          lines[g.line] = lines[g.line].replace(/^- \[ \]/, "- [x]");
          changed = true;
        }
        if (g.evidenceLine !== -1) {
          const indent = lines[g.evidenceLine].match(/^\s*/)[0];
          const next = indent + "EVIDENCE: " + ev;
          if (lines[g.evidenceLine] !== next) { lines[g.evidenceLine] = next; changed = true; }
        }
      }
      if (changed) writeAtomic(file, lines.join("\n"));
    });
  }

  // Tally from what is on disk now, never from what we believe we just did.
  const after = parseGates(readFileSync(file, "utf8"));
  for (const g of after.gates) {
    const st = gateState(g, after.abandoned);
    if (st === "abandoned") { totalAbandoned++; continue; }
    if (st === "met") { totalMet++; continue; }
    totalUnmet++;
    unmetIds.push(qualify(file, g.id));
    if (opt.status) {
      const why = st === "unmet" ? "unchecked" : "checked but EVIDENCE pending";
      console.log("  UNMET " + qualify(file, g.id) + " (" + why + "): " + g.title);
    }
  }
  console.log(basename(file) + ": " + after.gates.length + " gates");
}

const where = scope ? " [scope " + scope + "]" : "";
if (totalUnmet === 0) {
  console.log("ALL MET (" + totalMet + " met" +
    (totalAbandoned ? ", " + totalAbandoned + " abandoned" : "") + ")" + where);
  process.exit(0);
}
console.log("UNMET: " + totalUnmet + " (met: " + totalMet +
  (totalAbandoned ? ", abandoned: " + totalAbandoned : "") + ")" + where);
console.log("  " + unmetIds.slice(0, 12).join(", ") +
  (unmetIds.length > 12 ? ", +" + (unmetIds.length - 12) + " more" : ""));
process.exit(1);
