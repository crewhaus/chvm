import {
  constants,
  accessSync,
  closeSync,
  openSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { delimiter, join } from "node:path";
import { shimsDir } from "./paths";

function safeRealpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** True when the file is a chvm-managed shim/launcher (theirs or ours), by its marker comment. */
function isChvmShim(path: string): boolean {
  try {
    const fd = openSync(path, "r");
    const buf = Buffer.alloc(256);
    const bytes = readSync(fd, buf, 0, buf.length, 0);
    closeSync(fd);
    return buf.toString("utf8", 0, bytes).includes("managed by chvm");
  } catch {
    return false;
  }
}

/**
 * First executable `crewhaus` on PATH that is not the chvm shim —
 * i.e. whatever brew/npm/apt put there. Null when none exists.
 */
export function findSystemCrewhaus(path = process.env.PATH ?? ""): string | null {
  const shims = safeRealpath(shimsDir());
  for (const entry of path.split(delimiter)) {
    if (entry === "") continue;
    const candidate = join(entry, "crewhaus");
    try {
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, constants.X_OK);
    } catch {
      continue;
    }
    const real = safeRealpath(candidate);
    if (real === join(shims, "crewhaus") || safeRealpath(entry) === shims) continue;
    if (isChvmShim(real)) continue;
    return candidate;
  }
  return null;
}

/** Run a crewhaus binary/entry and return what --version prints, or null on failure. */
export function probeVersion(cmd: string[]): string | null {
  try {
    const proc = Bun.spawnSync([...cmd, "--version"], {
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30_000,
    });
    if (proc.exitCode !== 0) return null;
    const out = proc.stdout.toString().trim();
    return out === "" ? null : out;
  } catch {
    return null;
  }
}
