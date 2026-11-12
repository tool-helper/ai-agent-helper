# ai-agent-helper

使用 TypeScript 和 Zod 开发的 AI agent CLI 管理工具。检测本机 PATH 中的 agent，管理 TOML 配置，并通过默认代理安装或更新 Codex，也支持更新工具自身。

从 `0.2.0` 起提供 `config`、`install`、`update` 命令；安装和更新 agent 目前先支持 Codex。

需要 Node.js **22.13 或更高版本**。

## 安装与使用

```sh
npm install -g ai-agent-helper --registry=https://registry.npmjs.org/
agent-helper --help
agent-helper list
```

## 从源码运行

```sh
npm install
npm run build
node dist/cli.js --help
node dist/cli.js list
```

需要使用本地源码提供的 `agent-helper` 命令时，可在构建后于项目目录执行 `npm link`。

## 命令

```sh
agent-helper --help
agent-helper -h
agent-helper --version
agent-helper list
agent-helper list --help
agent-helper list --all
agent-helper list --json
agent-helper list --all --json
agent-helper config
agent-helper config set proxy=http://127.0.0.1:7890
agent-helper config set no_proxy=localhost,127.0.0.1,::1
agent-helper config unset proxy
agent-helper install codex --dry-run
agent-helper install codex
agent-helper update --dry-run
agent-helper update --self
agent-helper update --agent codex
agent-helper update --all-agents
```

- 无参数时显示帮助。
- `list` 默认只列出检测到的 agent，输出名称、命令、状态和路径。
- `--all` / `-a` 同时列出未检测到的 agent。
- `--json` 输出纯 JSON 数组；没有检测到时返回 `[]`。
- 正常查询（包括没有检测到）退出码为 `0`；无效参数或检测异常为 `1`，错误写入 stderr。

JSON 示例：

```json
[
  {
    "id": "claude-code",
    "name": "Claude Code",
    "command": "claude",
    "installed": true,
    "path": "/usr/local/bin/claude"
  }
]
```

`--all` 中未检测到的条目使用 `installed: false` 和 `path: null`。

## 首版检测范围

| Agent | 命令 | 独立检测模块 |
| --- | --- | --- |
| Claude Code | `claude` | `src/agents/claude-code.ts` |
| Codex | `codex` | `src/agents/codex.ts` |
| Gemini CLI | `gemini` | `src/agents/gemini.ts` |
| OpenCode | `opencode` | `src/agents/opencode.ts` |
| Aider | `aider` | `src/agents/aider.ts` |
| GitHub Copilot | `copilot` | `src/agents/github-copilot.ts` |

按当前进程的 PATH 顺序查找，只返回首个匹配的可执行入口。Windows 使用 PATHEXT（未设置时使用 `.COM;.EXE;.BAT;.CMD`），支持 npm 的 `.cmd` 入口、大小写不敏感的环境变量名称和带引号的 PATH 目录。macOS/Linux 要求文件有执行权限，支持符号链接。

`installed` 表示找到了对应名称的可执行文件，不保证文件身份、运行正常、版本或登录状态。不会执行 `--version`、读取密钥、联网或加载 shell 配置。PATH 之外的安装、桌面应用、shell alias/function、旧版 `gh copilot` 扩展和未知 agent 不在首版检测范围内。空 PATH 项会跳过；显式的相对 PATH 项相对于当前工作目录解析。

## TypeScript API

```ts
import { listAgents, agentListSchema, type AgentResult } from "ai-agent-helper";

const installed: AgentResult[] = await listAgents();
const all = await listAgents({ includeMissing: true });
agentListSchema.parse(all);
```

包提供 ESM 导出和类型声明。Zod 校验 CLI 选项及检测结果，并约束已检测到条目必须包含路径、未检测到条目的路径必须为 `null`。

## 配置与代理

配置文件为 `~/.ai-agent-helper/config.toml`，采用 TOML。`config` 查看配置与默认值；`config set key=value` 可以一次设置多项，只按首个等号分割。修改保留注释、字段顺序和换行风格，写入前校验整份配置，失败不覆盖文件。

```toml
version = 1
proxy = "http://127.0.0.1:7890"
no_proxy = ["localhost", "127.0.0.1", "::1"]
```

可写项为 `proxy` 和 `no_proxy`；版本字段由工具维护。CLI 中的 `no_proxy` 使用逗号分隔，保存后为 TOML 数组。删除字段使用 `config unset`，空字符串不会当成删除。`config` 展示代理时隐藏账号和密码；文件仍保存实际配置值。

代理优先级为 `--proxy` → 配置文件的 `proxy` → npm 已有配置。代理及绕过规则只注入安装/更新子进程，不改动系统代理或全局 npm 配置。支持 HTTP/HTTPS 代理地址，绕过规则的匹配语义由 npm 决定。

详细约定见 [配置功能文档](docs/configuration.md)，带注释的示例见 [config.toml](examples/config.toml)。也提供配置模型、`readConfig`、`writeConfig`、`parseAssignments` 等 TypeScript API。

## 安装与更新

- `install codex` 安装 npm 包 `@openai/codex`；已安装时跳过，`--reinstall` 可重装普通 npm 全局安装。
- `update` 默认等同于 `update --self`，更新 npm 包 `ai-agent-helper`。
- `update --agent codex` 只更新 Codex；`update --all-agents` 只更新 PATH 中已检测到且当前支持更新的 agent，目前为 Codex。
- `--self`、`--agent`、`--all-agents` 互斥。其他 agent 保留检测功能，暂不支持安装/更新。
- 安装/更新通过 npm 官方 registry 查询 `latest`，然后安装查询到的确切版本，保留当前 npm 的全局 prefix；更新不会自动降级。
- 仅管理当前 npm 全局目录中的普通安装。遇到源码、`npm link`、临时 `npx`、其他 prefix 或其他渠道的安装时，实际更新会报错并提示原安装方式，防止写入另一个位置。
- `--dry-run` 仅检查本地 npm 目录、已有版本和安装来源，展示计划；不联网查询版本，不执行安装。对于不适用的安装来源会展示原因。
- 安装完成后验证目标目录内的包版本和命令入口，不启动 Codex、不测试登录。首次安装如果命令目录尚未在 PATH 中，会提示检查 PATH 并重新打开终端。

Codex 的 npm 安装/更新方式见 [OpenAI 官方 CLI 文档](https://developers.openai.com/codex/cli#npm)。

## 开发与扩展

```sh
npm run dev -- list --all
npm run check
npm pack
```

每种 agent 在 `src/agents/` 中独立实现 `AgentProvider.detect()`，在 `src/agents/index.ts` 注册。当前共用 `src/detection/find-executable.ts` 的 PATH 查找能力；以后可在各自模块内添加专用安装路径或其他识别逻辑，不必修改 CLI。

`src/list-agents.ts` 负责检测汇总，`src/config/` 负责配置，`src/installation/` 负责 npm 安装与更新，`src/proxy/` 负责子进程代理环境，`src/cli.ts` 负责命令分发。Codex 的 npm 包及入口信息定义在独立 agent 模块中。

测试覆盖 CLI、配置注释保留、原子写入、更新目标互斥、安装来源检查及失败验证。代理集成测试使用真实 npm、本地 HTTP 测试代理和隔离全局目录中的测试包，验证元数据及安装包经过代理，并完成安装和升级；不安装真实 Codex。平台专属用例只在对应平台执行。
