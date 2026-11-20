# ai-agent-helper

使用 TypeScript 和 Zod 开发的 AI agent CLI 管理工具。检测本机 PATH 中的 agent，管理 TOML 配置，安装或更新 Codex、DeepSeek Harness CLI，也支持更新工具自身。

主要入口为 `agent-helper <目标> [操作]`。已发布的 `install <目标>` 和 `update --agent <目标>` 继续可用。

`0.4.1` 起，所有实际更新先比较当前版本与服务端版本，相同则提示并跳过；同时修复 WinGet 默认更新触发代理参数管理员限制的问题。

需要 Node.js **22.13 或更高版本**。

## 安装与使用

```sh
npm install -g ai-agent-helper --registry=https://registry.npmjs.org/
agent-helper --help
agent-helper list
```

也可使用 `ai-agent-helper` 命令，参数与 `agent-helper` 相同。例如直接运行 `ai-agent-helper install` 选择要安装的 agent。

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
agent-helper codex --json
agent-helper codex config
agent-helper codex models
agent-helper dsh
agent-helper chatgpt-desktop update --dry-run
agent-helper install
agent-helper codex install --dry-run
agent-helper codex install
agent-helper dsh install --dry-run
agent-helper dsh install
agent-helper dsh-desktop install
agent-helper chatgpt-desktop install
agent-helper update --dry-run
agent-helper update --self
agent-helper codex update
agent-helper dsh update
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

## 检测范围

| Agent | 命令 | 独立检测模块 |
| --- | --- | --- |
| Claude Code | `claude` | `src/agents/claude-code.ts` |
| Codex | `codex` | `src/agents/codex.ts` |
| Gemini CLI | `gemini` | `src/agents/gemini.ts` |
| OpenCode | `opencode` | `src/agents/opencode.ts` |
| Aider | `aider` | `src/agents/aider.ts` |
| GitHub Copilot | `copilot` | `src/agents/github-copilot.ts` |
| DeepSeek Harness | `dsh` | `src/agents/dsh.ts` |

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

## Codex 诊断与桌面更新

- `agent-helper codex` 显示终端 CLI、Windows ChatGPT Desktop 应用包和内置 Codex 的版本，支持 `--json`。
- `agent-helper codex config` 在 `CODEX_HOME`（默认 `~/.codex`）中选择 `config.toml` 或 `*.config.toml`，显示提供商、`requires_openai_auth`、登录与系统代理设置，以及模型列表。备用文件缺省的限制会从同目录的主配置逐项读取。
- `agent-helper codex models` 读取主配置，展示当前模型、模型列表与来源（提供商接口、CLI 目录或指定的本地文件）。
- `agent-helper codex update` 使用显式或已保存的代理运行 `codex update`。缺少可连接的代理时提示输入，取消即退出。批量更新可通过 `--proxy` 或保存的配置提供代理。
- `agent-helper chatgpt-desktop update` 使用 Windows WinGet 的 Microsoft Store 精确包 ID，默认先试直连，失败后再使用代理。以上更新都支持 `--dry-run`。
- ChatGPT Desktop 未指定代理时使用 WinGet / Windows 原有网络设置，不传 `--no-proxy`，因此不需要启用 `ProxyCommandLineOptions`。确实需要 `--proxy` 时，若 WinGet 提示此功能被禁用，可由管理员运行 `winget settings --enable ProxyCommandLineOptions` 后重试。helper 不自动更改此管理员设置。
- 所有实际更新（Codex、DSH、ChatGPT Desktop、helper 自身及批量更新）在执行更新程序前，先显示当前版本和服务端版本。版本一致时提示并跳过；本地版本更高时保留当前版本，避免降级。版本无法识别或服务端查询失败时报错并停止更新。
- Codex 对照 GitHub 官方最新稳定发布；DSH 和 helper 对照 npm 官方 registry 的 `latest`。ChatGPT Desktop 对照 Microsoft Store 官方产品目录中适用于本机架构和 Windows 版本的应用包版本，按四段数字比较，不使用 WinGet 清单中的 `Unknown` 判断是否最新。
- `--dry-run` 只预览本地计划，不联网查询服务端版本，也不执行更新；不会在预览中宣称版本已一致。
- 新输入的更新代理保存到 helper 的 TOML。helper 尚未设置代理时，可复用原 `check-codex/update-proxy.json` 中的地址，并在连接成功后迁入。`--proxy` 只作用于本次命令。

## 配置与代理

配置文件为 `~/.ai-agent-helper/config.toml`，采用 TOML。`config` 查看配置与默认值；`config set key=value` 可以一次设置多项，只按首个等号分割。修改保留注释、字段顺序和换行风格，写入前校验整份配置，失败不覆盖文件。

```toml
version = 1
proxy = "http://127.0.0.1:7890"
no_proxy = ["localhost", "127.0.0.1", "::1"]
```

可写项为 `proxy` 和 `no_proxy`；版本字段由工具维护。CLI 中的 `no_proxy` 使用逗号分隔，保存后为 TOML 数组。删除字段使用 `config unset`，空字符串不会当成删除。`config` 展示代理时隐藏账号和密码；文件仍保存实际配置值。

代理按 agent 选择：Codex 默认使用配置文件中的 `proxy`，DSH 和工具自身默认沿用 npm/终端原有网络设置。`--proxy` 可为任意受支持的目标临时指定代理。npm 安装和 DSH 更新在未选择 helper 代理时沿用终端设置。

工具不通过 IP 自动判断国内或国外；需要代理时由用户配置 `proxy`。后续接入 Claude Code、OpenClaw 安装器时，也采用默认使用保存代理的策略；它们目前尚未接入安装/更新。代理及绕过规则只注入本次子进程，不修改系统代理或全局 npm 配置。

详细约定见 [配置功能文档](docs/configuration.md)，带注释的示例见 [config.toml](examples/config.toml)。也提供配置模型、`readConfig`、`writeConfig`、`parseAssignments` 等 TypeScript API。

## 安装与更新

- `install` 不指定 agent 时显示选择菜单，使用 **↑/↓ 方向键选择、回车确认**；可选择“取消安装”，或按 Esc / Ctrl+C 取消。选择时保留 `--proxy`、`--dry-run`、`--reinstall` 等选项。脚本或其他非交互环境需要显式指定 agent。
- `install codex` 安装 `@openai/codex`；`install dsh` 安装 `@deepseek-ai/dsh`。已安装时跳过，`--reinstall` 可重装普通 npm 全局安装。
- 菜单也提供 DSH 桌面版和 ChatGPT 桌面版；`install dsh-desktop` / `install chatgpt-desktop` 仅输出官方安装页面地址，由用户在页面中选择适用版本。页面分别为 [DeepSeek 官方下载页](https://www.deepseek.com/download/) 和 [OpenAI Docs 的 ChatGPT 桌面版安装页](https://learn.chatgpt.com/docs/app)。
- `update` 默认等同于 `update --self`，更新 npm 包 `ai-agent-helper`。
- `update --agent codex` / `update --agent dsh` 更新单个 CLI；`update --all-agents` 逐个更新 PATH 中已检测到且当前支持的 CLI，某项失败后继续其余项，最后汇总并返回非零退出码。
- `--self`、`--agent`、`--all-agents` 互斥。其他 agent 保留检测功能，暂不支持安装/更新。
- npm 安装和 DSH、helper 自身更新通过 npm 官方 registry 查询 `latest`，然后安装查询到的确切版本，保留当前 npm 的全局 prefix；更新不会自动降级。
- npm 安装器仅管理当前 npm 全局目录中的普通安装。遇到源码、`npm link`、临时 `npx`、其他 prefix 或其他渠道的安装时，实际更新会报错并提示原安装方式，防止写入另一个位置。
- `--dry-run` 仅检查本地 npm 目录、已有版本和安装来源，展示计划；不联网查询版本，不执行安装。对于不适用的安装来源会展示原因。
- 实际安装前查询目标版本的 `engines.node` 并检查当前 Node.js；同时启用 npm 的 `--engine-strict` 校验依赖运行要求。DSH CLI 当前要求 Node.js ≥24.9.0；helper 自身仍支持 Node.js ≥22.13.0。
- 安装完成后验证包版本和命令入口，不启动 agent、不测试登录。首次安装如果命令目录尚未在 PATH 中，会提示检查 PATH 并重新打开终端。

DSH 支持的是 [DeepSeek Harness 官方 npm CLI](https://github.com/deepseek-ai/deepseek-harness#run-from-npm)，包名为 `@deepseek-ai/dsh`，CLI 可通过 `dsh web` 启动 Web 界面。它与桌面版是不同安装来源；`list` 能检测 PATH 中桌面版提供的 `dsh` 命令，但 helper 只更新当前 npm 全局目录中的 CLI。如果 PATH 命中桌面版入口，安装会跳过，更新/强制重装会提示使用原安装方式，避免覆盖桌面版或产生重复安装。

Codex 的 npm 安装方式见 [OpenAI 官方 CLI 文档](https://developers.openai.com/codex/cli#npm)。

## 开发与扩展

```sh
npm run dev -- list --all
npm run check
npm pack
```

每种 agent 在 `src/agents/` 中独立实现 `AgentProvider.detect()`，在 `src/agents/index.ts` 注册。当前共用 `src/detection/find-executable.ts` 的 PATH 查找能力；以后可在各自模块内添加专用安装路径或其他识别逻辑，不必修改 CLI。

`src/list-agents.ts` 负责检测汇总，`src/config/` 负责配置，`src/installation/` 负责 npm 安装与更新，`src/proxy/` 负责子进程代理环境，`src/cli.ts` 负责命令分发。每种 agent 的 npm 包、命令入口和默认代理策略定义在其独立模块中；CLI 支持范围由安装器注册信息生成。

测试覆盖 CLI、配置注释保留、原子写入、更新目标互斥、安装来源、Node 版本和代理策略。代理集成测试使用真实 npm、本地 HTTP 测试代理及隔离目录中的 Codex / DSH 测试包，验证查询、下载、安装和升级；不安装或启动真实 agent。平台专属用例只在对应平台执行。
