import { homedir } from "node:os";
import { join } from "node:path";

/** Root of chvm's state. Override with CHVM_DIR (used by tests; respected by the shim too). */
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

export function shimPath(): string {
  return join(shimsDir(), "crewhaus");
}

export function versionFile(): string {
  return join(chvmDir(), "version");
}

export function configFile(): string {
  return join(chvmDir(), "config.json");
}
