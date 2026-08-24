// Shared gate parsing, scope resolution, durable writes, locks, and leases.
// Zero dependencies. Node 16+.

import {
  closeSync, constants as fsConstants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync,
  openSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

export const UNLAZY_DIR = ".unlazy";
export const LOCK_DIR = join(UNLAZY_DIR, "locks");

export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
export const sha256 = (value) => createHash("sha256").update(String(value)).digest("hex");

const WINDOWS_TRANSIENT_FS_ERRORS = new Set(["EACCES", "EBUSY", "EPERM"]);
const SYNC_SLEEP_CELL = new Int32Array(new SharedArrayBuffer(4));

function isTransientWindowsFsError(error) {
  return process.platform === "win32" && WINDOWS_TRANSIENT_FS_ERRORS.has(error && error.code);
}

// Windows scanners and indexers can briefly retain a handle to a file after it
// closes. Keep the same private temp file and retry replacement while the caller
// still holds its lock; never unlink the destination or fall back to an in-place
// write, either of which would sacrifice atomicity.
function replaceAtomic(temp, target) {
  const deadline = Date.now() + 2000;
  let delay = 5;
  for (;;) {
    try {
      renameSync(temp, target);
      return;
    } catch (error) {
      const remaining = deadline - Date.now();
      if (!isTransientWindowsFsError(error) || remaining <= 0) throw error;
      Atomics.wait(SYNC_SLEEP_CELL, 0, 0, Math.min(delay, remaining));
      delay = Math.min(delay * 2, 100);
    }
  }
}

const GATE_RE = /^- \[( |x|X)\] (.*)$/;
const ATTR_RE = /^(\s+)(CHECK|EXPECT|EVIDENCE|CWD):\s?(.*)$/;
const UNINDENTED_ATTR_RE = /^(CHECK|EXPECT|EVIDENCE|CWD):\s?(.*)$/;
const ABANDON_RE = /^ABANDON:\s*(\S*)\s*(.*)$/;
const INDENTED_ABANDON_RE = /^\s+ABANDON:/;
const OWNS_RE = /^OWNS:\s*(.*)$/;
const FENCE_OPEN_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const REGEX_RE = /^\/([\s\S]*)\/([a-z]*)$/;
// A pattern author escapes an inner slash or has none. A literal path always
// carries one, so an unescaped inner slash marks the ambiguous reading.
const UNESCAPED_SLASH_RE = /(^|[^\\])\//;
const SCOPE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function parseRegex(expect) {
  const match = String(expect).match(REGEX_RE);
  if (!match) return { kind: "text", value: String(expect) };
  if (match[1].length > 1000) return { error: "EXPECT regex is longer than 1000 characters" };
  try {
    // Matching happens in a disposable worker so catastrophic backtracking
    // cannot hang the checker.
    new RegExp(match[1], match[2]);
  } catch (error) {
    return { error: "invalid EXPECT regex: " + error.message };
  }
  return {
    kind: "regex",
    source: match[1],
    flags: match[2],
    pathLike: UNESCAPED_SLASH_RE.test(match[1]),
  };
}

// The checker and Stop hook both consume this exact result. Diagnostics are
// returned together so callers can report all malformed input in one pass.
export function parseGates(text, options = {}) {
  const source = String(text);
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const finalNewline = source.endsWith("\n");
  const lines = source.split(/\r?\n/);
  const gates = [];
  const abandoned = new Map();
  const owns = [];
  const errors = [];
  const warnings = [];
  const ids = new Map();
  const attrs = new Map();
  let current = null;
  let seenGate = false;
  let fence = null;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (fence) {
      const close = line.match(/^( {0,3})(`+|~+)[ \t]*$/);
      if (close && close[2][0] === fence.character && close[2].length >= fence.length) fence = null;
      continue;
    }
    const fenceMatch = line.match(FENCE_OPEN_RE);
    if (fenceMatch && !(fenceMatch[2][0] === "`" && fenceMatch[3].includes("`"))) {
      fence = { character: fenceMatch[2][0], length: fenceMatch[2].length };
      continue;
    }

    const gateMatch = line.match(GATE_RE);
    if (gateMatch) {
      seenGate = true;
      const rawTitle = gateMatch[2].trim();
      const idMatch = rawTitle.match(/^(\S+?):(?:\s+|$)/);
      const id = idMatch ? idMatch[1] : "L" + (index + 1);
      const title = idMatch ? rawTitle.slice(idMatch[0].length).trim() : rawTitle;
      current = {
        line: index,
        checked: gateMatch[1].toLowerCase() === "x",
        id,
        title,
        check: null,
        expect: null,
        evidence: null,
        evidenceLine: -1,
        cwd: null,
      };
      gates.push(current);
      attrs.set(current, new Set());
      if (!idMatch) errors.push("line " + (index + 1) + ": gate needs an explicit ID followed by a colon");
      else if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
        errors.push("line " + (index + 1) + ": invalid gate id " + id);
      }
      if (!title) errors.push("line " + (index + 1) + ": gate outcome is blank");
      if (ids.has(id)) {
        errors.push("line " + (index + 1) + ": duplicate gate id " + id +
          " (first declared on line " + ids.get(id) + ")");
      } else ids.set(id, index + 1);
      continue;
    }

    // Attributes must be indented and ABANDON must not be, so the two rules
    // point opposite ways. Diagnose the indented abandonment rather than
    // ignoring it, or the author's honest exit fails with no explanation.
    if (INDENTED_ABANDON_RE.test(line)) {
      errors.push("line " + (index + 1) +
        ": indented ABANDON is not applied; start ABANDON at column 1");
      current = null;
      continue;
    }

    const unindented = line.match(UNINDENTED_ATTR_RE);
    if (unindented) {
      errors.push("line " + (index + 1) + ": unindented " + unindented[1] +
        " is not attached to a gate; indent attribute lines with spaces");
      current = null;
      continue;
    }

    const anyAttr = line.match(ATTR_RE);
    if (anyAttr && !current) {
      errors.push("line " + (index + 1) + ": orphan " + anyAttr[2] + " is not attached to a gate");
      continue;
    }
    const attrMatch = current && anyAttr;
    if (attrMatch) {
      const key = attrMatch[2].toLowerCase();
      const value = attrMatch[3].trim();
      if (attrs.get(current).has(key)) {
        errors.push("line " + (index + 1) + ": duplicate " + attrMatch[2] +
          " for gate " + current.id);
      }
      attrs.get(current).add(key);
      if (key === "evidence") {
        current.evidence = value;
        current.evidenceLine = index;
      } else current[key] = value;
      continue;
    }

    const abandonMatch = line.match(ABANDON_RE);
    if (abandonMatch) {
      const id = abandonMatch[1].replace(/:$/, "");
      const reason = abandonMatch[2].trim();
      if (!id) errors.push("line " + (index + 1) + ": ABANDON needs a gate id and reason");
      else if (!reason) errors.push("line " + (index + 1) + ": ABANDON " + id + " needs a non-blank reason");
      else if (abandoned.has(id)) errors.push("line " + (index + 1) + ": duplicate ABANDON for " + id);
      else abandoned.set(id, reason);
      current = null;
      continue;
    }

    const ownsMatch = line.match(OWNS_RE);
    if (ownsMatch) {
      if (seenGate) {
        errors.push("line " + (index + 1) + ": OWNS must appear before the first gate");
        current = null;
        continue;
      }
      const declared = ownsMatch[1].split(",").map((item) => item.trim()).filter(Boolean);
      if (!declared.length) errors.push("line " + (index + 1) + ": OWNS declares no paths");
      for (const item of declared) {
        const normalized = normalizeOwnsGlob(item);
        if (normalized.error) errors.push("line " + (index + 1) + ": " + normalized.error);
        else owns.push(normalized.value);
      }
      continue;
    }
    if (/^#|^- /.test(line)) current = null;
  }

  if (fence) errors.push("unclosed fenced block");

  for (const gate of gates) {
    const hasCheck = gate.check !== null && gate.check !== "";
    const hasExpect = gate.expect !== null && gate.expect !== "";
    if (hasCheck !== hasExpect) {
      errors.push("gate " + gate.id + ": runnable gates require both non-blank CHECK and EXPECT");
    }
    if (gate.check === "" || gate.expect === "") {
      errors.push("gate " + gate.id + ": CHECK and EXPECT cannot be blank");
    }
    if (hasExpect) {
      const parsed = parseRegex(gate.expect);
      if (parsed.error) errors.push("gate " + gate.id + ": " + parsed.error);
      else if (parsed.pathLike) {
        // Warn rather than reject: the pattern reading may be intended, and a
        // literal path cannot be expressed once the wrapping slashes sniff.
        warnings.push("gate " + gate.id + ": EXPECT " + JSON.stringify(gate.expect) +
          " is read as a regular expression, so its dots and other metacharacters" +
          " are wildcards. Escape the inner slashes to keep the pattern, or drop" +
          " the wrapping slashes to match a literal substring.");
      }
      gate.expectation = parsed;
    } else gate.expectation = null;
  }

  for (const id of abandoned.keys()) {
    if (!ids.has(id)) errors.push("ABANDON references unknown gate " + id);
  }
  if (options.requireGates !== false && gates.length === 0) errors.push("ledger contains zero live gates");

  return { lines, eol, finalNewline, gates, abandoned, owns, errors, warnings };
}

export function formatDocument(doc) {
  let output = doc.lines.join(doc.eol);
  if (doc.finalNewline && !output.endsWith(doc.eol)) output += doc.eol;
  return output;
}

export function qualify(fileOrLabel, id) {
  return basename(String(fileOrLabel)).replace(/\.md$/i, "") + ":" + id;
}

export function gateState(gate, abandoned) {
  if (abandoned.has(gate.id)) return "abandoned";
  const pending = gate.evidence === null || gate.evidence === "" || /^pending$/i.test(gate.evidence);
  if (!gate.checked) return "unmet";
  if (pending) return "unmet-no-evidence";
  return "met";
}

export function tail(output, max = 240) {
  const lines = String(output).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return (lines.slice(-2).join(" | ") || "(no output)").slice(0, max);
}

export function validateScopeId(value, label = "scope") {
  const id = String(value || "");
  if (!SCOPE_RE.test(id) || id === "." || id === "..") {
    return label + " must match " + SCOPE_RE + " and cannot be . or ..";
  }
  return null;
}

export function normalizeOwnsGlob(value) {
  const raw = String(value || "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!raw) return { error: "OWNS path is blank" };
  if (isAbsolute(raw) || /^[A-Za-z]:\//.test(raw) || raw.startsWith("//")) {
    return { error: "OWNS path must be relative: " + value };
  }
  const parts = raw.split("/");
  if (raw.includes("\0") || parts.some((part) => part === "..")) {
    return { error: "OWNS path cannot contain traversal: " + value };
  }
  const normalized = parts.filter((part) => part !== "" && part !== ".").join("/");
  if (!normalized || normalized === ".") return { error: "OWNS path cannot claim an implicit root" };
  return { value: normalized };
}

export function literalPrefix(glob) {
  const normalized = normalizeOwnsGlob(glob);
  if (normalized.error) return "";
  const literal = [];
  for (const part of normalized.value.split("/")) {
    if (/[*?[{]/.test(part)) break;
    literal.push(part);
  }
  return literal.join("/");
}

// Prove disjointness only when literal path segments disagree. Everything else
// conflicts, including mid-segment pairs such as a* and ab*.
export function globsOverlap(left, right) {
  const a = normalizeOwnsGlob(left);
  const b = normalizeOwnsGlob(right);
  if (a.error || b.error) return true;
  const as = a.value.split("/");
  const bs = b.value.split("/");
  const count = Math.min(as.length, bs.length);
  for (let index = 0; index < count; index++) {
    const av = as[index], bv = bs[index];
    if (/[*?[{]/.test(av) || /[*?[{]/.test(bv)) return true;
    if (av !== bv) return false;
  }
  // An exact prefix may denote a directory ownership claim, so it can overlap
  // every descendant. Treat common-prefix length differences as conflicts.
  if (as.length !== bs.length) return true;
  return true;
}

export function scopeRoot(root, scope) {
  return join(root, UNLAZY_DIR, scope);
}

export function listScopes(root) {
  const directory = join(root, UNLAZY_DIR);
  if (!existsSync(directory)) return [];
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && entry.name !== "locks" && !validateScopeId(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function markdownFiles(directory) {
  if (!existsSync(directory)) return [];
  try {
    if (!statSync(directory).isDirectory()) return [];
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => join(directory, entry.name))
      .sort();
  } catch {
    return [];
  }
}

export function scopeFiles(root, scope) {
  const base = scopeRoot(root, scope);
  const files = [];
  const top = join(base, "GATES.md");
  try { if (statSync(top).isFile()) files.push(top); } catch { /* absent */ }
  files.push(...markdownFiles(join(base, "gates")));
  return files;
}

export function legacyFiles(root) {
  const files = [];
  const top = join(root, "GATES.md");
  try { if (statSync(top).isFile()) files.push(top); } catch { /* absent */ }
  files.push(...markdownFiles(join(root, "gates")));
  return files;
}

export function resolveTarget(options = {}) {
  const root = resolve(options.root || process.cwd());
  const files = options.files || [];
  const sessionId = options.sessionId || null;
  if (files.length) return { mode: "explicit", scope: null, files: files.map((file) => resolve(root, file)) };

  const scopes = listScopes(root);
  const wanted = options.scope || process.env.UNLAZY_SCOPE || null;
  if (wanted) {
    const invalid = validateScopeId(wanted);
    if (invalid) return { mode: "none", scope: wanted, files: [], error: invalid };
    if (!scopes.includes(wanted)) {
      return {
        mode: "none", scope: wanted, files: [],
        error: "no such scope \"" + wanted + "\" under " + UNLAZY_DIR + "/ (have: " +
          (scopes.join(", ") || "none") + ")",
      };
    }
    return { mode: "scope", scope: wanted, files: scopeFiles(root, wanted) };
  }

  if (scopes.length === 1) return { mode: "scope", scope: scopes[0], files: scopeFiles(root, scopes[0]) };
  if (scopes.length > 1) {
    if (sessionId) {
      const owned = scopes.filter((scope) => {
        try {
          return readFileSync(join(scopeRoot(root, scope), "session"), "utf8").trim() === String(sessionId).trim();
        } catch { return false; }
      });
      if (owned.length === 1) return { mode: "scope", scope: owned[0], files: scopeFiles(root, owned[0]) };
    }
    return {
      mode: "none", scope: null, files: [], ambiguous: scopes,
      error: scopes.length + " pipelines present (" + scopes.join(", ") +
        "); pass --scope <id> or set UNLAZY_SCOPE. Refusing to guess.",
    };
  }

  const legacy = legacyFiles(root);
  if (legacy.length) return { mode: "legacy", scope: null, files: legacy };
  return { mode: "none", scope: null, files: [] };
}

export function statusLogPath(root, scope) {
  return scope ? join(scopeRoot(root, scope), "status.log") : join(root, "unlazy-status.log");
}

export function hookStatePath(root, scope) {
  return scope ? join(scopeRoot(root, scope), "hook-state.json") : join(root, ".unlazy-hook-state.json");
}

function assertSafeStatePath(root, target) {
  const stateRoot = join(resolve(root), UNLAZY_DIR);
  if (existsSync(stateRoot)) {
    const info = lstatSync(stateRoot);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(stateRoot + " must be a real directory, not a link or file");
  }
  const parent = dirname(target);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const info = lstatSync(parent);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(parent + " must be a real directory");
}

export function writeAtomic(file, text, options = {}) {
  const target = resolve(file);
  if (options.root) assertSafeStatePath(options.root, target);
  else {
    const parent = dirname(target);
    mkdirSync(parent, { recursive: true });
    const info = lstatSync(parent);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(parent + " must be a real directory");
  }
  try {
    const existing = lstatSync(target);
    if (existing.isSymbolicLink()) throw new Error("refusing to replace symlink " + target);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let temp = "";
  let fd = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    temp = target + "." + process.pid + "." + randomBytes(8).toString("hex") + ".tmp";
    try { fd = openSync(temp, "wx", 0o600); break; }
    catch (error) { if (error.code !== "EEXIST") throw error; }
  }
  if (fd === null) throw new Error("could not create a unique temporary file for " + target);
  try {
    writeFileSync(fd, String(text), "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    replaceAtomic(temp, target);
  } finally {
    if (fd !== null) try { closeSync(fd); } catch { /* ignore */ }
    if (temp) try { unlinkSync(temp); } catch { /* renamed or absent */ }
  }
}

function lockDirectory(root) {
  const directory = join(resolve(root), LOCK_DIR);
  assertSafeStatePath(root, directory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const info = lstatSync(directory);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(directory + " must be a real directory");
  return directory;
}

export async function withFileLock(root, target, fn, options = {}) {
  const timeoutMs = options.timeoutMs === undefined ? 30000 : options.timeoutMs;
  const lock = join(lockDirectory(root), sha256(resolve(target)).slice(0, 24) + ".filelock");
  const deadline = Date.now() + timeoutMs;
  const token = randomBytes(16).toString("hex");
  let fd = null;
  for (;;) {
    try { fd = openSync(lock, "wx", 0o600); break; }
    catch (error) {
      // On Windows, opening or inspecting an existing file held by another
      // process can surface as EPERM/EACCES/EBUSY rather than EEXIST. Treat
      // only those platform-specific sharing errors as lock contention.
      if (error.code !== "EEXIST" && !isTransientWindowsFsError(error)) throw error;
      // Never unlink a lock observed by path: between stat and unlink its
      // prior owner can release and a successor can acquire the same name
      // (the classic ABA race). Missing-after-EEXIST simply means retry. A
      // crashed owner's lock fails closed at timeout and can be removed by a
      // human after inspecting its JSON metadata.
      let missing = false;
      try { statSync(lock); } catch (statError) {
        if (statError.code === "ENOENT") missing = true;
        else if (!isTransientWindowsFsError(statError)) throw statError;
      }
      if (Date.now() >= deadline) {
        throw new Error("timed out waiting for lock on " + target + " (last filesystem error: " + error.code + ")");
      }
      if (missing && error.code === "EEXIST") continue;
      await sleep(15 + Math.floor(Math.random() * 25));
    }
  }
  let identified = false;
  try {
    writeFileSync(fd, JSON.stringify({ token, pid: process.pid, target: resolve(target), at: Date.now() }));
    identified = true;
  } catch { /* leave for manual cleanup rather than risk deleting a successor */ }
  try { return await fn(); }
  finally {
    try { closeSync(fd); } catch { /* ignore */ }
    if (identified) {
      const deadline = Date.now() + 2000;
      let delay = 5;
      for (;;) {
        try {
          const current = JSON.parse(readFileSync(lock, "utf8"));
          if (current.token === token) unlinkSync(lock);
          break;
        } catch (error) {
          if (error && error.code === "ENOENT") break;
          const remaining = deadline - Date.now();
          if (!isTransientWindowsFsError(error) || remaining <= 0) break;
          await sleep(Math.min(delay, remaining));
          delay = Math.min(delay * 2, 100);
        }
      }
    }
  }
}

export function appendStatus(root, scope, line) {
  const path = statusLogPath(root, scope);
  assertSafeStatePath(root, path);
  let fd = null;
  try {
    try {
      const before = lstatSync(path);
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
        throw new Error("refusing non-file or linked status log " + path);
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    // Open first but write only after proving that the named entry is the same
    // regular file as the descriptor. A symlink swap can therefore never turn
    // the append into a write through an outside-root target.
    const noFollow = process.platform === "win32" ? 0 : (fsConstants.O_NOFOLLOW || 0);
    fd = openSync(path, fsConstants.O_WRONLY | fsConstants.O_APPEND | fsConstants.O_CREAT |
      (fsConstants.O_NONBLOCK || 0) | noFollow, 0o600);
    const opened = fstatSync(fd);
    const named = lstatSync(path);
    if (!opened.isFile() || !named.isFile() || named.isSymbolicLink() ||
        opened.nlink !== 1 || named.nlink !== 1 ||
        opened.dev !== named.dev || opened.ino !== named.ino) {
      throw new Error("refusing non-file or replaced status log " + path);
    }
    writeFileSync(fd, String(line).replace(/[\r\n]+/g, " ") + "\n", "utf8");
    fsyncSync(fd);
    return path;
  } finally {
    if (fd !== null) try { closeSync(fd); } catch { /* ignore */ }
  }
}

function readLeasesUnlocked(root) {
  const directory = join(resolve(root), LOCK_DIR);
  if (!existsSync(directory)) return [];
  const leases = [];
  for (const name of readdirSync(directory).sort()) {
    if (!name.endsWith(".lease")) continue;
    const file = join(directory, name);
    try {
      const value = JSON.parse(readFileSync(file, "utf8"));
      if (value && typeof value.scope === "string" && typeof value.leaf === "string" && Array.isArray(value.globs)) {
        leases.push({ ...value, file });
      }
    } catch {
      leases.push({ scope: "(invalid)", leaf: name, globs: ["**"], file, invalid: true });
    }
  }
  return leases;
}

export function readLeases(root) {
  return readLeasesUnlocked(root);
}

const leaseRegistry = (root) => join(resolve(root), LOCK_DIR, "lease-registry");

export async function claimLeases(root, spec) {
  return withFileLock(root, leaseRegistry(root), () => {
    const scopeError = validateScopeId(spec.scope);
    const leafError = validateScopeId(spec.leaf, "leaf");
    if (scopeError || leafError) return { ok: false, conflicts: [], error: scopeError || leafError };
    const normalized = [];
    for (const glob of spec.globs || []) {
      const result = normalizeOwnsGlob(glob);
      if (result.error) return { ok: false, conflicts: [], error: result.error };
      normalized.push(result.value);
    }
    if (!normalized.length) return { ok: false, conflicts: [], error: "no OWNS paths to claim" };

    const conflicts = [];
    for (const glob of normalized) {
      for (const held of readLeasesUnlocked(root)) {
        const theirGlob = held.globs.find((other) => globsOverlap(glob, other));
        if (theirGlob) conflicts.push({ glob, with: held.scope + "/" + held.leaf, theirGlob });
      }
    }
    if (conflicts.length) return { ok: false, conflicts };
    const file = join(lockDirectory(root), sha256(spec.scope + "::" + spec.leaf).slice(0, 24) + ".lease");
    writeAtomic(file, JSON.stringify({ scope: spec.scope, leaf: spec.leaf, globs: normalized, pid: process.pid }, null, 2) + "\n", { root });
    return { ok: true, file, conflicts: [], globs: normalized };
  });
}

export async function releaseLeases(root, spec) {
  return withFileLock(root, leaseRegistry(root), () => {
    let count = 0;
    for (const lease of readLeasesUnlocked(root)) {
      if (lease.scope !== spec.scope) continue;
      if (spec.leaf && lease.leaf !== spec.leaf) continue;
      try { unlinkSync(lease.file); count++; } catch { /* raced or absent */ }
    }
    return count;
  });
}
