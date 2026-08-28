#!/usr/bin/env node
import pkg from "../package.json";
import * as commands from "./commands";

const HELP = `chvm — CrewHaus version manager

Switch which \`crewhaus\` your shell runs, the way nvm switches Node.

Usage:
  chvm use <version>        switch to a published version (installs it on first use)
  chvm use latest           switch to the newest release on npm
  chvm use system           switch back to your system install (brew, npm -g, …)
  chvm use local [path]     run a local factory checkout from source (path is remembered)
  chvm install <version>    install a version without switching to it
  chvm uninstall <version>  remove an installed version
  chvm ls                   list installed versions (* marks the active one)
  chvm ls-remote            list versions published on npm
  chvm current              show what \`crewhaus\` runs right now
  chvm which                show the path \`crewhaus\` resolves to
  chvm setup                put the chvm shims dir on your PATH (run once)

A version can be partial: \`chvm use 0.5\` picks the newest 0.5.x.
After any \`chvm use\`, \`crewhaus --version\` reflects it immediately in every shell.`;

async function main(): Promise<number> {
  const [command, ...args] = process.argv.slice(2);
  try {
    switch (command) {
      case "use":
        await commands.use(args);
        return 0;
      case "install":
        await commands.install(args);
        return 0;
      case "uninstall":
        await commands.uninstall(args);
        return 0;
      case "ls":
      case "list":
        await commands.list();
        return 0;
      case "ls-remote":
      case "list-remote":
        await commands.listRemote();
        return 0;
      case "current":
        await commands.current();
        return 0;
      case "which":
        await commands.which();
        return 0;
      case "setup":
        await commands.setup(args);
        return 0;
      case "--version":
      case "-v":
        console.log(pkg.version);
        return 0;
      case undefined:
      case "help":
      case "--help":
      case "-h":
        console.log(HELP);
        return command === undefined ? 1 : 0;
      default:
        console.error(`chvm: unknown command "${command}" — see \`chvm help\`.`);
        return 1;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`chvm: ${message}`);
    return 1;
  }
}

process.exit(await main());
