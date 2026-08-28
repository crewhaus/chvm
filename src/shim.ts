import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ENTRY_FILE,
  FACTORY_ENTRY_SEGMENTS,
  LEGACY_ENTRY_CANDIDATES,
  SHIM_MARKER,
  joinFor,
} from "./layout";
import { shimNames, shimsDir } from "./paths";

const POSIX_FACTORY = joinFor("linux", FACTORY_ENTRY_SEGMENTS);
const WIN_FACTORY = joinFor("win32", FACTORY_ENTRY_SEGMENTS);
/** Fallback probe list for installs made before chvm recorded an entry file. */
const POSIX_LEGACY = LEGACY_ENTRY_CANDIDATES.map((c) => `"$root/${c}"`).join(" \\\n           ");
const WIN_LEGACY = LEGACY_ENTRY_CANDIDATES.map((c) => `"${c.replace(/\//g, "\\")}"`).join(" ");

/**
 * The POSIX crewhaus shim. It re-reads $CHVM_DIR/version on every invocation, so
 * `chvm use` takes effect immediately in every open shell — no rehash, no re-source.
 *
 * Written on Windows too: Git Bash, MSYS2 and Cygwin run it and see a colon-separated PATH.
 */
export const SHIM_CONTENT = `#!/usr/bin/env bash
# crewhaus shim — ${SHIM_MARKER} (CrewHaus version manager). Do not edit.
# \`chvm use <version|system|local>\` changes what this runs.
set -uo pipefail

CHVM_DIR="\${CHVM_DIR:-$HOME/.chvm}"
target="system"
if [ -f "$CHVM_DIR/version" ]; then
  IFS= read -r target < "$CHVM_DIR/version" || true
  target="\${target%$'\\r'}"
  [ -n "$target" ] || target="system"
fi

need_bun() {
  if ! command -v bun >/dev/null 2>&1; then
    echo "chvm: bun is required to run crewhaus $1 — install it from https://bun.sh" >&2
    exit 127
  fi
}

case "$target" in
  system)
    # a copy of this shim elsewhere on PATH (or a CHVM_DIR override) could
    # otherwise make the shim exec itself forever — hence the $0 skip and depth cap
    depth="\${CHVM_SHIM_DEPTH:-0}"
    if [ "$depth" -ge 10 ]; then
      echo "chvm: shim recursion detected — is a copy of the crewhaus shim on PATH?" >&2
      exit 127
    fi
    export CHVM_SHIM_DEPTH=$((depth + 1))
    self="$CHVM_DIR/shims/crewhaus"
    IFS=: read -ra path_dirs <<< "$PATH"
    for dir in "\${path_dirs[@]}"; do
      [ -n "$dir" ] || continue
      candidate="$dir/crewhaus"
      [ -f "$candidate" ] && [ -x "$candidate" ] || continue
      [ "$candidate" -ef "$0" ] && continue
      [ "$candidate" -ef "$self" ] && continue
      [ "$dir" -ef "$CHVM_DIR/shims" ] && continue
      head -2 "$candidate" 2>/dev/null | grep -q "${SHIM_MARKER}" && continue
      exec "$candidate" "$@"
    done
    echo "chvm: no system crewhaus on PATH (beyond the chvm shim)." >&2
    echo "chvm: install one (e.g. brew install crewhaus) or pick a version: chvm use latest" >&2
    exit 127
    ;;
  local:*)
    repo="\${target#local:}"
    entry="$repo/${POSIX_FACTORY}"
    if [ ! -f "$entry" ]; then
      echo "chvm: local checkout is missing $entry" >&2
      echo "chvm: point chvm at a factory checkout again: chvm use local <path>" >&2
      exit 127
    fi
    need_bun "from a local checkout"
    exec bun "$entry" "$@"
    ;;
  *)
    root="$CHVM_DIR/versions/$target"
    entry=""
    # chvm records the entry when it installs; older installs are probed instead,
    # because 0.1.3/0.1.4 shipped src/index.ts and no dist/ at all
    if [ -f "$root/${ENTRY_FILE}" ]; then
      IFS= read -r rel < "$root/${ENTRY_FILE}" || true
      rel="\${rel%$'\\r'}"
      [ -n "$rel" ] && [ -f "$root/$rel" ] && entry="$root/$rel"
    fi
    if [ -z "$entry" ]; then
      for candidate in ${POSIX_LEGACY}; do
        [ -f "$candidate" ] && { entry="$candidate"; break; }
      done
    fi
    if [ -z "$entry" ]; then
      echo "chvm: crewhaus $target is not installed — run: chvm install $target" >&2
      exit 127
    fi
    need_bun "$target"
    exec bun "$entry" "$@"
    ;;
esac
`;

/**
 * The Windows crewhaus shim, as a batch file.
 *
 * Things cmd.exe needs that bash does not, all of which shape this file:
 *   - an extension in PATHEXT — Windows does not process shebangs, so the extensionless
 *     POSIX shim is simply not executable here;
 *   - no `exec` — batch cannot replace its process, so the shim stays alive as the parent
 *     and forwards the child's status by hand with `exit /b %ERRORLEVEL%`;
 *   - `%*` instead of `"$@"`;
 *   - `call` before another batch file, or control never returns and the exit code is lost.
 *
 * Deliberately NOT using `setlocal EnableDelayedExpansion`: delayed expansion eats a literal
 * `!` in a path (a real hazard for `local:` targets), and we do not need it — every value read
 * inside a parenthesised block is consumed by a later top-level statement, which cmd parses
 * only once it reaches it.
 *
 * Known limitation, shared with npm and yarn's batch shims: Ctrl-C while a child is running
 * prompts "Terminate batch job (Y/N)?". Escaping that needs a compiled launcher, not batch.
 */
export const CMD_SHIM_CONTENT = `@echo off
REM crewhaus shim - ${SHIM_MARKER} (CrewHaus version manager). Do not edit.
REM "chvm use <version|system|local>" changes what this runs.
setlocal EnableExtensions

if not defined CHVM_DIR set "CHVM_DIR=%USERPROFILE%\\.chvm"

set "chvm_target=system"
if exist "%CHVM_DIR%\\version" (
  set /p chvm_target=<"%CHVM_DIR%\\version"
)
if not defined chvm_target set "chvm_target=system"

if /i "%chvm_target%"=="system" goto chvm_system
if /i "%chvm_target:~0,6%"=="local:" goto chvm_local
goto chvm_version

:chvm_version
set "chvm_root=%CHVM_DIR%\\versions\\%chvm_target%"
set "chvm_entry="
set "chvm_rel="
REM chvm records the entry when it installs; older installs are probed below, because
REM 0.1.3/0.1.4 shipped src/index.ts and no dist/ at all
if exist "%chvm_root%\\${ENTRY_FILE}" (
  set /p chvm_rel=<"%chvm_root%\\${ENTRY_FILE}"
)
if defined chvm_rel if exist "%chvm_root%\\%chvm_rel%" set "chvm_entry=%chvm_root%\\%chvm_rel%"
if not defined chvm_entry (
  for %%C in (${WIN_LEGACY}) do (
    if not defined chvm_entry if exist "%chvm_root%\\%%~C" set "chvm_entry=%chvm_root%\\%%~C"
  )
)
if not defined chvm_entry (
  >&2 echo chvm: crewhaus %chvm_target% is not installed - run: chvm install %chvm_target%
  exit /b 127
)
call :chvm_need_bun "%chvm_target%"
if errorlevel 1 exit /b 127
bun "%chvm_entry%" %*
exit /b %ERRORLEVEL%

:chvm_local
set "chvm_repo=%chvm_target:*local:=%"
set "chvm_entry=%chvm_repo%\\${WIN_FACTORY}"
if not exist "%chvm_entry%" (
  >&2 echo chvm: local checkout is missing %chvm_entry%
  >&2 echo chvm: point chvm at a factory checkout again: chvm use local ^<path^>
  exit /b 127
)
call :chvm_need_bun "from a local checkout"
if errorlevel 1 exit /b 127
bun "%chvm_entry%" %*
exit /b %ERRORLEVEL%

:chvm_system
REM a copy of this shim elsewhere on PATH (or a CHVM_DIR override) could otherwise
REM make the shim call itself forever - hence the marker check and the depth cap
if not defined CHVM_SHIM_DEPTH set "CHVM_SHIM_DEPTH=0"
set /a chvm_depth=CHVM_SHIM_DEPTH+1 2>nul
if not defined chvm_depth set "chvm_depth=1"
if %chvm_depth% GEQ 10 (
  >&2 echo chvm: shim recursion detected - is a copy of the crewhaus shim on PATH?
  exit /b 127
)
set "CHVM_SHIM_DEPTH=%chvm_depth%"
set "chvm_found="
REM \`where\` enumerates PATH in order and completes with PATHEXT, which is exactly the
REM resolution we need to reproduce - reimplementing it in batch would only get it wrong
for /f "delims=" %%F in ('where crewhaus 2^>nul') do (
  if not defined chvm_found call :chvm_consider "%%~fF"
)
if not defined chvm_found (
  >&2 echo chvm: no system crewhaus on PATH ^(beyond the chvm shim^).
  >&2 echo chvm: install one ^(e.g. scoop install crewhaus^) or pick a version: chvm use latest
  exit /b 127
)
call "%chvm_found%" %*
exit /b %ERRORLEVEL%

:chvm_consider
REM %1 is one \`where crewhaus\` hit. Accept it unless it is one of ours.
if /i "%~dp1"=="%CHVM_DIR%\\shims\\" exit /b 0
REM only a script can be a chvm shim; never scan a large compiled binary on every run
if %~z1 LSS 65536 (
  findstr /m /c:"${SHIM_MARKER}" "%~1" >nul 2>&1 && exit /b 0
)
set "chvm_found=%~1"
exit /b 0

:chvm_need_bun
where bun >nul 2>&1 && exit /b 0
>&2 echo chvm: bun is required to run crewhaus %~1 - install it from https://bun.sh
exit /b 1
`;

/** A launcher so `chvm` itself is on PATH via the same shims dir. */
export function chvmLauncherContent(entryPath: string): string {
  return `#!/usr/bin/env bash
# chvm launcher — ${SHIM_MARKER} setup. Do not edit.
exec bun "${entryPath.replace(/(["\\$`])/g, "\\$1")}" "$@"
`;
}

/** The same launcher for cmd.exe. */
export function chvmCmdLauncherContent(entryPath: string): string {
  return `@echo off
REM chvm launcher - ${SHIM_MARKER} setup. Do not edit.
bun "${entryPath}" %*
exit /b %ERRORLEVEL%
`;
}

/** cmd.exe is happiest with CRLF; a batch file with bare LF can mis-parse labels. */
function crlf(text: string): string {
  return text.replace(/\r?\n/g, "\r\n");
}

function write(path: string, content: string, executable: boolean): void {
  writeFileSync(path, content);
  // no-op on Windows (Node only honours the read-only bit there), which is fine
  if (executable) chmodSync(path, 0o755);
}

/** Write (or refresh) the shims. Idempotent; safe to call from any command. */
export function writeShims(
  chvmEntryPath?: string,
  platform: NodeJS.Platform = process.platform,
): void {
  const dir = shimsDir();
  mkdirSync(dir, { recursive: true });

  write(join(dir, "crewhaus"), SHIM_CONTENT, true);
  if (platform === "win32") {
    write(join(dir, "crewhaus.cmd"), crlf(CMD_SHIM_CONTENT), false);
  }

  if (!chvmEntryPath) return;
  write(join(dir, "chvm"), chvmLauncherContent(chvmEntryPath), true);
  if (platform === "win32") {
    write(join(dir, "chvm.cmd"), crlf(chvmCmdLauncherContent(chvmEntryPath)), false);
  }
}

/** Every shim file `writeShims` produces on a platform — used by tests and by uninstall docs. */
export function shimFiles(platform: NodeJS.Platform = process.platform): string[] {
  return [...shimNames("crewhaus", platform), ...shimNames("chvm", platform)];
}
