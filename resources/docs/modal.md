# Modal Sandbox connector

状态：真实 Sandbox 基础能力、出站白名单，以及 OpenCode 1.2.27 / SiliconFlow 国际站的 Python 与 TypeScript SDK 完整 Web 旅程均通过。Pi、自定义 Harness 和其他模型组合仍待验证。

## 配置与凭证

Console 新建 Sandbox，提供方选择 Modal。分别输入 Modal Token ID 和 Token Secret，保存后验证、启用。凭证不回填；留空保留原凭证，替换必须输入完整一对。配置变更或凭证替换后必须重新验证。

API 的 `credential` 是 JSON 字符串：`{"token_id":"…","token_secret":"…"}`。这对提供方凭证只由控制面加密保管，不传入 Sandbox、Runtime 或 Harness。GUI/API/SDK 共用已有连接 CRUD 与租户隔离逻辑。

配置：`app` 默认 `hexagon`；`image` 默认 `python:3.12-slim`，当前构建步骤要求 Debian 系 apt；`memory_mb` 默认 2048；`cpu` 默认 2；`region` 可选。镜像追加 Node/npm、curl、git 和 CA 包。首次执行会触发云端镜像构建。共享 App 与镜像缓存不会随单个 Session 删除；Session 关闭只清理对应 Sandbox。

## 工程边界

`integrations/sandboxes/modal.ts` 使用固定版本 `modal@0.11.1`。需要 Node 22 或以上。

- 控制面统一创建/销毁、状态检查、操作 ID 查询与不确定结果恢复。
- 以唯一 operation ID 命名 Sandbox，恢复查询不重建资源；仅供应商明确 NotFound 才当作不存在。
- 文件读写、命令执行、后台 Runtime 启动通过同一个 SandboxConnector。
- 私有预览使用 Connect Token 的服务端 Cookie，保留 Runtime 自身的 Authorization；不创建公共端口。
- 域名出站白名单映射到 Modal 原生参数。
- 主控制面、独立测试 worker 和真实 API 验收脚本均识别 Modal；Harness 与 SDK 不新增供应商分支。

真实创建/查询/销毁、文件读写、命令执行、后台 Runtime、私有预览及域名白名单已通过。各 Harness/模型/SDK 组合以执行矩阵的独立证据为准。

## 历史构建阻塞与后续复验

2026-11-15：实际账号列举 Sandbox 成功；四次镜像构建尝试均返回 `Image build … terminated due to external shut-down`。基础来源包括 Docker Hub 的 Node/Python 镜像与 ECR 的 Python 镜像。读取构建日志只看到基础 `FROM` 步骤，尚不能据此断定是额度、账单、账号策略或平台故障。所有尝试均按 operation ID 查询，确认没有遗留运行 Sandbox。

随后用户登录浏览器，发现原文件凭证属于 `hexagon-maintainer`，浏览器登录的是 `wangyouzhuo1994`。已在后者创建专用凭证并完成真实 Sandbox 和网络验证；原工作区失败原因仍未确定。新凭证保存在 `.local/credentials/modal.json`（0600），测试工具优先级为显式环境变量 → 专用本地文件 → 原桌面文件。没有覆盖原凭证或撤销已有 token。

本地私有证据位于 `.local/evidence/modal-*.json`；[验证记录](../testing/evidence/2026-11-15-modal.md)区分确定性测试和真实供应商测试。

复验命令会创建付费云资源，使用已授权的本地凭证并执行清理：

```sh
npx tsx tooling/smoke-modal.ts
npx tsx tooling/smoke-modal-network.ts
# 基础能力通过后，运行双方 SDK 的真实 Web 旅程：
HEXAGON_SANDBOX=modal HEXAGON_WEB_SMOKE=1 HEXAGON_BOTH_SDKS=1 HEXAGON_MODEL=siliconflow npx tsx tooling/smoke-api.ts
```

测试保留独立本地数据库证据，不能将失败尝试计入产品验收通过。

参考：[Modal JavaScript SDK](https://modal.com/docs/sdk/js/latest)、[Image 接口](https://modal.com/docs/sdk/js/latest/Image)、[Sandbox 网络](https://modal.com/docs/guide/sandbox-networking)。
