// Best-effort process-tree cleanup shared by the gate runner and tests.
// Zero dependencies. Node 16+.

import { spawnSync as nodeSpawnSync } from "node:child_process";
import { win32 } from "node:path";

export const WINDOWS_TASKKILL_TIMEOUT_MS = 1000;

export function windowsTaskkillPath(env = process.env) {
  const normalizeRoot = (value) => String(value || "").replace(/\//g, "\\").replace(/\\+$/, "");
  const systemRoot = normalizeRoot(env.SystemRoot);
  const windir = normalizeRoot(env.WINDIR);
  const systemDrive = String(env.SystemDrive || "").replace(/[\\/]+$/, "").toUpperCase();
  const driveRoot = /^[A-Za-z]:\\Windows$/i;
  // Require the three standard Windows launcher values to identify the same
  // drive-root directory. A single arbitrary absolute variable must not select
  // an executable, and disagreement fails closed to the ChildProcess handle.
  if (driveRoot.test(systemRoot) && driveRoot.test(windir) &&
      systemRoot.toLowerCase() === windir.toLowerCase() &&
      systemDrive === systemRoot.slice(0, 2).toUpperCase()) {
    return win32.join(systemRoot, "System32", "taskkill.exe");
  }
  // A bare executable name consults cwd/PATH, which are controlled by the
  // CHECK environment. If neither trusted system root exists, skip the helper
  // and use the already-held ChildProcess handle instead.
  return null;
}

function syncFailure(result) {
  if (!result) return "returned no result";
  if (result.error) return result.error.code || result.error.message || "spawn error";
  if (result.signal) return "signal " + result.signal;
  if (result.status !== 0) return "exit " + String(result.status);
  return null;
}

const childExited = (child) => child.exitCode !== null && child.exitCode !== undefined ||
  child.signalCode !== null && child.signalCode !== undefined;

export function terminateProcessTree(child, options = {}) {
  const platform = options.platform || process.platform;
  const spawnSyncImpl = options.spawnSyncImpl || nodeSpawnSync;
  const killGroup = options.killGroup || process.kill;
  const pid = child && child.pid;
  if (!Number.isInteger(pid) || pid <= 0) {
    return { ok: false, fallback: false, diagnostic: "child PID is unavailable" };
  }

  if (platform !== "win32") {
    // The gate runner launches a detached Node supervisor as the group leader
    // and keeps it alive until the shell and inherited stdout/stderr close. If
    // Node has already observed that supervisor exit, the numeric PGID no
    // longer carries identity and may have been reused; never signal it.
    if (childExited(child)) {
      return { ok: true, fallback: false, diagnostic: "process supervisor already exited" };
    }
    try {
      killGroup(-pid, "SIGKILL");
      return { ok: true, fallback: false, diagnostic: null };
    } catch (error) {
      if (childExited(child)) {
        return {
          ok: true,
          fallback: true,
          diagnostic: "process-group kill failed (" + (error.code || error.message) + "); supervisor already exited",
        };
      }
      try {
        const requested = child.kill("SIGKILL");
        if (requested === false) {
          return {
            ok: false,
            fallback: true,
            diagnostic: "process-group kill failed (" + (error.code || error.message) +
              "); child fallback returned false",
          };
        }
        return {
          ok: true,
          fallback: true,
          diagnostic: "process-group kill failed (" + (error.code || error.message) + "); child fallback requested",
        };
      } catch (fallbackError) {
        return {
          ok: false,
          fallback: true,
          diagnostic: "process-group kill failed (" + (error.code || error.message) +
            "); child fallback failed (" + (fallbackError.code || fallbackError.message) + ")",
        };
      }
    }
  }

  // taskkill addresses the stored leader PID, unlike a POSIX process-group
  // request. Do not target it after Node reports exit because the PID may have
  // been reused while an inherited pipe remains open.
  if (childExited(child)) {
    return { ok: true, fallback: false, diagnostic: "child already exited" };
  }

  const command = windowsTaskkillPath(options.env || process.env);
  const requestedTimeout = Number(options.taskkillTimeoutMs);
  const taskkillTimeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0
    ? Math.floor(requestedTimeout)
    : WINDOWS_TASKKILL_TIMEOUT_MS;
  let result;
  let failure;
  if (!command) {
    failure = "trusted system taskkill path unavailable";
  } else {
    try {
      result = spawnSyncImpl(command, ["/pid", String(pid), "/f", "/t"], {
        stdio: "ignore",
        windowsHide: true,
        // Cleanup runs inside the gate timeout path. A broken helper must not
        // replace a bounded CHECK with an unbounded synchronous wait.
        timeout: taskkillTimeoutMs,
        killSignal: "SIGKILL",
      });
      failure = syncFailure(result);
    } catch (error) {
      failure = error.code || error.message || "spawn threw";
    }
  }
  if (!failure) return { ok: true, fallback: false, diagnostic: null, command };

  if (childExited(child)) {
    return {
      ok: true,
      fallback: true,
      command,
      diagnostic: "taskkill failed (" + failure + "); child already exited",
    };
  }

  try {
    const requested = child.kill("SIGKILL");
    if (requested === false) {
      return {
        ok: false,
        fallback: true,
        command,
        diagnostic: "taskkill failed (" + failure + "); child fallback returned false",
      };
    }
    return {
      ok: true,
      fallback: true,
      command,
      diagnostic: "taskkill failed (" + failure + "); child fallback requested",
    };
  } catch (error) {
    return {
      ok: false,
      fallback: true,
      command,
      diagnostic: "taskkill failed (" + failure + "); child fallback failed (" +
        (error.code || error.message) + ")",
    };
  }
}
