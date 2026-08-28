import { homedir } from "node:os";
import { join } from "node:path";

/** Root of chvm's state. Override with CHVM_DIR (used by tests; respected by the shims too). */
export function chvmDir(): string {
  const override = process.env.CHVM_DIR;
  return override && override.length > 0 ? override : join(homedir(), ".chvm");
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
