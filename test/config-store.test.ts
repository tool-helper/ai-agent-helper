import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { configPath, editConfig, formatConfig, parseAssignments, readConfig, writeConfig } from "../src/config/store.js";

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "agent-helper-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return configPath(root);
}

test("view and unset on a missing file do not create a configuration", async (t) => {
  const path = await fixture(t);
  assert.deepEqual(await readConfig(path), { version: 1, no_proxy: [] });
  await writeConfig(new Map([["proxy", undefined]]), path);
  await assert.rejects(stat(path), { code: "ENOENT" });
});

test("assignment parsing splits only the first equals sign and validates the whole batch", () => {
  const proxy = "http://user:p=word@localhost:7890";
  const result = parseAssignments([`proxy=${proxy}`, "no_proxy=localhost,127.0.0.1"]);
  assert.equal(result.get("proxy"), proxy);
  assert.deepEqual(result.get("no_proxy"), ["localhost", "127.0.0.1"]);
  for (const args of [[], ["proxy"], ["=value"], ["version=1"], ["proxy="], ["no_proxy="], ["no_proxy=localhost,"], ["proxy=http://localhost", "proxy=http://other"], ["proxy=http://localhost", "unknown=value"]]) {
    assert.throws(() => parseAssignments(args));
  }
});

test("updates and unsets preserve comments, CRLF, quoted keys and unrelated fields", async (t) => {
  const path = await fixture(t);
  await mkdir(join(path, ".."), { recursive: true });
  const source = "# header\r\nversion = 1\r\n# proxy note\r\n'proxy' = 'http://old:7890' # inline\r\nno_proxy = [\r\n # loopback note\r\n 'localhost',\r\n]\r\n";
  await writeFile(path, source);
  await writeConfig(parseAssignments(["proxy=http://new:8080"]), path);
  let text = await readFile(path, "utf8");
  assert.ok(text.includes("# header\r\n"));
  assert.ok(text.includes("# inline\r\n"));
  assert.ok(text.includes("'proxy' = \"http://new:8080\""));
  assert.ok(text.includes("no_proxy = [\r\n # loopback note\r\n 'localhost',\r\n]"));
  await writeConfig(parseAssignments(["no_proxy=127.0.0.1,::1"]), path);
  text = await readFile(path, "utf8");
  assert.ok(text.includes("# loopback note"));
  assert.deepEqual((await readConfig(path)).no_proxy, ["127.0.0.1", "::1"]);
  await writeConfig(new Map([["proxy", undefined]]), path);
  text = await readFile(path, "utf8");
  assert.ok(text.includes("# proxy note"));
  assert.ok(text.includes("# inline"));
  assert.equal((await readConfig(path)).proxy, undefined);
});

test("failed validation and malformed files are never overwritten or echoed", async (t) => {
  const path = await fixture(t);
  await mkdir(join(path, ".."), { recursive: true });
  for (const source of ["version = 2\n", "unknown = 1\n", 'proxy = "http://user:SECRET@localhost:7890\n']) {
    await writeFile(path, source);
    await assert.rejects(writeConfig(parseAssignments(["proxy=http://new:8080"]), path), (error: Error) => !error.message.includes("SECRET"));
    assert.equal(await readFile(path, "utf8"), source);
  }
});

test("a lock prevents concurrent writes and a failed writer keeps the file", async (t) => {
  const path = await fixture(t);
  await writeConfig(parseAssignments(["proxy=http://old:7890"]), path);
  const original = await readFile(path, "utf8");
  await writeFile(`${path}.lock`, "");
  await assert.rejects(writeConfig(parseAssignments(["proxy=http://new:8080"]), path), /锁定/);
  assert.equal(await readFile(path, "utf8"), original);
});

test("display redacts credentials and new values cannot inject extra TOML keys", () => {
  const output = formatConfig({ version: 1, no_proxy: [], proxy: "http://user:SECRET@localhost:7890" });
  assert.ok(output.includes("REDACTED"));
  assert.ok(!output.includes("SECRET"));
  assert.ok(!output.includes("user:"));
  assert.throws(() => editConfig("", new Map([["proxy", 'http://localhost\nversion = 2']])));
});
