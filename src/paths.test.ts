import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  chvmDir,
  normalizeChvmDir,
  posixShimPath,
  shimNames,
  shimPath,
  shimsDir,
  versionsDir,
} from "./paths";

let previousChvmDir: string | undefined;

beforeEach(() => {
  previousChvmDir = process.env.CHVM_DIR;
});

afterEach(() => {
  process.env.CHVM_DIR = previousChvmDir ?? "";
});

describe("chvmDir", () => {
  test("defaults to ~/.chvm", () => {
    process.env.CHVM_DIR = "";
    expect(chvmDir()).toBe(join(homedir(), ".chvm"));
  });

  test("CHVM_DIR overrides it, and everything else follows", () => {
    const root = join("/tmp", "chvm-paths-fixture");
    process.env.CHVM_DIR = root;
    expect(chvmDir()).toBe(root);
    expect(versionsDir()).toBe(join(root, "versions"));
    expect(shimsDir()).toBe(join(root, "shims"));
  });
});

describe("shimNames", () => {
  test("posix has exactly one shim per command", () => {
    expect(shimNames("crewhaus", "linux")).toEqual(["crewhaus"]);
    expect(shimNames("chvm", "darwin")).toEqual(["chvm"]);
  });

  test("windows leads with .cmd — the only form cmd.exe can resolve from a bare name", () => {
    expect(shimNames("crewhaus", "win32")[0]).toBe("crewhaus.cmd");
  });

  test("windows keeps the extensionless shim too, for Git Bash and MSYS2", () => {
    expect(shimNames("crewhaus", "win32")).toContain("crewhaus");
  });
});

describe("shimPath", () => {
  test("names the file a bare `crewhaus` actually resolves to, per platform", () => {
    process.env.CHVM_DIR = join("/tmp", "chvm-paths-fixture");
    expect(shimPath("linux").endsWith(join("shims", "crewhaus"))).toBe(true);
    expect(shimPath("win32").endsWith(join("shims", "crewhaus.cmd"))).toBe(true);
  });

  test("the POSIX shim path is the same on every platform (Git Bash reads it on Windows)", () => {
    process.env.CHVM_DIR = join("/tmp", "chvm-paths-fixture");
    expect(posixShimPath().endsWith(join("shims", "crewhaus"))).toBe(true);
  });
});

describe("normalizeChvmDir", () => {
  test("leaves everything alone off Windows", () => {
    expect(normalizeChvmDir("/c/foo", "linux")).toBe("/c/foo");
    expect(normalizeChvmDir("/home/me/.chvm", "darwin")).toBe("/home/me/.chvm");
  });

  test("translates a Git Bash path so bun and the bash shim agree on one directory", () => {
    // the shim reads /c/foo as C:\foo; win32 path.join would read it as \c\foo — a different dir
    expect(normalizeChvmDir("/c/foo", "win32")).toBe("C:\\foo");
    expect(normalizeChvmDir("/c/Users/me/.chvm", "win32")).toBe("C:\\Users\\me\\.chvm");
  });

  test("handles the Cygwin form and a bare drive", () => {
    expect(normalizeChvmDir("/cygdrive/d/state", "win32")).toBe("D:\\state");
    expect(normalizeChvmDir("/c", "win32")).toBe("C:\\");
  });

  test("leaves a path already in Windows form untouched", () => {
    expect(normalizeChvmDir("C:\\Users\\me\\.chvm", "win32")).toBe("C:\\Users\\me\\.chvm");
    expect(normalizeChvmDir("D:/state", "win32")).toBe("D:/state");
  });

  test("does not mistake a normal POSIX-looking path for a drive", () => {
    expect(normalizeChvmDir("/opt/chvm", "win32")).toBe("/opt/chvm");
    expect(normalizeChvmDir("/usr", "win32")).toBe("/usr");
  });
});
