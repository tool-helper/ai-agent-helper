import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { managePackage, npmRegistry } from "../src/installation/manage.js";
import { npmRunner } from "../src/installation/process.js";
import { installationEnvironment } from "../src/proxy/environment.js";

test("real npm installs and updates an isolated fixture through a local proxy", { timeout: 60_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "agent-helper-proxy-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const prefix = join(root, "global");
  await writeFile(join(root, "user.npmrc"), "");
  await writeFile(join(root, "global.npmrc"), "");
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toLowerCase().startsWith("npm_config_")));
  const baseEnv = { ...inherited, npm_config_userconfig: join(root, "user.npmrc"), npm_config_globalconfig: join(root, "global.npmrc"), npm_config_cache: join(root, "cache"), npm_config_update_notifier: "false", npm_config_audit: "false", npm_config_fund: "false" };
  // Separate caches prove tarballs were downloaded through the proxy rather than reused from pack.
  const pack = npmRunner({ ...baseEnv, npm_config_cache: join(root, "pack-cache") });
  const artifacts = new Map<string, Buffer>();
  for (const version of ["2.0.0", "3.0.0"]) {
    const directory = join(root, version);
    await mkdir(join(directory, "bin"), { recursive: true });
    await writeFile(join(directory, "package.json"), JSON.stringify({ name: "@openai/codex", version, bin: { codex: "bin/codex.js" } }));
    await writeFile(join(directory, "bin", "codex.js"), '#!/usr/bin/env node\nconsole.log("isolated test fixture");\n');
    const response = JSON.parse(await pack(["pack", directory, "--pack-destination", root, "--ignore-scripts", "--json"]));
    artifacts.set(version, await readFile(join(root, response[0].filename)));
  }
  let latest = "2.0.0";
  const requests: string[] = [];
  const auth: string[] = [];
  const proxy = createServer((request, response) => {
    requests.push(request.url ?? "");
    auth.push(request.headers["proxy-authorization"] ?? "");
    const url = new URL(request.url!);
    if (url.hostname === "registry.agent-helper.invalid") {
      const versions = Object.fromEntries([...artifacts].map(([version, bytes]) => [version, {
        name: "@openai/codex", version, bin: { codex: "bin/codex.js" },
        dist: { tarball: `http://tarballs.agent-helper.invalid/codex-${version}.tgz`, integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}` },
      }]));
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ name: "@openai/codex", "dist-tags": { latest }, versions }));
    } else if (url.hostname === "tarballs.agent-helper.invalid") {
      const version = url.pathname.match(/codex-(.*)\.tgz/)?.[1];
      const bytes = artifacts.get(version ?? "");
      response.writeHead(bytes ? 200 : 404, { "content-type": "application/octet-stream" });
      response.end(bytes);
    } else { response.writeHead(404); response.end(); }
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  t.after(() => { proxy.closeAllConnections(); return new Promise<void>((resolve) => proxy.close(() => resolve())); });
  const address = proxy.address();
  assert.ok(address && typeof address !== "string");
  const config = { version: 1 as const, proxy: `http://test-user:test-secret@127.0.0.1:${address.port}`, no_proxy: ["localhost"] };
  const run = npmRunner(installationEnvironment(config, undefined, baseEnv));
  const runtime = {
    context: { env: { PATH: "" }, cwd: root, platform: process.platform }, selfRoot: root,
    runNpm(args: string[], stream?: boolean) {
      const localArgs = args.map((arg) => arg === `--registry=${npmRegistry}` ? "--registry=http://registry.agent-helper.invalid/" : arg);
      if (args[0] === "root" || args[0] === "prefix") localArgs.push("--prefix", prefix);
      // The fixture has no scripts; this also ensures an integration test never executes package scripts.
      if (args[0] === "install") localArgs.push("--ignore-scripts");
      return run(localArgs, stream);
    },
  };
  const installed = await managePackage({ target: "codex", action: "install", config }, runtime);
  assert.equal(installed.status, "installed");
  assert.equal(installed.to, "2.0.0");
  latest = "3.0.0";
  const updated = await managePackage({ target: "codex", action: "update", config }, runtime);
  assert.equal(updated.status, "updated");
  assert.equal(updated.from, "2.0.0");
  assert.equal(updated.to, "3.0.0");
  assert.ok(requests.some((url) => url.includes("registry.agent-helper.invalid")));
  assert.ok(requests.some((url) => url.includes("codex-2.0.0.tgz")));
  assert.ok(requests.some((url) => url.includes("codex-3.0.0.tgz")));
  assert.ok(auth.every((header) => header === `Basic ${Buffer.from("test-user:test-secret").toString("base64")}`));
});
