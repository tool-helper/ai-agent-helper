import { execFile } from 'node:child_process';
import { findExecutable } from '../detection/find-executable.js';
import { readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { accessSettings, printAccess, readConfig, resolveProvider } from './config-settings.js';

const run = promisify(execFile);
const windows = process.platform === 'win32';
const options = { timeout: 10000, windowsHide: true, maxBuffer: 65536 };
export function powershell(script, env = process.env, runOptions = options) {
  const executable = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return run(executable, ['-NoProfile', '-NonInteractive', '-Command', script], { ...runOptions, env });
}

export async function findCli() {
  const file = await findExecutable('codex', { env: process.env, platform: process.platform, cwd: process.cwd() });
  return file ? { status: 'found', path: file } : { status: 'not_found' };
}

// Callers supply fixed CLI arguments, never values read from a config file.
function runCli(file, args, runOptions = options) {
  if (windows && /\.(cmd|bat)$/i.test(file)) {
    return powershell(`[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); & $env:CHECK_CODEX_LAUNCHER ${args.join(' ')}; exit $LASTEXITCODE`,
      { ...(runOptions.env ?? process.env), CHECK_CODEX_LAUNCHER: file }, runOptions);
  }
  return run(file, args, runOptions);
}

async function inspectCli() {
  return inspectCodexVersion(await findCli());
}

async function inspectCodexVersion(cli) {
  if (cli.status !== 'found') return cli;
  try {
    const result = await runCli(cli.path, ['--version']);
    const match = /^codex(?:-cli)?\s+(\d+\.\d+\.\d+[\w.+-]*)\s*$/im.exec(result.stdout);
    if (match) return { ...cli, version: match[1] };
  } catch {
    // Keep the discovered launcher visible when it cannot report its version.
  }
  return { ...cli, status: 'version_unknown' };
}

async function readCliModels(home, cli) {
  if (!cli.path) throw new Error('未找到 Codex CLI');
  const { stdout } = await runCli(cli.path, ['debug', 'models'], {
    ...options, cwd: os.homedir(), env: { ...process.env, CODEX_HOME: home },
    timeout: 20000, maxBuffer: 32 * 1024 * 1024
  });
  return JSON.parse(stdout);
}

async function inspectDesktop() {
  if (!windows) return { status: 'unsupported' };
  const query = `
    $ErrorActionPreference = 'Stop'
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    Get-AppxPackage -Name OpenAI.Codex | Select-Object Name, Version, InstallLocation | ConvertTo-Json -Compress
  `;
  try {
    const { stdout } = await powershell(query);
    if (!stdout.trim()) return { status: 'not_found' };
    const pkg = JSON.parse(stdout);
    const bundledCli = pkg.InstallLocation
      ? await inspectCodexVersion(await inspectPath(path.join(pkg.InstallLocation, 'app', 'resources', 'codex.exe')))
      : { status: 'unknown' };
    return { status: 'found', package: pkg.Name, version: pkg.Version, path: pkg.InstallLocation, bundledCli };
  } catch {
    return { status: 'unknown' };
  }
}

async function inspectPath(file, directory = false) {
  try {
    const info = await stat(file);
    return { path: file, status: (directory ? info.isDirectory() : info.isFile()) ? 'found' : 'wrong_type' };
  } catch (error) {
    return { path: file, status: ['ENOENT', 'ENOTDIR'].includes(error.code) ? 'not_found' : 'unknown' };
  }
}

async function listConfigFiles(home) {
  let entries;
  try {
    entries = await readdir(home, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return { files: [], listStatus: 'not_found' };
    return { files: [], listStatus: 'unknown' };
  }

  const pattern = windows ? /^(?:.*\.)?config\.toml$/i : /^(?:.*\.)?config\.toml$/;
  const files = [];
  let listStatus = 'found';
  for (const entry of entries) {
    if (!pattern.test(entry.name)) continue;
    const file = path.join(home, entry.name);
    if (entry.isFile()) {
      files.push(file);
    } else if (entry.isSymbolicLink()) {
      const { status } = await inspectPath(file);
      if (status === 'found') files.push(file);
      if (status === 'unknown') listStatus = 'unknown';
    }
  }
  return { files: files.sort(), listStatus };
}

const labels = {
  found: '已找到',
  not_found: '未找到',
  unknown: '无法确认',
  unsupported: '当前平台暂不支持 Desktop 检查',
  version_unknown: '已找到，版本无法确认',
  wrong_type: '路径类型不符'
};

function printItem(title, item) {
  console.log(`${title}  ${labels[item.status]}${item.version ? '  ' + item.version : ''}`);
  if (item.path) console.log(`  ${item.path}`);
}

function printVersions(cli, desktop) {
  const bundled = desktop.bundledCli ?? { status: desktop.status };
  console.log(`本机 Codex CLI 版本  ${cli.version ?? labels[cli.status]}`);
  console.log(`ChatGPT Desktop 应用包版本  ${desktop.version ?? labels[desktop.status]}`);
  console.log(`Desktop 内置 Codex 版本  ${bundled.version ?? labels[bundled.status]}`);
}

export async function inspectCodex(action, json) {
  const home = path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
  if (action === 'config' || action === 'models') {
    const { inspectConfig, showConfig } = await import('./config-command.js');
    const [cli, desktop] = await Promise.all([inspectCli(), inspectDesktop()]);
    const modelCli = {
      printVersions: () => printVersions(cli, desktop),
      readModels: () => readCliModels(home, cli)
    };
    if (action === 'models') return showConfig(path.join(home, 'config.toml'), true, modelCli);
    return inspectConfig(home, await listConfigFiles(home), modelCli);
  }
  const [cli, desktop, homeDir, configFile, listing] = await Promise.all([
    inspectCli(), inspectDesktop(), inspectPath(home, true), inspectPath(path.join(home, 'config.toml')), listConfigFiles(home)
  ]);
  const config = { source: process.env.CODEX_HOME ? 'CODEX_HOME' : 'default', home: homeDir, file: configFile, ...listing };
  try {
    const { config: defaults } = await readConfig(configFile.path);
    config.access = accessSettings(defaults, resolveProvider(defaults));
  } catch (error) {
    config.access = { error: error.message };
  }
  if (json) {
    console.log(JSON.stringify({ platform: process.platform, cli, desktop, config }, null, 2));
    return;
  }
  printItem('Codex CLI', cli);
  printItem('ChatGPT Desktop 应用包', desktop);
  if (desktop.bundledCli) printItem('Desktop 内置 Codex', desktop.bundledCli);
  printItem(`配置目录（${config.source}）`, homeDir);
  printAccess(config.access);
  console.log(`用户配置文件（${listing.files.length} 个）`);
  for (const file of listing.files) console.log(`  ${file}`);
  if (listing.listStatus === 'unknown') console.log('  无法完整读取配置清单');
}
