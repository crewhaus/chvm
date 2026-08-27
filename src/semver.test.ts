import { describe, expect, test } from "bun:test";
import { compareVersions, isVersionLike, resolveVersion, sortVersions } from "./semver";

describe("compareVersions", () => {
  test("orders numerically, not lexically", () => {
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
    expect(compareVersions("0.5.7", "0.5.7")).toBe(0);
    expect(compareVersions("0.4.2", "0.5.0")).toBeLessThan(0);
  });

  test("treats missing parts as zero", () => {
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
    expect(compareVersions("1", "1.0.1")).toBeLessThan(0);
  });
});

describe("sortVersions", () => {
  test("sorts ascending without mutating the input", () => {
    const input = ["0.5.7", "0.1.8", "0.10.0", "0.5.2"];
    expect(sortVersions(input)).toEqual(["0.1.8", "0.5.2", "0.5.7", "0.10.0"]);
    expect(input[0]).toBe("0.5.7");
  });
});

describe("isVersionLike", () => {
  test("accepts full, partial, and v-prefixed versions", () => {
    for (const spec of ["0.5.4", "0.5", "0", "v0.5.4"]) {
      expect(isVersionLike(spec)).toBe(true);
    }
  });

  test("rejects words and malformed specs", () => {
    for (const spec of ["latest", "system", "local", "0.5.4.1", "0.5.x", "", "0.5-beta"]) {
      expect(isVersionLike(spec)).toBe(false);
    }
  });
});

describe("resolveVersion", () => {
  const available = ["0.1.8", "0.4.0", "0.4.2", "0.5.0", "0.5.2", "0.5.7", "0.10.1"];

  test("exact match wins", () => {
    expect(resolveVersion("0.5.2", available)).toBe("0.5.2");
    expect(resolveVersion("v0.5.2", available)).toBe("0.5.2");
  });

  test("prefix resolves to the highest matching version", () => {
    expect(resolveVersion("0.5", available)).toBe("0.5.7");
    expect(resolveVersion("0.4", available)).toBe("0.4.2");
    expect(resolveVersion("0", available)).toBe("0.10.1");
  });

  test("no match returns null", () => {
    expect(resolveVersion("0.6", available)).toBeNull();
    expect(resolveVersion("1.0.0", available)).toBeNull();
    expect(resolveVersion("0.5.1", available)).toBeNull();
  });
});
