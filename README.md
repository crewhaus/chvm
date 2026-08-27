# chvm — CrewHaus version manager

Switch which `crewhaus` your shell runs, the way nvm switches Node.

```console
$ chvm use 0.5.4
Now using crewhaus 0.5.4 (crewhaus --version → 0.5.4)
$ crewhaus --version
0.5.4
$ chvm use latest
Now using crewhaus 0.5.7 (crewhaus --version → 0.5.7)
```

Switches apply immediately — in every open shell, no re-sourcing.

## Install

Requires [Bun](https://bun.sh) (macOS or Linux).

```console
$ git clone https://github.com/crewhaus/version-manager
$ cd version-manager
$ bun install
$ bun src/index.ts setup
```

`setup` puts `chvm` and the `crewhaus` shim on your PATH (one line in your
shell profile). Restart your shell and you're done.

## Commands

| Command | What it does |
|---|---|
| `chvm use <version>` | Switch to a published version — installs it on first use |
| `chvm use latest` | Switch to the newest release on npm |
| `chvm use system` | Switch back to your system install (brew, npm -g, …) |
| `chvm use local [path]` | Run a [factory](https://github.com/crewhaus/factory) checkout from source; the path is remembered |
| `chvm install <version>` | Install a version without switching |
| `chvm uninstall <version>` | Remove an installed version |
| `chvm ls` | List installed versions (`*` marks the active one) |
| `chvm ls-remote` | List versions published on npm |
| `chvm current` | Show what `crewhaus` runs right now |
| `chvm which` | Show the path `crewhaus` resolves to |

Versions can be partial: `chvm use 0.5` picks the newest 0.5.x.

## How it works

`chvm` keeps everything in `~/.chvm`:

- `versions/<v>/` — pinned installs of `crewhaus@<v>` from npm
- `shims/crewhaus` — a tiny shim, first on your PATH, that reads
  `~/.chvm/version` and runs the chosen target: a pinned install, the next
  `crewhaus` on your PATH (`system`), or `apps/cli/src/index.ts` in a local
  factory checkout (`local`)
- `version` — one line naming the active target; `chvm use` just rewrites it

To remove chvm entirely: delete `~/.chvm` and the PATH line `setup` added.

## Developing

```console
$ bun test src        # unit tests
$ bun test test       # end-to-end (installs one real version from npm)
$ bun run lint
```

## License

Apache-2.0
