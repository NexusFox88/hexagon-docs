# 手动验收入口

从 [GUI → SDK 快速开始](QUICKSTART.md) 进入。不要使用维护者的账号、机器路径、桌面凭证文件或历史测试连接。

本地 Console 自动连接工作区，Python／TypeScript 使用 `Hexagon.local()`，无需复制 owner Token。远程 hosted 模式才显式提供 URL 和凭证。

供应商配置和实际支持范围见 [Sandbox 接入说明](../../docs/sandbox-providers.md)；Harness／模型协议按 [组合契约](../../docs/execution-combinations.md) 判断。历史通过不保证你的配额、网络、镜像权限已经满足。

`run.mjs` 是包含工具授权、审批和 Web 预览的扩展工程验收脚本，不是默认新用户入口。`run.ts`／`run.py` 是受保护 HTTP 与自定义 Python Harness 专项示例；其具体协议和前置连接要求见快速开始的专项部分。普通 Session 直接使用 Playground 生成的代码即可。
