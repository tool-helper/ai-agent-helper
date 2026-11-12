import spawn from "cross-spawn";
import { StringDecoder } from "node:string_decoder";
import { redact } from "../proxy/environment.js";

export type NpmRunner = (args: string[], stream?: boolean) => Promise<string>;

export function npmRunner(env: NodeJS.ProcessEnv): NpmRunner {
  const childEnv = Object.fromEntries(Object.entries(env).filter(([key]) => key.toLowerCase() !== "npm_config_update_notifier"));
  childEnv.npm_config_update_notifier = "false";
  return (args, stream = false) => new Promise((resolve, reject) => {
    const child = spawn("npm", args, { env: childEnv, stdio: ["inherit", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let oversized = false;
    const forwardInterrupt = () => child.kill("SIGINT");
    const forwardTerminate = () => child.kill("SIGTERM");
    process.once("SIGINT", forwardInterrupt);
    process.once("SIGTERM", forwardTerminate);
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, stream ? 600_000 : 60_000);
    const cleanup = () => {
      clearTimeout(timer);
      process.removeListener("SIGINT", forwardInterrupt);
      process.removeListener("SIGTERM", forwardTerminate);
    };
    const wire = (readable: NodeJS.ReadableStream, destination: NodeJS.WriteStream, output: "stdout" | "stderr") => {
      const decoder = new StringDecoder("utf8");
      let pending = "";
      readable.on("data", (chunk: Buffer) => {
        const text = decoder.write(chunk);
        if (output === "stdout") stdout += text;
        else stderr += text;
        if (stdout.length + stderr.length > 4_000_000) { oversized = true; child.kill(); return; }
        if (!stream) return;
        pending += text;
        const end = pending.lastIndexOf("\n");
        if (end >= 0) { destination.write(redact(pending.slice(0, end + 1))); pending = pending.slice(end + 1); }
      });
      readable.on("end", () => { if (stream) destination.write(redact(pending + decoder.end())); });
    };
    wire(child.stdout!, process.stdout, "stdout");
    wire(child.stderr!, process.stderr, "stderr");
    child.once("error", () => { cleanup(); reject(new Error("无法启动 npm，请确认 npm 已安装并位于 PATH 中。")); });
    child.once("close", (code, signal) => {
      cleanup();
      if (timedOut) reject(new Error("npm 操作超时。"));
      else if (oversized) reject(new Error("npm 输出超出限制。"));
      else if (code !== 0) reject(new Error(`npm 操作失败（${signal ?? code}）。${stream ? "" : `\n${redact(stderr).trim()}`}`));
      else resolve(stdout.trim());
    });
  });
}
