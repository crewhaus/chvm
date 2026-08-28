import { describe, expect, test } from "bun:test";
import { HELP } from "./index";

describe("HELP", () => {
  test("lists every command the dispatcher accepts", () => {
    for (const cmd of [
      "chvm use <version>",
      "chvm install <version>",
      "chvm uninstall <version>",
      "chvm ls",
      "chvm ls-remote",
      "chvm current",
      "chvm which",
      "chvm setup",
    ]) {
      expect(HELP).toContain(cmd);
    }
  });

  test("does not present setup as a required bootstrap", () => {
    // `chvm use` puts the shims dir on PATH itself, so "(run once)" overstated it — after an
    // `npm i -g` install, `chvm use latest` is the only command a new user needs
    expect(HELP).not.toContain("(run once)");
    expect(HELP).toContain("`chvm use` does this too");
  });
});
