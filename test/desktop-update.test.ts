import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { updateTarget } from "../src/codex/update.js";

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
    "process.exit(proxyOption && process.env.HELPER_WINGET_PROXY_OPTIONS !== 'enabled' ? 13 : 0);",
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
});
