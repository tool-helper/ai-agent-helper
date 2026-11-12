# 配置功能

从 `0.2.0` 起提供 TOML 配置读写、`config` 命令、Codex 安装/更新及工具自身更新。

## 文件位置与格式

用户级配置固定为 `~/.ai-agent-helper/config.toml`，采用 TOML。使用 `os.homedir()` 定位用户主目录，不依赖 shell 展开 `~`。Windows 对应 `%USERPROFILE%\.ai-agent-helper\config.toml`。首版只加载用户级配置。

```toml
# 配置格式版本
version = 1

# 需要代理的 agent 使用的默认代理（当前为 Codex；DSH 默认不套用）
proxy = "http://127.0.0.1:7890"

# 具体匹配行为由所使用的安装工具决定
no_proxy = ["localhost", "127.0.0.1", "::1"]
```

完整带注释示例见 `examples/config.toml`。

## 持久化数据模型

模型定义位于 `src/config/schema.ts`。字段采用 snake_case，与 TOML 示例保持一致。

| 字段 | 类型 | 省略时 | 校验及含义 |
| --- | --- | --- | --- |
| `version` | 字面量整数 `1` | 按 `1` 读取 | 配置格式版本，首次创建时写入；不允许通过 `config set` 修改 |
| `proxy` | 可选字符串 | 继承安装工具原有代理配置 | 供启用默认代理策略的 agent 使用，目前为 Codex；必须是 HTTP/HTTPS URL，禁止空白、业务路径、查询参数和片段 |
| `no_proxy` | 字符串数组 | `[]` | 每个非空条目是一条绕过规则，不含空白或逗号；安装器负责转换和兼容性检查 |

不允许未知字段，避免拼写错误被悄悄忽略。不支持的 `version` 应报错并停止写入，不能用当前模型覆盖未来版本的文件。TOML 没有 `null`，可选配置通过省略字段表示。

`ConfigInput` 表示 TOML 解析后的输入，允许省略默认字段；`Config` 表示 Zod 校验并补齐默认值后的数据。默认配置为：

```ts
const defaults = configSchema.parse({});
// { version: 1, no_proxy: [] }
```

`proxy` 不使用虚构的默认地址，也不把环境变量中的值写回文件。

## 命令接口

```sh
# 查看已保存的配置及内置默认值，以 TOML 展示
agent-helper config

# 设置默认安装代理
agent-helper config set proxy=http://127.0.0.1:7890

# 数组在命令中用逗号分隔，文件中保存为 TOML 数组
agent-helper config set no_proxy=localhost,127.0.0.1,::1

# 同时设置多个字段，全部验证通过后才写入
agent-helper config set proxy=http://127.0.0.1:7890 no_proxy=localhost,127.0.0.1

# 删除代理配置，恢复继承安装工具原有配置
agent-helper config unset proxy

# 删除绕过规则，恢复内置默认空数组
agent-helper config unset no_proxy
```

可写配置键由 `configKeySchema` 限定为 `proxy` 和 `no_proxy`。每个赋值只按第一个等号拆分；代理密码中的等号会保留。重复键、未知键、空值及无效类型会报错。`no_proxy` 要求至少一个条目，需要恢复默认空数组时使用 `unset`。写入前校验修改后的整份配置，而不只是当前字段。`config --help` 列出配置路径、键类型和示例。

`config` 展示配置文件中的值及内置默认值，不将安装工具或当前环境中的代理误标成已保存配置。代理认证信息必须脱敏，包括用户名与密码；`--json` 等将来新增的展示方式也遵循此规则。

## 安装时的解析规则

代理只作用于安装/更新子进程，不自动判断国内或国外。是否配置 `proxy` 由用户决定，默认代理是否应用由各 agent 的安装器声明。选择顺序为：

1. 本次安装命令显式指定的 `--proxy`。
2. 仅当目标安装器的 `useDefaultProxy` 为 `true` 时，使用配置文件中的 `proxy`。
3. 安装工具本来的配置和环境变量；由安装工具自行解释其优先级。

当前 Codex 的 `useDefaultProxy = true`；DSH CLI 和工具自身更新默认不套用 helper 保存的代理。后续接入 Claude Code / OpenClaw 安装器时，沿用默认使用保存代理的策略；它们目前尚不支持安装/更新。显式 `--proxy` 对所有已支持目标生效。

前两项命中时，为本次子进程设置对应代理参数和环境变量，不修改系统或安装工具的全局配置。非空 `no_proxy` 明确替换继承的绕过规则；空数组保留原有设置。没有选择 helper 代理时，不单独应用其 `no_proxy`，也不清除 npm/终端已有的代理。

当前安装器仅支持 npm：`no_proxy` 转换为逗号分隔的 `NO_PROXY` / `no_proxy` 和 `npm_config_noproxy`，具体规则的匹配行为由 npm 决定。模型验证非空、无逗号的条目，不宣称各种工具对通配符或 CIDR 的语义一致。首版代理 URL 仅支持 HTTP/HTTPS。

## 读写要求

- 文件不存在时返回内置默认值；只查看配置不会创建目录或文件。
- 第一次 `set` 才创建目录与配置文件，写入 `version = 1`。
- 文件存在但 TOML 语法或数据校验失败时，报告文件位置和字段错误，停止修改，不覆盖原文件。
- 错误信息和展示结果对代理 URL 中的账号与密码脱敏。文件保存真实 URL，初次创建使用当前用户私有权限（POSIX 为目录 0700、文件 0600；Windows 实际访问权限由系统 ACL 决定）。
- `set` / `unset` 根据 TOML AST 的范围修改目标值，保留注释、字段顺序和换行风格；多行数组内的注释也保留。`config` 输出的是经过脱敏并补齐默认值的 TOML，不复刻原文件排版。
- 使用独占 `.lock` 文件协调 helper 写入，在同目录写临时文件并原子替换；写入前检查原文是否变化。锁文件存在时停止操作；若进程异常退出留下锁，确认没有写入进程后可手工删除锁文件。外部编辑器不参与 helper 的锁，原文检查不能彻底消除所有外部写入竞态。
- 配置文件为符号链接时允许读取，但拒绝通过 helper 修改，提示直接编辑目标文件。
- 未知字段、未知版本的文件可以由用户手动维护，但当前版本拒绝修改，保留原文。

文件格式版本与 npm 包版本分开维护。后续确有需求时，再为安装器参数或 agent 专属配置添加 TOML 分组及迁移规则。
