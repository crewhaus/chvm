import { spawnSync as nodeSpawnSync } from "node:child_process";
import { constants, accessSync, statSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The handful of things chvm needs from its host runtime, written against `node:` modules only.
 *
 * chvm used to call `Bun.spawnSync`, `Bun.which` and `Bun.sleepSync` directly, which meant the
 * published package could only be run by Bun — and therefore could not be installed with
 * `npm i -g`. Everything here works identically under Node and Bun, so the CLI installs from npm
 * on any machine. Bun is still required to *run* crewhaus itself; that is the shim's business,
 * and it says so when bun is missing.
 */

export interface SpawnResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface SpawnOptions {
  cwd?: string;
  timeout?: number;
  env?: NodeJS.ProcessEnv;
  /** Windows only: hand the command line over exactly as written (see system.ts `invocation`). */
  windowsVerbatimArguments?: boolean;
}

/** Run a command to completion, capturing output. Never throws; a failure surfaces as exitCode. */
export function spawnSync(argv: string[], options: SpawnOptions = {}): SpawnResult {
  const [command, ...args] = argv;
  if (command === undefined) return { exitCode: null, stdout: "", stderr: "" };
  const proc = nodeSpawnSync(command, args, {
    cwd: options.cwd,
    timeout: options.timeout,
    env: options.env,
    encoding: "utf8",
    windowsVerbatimArguments: options.windowsVerbatimArguments,
    // a spawn of a missing binary must not take the process down
    shell: false,
  });
  return {
    exitCode: proc.error ? null : proc.status,
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? (proc.error ? proc.error.message : ""),
  };
}

/** Block for `ms`. Node has no sleepSync; Atomics.wait on an unshared value is the standard trick. */
export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * First executable `name` on PATH, or null. Windows completes a bare name with PATHEXT.
 * (`findSystemCrewhaus` in system.ts is the crewhaus-specific version, which also has to skip
 * our own shims; this one is the plain lookup.)
 */
export function whichOnPath(
  name: string,
  path = process.env.PATH ?? "",
  platform: NodeJS.Platform = process.platform,
  pathext = process.env.PATHEXT,
): string | null {
  const exts =
    platform === "win32"
      ? [
          ...(pathext ?? ".COM;.EXE;.BAT;.CMD")
            .split(";")
            .map((e) => e.trim().toLowerCase())
            .filter((e) => e.startsWith(".")),
          "",
        ]
      : [""];
  for (const raw of path.split(delimiter)) {
    const dir = raw.trim().replace(/^"(.*)"$/, "$1");
    if (dir === "") continue;
    for (const ext of exts) {
      const candidate = join(dir, `${name}${ext}`);
      try {
        if (!statSync(candidate).isFile()) continue;
        if (platform !== "win32") accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {}
    }
  }
  return null;
}

/**
 * Absolute path to the module file chvm is running from.
 *
 * `import.meta.dir` is Bun-only; this works under both. It matters because `chvm setup` writes a
 * launcher pointing back at this entry, and after an npm install that entry is a bundled
 * `dist/index.js` rather than `src/index.ts`.
 */
export function selfEntry(metaUrl: string): string {
  return resolve(fileURLToPath(metaUrl));
}

export function selfDir(metaUrl: string): string {
  return dirname(selfEntry(metaUrl));
}
