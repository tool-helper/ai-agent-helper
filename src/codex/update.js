import { spawn } from 'node:child_process';
import { writeConfig, configPath } from '../config/store.js';
import { proxyUrlSchema } from '../config/schema.js';
import { installationEnvironment, redact } from '../proxy/environment.js';
import { findCli, inspectCodexVersion, powershell } from './inspect.js';
import { checkUpdateVersions, compareWindowsVersions } from '../updates/versions.js';
import { codexReleaseUrl, codexReleaseVersion, desktopCatalogUrl, desktopReleaseVersion, readUpdateJson } from '../updates/sources.js';
import { readFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { proxyAddresses } from './user-input.js';

const windows = process.platform === 'win32';
const storeId = '9PLM9XGG6VKS';

function proxyFile() {
  const root = windows ? process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
    : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(root, 'check-codex', 'update-proxy.json');
}

function normalizeProxy(address) {
  return proxyUrlSchema.safeParse(address).success ? address : undefined;
}

async function savedProxy(file) {
  try {
    return normalizeProxy(JSON.parse(await readFile(file, 'utf8')).proxy);
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw new Error('无法读取已保存的更新代理地址。');
  }
}

function updateEnv(config, proxy) {
  if (proxy) return installationEnvironment(config, proxy);
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(?:https?_proxy|all_proxy|no_proxy|npm_config_(?:https?_proxy|proxy|noproxy))$/i.test(key)) delete env[key];
  }
  env.NO_PROXY = env.npm_config_noproxy = '*';
  return env;
}

function execute(command, args, env, probe = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env, stdio: probe ? 'ignore' : 'inherit', windowsHide: probe,
      timeout: probe ? 15000 : undefined
    });
    child.once('error', error => reject(new Error(`无法启动 ${path.basename(command)}（${error.code}）`)));
    child.once('close', code => resolve(code ?? 1));
  });
}

function shellPath() {
  return path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function proxyReachable(address) {
  const url = new URL(address);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const port = url.port || (url.protocol === 'https:' ? 443 : 80);
  return new Promise(resolve => {
    const socket = createConnection({ host, port });
    const timer = setTimeout(() => finish(false), 5000);
    function finish(ok) {
      clearTimeout(timer);
      socket.destroy();
      resolve(ok);
    }
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

function probeHttps(url, env) {
  return execute(windows ? 'curl.exe' : 'curl', ['--disable', '--fail', '--silent', '--location',
    '--max-time', '10', '--output', windows ? 'NUL' : '/dev/null', url], env, true);
}

export async function updateTarget(name, findCli, powershell, readJson = readUpdateJson) {
  if (name === 'codex') {
    const { path: file } = await findCli();
    if (!file) throw new Error('未找到 PATH 上的 Codex CLI。');
    const cli = await inspectCodexVersion({ status: 'found', path: file });
    if (!cli.version) throw new Error('无法识别 Codex CLI 当前版本，未执行更新。');
    return {
      version: cli.version,
      versionFormat: 'semver',
      latest: async env => codexReleaseVersion(await readJson(codexReleaseUrl, env)),
      run(env) {
        if (windows && /\.(cmd|bat)$/i.test(file)) {
          return execute(shellPath(), ['-NoProfile', '-Command', '& $env:CHECK_CODEX_LAUNCHER update; exit $LASTEXITCODE'],
            { ...env, CHECK_CODEX_LAUNCHER: file });
        }
        return execute(file, ['update'], env);
      }
    };
  }
  if (!windows) throw new Error('ChatGPT Desktop 更新目前支持 Windows 的 Microsoft Store 安装。');
  const { stdout } = await powershell(`
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
    $app = Get-AppxPackage -Name OpenAI.Codex
    if (!$app) { Write-Output 'APP_MISSING'; exit 0 }
    $cmd = Get-Command winget.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    $winget = if ($cmd) { $cmd.Source } else {
      $installer = Get-AppxPackage -Name Microsoft.DesktopAppInstaller
      if ($installer) { Join-Path $installer.InstallLocation 'winget.exe' }
    }
    [pscustomobject]@{ Winget=$winget; Version=[string]$app.Version; Architecture=[string]$app.Architecture } | ConvertTo-Json -Compress`);
  if (stdout.trim() === 'APP_MISSING') throw new Error('未找到已安装的 ChatGPT Desktop（OpenAI.Codex）。');
  let installed;
  try { installed = JSON.parse(stdout); }
  catch { throw new Error('无法读取 ChatGPT Desktop 当前版本和安装信息，未执行更新。'); }
  const winget = installed.Winget;
  if (typeof winget !== 'string' || !winget) throw new Error('未找到 WinGet，请安装 Windows 应用安装程序。');
  if (typeof installed.Version !== 'string' || !/^\d+\.\d+\.\d+\.\d+$/.test(installed.Version) || typeof installed.Architecture !== 'string') throw new Error('无法识别 ChatGPT Desktop 当前版本和架构，未执行更新。');
  return {
    version: installed.Version,
    versionFormat: 'windows',
    latest: async env => desktopReleaseVersion(await readJson(desktopCatalogUrl, env), installed.Architecture, os.release().split('.').concat('0').slice(0, 4).join('.')),
    probe: env => probeHttps(desktopCatalogUrl, env),
    async currentVersion() {
      try {
        const { stdout } = await powershell(`
          $ErrorActionPreference = 'Stop'
          [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
          Get-AppxPackage -Name OpenAI.Codex | Select-Object @{Name='Version';Expression={[string]$_.Version}} | ConvertTo-Json -Compress`);
        const version = JSON.parse(stdout).Version;
        if (typeof version !== 'string') throw new Error();
        compareWindowsVersions(version, version);
        return version;
      } catch {
        throw new Error('无法核验 ChatGPT Desktop 更新后的实际版本，未确认更新完成。');
      }
    },
    async run(env, proxy) {
      // Both --proxy and --no-proxy require the ProxyCommandLineOptions admin setting.
      // Leave WinGet's network defaults intact when no proxy was requested.
      const args = ['upgrade', '--id', storeId, '--exact', '--source', 'msstore', ...(proxy ? ['--proxy', proxy] : [])];
      return execute(winget, args, env);
    }
  };
}

async function requireProxy(check, config, override, interactive = true) {
  if (override !== undefined) {
    proxyUrlSchema.parse(override);
    if (!await check(override)) throw new Error('指定的代理连接测试失败。');
    return override;
  }
  const saved = config.proxy ?? await savedProxy(proxyFile());
  if (saved) {
    if (await check(saved)) {
      if (!config.proxy) await writeConfig(new Map([['proxy', saved]]));
      return saved;
    }
    console.log('已保存的代理连接测试失败。');
  }
  if (!interactive) throw new Error('需要可连接的代理，请设置 helper proxy 或传入 --proxy。');
  for await (const address of proxyAddresses()) {
    const candidate = normalizeProxy(address);
    if (!candidate) {
      console.log('请输入 HTTP 或 HTTPS 代理地址，只包含主机和端口。');
      continue;
    }
    if (!await check(candidate)) {
      console.log('代理连接测试失败，请重新输入。');
      continue;
    }
    await writeConfig(new Map([['proxy', candidate]]));
    console.log(`已保存更新代理  ${configPath()}`);
    return candidate;
  }
  throw new Error('已取消更新。');
}

/**
 * @param {string} name
 * @param {{ config: import('../config/schema.js').Config, proxy?: string | undefined, dryRun?: boolean | undefined, interactive?: boolean | undefined }} options
 */
export async function update(name, { config, proxy: override, dryRun = false, interactive = true }, runtime = {}) {
  const target = await (runtime.target ?? updateTarget)(name, findCli, powershell, runtime.readJson);
  if (override !== undefined) proxyUrlSchema.parse(override);
  if (dryRun) {
    const route = override ? redact(override) : name === 'codex' ? (config.proxy ? redact(config.proxy) : '必须提供代理') : '优先直连';
    console.log('预览', name === 'codex' ? 'codex update' : 'winget upgrade --id ' + storeId + ' --exact --source msstore', route);
    return;
  }
  let proxy;
  if (name === 'codex') {
    console.log('Codex CLI 更新须使用代理，正在检查代理地址。');
    proxy = await requireProxy(proxyReachable, config, override, interactive);
  } else if (override) {
    proxy = await requireProxy(async address => await target.probe(updateEnv(config, address)) === 0, config, override);
  } else {
    console.log('正在检测更新源能否直连…');
    if (await target.probe(updateEnv(config)) !== 0) {
      console.log('直连检测失败，正在检查更新代理。');
      proxy = await requireProxy(async address => await target.probe(updateEnv(config, address)) === 0, config);
    }
  }
  const env = updateEnv(config, proxy);
  if (name === 'codex') {
    // An inherited NO_PROXY=* would silently bypass the required update proxy.
    for (const key of Object.keys(env)) {
      if (/^(no_proxy|npm_config_noproxy)$/i.test(key)) delete env[key];
    }
    env.NO_PROXY = env.npm_config_noproxy = 'localhost,127.0.0.1,::1';
  }
  const latest = await target.latest(env);
  const nameLabel = name === 'codex' ? 'Codex CLI' : 'ChatGPT Desktop';
  if (!checkUpdateVersions(nameLabel, target.version, latest, target.versionFormat).needsUpdate) return;
  if (name !== 'codex' && !proxy) console.log('正在使用 WinGet 默认网络设置更新 ChatGPT Desktop…');
  else console.log(`正在通过${proxy ? '代理' : '直连'}更新 ${nameLabel}…`);
  const code = await target.run(env, proxy);
  if (name === 'chatgpt-desktop' && (code === 0 || (code >>> 0) === 0x8a15002b)) {
    const actual = await target.currentVersion();
    console.log(`ChatGPT Desktop 实际安装版本：${actual}`);
    if (compareWindowsVersions(actual, latest) < 0) {
      const reason = code === 0 ? 'WinGet 已结束，但尚未确认应用更新完成。' : '公开目录已有新版本，但 WinGet 未提供可用升级。';
      throw new Error(`${reason} 实际版本仍为 ${actual}，公开目录版本为 ${latest}。请在这台电脑的图形桌面中打开 Microsoft Store → 库 → 获取更新，核实可用版本。`);
    }
    console.log('ChatGPT Desktop 实际安装版本已达到服务端版本，版本验证通过。');
    return;
  }
  if (code !== 0) throw new Error(`更新程序退出码  ${code}`);
}
