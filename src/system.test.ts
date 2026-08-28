import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { SHIM_MARKER } from "./layout";
import { candidateNames, findSystemCrewhaus, invocation } from "./system";

let sandbox: string;
let previousChvmDir: string | undefined;

function bin(dir: string, name: string, body = "#!/bin/sh\necho 1.2.3\n"): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, body);
  chmodSync(path, 0o755);
  return path;
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "chvm-system-"));
  previousChvmDir = process.env.CHVM_DIR;
  process.env.CHVM_DIR = sandbox;
});

afterEach(() => {
  process.env.CHVM_DIR = previousChvmDir ?? "";
  rmSync(sandbox, { recursive: true, force: true });
});

describe("candidateNames", () => {
  test("posix looks for the bare name only", () => {
    expect(candidateNames("crewhaus", "linux")).toEqual(["crewhaus"]);
    expect(candidateNames("crewhaus", "darwin", ".COM;.EXE")).toEqual(["crewhaus"]);
  });

  test("windows expands PATHEXT, bare name last", () => {
    expect(candidateNames("crewhaus", "win32", ".COM;.EXE;.CMD")).toEqual([
      "crewhaus.com",
      "crewhaus.exe",
      "crewhaus.cmd",
      "crewhaus",
    ]);
  });

  test("windows falls back to a sane PATHEXT when the variable is unset", () => {
    const names = candidateNames("crewhaus", "win32", undefined);
    expect(names).toContain("crewhaus.cmd");
    expect(names).toContain("crewhaus.exe");
  });

  test("ignores junk entries in PATHEXT", () => {
    expect(candidateNames("crewhaus", "win32", ".EXE;;  ;nonsense;.CMD")).toEqual([
      "crewhaus.exe",
      "crewhaus.cmd",
      "crewhaus",
    ]);
  });
});

describe("findSystemCrewhaus", () => {
  test("returns null when nothing on PATH is called crewhaus", () => {
    const empty = join(sandbox, "empty");
    mkdirSync(empty, { recursive: true });
    expect(findSystemCrewhaus(empty, "linux")).toBeNull();
  });

  test("finds a real install on PATH", () => {
    const dir = join(sandbox, "usr-bin");
    const path = bin(dir, "crewhaus");
    expect(findSystemCrewhaus(dir, "linux")).toBe(path);
  });

  test("skips the chvm shims directory", () => {
    const shims = join(sandbox, "shims");
    bin(shims, "crewhaus");
    expect(findSystemCrewhaus(shims, "linux")).toBeNull();
  });

  test("skips a copy of our own shim parked elsewhere on PATH", () => {
    const decoy = join(sandbox, "decoy");
    bin(decoy, "crewhaus", `#!/usr/bin/env bash\n# ${SHIM_MARKER}\n`);
    expect(findSystemCrewhaus(decoy, "linux")).toBeNull();
  });

  test("takes the first PATH entry that is not ours", () => {
    const shims = join(sandbox, "shims");
    const real = join(sandbox, "real");
    bin(shims, "crewhaus");
    const wanted = bin(real, "crewhaus");
    expect(findSystemCrewhaus([shims, real].join(delimiter), "linux")).toBe(wanted);
  });

  test("windows finds crewhaus.cmd, which posix lookup would miss entirely", () => {
    const dir = join(sandbox, "win");
    const cmd = bin(dir, "crewhaus.cmd", "@echo off\r\necho 1.2.3\r\n");
    // the bare name does not exist here — the whole point of PATHEXT probing
    expect(findSystemCrewhaus(dir, "linux")).toBeNull();
    expect(findSystemCrewhaus(dir, "win32", ".EXE;.CMD")).toBe(cmd);
  });

  test("windows prefers earlier PATHEXT entries", () => {
    const dir = join(sandbox, "both");
    const exe = bin(dir, "crewhaus.exe", "MZ");
    bin(dir, "crewhaus.cmd", "@echo off\r\n");
    expect(findSystemCrewhaus(dir, "win32", ".EXE;.CMD")).toBe(exe);
  });

  test("windows still skips a marked shim, whatever its extension", () => {
    const dir = join(sandbox, "wshims");
    bin(dir, "crewhaus.cmd", `@echo off\r\nREM ${SHIM_MARKER}\r\n`);
    expect(findSystemCrewhaus(dir, "win32", ".CMD")).toBeNull();
  });
});

describe("invocation", () => {
  test("posix runs a path directly, with no verbatim quoting", () => {
    expect(invocation("/usr/local/bin/crewhaus", ["--version"], "linux")).toEqual({
      argv: ["/usr/local/bin/crewhaus", "--version"],
      verbatim: false,
    });
  });

  test("a .cmd is not an executable image — it has to go through cmd.exe", () => {
    const call = invocation("C:\\x\\crewhaus.cmd", ["--version"], "win32");
    expect(call.argv.slice(0, 4)).toEqual(["cmd.exe", "/d", "/s", "/c"]);
    expect(call.verbatim).toBe(true);
    expect(invocation("C:\\x\\crewhaus.BAT", [], "win32").argv[0]).toBe("cmd.exe");
  });

  test("a path with a space survives `cmd /s /c`, which strips the outer quote pair", () => {
    // regression: a single quote pair is exactly what /s removes, so C:\Users\Max Meier\...
    // arrived unquoted and cmd tried to run "C:\Users\Max". The whole line needs wrapping.
    const call = invocation(
      "C:\\Users\\Max Meier\\.chvm\\shims\\crewhaus.cmd",
      ["--version"],
      "win32",
    );
    const line = call.argv[4] as string;
    expect(line.startsWith('""')).toBe(true);
    // after cmd strips the first and last quote, the path is still quoted
    expect(line.slice(1, -1)).toBe(
      '"C:\\Users\\Max Meier\\.chvm\\shims\\crewhaus.cmd" "--version"',
    );
  });

  test("a real .exe on Windows is run directly", () => {
    expect(invocation("C:\\x\\crewhaus.exe", ["--version"], "win32")).toEqual({
      argv: ["C:\\x\\crewhaus.exe", "--version"],
      verbatim: false,
    });
  });
});

describe("findSystemCrewhaus PATH hygiene", () => {
  test("a quoted PATH entry still resolves (installers and hand edits both quote)", () => {
    const dir = join(sandbox, "quoted");
    const path = bin(dir, "crewhaus");
    expect(findSystemCrewhaus(`"${dir}"`, "linux")).toBe(path);
  });

  test("a PATH entry padded with spaces still resolves", () => {
    const dir = join(sandbox, "padded");
    const path = bin(dir, "crewhaus");
    expect(findSystemCrewhaus(`  ${dir}  `, "linux")).toBe(path);
  });
});
