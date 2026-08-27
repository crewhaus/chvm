import { describe, expect, test } from "bun:test";
import { RC_BLOCK, RC_LINE, rcFileForShell, withChvmPath } from "./setup";

describe("withChvmPath", () => {
  test("appends the PATH block to existing content", () => {
    const result = withChvmPath("# my zshrc\n");
    expect(result).toContain(RC_LINE);
    expect(result?.startsWith("# my zshrc\n")).toBe(true);
  });

  test("adds a separating newline when content does not end with one", () => {
    const result = withChvmPath("alias ll='ls -l'");
    expect(result).toContain("alias ll='ls -l'\n");
  });

  test("is idempotent — returns null when already present", () => {
    const once = withChvmPath("");
    expect(once).not.toBeNull();
    expect(withChvmPath(once as string)).toBeNull();
  });

  test("respects hand-written variants, with or without the CHVM_DIR fallback", () => {
    expect(withChvmPath('PATH="$HOME/.chvm/shims:$PATH"\n')).toBeNull();
    expect(withChvmPath('export PATH="${CHVM_DIR:-$HOME/.chvm}/shims:$PATH"\n')).toBeNull();
  });
});

describe("rcFileForShell", () => {
  test("maps zsh to .zshrc on every platform", () => {
    expect(rcFileForShell("/bin/zsh", "darwin")?.endsWith(".zshrc")).toBe(true);
    expect(rcFileForShell("/bin/zsh", "linux")?.endsWith(".zshrc")).toBe(true);
  });

  test("maps bash to .bash_profile on macOS (login shells never read .bashrc) and .bashrc elsewhere", () => {
    expect(rcFileForShell("/opt/homebrew/bin/bash", "darwin")?.endsWith(".bash_profile")).toBe(
      true,
    );
    expect(rcFileForShell("/bin/bash", "linux")?.endsWith(".bashrc")).toBe(true);
  });

  test("returns null for shells it will not auto-edit", () => {
    expect(rcFileForShell("/usr/local/bin/fish", "darwin")).toBeNull();
    expect(rcFileForShell("", "linux")).toBeNull();
  });
});

test("RC_BLOCK is a comment plus the CHVM_DIR-aware export line", () => {
  const lines = RC_BLOCK.trim().split("\n");
  expect(lines).toHaveLength(2);
  expect(lines[0]?.startsWith("#")).toBe(true);
  expect(lines[1]).toBe(RC_LINE);
  expect(RC_LINE).toBe('export PATH="${CHVM_DIR:-$HOME/.chvm}/shims:$PATH"');
});
