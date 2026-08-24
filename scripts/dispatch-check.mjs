#!/usr/bin/env node
// Records and checks the all-starts-before-wait dispatch contract. Node 16+.

import { resolve } from "node:path";
import { getDispatchWave, updateDispatch } from "./lib/dispatch.mjs";

const COMMANDS = new Set(["open", "start", "seal", "return", "abandon", "status"]);
const args = process.argv.slice(2);

function usage() {
  return [
    "Usage:",
    "  dispatch-check.mjs open --scope ID --wave ID --leaf ID [--leaf ID ...] [--root PATH]",
    "  dispatch-check.mjs start --scope ID --wave ID --leaf ID --handle OPAQUE_ID [--root PATH]",
    "  dispatch-check.mjs seal --scope ID --wave ID [--root PATH]",
    "  dispatch-check.mjs return --scope ID --wave ID --leaf ID [--root PATH]",
    "  dispatch-check.mjs abandon --scope ID --wave ID --reason TEXT [--root PATH]",
    "  dispatch-check.mjs status --scope ID --wave ID [--root PATH]",
  ].join("\n");
}

function die(message) {
  const safe = String(message).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
  console.error("unlazy dispatch: " + safe);
  process.exit(2);
}

if (!args.length || args[0] === "--help" || args[0] === "-h") {
  console.log(usage());
  process.exit(args.length ? 0 : 2);
}

const command = args.shift();
if (!COMMANDS.has(command)) die("unknown command " + command + "\n" + usage());

const options = { root: process.cwd(), scope: null, wave: null, leaves: [], handle: null, reason: null };
const single = new Set();
while (args.length) {
  const option = args.shift();
  if (!["--root", "--scope", "--wave", "--leaf", "--handle", "--reason"].includes(option)) die("unknown option " + option);
  if (!args.length || args[0].startsWith("--")) die(option + " requires a value");
  const value = args.shift();
  if (option === "--leaf") options.leaves.push(value);
  else {
    if (single.has(option)) die(option + " may be provided only once");
    single.add(option);
    options[option.slice(2)] = value;
  }
}

if (!options.scope) die("--scope is required");
if (!options.wave) die("--wave is required");
options.root = resolve(options.root);

if (command === "open") {
  if (!options.leaves.length) die("open requires at least one --leaf");
  if (options.handle !== null || options.reason !== null) die("open does not accept --handle or --reason");
} else if (command === "start") {
  if (options.leaves.length !== 1) die("start requires exactly one --leaf");
  if (options.handle === null) die("start requires --handle");
  if (options.reason !== null) die("start does not accept --reason");
} else if (command === "return") {
  if (options.leaves.length !== 1) die("return requires exactly one --leaf");
  if (options.handle !== null || options.reason !== null) die("return does not accept --handle or --reason");
} else if (command === "abandon") {
  if (options.leaves.length || options.handle !== null) die("abandon does not accept --leaf or --handle");
  if (options.reason === null || !options.reason.trim()) die("abandon requires --reason");
} else if (options.leaves.length || options.handle !== null || options.reason !== null) {
  die(command + " does not accept --leaf, --handle, or --reason");
}

const summary = (wave, id) => {
  const started = Object.keys(wave.started).length;
  const returned = Object.keys(wave.returned).length;
  if (wave.state === "complete") return "COMPLETE " + id + " (" + returned + "/" + wave.leaves.length + " returned)";
  if (wave.state === "abandoned") return "ABANDONED " + id + " (" + started + "/" + wave.leaves.length +
    " started, " + returned + "/" + wave.leaves.length + " returned): " + wave.reason;
  return wave.state.toUpperCase() + " " + id + " (" + started + "/" + wave.leaves.length +
    " started, " + returned + "/" + wave.leaves.length + " returned)";
};

try {
  if (command === "status") {
    const wave = getDispatchWave(options.root, options.scope, options.wave);
    console.log(summary(wave, options.wave));
    process.exit(wave.state === "complete" ? 0 : 1);
  }

  const wave = await updateDispatch(options.root, {
    action: command,
    scope: options.scope,
    wave: options.wave,
    leaves: options.leaves,
    leaf: options.leaves[0],
    handle: options.handle,
    reason: options.reason,
  });
  const started = Object.keys(wave.started).length;
  const returned = Object.keys(wave.returned).length;
  if (command === "open") console.log("OPEN " + options.wave + " (0/" + wave.leaves.length + " started, 0/" + wave.leaves.length + " returned)");
  else if (command === "start") console.log("STARTED " + options.wave + " " + options.leaves[0] + " (" + started + "/" + wave.leaves.length + " started)");
  else if (command === "seal") console.log("SEALED " + options.wave + " (" + started + "/" + wave.leaves.length + " started)");
  else if (command === "abandon") console.log(summary(wave, options.wave));
  else if (wave.state === "complete") console.log("COMPLETE " + options.wave + " (" + returned + "/" + wave.leaves.length + " returned)");
  else console.log("RETURNED " + options.wave + " " + options.leaves[0] + " (" + returned + "/" + wave.leaves.length + " returned)");
} catch (error) {
  die(error.message);
}
