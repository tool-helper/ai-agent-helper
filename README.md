# ai-agent-helper

使用 TypeScript 和 Zod 开发的 AI agent CLI 管理工具。首版 `0.1.0` 仅实现列出本机 PATH 中可找到的 agent，不安装、更新或启动 agent。

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

## 配置功能设计

配置采用 `~/.ai-agent-helper/config.toml`，以 TOML 保存注释和配置分组。当前已提供 `configSchema`、`configKeySchema`、`proxyUrlSchema` 及对应 TypeScript 类型；配置文件读写、`config` 命令和代理安装功能尚未实现。

设计及命令约定见 [配置功能设计](docs/configuration.md)，带注释的文件示例见 [config.toml](examples/config.toml)。初版模型包含配置格式版本 `version`、默认安装代理 `proxy` 和绕过规则 `no_proxy`。

## 开发与扩展

```sh
npm run dev -- list --all
npm run check
npm pack
```

每种 agent 在 `src/agents/` 中独立实现 `AgentProvider.detect()`，在 `src/agents/index.ts` 注册。当前共用 `src/detection/find-executable.ts` 的 PATH 查找能力；以后可在各自模块内添加专用安装路径或其他识别逻辑，不必修改 CLI。

`src/list-agents.ts` 负责汇总和 Zod 校验，`src/cli.ts` 负责参数解析与展示。测试使用临时目录和伪可执行入口，不启动本机 agent；包含 CLI 帮助、错误参数、JSON、PATH 优先级、Windows PATHEXT、POSIX 执行权限等用例。平台专属用例只在对应平台执行。
