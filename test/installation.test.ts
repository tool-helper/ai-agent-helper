import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { managePackage, resolveUpdateTarget, type InstallRuntime, type ManageOptions } from "../src/installation/manage.js";
import { installationEnvironment, redact } from "../src/proxy/environment.js";

test("default update target is self, explicit targets override the default and cannot conflict", () => {
  assert.deepEqual(resolveUpdateTarget({}), { kind: "self" });
  assert.deepEqual(resolveUpdateTarget({ self: true }), { kind: "self" });
  assert.deepEqual(resolveUpdateTarget({ agent: "codex" }), { kind: "agent", id: "codex" });
  assert.deepEqual(resolveUpdateTarget({ allAgents: true }), { kind: "all-agents" });
  assert.throws(() => resolveUpdateTarget({ self: true, agent: "codex" }));
  assert.throws(() => resolveUpdateTarget({ allAgents: true, agent: "codex" }));
  assert.throws(() => resolveUpdateTarget({ agent: "claude-code" }));
});

test("proxy precedence replaces conflicting variables only in the child environment", () => {
  const base = { HTTP_PROXY: "http://old", ALL_PROXY: "socks5://old", NPM_CONFIG_HTTPS_PROXY: "http://old", NO_PROXY: "inherited", PATH: "keep" };
  const config = { version: 1 as const, no_proxy: ["localhost"], proxy: "http://saved:7890" };
  const env = installationEnvironment(config, "http://override:7890", base);
  assert.equal(env.npm_config_https_proxy, "http://override:7890");
  assert.equal(env.http_proxy, "http://override:7890");
  assert.equal(env.NO_PROXY, "localhost");
  assert.equal(env.ALL_PROXY, undefined);
  assert.equal(env.NPM_CONFIG_HTTPS_PROXY, undefined);
  assert.equal(env.PATH, "keep");
  assert.equal(base.ALL_PROXY, "socks5://old");
  assert.equal(installationEnvironment(config, undefined, base).HTTP_PROXY, "http://saved:7890");
  assert.deepEqual(installationEnvironment({ version: 1, no_proxy: [] }, undefined, base), base);
  assert.equal(installationEnvironment({ ...config, no_proxy: [] }, undefined, base).NO_PROXY, "inherited");
  assert.equal(redact("npm: http://user:SECRET@localhost:7890/file"), "npm: http://REDACTED:REDACTED@localhost:7890/file");
});

async function fixture(t: TestContext, target = "codex", current?: string) {
  const root = await mkdtemp(join(tmpdir(), "agent-helper-installer-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const packageName = target === "self" ? "ai-agent-helper" : "@openai/codex";
  const directory = join(root, "node_modules", ...packageName.split("/"));
  const calls: string[][] = [];
  async function install(version: string) {
    await mkdir(join(directory, target === "self" ? "dist" : "bin"), { recursive: true });
    await writeFile(join(directory, "package.json"), JSON.stringify({ name: packageName, version }));
    await writeFile(join(directory, target === "self" ? "dist/cli.js" : "bin/codex.js"), "");
  }
  if (current) await install(current);
  const runtime: InstallRuntime = {
    selfRoot: directory,
    context: { cwd: root, env: { PATH: "" }, platform: process.platform },
    async runNpm(args) {
      calls.push(args);
      if (args[0] === "root") return join(root, "node_modules");
      if (args[0] === "prefix") return root;
      if (args[0] === "view") return '"2.0.0"';
      if (args[0] === "install") { await install("2.0.0"); return ""; }
      throw new Error("unexpected npm call");
    },
  };
  const options: ManageOptions = { target, action: "update", config: { version: 1, no_proxy: [] } };
  return { root, directory, calls, runtime, options };
}

test("install queries latest once, installs that exact version and preserves the global prefix", async (t) => {
  const { calls, root, runtime, options } = await fixture(t);
  const result = await managePackage({ ...options, action: "install" }, runtime);
  assert.equal(result.status, "installed");
  assert.equal(result.to, "2.0.0");
  assert.ok(calls.some((args) => args.includes("@openai/codex@2.0.0")));
  assert.ok(result.args.includes(root));
});

test("a dry run does not query the registry or install, and redacts its proxy", async (t) => {
  const { calls, runtime, options } = await fixture(t);
  const result = await managePackage({ ...options, action: "install", dryRun: true, proxy: "http://user:SECRET@localhost:7890" }, runtime);
  assert.equal(result.status, "planned");
  assert.ok(!JSON.stringify(result).includes("SECRET"));
  assert.ok(calls.every((args) => ["root", "prefix"].includes(args[0]!)));
});

test("missing agents fail updates and existing packages skip installation", async (t) => {
  const missing = await fixture(t);
  await assert.rejects(managePackage(missing.options, missing.runtime), /尚未安装/);
  const existing = await fixture(t, "codex", "1.0.0");
  assert.equal((await managePackage({ ...existing.options, action: "install" }, existing.runtime)).status, "skipped");
  assert.ok(!existing.calls.some((args) => args[0] === "view"));
});

test("up-to-date packages never install or downgrade", async (t) => {
  const { calls, runtime, options } = await fixture(t, "codex", "3.0.0");
  assert.equal((await managePackage(options, runtime)).status, "skipped");
  assert.ok(!calls.some((args) => args[0] === "install"));
});

test("self updates require this running package to be installed in the selected global prefix", async (t) => {
  const normal = await fixture(t, "self", "1.0.0");
  assert.equal((await managePackage(normal.options, normal.runtime)).status, "updated");
  const source = await fixture(t, "self", "1.0.0");
  source.runtime.selfRoot = source.root;
  await assert.rejects(managePackage(source.options, source.runtime), /原安装方式/);
  assert.ok(!source.calls.some((args) => args[0] === "install"));
});

test("npm failures propagate and no success is reported when verification fails", async (t) => {
  const failing = await fixture(t, "codex", "1.0.0");
  const original = failing.runtime.runNpm;
  failing.runtime.runNpm = async (args) => {
    if (args[0] === "install") throw new Error("test npm failure");
    return original(args);
  };
  await assert.rejects(managePackage(failing.options, failing.runtime), /test npm failure/);
  const unverified = await fixture(t, "codex", "1.0.0");
  const run = unverified.runtime.runNpm;
  unverified.runtime.runNpm = async (args) => args[0] === "install" ? "" : run(args);
  await assert.rejects(managePackage(unverified.options, unverified.runtime), /验证失败/);
});

test("a Codex command from another install location is never overwritten", async (t) => {
  const { root, calls, runtime, options } = await fixture(t, "codex", "1.0.0");
  const other = join(root, "other");
  await mkdir(other);
  const command = join(other, process.platform === "win32" ? "codex.cmd" : "codex");
  await writeFile(command, "test fixture");
  if (process.platform !== "win32") await chmod(command, 0o755);
  runtime.context.env.PATH = other;
  await assert.rejects(managePackage(options, runtime), /原安装方式/);
  assert.ok(!calls.some((args) => args[0] === "view" || args[0] === "install"));
});

test("npm link installations cannot be updated in place", async (t) => {
  const { root, directory, calls, runtime, options } = await fixture(t, "self", "1.0.0");
  const source = join(root, "source");
  await rename(directory, source);
  await symlink(source, directory, process.platform === "win32" ? "junction" : "dir");
  runtime.selfRoot = source;
  await assert.rejects(managePackage(options, runtime), /原安装方式/);
  assert.ok(!calls.some((args) => args[0] === "install"));
});

test("a foreign executable in the same npm command directory is not treated as the npm agent", async (t) => {
  const { root, calls, runtime, options } = await fixture(t, "codex", "1.0.0");
  const bin = process.platform === "win32" ? root : join(root, "bin");
  await mkdir(bin, { recursive: true });
  if (process.platform === "win32") {
    await writeFile(join(bin, "codex.exe"), "standalone fixture");
  } else {
    const other = join(root, "standalone-codex");
    await writeFile(other, "standalone fixture");
    await chmod(other, 0o755);
    await symlink(other, join(bin, "codex"));
  }
  runtime.context.env.PATH = bin;
  await assert.rejects(managePackage(options, runtime), /原安装方式/);
  assert.ok(!calls.some((args) => args[0] === "install"));
});
