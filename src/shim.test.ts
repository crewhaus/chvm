import { describe, expect, test } from "bun:test";
import { SHIM_CONTENT, chvmLauncherContent } from "./shim";

describe("SHIM_CONTENT", () => {
  test("is a bash script handling all three target kinds", () => {
    expect(SHIM_CONTENT.startsWith("#!/usr/bin/env bash\n")).toBe(true);
    expect(SHIM_CONTENT).toContain('"system"');
    expect(SHIM_CONTENT).toContain("local:*");
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

  test("guards against exec-ing itself (copied shim / CHVM_DIR override)", () => {
    expect(SHIM_CONTENT).toContain('[ "$candidate" -ef "$0" ] && continue');
    expect(SHIM_CONTENT).toContain("CHVM_SHIM_DEPTH");
    expect(SHIM_CONTENT).toContain('grep -q "managed by chvm"');
  });
});

describe("chvmLauncherContent", () => {
  test("execs bun on the given entry", () => {
    const launcher = chvmLauncherContent("/somewhere/version-manager/src/index.ts");
    expect(launcher).toContain('exec bun "/somewhere/version-manager/src/index.ts" "$@"');
    expect(launcher.startsWith("#!/usr/bin/env bash\n")).toBe(true);
  });
});
