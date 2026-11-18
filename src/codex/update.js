import { spawn } from 'node:child_process';
import { writeConfig, configPath } from '../config/store.js';
import { proxyUrlSchema } from '../config/schema.js';
import { installationEnvironment, redact } from '../proxy/environment.js';
import { findCli, powershell } from './inspect.js';
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

export async function updateTarget(name, findCli, powershell) {
  if (name === 'codex') {
    const { path: file } = await findCli();
    if (!file) throw new Error('未找到 PATH 上的 Codex CLI。');
    return {
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
    if ($cmd) { $cmd.Source } else {
      $installer = Get-AppxPackage -Name Microsoft.DesktopAppInstaller
      if ($installer) { Join-Path $installer.InstallLocation 'winget.exe' }
    }`);
  const winget = stdout.trim();
  if (winget === 'APP_MISSING') throw new Error('未找到已安装的 ChatGPT Desktop（OpenAI.Codex）。');
  if (!winget) throw new Error('未找到 WinGet，请安装 Windows 应用安装程序。');
  return {
    probe: env => probeHttps(`https://storeedgefd.dsx.mp.microsoft.com/v9.0/packageManifests/${storeId}?Market=US`, env),
    async run(env, proxy) {
      const args = ['upgrade', '--id', storeId, '--exact', '--source', 'msstore', ...(proxy ? ['--proxy', proxy] : ['--no-proxy'])];
      const code = await execute(winget, args, env);
      if ((code >>> 0) === 0x8a15002b) {
        console.log('当前没有可用的 ChatGPT 更新。');
        return 0;
      }
      return code;
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

export async function update(name, { config, proxy: override, dryRun, interactive = true }) {
  const target = await updateTarget(name, findCli, powershell);
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
  console.log(`正在通过${proxy ? '代理' : '直连'}更新 ${name === 'codex' ? 'Codex CLI' : 'ChatGPT Desktop'}…`);
  const env = updateEnv(config, proxy);
  if (name === 'codex') {
    // An inherited NO_PROXY=* would silently bypass the required update proxy.
    for (const key of Object.keys(env)) {
      if (/^(no_proxy|npm_config_noproxy)$/i.test(key)) delete env[key];
    }
    env.NO_PROXY = env.npm_config_noproxy = 'localhost,127.0.0.1,::1';
  }
  const code = await target.run(env, proxy);
  if (code !== 0) throw new Error(`更新程序退出码  ${code}`);
}
