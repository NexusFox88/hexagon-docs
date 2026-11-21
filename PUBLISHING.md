# 文档更新与发布 SOP

本文是 Hexagon 文档从本地更新、提交 GitHub，到 Mintlify 上线的唯一发布操作说明。适用于维护者和执行任务的 Agent。

## 1. 发布链路与唯一目标

```text
日常修改：本地 hexagon-docs 工作副本中的 MDX / 配置 / 样式
                                  ↓ 本地检查与预览
                                  ↓ git commit + git push
                     NexusFox88/hexagon-docs · main
                                  ↓ Mintlify GitHub 集成
                          docs.hexagon.autos

可选导入：Hexagon/docs/product 的本地 Markdown
                                  ↓ 显式运行导入脚本并审阅差异
                         回到上述本地检查步骤
```

| 项目 | 当前配置 |
| --- | --- |
| 文档仓库 | [NexusFox88/hexagon-docs](https://github.com/NexusFox88/hexagon-docs) |
| 发布分支 | `main` |
| Mintlify 项目 | `sponson/hexagon` |
| 文档根目录 | 仓库根目录，`docs.json` 不在子目录 |
| 线上地址 | [docs.hexagon.autos](https://docs.hexagon.autos) |
| 发布记录 | [Mintlify Publishes](https://app.mintlify.com/sponson/hexagon/publishes/overview) |
| Git 连接配置 | [Mintlify Git settings](https://app.mintlify.com/sponson/hexagon/settings/project/git-settings) |
| 当前维护机器的工作副本 | `/path/to/hexagon-docs-publishing` |

本地目录可以采用其他名字，判断发布目标以 `git remote get-url origin` 为准。旧目录 `/path/to/hexagon-docs` 指向旧仓库 `NexusFox88/docs`，不要继续在那里发布。产品仓库 `NexusFox88/Hexagon` 的 push 不会自动同步文档到本仓库。

日常发布无需重新设置域名、DNS，也无需手动上传文件到 Mintlify。

## 2. 开始前：确认工作副本和账号

已有工作副本：

```bash
cd /path/to/hexagon-docs-publishing
git remote get-url origin
git branch --show-current
git status --short
```

确认 remote 是 `NexusFox88/hexagon-docs`、当前分支是 `main`。如果工作区已有修改，先确认归属，不覆盖、不重置、不夹带他人的未完成工作。工作区干净后拉取：

```bash
git pull --ff-only origin main
```

新设备可以直接克隆，下面的目录名仅是示例：

```bash
git clone https://github.com/NexusFox88/hexagon-docs.git hexagon-docs-publishing
cd hexagon-docs-publishing
```

需要 Git、Node.js/npm；仅使用产品导入脚本时需要 Python 3。GitHub 账号必须有该仓库写权限，浏览器已登录不代表命令行账号有写权限。

当前维护机器已为这个工作副本配置仓库级 credential helper，使用 GitHub CLI 中已登录且具有仓库写权限的维护者账号。凭据从系统密钥存储读取，不写进 Git；其他设备需要自己的有效授权。

## 3. 在本地更新文档

### 路径 A：直接维护文档仓库，日常默认

| 修改内容 | 修改位置 | 配套动作 |
| --- | --- | --- |
| 英文正文 | `en/**/*.mdx` | 同步检查对应中文页面 |
| 中文正文 | `zh-CN/**/*.mdx` | 同步检查对应英文页面 |
| 新增、移动或删除页面 | MDX 文件及 `docs.json` | 更新导航、目录页、内部链接；旧公开路由按需添加重定向 |
| 导航、品牌、外部链接 | `docs.json` | 验证中英文导航与目标地址 |
| 控件与布局样式 | `style.css` | 保留黑白、等宽 ASCII 控件和直角侧栏，检查浅色/深色 |
| 字体、Logo | `fonts/`、`logo/`、`favicon.svg` | 检查加载效果和许可文件 |
| 引用示例与证据快照 | `resources/` | 核对引用路径及公开适宜性，不把历史证据说成新测试结果 |

`en/`、`zh-CN/` 中的 MDX 是 Mintlify 当前直接读取的正文。可以在这里编辑，不必每次回产品仓库再导入。

文档源码和资源链接使用本仓库；产品源码链接仍使用 `https://github.com/NexusFox88/Hexagon`。不得把产品源码链接统一替换为文档仓库链接。

### 路径 B：从产品本地 Markdown 导入，仅在明确需要时使用

如果本次更新发生在产品仓库的 `docs/product/en/`、`docs/product/zh-CN/`，在文档工作副本内执行：

```bash
python3 tooling/import-product-docs.py /path/to/Hexagon
```

在其他机器上，把参数换成产品仓库的绝对路径。该命令读取当前本地文件，包括未提交的修改，不会从 GitHub 自动拉取产品内容，也不会自动提交或发布。

导入行为：

- 把 Markdown 转为 MDX，处理标题、链接和 MDX 特殊字符。
- 根据两种语言的 `directory.md` 重建导航。
- 重写生成的正文、`docs.json`、Logo、favicon、`.mintignore` 和 `migration-manifest.json`。
- 把直接引用的源码、示例和证据复制到 `resources/`。
- 保留 `style.css` 和 `fonts/`；不自动清理已经从源中删除的旧页面和旧资源。

**导入会覆盖本仓库对同名正文和配置的直接修改。** 运行前先核对两边差异，保存已完成的文档工作；导入后逐项审阅并合并需要保留的修改。不要把导入脚本当作无条件自动同步。需要长期保留的生成配置，应同时修改导入脚本的对应逻辑。

删除、重命名的页面需要手动清理残留并处理重定向。`resources/` 虽不渲染成 Mintlify 页面，仍会公开在 GitHub；导入时应审阅，不能仅依赖脚本对 `.local` 路径的拒绝。

## 4. 检查与本地预览

正文、导航、配置或样式变更执行：

```bash
npx --yes mint@4.3.74 validate
npx --yes mint@4.3.74 broken-links
git diff --check
git diff --stat
git diff
```

`4.3.74` 是迁移时实际验证过的 CLI 版本。升级 CLI 时单独验证，避免一次日常发布被 `latest` 的依赖变化阻断。

排版、导航或交互改变时启动预览：

```bash
npx --yes mint@4.3.74 dev --no-open
```

打开 CLI 输出的地址，审阅本次受影响的页面；涉及样式时检查浅色/深色及中英文，涉及窄屏布局时检查移动端。复用仍然适用的既有证据，不为每篇文章重复跑同一产品旅程。产品功能真实性需要对应产品测试；文档构建通过不能证明产品验收通过。

仅改 `README.md`、`PUBLISHING.md` 或 `AGENTS.md` 时，检查 Markdown、链接、命令与实际配置的一致性及 `git diff --check` 即可；这些文件不参与 Mintlify 渲染，不要求重新构建全站。

进入下一步的条件：相关检查通过，差异符合本次目的，未包含密钥或私有材料，修改内容与证据相符。检查失败应处理原因，不把未运行或失败的检查记录为通过。

## 5. 提交到 GitHub

优先按实际文件路径暂存。仅当全部工作区改动都属于本次发布时，才使用 `git add -A`。

```bash
git add <本次修改的文件路径>
git diff --cached --stat
git diff --cached --check
git diff --cached
git commit -m "Update Hexagon documentation"
git push origin main
git rev-parse HEAD
git status --short
```

`<本次修改的文件路径>` 是占位符，执行时替换为实际路径。记录完整提交哈希，用来匹配 Mintlify 发布记录。

如果 push 被拒绝为 non-fast-forward，先 fetch 并检查远端新增提交，合并或 rebase 后重新执行受影响检查，再推送；不要强推 `main`。如果返回 403，用 `gh auth status` 核对账号与仓库写权限，不打印 token、不把 token 写入 remote URL。

## 6. 验证 Mintlify 上线

对于参与站点构建的文件变更：

1. 打开 [发布记录](https://app.mintlify.com/sponson/hexagon/publishes/overview)。
2. 确认新记录对应本次提交，仓库是 `NexusFox88/hexagon-docs`、分支是 `main`。
3. 等待状态为 `Successful`；失败时检查部署日志并修复，不能仅凭 Git push 成功宣告上线。
4. 打开实际修改的线上路由，验证内容、导航和链接。公共语言入口为 `/en` 和 `/zh-CN`。
5. 样式变更检查对应线上控件；资源迁移检查链接落到正确 GitHub 文件。

如果仍显示旧内容，刷新或使用临时参数 `?version=<提交短哈希>` 排查缓存，以实际页面结果为准。不要把缓存问题当作 DNS 问题反复修改域名。

被 `.mintignore` 排除的文件（包括本 SOP）可能不会产生新部署。仅维护说明更新时，以 GitHub 上对应提交和文件可见为完成判据，不为了制造部署而改动产品正文或样式。

如果构建文件已推送却没有新部署，检查 Git 设置、分支、仓库根目录和 GitHub App 权限；必要时使用 `Manual update` 完成补发。手动补发成功不代表自动触发问题已经解决，需分别记录。

## 7. 完成记录与回滚

每次发布在任务记录或 PR 中记录以下信息即可，不强制增加一篇文章或改动全站：

```text
变更范围：
GitHub 提交：
本地检查及实际结果：
Mintlify：Successful / Failed / 不适用（仅排除文件）
线上检查的路由和结果：
未完成项或限制：
```

需要回滚时：

```bash
git revert <需要撤销的提交哈希>
git push origin main
```

将占位符替换成实际哈希。多个提交的回滚需先核对依赖和顺序。回滚也必须检查新部署及线上页面，不使用 `reset --hard` 配合强推覆盖共享历史。

## 8. 博客与官网边界

`blog/` 继续由 [Haxegon-Website](https://github.com/NexusFox88/Haxegon-Website) 渲染，排除在 Mintlify 构建之外。修改博客前阅读 `blog/README.md`，按独立官网发布流程验证。已有 workflow 仅匹配博客和该 workflow 自身的路径；日常文档变更不应触发官网重建。

本 SOP 的维护入口是本文件；不要在其他目录维护另一份互相矛盾的发布流程。README 与 AGENTS.md 仅链接到这里。
