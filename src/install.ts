import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ENTRY_FILE, LEGACY_ENTRY_CANDIDATES } from "./layout";
import { versionsDir } from "./paths";
import { sortVersions } from "./semver";

/** Where a pinned npm install of crewhaus@version lives. */
export function versionDir(version: string): string {
  return join(versionsDir(), version);
}

/** The `bin.crewhaus` path an installed package declares, relative to the package root. */
function declaredBin(dir: string): string | null {
  try {
    const parsed = JSON.parse(
      readFileSync(join(dir, "node_modules", "crewhaus", "package.json"), "utf8"),
    );
    const bin = parsed?.bin;
    const raw = typeof bin === "string" ? bin : bin?.crewhaus;
    if (typeof raw !== "string" || raw === "") return null;
    // accept ./x, .\x and backslash separators — all name the same file
    return raw.replace(/\\/g, "/").replace(/^\.\//, "");
  } catch {
    return null;
  }
}

/**
 * The runnable entry inside a pinned install, as a path relative to the version directory.
 *
 * Read from the package's own `bin` rather than assumed: 0.1.3 and 0.1.4 publish
 * `src/index.ts` and ship no `dist/` at all, so a hard-coded `dist/index.js` breaks them.
 * Returns null when nothing runnable is there.
 */
export function resolveEntry(version: string): string | null {
  const dir = versionDir(version);
  const recorded = readEntryFile(dir);
  if (recorded && existsSync(join(dir, recorded))) return recorded;

  const declared = declaredBin(dir);
  if (declared) {
    const rel = `node_modules/crewhaus/${declared}`;
    if (existsSync(join(dir, rel))) return rel;
  }
  for (const candidate of LEGACY_ENTRY_CANDIDATES) {
    if (existsSync(join(dir, candidate))) return candidate;
  }
  return null;
}

function readEntryFile(dir: string): string | null {
  try {
    const raw = readFileSync(join(dir, ENTRY_FILE), "utf8").trim();
    return raw === "" ? null : raw;
  } catch {
    return null;
  }
}

/** Absolute path to the runnable entry of a pinned install, or null when it is not installed. */
export function versionEntry(version: string): string | null {
  const rel = resolveEntry(version);
  return rel === null ? null : join(versionDir(version), rel);
}

export function isInstalled(version: string): boolean {
  return resolveEntry(version) !== null;
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

/** Install crewhaus@version from npm into its own pinned directory, then verify it runs. */
export function installVersion(version: string): void {
  if (isInstalled(version)) return;
  const dir = versionDir(version);
  // never destroy a directory we did not create — a legacy install we failed to recognise
  // is still the user's 100+MB download
  const preexisting = existsSync(dir);
  const rollback = () => {
    if (!preexisting) removeDir(dir);
  };

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
    rollback();
    const stderr = add.stderr.toString().trim().split("\n").slice(-4).join("\n");
    throw new Error(`bun add crewhaus@${version} failed:\n${stderr}`);
  }

  const entry = resolveEntry(version);
  if (entry === null) {
    rollback();
    throw new Error(
      `installed crewhaus@${version} but found nothing runnable in it — please report this.`,
    );
  }
  // record it so the shims never have to guess a layout
  writeFileSync(join(dir, ENTRY_FILE), `${entry}\n`);

  const check = Bun.spawnSync(["bun", join(dir, entry), "--version"], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000,
  });
  const reported = check.stdout.toString().trim();
  if (check.exitCode !== 0 || reported !== version) {
    rollback();
    throw new Error(
      `installed crewhaus@${version} but it reported "${reported || check.stderr.toString().trim()}"`,
    );
  }
}

export function uninstallVersion(version: string): void {
  removeDir(versionDir(version));
}
