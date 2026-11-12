import { z } from "zod";

/** HTTP(S) proxy endpoint used by installation subprocesses. */
export const proxyUrlSchema = z.string().min(1).superRefine((value, context) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    context.addIssue({ code: "custom", message: "代理必须是有效的 HTTP/HTTPS URL。" });
    return;
  }
  if (value !== value.trim() || /\s/.test(value)) {
    context.addIssue({ code: "custom", message: "代理 URL 不能包含空白字符。" });
  }
  if (!/^https?:\/\//i.test(value) || !["http:", "https:"].includes(url.protocol) || !url.hostname) {
    context.addIssue({ code: "custom", message: "代理仅支持 http:// 或 https://。" });
  }
  if ((url.pathname !== "" && url.pathname !== "/") || url.search || url.hash) {
    context.addIssue({ code: "custom", message: "代理 URL 不能包含路径、查询参数或片段。" });
  }
});

const noProxyEntrySchema = z.string().min(1).refine(
  (value) => !/[\s,]/.test(value),
  "每个 no_proxy 条目必须是单独的非空规则，不能包含空白或逗号。",
);

/** Validate the object produced by a TOML parser; never persist resolved environment values. */
export const configSchema = z.strictObject({
  version: z.literal(1).default(1),
  proxy: proxyUrlSchema.optional(),
  no_proxy: z.array(noProxyEntrySchema).default([]),
});

/** Only these keys are writable through `config set` / `config unset`. */
export const configKeySchema = z.enum(["proxy", "no_proxy"]);

/** User-provided fields, before defaults are applied. */
export type ConfigInput = z.input<typeof configSchema>;
/** Validated configuration with defaults, independent of runtime environment. */
export type Config = z.output<typeof configSchema>;
export type ConfigKey = z.infer<typeof configKeySchema>;
