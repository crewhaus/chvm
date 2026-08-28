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
import { delimiter, join } from "node:path";
import { shimNames } from "../src/paths";
import { invocation } from "../src/system";

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
const WINDOWS = process.platform === "win32";

function runChvm(
  args: string[],
  path: string,
  extraEnv: Record<string, string> = {},
): { code: number; stdout: string; stderr: string } {
  const proc = Bun.spawnSync(["bun", chvmEntry, ...args], {
    cwd: repoRoot,
    env: { ...childEnv(path), ...extraEnv },
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

/** The shim a bare `crewhaus` would resolve to here — `crewhaus.cmd` on Windows. */
function shimEntry(): string {
  return join(shims, shimNames("crewhaus")[0] as string);
}

/** PATH entries joined the way THIS platform parses them (";" on Windows, ":" elsewhere). */
function withPath(...dirs: string[]): string {
  return [...dirs, process.env.PATH].join(delimiter);
}

/**
 * Child environment with exactly ONE path variable.
 *
 * Windows environment names are case-insensitive, and the real environment spells it `Path`.
 * Spreading process.env and then setting `PATH` leaves BOTH keys in the block: Bun's own spawn
 * collapses them, but cmd.exe does not — it takes the first, so the shim would inherit the
 * runner's original PATH and never see our sandbox dirs. Strip every case variant first.
 */
function childEnv(path: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^path$/i.test(k) || v === undefined) continue;
    env[k] = v;
  }
  env[WINDOWS ? "Path" : "PATH"] = path;
  env.CHVM_DIR = sandbox;
  // `chvm use` now puts the shims dir on PATH by itself, which means editing a shell profile.
  // Point HOME at the sandbox so the suite can never touch the real one.
  env.HOME = sandbox;
  env.USERPROFILE = sandbox;
  // ...but that would also relocate bun's global install cache into the sandbox, which then has
  // to be deleted at teardown — enough to time the afterAll hook out on Windows. Keep the cache
  // outside, where it also survives between runs and makes the install step much faster.
  env.BUN_INSTALL_CACHE_DIR = join(tmpdir(), "chvm-e2e-bun-cache");
  return env;
}

function runShim(path: string, cwd = homedir()): string {
  const call = invocation(shimEntry(), ["--version"]);
  const proc = Bun.spawnSync(call.argv, {
    cwd,
    env: childEnv(path),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000,
    windowsVerbatimArguments: call.verbatim,
  });
  return proc.stdout.toString().trim() || proc.stderr.toString().trim();
}

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), "chvm-e2e-"));
  shims = join(sandbox, "shims");

  fakeBin = join(sandbox, "fake-system-bin");
  mkdirSync(fakeBin, { recursive: true });
  // Windows cannot run a shebang script, so the fake system install is a .cmd there
  if (WINDOWS) {
    writeFileSync(
      join(fakeBin, "crewhaus.cmd"),
      '@echo off\r\nif /i "%~1"=="--version" (echo 9.9.9-system& exit /b 0)\r\necho fake\r\n',
    );
  } else {
    const fakeSystem = join(fakeBin, "crewhaus");
    writeFileSync(
      fakeSystem,
      '#!/usr/bin/env bash\n[ "${1:-}" = "--version" ] && { echo 9.9.9-system; exit 0; }\necho fake\n',
    );
    chmodSync(fakeSystem, 0o755);
  }

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
  // maxRetries: a Windows indexer or AV can hold a handle open just after the last spawn
  rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}, 60_000);

describe("chvm end to end", () => {
  test(`install ${VERSION} from npm`, () => {
    const path = withPath(shims);
    const result = runChvm(["install", VERSION], path);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    // the package entry, not node_modules/.bin — the .bin layout differs per platform
    expect(
      existsSync(
        join(sandbox, "versions", VERSION, "node_modules", "crewhaus", "dist", "index.js"),
      ),
    ).toBe(true);
  }, 300_000);

  test(`use ${VERSION} — crewhaus --version reports it`, () => {
    const path = withPath(shims);
    const result = runChvm(["use", VERSION], path);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`crewhaus --version → ${VERSION}`);
    expect(readFileSync(join(sandbox, "version"), "utf8").trim()).toBe(VERSION);
    expect(runShim(path)).toBe(VERSION);
  }, 120_000);

  test("the shim works from any cwd", () => {
    const path = withPath(shims);
    expect(runShim(path, tmpdir())).toBe(VERSION);
  }, 60_000);

  // Windows is excluded on purpose: there the equivalent path writes HKCU\\Environment, and a
  // test suite has no business editing the registry. That branch is unit-tested instead.
  test.skipIf(WINDOWS)(
    "puts the shims dir on PATH itself when it is not there yet",
    () => {
      // after `npm i -g @crewhaus/chvm`, `chvm use` is the first command anyone runs — it has to
      // finish the job rather than print a note telling them to run a second one.
      // SHELL is pinned so the rc file is known: runners disagree about it (unset on some,
      // /bin/bash on others), and an unset SHELL takes a different branch entirely.
      const rc = join(sandbox, ".zshrc");
      rmSync(rc, { force: true });
      const result = runChvm(["use", VERSION], process.env.PATH ?? "", { SHELL: "/bin/zsh" });
      expect(result.code).toBe(0);
      // it names the file it edited, rather than changing a profile silently
      expect(result.stdout).toContain(rc);
      expect(result.stdout).toContain("Open a new terminal");
      expect(readFileSync(rc, "utf8")).toContain("chvm");
    },
    60_000,
  );

  test.skipIf(WINDOWS)(
    "says what to run by hand when it will not edit a profile",
    () => {
      // an unset SHELL on posix means there is no rc file we are willing to touch
      const result = runChvm(["use", VERSION], process.env.PATH ?? "", { SHELL: "" });
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Add this yourself");
    },
    60_000,
  );

  test("use system skips the shim and runs the next crewhaus on PATH", () => {
    const path = withPath(shims, fakeBin);
    const result = runChvm(["use", "system"], path);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("crewhaus --version → 9.9.9-system");
    expect(runShim(path)).toBe("9.9.9-system");
  }, 60_000);

  test("use local runs a factory checkout from source and remembers the path", () => {
    const path = withPath(shims);
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
    const path = withPath(shims);
    expect(runChvm(["current"], path).stdout).toContain("9.9.9-local");
    expect(runChvm(["which"], path).stdout.trim()).toBe(
      join(fakeRepo, "apps", "cli", "src", "index.ts"),
    );
    const ls = runChvm(["ls"], path).stdout;
    expect(ls).toContain(`  ${VERSION}`);
    expect(ls).toContain("* local");
  }, 60_000);

  test("uninstall refuses the active version, then succeeds after switching", () => {
    const path = withPath(shims, fakeBin);
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
    const path = withPath(shims);
    const result = runChvm(["use", "0.0.99"], path);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("does not exist");
  }, 60_000);

  test("install system/local points at chvm use instead of suggesting itself", () => {
    const path = withPath(shims);
    const result = runChvm(["install", "system"], path);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("chvm use system");
  }, 60_000);

  // regression: a shim invoked with a foreign CHVM_DIR (or a copied shim) used to exec
  // itself forever; it must skip itself ($0) and land on the next crewhaus on PATH
  test("shim with a foreign CHVM_DIR does not exec itself forever", () => {
    const foreignDir = join(sandbox, "foreign-chvm");
    mkdirSync(foreignDir, { recursive: true });
    const call = invocation(shimEntry(), ["--version"]);
    const proc = Bun.spawnSync(call.argv, {
      windowsVerbatimArguments: call.verbatim,
      cwd: homedir(),
      // empty CHVM_DIR: the target defaults to "system"
      env: { ...childEnv(withPath(shims, fakeBin)), CHVM_DIR: foreignDir },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 15_000,
    });
    expect(proc.stdout.toString().trim()).toBe("9.9.9-system");
  }, 30_000);
});
