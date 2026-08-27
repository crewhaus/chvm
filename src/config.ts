import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { chvmDir, configFile } from "./paths";

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
  renameSync(tmp, file);
}
