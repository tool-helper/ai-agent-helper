import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { agentListSchema } from "../src/schema.js";

const root = fileURLToPath(new URL("../", import.meta.url));

function run(...args: string[]) {
  // Explicitly clear PATH: Node on Windows can inherit it when the key is omitted.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "PATH"));
  env.PATH = "";
  return spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], {
    cwd: root, env, encoding: "utf8", timeout: 15_000,
  });
}

test("root, --help, -h, and list --help document commands and options", () => {
  for (const args of [[], ["--help"], ["-h"], ["list", "--help"]]) {
    const result = run(...args);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /agent-helper list/);
    assert.match(result.stdout, /--json/);
    assert.equal(result.stderr, "");
  }
});

test("version comes from the npm package", () => {
  const result = run("--version");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test("JSON is a clean array, including an empty installation list", () => {
  const empty = run("list", "--json");
  assert.equal(empty.status, 0, empty.stderr);
  assert.deepEqual(JSON.parse(empty.stdout), []);
  const all = run("list", "--all", "--json");
  assert.equal(all.status, 0, all.stderr);
  const parsed = agentListSchema.parse(JSON.parse(all.stdout));
  assert.equal(parsed.length, 6);
  assert.ok(parsed.every((agent) => !agent.installed));
  assert.equal(all.stderr, "");
});

test("table and empty-state output are readable", () => {
  assert.match(run("list").stdout, /未在 PATH 中检测到/);
  const all = run("list", "-a");
  assert.equal(all.status, 0, all.stderr);
  assert.match(all.stdout, /Claude Code\s+claude\s+not found/);
});

test("invalid commands and flags fail without contaminating stdout", () => {
  for (const args of [["install"], ["list", "extra"], ["list", "--unknown"], ["--json"], ["list", "--json=true"]]) {
    const result = run(...args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /agent-helper:/);
  }
});
