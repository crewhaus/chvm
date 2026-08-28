/**
 * Facts every shim flavour and every TypeScript caller must agree on.
 *
 * Both live here because they are contracts between files that cannot import each other's
 * runtime: the generated bash/cmd shims restate them as literal text, and `system.ts` and
 * `install.ts` restate them as paths. Drifting them apart breaks the tool silently.
 */

/** Marker comment in every shim we generate. `isChvmShim` looks for it to avoid self-exec loops. */
export const SHIM_MARKER = "managed by chvm";

/**
 * Where the runnable entry sits inside a pinned install, relative to that version's directory.
 *
 * NOT `node_modules/.bin/crewhaus`: on POSIX that is a symlink to this same file, but on Windows
 * `bun install` writes only `<name>.bunx` + `<name>.exe` there — no extensionless file and no
 * shebang handling — so the .bin path is unrunnable by `bun` on Windows. The package's own
 * `bin.crewhaus` has been `dist/index.js` for every published release; `installVersion` verifies
 * that on each install rather than trusting it.
 */
export const PINNED_ENTRY_SEGMENTS = ["node_modules", "crewhaus", "dist", "index.js"] as const;

/** Relative CLI entry inside a factory checkout, as path segments. */
export const FACTORY_ENTRY_SEGMENTS = ["apps", "cli", "src", "index.ts"] as const;

/** Join segments with the separator a given platform's shell wants. */
export function joinFor(platform: NodeJS.Platform, segments: readonly string[]): string {
  return segments.join(platform === "win32" ? "\\" : "/");
}
