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
 * File `installVersion` writes inside a pinned install, naming that release's runnable entry
 * as a path relative to the version directory, with forward slashes (which every platform and
 * both shells accept). The shims read it instead of assuming a layout.
 */
export const ENTRY_FILE = "entry";

/**
 * Where the entry has lived, newest first — the fallback chain for an install made by a chvm
 * old enough not to have written an ENTRY_FILE.
 *
 * `dist/index.js` covers every release from 0.1.5 on. `src/index.ts` is what 0.1.3 and 0.1.4
 * published — 2 of the 25 releases on npm, and the reason this is a list rather than a constant.
 * `.bin/crewhaus` is the last resort: it is a symlink to the real entry on POSIX, but on Windows
 * `bun install` writes `.bunx`/`.exe` wrappers there that `bun` cannot run, so it is POSIX-only
 * in practice.
 */
export const LEGACY_ENTRY_CANDIDATES = [
  "node_modules/crewhaus/dist/index.js",
  "node_modules/crewhaus/src/index.ts",
  "node_modules/.bin/crewhaus",
] as const;

/** Relative CLI entry inside a factory checkout, as path segments. */
export const FACTORY_ENTRY_SEGMENTS = ["apps", "cli", "src", "index.ts"] as const;

/** Join segments with the separator a given platform's shell wants. */
export function joinFor(platform: NodeJS.Platform, segments: readonly string[]): string {
  return segments.join(platform === "win32" ? "\\" : "/");
}
