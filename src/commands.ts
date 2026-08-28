import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readConfig, writeConfig } from "./config";
import {
  installVersion,
  installedVersions,
  isInstalled,
  uninstallVersion,
  versionEntry,
} from "./install";
import { FACTORY_CLI_ENTRY, resolveLocalRepo } from "./local";
import { chvmDir, shimPath, shimsDir } from "./paths";
import { fetchRegistry } from "./registry";
import { selfEntry, whichOnPath } from "./runtime";
import { isVersionLike, resolveVersion } from "./semver";
import { RC_BLOCK, activationLine, ensureRcPath } from "./setup";
import { writeShims } from "./shim";
import { findSystemCrewhaus, invocation, probeVersion } from "./system";
import { type Target, describeTarget, readTarget, writeTarget } from "./targets";

class UsageError extends Error {}

function fail(message: string): never {
  throw new UsageError(message);
}

/** Resolve a spec like "latest", "0.5", or "0.5.4" to a concrete published/installed version. */
async function resolveVersionSpec(spec: string): Promise<string> {
  if (spec === "latest") {
    const registry = await fetchRegistry();
    return registry.latest;
  }
  if (!isVersionLike(spec)) {
    fail(`"${spec}" is not a version — try a version number, latest, system, or local.`);
  }
  const fromInstalled = resolveVersion(spec, installedVersions());
  const clean = spec.replace(/^v/, "");
  if (fromInstalled === clean) return fromInstalled;
  try {
    const registry = await fetchRegistry();
    const resolved = resolveVersion(spec, registry.versions);
    if (!resolved) {
      fail(`crewhaus ${spec} does not exist — see \`chvm ls-remote\` for published versions.`);
    }
    return resolved;
  } catch (err) {
    if (err instanceof UsageError) throw err;
    if (fromInstalled) return fromInstalled; // offline, but a prefix match is installed
    throw err;
  }
}

function ensureInstalled(version: string): void {
  if (isInstalled(version)) return;
  console.log(`Installing crewhaus ${version} from npm…`);
  installVersion(version);
}

function localCliVersion(root: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(join(root, "apps", "cli", "package.json"), "utf8"));
    return typeof parsed?.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

function safeRealpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function shimOnPath(): boolean {
  const resolved = whichOnPath("crewhaus");
  if (resolved === null) return false;
  const a = safeRealpath(resolved);
  const b = safeRealpath(shimPath());
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function verifySwitch(target: Target): void {
  const reported = probeVersion(invocation(shimPath(), ["--version"]));
  if (reported === null) {
    fail(`switched to ${describeTarget(target)}, but running \`crewhaus --version\` failed.`);
  }
  const label =
    target.kind === "local"
      ? `crewhaus from ${target.path}`
      : target.kind === "system"
        ? "the system crewhaus"
        : `crewhaus ${target.version}`;
  console.log(`Now using ${label} (crewhaus --version → ${reported})`);
  if (shimOnPath()) return;

  // The shims dir is not on PATH, so `crewhaus` would still resolve elsewhere (or nowhere).
  // Put it there rather than telling the user to run a second command: after `npm i -g`,
  // `chvm use` is the first thing anyone runs, and a version manager that switches nothing
  // until you read a note is not doing its job. Always say what was changed.
  const result = ensureRcPath();
  console.log("");
  if (result.changed && result.kind === "rc") {
    console.log(`Added ${shimsDir()} to your PATH via ${result.rcFile}.`);
  } else if (result.changed && result.kind === "user-path") {
    console.log(`Added ${shimsDir()} to your user PATH.`);
  } else if (result.kind === "none") {
    console.log(`\`crewhaus\` will not resolve to the chvm shim until ${shimsDir()} is on PATH.`);
    console.log(
      result.reason
        ? `chvm could not add it (${result.reason}). Add this yourself:`
        : "chvm does not edit this shell's profile. Add this yourself:",
    );
    console.log(`  ${activationLine()}`);
    return;
  }
  console.log("Open a new terminal to pick it up, or run this in the current one:");
  console.log(`  ${activationLine()}`);
}

export async function use(args: string[]): Promise<void> {
  const spec = args[0] ?? fail("usage: chvm use <version|latest|system|local [path]>");
  writeShims();

  if (spec === "system") {
    if (!findSystemCrewhaus()) {
      const example =
        process.platform === "win32" ? "scoop install crewhaus" : "brew install crewhaus";
      fail(
        `no system crewhaus found on PATH (beyond the chvm shim).\nInstall one (e.g. \`${example}\`) or pick a version: chvm use latest`,
      );
    }
    writeTarget({ kind: "system" });
    verifySwitch({ kind: "system" });
    return;
  }

  if (spec === "local") {
    const config = readConfig();
    const input = args[1] ?? config.localPath ?? process.cwd();
    const root = resolveLocalRepo(input);
    writeConfig({ ...config, localPath: root });
    const target: Target = { kind: "local", path: root };
    writeTarget(target);
    verifySwitch(target);
    return;
  }

  const version = await resolveVersionSpec(spec);
  ensureInstalled(version);
  const target: Target = { kind: "version", version };
  writeTarget(target);
  verifySwitch(target);
}

export async function install(args: string[]): Promise<void> {
  const spec = args[0] ?? fail("usage: chvm install <version|latest>");
  if (spec === "system" || spec === "local") {
    fail(`\`chvm install\` only takes published versions — use \`chvm use ${spec}\` instead.`);
  }
  const version = await resolveVersionSpec(spec);
  if (isInstalled(version)) {
    console.log(`crewhaus ${version} is already installed.`);
    return;
  }
  ensureInstalled(version);
  console.log(`Installed crewhaus ${version} — activate it with: chvm use ${version}`);
}

export async function uninstall(args: string[]): Promise<void> {
  const spec = args[0] ?? fail("usage: chvm uninstall <version>");
  const version = resolveVersion(spec, installedVersions());
  if (!version) {
    fail(`crewhaus ${spec} is not installed — see \`chvm ls\`.`);
  }
  const target = readTarget();
  if (target?.kind === "version" && target.version === version) {
    fail(`crewhaus ${version} is the active version — switch first (e.g. \`chvm use system\`).`);
  }
  uninstallVersion(version);
  console.log(`Uninstalled crewhaus ${version}.`);
}

export async function list(): Promise<void> {
  const target = readTarget();
  const mark = (active: boolean) => (active ? "* " : "  ");
  for (const version of installedVersions()) {
    const active = target?.kind === "version" && target.version === version;
    console.log(`${mark(active)}${version}`);
  }
  const system = findSystemCrewhaus();
  if (system) {
    const version = probeVersion(invocation(system, ["--version"]));
    const active = target === null || target.kind === "system";
    console.log(`${mark(active)}system${version ? ` (${version}, ${system})` : ` (${system})`}`);
  }
  const localPath = target?.kind === "local" ? target.path : readConfig().localPath;
  if (localPath) {
    const version = localCliVersion(localPath);
    const active = target?.kind === "local";
    console.log(
      `${mark(active)}local${version ? ` (${version}, ${localPath})` : ` (${localPath})`}`,
    );
  }
  if (target === null) {
    console.log("\nNo version selected yet — `crewhaus` falls through to the system install.");
  }
}

export async function listRemote(): Promise<void> {
  const registry = await fetchRegistry();
  const installed = new Set(installedVersions());
  const target = readTarget();
  for (const version of registry.versions) {
    const notes = [
      target?.kind === "version" && target.version === version ? "active" : "",
      installed.has(version) ? "installed" : "",
      version === registry.latest ? "latest" : "",
    ].filter(Boolean);
    console.log(
      `${notes.includes("active") ? "* " : "  "}${version}${notes.length ? `  (${notes.join(", ")})` : ""}`,
    );
  }
}

export async function current(): Promise<void> {
  const target = readTarget();
  if (target === null) {
    const system = findSystemCrewhaus();
    if (system) {
      console.log(
        `system → ${probeVersion(invocation(system, ["--version"])) ?? "unknown"} (${system}) — chvm default`,
      );
    } else {
      console.log("none — no version selected and no system crewhaus on PATH.");
    }
    return;
  }
  switch (target.kind) {
    case "version":
      console.log(target.version);
      return;
    case "system": {
      const system = findSystemCrewhaus();
      if (system) {
        console.log(
          `system → ${probeVersion(invocation(system, ["--version"])) ?? "unknown"} (${system})`,
        );
      } else {
        console.log("system — but no system crewhaus is on PATH right now.");
      }
      return;
    }
    case "local":
      console.log(`local → ${localCliVersion(target.path) ?? "unknown"} (${target.path})`);
      return;
  }
}

export async function which(): Promise<void> {
  const target = readTarget();
  if (target === null || target.kind === "system") {
    const system = findSystemCrewhaus();
    if (!system) fail("no system crewhaus on PATH.");
    console.log(system);
    return;
  }
  if (target.kind === "local") {
    console.log(join(target.path, FACTORY_CLI_ENTRY));
    return;
  }
  const bin = versionEntry(target.version);
  if (bin === null) {
    fail(`crewhaus ${target.version} is not installed — run: chvm install ${target.version}`);
  }
  console.log(bin);
}

export async function setup(args: string[]): Promise<void> {
  const windows = process.platform === "win32";
  const chvmEntry = selfEntry(import.meta.url);
  writeShims(chvmEntry);
  if (chvmDir() !== join(homedir(), ".chvm")) {
    console.log(`Note: CHVM_DIR is set, so the shims went to ${shimsDir()}.`);
    console.log(
      windows
        ? "Set CHVM_DIR in your user environment too, or the shims will read the default."
        : "The PATH line resolves CHVM_DIR at shell startup — export it in your rc first.",
    );
  }
  if (args.includes("--print")) {
    console.log(
      windows ? "Add this to your PowerShell profile:" : "Add this to your shell profile:",
    );
    console.log(windows ? activationLine() : RC_BLOCK.trim());
    return;
  }

  const result = ensureRcPath();
  const next = () => {
    console.log("  chvm use latest");
    console.log("  crewhaus --version");
  };

  if (result.kind === "user-path") {
    if (result.changed) {
      console.log(`Shims written and ${shimsDir()} added to your user PATH.`);
      console.log("Open a new terminal (or run this in the current one):");
      console.log(`  ${activationLine()}`);
    } else {
      console.log("Shims written — your user PATH already has the chvm shims dir. Try:");
    }
    next();
    return;
  }

  if (result.kind === "none") {
    console.log(
      result.reason
        ? `Shims written, but the user PATH could not be updated (${result.reason}).`
        : "Shims written. Your shell isn't zsh/bash, so add this to its profile yourself:",
    );
    console.log(windows ? activationLine() : RC_BLOCK.trim());
    return;
  }

  if (result.changed) {
    console.log(`Shims written and PATH added to ${result.rcFile}.`);
    console.log(`Restart your shell (or run: ${activationLine()}), then try:`);
  } else {
    console.log(`Shims written — ${result.rcFile} already has the chvm PATH entry. Try:`);
  }
  next();
}

export function isUsageError(err: unknown): err is UsageError {
  return err instanceof UsageError;
}
