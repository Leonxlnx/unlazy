#!/usr/bin/env node
// Keep a stable process-group leader alive until CHECK stdio closes.
// Zero dependencies. Node 16+.

import { spawn } from "node:child_process";

const [shell, command] = process.argv.slice(2);
if (!shell || command === undefined) {
  console.error("unlazy-check-supervisor: expected resolved shell and CHECK command");
  process.exit(2);
}

let child;
let spawnError = null;
try {
  child = spawn(command, {
    cwd: process.cwd(),
    shell,
    windowsHide: true,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch (error) {
  console.error("unlazy-check-supervisor: could not start CHECK: " + error.message);
  process.exit(127);
}

// Pipe instead of inheriting descriptors directly. Node's `close` event then
// waits for descendants that inherited the shell's stdout or stderr, keeping
// this detached supervisor alive as the original process-group identity.
child.stdout.pipe(process.stdout, { end: false });
child.stderr.pipe(process.stderr, { end: false });
child.once("error", (error) => { spawnError = error; });
child.once("close", (code, signal) => {
  if (spawnError) {
    console.error("unlazy-check-supervisor: CHECK spawn failed: " + spawnError.message);
    process.exitCode = 127;
    return;
  }
  if (Number.isInteger(code)) {
    process.exitCode = code;
    return;
  }
  console.error("unlazy-check-supervisor: CHECK ended by " + (signal || "unknown signal"));
  process.exitCode = 1;
});
