import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("batch update continues after failure and applies default proxy only to eligible agents", { timeout: 30_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "agent-helper-batch-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const prefix = join(root, "prefix");
  const bin = process.platform === "win32" ? prefix : join(prefix, "bin");
  const npmRoot = join(prefix, "node_modules");
  const log = join(root, "calls.jsonl");
  const fakeNpm = join(root, "npm-fixture.cjs");
  await mkdir(bin, { recursive: true });
  await mkdir(join(root, ".ai-agent-helper"));
  await writeFile(join(root, ".ai-agent-helper", "config.toml"), 'version = 1\nproxy = "http://saved-proxy.invalid:7890"\n');
  for (const [name, packageName, entry] of [
    ["codex", "@openai/codex", "bin/codex.js"], ["dsh", "@deepseek-ai/dsh", "lib/bin.js"],
  ]) {
    const directory = join(npmRoot, ...packageName!.split("/"));
    await mkdir(dirname(join(directory, entry!)), { recursive: true });
    await writeFile(join(directory, "package.json"), JSON.stringify({ name: packageName, version: "1.0.0" }));
    await writeFile(join(directory, entry!), "");
    const shim = join(bin, name! + (process.platform === "win32" ? ".cmd" : ""));
    if (process.platform === "win32") await writeFile(shim, "@exit /b 0\r\n");
    else {
      await chmod(join(directory, entry!), 0o755);
      await symlink(join(directory, entry!), shim);
    }
  }
  await writeFile(fakeNpm, `
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, proxy: process.env.npm_config_proxy ?? null }) + '\\n');
if (args[0] === 'root') console.log(${JSON.stringify(npmRoot)});
else if (args[0] === 'prefix') console.log(${JSON.stringify(prefix)});
else if (args[0] === 'view') console.log(JSON.stringify({ version: '2.0.0', engines: { node: '>=22.13.0' } }));
else if (args[0] === 'install') {
  if (args.includes('@openai/codex@2.0.0')) { console.error('intentional Codex failure'); process.exit(17); }
  if (!args.includes('@deepseek-ai/dsh@2.0.0')) process.exit(18);
  fs.writeFileSync(path.join(${JSON.stringify(npmRoot)}, '@deepseek-ai/dsh/package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '2.0.0' }));
} else process.exit(19);
`);
  const npmShim = join(bin, process.platform === "win32" ? "npm.cmd" : "npm");
  await writeFile(npmShim, process.platform === "win32"
    ? `@echo off\r\n"${process.execPath}" "${fakeNpm}" %*\r\n`
    : `#!/usr/bin/env node\nrequire(${JSON.stringify(fakeNpm)});\n`);
  if (process.platform !== "win32") {
    await chmod(npmShim, 0o755);
  }
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !["path", "home", "userprofile", "http_proxy", "https_proxy", "all_proxy", "npm_config_proxy", "npm_config_https_proxy"].includes(key.toLowerCase())));
  Object.assign(env, { HOME: root, USERPROFILE: root, PATH: [bin, dirname(process.execPath)].join(delimiter) });
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const result = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "update", "--all-agents"], { cwd: projectRoot, env, encoding: "utf8", timeout: 20_000 });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /intentional Codex failure/);
  assert.match(result.stdout, /dsh: updated/);
  assert.match(result.stdout, /失败 1 个/);
  const calls = (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { args: string[]; proxy: string | null });
  assert.equal(calls.find((call) => call.args.includes("@openai/codex@2.0.0"))?.proxy, "http://saved-proxy.invalid:7890");
  assert.equal(calls.find((call) => call.args.includes("@deepseek-ai/dsh@2.0.0"))?.proxy, null);
});
