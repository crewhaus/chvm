import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { shimsDir } from "./paths";
import { spawnSync } from "./runtime";

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

export type ShellFamily = "posix" | "powershell" | "cmd";

/**
 * Which shell we are talking to. On Windows, Git Bash sets SHELL and cmd.exe/PowerShell do not;
 * PROMPT is set by cmd.exe, while PSModulePath marks a PowerShell session.
 */
export function shellFamily(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): ShellFamily {
  if (platform !== "win32") return "posix";
  if (env.SHELL) return "posix"; // Git Bash / MSYS2 / Cygwin
  return env.PROMPT && !env.PSModulePath ? "cmd" : "powershell";
}

/**
 * The one-liner that puts the shims on PATH for the *current* shell.
 * Three shells matter on Windows, and each rejects the others' syntax.
 */
export function activationLine(family: ShellFamily = shellFamily(), shims = shimsDir()): string {
  switch (family) {
    case "cmd":
      return `set "PATH=${shims};%PATH%"`;
    case "powershell":
      return `$env:Path = "${shims};$env:Path"`;
    default:
      return RC_LINE;
  }
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
  $want = $shims.TrimEnd('\\')
  # Compare expanded: the value is read un-expanded on purpose, so an entry stored as
  # %USERPROFILE%\\.chvm\\shims would never match literally and we would append a duplicate.
  $isOurs = { param($p) [Environment]::ExpandEnvironmentVariables($p).TrimEnd('\\') -ieq $want }
  if ($parts.Count -gt 0 -and (& $isOurs $parts[0])) { Write-Output 'chvm:present'; exit 0 }
  # Present but not first is not good enough — the shim has to win over whatever precedes it,
  # and a user who hand-appended the directory can only be rescued by moving it.
  $rest = @($parts | Where-Object { -not (& $isOurs $_) })
  $key.SetValue('Path', ((@($shims) + $rest) -join ';'), $kind)
  # Without a broadcast no running process re-reads the environment — explorer.exe included,
  # so a terminal opened from the Start menu would still inherit the old PATH. This is the one
  # service setx performs that a direct registry write does not.
  Add-Type -Namespace ChvmNative -Name Win -MemberDefinition @'
[DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Auto)]
public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);
'@ -ErrorAction SilentlyContinue
  try {
    $r = [UIntPtr]::Zero
    [ChvmNative.Win]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$r) | Out-Null
  } catch { }
  Write-Output 'chvm:added'
} finally { $key.Close() }
`;
  try {
    // absolute on purpose: a bare "powershell.exe" is resolved with the cwd searched first on
    // Windows, so a stray binary where setup happens to run would be executed instead
    const powershell = process.env.SystemRoot
      ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
      : "powershell.exe";
    const proc = spawnSync([powershell, "-NoProfile", "-NonInteractive", "-Command", script], {
      timeout: 60_000,
      env: { ...process.env, CHVM_SETUP_SHIMS: shims },
    });
    const out = proc.stdout;
    if (out.includes("chvm:added")) return { kind: "user-path", rcFile: null, changed: true };
    if (out.includes("chvm:present")) return { kind: "user-path", rcFile: null, changed: false };
    // the first non-empty line carries the exception; the rest is the CategoryInfo trailer
    const detail = (proc.stderr.split(/\r?\n/).find((l) => l.trim() !== "") ?? "").trim();
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

/**
 * Ensure the shims dir is on PATH, however this platform and shell do that.
 *
 * On Windows the user PATH is written unconditionally — including from Git Bash, which has an
 * rc file of its own. Writing only that rc file would leave `crewhaus.cmd` unreachable from
 * cmd.exe, PowerShell and Windows Terminal, which is the whole point of the Windows shim. The
 * reverse is not a problem: MSYS translates the inherited Windows PATH into the bash PATH, so
 * the user PATH covers Git Bash too.
 */
export function ensureRcPath(
  platform: NodeJS.Platform = process.platform,
  home = homedir(),
): RcResult {
  const rcFile = rcFileForShell(undefined, platform, home);
  if (platform === "win32") {
    const user = ensureWindowsPath();
    if (rcFile === null) return user;
    const rc = writeRcFile(rcFile);
    // report the user-PATH write: that is the one making the .cmd shim reachable
    return { ...user, rcFile, changed: user.changed || rc.changed };
  }
  if (rcFile === null) {
    return { kind: "none", rcFile: null, changed: false };
  }
  return writeRcFile(rcFile);
}

/**
 * Append our block to a shell rc file.
 *
 * Preserves a BOM and CRLF endings — PowerShell and Windows editors both produce them, and
 * rewriting a profile without them can break the file for its original owner.
 */
function writeRcFile(rcFile: string): RcResult {
  const raw = existsSync(rcFile) ? readFileSync(rcFile, "utf8") : "";
  const bom = raw.startsWith("﻿") ? "﻿" : "";
  const body = bom ? raw.slice(1) : raw;
  const updated = withChvmPath(body);
  if (updated === null) return { kind: "rc", rcFile, changed: false };
  const crlf = /\r\n/.test(body) && !/[^\r]\n/.test(body);
  writeFileSync(rcFile, bom + (crlf ? updated.replace(/\r?\n/g, "\r\n") : updated));
  return { kind: "rc", rcFile, changed: true };
}
