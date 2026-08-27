import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

/**
 * End-to-end: drives the real CLI against a sandboxed CHVM_DIR.
 * Needs network once (installs crewhaus@0.5.4 from npm). Run with: bun test test
 */

const repoRoot = join(import.meta.dir, "..");
const chvmEntry = join(repoRoot, "src", "index.ts");

let sandbox: string;
let fakeBin: string; // pretend "system" install dir
let fakeRepo: string; // pretend factory checkout
let shims: string;

const VERSION = "0.5.4";

function runChvm(args: string[], path: string): { code: number; stdout: string; stderr: string } {
  const proc = Bun.spawnSync(["bun", chvmEntry, ...args], {
    cwd: repoRoot,
    env: { ...process.env, CHVM_DIR: sandbox, PATH: path },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 300_000,
  });
  return {
    code: proc.exitCode ?? -1,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

function runShim(path: string, cwd = homedir()): string {
  const proc = Bun.spawnSync([join(shims, "crewhaus"), "--version"], {
    cwd,
    env: { ...process.env, CHVM_DIR: sandbox, PATH: path },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000,
  });
  return proc.stdout.toString().trim() || proc.stderr.toString().trim();
}

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), "chvm-e2e-"));
  shims = join(sandbox, "shims");

  fakeBin = join(sandbox, "fake-system-bin");
  mkdirSync(fakeBin, { recursive: true });
  const fakeSystem = join(fakeBin, "crewhaus");
  writeFileSync(
    fakeSystem,
    '#!/usr/bin/env bash\n[ "${1:-}" = "--version" ] && { echo 9.9.9-system; exit 0; }\necho fake\n',
  );
  chmodSync(fakeSystem, 0o755);

  fakeRepo = join(sandbox, "fake-factory");
  mkdirSync(join(fakeRepo, "apps", "cli", "src"), { recursive: true });
  mkdirSync(join(fakeRepo, "node_modules"), { recursive: true });
  writeFileSync(
    join(fakeRepo, "apps", "cli", "src", "index.ts"),
    'if (process.argv.includes("--version")) console.log("9.9.9-local");\n',
  );
  writeFileSync(
    join(fakeRepo, "apps", "cli", "package.json"),
    JSON.stringify({ name: "crewhaus", version: "9.9.9-local" }),
  );
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("chvm end to end", () => {
  test(`install ${VERSION} from npm`, () => {
    const path = `${shims}:${process.env.PATH}`;
    const result = runChvm(["install", VERSION], path);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(existsSync(join(sandbox, "versions", VERSION, "node_modules", ".bin", "crewhaus"))).toBe(
      true,
    );
  }, 300_000);

  test(`use ${VERSION} — crewhaus --version reports it`, () => {
    const path = `${shims}:${process.env.PATH}`;
    const result = runChvm(["use", VERSION], path);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`crewhaus --version → ${VERSION}`);
    expect(readFileSync(join(sandbox, "version"), "utf8").trim()).toBe(VERSION);
    expect(runShim(path)).toBe(VERSION);
  }, 120_000);

  test("the shim works from any cwd", () => {
    const path = `${shims}:${process.env.PATH}`;
    expect(runShim(path, tmpdir())).toBe(VERSION);
  }, 60_000);

  test("warns when the shims dir is not on PATH", () => {
    const result = runChvm(["use", VERSION], `${process.env.PATH}`);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("chvm setup");
  }, 60_000);

  test("use system skips the shim and runs the next crewhaus on PATH", () => {
    const path = `${shims}:${fakeBin}:${process.env.PATH}`;
    const result = runChvm(["use", "system"], path);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("crewhaus --version → 9.9.9-system");
    expect(runShim(path)).toBe("9.9.9-system");
  }, 60_000);

  test("use local runs a factory checkout from source and remembers the path", () => {
    const path = `${shims}:${process.env.PATH}`;
    const withArg = runChvm(["use", "local", fakeRepo], path);
    expect(withArg.code).toBe(0);
    expect(withArg.stdout).toContain("crewhaus --version → 9.9.9-local");
    expect(runShim(path)).toBe("9.9.9-local");

    // switch away, then back without the path argument
    expect(runChvm(["use", VERSION], path).code).toBe(0);
    const remembered = runChvm(["use", "local"], path);
    expect(remembered.code).toBe(0);
    expect(remembered.stdout).toContain("9.9.9-local");
  }, 120_000);

  test("current / which / ls report the active local target", () => {
    const path = `${shims}:${process.env.PATH}`;
    expect(runChvm(["current"], path).stdout).toContain("9.9.9-local");
    expect(runChvm(["which"], path).stdout.trim()).toBe(
      join(fakeRepo, "apps", "cli", "src", "index.ts"),
    );
    const ls = runChvm(["ls"], path).stdout;
    expect(ls).toContain(`  ${VERSION}`);
    expect(ls).toContain("* local");
  }, 60_000);

  test("uninstall refuses the active version, then succeeds after switching", () => {
    const path = `${shims}:${fakeBin}:${process.env.PATH}`;
    expect(runChvm(["use", VERSION], path).code).toBe(0);
    const refused = runChvm(["uninstall", VERSION], path);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("active");

    expect(runChvm(["use", "system"], path).code).toBe(0);
    const removed = runChvm(["uninstall", VERSION], path);
    expect(removed.code).toBe(0);
    expect(existsSync(join(sandbox, "versions", VERSION))).toBe(false);
  }, 120_000);

  test("unknown versions fail with a helpful error", () => {
    const path = `${shims}:${process.env.PATH}`;
    const result = runChvm(["use", "0.0.99"], path);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("does not exist");
  }, 60_000);

  test("install system/local points at chvm use instead of suggesting itself", () => {
    const path = `${shims}:${process.env.PATH}`;
    const result = runChvm(["install", "system"], path);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("chvm use system");
  }, 60_000);

  // regression: a shim invoked with a foreign CHVM_DIR (or a copied shim) used to exec
  // itself forever; it must skip itself ($0) and land on the next crewhaus on PATH
  test("shim with a foreign CHVM_DIR does not exec itself forever", () => {
    const foreignDir = join(sandbox, "foreign-chvm");
    mkdirSync(foreignDir, { recursive: true });
    const proc = Bun.spawnSync([join(shims, "crewhaus"), "--version"], {
      cwd: homedir(),
      env: {
        ...process.env,
        CHVM_DIR: foreignDir, // empty: target defaults to "system"
        PATH: `${shims}:${fakeBin}:${process.env.PATH}`,
      },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 15_000,
    });
    expect(proc.stdout.toString().trim()).toBe("9.9.9-system");
  }, 30_000);
});
