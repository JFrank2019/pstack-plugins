# 运行报告:pstack 双版本(DSH + Codex)收敛维护

本报告汇总整次执行的结果、探测与提示词不一致之处、关键决策和遗留项。逐条决策与证据在同目录的 TSV 里:

- `consolidation.tsv`:迁入本仓库、同步、发布、清理(阶段 0、1、2、4、5、6),以及历史重建和收尾(`h`、`i` 开头的行)。
- `codex-port.tsv`:Codex 版移植,含用源码和实机测得的 Codex 事实(阶段 3)。
- `pstack-port.tsv`:迁入前 DSH 版的移植与两次同步记录。

## 历史重建

写完这份报告之后,仓库的 git 历史被重建为 4 个提交,按工具、DSH 版、Codex 版、文档与审计记录划分,并用 force push 推送。重建前后的文件树相同,只改了本文件和 `consolidation.tsv`。下文和 `.audit/` 里出现的旧提交哈希指重建前的历史,在当前仓库里已不存在。重建过程见 `consolidation.tsv` 的 `h0-frame` 到 `h5-docs` 行,之后的收尾见 `i0-authorize` 到 `i9-publish` 行。重建前的完整备份已按你的要求删除,本地旧对象也已清理,旧历史不再能还原。

## 结论

- `pstack/`(DSH)和 `codex/`(Codex)两个包都同步到上游 `cursor/plugins` 的 `23ab063af02b`(pstack 0.15.36)。版本分别是 `0.15.36-dsh.1` 和 `0.15.36-codex.1`。
- `sync-pstack` 支持 `--target dsh|codex`,两个目标的状态、转换规则、验证脚本各自独立,测试全绿。
- 私有仓库 <https://github.com/JFrank2019/pstack-plugins> 已创建,`main` 已首次推送(未使用 force),当时远端 HEAD 等于本地 HEAD。
- 本地旧目录 `/Users/frankyang/Desktop/workspace/dsh-plugins` 已删除。
- 旧 GitHub 仓库 `JFrank2019/dsh-plugins` 已不存在。运行当时因 `gh` 令牌缺 `delete_repo` scope 没能删除。2026-10-29 复查时 `gh api repos/JFrank2019/dsh-plugins` 返回 404,令牌 scopes 没有变化,所以不是这次运行删的,推断是在网页上手动删除的(`i2-old-repo`)。

## 完成定义逐项对照

| # | 要求 | 状态 | 证据 |
|---|---|---|---|
| 1 | 仓库含 dsh 与 codex 两个包,均在最新上游 | 达成 | 联网 `sync.mjs status` 两个目标均为 `up to date`,`synced 23ab063af02b` 等于 `upstream 23ab063af02b`;两个 `lock.json` 的 `synced.commit` 相同;`git ls-remote https://github.com/cursor/plugins.git HEAD` 同为 `23ab063af02b` |
| 2 | `sync-pstack` 对两个目标可用,测试全绿 | 达成 | `node --test` 49 通过 0 失败;`sync.mjs check` 两个目标均 `check passed (0 warnings)`;`verify-dsh` 12/12;`verify-codex` 20/20(codex-cli 0.162.1);两个包内 `bun test watch-pr check-plan.test.ts` 各 61 通过(历史重建后在远端新克隆里重跑,仍各 61,见 `i1-bun-rerun`) |
| 3 | 创建并推送 `JFrank2019/pstack-plugins` | 达成 | `gh repo view` 返回私有仓库、默认分支 `main`;`git ls-remote origin refs/heads/main` 当时等于本地 `main`;首次推送未使用 force |
| 4 | 旧 remote 与本地目录已删除(或记录权限阻塞) | 达成 | 本地目录已删除,旧仓库 `origin` 已移除,新仓库只指向新 `origin`;旧 GitHub 仓库当时因缺 `delete_repo` 保留,2026-10-29 复查时已不存在(`gh api repos/JFrank2019/dsh-plugins` 返回 404,`git ls-remote` 报 Repository not found) |
| 5 | README 与文档同真实结构一致 | 达成 | 脚本核对 README 涉及的 23 个路径,全部存在;README 中的两个版本号等于 `pstack/package.json`、`codex/plugin.json`;marketplace 名 `pstack-plugins`、插件名 `pstack` 与 `codex plugin add pstack@pstack-plugins` 一致;`verify-codex` 真实安装该市场通过 |
| 6 | `.audit/` 有逐阶段决策与证据,并提交最终 `RUN-REPORT.md` | 达成 | 三个 TSV 加本文件 |

终验在历史重建前的最后一个提交上进行。此后只追加了 Phase 6 的审计行和本报告,代码与规则没有变化。

## 分阶段结果

| 阶段 | 结果 |
|---|---|
| 0 基线 | 探测锚点全部一致;用 `git clone --no-hardlinks` 迁入旧仓库并立刻移除 `origin`,3 个历史提交哈希不变 |
| 1 迁移与 README | README 改为双包结构;迁入后的工具在新路径下测试通过 |
| 2 dsh 同步到 0.15.34 | `check` 通过,`verify-dsh` 12/12 |
| 3 Codex 版移植 | 先用 Node 写的 mock Responses 服务和一次性 `CODEX_HOME` 实测 Codex 能力,再泛化引擎、写 `rules.codex.json`、机械转换 599 个文件、语义适配、清零残留检查,最后写 `verify-codex` 和 `codex/README.md` |
| 4 双目标工具与再同步 | `sync.mjs` 双目标化;两个包同步到 0.15.36;清理失效规则并对齐文档 |
| 5 发布 | 私有仓库创建,`main` 首次推送,无 force |
| 6 清理 | 门禁全部通过后:移除旧 remote、删除本地旧目录;删除旧 GitHub 仓库当时被权限挡住,后来该仓库已不存在(见「结论」) |

## 探测与提示词不一致之处(以探测为准)

- `gh` 令牌 scopes 是 `admin:public_key`、`gist`、`read:org`、`repo`,没有 `delete_repo`(`p0-diff`)。
- `verify-dsh` 现在有 12 项检查而不是 10 项,按「全部通过」判定(`p2-diff`)。
- 上游在执行途中从 0.15.34 前进到 0.15.36。先让 Codex 版以 0.15.34 完成移植,使两个目标共用同一基线,再用做好的双目标工具把两个包一起同步到最新(`p3e-upstream-moved`)。

## 关键决策

- **布局**:`pstack/` 保持原路径,新增 `codex/`,同步技能仍在 `.agents/skills/sync-pstack/`。
- **引擎泛化而不是复制**:目标由技能目录里的 `rules.<target>.json` 决定,状态放 `.upstream/<state>/`,替换规则支持正则和 `{skills}` 占位符,清单版本后缀可配。
- **Codex 能力以实测为准**:技能发现路径、沙箱、`spawn_agent` V1 与 V2 的差异、`AGENTS.md` 注入、插件安装方式都由源码和实机运行得出,写在 `codex-port.tsv`。
- **语义适配**:委派给多个子代理按互不重叠的文件范围处理,之后逐个 diff 审阅。审阅发现 4 处 Bugbot 提法被改写,与 `references/codex.md` 的「保留所有 Bugbot 提法」冲突,已恢复。
- **上游新语义**:interrogate、orchestrate 重写和删除 `orch` 脚本、arena 跨模型评审不得用父模型、子代理路由被拒后的回退规则,均按目标分别移植。dsh 的 7 个冲突和 codex 的 8 个冲突都按语义逐个解决,没有整体取任一侧。
- **Codex 默认配置下 arena 不跑跨模型评审**:默认池只有 `inherit-parent`,新规则要求评审模型不同于父模型,所以跳过并说明,不伪造模型。要启用,在 `$CODEX_HOME/AGENTS.md` 的 `arena cross-judge pool` 行写入另一个模型。
- **保留旧名的缓存**:`~/.cache/dsh-plugins-sync` 和环境变量 `DSH_PLUGINS_SYNC_CACHE` 沿用旧名,为避免重新下载约 500 MB 的缓存。
- **两个包与两份 `base` 之间的相近文件不去重**:整棵树 2304 个路径只对应 689 个不同的 blob,git 对相同内容只存一份,仓库体积不受影响。`.upstream/<包>/base` 是同步工具三方合并的基线(`.agents/skills/sync-pstack/scripts/lib/merge.mjs` 的 `mergeText`,`sync finish` 把待定快照升为 base),去掉它下一次同步就没有合并依据(`i5-base-dup`)。

## 过程中的事故与修正

- `p1-mistake`:第一次 `sync status` 把 `DSH_PLUGINS_SYNC_CACHE` 设成了空字符串,引擎把空值当作已设置,在仓库根克隆出裸仓库 `e01985c01786.git`。已删除,未提交。引擎对空值的硬化没有做。
- `p4-env-incident`:一条探测命令把 `HOME` 导出到临时目录且没有恢复。已恢复 `HOME`,删除约 797 MB 临时目录,并重写了这段时间内唯一的本地提交(树和日期不变,作者改回已配置身份),全部发生在首次推送之前。之后探测一律用子 shell 或环境变量前缀。
- Phase 3d 遗留的 Bugbot 提法偏差,在 Phase 4 发现并修复(`p4-codex-fix-bugbot`)。

## 遗留项

1. **旧 GitHub 仓库 `JFrank2019/dsh-plugins` 已不存在,这一项已解决。** 它删除前是私有的,0 fork、0 star、0 issue 和 PR、0 release、0 tag,只有 `main`(取自 2026-10-28 的检查)。它的最终内容在新仓库里。它的 3 个提交(含 0.15.20 和 0.15.28 的版本)没有被历史重建收录,重建前的备份又已按你的要求删除,所以在我知道的位置(旧 GitHub 仓库、备份、本地对象库)里都不再有它们的副本。
2. 删除旧目录前,有 4 个你自己 10 月 25 日起运行的进程以它为工作目录(`zcode-cli`、`cursor-agent` 和它的 sequential-thinking MCP 服务)。它们仍在运行,但工作目录已不存在,新会话请在 `pstack-plugins` 里打开。
3. `~/.codex/.codex-global-state.json`(及 `.bak`)和 `~/.config/magpie/routing/2026-10-28.jsonl` 里还有旧路径字符串。它们是应用状态和日志,我没有读取内容也没有改动;如果 Codex 应用的最近工作区里还显示旧路径,手动移除即可。`~/.dsh` 没有引用旧路径。
4. 新仓库是私有的,所以从 GitHub 安装 Codex 插件或 DSH 包时需要 git 凭据;本地路径安装不受影响。
5. 两个包里 `bun install` 生成的 `node_modules` 已被 `.gitignore` 忽略,验证后已删除。
