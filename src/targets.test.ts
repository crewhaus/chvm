import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { versionFile } from "./paths";
import { formatTarget, parseTarget, readTarget, writeTarget } from "./targets";

let sandbox: string;
let previousChvmDir: string | undefined;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "chvm-test-"));
  previousChvmDir = process.env.CHVM_DIR;
  process.env.CHVM_DIR = sandbox;
});

afterEach(() => {
  // empty string counts as unset for chvmDir(), so this restores either state
  process.env.CHVM_DIR = previousChvmDir ?? "";
  rmSync(sandbox, { recursive: true, force: true });
});

describe("parseTarget / formatTarget", () => {
  test("round-trips every target kind", () => {
    for (const raw of ["system", "0.5.4", "local:/some/path", "local:/path with spaces/repo"]) {
      expect(formatTarget(parseTarget(raw))).toBe(raw);
    }
  });

  test("trims surrounding whitespace", () => {
    expect(parseTarget("0.5.4\n")).toEqual({ kind: "version", version: "0.5.4" });
  });
});

describe("readTarget / writeTarget", () => {
  test("returns null before anything is written", () => {
    expect(readTarget()).toBeNull();
  });

  test("persists a target as a single trailing-newline line", () => {
    writeTarget({ kind: "version", version: "0.5.4" });
    expect(readFileSync(versionFile(), "utf8")).toBe("0.5.4\n");
    expect(readTarget()).toEqual({ kind: "version", version: "0.5.4" });
  });

  test("overwrites the previous target", () => {
    writeTarget({ kind: "version", version: "0.5.4" });
    writeTarget({ kind: "local", path: "/repo" });
    expect(readTarget()).toEqual({ kind: "local", path: "/repo" });
  });
});
