import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("config CLI edits key=value batches in an isolated home, preserves comments and redacts secrets", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "agent-helper-cli-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !["PATH", "HOME", "USERPROFILE"].includes(key.toUpperCase())));
  Object.assign(env, { PATH: "", HOME: home, USERPROFILE: home });
  const isolated = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], { cwd: root, env, encoding: "utf8", timeout: 15_000 });
  const path = join(home, ".ai-agent-helper", "config.toml");
  assert.equal(isolated("config").status, 0);
  await assert.rejects(stat(path), { code: "ENOENT" });
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, "# keep this comment\nversion = 1\n");
  const set = isolated("config", "set", "proxy=http://user:p=SECRET@localhost:7890", "no_proxy=localhost,127.0.0.1");
  assert.equal(set.status, 0, set.stderr);
  assert.ok(!set.stdout.includes("SECRET"));
  const view = isolated("config");
  assert.equal(view.status, 0, view.stderr);
  assert.ok(view.stdout.includes("REDACTED"));
  assert.ok(!view.stdout.includes("SECRET"));
  const saved = await readFile(path, "utf8");
  assert.ok(saved.includes("# keep this comment"));
  const invalid = isolated("config", "set", "proxy=http://new", "version=2");
  assert.equal(invalid.status, 1);
  assert.equal(await readFile(path, "utf8"), saved);
  assert.equal(isolated("config", "unset", "proxy").status, 0);
  assert.doesNotMatch(isolated("config").stdout, /^proxy\s*=/m);
  for (const args of [["update", "--self", "--agent", "codex"], ["update", "--agent", "gemini"], ["install", "gemini"], ["update", "--all"], ["list", "--proxy", "http://localhost"]]) {
    assert.equal(isolated(...args).status, 1, args.join(" "));
  }
  assert.equal(isolated("update", "--all-agents").status, 0);
  for (const command of ["config", "install", "update"]) assert.equal(isolated(command, "--help").status, 0);
});
