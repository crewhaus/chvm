import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Relative path of the CLI entry inside a factory checkout. */
export const FACTORY_CLI_ENTRY = join("apps", "cli", "src", "index.ts");

function isFactoryRoot(path: string): boolean {
  return existsSync(join(path, FACTORY_CLI_ENTRY));
}

function packageName(dir: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    return typeof parsed?.name === "string" ? parsed.name : null;
  } catch {
    return null;
  }
}

/**
 * Normalize a user-supplied path to the root of a factory checkout.
 * Accepts the repo root or the apps/cli directory inside it.
 * Throws with a helpful message when the path is not a runnable checkout.
 */
export function resolveLocalRepo(input: string): string {
  const path = resolve(input);
  let root: string | null = null;
  if (isFactoryRoot(path)) {
    root = path;
  } else if (packageName(path) === "crewhaus" && isFactoryRoot(dirname(dirname(path)))) {
    root = dirname(dirname(path));
  }
  if (!root) {
    throw new Error(
      `${path} does not look like a factory checkout (expected ${FACTORY_CLI_ENTRY} under it).\nClone one first: git clone https://github.com/crewhaus/factory`,
    );
  }
  if (!existsSync(join(root, "node_modules"))) {
    throw new Error(`${root} has no node_modules — run \`bun install\` there first.`);
  }
  return root;
}
