import { readFile } from 'node:fs/promises';
import { parse } from 'smol-toml';

export async function readConfig(file) {
  try {
    const content = await readFile(file, 'utf8');
    return { status: 'found', config: parse(content.replace(/^\uFEFF/, '')) };
  } catch (error) {
    if (error.code === 'ENOENT') return { status: 'not_found', config: {} };
    // Parser errors may include a line containing credentials.
    throw new Error(error.code ? '无法读取配置文件。' : '配置文件的 TOML 格式有误。');
  }
}

export function resolveProvider(config) {
  const providers = new Map(Object.entries(config.model_providers ?? {}));
  let settings = config;
  let source = 'model_provider';
  if (config.profile !== undefined) {
    if (typeof config.profile !== 'string' || !Object.hasOwn(config.profiles ?? {}, config.profile)) {
      throw new Error('所选文件中找不到 profile 引用的配置。');
    }
    const profile = config.profiles[config.profile];
    settings = { ...config, ...profile };
    if (profile.model_provider !== undefined) source = `profile ${config.profile}`;
  }
  const active = settings.model_provider ?? 'openai';
  if (settings.model_provider === undefined) source = 'Codex 默认值';
  if (typeof active !== 'string' || !active.trim()) throw new Error('model_provider 必须是非空字符串。');
  if (!providers.has(active)) providers.set(active, undefined);
  return { active, source, providers, settings, provider: providers.get(active) };
}

export function providerAuth(id, provider, base) {
  let value = provider?.requires_openai_auth;
  let source = 'configured';
  if (value === undefined) {
    if (base?.status === 'unknown') return { value: 'unknown' };
    value = base?.config?.model_providers?.[id]?.requires_openai_auth;
    if (value === undefined) return { value: id === 'openai', source: 'default' };
    source = 'inherited';
  }
  return { value: typeof value === 'boolean' ? value : 'invalid', source };
}

export function formatProviderAuth({ value, source }) {
  const labels = { unknown: '无法确认（无法读取或解析 config.toml）', invalid: '配置值无效' };
  const suffix = { default: '（默认值）', inherited: '（继承自 config.toml）' };
  return `requires_openai_auth = ${labels[value] ?? value}${suffix[source] ?? ''}`;
}

export function accessSettings(config, { active, provider }, base) {
  const inherited = [];
  const unknown = [];
  function setting(key, value, fallback) {
    if (value !== undefined) return value;
    if (base?.status === 'unknown') unknown.push(key);
    if (fallback !== undefined) inherited.push(key);
    return fallback;
  }
  const defaults = base?.config;
  const proxy = setting('respect_system_proxy', config.features?.respect_system_proxy, defaults?.features?.respect_system_proxy);
  const login = setting('forced_login_method', config.forced_login_method, defaults?.forced_login_method);
  const auth = providerAuth(active, provider, base);
  if (auth.source === 'inherited') inherited.push('requires_openai_auth');
  const workspace = setting('workspace_restricted', config.forced_chatgpt_workspace_id, defaults?.forced_chatgpt_workspace_id);
  const result = {
    provider: active,
    respect_system_proxy: typeof proxy === 'boolean' ? proxy : proxy === undefined ? null : 'invalid',
    forced_login_method: login === undefined ? null : ['chatgpt', 'api'].includes(login) ? login : 'invalid',
    requires_openai_auth: auth.value,
    requires_openai_auth_source: auth.source,
    workspace_restricted: typeof workspace === 'string' && !!workspace.trim()
  };
  if (inherited.length) result.inherited = inherited;
  for (const key of unknown) result[key] = 'unknown';
  return result;
}

export function printAccess(settings) {
  if (settings.error) return console.log(`代理和登录限制  ${settings.error}`);
  const proxyLabels = { true: '启用', false: '关闭', null: '未设置（默认关闭）', invalid: '配置值无效' };
  const loginLabels = { chatgpt: '仅 ChatGPT 登录', api: '仅 API 认证', null: '配置中未限制', invalid: '配置值无效' };
  function label(key, labels) {
    if (settings[key] === 'unknown') return '无法确认（无法读取或解析 config.toml）';
    const suffix = settings.inherited?.includes(key) ? '（继承自 config.toml）' : '';
    return labels[settings[key]] + suffix;
  }
  console.log(`使用系统代理（respect_system_proxy）  ${label('respect_system_proxy', proxyLabels)}`);
  console.log(`登录方式限制（forced_login_method）  ${label('forced_login_method', loginLabels)}`);
  const auth = formatProviderAuth({ value: settings.requires_openai_auth, source: settings.requires_openai_auth_source });
  console.log(`提供商 OpenAI 认证（${settings.provider}）  ${auth}`);
  if (settings.workspace_restricted) console.log(`ChatGPT 工作区限制  ${label('workspace_restricted', { true: '已指定工作区' })}`);
}
