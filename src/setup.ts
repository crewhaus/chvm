import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

/** Matches our rc line and reasonable hand-written variants (with or without the CHVM_DIR fallback). */
const RC_MARKER = /\.chvm\}?\/shims/;

export const RC_LINE = `export PATH="\${CHVM_DIR:-$HOME/.chvm}/shims:$PATH"`;

export const RC_BLOCK = `
# chvm — CrewHaus version manager
${RC_LINE}
`;

/** Append the PATH block unless some form of it is already there. Null = already set up. */
export function withChvmPath(rcContent: string): string | null {
  if (RC_MARKER.test(rcContent)) return null;
  const separator = rcContent === "" || rcContent.endsWith("\n") ? "" : "\n";
  return `${rcContent}${separator}${RC_BLOCK}`;
}

/**
 * The rc file for the user's shell, or null for shells we don't auto-edit.
 * macOS terminals start bash as a login shell, which reads .bash_profile, never .bashrc.
 */
export function rcFileForShell(
  shell = process.env.SHELL ?? "",
  platform: NodeJS.Platform = process.platform,
): string | null {
  switch (basename(shell)) {
    case "zsh":
      return join(homedir(), ".zshrc");
    case "bash":
      return join(homedir(), platform === "darwin" ? ".bash_profile" : ".bashrc");
    default:
      return null;
  }
}

export interface RcResult {
  rcFile: string | null;
  changed: boolean;
}

/** Ensure the shims dir is on PATH via the shell rc. Returns what happened. */
export function ensureRcPath(): RcResult {
  const rcFile = rcFileForShell();
  if (!rcFile) return { rcFile: null, changed: false };
  const current = existsSync(rcFile) ? readFileSync(rcFile, "utf8") : "";
  const updated = withChvmPath(current);
  if (updated === null) return { rcFile, changed: false };
  writeFileSync(rcFile, updated);
  return { rcFile, changed: true };
}
