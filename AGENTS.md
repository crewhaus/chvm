# AGENTS.md — chvm

`chvm`, the CrewHaus version manager. A zero-dependency Bun/TypeScript CLI plus generated shims.
Repo: https://github.com/crewhaus/chvm. Supported on macOS, Linux, and Windows.

## Layout

- `src/index.ts` — entry + dispatch; each command lives in `src/commands.ts`
- `src/layout.ts` — the two facts every shim flavour and every caller must agree on: the
  `managed by chvm` marker and the path to a pinned install's entry. Change them here or not at all.
- `src/shim.ts` — the generated shims. `SHIM_CONTENT` is the bash one (written on every platform;
  Git Bash and MSYS2 use it on Windows). `CMD_SHIM_CONTENT` is the batch one, written on Windows
  only and the only form cmd.exe and PowerShell can resolve from a bare `crewhaus`. Both re-read
  the version file on every run, which is what makes `chvm use` take effect in already-open shells.
- `src/setup.ts` — PATH persistence: a shell rc file where there is one, and the Windows user
  environment (`HKCU\Environment`, never `setx`) where there is not.
- `src/*.test.ts` — unit tests (`bun test src`, no network)
- `test/e2e.test.ts` — end-to-end against a sandboxed `CHVM_DIR`
  (`bun test test`, needs network once to install a real version from npm)

## Rules

1. No runtime dependencies. Bun built-ins and `node:` modules only.
2. Everything must respect `CHVM_DIR` (tests rely on it; every shim reads it too).
3. State writes (`version`, `config.json`) are atomic: temp file + rename, with retries — a
   rename over an open file can fail transiently on Windows.
4. Reference sibling repos by GitHub URL, never by local filesystem layout —
   the compiler is https://github.com/crewhaus/factory.
5. `bunx --bun @biomejs/biome check .` must pass; formatting matches factory (2-space, width 100).
   Note plain `bunx biome` resolves to an unrelated squatted package — always use `@biomejs/biome`.
6. Anything platform-specific takes an injectable `platform` argument so it can be tested from
   any machine. CI runs both suites on Linux, macOS, and Windows; keep it that way.
7. Batch is not bash. The `.cmd` shim has no `exec` (forward `%ERRORLEVEL%` by hand), needs `call`
   before another batch file, uses `%*` for arguments, and is written with CRLF. It deliberately
   avoids `EnableDelayedExpansion`, which would eat a literal `!` in a user's path.
