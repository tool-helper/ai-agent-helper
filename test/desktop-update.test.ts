import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { update, updateTarget } from "../src/codex/update.js";

test("desktop update works with proxy options disabled and preserves explicitly requested proxies", { skip: process.platform !== "win32", timeout: 15_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), "helper-winget-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const log = join(root, "winget-args.json");
  const fixture = join(root, "winget-fixture.mjs");
  await writeFile(fixture, [
    "import { writeFileSync } from 'node:fs';",
    "const args = process.argv.slice(1);",
    "writeFileSync(process.env.HELPER_WINGET_TEST_LOG, JSON.stringify(args));",
    "const proxyOption = args.some(arg => arg === '--proxy' || arg === '--no-proxy');",
    "process.exit(proxyOption && process.env.HELPER_WINGET_PROXY_OPTIONS !== 'enabled' ? 13 : Number(process.env.HELPER_WINGET_EXIT_CODE ?? 0));",
  ].join("\n"));
  // Exercise the actual spawned command without upgrading a real application.
  const target = await updateTarget("chatgpt-desktop", async () => ({ path: null }), async () => ({ stdout: JSON.stringify({ Winget: process.execPath, Version: "26.1111.2228.0", Architecture: "X64" }) }));
  const env = {
    ...process.env,
    NODE_OPTIONS: `--import ${pathToFileURL(fixture).href}`,
    HELPER_WINGET_TEST_LOG: log,
    HELPER_WINGET_PROXY_OPTIONS: "disabled",
  };
  assert.equal(await target.run(env), 0, "Default updates must work without the admin-only proxy options");
  const args: string[] = JSON.parse(await readFile(log, "utf8"));
  assert.deepEqual(args.slice(1), ["--id", "9PLM9XGG6VKS", "--exact", "--source", "msstore"]);
  assert.equal(args[0]?.replaceAll("\\", "/").split("/").at(-1), "upgrade");

  const proxy = "http://127.0.0.1:7890";
  assert.equal(await target.run({ ...env, HELPER_WINGET_PROXY_OPTIONS: "enabled" }, proxy), 0);
  assert.deepEqual(JSON.parse(await readFile(log, "utf8")).slice(-2), ["--proxy", proxy]);
  assert.equal(await target.run(env, proxy), 13, "Do not silently discard an explicit proxy when WinGet rejects it");
  const noUpgrade = 0x8a15002b | 0;
  assert.equal((await target.run({ ...env, HELPER_WINGET_EXIT_CODE: String(noUpgrade) })) >>> 0, noUpgrade >>> 0,
    "An unavailable upgrade must not be normalized to success before checking the installed version");
  assert.ok(target.currentVersion);
  assert.equal(await target.currentVersion(), "26.1111.2228.0");
});

test("desktop updates verify the actual package version, including when WinGet has no applicable upgrade", async t => {
  const output: string[] = [];
  t.mock.method(console, "log", (line: string) => output.push(line));
  const current = "26.1111.2228.0";
  const latest = "26.1117.3838.0";
  for (const code of [0, 0x8a15002b, 0x8a15002b | 0]) {
    for (const actual of [current, latest, "26.1118.1.0"]) {
      let installs = 0;
      let verifications = 0;
      const runtime = { target: async () => ({
        version: current, versionFormat: "windows", probe: async () => 0,
        latest: async () => latest,
        run: async () => { installs++; return code; },
        currentVersion: async () => { verifications++; return actual; },
      }) };
      output.length = 0;
      const operation = update("chatgpt-desktop", { config: { version: 1, no_proxy: [] } }, runtime);
      if (actual === current) {
        await assert.rejects(operation, error => {
          assert.ok(error instanceof Error);
          assert.match(error.message, code === 0 ? /未确认应用更新完成/ : /公开目录已有新版本.*WinGet 未提供可用升级/);
          assert.ok(error.message.includes(current));
          assert.ok(error.message.includes(latest));
          return true;
        });
        assert.ok(!output.some(line => line.includes("版本验证通过")));
      } else {
        await operation;
        assert.ok(output.some(line => line.includes("版本验证通过")));
      }
      assert.equal(installs, 1);
      assert.equal(verifications, 1);
      assert.ok(output.some(line => line.includes(`实际安装版本：${actual}`)));
    }
  }
});

test("unreadable post-update versions never report desktop update success", async t => {
  t.mock.method(console, "log", () => {});
  const runtime = { target: async () => ({
    version: "26.1111.2228.0", versionFormat: "windows", probe: async () => 0,
    latest: async () => "26.1117.3838.0", run: async () => 0,
    currentVersion: async () => { throw new Error("cannot read package version"); },
  }) };
  await assert.rejects(update("chatgpt-desktop", { config: { version: 1, no_proxy: [] } }, runtime), /cannot read package version/);
});
