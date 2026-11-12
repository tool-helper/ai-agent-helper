import type { Config } from "../config/schema.js";
import { proxyUrlSchema } from "../config/schema.js";

export function installationEnvironment(config: Config, override?: string, base = process.env): NodeJS.ProcessEnv {
  const proxy = override ?? config.proxy;
  const env = { ...base };
  if (proxy === undefined) return env;
  proxyUrlSchema.parse(proxy);
  const replaced = new Set(["http_proxy", "https_proxy", "all_proxy", "npm_config_proxy", "npm_config_https_proxy"]);
  if (config.no_proxy.length) for (const name of ["no_proxy", "npm_config_noproxy"]) replaced.add(name);
  for (const name of Object.keys(env)) if (replaced.has(name.toLowerCase())) delete env[name];
  Object.assign(env, {
    HTTP_PROXY: proxy, HTTPS_PROXY: proxy, http_proxy: proxy, https_proxy: proxy,
    npm_config_proxy: proxy, npm_config_https_proxy: proxy,
  });
  if (config.no_proxy.length) {
    const bypass = config.no_proxy.join(",");
    Object.assign(env, { NO_PROXY: bypass, no_proxy: bypass, npm_config_noproxy: bypass });
  }
  return env;
}

export function redact(text: string): string {
  return text.replace(/https?:\/\/[^\s<>"']+/gi, (value) => {
    try {
      const url = new URL(value);
      if (!url.username && !url.password) return value;
      return `${url.protocol}//REDACTED:REDACTED@${url.host}${url.pathname}${url.search}${url.hash}`;
    } catch { return value.replace(/\/\/[^/]*@/, "//REDACTED@"); }
  });
}
