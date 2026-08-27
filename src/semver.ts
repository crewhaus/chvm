/** Minimal semver helpers for plain x.y.z versions (what crewhaus publishes). */

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10));
  const pb = b.split(".").map((n) => Number.parseInt(n, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (Number.isNaN(na) || Number.isNaN(nb)) return a.localeCompare(b);
    if (na !== nb) return na - nb;
  }
  return 0;
}

export function sortVersions(versions: string[]): string[] {
  return [...versions].sort(compareVersions);
}

export function isVersionLike(spec: string): boolean {
  return /^v?\d+(\.\d+){0,2}$/.test(spec);
}

/**
 * Resolve a version spec against a list of available versions.
 * Exact match wins; otherwise a prefix like "0.5" resolves to the highest "0.5.x".
 * Returns null when nothing matches.
 */
export function resolveVersion(spec: string, available: string[]): string | null {
  const clean = spec.replace(/^v/, "");
  if (available.includes(clean)) return clean;
  const matches = available.filter((v) => v.startsWith(`${clean}.`));
  if (matches.length === 0) return null;
  return sortVersions(matches).at(-1) ?? null;
}
