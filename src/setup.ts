import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { shimsDir } from "./paths";

/**
 * Matches our block and reasonable hand-written variants, on any platform.
 * The comment line is the reliable half; the path alternative catches a line someone wrote
 * themselves, with either separator and with or without the CHVM_DIR fallback in between.
 */
const RC_MARKER = /# chvm — CrewHaus version manager|\.chvm[^\n]{0,24}[\\/]shims/;

export const RC_LINE = `export PATH="\${CHVM_DIR:-$HOME/.chvm}/shims:$PATH"`;

export const RC_BLOCK = `
# chvm — CrewHaus version manager
${RC_LINE}
`;

/** The one-liner that puts the shims on PATH for the *current* shell, per shell family. */
export function activationLine(
  platform: NodeJS.Platform = process.platform,
  shims = shimsDir(),
): string {
  return platform === "win32" ? `$env:Path = "${shims};$env:Path"` : RC_LINE;
}

/** Append the PATH block unless some form of it is already there. Null = already set up. */
export function withChvmPath(rcContent: string): string | null {
  if (RC_MARKER.test(rcContent)) return null;
  const separator = rcContent === "" || /\r?\n$/.test(rcContent) ? "" : "\n";
  return `${rcContent}${separator}${RC_BLOCK}`;
}

/**
 * The rc file for the user's shell, or null for shells we don't auto-edit.
 *
 * macOS terminals start bash as a login shell, which reads .bash_profile, never .bashrc.
 * On Windows, SHELL is set under Git Bash (so that branch still applies) and unset under
 * cmd.exe and PowerShell — where there is no rc file to edit and PATH lives in the registry.
 */
export function rcFileForShell(
  shell = process.env.SHELL ?? "",
  platform: NodeJS.Platform = process.platform,
  home = homedir(),
): string | null {
  // a Windows SHELL is usually an absolute path ending in .exe
  const name = basename(shell.replace(/\\/g, "/")).replace(/\.exe$/i, "");
  switch (name) {
    case "zsh":
      return join(home, ".zshrc");
    case "bash":
      // Git Bash on Windows reads .bashrc, like Linux; only macOS is the .bash_profile case
      return join(home, platform === "darwin" ? ".bash_profile" : ".bashrc");
    default:
      return null;
  }
}

export interface RcResult {
  /** "rc" edited a shell profile; "user-path" wrote the Windows user PATH; "none" did neither. */
  kind: "rc" | "user-path" | "none";
  rcFile: string | null;
  changed: boolean;
  /** Set when kind is "none" and we could not do it ourselves. */
  reason?: string;
}

/**
 * Put the shims dir on the persistent Windows user PATH.
 *
 * Deliberately not `setx`, which silently truncates at 1024 characters. We edit
 * HKCU\Environment directly and keep the value's existing REG_EXPAND_SZ kind, so entries
 * written as `%USERPROFILE%\...` by other installers stay un-expanded rather than being
 * baked into literals — the classic damage done by a naive read/modify/write of PATH.
 *
 * Only the *user* PATH is touched; the machine PATH is never read or written.
 */
export function ensureWindowsPath(shims = shimsDir()): RcResult {
  // The path travels in the environment, not in the command line: embedding it in the script
  // would mean getting PowerShell quoting right for every path a user might have.
  const script = `
$ErrorActionPreference = 'Stop'
$shims = $env:CHVM_SETUP_SHIMS
if ([string]::IsNullOrEmpty($shims)) { Write-Output 'chvm:unreadable'; exit 0 }
$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
if ($null -eq $key) { Write-Output 'chvm:unreadable'; exit 0 }
try {
  $current = $key.GetValue('Path', $null, 'DoNotExpandEnvironmentNames')
  if ($null -eq $current) { $kind = 'ExpandString'; $current = '' }
  else { $kind = $key.GetValueKind('Path') }
  $parts = @($current -split ';' | Where-Object { $_ -ne '' })
  foreach ($p in $parts) {
    if ($p.TrimEnd('\\') -ieq $shims.TrimEnd('\\')) { Write-Output 'chvm:present'; exit 0 }
  }
  $key.SetValue('Path', ((@($shims) + $parts) -join ';'), $kind)
  Write-Output 'chvm:added'
} finally { $key.Close() }
`;
  try {
    const proc = Bun.spawnSync(
      ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
      {
        stdout: "pipe",
        stderr: "pipe",
        timeout: 60_000,
        env: { ...process.env, CHVM_SETUP_SHIMS: shims },
      },
    );
    const out = proc.stdout.toString();
    if (out.includes("chvm:added")) return { kind: "user-path", rcFile: null, changed: true };
    if (out.includes("chvm:present")) return { kind: "user-path", rcFile: null, changed: false };
    const detail = proc.stderr.toString().trim().split("\n").slice(-2).join(" ").trim();
    return {
      kind: "none",
      rcFile: null,
      changed: false,
      reason: detail === "" ? "could not read the user PATH" : detail,
    };
  } catch (err) {
    return {
      kind: "none",
      rcFile: null,
      changed: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Ensure the shims dir is on PATH, however this platform and shell do that. */
export function ensureRcPath(platform: NodeJS.Platform = process.platform): RcResult {
  const rcFile = rcFileForShell(undefined, platform);
  if (rcFile === null) {
    if (platform === "win32") return ensureWindowsPath();
    return { kind: "none", rcFile: null, changed: false };
  }
  // Preserve a BOM and CRLF endings — PowerShell and Windows editors both produce them,
  // and rewriting a profile without them can break the file for its original owner.
  const raw = existsSync(rcFile) ? readFileSync(rcFile, "utf8") : "";
  const bom = raw.startsWith("﻿") ? "﻿" : "";
  const body = bom ? raw.slice(1) : raw;
  const updated = withChvmPath(body);
  if (updated === null) return { kind: "rc", rcFile, changed: false };
  const crlf = /\r\n/.test(body) && !/[^\r]\n/.test(body);
  writeFileSync(rcFile, bom + (crlf ? updated.replace(/\r?\n/g, "\r\n") : updated));
  return { kind: "rc", rcFile, changed: true };
}
