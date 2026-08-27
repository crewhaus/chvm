import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { versionsDir } from "./paths";
import { sortVersions } from "./semver";

/** Where a pinned npm install of crewhaus@version lives. */
export function versionDir(version: string): string {
  return join(versionsDir(), version);
}

/** The runnable bin inside a pinned install (a #!/usr/bin/env bun script). */
export function versionBin(version: string): string {
  return join(versionDir(version), "node_modules", ".bin", "crewhaus");
}

export function isInstalled(version: string): boolean {
  return existsSync(versionBin(version));
}

export function installedVersions(): string[] {
  const dir = versionsDir();
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && isInstalled(e.name))
    .map((e) => e.name);
  return sortVersions(entries);
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
    rmSync(dir, { recursive: true, force: true });
    const stderr = add.stderr.toString().trim().split("\n").slice(-4).join("\n");
    throw new Error(`bun add crewhaus@${version} failed:\n${stderr}`);
  }
  const check = Bun.spawnSync(["bun", versionBin(version), "--version"], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000,
  });
  const reported = check.stdout.toString().trim();
  if (check.exitCode !== 0 || reported !== version) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(
      `installed crewhaus@${version} but it reported "${reported || check.stderr.toString().trim()}"`,
    );
  }
}

export function uninstallVersion(version: string): void {
  rmSync(versionDir(version), { recursive: true, force: true });
}
