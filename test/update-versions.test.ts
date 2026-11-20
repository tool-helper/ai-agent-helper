import assert from "node:assert/strict";
import { test } from "node:test";
import { codexReleaseVersion, desktopReleaseVersion } from "../src/updates/sources.js";
import { checkUpdateVersions } from "../src/updates/versions.js";

test("version checks skip equal or newer installations and reject unknown versions", t => {
  const output: string[] = [];
  t.mock.method(console, "log", (line: string) => output.push(line));
  assert.equal(checkUpdateVersions("DSH", "1.2.3", "1.2.3").needsUpdate, false);
  assert.match(output.join("\n"), /当前版本：1.2.3[\s\S]*服务端版本：1.2.3[\s\S]*版本一致/);
  assert.equal(checkUpdateVersions("Codex", "1.2.4", "1.2.3").needsUpdate, false);
  assert.equal(checkUpdateVersions("Codex", "1.2.3-rc.1", "1.2.3").needsUpdate, true);
  assert.equal(checkUpdateVersions("Desktop", "26.1118.9.0", "26.1118.10.0", "windows").needsUpdate, true);
  assert.equal(checkUpdateVersions("Desktop", "26.1118.10.0", "26.1118.10.0", "windows").needsUpdate, false);
  assert.equal(checkUpdateVersions("Desktop", "26.1118.10.0", "26.1111.2228.0", "windows").needsUpdate, false);
  assert.throws(() => checkUpdateVersions("Desktop", "26.1118.10.0", "Unknown", "windows"));
  assert.throws(() => checkUpdateVersions("Codex", "unknown", "1.2.3"));
});

test("Codex check reads the stable official release tag and rejects invalid release metadata", () => {
  assert.equal(codexReleaseVersion({ tag_name: "rust-v0.170.0", draft: false, prerelease: false }), "0.170.0");
  for (const value of [{ tag_name: "latest" }, { tag_name: "rust-v1.0.0", draft: true }, { tag_name: "rust-v1.0.0-beta.1", prerelease: true }, {}]) {
    assert.throws(() => codexReleaseVersion(value));
  }
});

test("Store comparison uses applicable app package versions rather than Unknown or another architecture", () => {
  const catalog = { Product: { DisplaySkuAvailabilities: [{ Sku: { Properties: { Packages: [
    { PackageFullName: "OpenAI.Codex_26.1111.2228.0_x64__2p2nqsd0c76g0" },
    { PackageFullName: "OpenAI.Codex_26.1118.10.0_x64__2p2nqsd0c76g0", PlatformDependencies: [{ PlatformName: "Windows.Desktop", MinVersion: "2814751014977536" }] },
    { PackageFullName: "OpenAI.Codex_26.1119.1.0_arm64__2p2nqsd0c76g0" },
    { PackageFullName: "OpenAI.Codex_26.1120.1.0_x64__differentpublisher" },
    { PackageFullName: "OpenAI.Codex_26.1121.1.0_x64__2p2nqsd0c76g0", PlatformDependencies: [{ PlatformName: "Windows.Desktop", MinVersion: String((10n << 48n) + (65000n << 16n)) }] },
  ] } } }] } };
  assert.equal(desktopReleaseVersion(catalog, "X64", "10.0.26100.0"), "26.1118.10.0");
  assert.equal(desktopReleaseVersion(catalog, "Arm64", "10.0.26100.0"), "26.1119.1.0");
  assert.throws(() => desktopReleaseVersion(catalog, "X86", "10.0.26100.0"));
  assert.throws(() => desktopReleaseVersion({ Data: { Versions: [{ PackageVersion: "Unknown" }] } }, "x64", "10.0.26100.0"));
});
