import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("target commands inspect the selected config, require a proxy and migrate it only after a successful check", async t => {
  const root = await mkdtemp(join(tmpdir(), "helper-targets-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !["path", "home", "userprofile", "appdata", "xdg_config_home", "codex_home"].includes(key.toLowerCase())));
  Object.assign(env, { HOME: root, USERPROFILE: root, APPDATA: root, XDG_CONFIG_HOME: root, CODEX_HOME: root, PATH: root });
  function cli(args: string[], input = "") {
    return spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], { env, input, encoding: "utf8", timeout: 20000 });
  }
  const log = join(root, "invocations.jsonl");
  const fixture = join(root, "fixture.cjs");
  await writeFile(fixture, [
    "const fs = require('node:fs');",
    "if (process.argv[2] === '--version') console.log('codex-cli 1.2.3');",
    "else if (process.argv[2] === 'update') fs.appendFileSync(" + JSON.stringify(log) + ", JSON.stringify(process.env.HTTPS_PROXY) + '\\n');",
    "else process.exit(2);",
  ].join("\n"));
  const windows = process.platform === "win32";
  const shim = windows ? '@"' + process.execPath + '" "' + fixture + '" %*\r\n'
    : '#!/bin/sh\nexec "' + process.execPath + '" "' + fixture + '" "$@"\n';
  await writeFile(join(root, windows ? "codex.cmd" : "codex"), shim, { mode: 0o700 });
  await writeFile(join(root, "config.toml"), 'forced_login_method="api"\n[features]\nrespect_system_proxy=true\n');
  await writeFile(join(root, "sample.config.toml"), 'model_provider="sample"\nmodel="sample-model"\nmodel_catalog_json="models.json"\n[model_providers.sample]\nrequires_openai_auth=false\n');
  await writeFile(join(root, "models.json"), '{"models":[{"slug":"sample-model"}]}');
  const config = cli(["codex", "config"], "2\n");
  assert.equal(config.status, 0, config.stderr);
  assert.match(config.stdout, /sample-model.*配置模型/);
  assert.match(config.stdout, /仅 API 认证（继承自 config.toml）/);
  assert.match(config.stdout, /requires_openai_auth = false/);
  assert.equal(JSON.parse(cli(["codex", "--json"]).stdout).cli.version, "1.2.3");
  assert.equal(JSON.parse(cli(["dsh", "--json"]).stdout).installed, false);
  assert.match(cli(["dsh-desktop", "install"]).stdout, /deepseek.com/);
  const saved = join(root, ".ai-agent-helper", "config.toml");
  assert.match(cli(["codex", "update", "--dry-run"]).stdout, /codex update/);
  assert.notEqual(cli(["codex", "update"], "\n").status, 0);
  await assert.rejects(readFile(log), { code: "ENOENT" });
  const listener = createServer(socket => socket.destroy());
  await new Promise<void>(resolve => listener.listen(0, "127.0.0.1", resolve));
  t.after(() => listener.close());
  const address = listener.address();
  assert.ok(address && typeof address === "object");
  const proxy = "http://127.0.0.1:" + address.port;
  const override = cli(["codex", "update", "--proxy", proxy]);
  assert.equal(override.status, 0, override.stderr);
  await assert.rejects(readFile(saved), { code: "ENOENT" });
  await mkdir(join(root, "check-codex"));
  await writeFile(join(root, "check-codex", "update-proxy.json"), JSON.stringify({ proxy }));
  const legacy = cli(["update", "--agent", "codex"]);
  assert.equal(legacy.status, 0, legacy.stderr);
  assert.ok((await readFile(saved, "utf8")).includes(proxy));
  assert.deepEqual((await readFile(log, "utf8")).trim().split("\n").map(s => JSON.parse(s)), [proxy, proxy]);
});
