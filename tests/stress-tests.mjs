#!/usr/bin/env node
// Concurrency and mutation stress tests. Zero dependencies. Node 16+.

import {
  existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync,
  symlinkSync, writeFileSync,
} from "node:fs";
import { execFile, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { claimLeases, releaseLeases, writeAtomic } from "../scripts/lib/gates.mjs";

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
      done({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, out: (stdout || "") + (stderr || "") });
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
