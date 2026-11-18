import path from 'node:path';
import { selectItem } from './user-input.js';
import { accessSettings, formatProviderAuth, printAccess, providerAuth, readConfig, resolveProvider } from './config-settings.js';
import { showModels } from './models.js';

function showProviders({ active, providers, source }, base) {
  console.log(`提供商（${providers.size} 个）`);
  for (const [id, provider] of providers) {
    const name = provider?.name;
    const label = typeof name === 'string' && name !== id ? ` · ${name}` : '';
    const auth = formatProviderAuth(providerAuth(id, provider, base));
    console.log(`  ${id}${label}${id === active ? '  [启用]' : ''}  ${auth}`);
  }
  console.log(`配置启用的提供商  ${active}（${source}）`);
}

export async function inspectConfig(home, { files, listStatus }, modelCli) {
  if (listStatus === 'unknown') {
    console.error(`无法完整读取配置目录  ${home}`);
    process.exitCode = 1;
  }
  if (!files.length) {
    if (listStatus !== 'unknown') console.log(`未找到配置文件  ${home}`);
    return;
  }

  const choices = files.map(file => ({ title: path.basename(file), value: file }));
  const file = await selectItem('选择配置文件', choices);
  if (!file) return;
  const name = path.basename(file);
  const isDefault = (process.platform === 'win32' ? name.toLowerCase() : name) === 'config.toml';
  return showConfig(file, isDefault, modelCli);
}

export async function showConfig(file, isDefault, modelCli) {
  console.log(`所选配置  ${file}`);
  try {
    const { config, status } = await readConfig(file);
    if (status === 'not_found') {
      if (!isDefault) throw new Error('所选配置文件不存在。');
      console.log('未找到用户配置文件，使用 Codex 默认值。');
    }
    const selected = resolveProvider(config);
    let base;
    if (!isDefault) {
      base = await readConfig(path.join(path.dirname(file), 'config.toml')).catch(() => ({ status: 'unknown' }));
    }
    showProviders(selected, base);
    printAccess(accessSettings(config, selected, base));
    await showModels(selected, file, isDefault, modelCli);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
