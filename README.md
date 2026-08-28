# chvm — CrewHaus version manager

Switch which `crewhaus` your shell runs, the way nvm switches Node.

```console
$ chvm use 0.5.4
Now using crewhaus 0.5.4 (crewhaus --version → 0.5.4)
$ crewhaus --version
0.5.4
$ chvm use latest
Now using crewhaus 0.5.8 (crewhaus --version → 0.5.8)
```

Switches apply immediately — in every open shell, no re-sourcing.

## Install

```console
$ npm install -g @crewhaus/chvm
```

That is the whole install, on macOS, Linux, and Windows. `bun add -g
@crewhaus/chvm` works too, as does `pnpm add -g` or `yarn global add`.

Then pick a version:

```console
$ chvm use latest
```

The first `chvm use` also puts the `crewhaus` shim on your PATH — one line in
your shell profile on macOS and Linux, your user PATH on Windows — and tells you
what it changed. Open a new terminal and you're done. (`chvm setup` does the same
thing on its own if you would rather run it explicitly.)

chvm itself runs on Node, so it installs anywhere npm does. [Bun](https://bun.sh)
is what actually runs `crewhaus`, so you need it before `chvm use` can fetch a
release — chvm says so if it is missing.

> The bare `chvm` name on npm is an unrelated package. The scoped
> `@crewhaus/chvm` above is this one.

## Commands

| Command | What it does |
|---|---|
| `chvm use <version>` | Switch to a published version — installs it on first use |
| `chvm use latest` | Switch to the newest release on npm |
| `chvm use system` | Switch back to your system install (brew, scoop, npm -g, …) |
| `chvm use local [path]` | Run a [factory](https://github.com/crewhaus/factory) checkout from source; the path is remembered |
| `chvm install <version>` | Install a version without switching |
| `chvm uninstall <version>` | Remove an installed version |
| `chvm ls` | List installed versions (`*` marks the active one) |
| `chvm ls-remote` | List versions published on npm |
| `chvm current` | Show what `crewhaus` runs right now |
| `chvm which` | Show the path `crewhaus` resolves to |

Versions can be partial: `chvm use 0.5` picks the newest 0.5.x.

## How it works

`chvm` keeps everything in `~/.chvm` (`%USERPROFILE%\.chvm` on Windows):

- `versions/<v>/` — pinned installs of `crewhaus@<v>` from npm
- `shims/` — a tiny shim, first on your PATH, that reads `~/.chvm/version` and
  runs the chosen target: a pinned install, the next `crewhaus` on your PATH
  (`system`), or a local factory checkout (`local`)
- `version` — one line naming the active target; `chvm use` just rewrites it

To remove chvm entirely: delete `~/.chvm`, and the PATH line `setup` added.

### On Windows

`setup` writes two shims. `crewhaus.cmd` is the one that matters: `.CMD` is in
the default `PATHEXT`, so both cmd.exe and PowerShell find it from a bare
`crewhaus`. The extensionless bash shim is written alongside it for Git Bash,
MSYS2, and Cygwin. There is deliberately no `.ps1` — `.PS1` is not in the
default `PATHEXT`, so cmd.exe could never see it.

PATH goes into your user environment (`HKCU\Environment`) rather than through
`setx`, which silently truncates at 1024 characters. Only the *user* PATH is
read or written; the machine PATH is never touched.

One consequence worth knowing: Windows searches the machine PATH before the user
PATH, so a `crewhaus` installed machine-wide (Chocolatey, or a machine-scope MSI)
is found before the shim, and `chvm use` will appear to do nothing. Either
uninstall that copy or move the shims entry into the machine PATH yourself —
`chvm which` tells you which one is winning.

One rough edge, shared with npm's and yarn's batch shims: pressing Ctrl-C while
a command is running prompts `Terminate batch job (Y/N)?`. Getting rid of that
needs a compiled launcher rather than a batch file.

## Developing

```console
$ git clone https://github.com/crewhaus/chvm
$ cd chvm && bun install
$ bun src/index.ts use latest   # run it from source
```

```console
$ bun test src        # unit tests
$ bun test test       # end-to-end (installs one real version from npm)
$ bun run build       # bundle src/index.ts -> dist/index.js for npm
$ bun run lint
```

The source is TypeScript run by Bun; `bun run build` bundles it to the Node-targeted
`dist/index.js` that ships to npm. Nothing in `src/` may use a `Bun.*` global — the
host-runtime calls live behind `src/runtime.ts` so the published CLI runs under Node.

CI runs the suites on Linux, macOS, and Windows, and separately installs the packed
tarball and runs it under Node 18 and 22 on all three.

## License

Apache-2.0
