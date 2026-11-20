import { execFile } from "node:child_process";
import { promisify } from "node:util";
import semver from "semver";
import { z } from "zod";
import { compareWindowsVersions } from "./versions.js";

const run = promisify(execFile);
export const codexReleaseUrl = "https://api.github.com/repos/openai/codex/releases/latest";
export const desktopCatalogUrl = "https://displaycatalog.mp.microsoft.com/v7.0/products/9PLM9XGG6VKS?market=US&languages=en-US";

export async function readUpdateJson(url: string, env: NodeJS.ProcessEnv): Promise<unknown> {
  try {
    const { stdout } = await run(process.platform === "win32" ? "curl.exe" : "curl", [
      "--disable", "--fail", "--silent", "--show-error", "--location", "--max-time", "15",
      "--user-agent", "ai-agent-helper", url,
    ], { env, windowsHide: true, timeout: 20_000, maxBuffer: 4 * 1024 * 1024 });
    return JSON.parse(stdout);
  } catch {
    throw new Error("无法读取官方服务端版本信息，请检查网络或代理；未执行更新。");
  }
}

export function codexReleaseVersion(value: unknown): string {
  const release = z.object({ tag_name: z.string(), draft: z.boolean().optional(), prerelease: z.boolean().optional() }).safeParse(value);
  const version = release.success ? /^rust-v(.+)$/.exec(release.data.tag_name)?.[1] : undefined;
  if (!release.success || release.data.draft || release.data.prerelease || !version || !semver.valid(version)) {
    throw new Error("Codex 官方发布信息未提供有效的稳定版版本号，未执行更新。");
  }
  return version;
}

const dependencySchema = z.object({ PlatformName: z.string(), MinVersion: z.union([z.number(), z.string()]).optional() });
const packageSchema = z.object({ PackageFullName: z.string().optional(), PlatformDependencies: z.array(dependencySchema).optional() });
const catalogSchema = z.object({ Product: z.object({ DisplaySkuAvailabilities: z.array(z.object({
  Sku: z.object({ Properties: z.object({ Packages: z.array(packageSchema).default([]) }) }),
})) }) });

function unpackVersion(value: number | string): string {
  if ((typeof value === "number" && !Number.isSafeInteger(value)) || !/^\d+$/.test(String(value))) throw new Error("无效的系统版本要求");
  const packed = BigInt(value);
  if (packed > 0xffffffffffffffffn) throw new Error("无效的系统版本要求");
  return [48n, 32n, 16n, 0n].map(shift => String((packed >> shift) & 65535n)).join(".");
}

export function desktopReleaseVersion(value: unknown, architecture: string, osVersion: string): string {
  const catalog = catalogSchema.safeParse(value);
  if (!catalog.success) throw new Error("Microsoft Store 未提供有效的应用包目录，未执行更新。");
  let latest: string | undefined;
  for (const sku of catalog.data.Product.DisplaySkuAvailabilities) {
    for (const pkg of sku.Sku.Properties.Packages) {
      const match = /^OpenAI\.Codex_(\d+\.\d+\.\d+\.\d+)_([^_]+)__2p2nqsd0c76g0$/i.exec(pkg.PackageFullName ?? "");
      if (!match || ![architecture.toLowerCase(), "neutral"].includes(match[2]!.toLowerCase())) continue;
      const dependencies = pkg.PlatformDependencies;
      if (dependencies?.length) {
        const supported = dependencies.filter(dependency => ["Windows.Desktop", "Windows.Universal"].includes(dependency.PlatformName));
        if (!supported.some(dependency => dependency.MinVersion === undefined || compareWindowsVersions(osVersion, unpackVersion(dependency.MinVersion)) >= 0)) continue;
      }
      const version = match[1]!;
      if (latest === undefined || compareWindowsVersions(version, latest) > 0) latest = version;
    }
  }
  if (latest === undefined) throw new Error("Microsoft Store 未提供适用于本机架构和系统的可比较版本，未执行更新。");
  return latest;
}
