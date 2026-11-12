# Changelog

## 0.2.0

- 实现 `config`、`config set key=value`、`config unset`，使用用户级 TOML 文件，保留注释并校验整份配置。
- 实现经默认代理安装/更新 npm Codex，支持临时代理、预览和重新安装。
- 实现 `update` 默认更新工具自身，以及 `--self`、`--agent codex`、`--all-agents` 互斥目标。
- 检查 npm 全局安装来源和 prefix，拒绝覆盖其他渠道或 `npm link` 安装。
- 增加配置、安装执行及真实 npm 本地代理集成测试。

## 0.1.1

- 定义 `~/.ai-agent-helper/config.toml` 的配置数据模型：`version`、`proxy`、`no_proxy`。
- 导出配置相关 Zod schemas 和 TypeScript 类型。
- 增加配置设计文档、带注释的 TOML 示例及模型校验测试。
- npm 包包含配置设计文档和示例。

本版本只增加配置模型，尚未实现配置文件读写、`config` / `install` 命令或代理安装。

## 0.1.0

- 检测 PATH 中的六种 AI agent CLI，每种 agent 使用独立检测模块。
- 提供 `list`、`--all`、`--json`、帮助和版本信息。
