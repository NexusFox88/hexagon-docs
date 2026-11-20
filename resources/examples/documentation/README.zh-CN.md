# 产品文档示例

这些程序配合[产品文档](../../docs/product/zh-CN/index.md)使用，所有命令从仓库根目录运行。程序通过本地工作区发现控制平面，不是 hosted 地址配置示例。[English](README.md)。

## 选择程序

| 程序 | 用途 | 远端效果 | 本地记录 |
| --- | --- | --- | --- |
| [first-session.py](first-session.py) / [first-session.ts](first-session.ts) | 单任务、核对产物、关闭和再次下载 | 创建 Session/Run，使用云资源和模型；成功路径关闭 | `.local/docs-first-python/` 或 `.local/docs-first-typescript/` |
| [artifact-retention.py](artifact-retention.py) / [artifact-retention.ts](artifact-retention.ts) | 两个精确文件、hash/内容检查及关闭后全部产物再次下载 | 创建 Session/Run，消耗云与模型资源，成功后关闭 | `.local/docs-artifacts-python/` 或 `.local/docs-artifacts-typescript/` |
| [template-revisions.py](template-revisions.py) / [template-revisions.ts](template-revisions.ts) | A/B/C revision 变更、归档与历史快照 | 创建一个模板、三个云 Session/Run，成功后关闭 | `.local/docs-revisions-python/` / `.local/docs-revisions-typescript/` |
| [project-task.py](project-task.py) / [project-task.ts](project-task.ts) | 上传项目、两轮修改、测试、预览、保留导出 | 创建 Session/Run/预览，使用云资源和模型；显式 close 阶段 | `.local/docs-project-python/` 或 `.local/docs-project-typescript/` |
| [inspect-run.py](inspect-run.py) / [inspect-run.ts](inspect-run.ts) | 对已有 ID 做有边界的诊断查询 | 读取已有记录，不修改任务或资源 | JSON 输出到 stdout，不保存事件检查点 |
| [backend-intents.py](backend-intents.py) | 在提交 Run 前保存业务意图，响应丢失后恢复 | 在已有 Session 提交 Run，或查询已保存的 Run | 用 `--database` 指定的私有 SQLite 数据库 |
| [event-checkpoint.py](event-checkpoint.py) | 原子保存事件和游标，演示重启与去重 | 无；直接运行只使用合成事件 | 自动删除的临时 SQLite 数据库 |

两种语言分别运行会创建独立旅程，记录目录也相互独立。Python 通过不能证明 TypeScript 通过，语法或假客户端检查不能证明云任务结果。

## 安装本地 SDK

Python 要求 3.10 及以上，可用专用虚拟环境避免影响其他应用：

```sh
python3 -m venv .local/docs-example-venv
.local/docs-example-venv/bin/python -m pip install -e sdk/python
```

包构建要求 setuptools ≥68，缺少时安装过程可能下载构建依赖。导入名称为 hexagon，分发包名为 hexagon-agent-sdk。下文使用该虚拟环境的 Python。[安装检查](../../testing/evidence/2026-11-20-sdk-installation-docs.json)已在独立临时虚拟环境完成安装、SDK 导入与两个 Python 帮助入口验证。它证明当前机器与检出版本的安装路径，不证明全新机器上的控制平面部署。

TypeScript 示例使用仓库 SDK 构建和已安装的仓库工具：

```sh
npm --prefix sdk/typescript run build
```

示例导入 sdk/typescript/dist/index.js，SDK 修改后需重建。SDK 构建和 ESM 导入也已通过上述检查。这是源码检出示例，不证明 npm/PyPI 已发布，也不证明独立安装后的 TypeScript 包使用。先按[安装指南](../../docs/product/zh-CN/start/install.md)安装仓库依赖、启动本地控制平面。

## 第一个 Session

验证并启用兼容 Sandbox/模型连接，然后设置连接 ID，不要填凭据值：

```sh
export HEXAGON_EXAMPLE_SANDBOX_ID='YOUR_SANDBOX_CONNECTION_ID'
export HEXAGON_EXAMPLE_MODEL_ID='YOUR_MODEL_CONNECTION_ID'
```

选择一种语言：

```sh
.local/docs-example-venv/bin/python examples/documentation/first-session.py
```

```sh
./node_modules/.bin/tsx examples/documentation/first-session.ts
```

执行前阅读[完整教程](../../docs/product/zh-CN/start/first-session.md)。程序创建前保存记录并拒绝覆盖。异常不自动关闭 Session，应保留 ID、调查原任务并按恢复说明确认清理，不能通过删除记录绕过保护。

## 项目任务

使用相同连接变量。下表是需要逐步审阅的阶段，不是一批可以不检查结果就连续执行的命令：

| 阶段 | Python 参数 | TypeScript 参数 | 继续前检查 |
| --- | --- | --- | --- |
| 创建/上传/提交 | project-task.py start | project-task.ts start | 保存 Session/Run ID |
| 观察/导出 | project-task.py observe | project-task.ts observe | 审阅真实测试执行、导出代码与报告 |
| 预览 | project-task.py preview | project-task.ts preview | 打开私有记录中的 URL，检查筛选 |
| 第二轮修改 | project-task.py followup | project-task.ts followup | 再运行 observe，审阅变更和 Reset 交互 |
| 清理 | project-task.py close | project-task.ts close | 确认资源清理、旧预览拒绝和历史留存 |

Python 参数前加 `.local/docs-example-venv/bin/python examples/documentation/`，TypeScript 参数前加 `./node_modules/.bin/tsx examples/documentation/`。例如：

```sh
.local/docs-example-venv/bin/python examples/documentation/project-task.py start
.local/docs-example-venv/bin/python examples/documentation/project-task.py --help
```

TypeScript 项目程序当前只接受阶段，不提供 help flag；没有有效阶段时会输出允许阶段的错误，且不发 API 请求。正常执行使用表格。Python 提供 argparse help。

[项目教程](../../docs/product/zh-CN/start/project-task.md)定义完整顺序和恢复分支。Observe 检查必需导出与固定测试完整性，不证明模型报告真实。[固定测试](filter-app/acceptance.mjs)验证筛选逻辑，不验证第二轮 Reset 按钮，浏览器检查独立执行。初始 fixture 故意失败，也不替代原始产品授权/审批 fixture。

## 诊断已有任务

只读诊断程序不需要连接 ID 环境变量，但需要本地 SDK 工作区身份和已有 Session/Run 对：

```sh
.local/docs-example-venv/bin/python examples/documentation/inspect-run.py --session YOUR_SESSION_ID --run YOUR_RUN_ID --after 0 --max-pages 20
./node_modules/.bin/tsx examples/documentation/inspect-run.ts --session YOUR_SESSION_ID --run YOUR_RUN_ID --after 0 --max-pages 20
```

报告可能包含敏感资源 ID，只能重定向到私有存储；它省略任务/事件/输出文本。页数上限避免诊断无休止运行。空事件页是瞬时观察，不证明完成；其游标不能替代应用持久消费者检查点。

## 持久化后端请求

按[后端接入指南](../../docs/product/zh-CN/build/backend-integration.md)绑定已有 Session、保存意图、提交并查询 Run。使用仍开放的 Session 和上文的 SDK 虚拟环境。数据库保留原始任务输入，需存放在私有目录。CLI 用户 ID 仅演示归属检查，不提供用户身份认证。示例不创建或关闭 Session。

离线检查只需要 Python 标准库：

```sh
python3 -B examples/documentation/check-backend-intents.py
```

检查使用真实临时 SQLite 文件与模拟 SDK，覆盖响应丢失、重启、精确重发、只读查询、归属和输入冲突；不连接 Hexagon，不验证云执行。

## 恢复与验证范围

每份记录同时只由一个进程使用。项目阶段命令持有 process.lock，异常退出后先确认记录的进程已停止，再只移除锁。创建、上传、预览的未知结果需要调查；Run 提交响应丢失应使用已保存的精确输入和键。本地观察超时不会取消服务端执行，预览过期按授权恢复流程处理，不能删除整个记录目录。

证据分开记录：[项目本地检查](../../testing/evidence/2026-11-20-project-docs-local.json)、[诊断假客户端检查](../../testing/evidence/2026-11-20-inspect-run-example.json)、[产品验收账本](../../testing/acceptance.md)。程序存在本身不构成新一轮实云/浏览器通过。确认清理前，实际资源 ID 保留在本地私有证据中。

首个 Session 程序已有[双 SDK 独立实云记录](../../testing/evidence/2026-11-20-first-session-docs-cloud.json)，范围限于记录中的 Vercel/Pi/Messages 精确组合，不验证另一个项目任务或浏览器旅程。

另一个项目任务程序现在也有[双 SDK 实云与浏览器证据](../../testing/evidence/2026-11-20-project-docs-cloud.json)：各两轮、固定测试执行、筛选/Reset 交互和关闭/留存。外部 Tool 授权与审批不属于此 fixture。

## 离线事件持久化与投递

`python3 -B examples/documentation/event-checkpoint.py` 检查 SQLite 事件与游标的事务边界。`node examples/documentation/check-event-delivery.mjs` 使用 [event-delivery.mjs](event-delivery.mjs) 检查应用转发和浏览器侧状态重放。这些是离线示例，不是 HTTP 服务或浏览器验收；[事件指南](../../docs/product/zh-CN/build/stream-events.md)说明数据库适配、认证、背压与刷新恢复要求。

## 两个文件的留存练习

按[产物指南](../../docs/product/zh-CN/build/artifacts.md)运行 `artifact-retention.py` 或 `artifact-retention.ts`，沿用上述连接变量与 SDK 安装。每种语言都有独立私有日志；失败后先调查原 ID 与清理结果，不要直接重跑。两个文件的精确字节检查比首个 Session 教程更严格。

运行 revision 练习前阅读[模板指南](../../docs/product/zh-CN/build/agent-templates.md)；两种语言沿用相同的连接变量与 SDK 安装方式。

运行 `node examples/documentation/event-delivery-server.mjs` 启动本机 SSE 服务与浏览器界面。打开输出地址，断开再恢复，并查询同一个模拟 Run。此入口复用投递 helper，不访问 Hexagon，也不证明云执行。
