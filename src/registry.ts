import { sortVersions } from "./semver";

const PACKAGE = "crewhaus";

export interface RegistryInfo {
  versions: string[];
  latest: string;
}

function registryUrl(): string {
  const base = process.env.CHVM_REGISTRY ?? "https://registry.npmjs.org";
  return `${base.replace(/\/$/, "")}/${PACKAGE}`;
}

/** Published crewhaus versions plus the `latest` dist-tag, from the npm registry. */
export async function fetchRegistry(): Promise<RegistryInfo> {
  let res: Response;
  try {
    res = await fetch(registryUrl(), {
      headers: { accept: "application/vnd.npm.install-v1+json" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`could not reach the npm registry (${detail}) — are you offline?`);
  }
  if (!res.ok) {
    throw new Error(`npm registry answered ${res.status} for ${PACKAGE}`);
  }
  const body = (await res.json()) as {
    versions?: Record<string, unknown>;
    "dist-tags"?: Record<string, string>;
  };
  const versions = sortVersions(Object.keys(body.versions ?? {}));
  const latest = body["dist-tags"]?.["latest"] ?? versions.at(-1);
  if (!latest || versions.length === 0) {
    throw new Error(`npm registry returned no versions for ${PACKAGE}`);
  }
  return { versions, latest };
}
