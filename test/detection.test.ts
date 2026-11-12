import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test, type TestContext } from "node:test";
import { builtInAgents } from "../src/agents/index.js";
import { findExecutable } from "../src/detection/find-executable.js";
import type { DetectionContext } from "../src/detection/types.js";
import { agentListSchema, agentResultSchema, listAgents } from "../src/index.js";

const windows = process.platform === "win32";

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "agent-helper-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const context: DetectionContext = {
    cwd: root, platform: process.platform, env: { PATH: root, PATHEXT: ".CMD;.EXE" },
  };
  async function executable(command: string, directory = root) {
    const file = join(directory, command + (windows ? ".CMD" : ""));
    await writeFile(file, windows ? "@exit /b 93\r\n" : "#!/bin/sh\nexit 93\n");
    if (!windows) await chmod(file, 0o755);
    return file;
  }
  return { root, context, executable };
}

test("each provider detects only its own command; list filters absent agents", async (t) => {
  for (const provider of builtInAgents) {
    await t.test(provider.definition.id, async (t) => {
      const { context, executable } = await fixture(t);
      const file = await executable(provider.definition.command);
      assert.deepEqual(await listAgents(context), [{ ...provider.definition, installed: true, path: file }]);
    });
  }
});

test("missing PATH returns no installed agents; --all includes seven absent entries", async (t) => {
  const { context } = await fixture(t);
  context.env = {};
  assert.deepEqual(await listAgents(context), []);
  const result = await listAgents({ ...context, includeMissing: true });
  assert.equal(result.length, 7);
  assert.ok(result.every((agent) => !agent.installed && agent.path === null));
  assert.deepEqual(agentListSchema.parse(result), result);
});

test("PATH precedence, spaces, and relative entries resolve to absolute paths", async (t) => {
  const { root, context, executable } = await fixture(t);
  const first = join(root, "first folder");
  const second = join(root, "second");
  await mkdir(first);
  await mkdir(second);
  const preferred = await executable("claude", first);
  await executable("claude", second);
  context.env.PATH = ["first folder", second].join(delimiter);
  assert.equal(await findExecutable("claude", context), preferred);
});

test("directories and empty PATH entries do not count as executables", async (t) => {
  const { root, context, executable } = await fixture(t);
  await mkdir(join(root, windows ? "claude.CMD" : "claude"));
  assert.equal(await findExecutable("claude", context), null);
  await executable("codex");
  context.env.PATH = delimiter;
  assert.equal(await findExecutable("codex", context), null);
});

test("Windows supports Path casing, quotes, and PATHEXT precedence", { skip: !windows }, async (t) => {
  const { root, context, executable } = await fixture(t);
  const file = await executable("codex");
  await writeFile(join(root, "codex.EXE"), "");
  context.env = { Path: `"${root}"`, Pathext: ".CMD;.EXE" };
  assert.equal(await findExecutable("codex", context), file);
  context.env.Pathext = ".EXE;.CMD";
  assert.equal(await findExecutable("codex", context), join(root, "codex.EXE"));
});

test("POSIX requires execute permission and follows executable symlinks", { skip: windows }, async (t) => {
  const { root, context, executable } = await fixture(t);
  await writeFile(join(root, "claude"), "not executable");
  assert.equal(await findExecutable("claude", context), null);
  const target = await executable("actual-cli");
  await symlink(target, join(root, "codex"));
  assert.equal(await findExecutable("codex", context), join(root, "codex"));
});

test("schema rejects inconsistent installation states", () => {
  const definition = { id: "codex", name: "Codex", command: "codex" };
  assert.equal(agentResultSchema.safeParse({ ...definition, installed: true, path: null }).success, false);
  assert.equal(agentResultSchema.safeParse({ ...definition, installed: false, path: "/bin/codex" }).success, false);
});
