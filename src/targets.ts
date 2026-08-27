import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { chvmDir, versionFile } from "./paths";

/** What the crewhaus shim should run. Persisted as one line in ~/.chvm/version. */
export type Target =
  | { kind: "version"; version: string }
  | { kind: "system" }
  | { kind: "local"; path: string };

export function parseTarget(raw: string): Target {
  const line = raw.trim();
  if (line === "system") return { kind: "system" };
  if (line.startsWith("local:")) return { kind: "local", path: line.slice("local:".length) };
  return { kind: "version", version: line };
}

export function formatTarget(target: Target): string {
  switch (target.kind) {
    case "system":
      return "system";
    case "local":
      return `local:${target.path}`;
    case "version":
      return target.version;
  }
}

/** The active target, or null when none has been chosen (the shim then falls back to system). */
export function readTarget(): Target | null {
  const file = versionFile();
  if (!existsSync(file)) return null;
  const raw = readFileSync(file, "utf8").trim();
  if (raw === "") return null;
  return parseTarget(raw);
}

export function writeTarget(target: Target): void {
  mkdirSync(chvmDir(), { recursive: true });
  const file = versionFile();
  const tmp = join(dirname(file), `.version.tmp-${process.pid}`);
  writeFileSync(tmp, `${formatTarget(target)}\n`);
  renameSync(tmp, file);
}

export function describeTarget(target: Target): string {
  switch (target.kind) {
    case "system":
      return "system";
    case "local":
      return `local (${target.path})`;
    case "version":
      return target.version;
  }
}
