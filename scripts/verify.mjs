#!/usr/bin/env node
// verify.mjs : self-test for the unlazy scripts. Zero dependencies. Node 16+.
//
// Exercises the full CONTRIBUTING matrix plus known regressions:
//   gate-check: passing check, failing check, regex EXPECT, manual gate,
//     ABANDON, --status, --reverify (forged evidence caught, reproducible
//     evidence passes), usage validation, unindented attributes, CRLF
//     preservation, per-check timeout, fenced examples ignored, positional
//     file args at index 0 (regression), missing EVIDENCE lines inserted
//   stop-hook: no-gates allow, block, ABANDON allow, all-met allow, release
//     after 6 no-progress blocks, progress reset, malformed stdin, fenced
//     examples ignored
//   install-hooks: install, idempotence, uninstall round trip
//
// Exit code: 0 = all checks pass, 1 = at least one failure.

import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const NODE = process.execPath;
const GATE_CHECK = join(here, "gate-check.mjs");
const STOP_HOOK = join(here, "stop-hook.mjs");
const INSTALLER = join(here, "install-hooks.mjs");

let passed = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failures.push(name); console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ""}`); }
}

function sandbox(tag) {
  return mkdtempSync(join(tmpdir(), `unlazy-verify-${tag}-`));
}

function run(script, argv, opts = {}) {
  return spawnSync(NODE, [script, ...argv], { encoding: "utf8", timeout: 60000, ...opts });
}

function gateCheck(argv, cwd) {
  const r = run(GATE_CHECK, argv, { cwd });
  return { code: r.status, out: `${r.stdout || ""}${r.stderr || ""}` };
}

function hook(payload, cwd) {
  const r = spawnSync(NODE, [STOP_HOOK], { input: payload, encoding: "utf8", timeout: 60000, cwd });
  return { code: r.status, out: (r.stdout || "").trim() };
}

console.log("gate-check.mjs");

{
  const d = sandbox("pass");
  writeFileSync(join(d, "GATES.md"), [
    "# Gates: t",
    "- [ ] G1: echo gate",
    "  CHECK: echo \"8/8 passed\"",
    "  EXPECT: 8/8 passed",
    "  EVIDENCE: pending",
    "",
  ].join("\n"));
  const r = gateCheck(["GATES.md"], d);
  check("passing check flips box, records evidence, exits 0",
    r.code === 0 && /PASS G1/.test(r.out) && /ALL MET/.test(r.out), r.out);
  const after = readFileSync(join(d, "GATES.md"), "utf8");
  check("file updated with checked box and evidence",
    after.includes("- [x] G1") && /EVIDENCE: 8\/8 passed/.test(after), after);
  rmSync(d, { recursive: true, force: true });
}

{
  const d = sandbox("fail");
  writeFileSync(join(d, "GATES.md"),
    "- [ ] G1: nope\n  CHECK: echo wrong\n  EXPECT: right\n  EVIDENCE: pending\n");
  const r = gateCheck(["GATES.md"], d);
  check("failing check reports FAIL and exits 1",
    r.code === 1 && /FAIL G1/.test(r.out), r.out);
  check("failing gate left untouched in file",
    readFileSync(join(d, "GATES.md"), "utf8").includes("- [ ] G1"));
  rmSync(d, { recursive: true, force: true });
}

{
  const d = sandbox("matrix");
  writeFileSync(join(d, "GATES.md"), [
    "- [ ] G1: regex",
    "  CHECK: echo \"total: 42 items\"",
    "  EXPECT: /total: \\d+ items/",
    "  EVIDENCE: pending",
    "- [x] G2: manual with evidence",
    "  EVIDENCE: file:12 quotes it",
    "- [ ] G3: manual unmet",
    "  EVIDENCE: pending",
    "ABANDON: G3 impossible in fixture",
    "",
  ].join("\n"));
  const before = readFileSync(join(d, "GATES.md"), "utf8");
  const st = gateCheck(["--status"], d);
  check("--status reports unmet gates without running or changing anything",
    st.code === 1 && /UNMET G1/.test(st.out) && readFileSync(join(d, "GATES.md"), "utf8") === before, st.out);
  const r = gateCheck(["GATES.md"], d);
  check("regex EXPECT passes; ABANDON counts as an honest exit",
    r.code === 0 && /PASS G1/.test(r.out) && /1 abandoned/.test(r.out), r.out);
  rmSync(d, { recursive: true, force: true });
}

{
  // Regression: a positional file argument at index 0 was silently dropped
  // whenever --timeout was absent (off-by-one in the arg filter).
  const d = sandbox("arg0");
  mkdirSync(join(d, "elsewhere"));
  writeFileSync(join(d, "elsewhere", "custom-gates.md"),
    "- [ ] X1: explicit arg\n  CHECK: echo ok\n  EXPECT: ok\n  EVIDENCE: pending\n");
  const r = gateCheck(["elsewhere/custom-gates.md"], d);
  check("regression: positional file arg at index 0 runs the named file",
    r.code === 0 && /PASS X1/.test(r.out), r.out);
  rmSync(d, { recursive: true, force: true });
}

{
  // Regression: hand-checked boxes with forged evidence passed every layer.
  const d = sandbox("liar");
  mkdirSync(join(d, "gates"));
  writeFileSync(join(d, "gates", "leaf-liar.md"), [
    "- [x] G1: forged evidence",
    "  CHECK: echo nope",
    "  EXPECT: 42/42 passed",
    "  EVIDENCE: 42/42 passed (forged)",
    "",
  ].join("\n"));
  const plain = gateCheck(["gates/leaf-liar.md"], d);
  check("precondition: forged evidence still passes a plain run", plain.code === 0, plain.out);
  const rv = gateCheck(["--reverify", "gates/leaf-liar.md"], d);
  check("--reverify catches forged evidence",
    rv.code === 1 && /FAIL G1/.test(rv.out) && /reverify/.test(rv.out), rv.out);
  const after = readFileSync(join(d, "gates", "leaf-liar.md"), "utf8");
  check("--reverify demotes the gate to unchecked with pending evidence",
    after.includes("- [ ] G1") && after.includes("EVIDENCE: pending"), after);
  rmSync(d, { recursive: true, force: true });
}

{
  const d = sandbox("genuine");
  writeFileSync(join(d, "GATES.md"), [
    "- [x] G1: genuinely met",
    "  CHECK: echo stable-output",
    "  EXPECT: stable-output",
    "  EVIDENCE: stable-output",
    "",
  ].join("\n"));
  const rv = gateCheck(["--reverify"], d);
  check("--reverify keeps reproducible evidence met",
    rv.code === 0 && /PASS G1/.test(rv.out) && /reverified: 1/.test(rv.out), rv.out);
  rmSync(d, { recursive: true, force: true });
}

{
  const d = sandbox("usage");
  writeFileSync(join(d, "GATES.md"), "- [ ] G1: x\n  EVIDENCE: pending\n");
  check("--status with --reverify is a usage error", gateCheck(["--status", "--reverify"], d).code === 2);
  check("unknown flag is a usage error", gateCheck(["--nope"], d).code === 2);
  check("invalid --timeout value is a usage error", gateCheck(["--timeout", "abc"], d).code === 2);
  check("zero --timeout is a usage error", gateCheck(["--timeout", "0"], d).code === 2);
  check("missing --timeout value is a usage error", gateCheck(["--timeout"], d).code === 2);
  rmSync(d, { recursive: true, force: true });
}

{
  const d = sandbox("indent");
  writeFileSync(join(d, "GATES.md"), [
    "- [ ] G1: unindented attrs",
    "CHECK: echo ok",
    "EXPECT: ok",
    "EVIDENCE: pending",
    "",
  ].join("\n"));
  const r = gateCheck(["--status"], d);
  check("unindented attribute lines warn and are ignored",
    /unindented/i.test(r.out) && /UNMET G1/.test(r.out), r.out);
  rmSync(d, { recursive: true, force: true });
}

{
  const d = sandbox("crlf");
  writeFileSync(join(d, "GATES.md"),
    "- [ ] G1: crlf file\r\n  CHECK: echo ok\r\n  EXPECT: ok\r\n  EVIDENCE: pending\r\n");
  const r = gateCheck(["GATES.md"], d);
  const after = readFileSync(join(d, "GATES.md"), "utf8");
  check("CRLF line endings are preserved on write",
    r.code === 0 && after.includes("- [x] G1: crlf file\r\n") && after.includes("EVIDENCE: ok\r\n"), after);
  rmSync(d, { recursive: true, force: true });
}

{
  const d = sandbox("timeout");
  writeFileSync(join(d, "GATES.md"), [
    "- [ ] G1: slow",
    "  CHECK: node -e \"setTimeout(()=>console.log('done'),5000)\"",
    "  EXPECT: done",
    "  EVIDENCE: pending",
    "",
  ].join("\n"));
  const r = gateCheck(["--timeout", "1"], d);
  check("per-check timeout fails a hanging command",
    r.code === 1 && /FAIL G1/.test(r.out), r.out);
  rmSync(d, { recursive: true, force: true });
}

{
  const d = sandbox("fence");
  writeFileSync(join(d, "GATES.md"), [
    "# Gates: real",
    "- [x] G1: real gate",
    "  EVIDENCE: real",
    "",
    "Example format for docs:",
    "",
    "```markdown",
    "- [ ] B1: example gate inside a fence",
    "  CHECK: echo never-runs",
    "  EXPECT: never-runs",
    "  EVIDENCE: pending",
    "```",
    "",
  ].join("\n"));
  const r = gateCheck(["--status"], d);
  check("fenced example gates are ignored",
    r.code === 0 && !/B1/.test(r.out), r.out);
  rmSync(d, { recursive: true, force: true });
}

{
  // Regression: a passing gate with a CHECK line but no EVIDENCE line flipped
  // its box but could never count as met, because the proof had nowhere to go.
  const d = sandbox("noev");
  writeFileSync(join(d, "GATES.md"),
    "- [ ] G1: no evidence line\n  CHECK: echo ok\n  EXPECT: ok\n");
  const r = gateCheck(["GATES.md"], d);
  const after = readFileSync(join(d, "GATES.md"), "utf8");
  check("passing gate without an EVIDENCE line gets one inserted",
    r.code === 0 && /EVIDENCE: ok/.test(after), r.out + "\n" + after);
  rmSync(d, { recursive: true, force: true });
}

{
  const d = sandbox("noev2");
  writeFileSync(join(d, "GATES.md"), [
    "- [ ] G1: no evidence line",
    "  CHECK: echo one",
    "  EXPECT: one",
    "- [ ] G2: has evidence line",
    "  CHECK: echo two",
    "  EXPECT: two",
    "  EVIDENCE: pending",
    "",
  ].join("\n"));
  const r = gateCheck(["GATES.md"], d);
  const after = readFileSync(join(d, "GATES.md"), "utf8");
  check("evidence insertion keeps later gates' lines intact",
    r.code === 0 && /PASS G2/.test(r.out) && after.includes("- [x] G1") && after.includes("- [x] G2"),
    r.out + "\n" + after);
  rmSync(d, { recursive: true, force: true });
}

console.log("stop-hook.mjs");

{
  const d = sandbox("hook-empty");
  const r = hook(JSON.stringify({ cwd: d }), d);
  check("no gate files allows silently", r.code === 0 && r.out === "", r.out);
  rmSync(d, { recursive: true, force: true });
}

{
  const d = sandbox("hook-core");
  const payload = JSON.stringify({ cwd: d });
  writeFileSync(join(d, "GATES.md"), [
    "- [ ] G1: unchecked",
    "  CHECK: echo ok",
    "  EXPECT: ok",
    "  EVIDENCE: pending",
    "- [x] G2: checked, evidence pending",
    "  EVIDENCE: pending",
    "- [x] G3: met",
    "  EVIDENCE: measured 42",
    "",
  ].join("\n"));
  const blocked = hook(payload, d);
  let parsed = {};
  try { parsed = JSON.parse(blocked.out); } catch { /* leave empty */ }
  check("unmet gates block with decision and reason",
    blocked.code === 0 && parsed.decision === "block" && /G1, G2/.test(parsed.reason || ""), blocked.out);

  writeFileSync(join(d, "GATES.md"),
    "- [ ] G1: unchecked\n  EVIDENCE: pending\nABANDON: G1 done enough for the fixture\n");
  const abandoned = hook(payload, d);
  check("ABANDON lines allow the stop", abandoned.code === 0 && abandoned.out === "", abandoned.out);

  writeFileSync(join(d, "GATES.md"), "- [x] G1: met\n  EVIDENCE: measured\n");
  const met = hook(payload, d);
  check("all gates met allows silently", met.code === 0 && met.out === "", met.out);

  const malformed = hook("not json", d);
  check("malformed stdin stays permissive", malformed.code === 0 && malformed.out === "", malformed.out);
  rmSync(d, { recursive: true, force: true });
}

{
  const d = sandbox("hook-release");
  const payload = JSON.stringify({ cwd: d });
  writeFileSync(join(d, "GATES.md"), "- [ ] G1: stuck\n  EVIDENCE: pending\n");
  let out = "";
  for (let i = 0; i < 7; i++) out = hook(payload, d).out;
  let parsed = {};
  try { parsed = JSON.parse(out); } catch { /* leave empty */ }
  check("releases with a systemMessage after 6 no-progress blocks",
    typeof parsed.systemMessage === "string" && /releasing/.test(parsed.systemMessage), out);
  rmSync(d, { recursive: true, force: true });
}

{
  const d = sandbox("hook-progress");
  const payload = JSON.stringify({ cwd: d });
  writeFileSync(join(d, "GATES.md"), "- [ ] G1: work\n  EVIDENCE: pending\n");
  hook(payload, d); // blocks: 1
  writeFileSync(join(d, "GATES.md"), "- [ ] G1: work\n  EVIDENCE: pending\n\n- notes appended\n");
  const second = hook(payload, d);
  const state = JSON.parse(readFileSync(join(d, ".unlazy-hook-state.json"), "utf8"));
  check("gate-file progress resets the block counter",
    second.out.includes("\"decision\":\"block\"") && state.blocks === 1,
    JSON.stringify(state) + " " + second.out);
  rmSync(d, { recursive: true, force: true });
}

{
  const d = sandbox("hook-fence");
  writeFileSync(join(d, "GATES.md"), [
    "- [x] G1: met",
    "  EVIDENCE: real",
    "```markdown",
    "- [ ] B1: fenced example",
    "  EVIDENCE: pending",
    "```",
    "",
  ].join("\n"));
  const r = hook(JSON.stringify({ cwd: d }), d);
  check("fenced example gates do not block", r.code === 0 && r.out === "", r.out);
  rmSync(d, { recursive: true, force: true });
}

console.log("install-hooks.mjs");

{
  const d = sandbox("installer");
  const target = join(d, ".claude", "settings.local.json");
  const i1 = run(INSTALLER, [], { cwd: d });
  const s1 = JSON.parse(readFileSync(target, "utf8"));
  const cmd = (s1.hooks && s1.hooks.Stop && s1.hooks.Stop[0].hooks[0].command) || "";
  check("installs a Stop entry into settings.local.json",
    i1.status === 0 && cmd.includes("stop-hook.mjs"), JSON.stringify(s1));
  const i2 = run(INSTALLER, [], { cwd: d });
  const s2 = JSON.parse(readFileSync(target, "utf8"));
  check("second install is idempotent",
    i2.status === 0 && JSON.stringify(s2) === JSON.stringify(s1));
  const u = run(INSTALLER, ["--uninstall"], { cwd: d });
  const s3 = JSON.parse(readFileSync(target, "utf8"));
  check("uninstall removes the entry and cleans up",
    u.status === 0 && !s3.hooks, JSON.stringify(s3));
  rmSync(d, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("failed: " + failures.join(", "));
  process.exit(1);
}
