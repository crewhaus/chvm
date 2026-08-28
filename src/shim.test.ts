import { describe, expect, test } from "bun:test";
import { SHIM_MARKER } from "./layout";
import { shimNames } from "./paths";
import {
  CMD_SHIM_CONTENT,
  SHIM_CONTENT,
  chvmCmdLauncherContent,
  chvmLauncherContent,
  shimFiles,
} from "./shim";

describe("SHIM_CONTENT (posix)", () => {
  test("is a bash script handling all three target kinds", () => {
    expect(SHIM_CONTENT.startsWith("#!/usr/bin/env bash\n")).toBe(true);
    expect(SHIM_CONTENT).toContain('"system"');
    expect(SHIM_CONTENT).toContain("local:*");
  });

  test("reads the recorded entry, and probes legacy layouts when there is none", () => {
    // the entry is recorded at install time rather than assumed: 0.1.3 and 0.1.4 published
    // src/index.ts and shipped no dist/ at all
    expect(SHIM_CONTENT).toContain('read -r rel < "$root/entry"');
    expect(SHIM_CONTENT).toContain("node_modules/crewhaus/dist/index.js");
    expect(SHIM_CONTENT).toContain("node_modules/crewhaus/src/index.ts");
    // .bin is last: a symlink to the real entry on POSIX, a .bunx/.exe wrapper on Windows
    expect(SHIM_CONTENT).toContain("node_modules/.bin/crewhaus");
  });

  test("survived TypeScript template interpolation intact", () => {
    expect(SHIM_CONTENT).not.toContain("undefined");
    expect(SHIM_CONTENT).toContain('CHVM_DIR="${CHVM_DIR:-$HOME/.chvm}"');
    expect(SHIM_CONTENT).toContain('repo="${target#local:}"');
    expect(SHIM_CONTENT).toContain('"${path_dirs[@]}"');
  });

  test("re-reads the version file at run time (no baked-in version)", () => {
    expect(SHIM_CONTENT).toContain('read -r target < "$CHVM_DIR/version"');
  });

  test("tolerates a CRLF version file (someone opened it in Notepad)", () => {
    expect(SHIM_CONTENT).toContain("target=\"${target%$'\\r'}\"");
  });

  test("guards against exec-ing itself (copied shim / CHVM_DIR override)", () => {
    expect(SHIM_CONTENT).toContain('[ "$candidate" -ef "$0" ] && continue');
    expect(SHIM_CONTENT).toContain("CHVM_SHIM_DEPTH");
    expect(SHIM_CONTENT).toContain(`grep -q "${SHIM_MARKER}"`);
  });
});

describe("CMD_SHIM_CONTENT (windows)", () => {
  test("is a batch file handling all three target kinds", () => {
    expect(CMD_SHIM_CONTENT.startsWith("@echo off\n")).toBe(true);
    expect(CMD_SHIM_CONTENT).toContain(":chvm_system");
    expect(CMD_SHIM_CONTENT).toContain(":chvm_local");
    expect(CMD_SHIM_CONTENT).toContain(":chvm_version");
  });

  test("survived TypeScript template interpolation intact", () => {
    expect(CMD_SHIM_CONTENT).not.toContain("undefined");
    expect(CMD_SHIM_CONTENT).toContain("node_modules\\crewhaus\\dist\\index.js");
    expect(CMD_SHIM_CONTENT).toContain("apps\\cli\\src\\index.ts");
  });

  test("re-reads the version file at run time (no baked-in version)", () => {
    expect(CMD_SHIM_CONTENT).toContain('set /p chvm_target=<"%CHVM_DIR%\\version"');
  });

  test("strips the local: prefix without delayed expansion", () => {
    // %VAR:*local:=% avoids EnableDelayedExpansion, which would eat a literal ! in a path
    expect(CMD_SHIM_CONTENT).toContain('set "chvm_repo=%chvm_target:*local:=%"');
    expect(CMD_SHIM_CONTENT).not.toContain("EnableDelayedExpansion");
  });

  test("forwards arguments and the child's exit code", () => {
    expect(CMD_SHIM_CONTENT).toContain('bun "%chvm_entry%" %*');
    expect(CMD_SHIM_CONTENT).toContain("exit /b %ERRORLEVEL%");
    // batch has no exec; another .cmd must be `call`ed or control never returns
    expect(CMD_SHIM_CONTENT).toContain('call "%chvm_found%" %*');
  });

  test("guards against calling itself (copied shim / CHVM_DIR override)", () => {
    expect(CMD_SHIM_CONTENT).toContain("CHVM_SHIM_DEPTH");
    expect(CMD_SHIM_CONTENT).toContain("if %chvm_depth% GEQ 10");
    expect(CMD_SHIM_CONTENT).toContain(`findstr /m /c:"${SHIM_MARKER}"`);
    // never scan a ~100MB compiled crewhaus.exe on every single invocation
    expect(CMD_SHIM_CONTENT).toContain("if %~z1 LSS 65536");
  });

  test("delegates PATH+PATHEXT resolution to `where` rather than re-implementing it", () => {
    expect(CMD_SHIM_CONTENT).toContain("where crewhaus");
  });

  test("carries the marker every flavour needs, so isChvmShim can spot it", () => {
    expect(CMD_SHIM_CONTENT).toContain(SHIM_MARKER);
  });
});

describe("launchers", () => {
  test("posix launcher execs bun on the given entry", () => {
    const launcher = chvmLauncherContent("/somewhere/chvm/src/index.ts");
    expect(launcher).toContain('exec bun "/somewhere/chvm/src/index.ts" "$@"');
    expect(launcher.startsWith("#!/usr/bin/env bash\n")).toBe(true);
  });

  test("posix launcher escapes a path that would break the double-quoted string", () => {
    const launcher = chvmLauncherContent('/we ird/$HOME/"q"/src/index.ts');
    expect(launcher).toContain('\\"q\\"');
    expect(launcher).toContain("\\$HOME");
  });

  test("cmd launcher runs bun on the given entry and forwards the exit code", () => {
    const launcher = chvmCmdLauncherContent("C:\\Users\\me\\chvm\\src\\index.ts");
    expect(launcher).toContain('bun "C:\\Users\\me\\chvm\\src\\index.ts" %*');
    expect(launcher).toContain("exit /b %ERRORLEVEL%");
  });
});

describe("shim file set", () => {
  test("posix writes one file per command", () => {
    expect(shimNames("crewhaus", "linux")).toEqual(["crewhaus"]);
    expect(shimFiles("darwin")).toEqual(["crewhaus", "chvm"]);
  });

  test("windows writes a .cmd (PATHEXT) plus the bash shim (Git Bash), and no .ps1", () => {
    expect(shimNames("crewhaus", "win32")).toEqual(["crewhaus.cmd", "crewhaus"]);
    expect(shimFiles("win32")).toEqual(["crewhaus.cmd", "crewhaus", "chvm.cmd", "chvm"]);
    expect(shimFiles("win32").some((f) => f.endsWith(".ps1"))).toBe(false);
  });
});
