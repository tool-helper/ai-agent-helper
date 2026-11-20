import assert from "node:assert/strict";
import { createServer } from "node:net";
import { test } from "node:test";
import { update } from "../src/codex/update.js";

test("native updaters compare and announce versions before updating; equal or newer versions never run", async t => {
  const proxy = createServer(socket => socket.destroy());
  await new Promise<void>(resolve => proxy.listen(0, "127.0.0.1", resolve));
  t.after(() => proxy.close());
  const address = proxy.address();
  assert.ok(address && typeof address === "object");
  const config = { version: 1 as const, no_proxy: [], proxy: `http://127.0.0.1:${address.port}` };
  const output: string[] = [];
  t.mock.method(console, "log", (line: string) => output.push(line));
  for (const name of ["codex", "chatgpt-desktop"]) {
    const current = name === "codex" ? "1.2.3" : "26.1118.10.0";
    const newer = name === "codex" ? "1.2.4" : "26.1118.11.0";
    const older = name === "codex" ? "1.2.2" : "26.1118.9.0";
    for (const latest of [current, older, newer, "Unknown"]) {
      let checks = 0;
      let installs = 0;
      const runtime = { target: async () => ({
        version: current,
        versionFormat: name === "codex" ? "semver" : "windows",
        probe: async () => 0,
        latest: async () => { checks++; return latest; },
        run: async () => {
          assert.ok(output.some(line => line.includes(`当前版本：${current}`)));
          assert.ok(output.some(line => line.includes(`服务端版本：${latest}`)));
          installs++;
          return 0;
        },
      }) };
      output.length = 0;
      const operation = update(name, { config, interactive: false }, runtime);
      if (latest === "Unknown") await assert.rejects(operation);
      else await operation;
      assert.equal(checks, 1);
      assert.equal(installs, latest === newer ? 1 : 0);
      if (latest === current) assert.ok(output.some(line => line.includes("版本一致")));
    }
  }
});

test("native version query errors stop the update; dry runs query nothing", async t => {
  t.mock.method(console, "log", () => {});
  let checks = 0;
  let installs = 0;
  const runtime = { target: async () => ({
    version: "26.1118.10.0", versionFormat: "windows", probe: async () => 0,
    latest: async () => { checks++; throw new Error("offline version source"); },
    run: async () => { installs++; return 0; },
  }) };
  const config = { version: 1 as const, no_proxy: [] };
  await update("chatgpt-desktop", { config, dryRun: true }, runtime);
  assert.equal(checks, 0);
  await assert.rejects(update("chatgpt-desktop", { config }, runtime), /offline version source/);
  assert.equal(installs, 0);
});
