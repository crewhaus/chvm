import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Translate a Git Bash / MSYS / Cygwin path to Windows form.
 *
 * A Git Bash user who exports `CHVM_DIR=/c/foo` hands the same string to two readers with
 * different path semantics: the bash shim resolves it to `C:\foo`, while win32 `path.join`
 * resolves it to `\c\foo` on the current drive. They would then disagree about where the
 * version file lives — and because `writeTarget` creates the directory it writes to, `chvm use`
 * would report success while the shim, reading elsewhere, silently kept the old target.
 *
 * Exported for testing; a no-op off Windows and for paths already in Windows form.
 */
export function normalizeChvmDir(
  dir: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== "win32") return dir;
  const msys = dir.match(/^\/(?:cygdrive\/)?([a-zA-Z])(\/.*)?$/);
  if (!msys) return dir;
  const drive = (msys[1] as string).toUpperCase();
  const rest = (msys[2] ?? "").replace(/\//g, "\\");
  return `${drive}:${rest === "" ? "\\" : rest}`;
}

/** Root of chvm's state. Override with CHVM_DIR (used by tests; respected by the shims too). */
export function chvmDir(): string {
  const override = process.env.CHVM_DIR;
  if (override && override.length > 0) return normalizeChvmDir(override);
  return join(homedir(), ".chvm");
}

export function versionsDir(): string {
  return join(chvmDir(), "versions");
}

export function shimsDir(): string {
  return join(chvmDir(), "shims");
}

/**
 * Every shim file we write for a command, in the order a lookup resolves them.
 *
 * Windows gets two. `.cmd` is the load-bearing one: `.CMD` is in the default PATHEXT, so both
 * cmd.exe and PowerShell find it from a bare `crewhaus`. The extensionless bash shim is written
 * alongside it for Git Bash / MSYS2 / Cygwin, which honour shebangs and see a colon-separated
 * PATH. We deliberately do not write a `.ps1`: `.PS1` is absent from the default PATHEXT, so
 * cmd.exe could never find it, and a second implementation would only add a resolution
 * ambiguity plus ExecutionPolicy risk on hosts where scripts are Restricted.
 */
export function shimNames(name: string, platform: NodeJS.Platform = process.platform): string[] {
  return platform === "win32" ? [`${name}.cmd`, name] : [name];
}

/** The shim a lookup resolves to first — the one `crewhaus` runs when typed. */
export function shimPath(platform: NodeJS.Platform = process.platform): string {
  return join(shimsDir(), shimNames("crewhaus", platform)[0] as string);
}

/** The POSIX shim, which is written on every platform (Git Bash and WSL use it on Windows). */
export function posixShimPath(): string {
  return join(shimsDir(), "crewhaus");
}

export function versionFile(): string {
  return join(chvmDir(), "version");
}

export function configFile(): string {
  return join(chvmDir(), "config.json");
}
