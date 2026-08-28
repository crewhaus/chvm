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
import { SHIM_MARKER } from "./layout";
import { shimsDir } from "./paths";

/** Default when PATHEXT is unset — the executable extensions Windows always understands. */
const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

function safeRealpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** Windows paths are case-insensitive; comparing them case-sensitively misses real matches. */
function samePath(a: string, b: string, platform: NodeJS.Platform): boolean {
  return platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** True when the file is a chvm-managed shim/launcher (theirs or ours), by its marker comment. */
function isChvmShim(path: string): boolean {
  try {
    const fd = openSync(path, "r");
    const buf = Buffer.alloc(256);
    const bytes = readSync(fd, buf, 0, buf.length, 0);
    closeSync(fd);
    return buf.toString("utf8", 0, bytes).includes(SHIM_MARKER);
  } catch {
    return false;
  }
}

/**
 * The names Windows would actually try for a bare `crewhaus`, in PATHEXT order.
 * The extensionless name goes last: Windows itself will not run it, but a Git Bash install
 * can leave one around and finding it beats reporting nothing.
 */
export function candidateNames(
  name: string,
  platform: NodeJS.Platform = process.platform,
  pathext = process.env.PATHEXT,
): string[] {
  if (platform !== "win32") return [name];
  const exts = (pathext ?? DEFAULT_PATHEXT)
    .split(";")
    .map((e) => e.trim())
    .filter((e) => e.startsWith("."));
  return [...exts.map((e) => `${name}${e.toLowerCase()}`), name];
}

/** On Windows the execute bit does not exist — accessSync(X_OK) always succeeds, so skip it. */
function isRunnableFile(path: string, platform: NodeJS.Platform): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (platform === "win32") return true;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * First executable `crewhaus` on PATH that is not the chvm shim —
 * i.e. whatever brew/npm/scoop/winget/apt put there. Null when none exists.
 */
export function findSystemCrewhaus(
  path = process.env.PATH ?? "",
  platform: NodeJS.Platform = process.platform,
  pathext = process.env.PATHEXT,
): string | null {
  const shims = safeRealpath(shimsDir());
  const names = candidateNames("crewhaus", platform, pathext);
  for (const entry of path.split(delimiter)) {
    if (entry === "") continue;
    if (samePath(safeRealpath(entry), shims, platform)) continue;
    for (const name of names) {
      const candidate = join(entry, name);
      if (!isRunnableFile(candidate, platform)) continue;
      const real = safeRealpath(candidate);
      if (samePath(real, join(shims, name), platform)) continue;
      if (isChvmShim(real)) continue;
      return candidate;
    }
  }
  return null;
}

/**
 * How to invoke a path so the OS will actually run it.
 * A `.cmd`/`.bat` is not an executable image — it has to go through cmd.exe.
 */
export function invocation(target: string, platform: NodeJS.Platform = process.platform): string[] {
  if (platform === "win32" && /\.(cmd|bat)$/i.test(target)) {
    return ["cmd.exe", "/d", "/s", "/c", target];
  }
  return [target];
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
