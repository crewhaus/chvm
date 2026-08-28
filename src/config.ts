import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { chvmDir, configFile } from "./paths";
import { sleepSync } from "./runtime";

/** rename() replaces atomically on POSIX; on Windows an AV/indexer can hold the target briefly. */
function replaceFile(tmp: string, dest: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tmp, dest);
      return;
    } catch (err) {
      if (attempt >= 5) {
        rmSync(tmp, { force: true });
        throw err;
      }
      sleepSync(20 * (attempt + 1));
    }
  }
}

export interface ChvmConfig {
  /** Remembered factory checkout for `chvm use local` with no path argument. */
  localPath?: string;
}

export function readConfig(): ChvmConfig {
  const file = configFile();
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return typeof parsed === "object" && parsed !== null ? (parsed as ChvmConfig) : {};
  } catch {
    return {};
  }
}

export function writeConfig(config: ChvmConfig): void {
  mkdirSync(chvmDir(), { recursive: true });
  const file = configFile();
  const tmp = join(dirname(file), `.config.tmp-${process.pid}`);
  writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`);
  replaceFile(tmp, file);
}
