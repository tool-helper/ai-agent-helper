# Changelog

## 0.1.1

- 定义 `~/.ai-agent-helper/config.toml` 的配置数据模型：`version`、`proxy`、`no_proxy`。
- 导出配置相关 Zod schemas 和 TypeScript 类型。
- 增加配置设计文档、带注释的 TOML 示例及模型校验测试。
- npm 包包含配置设计文档和示例。

本版本只增加配置模型，尚未实现配置文件读写、`config` / `install` 命令或代理安装。

## 0.1.0

- 检测 PATH 中的六种 AI agent CLI，每种 agent 使用独立检测模块。
- 提供 `list`、`--all`、`--json`、帮助和版本信息。
