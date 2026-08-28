import { describe, expect, test } from "bun:test";
import { RC_BLOCK, RC_LINE, activationLine, rcFileForShell, withChvmPath } from "./setup";

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

  test("treats a CRLF-terminated file as already newline-terminated", () => {
    const result = withChvmPath("# profile\r\n");
    expect(result?.startsWith("# profile\r\n\n")).toBe(true);
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

  test("recognises a Windows-style line, so setup never double-appends there", () => {
    expect(withChvmPath('$env:Path = "C:\\Users\\me\\.chvm\\shims;$env:Path"\r\n')).toBeNull();
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

  test("cmd.exe and PowerShell set no SHELL, so Windows takes the user-PATH route", () => {
    expect(rcFileForShell("", "win32")).toBeNull();
  });

  test("Git Bash on Windows does set SHELL, and still gets .bashrc", () => {
    const rc = rcFileForShell("C:\\Program Files\\Git\\bin\\bash.exe", "win32", "C:\\Users\\me");
    expect(rc).not.toBeNull();
    expect(rc?.endsWith(".bashrc")).toBe(true);
  });
});

describe("activationLine", () => {
  test("is the export line on posix", () => {
    expect(activationLine("linux")).toBe(RC_LINE);
  });

  test("is a PowerShell assignment on Windows, naming the real shims dir", () => {
    expect(activationLine("win32", "C:\\Users\\me\\.chvm\\shims")).toBe(
      '$env:Path = "C:\\Users\\me\\.chvm\\shims;$env:Path"',
    );
  });

  test("prepends, so the shim wins over an existing system install", () => {
    expect(activationLine("win32", "S").startsWith('$env:Path = "S;')).toBe(true);
    expect(RC_LINE.includes("/shims:$PATH")).toBe(true);
  });
});

test("RC_BLOCK is a comment plus the CHVM_DIR-aware export line", () => {
  const lines = RC_BLOCK.trim().split("\n");
  expect(lines).toHaveLength(2);
  expect(lines[0]?.startsWith("#")).toBe(true);
  expect(lines[1]).toBe(RC_LINE);
  expect(RC_LINE).toBe('export PATH="${CHVM_DIR:-$HOME/.chvm}/shims:$PATH"');
});
