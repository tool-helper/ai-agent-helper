import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { selectInstallAgent } from "../src/installation/select-agent.js";

function terminal() {
  const input = Object.assign(new PassThrough(), {
    isTTY: true,
    isRaw: false,
    setRawMode(value: boolean) { this.isRaw = value; return this; },
  });
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 100, rows: 24 });
  let text = "";
  output.on("data", (chunk: Buffer) => { text += chunk.toString(); });
  return { input, output, text: () => text };
}

test("install menu confirms the default and selects either agent with arrow keys", { timeout: 2_000 }, async () => {
  for (const [keys, expected] of [["\r", "codex"], ["\x1b[B\r", "dsh"], ["\x1b[B\x1b[A\r", "codex"]]) {
    const io = terminal();
    const selected = selectInstallAgent(io.input, io.output);
    io.input.write(keys!);
    assert.equal(await selected, expected);
    assert.equal(io.input.isRaw, false);
    assert.match(io.text(), /Codex CLI \(codex\)/);
    assert.match(io.text(), /DeepSeek Harness CLI \(dsh\)/);
    assert.match(io.text(), /↑\/↓ 选择，回车确认/);
    io.input.destroy();
    io.output.destroy();
  }
});

test("desktop menu choices resolve to page targets, separate from the CLI", { timeout: 2_000 }, async () => {
  for (const [down, expected] of [[2, "dsh-desktop"], [3, "chatgpt-desktop"]] as const) {
    const io = terminal();
    const selected = selectInstallAgent(io.input, io.output);
    io.input.write("\x1b[B".repeat(down) + "\r");
    assert.equal(await selected, expected);
    assert.match(io.text(), /DeepSeek Harness 桌面版/);
    assert.match(io.text(), /ChatGPT 桌面版/);
    io.input.destroy();
    io.output.destroy();
  }
});

test("typing a number does not submit the menu", { timeout: 2_000 }, async () => {
  const io = terminal();
  const selected = selectInstallAgent(io.input, io.output);
  io.input.write("2\x1b[B\r");
  assert.equal(await selected, "dsh");
  io.input.destroy();
  io.output.destroy();
});

test("cancel option, Esc, Ctrl+C and closed input leave no selected agent", { timeout: 2_000 }, async () => {
  for (const answer of ["\x1b[B".repeat(4) + "\r", "\x1b", "\x03", null]) {
    const io = terminal();
    const selected = selectInstallAgent(io.input, io.output);
    if (answer === null) io.input.end();
    else io.input.write(answer);
    assert.equal(await selected, null);
    assert.equal(io.input.isRaw, false);
    io.input.destroy();
    io.output.destroy();
  }
});

test("non-interactive input or output requires an explicit target", async () => {
  for (const stream of ["input", "output"] as const) {
    const io = terminal();
    io[stream].isTTY = false;
    await assert.rejects(selectInstallAgent(io.input, io.output), /非交互环境.*install codex.*install dsh/);
    assert.equal(io.text(), "");
    io.input.destroy();
    io.output.destroy();
  }
});
