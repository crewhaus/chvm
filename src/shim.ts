import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { shimPath, shimsDir } from "./paths";

/**
 * The crewhaus shim. It re-reads $CHVM_DIR/version on every invocation, so
 * `chvm use` takes effect immediately in every open shell — no rehash, no re-source.
 */
export const SHIM_CONTENT = `#!/usr/bin/env bash
# crewhaus shim — managed by chvm (CrewHaus version manager). Do not edit.
# \`chvm use <version|system|local>\` changes what this runs.
set -uo pipefail

CHVM_DIR="\${CHVM_DIR:-$HOME/.chvm}"
target="system"
if [ -f "$CHVM_DIR/version" ]; then
  IFS= read -r target < "$CHVM_DIR/version" || true
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
      head -2 "$candidate" 2>/dev/null | grep -q "managed by chvm" && continue
      exec "$candidate" "$@"
    done
    echo "chvm: no system crewhaus on PATH (beyond the chvm shim)." >&2
    echo "chvm: install one (e.g. brew install crewhaus) or pick a version: chvm use latest" >&2
    exit 127
    ;;
  local:*)
    repo="\${target#local:}"
    entry="$repo/apps/cli/src/index.ts"
    if [ ! -f "$entry" ]; then
      echo "chvm: local checkout is missing $entry" >&2
      echo "chvm: point chvm at a factory checkout again: chvm use local <path>" >&2
      exit 127
    fi
    need_bun "from a local checkout"
    exec bun "$entry" "$@"
    ;;
  *)
    bin="$CHVM_DIR/versions/$target/node_modules/.bin/crewhaus"
    if [ ! -f "$bin" ]; then
      echo "chvm: crewhaus $target is not installed — run: chvm install $target" >&2
      exit 127
    fi
    need_bun "$target"
    exec bun "$bin" "$@"
    ;;
esac
`;

/** A launcher so `chvm` itself is on PATH via the same shims dir. */
export function chvmLauncherContent(entryPath: string): string {
  return `#!/usr/bin/env bash
# chvm launcher — managed by chvm setup. Do not edit.
exec bun "${entryPath}" "$@"
`;
}

/** Write (or refresh) the shims. Idempotent; safe to call from any command. */
export function writeShims(chvmEntryPath?: string): void {
  mkdirSync(shimsDir(), { recursive: true });
  writeFileSync(shimPath(), SHIM_CONTENT);
  chmodSync(shimPath(), 0o755);
  if (chvmEntryPath) {
    const launcher = join(shimsDir(), "chvm");
    writeFileSync(launcher, chvmLauncherContent(chvmEntryPath));
    chmodSync(launcher, 0o755);
  }
}
