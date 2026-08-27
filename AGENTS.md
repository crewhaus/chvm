# AGENTS.md — version-manager

`chvm`, the CrewHaus version manager. A zero-dependency Bun/TypeScript CLI plus one bash shim.

## Layout

- `src/index.ts` — entry + dispatch; each command lives in `src/commands.ts`
- `src/shim.ts` — the bash shim written to `~/.chvm/shims/crewhaus`. It re-reads
  `~/.chvm/version` on every run, which is what makes `chvm use` take effect in
  already-open shells. Keep it POSIX-y bash, dependency-free, and fast.
- `src/*.test.ts` — unit tests (`bun test src`, no network)
- `test/e2e.test.ts` — end-to-end against a sandboxed `CHVM_DIR`
  (`bun test test`, needs network once to install a real version from npm)

## Rules

1. No runtime dependencies. Bun built-ins and `node:` modules only.
2. Everything must respect `CHVM_DIR` (tests rely on it; the shim reads it too).
3. State writes (`version`, `config.json`) are atomic: temp file + rename.
4. Reference sibling repos by GitHub URL, never by local filesystem layout —
   the compiler is https://github.com/crewhaus/factory.
5. `bunx biome check .` must pass; formatting matches factory (2-space, width 100).
