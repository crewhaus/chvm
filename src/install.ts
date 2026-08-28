import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PINNED_ENTRY_SEGMENTS } from "./layout";
import { versionsDir } from "./paths";
import { sortVersions } from "./semver";

/** Where a pinned npm install of crewhaus@version lives. */
export function versionDir(version: string): string {
  return join(versionsDir(), version);
}

/**
 * The runnable entry inside a pinned install — the package's own `dist/index.js`, run by bun.
 *
 * Not `node_modules/.bin/crewhaus`: that is a symlink to this file on POSIX, but on Windows
 * `bun install` writes `.bunx`/`.exe` wrappers there instead, so the .bin path is not something
 * `bun` can run. Going straight at the package entry works identically everywhere.
 */
export function versionEntry(version: string): string {
  return join(versionDir(version), ...PINNED_ENTRY_SEGMENTS);
}

export function isInstalled(version: string): boolean {
  return existsSync(versionEntry(version));
}

export function installedVersions(): string[] {
  const dir = versionsDir();
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && isInstalled(e.name))
    .map((e) => e.name);
  return sortVersions(entries);
}

/** rmSync retries: on Windows an indexer or AV can hold a handle open for a moment. */
function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

/**
 * The `bin.crewhaus` path the installed package declares. We run `dist/index.js` from a
 * hard-coded path in three places (here and both shims), so if a release ever moves its bin we
 * want a clear failure at install time rather than a shim that silently cannot find anything.
 */
function declaredBin(dir: string): string | null {
  try {
    const parsed = JSON.parse(
      readFileSync(join(dir, "node_modules", "crewhaus", "package.json"), "utf8"),
    );
    const bin = parsed?.bin;
    if (typeof bin === "string") return bin;
    if (typeof bin?.crewhaus === "string") return bin.crewhaus;
    return null;
  } catch {
    return null;
  }
}

/** Install crewhaus@version from npm into its own pinned directory, then verify it runs. */
export function installVersion(version: string): void {
  if (isInstalled(version)) return;
  const dir = versionDir(version);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify({ name: `crewhaus-pin-${version}`, private: true }, null, 2)}\n`,
  );
  const add = Bun.spawnSync(["bun", "add", "--exact", `crewhaus@${version}`], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 300_000,
  });
  if (add.exitCode !== 0) {
    removeDir(dir);
    const stderr = add.stderr.toString().trim().split("\n").slice(-4).join("\n");
    throw new Error(`bun add crewhaus@${version} failed:\n${stderr}`);
  }

  const expected = PINNED_ENTRY_SEGMENTS.slice(2).join("/");
  const declared = declaredBin(dir);
  if (declared !== null && declared.replace(/^\.\//, "").replace(/\\/g, "/") !== expected) {
    removeDir(dir);
    throw new Error(
      `crewhaus@${version} runs from "${declared}", but chvm's shims expect "${expected}".\nThis version of chvm is too old for that release — update chvm.`,
    );
  }
  if (!isInstalled(version)) {
    removeDir(dir);
    throw new Error(`installed crewhaus@${version} but ${expected} is missing from the package.`);
  }

  const check = Bun.spawnSync(["bun", versionEntry(version), "--version"], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000,
  });
  const reported = check.stdout.toString().trim();
  if (check.exitCode !== 0 || reported !== version) {
    removeDir(dir);
    throw new Error(
      `installed crewhaus@${version} but it reported "${reported || check.stderr.toString().trim()}"`,
    );
  }
}

export function uninstallVersion(version: string): void {
  removeDir(versionDir(version));
}
