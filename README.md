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

Requires [Bun](https://bun.sh), on macOS, Linux, or Windows.

```console
$ git clone https://github.com/crewhaus/chvm
$ cd chvm
$ bun install
$ bun src/index.ts setup
```

Those commands run as written in bash, zsh, and PowerShell.

`setup` writes the `crewhaus` shim and puts it on your PATH: one line in your
shell profile on macOS and Linux, and your user PATH on Windows. Open a new
terminal and you're done.

chvm is not published on npm, and the `chvm` name there belongs to an unrelated
package — clone it, don't `npm i -g`.

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
$ bun test src        # unit tests
$ bun test test       # end-to-end (installs one real version from npm)
$ bun run lint
```

CI runs both suites on Linux, macOS, and Windows.

## License

Apache-2.0
