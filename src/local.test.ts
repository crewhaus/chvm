import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveLocalRepo } from "./local";

let root: string;

function makeFakeFactory(base: string, withNodeModules = true): void {
  mkdirSync(join(base, "apps", "cli", "src"), { recursive: true });
  writeFileSync(join(base, "apps", "cli", "src", "index.ts"), "// fake entry\n");
  writeFileSync(
    join(base, "apps", "cli", "package.json"),
    JSON.stringify({ name: "crewhaus", version: "9.9.9" }),
  );
  if (withNodeModules) mkdirSync(join(base, "node_modules"), { recursive: true });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "chvm-local-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("resolveLocalRepo", () => {
  test("accepts a factory checkout root", () => {
    makeFakeFactory(root);
    expect(resolveLocalRepo(root)).toBe(root);
  });

  test("accepts the apps/cli directory and normalizes to the root", () => {
    makeFakeFactory(root);
    expect(resolveLocalRepo(join(root, "apps", "cli"))).toBe(root);
  });

  test("rejects a directory that is not a checkout", () => {
    expect(() => resolveLocalRepo(root)).toThrow(/does not look like a factory checkout/);
  });

  test("rejects a checkout without node_modules, with a bun install hint", () => {
    makeFakeFactory(root, false);
    expect(() => resolveLocalRepo(root)).toThrow(/bun install/);
  });
});
