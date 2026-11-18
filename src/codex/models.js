import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function configuredCatalog(file, setting) {
  if (typeof setting !== 'string' || !setting) return;
  if (/^~[/\\]/.test(setting)) return path.resolve(os.homedir(), setting.slice(2));
  return path.resolve(path.dirname(file), setting);
}

async function fetchModels(base, provider, defaultKey) {
  let url;
  try {
    url = new URL(base);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    url.pathname = url.pathname.replace(/\/+$/, '') + '/models';
    for (const [key, value] of Object.entries(provider.query_params ?? {})) {
      url.searchParams.set(key, value);
    }
  } catch {
    throw new Error('提供商的 base_url 或请求参数无效');
  }

  const headers = new Headers(provider.http_headers ?? {});
  for (const [header, env] of Object.entries(provider.env_http_headers ?? {})) {
    if (process.env[env]) headers.set(header, process.env[env]);
  }
  const token = provider.env_key ? process.env[provider.env_key] : provider.experimental_bearer_token ?? defaultKey;
  if (provider.env_key && !token) throw new Error('当前进程缺少该提供商 env_key 指定的环境变量');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let response;
  try {
    response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(10000) });
  } catch {
    throw new Error('无法连接提供商模型接口，或请求超时');
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`模型接口返回 HTTP ${response.status}`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error('模型接口未返回有效 JSON');
  }
}

function printCatalog(catalog, source, current) {
  const rows = catalog?.data ?? catalog?.models;
  if (!Array.isArray(rows)) throw new Error('模型列表格式无法识别');
  const models = new Map();
  for (const row of rows) {
    const id = row?.id ?? row?.slug;
    if (typeof id === 'string' && id) models.set(id, row);
  }
  if (rows.length && !models.size) throw new Error('列表中缺少模型 ID');
  console.log(`模型来源  ${source}`);
  console.log(`模型列表（${models.size} 个）`);
  for (const [id, row] of models) {
    const fields = [id];
    if (id === current) fields.push('[配置模型]');
    if (typeof row.display_name === 'string' && row.display_name !== id) fields.push(row.display_name);
    if (Number.isFinite(row.context_window)) fields.push(`上下文 ${row.context_window} tokens`);
    console.log(`  ${fields.join('  ')}`);
  }
  if (current && !models.has(current)) console.log('当前配置的模型未出现在这份列表中。');
}

export async function showModels({ active, provider, settings }, file, isDefault, modelCli) {
  const current = settings.model;
  modelCli.printVersions();
  console.log(`配置模型  ${current ?? '由 Codex 选择'}`);
  const catalog = configuredCatalog(file, settings.model_catalog_json ?? provider?.model_catalog_json);
  const builtInOpenAI = active === 'openai' && !provider;
  const localBases = new Map([['ollama', 'http://localhost:11434/v1'], ['lmstudio', 'http://localhost:1234/v1']]);
  const base = provider?.base_url ?? (builtInOpenAI ? settings.openai_base_url : localBases.get(active));
  try {
    if (builtInOpenAI && isDefault && !catalog) {
      let result;
      try {
        result = await modelCli.readModels();
      } catch {
        throw new Error('codex debug models 未能返回模型目录');
      }
      printCatalog(result, '终端 Codex CLI 目录（可能使用缓存或内置数据）', current);
      return;
    }
    if (base) {
      // A custom endpoint only receives credentials explicitly bound to its provider.
      const remote = await fetchModels(base, provider ?? {});
      printCatalog(remote, '提供商接口 GET /models', current);
      return;
    }
    if (builtInOpenAI && !catalog && process.env.OPENAI_API_KEY) {
      const remote = await fetchModels('https://api.openai.com/v1', {}, process.env.OPENAI_API_KEY);
      printCatalog(remote, 'OpenAI 接口 GET /models', current);
      return;
    }
    if (!catalog) throw new Error('当前配置缺少可用的模型接口或模型目录');
  } catch (error) {
    // HTTP clients can include sensitive header values in validation errors.
    if (error instanceof TypeError) console.error('模型查询失败，提供商请求配置无效。');
    else console.error(`模型查询失败，${error.message}。`);
    if (!catalog) {
      process.exitCode = 1;
      return;
    }
  }
  let local;
  try {
    local = JSON.parse((await readFile(catalog, 'utf8')).replace(/^\uFEFF/, ''));
  } catch {
    throw new Error(`无法读取或解析配置指定的模型目录  ${catalog}`);
  }
  if (typeof local?.client_version === 'string' && local.client_version) {
    console.log(`目录记录的客户端版本  ${local.client_version}`);
  }
  printCatalog(local, `配置指定的本地目录  ${catalog}`, current);
}
