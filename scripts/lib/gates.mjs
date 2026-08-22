// gates.mjs : the single source of truth for gate parsing, scope resolution,
// locking and lease bookkeeping. Both gate-check.mjs and stop-hook.mjs import
// this, so they can never disagree about what a gate is or which pipeline it
// belongs to. Zero dependencies. Node 18+.

import {
  readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync,
  openSync, closeSync, unlinkSync, renameSync, appendFileSync, statSync,
} from "node:fs";
import { join, dirname, basename, resolve } from "node:path";
import { createHash } from "node:crypto";

export const UNLAZY_DIR = ".unlazy";
export const LOCK_DIR = join(UNLAZY_DIR, "locks");

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- parsing

const GATE_RE = /^- \[( |x|X)\] (.*)$/;
const ATTR_RE = /^\s+(CHECK|EXPECT|EVIDENCE|CWD):\s?(.*)$/;
const HEADER_RE = /^(OWNS):\s*(.*)$/;
const ABANDON_RE = /^ABANDON:\s*(\S+)\s*(.*)$/;

// Parse a gate file's text. One implementation, used everywhere, so a gate's
// id is the same string no matter which tool is looking at it.
export function parseGates(text) {
  const lines = text.split(/\r?\n/);
  const gates = [];
  const abandoned = new Map();
  const owns = [];
  let cur = null;
  let seenGate = false;

  lines.forEach((line, i) => {
    const g = line.match(GATE_RE);
    if (g) {
      seenGate = true;
      const title = g[2].trim();
      cur = {
        line: i,
        checked: g[1].toLowerCase() === "x",
        // Deterministic id: the "Gn:" prefix when present, else the line
        // number. Shared by every tool, so ABANDON always resolves.
        id: (title.match(/^(\S+?):/) || [null, "L" + (i + 1)])[1],
        title: title.replace(/^\S+?:\s*/, ""),
        check: null, expect: null, evidence: null, evidenceLine: -1,
        cwd: null,
      };
      gates.push(cur);
      return;
    }
    const a = cur && line.match(ATTR_RE);
    if (a) {
      const key = a[1].toLowerCase();
      const val = a[2].trim();
      if (key === "evidence") { cur.evidence = val; cur.evidenceLine = i; }
      else cur[key] = val;
      return;
    }
    const ab = line.match(ABANDON_RE);
    if (ab) { abandoned.set(ab[1].replace(/:$/, ""), ab[2] || "(no reason)"); return; }
    // Header directives are only meaningful before the first gate.
    if (!seenGate) {
      const h = line.match(HEADER_RE);
      if (h) {
        owns.push(...h[2].split(",").map(s => s.trim()).filter(Boolean));
        return;
      }
    }
    if (/^#|^- /.test(line)) cur = null;
  });

  return { lines, gates, abandoned, owns };
}

// A gate's fully-qualified id: "leaf-1.2.1:G3". Unique across a whole tree.
export function qualify(fileOrLabel, id) {
  const stem = basename(String(fileOrLabel)).replace(/\.md$/i, "");
  return stem + ":" + id;
}

// UNMET = unchecked, or checked while EVIDENCE still reads "pending".
export function gateState(gate, abandoned) {
  if (abandoned.has(gate.id)) return "abandoned";
  const pending = gate.evidence === null || /^pending$/i.test(gate.evidence);
  if (!gate.checked) return "unmet";
  if (pending) return "unmet-no-evidence";
  return "met";
}

export function expectMatches(expect, output) {
  const rx = expect.match(/^\/(.+)\/([a-z]*)$/);
  if (rx) {
    try { return new RegExp(rx[1], rx[2]).test(output); } catch { return false; }
  }
  return output.includes(expect);
}

export function tail(output, max = 200) {
  const ls = output.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  return (ls.slice(-2).join(" | ") || "(no output)").slice(0, max);
}

// ------------------------------------------------------------------ scope

export function scopeRoot(root, scope) { return join(root, UNLAZY_DIR, scope); }

export function listScopes(root) {
  const dir = join(root, UNLAZY_DIR);
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name !== "locks")
      .map(d => d.name)
      .sort();
  } catch { return []; }
}

function mdFiles(dir) {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir).filter(f => f.endsWith(".md")).sort().map(f => join(dir, f));
  } catch { return []; }
}

// Every gate file belonging to one scope. Never reaches outside it.
export function scopeFiles(root, scope) {
  const base = scopeRoot(root, scope);
  const out = [];
  const top = join(base, "GATES.md");
  if (existsSync(top)) out.push(top);
  out.push(...mdFiles(join(base, "gates")));
  return out;
}

// Legacy single-pipeline layout: GATES.md + gates/*.md directly under cwd.
export function legacyFiles(root) {
  const out = [];
  const top = join(root, "GATES.md");
  if (existsSync(top)) out.push(top);
  out.push(...mdFiles(join(root, "gates")));
  return out;
}

// Decide which pipeline we are looking at. Refuses to guess when more than one
// scope exists: silently globbing every pipeline's gates is the bug this whole
// layout exists to prevent.
//
// Returns { mode, scope, files, error? }
//   mode: "explicit" | "scope" | "legacy" | "none"
export function resolveTarget(opts = {}) {
  const root = opts.root || process.cwd();
  const files = opts.files || [];
  const sessionId = opts.sessionId || null;

  if (files.length) {
    return { mode: "explicit", scope: null, files: files.map(f => resolve(root, f)) };
  }

  const scopes = listScopes(root);
  const wanted = opts.scope || process.env.UNLAZY_SCOPE || null;

  if (wanted) {
    if (!scopes.includes(wanted)) {
      return {
        mode: "none", scope: wanted, files: [],
        error: 'no such scope "' + wanted + '" under ' + UNLAZY_DIR + "/ (have: " +
          (scopes.join(", ") || "none") + ")",
      };
    }
    return { mode: "scope", scope: wanted, files: scopeFiles(root, wanted) };
  }

  if (scopes.length === 1) {
    return { mode: "scope", scope: scopes[0], files: scopeFiles(root, scopes[0]) };
  }

  if (scopes.length > 1) {
    // A session binds itself to a scope by writing its id into
    // .unlazy/<scope>/session; that is how a Stop hook knows whose gates it is
    // guarding when several pipelines share one working copy.
    if (sessionId) {
      const owned = scopes.filter(s => {
        try {
          return readFileSync(join(scopeRoot(root, s), "session"), "utf8").trim() ===
            String(sessionId).trim();
        } catch { return false; }
      });
      if (owned.length === 1) {
        return { mode: "scope", scope: owned[0], files: scopeFiles(root, owned[0]) };
      }
    }
    return {
      mode: "none", scope: null, files: [], ambiguous: scopes,
      error: scopes.length + " pipelines present (" + scopes.join(", ") +
        "); pass --scope <id> or set UNLAZY_SCOPE. Refusing to run every " +
        "pipeline's checks at once.",
    };
  }

  const legacy = legacyFiles(root);
  if (legacy.length) return { mode: "legacy", scope: null, files: legacy };
  return { mode: "none", scope: null, files: [] };
}

export function statusLogPath(root, scope) {
  return scope ? join(scopeRoot(root, scope), "status.log") : join(root, "unlazy-status.log");
}

export function appendStatus(root, scope, line) {
  const p = statusLogPath(root, scope);
  mkdirSync(dirname(p), { recursive: true });
  // Append, never read-modify-write: concurrent leaves cannot lose each
  // other's lines, and the stable prefix stays cache-friendly.
  appendFileSync(p, line.replace(/\r?\n/g, " ") + "\n");
  return p;
}

export function hookStatePath(root, scope) {
  return scope
    ? join(scopeRoot(root, scope), "hook-state.json")
    : join(root, ".unlazy-hook-state.json");
}

// ------------------------------------------------------------------- locks

const hash = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);

function lockDir(root) {
  const d = join(root, LOCK_DIR);
  mkdirSync(d, { recursive: true });
  return d;
}

// Exclusive lock via open(..., "wx"), which is atomic create-if-absent on both
// NTFS and POSIX. Breaks locks older than staleMs so a killed process cannot
// wedge a pipeline forever.
export async function withFileLock(root, target, fn, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 30000;
  const staleMs = opts.staleMs ?? 300000;
  const lock = join(lockDir(root), hash(resolve(target)) + ".filelock");
  const deadline = Date.now() + timeoutMs;
  let fd = null;
  for (;;) {
    try { fd = openSync(lock, "wx"); break; }
    catch (e) {
      if (e.code !== "EEXIST") throw e;
      let age = Infinity;
      try { age = Date.now() - statSync(lock).mtimeMs; } catch { age = Infinity; }
      if (age > staleMs) { try { unlinkSync(lock); } catch { /* raced */ } continue; }
      if (Date.now() > deadline) throw new Error("timed out waiting for lock on " + target);
      await sleep(50 + Math.floor(Math.random() * 100));
    }
  }
  try { writeFileSync(fd, JSON.stringify({ pid: process.pid, target: resolve(target) })); }
  catch { /* advisory content only */ }
  try { return await fn(); }
  finally {
    try { closeSync(fd); } catch { /* ignore */ }
    try { unlinkSync(lock); } catch { /* ignore */ }
  }
}

// Write via tmp + rename so a reader never sees a half-written gate file.
export function writeAtomic(file, text) {
  const tmp = file + "." + process.pid + ".tmp";
  writeFileSync(tmp, text);
  renameSync(tmp, file); // replaces the destination on NTFS and POSIX alike
}

// ------------------------------------------------------------------ leases

// Conservative overlap test on the literal prefix of each glob. It can report a
// conflict that a full glob intersection would clear (never the reverse), which
// is the safe direction for a tool whose job is stopping two leaves from
// writing the same file.
export function literalPrefix(glob) {
  const g = String(glob).replace(/\\/g, "/").replace(/^\.\//, "");
  const i = g.search(/[*?[{]/);
  return (i === -1 ? g : g.slice(0, i)).replace(/\/+$/, "");
}

export function globsOverlap(a, b) {
  const pa = literalPrefix(a), pb = literalPrefix(b);
  if (!pa || !pb) return true; // one side claims the whole tree
  return pa === pb || pa.startsWith(pb + "/") || pb.startsWith(pa + "/");
}

export function readLeases(root) {
  const d = join(root, LOCK_DIR);
  if (!existsSync(d)) return [];
  const out = [];
  for (const f of readdirSync(d)) {
    if (!f.endsWith(".lease")) continue;
    try {
      out.push(Object.assign({ file: join(d, f) },
        JSON.parse(readFileSync(join(d, f), "utf8"))));
    } catch { /* skip unreadable */ }
  }
  return out;
}

// Claim ownership of every glob a gate file declares. Either all claims
// succeed or nothing is written, so a refused claim cannot half-lock a tree.
export function claimLeases(root, spec) {
  const { scope, leaf, globs } = spec;
  const held = readLeases(root);
  const conflicts = [];
  for (const g of globs) {
    for (const h of held) {
      if (h.scope === scope && h.leaf === leaf) continue; // our own, re-claiming
      const clash = (h.globs || []).find(hg => globsOverlap(g, hg));
      if (clash) conflicts.push({ glob: g, with: h.scope + "/" + h.leaf, theirGlob: clash });
    }
  }
  if (conflicts.length) return { ok: false, conflicts };

  const file = join(lockDir(root), hash(scope + "::" + leaf) + ".lease");
  try {
    writeAtomic(file, JSON.stringify({ scope, leaf, globs, pid: process.pid }, null, 2));
  } catch (e) {
    return { ok: false, conflicts: [], error: e.message };
  }
  return { ok: true, file, conflicts: [] };
}

export function releaseLeases(root, spec) {
  const { scope, leaf = null } = spec;
  let n = 0;
  for (const l of readLeases(root)) {
    if (l.scope !== scope) continue;
    if (leaf && l.leaf !== leaf) continue;
    try { unlinkSync(l.file); n++; } catch { /* ignore */ }
  }
  return n;
}
