#!/usr/bin/env node
// Concurrency and mutation stress tests. Zero dependencies. Node 16+.

import {
  existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync,
  symlinkSync, unlinkSync, writeFileSync,
} from "node:fs";
import { execFile, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  claimLeases, readStableRegularFile, releaseLeases, sha256, withFileLock, writeAtomic,
} from "../scripts/lib/gates.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE_CHECK = join(HERE, "..", "scripts", "gate-check.mjs");
const STOP_HOOK = join(HERE, "..", "scripts", "stop-hook.mjs");
const INSTALL = join(HERE, "..", "scripts", "install-hooks.mjs");
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "unlazy-stress-"));
  return {
    dir,
    path(rel) { return join(dir, rel); },
    write(rel, value) {
      const path = join(dir, rel);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, value);
      return path;
    },
    read(rel) { return readFileSync(join(dir, rel), "utf8"); },
    cleanup() { rmSync(dir, { recursive: true, force: true }); },
  };
}

function run(script, args, options = {}) {
  return new Promise((done) => {
    const child = execFile(process.execPath, [script, ...args], {
      cwd: options.cwd,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, ...(options.env || {}) },
      timeout: options.timeoutMs,
    }, (error, stdout, stderr) => {
      done({
        code: error ? (typeof error.code === "number" ? error.code : 1) : 0,
        out: (stdout || "") + (stderr || ""),
        timedOut: Boolean(error && error.killed),
      });
    });
    if (options.stdin !== undefined) child.stdin.end(options.stdin);
  });
}

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const has = (text, value) => assert(text.includes(value), "missing " + JSON.stringify(value) + "\n" + text);

test("leases: 200 simultaneous conflicting claim pairs never both succeed", async () => {
  const s = sandbox();
  try {
    for (let iteration = 0; iteration < 200; iteration++) {
      const [left, right] = await Promise.all([
        claimLeases(s.dir, { scope: "left", leaf: "leaf-left", globs: ["src/shared/**"] }),
        claimLeases(s.dir, { scope: "right", leaf: "leaf-right", globs: ["src/shared/file.js"] }),
      ]);
      const successes = Number(left.ok) + Number(right.ok);
      assert(successes === 1, "iteration " + iteration + " had " + successes + " successful claims");
      await Promise.all([
        releaseLeases(s.dir, { scope: "left" }),
        releaseLeases(s.dir, { scope: "right" }),
      ]);
    }
  } finally { s.cleanup(); }
});

test("leases: the same scope and leaf cannot be claimed by two workers", async () => {
  const s = sandbox();
  try {
    const [left, right] = await Promise.all([
      claimLeases(s.dir, { scope: "same", leaf: "leaf", globs: ["src/shared/**"] }),
      claimLeases(s.dir, { scope: "same", leaf: "leaf", globs: ["src/shared/**"] }),
    ]);
    assert(Number(left.ok) + Number(right.ok) === 1,
      "duplicate logical owners both claimed one lease: " + JSON.stringify({ left, right }));
    const loser = left.ok ? right : left;
    assert(loser.conflicts.length === 1, "losing duplicate claim did not report its conflict");
    assert(loser.conflicts[0].with === "same/leaf", "duplicate conflict named the wrong owner");
    const released = await releaseLeases(s.dir, { scope: "same", leaf: "leaf" });
    assert(released === 1, "expected one exclusive lease to release, got " + released);
  } finally { s.cleanup(); }
});

test("locks: real and symlink root aliases serialize one physical target", async () => {
  if (process.platform === "win32") return;
  const s = sandbox();
  const outside = sandbox();
  try {
    const alias = outside.path("root-alias");
    symlinkSync(s.dir, alias);
    const realRegistry = s.path(".unlazy/locks/lease-registry");
    let announceEntry;
    let releaseHolder;
    const entered = new Promise((resolveEntry) => { announceEntry = resolveEntry; });
    const held = new Promise((resolveHold) => { releaseHolder = resolveHold; });
    const holder = withFileLock(s.dir, realRegistry, async () => {
      announceEntry();
      await held;
    });
    await entered;

    let settled = false;
    const contender = claimLeases(alias, {
      scope: "alias", leaf: "leaf", globs: ["src/alias/**"],
    }).then((result) => { settled = true; return result; });
    await new Promise((done) => setTimeout(done, 150));
    assert(!settled, "alias-root claim bypassed the physical registry lock");

    releaseHolder();
    await holder;
    const claimed = await contender;
    assert(claimed.ok, "serialized alias-root claim did not succeed: " + JSON.stringify(claimed));
    assert(await releaseLeases(s.dir, { scope: "alias", leaf: "leaf" }) === 1,
      "real-root release could not see the alias-root lease");
  } finally {
    s.cleanup();
    outside.cleanup();
  }
});

test("leases: a disjoint re-claim cannot overwrite the same live owner", async () => {
  const s = sandbox();
  try {
    const first = await claimLeases(s.dir, { scope: "same", leaf: "leaf", globs: ["src/first/**"] });
    assert(first.ok, "initial logical owner was not claimed: " + JSON.stringify(first));
    const original = readFileSync(first.file, "utf8");

    const second = await claimLeases(s.dir, { scope: "same", leaf: "leaf", globs: ["src/disjoint/**"] });
    assert(!second.ok && second.conflicts.length === 1 && second.conflicts[0].identity,
      "disjoint duplicate owner was not refused: " + JSON.stringify(second));
    assert(readFileSync(first.file, "utf8") === original, "refused duplicate owner rewrote the original lease");

    const intruder = await claimLeases(s.dir, { scope: "other", leaf: "leaf", globs: ["src/first/file.mjs"] });
    assert(!intruder.ok, "original ownership disappeared after the refused replacement: " + JSON.stringify(intruder));

    s.write(".unlazy/same/gates/leaf.md",
      "OWNS: src/disjoint/**\n# Gates\n- [ ] G1: pending\n  EVIDENCE: pending\n");
    const cli = await run(GATE_CHECK, ["--scope", "same", "--leaf", "leaf", "--claim"], { cwd: s.dir });
    assert(cli.code === 3, "duplicate-owner CLI claim returned " + cli.code + "\n" + cli.out);
    has(cli.out, "CONFLICT same/leaf already holds a live lease; release it before claiming again");

    assert(await releaseLeases(s.dir, { scope: "same", leaf: "leaf" }) === 1,
      "exact release did not remove the original owner");
    const afterRelease = await claimLeases(s.dir,
      { scope: "same", leaf: "leaf", globs: ["src/disjoint/**"] });
    assert(afterRelease.ok, "exact release did not permit a new claim: " + JSON.stringify(afterRelease));
  } finally { s.cleanup(); }
});

test("stable reader: regular control passes and links, FIFO, overflow, and outside roots fail promptly", () => {
  const s = sandbox();
  const outside = sandbox();
  try {
    const regular = s.write("regular.txt", "regular-control\n");
    assert(readStableRegularFile(regular, { root: s.dir, maxBytes: 64, label: "fixture" }) ===
      "regular-control\n", "ordinary regular file did not round-trip");
    if (process.platform !== "win32") {
      const alias = outside.path("root-alias");
      symlinkSync(s.dir, alias);
      assert(readStableRegularFile(regular, { root: alias, maxBytes: 64, label: "fixture" }) ===
        "regular-control\n", "canonical in-root file was rejected through a root alias");
    }

    const rejected = (path, options, wanted) => {
      let message = "";
      try { readStableRegularFile(path, options); }
      catch (error) { message = error.message; }
      assert(message.includes(wanted), "stable reader did not reject " + path + " with " + wanted + ": " + message);
    };

    const hardTarget = s.write("hard-target.txt", "hard\n");
    const hard = s.path("hard.txt");
    linkSync(hardTarget, hard);
    rejected(hard, { root: s.dir, label: "fixture" }, "regular single-link");

    if (process.platform !== "win32") {
      const symbolic = s.path("symbolic.txt");
      symlinkSync(regular, symbolic);
      rejected(symbolic, { root: s.dir, label: "fixture" }, "regular single-link");

      const dangling = s.path("dangling.txt");
      symlinkSync(s.path("missing-target.txt"), dangling);
      rejected(dangling, { root: s.dir, label: "fixture" }, "regular single-link");

      const fifo = s.path("fifo.txt");
      const made = spawnSync("mkfifo", [fifo], { encoding: "utf8" });
      assert(made.status === 0, "could not create FIFO fixture: " + made.stderr);
      const started = Date.now();
      rejected(fifo, { root: s.dir, label: "fixture" }, "regular single-link");
      assert(Date.now() - started < 1000, "stable reader blocked on a FIFO");
    }

    rejected(regular, { root: s.dir, maxBytes: 4, label: "fixture" }, "exceeds 4 bytes");
    const outsideFile = outside.write("outside.txt", "outside\n");
    rejected(outsideFile, { root: s.dir, label: "fixture" }, "outside the allowed root");

    let missingCode = "";
    try { readStableRegularFile(s.path("absent.txt"), { root: s.dir, label: "fixture" }); }
    catch (error) { missingCode = error.code; }
    assert(missingCode === "ENOENT", "initially absent file did not preserve ENOENT: " + missingCode);
  } finally {
    s.cleanup();
    outside.cleanup();
  }
});

test("leases: linked and FIFO records fail closed while a regular record remains usable", async () => {
  const s = sandbox();
  try {
    const ledger = "OWNS: src/fresh/**\n# Gates\n- [ ] G1: pending\n  EVIDENCE: pending\n";
    s.write(".unlazy/fresh/gates/leaf.md", ledger);
    const victim = s.write("lease-victim.json", '{"scope":"victim","leaf":"leaf","globs":["src/victim/**"]}\n');
    const poison = s.path(".unlazy/locks/poison.lease");
    mkdirSync(dirname(poison), { recursive: true });

    linkSync(victim, poison);
    let result = await run(GATE_CHECK, ["--scope", "fresh", "--leaf", "leaf", "--claim"], {
      cwd: s.dir, timeoutMs: 5000,
    });
    assert(!result.timedOut, "hard-linked lease check reached the process timeout");
    assert(result.code === 3, "hard-linked lease did not fail closed\n" + result.out);
    assert(readFileSync(victim, "utf8").includes("src/victim/**"), "hard-link victim was changed");
    rmSync(poison);

    if (process.platform !== "win32") {
      symlinkSync(victim, poison);
      result = await run(GATE_CHECK, ["--scope", "fresh", "--leaf", "leaf", "--claim"], {
        cwd: s.dir, timeoutMs: 5000,
      });
      assert(!result.timedOut, "symlinked lease check reached the process timeout");
      assert(result.code === 3, "symlinked lease did not fail closed\n" + result.out);
      rmSync(poison);

      const made = spawnSync("mkfifo", [poison], { encoding: "utf8" });
      assert(made.status === 0, "could not create lease FIFO: " + made.stderr);
      const started = Date.now();
      result = await run(GATE_CHECK, ["--scope", "fresh", "--leaf", "leaf", "--claim"], {
        cwd: s.dir, timeoutMs: 1500,
      });
      assert(!result.timedOut, "FIFO lease reached the process timeout");
      assert(result.code === 3, "FIFO lease did not fail closed promptly\n" + result.out);
      assert(Date.now() - started < 1500, "FIFO lease reached the process timeout");
      rmSync(poison);
    }

    const invalidIdentity = "invalid::leaf";
    const invalid = s.path(".unlazy/locks/" + sha256(invalidIdentity).slice(0, 24) + ".lease");
    writeFileSync(invalid, JSON.stringify({ scope: "invalid", leaf: "leaf", globs: [] }) + "\n");
    result = await run(GATE_CHECK, ["--scope", "fresh", "--leaf", "leaf", "--claim"], {
      cwd: s.dir, timeoutMs: 1500,
    });
    assert(result.code === 3, "parseable empty-glob lease did not fail closed\n" + result.out);
    rmSync(invalid);

    result = await run(GATE_CHECK, ["--scope", "fresh", "--leaf", "leaf", "--claim"], {
      cwd: s.dir, timeoutMs: 1500,
    });
    assert(result.code === 0, "ordinary lease control failed\n" + result.out);
    has(result.out, "for fresh/leaf:");
  } finally { s.cleanup(); }
});

test("leases: an explicit release cleans orphaned leases after a scope directory is gone", async () => {
  const s = sandbox();
  try {
    const claimed = await claimLeases(s.dir, { scope: "gone", leaf: "leaf-gone", globs: ["src/gone/**"] });
    assert(claimed.ok, "fixture lease was not created");
    const result = await run(GATE_CHECK, ["--scope", "gone", "--leaf", "leaf-gone", "--release"], { cwd: s.dir });
    assert(result.code === 0, result.out);
    has(result.out, "released 1 lease(s) for gone/leaf-gone");
    const lockNames = readdirSync(s.path(".unlazy/locks"));
    assert(!lockNames.some((name) => name.endsWith(".lease")), "orphan lease remained: " + lockNames.join(", "));

    s.write(".unlazy/live/gates/leaf-live.md", "# malformed zero-gate ledger\n");
    const liveClaim = await claimLeases(s.dir, { scope: "live", leaf: "leaf-live", globs: ["src/live/**"] });
    assert(liveClaim.ok, "live fixture lease was not created");
    const liveRelease = await run(GATE_CHECK, ["--scope", "live", "--leaf", "leaf-live", "--release"], { cwd: s.dir });
    assert(liveRelease.code === 0, "malformed live ledger blocked release\n" + liveRelease.out);
    has(liveRelease.out, "released 1 lease(s) for live/leaf-live");
  } finally { s.cleanup(); }
});

test("hook: repeated 64-writer bursts are serialized without lost increments", async () => {
  const s = sandbox();
  try {
    s.write("GATES.md", "- [ ] G1: pending\n  EVIDENCE: pending\n");
    const payload = JSON.stringify({ cwd: s.dir, session_id: "one-session" });
    for (let round = 1; round <= 3; round++) {
      rmSync(s.path(".unlazy-hook-state.json"), { force: true });
      const results = await Promise.all(Array.from({ length: 64 }, () =>
        run(STOP_HOOK, [], { cwd: s.dir, stdin: payload })));
      const crashed = results.filter((result) => result.code !== 0);
      assert(crashed.length === 0,
        "round " + round + ": " + crashed.length + " hook process(es) failed\n" +
        [...new Set(crashed.map((result) => "exit=" + result.code + "\n" + result.out.trim()))]
          .slice(0, 4).join("\n---\n"));
      const failedUpdates = results
        .filter((result) => result.out.includes("could not update the serialized hook state"))
        .map((result) => result.out.trim());
      assert(failedUpdates.length === 0,
        "round " + round + ": " + failedUpdates.length + " hook(s) failed open on the state update\n" +
        [...new Set(failedUpdates)].slice(0, 4).join("\n---\n"));
      const state = JSON.parse(s.read(".unlazy-hook-state.json"));
      const sessions = Object.values(state.sessions);
      assert(sessions.length === 1, "round " + round + ": expected one session, got " + sessions.length);
      assert(sessions[0].blocks === 64, "round " + round + ": expected 64 blocks, got " + sessions[0].blocks);
    }
  } finally { s.cleanup(); }
});

test("hook: sessions remain isolated and completion/no-gates clears stale state", async () => {
  const s = sandbox();
  try {
    s.write("GATES.md", "- [ ] G1: pending\n  EVIDENCE: pending\n");
    for (const id of ["alpha", "beta"]) {
      const payload = JSON.stringify({ cwd: s.dir, session_id: id });
      await Promise.all(Array.from({ length: 3 }, () => run(STOP_HOOK, [], { cwd: s.dir, stdin: payload })));
    }
    let state = JSON.parse(s.read(".unlazy-hook-state.json"));
    assert(Object.keys(state.sessions).length === 2, "sessions were mixed: " + JSON.stringify(state));
    assert(Object.values(state.sessions).every((value) => value.blocks === 3), "session counters were not isolated");

    s.write("GATES.md", "- [x] G1: done\n  EVIDENCE: measured\n");
    await run(STOP_HOOK, [], { cwd: s.dir, stdin: JSON.stringify({ cwd: s.dir, session_id: "alpha" }) });
    state = JSON.parse(s.read(".unlazy-hook-state.json"));
    assert(Object.keys(state.sessions).length === 1, "completed alpha state was not cleared");

    rmSync(s.path("GATES.md"));
    await run(STOP_HOOK, [], { cwd: s.dir, stdin: JSON.stringify({ cwd: s.dir, session_id: "beta" }) });
    assert(!existsSync(s.path(".unlazy-hook-state.json")), "no-gates path did not clear final state");
  } finally { s.cleanup(); }
});

test("hook: a FIFO session binding is ignored promptly while a regular sibling binding resolves", async () => {
  if (process.platform === "win32") return;
  const s = sandbox();
  try {
    for (const scope of ["a", "b"]) {
      s.write(".unlazy/" + scope + "/gates/leaf.md",
        "# Gates\n- [ ] G1: pending\n  EVIDENCE: pending\n");
    }
    const fifo = s.path(".unlazy/a/session");
    const made = spawnSync("mkfifo", [fifo], { encoding: "utf8" });
    assert(made.status === 0, "could not create session FIFO: " + made.stderr);
    s.write(".unlazy/b/session", "wanted\n");

    const started = Date.now();
    const result = await run(STOP_HOOK, [], {
      cwd: s.dir,
      stdin: JSON.stringify({ cwd: s.dir, session_id: "wanted" }),
      timeoutMs: 2000,
    });
    assert(result.code === 0, "FIFO session routing failed\n" + result.out);
    assert(Date.now() - started < 1800, "session routing waited for the FIFO outer timeout");
    has(result.out, "[scope b]");

    rmSync(fifo);
    s.write(".unlazy/a/session", "other\n");
    const control = await run(STOP_HOOK, [], {
      cwd: s.dir,
      stdin: JSON.stringify({ cwd: s.dir, session_id: "wanted" }),
      timeoutMs: 2000,
    });
    assert(control.code === 0, "regular session control failed\n" + control.out);
    has(control.out, "[scope b]");
  } finally { s.cleanup(); }
});

test("hook: absent pinned scopes allow while existing unsafe pinned scopes block", async () => {
  if (process.platform === "win32") return;
  const s = sandbox();
  const outside = sandbox();
  try {
    const stdin = JSON.stringify({ cwd: s.dir, session_id: "pinned-scope" });
    const absent = await run(STOP_HOOK, ["--scope", "missing"], { cwd: s.dir, stdin });
    assert(absent.code === 0, "absent pinned scope process failed\n" + absent.out);
    assert(!absent.out.includes('"decision":"block"'), "absent scope blocked Stop\n" + absent.out);
    has(absent.out, "no such scope");

    mkdirSync(s.path(".unlazy"), { recursive: true });
    const canary = "OUTSIDE_SCOPE_CANARY_9417";
    outside.write("GATES.md", "# Gates\n- [ ] X1: " + canary + "\n  EVIDENCE: pending\n");
    outside.write("dispatch.json", JSON.stringify({ canary }) + "\n");
    outside.write("hook-state.json", JSON.stringify({ canary }) + "\n");
    const before = ["GATES.md", "dispatch.json", "hook-state.json"].map((file) => outside.read(file));
    symlinkSync(outside.dir, s.path(".unlazy/api"));

    const checker = await run(GATE_CHECK, ["--status", "--scope", "api"], { cwd: s.dir });
    assert(checker.code === 2, "symlinked pinned scope gate-check returned " + checker.code + "\n" + checker.out);
    has(checker.out, "scope directory must be a real directory inside the repository");
    assert(!checker.out.includes(canary), "gate-check read outside scope data\n" + checker.out);

    const hook = await run(STOP_HOOK, ["--scope", "api"], { cwd: s.dir, stdin });
    assert(hook.code === 0, "symlinked pinned scope hook process failed\n" + hook.out);
    has(hook.out, '"decision":"block"');
    has(hook.out, "scope directory must be a real directory inside the repository");
    assert(!hook.out.includes(canary), "hook read outside scope data\n" + hook.out);
    assert(existsSync(s.path(".unlazy-hook-state.json")), "invalid scope did not use safe root hook state");
    for (const [index, file] of ["GATES.md", "dispatch.json", "hook-state.json"].entries()) {
      assert(outside.read(file) === before[index], "hook or checker changed outside " + file);
    }
  } finally {
    // Node 16's recursive rm rejects a directory symlink with EISDIR on some
    // platforms. Remove the named link explicitly; never traverse its target.
    try { unlinkSync(s.path(".unlazy/api")); } catch { /* absent or unsupported */ }
    s.cleanup();
    outside.cleanup();
  }
});

test("hook: named special ledgers fail closed promptly instead of becoming no gates", async () => {
  if (process.platform === "win32") return;
  const s = sandbox();
  const outside = sandbox();
  try {
    const payload = JSON.stringify({ cwd: s.dir, session_id: "special-ledger" });
    const assertBlocked = async (label) => {
      const started = Date.now();
      const result = await run(STOP_HOOK, [], { cwd: s.dir, stdin: payload, timeoutMs: 1500 });
      assert(result.code === 0, label + " hook process failed\n" + result.out);
      assert(Date.now() - started < 1500, label + " reached the process timeout");
      has(result.out, '"decision":"block"');
      has(result.out, "gate/ledger/dispatch item(s) need work");
      return result;
    };

    const fifo = s.path("GATES.md");
    let made = spawnSync("mkfifo", [fifo], { encoding: "utf8" });
    assert(made.status === 0, "could not create hook ledger FIFO: " + made.stderr);
    await assertBlocked("FIFO ledger");
    rmSync(fifo);

    const victim = outside.write("outside.md",
      "# Gates\n- [ ] X1: OUTSIDE_HOOK_CANARY_5097\n  EVIDENCE: pending\n");
    symlinkSync(victim, fifo);
    const linked = await assertBlocked("symlinked ledger");
    assert(!linked.out.includes("OUTSIDE_HOOK_CANARY_5097"), "hook read the symlink victim\n" + linked.out);
    rmSync(fifo);

    const outsideGates = outside.path("gates");
    mkdirSync(outsideGates);
    outside.write("gates/leaf.md",
      "# Gates\n- [ ] X2: OUTSIDE_HOOK_CANARY_5097\n  EVIDENCE: pending\n");
    symlinkSync(outsideGates, s.path("gates"));
    const directory = await assertBlocked("symlinked gates directory");
    assert(!directory.out.includes("OUTSIDE_HOOK_CANARY_5097"),
      "hook traversed the symlinked gates directory\n" + directory.out);
  } finally {
    s.cleanup();
    outside.cleanup();
  }
});

test("hook: linked and FIFO progress state never blocks or changes a victim", async () => {
  const s = sandbox();
  try {
    s.write("GATES.md", "# Gates\n- [ ] G1: pending\n  EVIDENCE: pending\n");
    const payload = JSON.stringify({ cwd: s.dir, session_id: "special-state" });
    const statePath = s.path(".unlazy-hook-state.json");
    const victim = s.write("state-victim.json", '{"schema":1,"sessions":{}}\n');
    const original = s.read("state-victim.json");

    linkSync(victim, statePath);
    let result = await run(STOP_HOOK, [], { cwd: s.dir, stdin: payload, timeoutMs: 1500 });
    assert(result.code === 0, "hard-linked hook state process failed\n" + result.out);
    has(result.out, "could not update the serialized hook state");
    assert(s.read("state-victim.json") === original, "hook changed the hard-link victim");
    rmSync(statePath);

    if (process.platform !== "win32") {
      symlinkSync(victim, statePath);
      result = await run(STOP_HOOK, [], { cwd: s.dir, stdin: payload, timeoutMs: 1500 });
      assert(result.code === 0, "symlinked hook state process failed\n" + result.out);
      has(result.out, "could not update the serialized hook state");
      assert(s.read("state-victim.json") === original, "hook changed the symlink victim");
      rmSync(statePath);

      const made = spawnSync("mkfifo", [statePath], { encoding: "utf8" });
      assert(made.status === 0, "could not create hook-state FIFO: " + made.stderr);
      const started = Date.now();
      result = await run(STOP_HOOK, [], { cwd: s.dir, stdin: payload, timeoutMs: 1500 });
      assert(result.code === 0 && Date.now() - started < 1500,
        "FIFO hook state did not fail promptly\n" + result.out);
      has(result.out, "could not update the serialized hook state");
      assert(lstatSync(statePath).isFIFO(), "hook replaced the FIFO state path");
    }
  } finally { s.cleanup(); }
});

test("atomic writer: predictable pre-created temp links are never followed", async () => {
  if (process.platform === "win32") return;
  const s = sandbox();
  try {
    s.write("victim.txt", "safe\n");
    const target = s.path("state.json");
    symlinkSync(s.path("victim.txt"), target + "." + process.pid + ".tmp");
    writeAtomic(target, "new\n");
    assert(s.read("victim.txt") === "safe\n", "predictable temp symlink was followed");
    assert(s.read("state.json") === "new\n", "target was not written");
  } finally { s.cleanup(); }
});

test("status log: an existing symlink is refused without touching its target", async () => {
  if (process.platform === "win32") return;
  const s = sandbox();
  try {
    s.write(".unlazy/api/GATES.md", "# Gates\n\n- [ ] G1: pending\n  EVIDENCE: pending\n");
    s.write("victim.txt", "safe\n");
    symlinkSync(s.path("victim.txt"), s.path(".unlazy/api/status.log"));
    const result = await run(GATE_CHECK, ["--scope", "api", "--log", "attacker-controlled append"], { cwd: s.dir });
    assert(result.code === 2, "symlinked status log should fail closed\n" + result.out);
    has(result.out, "cannot append status");
    assert(s.read("victim.txt") === "safe\n", "status append followed the symlink");
  } finally { s.cleanup(); }
});

test("status log: an existing hard link is refused without touching its sibling", async () => {
  const s = sandbox();
  try {
    s.write(".unlazy/api/GATES.md", "# Gates\n\n- [ ] G1: pending\n  EVIDENCE: pending\n");
    s.write("victim.txt", "safe\n");
    linkSync(s.path("victim.txt"), s.path(".unlazy/api/status.log"));
    const result = await run(GATE_CHECK, ["--scope", "api", "--log", "attacker-controlled append"], { cwd: s.dir });
    assert(result.code === 2, "hard-linked status log should fail closed\n" + result.out);
    has(result.out, "cannot append status");
    assert(s.read("victim.txt") === "safe\n", "status append followed the hard link");
  } finally { s.cleanup(); }
});

test("status log: a FIFO is rejected without blocking the logger", async () => {
  if (process.platform === "win32") return;
  const s = sandbox();
  try {
    s.write(".unlazy/api/GATES.md", "# Gates\n\n- [ ] G1: pending\n  EVIDENCE: pending\n");
    const fifo = s.path(".unlazy/api/status.log");
    const made = spawnSync("mkfifo", [fifo], { encoding: "utf8" });
    assert(made.status === 0, "could not create FIFO fixture: " + made.stderr);
    const started = Date.now();
    const result = await run(GATE_CHECK, ["--scope", "api", "--log", "must not block"], {
      cwd: s.dir,
      timeoutMs: 2000,
    });
    assert(result.code === 2, "FIFO logger did not fail closed\n" + result.out);
    assert(Date.now() - started < 1800, "FIFO validation waited for the outer timeout");
    has(result.out, "cannot append status");
  } finally { s.cleanup(); }
});

test("installer: malformed settings shapes are refused without mutation", async () => {
  const fixtures = [
    "[]\n",
    JSON.stringify({ hooks: [] }, null, 2) + "\n",
    JSON.stringify({ hooks: { Stop: {} } }, null, 2) + "\n",
    JSON.stringify({ hooks: { Stop: [{ hooks: {} }] } }, null, 2) + "\n",
    JSON.stringify({ hooks: { Stop: [{ hooks: [null] }] } }, null, 2) + "\n",
  ];
  for (const fixture of fixtures) {
    const s = sandbox();
    try {
      s.write(".claude/settings.local.json", fixture);
      const result = await run(INSTALL, [], { cwd: s.dir });
      assert(result.code === 1, "invalid shape should fail\n" + result.out);
      assert(s.read(".claude/settings.local.json") === fixture, "invalid settings were mutated");
    } finally { s.cleanup(); }
  }
});

test("installer: a FIFO settings target is rejected without blocking", async () => {
  if (process.platform === "win32") return;
  const s = sandbox();
  try {
    mkdirSync(s.path(".claude"), { recursive: true });
    const target = s.path(".claude/settings.local.json");
    const made = spawnSync("mkfifo", [target], { encoding: "utf8" });
    assert(made.status === 0, "could not create FIFO fixture: " + made.stderr);
    const started = Date.now();
    const result = await run(INSTALL, [], { cwd: s.dir, timeoutMs: 2000 });
    assert(result.code === 1, "FIFO installer target did not fail closed\n" + result.out);
    assert(Date.now() - started < 1800, "FIFO installer validation blocked");
    has(result.out, "Refusing to touch");
  } finally { s.cleanup(); }
});

test("installer: uninstall preserves a sibling in the same matcher group and writes a backup", async () => {
  const s = sandbox();
  try {
    const original = JSON.stringify({
      hooks: {
        Stop: [{
          matcher: "",
          hooks: [
            { type: "command", command: "node other-tool.mjs" },
            { type: "command", command: "node /tmp/unlazy/scripts/stop-hook.mjs --unlazy" },
          ],
        }],
      },
    }, null, 2) + "\n";
    s.write(".claude/settings.local.json", original);
    const result = await run(INSTALL, ["--uninstall"], { cwd: s.dir });
    assert(result.code === 0, result.out);
    const after = JSON.parse(s.read(".claude/settings.local.json"));
    assert(after.hooks.Stop.length === 1, "matcher group was removed");
    assert(after.hooks.Stop[0].matcher === "", "matcher metadata was lost");
    assert(after.hooks.Stop[0].hooks.length === 1, "wrong handler count");
    has(after.hooks.Stop[0].hooks[0].command, "other-tool.mjs");
    assert(s.read(".claude/settings.local.json.unlazy.bak") === original, "backup did not preserve original bytes");
  } finally { s.cleanup(); }
});

test("installer: marker substrings do not claim an unrelated stop hook", async () => {
  const s = sandbox();
  try {
    const unrelated = [
      "node /opt/other/stop-hook.mjs --unlazy-helper",
      "node /opt/unlazy/scripts/stop-hook.mjs --unlazy-helper",
      "node " + JSON.stringify(STOP_HOOK) + " --unlazy-helper",
      "node " + JSON.stringify(STOP_HOOK) + " \"--unlazy-helper\"",
    ];
    s.write(".claude/settings.local.json", JSON.stringify({
      hooks: { Stop: [{ hooks: unrelated.map((command) => ({ type: "command", command, timeout: 20 })) }] },
    }, null, 2) + "\n");
    const result = await run(INSTALL, ["--uninstall"], { cwd: s.dir });
    assert(result.code === 0, result.out);
    has(result.out, "Nothing to remove");
    const after = JSON.parse(s.read(".claude/settings.local.json"));
    assert(after.hooks.Stop[0].hooks.map((hook) => hook.command).join("\n") === unrelated.join("\n"),
      "unrelated hook was removed");
  } finally { s.cleanup(); }
});

test("installer: a matching command with broken managed fields is repaired", async () => {
  const s = sandbox();
  try {
    const installed = await run(INSTALL, [], { cwd: s.dir });
    assert(installed.code === 0, installed.out);
    const settings = JSON.parse(s.read(".claude/settings.local.json"));
    const handler = settings.hooks.Stop[0].hooks[0];
    handler.type = "prompt";
    handler.timeout = 1;
    s.write(".claude/settings.local.json", JSON.stringify(settings, null, 2) + "\n");
    const repaired = await run(INSTALL, [], { cwd: s.dir });
    assert(repaired.code === 0, repaired.out);
    assert(!repaired.out.includes("Already installed"), "broken handler was treated as current");
    const after = JSON.parse(s.read(".claude/settings.local.json"));
    const managed = after.hooks.Stop.flatMap((group) => group.hooks)
      .filter((item) => typeof item.command === "string" && item.command.includes("--unlazy"));
    assert(managed.length === 1, "repair did not leave exactly one managed handler");
    assert(managed[0].type === "command", "repair did not restore command type");
    assert(managed[0].timeout === 20, "repair did not restore timeout");
  } finally { s.cleanup(); }
});

test("installer: scope input is validated and local state warning is explicit", async () => {
  const s = sandbox();
  try {
    const invalid = await run(INSTALL, ["--scope", "bad;echo"], { cwd: s.dir });
    assert(invalid.code === 2, invalid.out);
    assert(!existsSync(s.path(".claude/settings.local.json")), "invalid scope wrote settings");
    const good = await run(INSTALL, ["--scope", "api"], { cwd: s.dir });
    assert(good.code === 0, good.out);
    has(good.out, ".unlazy/");
    has(good.out, ".unlazy-hook-state.json");
    const settings = JSON.parse(s.read(".claude/settings.local.json"));
    const command = settings.hooks.Stop[0].hooks[0].command;
    has(command, "--scope api");
  } finally { s.cleanup(); }
});

let passed = 0;
const failures = [];
for (const item of tests) {
  try {
    await item.fn();
    passed++;
    console.log("ok   " + item.name);
  } catch (error) {
    failures.push(item.name);
    console.log("FAIL " + item.name + "\n     " + String(error.message).replace(/\n/g, "\n     "));
  }
}
console.log("\n" + passed + "/" + tests.length + " passed");
if (failures.length) {
  console.log("failed: " + failures.join(", "));
  process.exit(1);
}
