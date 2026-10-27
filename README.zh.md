# dsh-plugin-harness-of-harness

[English](README.md) | 中文

**为 DeepSeek Harness 提供 Harness of Harness 模式。**

这个插件给 DSH 加了一个 *Harness of Harness* 预设（agent preset）——一个可选择的会话模式，
该模式的会话自己运行 Planner → Developer → QA Tester 持续开发循环；同时提供一个 Web 面板，
实时展示同一批运行。

它是对
[Harness-of-Harness](https://github.com/Flesymeb/HarnessOfHarness)
（[论文](https://arxiv.org/abs/2609.01481)）所述工作流的一次原生实现：同一个项目工作区跑很多轮迭代，
把产物和证据包一轮轮传下去，于是项目一循环一循环地变好。

## 两个入口，同一个运行引擎

一次运行不论从哪发起都是同一个对象，区别只在于谁来驱动：

| 入口 | 谁来发起运行 | 方式 |
|---|---|---|
| **Harness of Harness 预设** | 会话自己的 agent | `hoh_start` 工具 |
| **Harness of Harness 面板** | 人 | 面板上的启动按钮 |

不论哪种方式，面板都跟踪这次运行；三个角色都作为该会话的全新 DSH 子代理被委派出去。

## 选择 HoH 模式

在会话的预设选择器里选 **Harness of Harness**（对话标题栏的 `agent-preset` 控件）。这个预设提供：

- 一段**人格（persona）**，说明这个模式：三个角色、它们的顺序与权限，以及
  「agent 拥有的是循环本身、而不是角色本身」这条规则；
- 下面那组**模式工具**；
- 一整套**完整工作工具集**——shell、文件、检索、技能、后台任务、目标、待办、网络、上下文压缩与委派——
  因为三个被委派的角色会继承这个预设，它们必须真的能开发和测试软件。

没有选择该预设的会话完全看不到这些模式工具；门槛由 DSH 的预设作用域实现，而不是运行时的判断。

## 模式工具

| 工具 | 作用 |
|---|---|
| `hoh_start` | 为本会话启动一次运行：需求文本、可选的项目目录、可选的迭代次数。返回运行 id、运行记录目录，以及第一轮的状态。运行在后台继续。 |
| `hoh_status` | 本会话的运行：状态、正在进行的那一轮里每个角色的回合与收尾小结、已完成的轮次，以及运行记录目录。 |
| `hoh_stop` | 取消正在运行的角色，并跳过剩余轮次。 |

所以在 HoH 模式里，通常的请求是一句话而不是一串工具调用：*「做 X，跑五轮」*——
agent 会调用 `hoh_start`，然后逐轮报告结果。

## 一轮迭代做什么

| 顺序 | 角色 | 权限 | 产出 |
|---|---|---|---|
| 1 | **Project Planner（规划者）** | 只读 | `iteration-<n>/plan.md` —— 排好优先级的开发文档 |
| 2 | **Developer（开发者）** | 可读写 | 项目本身 |
| 3 | **QA Tester（测试者）** | 只读 | `iteration-<n>/evidence.md` —— 已验证的行为与未解决的缺口 |

每个角色都是**发起这次运行的那个会话的一个全新 DSH 子代理**，因此这些子会话会出现在该会话的
子代理列表里，也能像其他委派一样被中断。下一轮的 Planner 会读到上一轮的开发文档和证据包，
这正是「持续改进」而不是重复劳动的关键。

QA Tester 之后，循环可以在**同一轮内修复**：Tester 提交结构化判定（`passed`、`verified`、`gaps`），
默认的 `repair-then-next` 策略会把「未被接受」的判定连同缺口交回 Developer 修复，最多 `maxInnerRepairs` 轮，
然后才结束这一轮；`next-loop` 策略则把缺口留给下一轮的 Planner。

接受条件要求 `passed: true` **且**没有 `blocker` 级缺口——因为判定可能自相矛盾，真实运行中就出现过一次。
非阻塞缺口（严重度沿用上游的 `blocker`/`high`/`medium`/`low`）只记为打磨项，不触发同轮修复。

Planner 与 QA Tester 被委派在第二个预设 **HoH role · read-only** 下，它的文件工具没有写入和编辑；
Developer 保持会话自己的预设，因为它必须改动产物。

## 面板

面板既是监视器，也是人进入的入口。它表现为右侧边栏标签页选择器里的 **Harness of Harness** 标签页，
以及对话标题栏的 **HoH** 按钮。

- 还没有运行时，它收集**目标与需求文本**、**项目目录**和**迭代次数**，然后启动循环；
- 有运行在进行时，它跟踪当前这一轮的三位角色，显示已用时间、被委派的子会话 id、每个角色的
  收尾小结，以及实时运行日志；
- 运行结束后，它保留完整的迭代历史和每一个产物路径。

启动会立即返回。各角色在后台运行，运行期间面板轮询 Host。

## 运行记录写在哪里

默认情况下，一次运行把记录写进它正在开发的那个项目里：

```
<项目>/.hoh/runs/<run-id>/
  run.json                        # 整次运行：状态、历史、日志
  runtime_receipt.json            # 确定性主机的角色事件收据，每个角色回合后重写
  reproducibility.json            # 版本、git 版本、角色绑定、配置哈希
  iteration-1/
    plan.md                       # Project Planner 的开发文档
    evidence.md                   # QA Tester 写下的证据
    evidence.json                 # QA Tester 的结构化判定，每个回合一条
    iteration.json                # 每个角色的状态、耗时、子会话 id
  iteration-2/ …
```

把 `stateDir` 配置项设上，就可以把运行记录放到别处。运行不会复用已有记录的目录。

## 配置

profile 在 `dsh.profile.bundles` 里选择这个 bundle；在自己的 `cordis.patch.yml` 里可以覆盖任何字段：

```yaml
- id: hoh-harness-of-harness
  config:
    defaultIterations: 5
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `showPanel` | `true` | 是否暴露右侧边栏标签页和标题栏按钮。设为 `false` 时面板的路由也不会注册；预设与它的工具仍然可用。 |
| `stateDir` | `''` | 存放运行记录的目录。留空则放在 `<项目>/.hoh/runs`。 |
| `defaultIterations` | `3` | 面板默认给出、且 `hoh_start` 未指定时采用的迭代次数（1–50）。 |
| `phaseTimeoutSeconds` | `3600` | 单个角色一轮的墙钟上限；`0` 表示不设上限。 |
| `childMaxDepth` | `0` | 额外授予三个角色子代理的委派层数，即角色自己还能再往下派几层。`0` 让一轮迭代恰好只有三个角色。传给子代理服务的绝对 `maxDepth` 是这个值加上角色子代理自身的深度（通常是 `1`），所以 `0` 得到的是上限 `1`，绝不会是 `0`。 |
| `testerPolicy` | `repair-then-next` | `repair-then-next` 把失败的 QA 判定在同一轮内交回 Developer；`next-loop` 把缺口留给下一轮 Planner。 |
| `maxInnerRepairs` | `2` | `repair-then-next` 下同轮 Developer 修复次数上限（0–5）。 |
| `enforceRolePresets` | `true` | 把只读角色委派在 `hoh-readonly` 预设下。只在该预设未挂载时才关掉。 |

预设本身是 [`cordis.patch.yml`](cordis.patch.yml) 里的 `preset-harness-of-harness` 行；
覆盖那一行即可改变这个模式的能力集。

## 要求与限制

- 运行挂在发起它的那个会话之下，因此那个会话必须是活着的。没有它时，Host 会退回到单个根会话。
- 每个角色都继承会话的模型与权限根。只读角色被委派在一个文件工具无法写入的预设下，但 shell 行仍然保留
  （QA Tester 要构建和运行项目），而 shell 能写文件。上游用「工作区只读副本」堵住这一点，
  当前 host 没有向插件提供这种能力——见
  [与上游 HoH 的对齐记录](docs/alignment-with-upstream-hoh.md)。
- 本插件与上游 HoH 的关系——哪些已对齐、哪些优于上游、哪些弱于上游或刻意不做——逐项记录在
  [与上游 HoH 的对齐记录](docs/alignment-with-upstream-hoh.md)。
- HoH 预设的插件清单刻意对齐 DSH 0.2.1-rc.2 内置的 `standard` 预设，但去掉了隔离的 plan-mode 组
  （HoH 通过 Planner 角色来做规划，而 plan mode 的禁写会与 Developer 冲突），也去掉了日程工具。
  若将来某个 DSH 版本改名或移除了其中某个包，这个预设会报出加载诊断，直到本 patch 更新为止。
- Planner 失败会终止整次运行；Developer 或 QA Tester 失败会被记录下来，该轮迭代标记为 `partial`，
  循环继续，好让下一轮的 Planner 能看到这个缺口。
- 循环每轮委派三个角色，除了这些角色自己的行为之外，它自身不访问网络。

## 开发

```sh
npm install
npm run build:client   # 把 client/index.jsx 打包成 lib/client.js
npm run smoke          # 在 Node 里导入 Host 半边并解析预设 patch
npm test               # 用替身驱动真实引擎、面板路由、service 与工具
```

Host 侧由这些模块组成：

| 模块 | 作用 |
|---|---|
| [`index.js`](index.js) | Host 行：构建引擎、提供模式 service、注册面板路由 |
| [`src/engine.js`](src/engine.js) | 循环：迭代、委派、同轮修复、取消 |
| [`src/transitions.js`](src/transitions.js) | 确定性角色状态机：哪个角色可以接在哪个角色之后 |
| [`src/records.js`](src/records.js) | `runtime_receipt.json`、`reproducibility.json` 与它们的指纹 |
| [`src/service.js`](src/service.js) | `hohHarnessOfHarness` service 与面向模型的运行摘要投影 |
| [`tools.js`](tools.js) | 预设作用域行：`hoh_start`、`hoh_status`、`hoh_stop` |

`npm test` 不需要 harness，也不需要任何凭据：它替换了一个遵循文档契约的假 `ctx.subagents`，
覆盖角色顺序、轮次之间的产物传递、取消、Planner 失败、墙钟上限、输入校验、面板 HTTP 接口、
service 契约、工具契约，以及 `tests/alignment.test.mjs` 里的角色状态机、`repair-then-next`、
两份审计记录与只读角色委派。`npm run smoke` 还会**解析** `cordis.patch.yml` 并检查两个预设的各行，
所以 YAML 缩进或引号的失误、以及模式工具的意外丢失，会在本地就失败，而不是等到安装时。

两者都覆盖不到的是：真实 DSH 子代理接受该委派 spec、预设出现在选择器里、以及面板的实际渲染——
这三项都需要活的 harness 和浏览器。

包内布局和一个改动应该通过哪些检查，见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

## 许可证

Apache-2.0。完整文本见 [`LICENSE`](LICENSE)，本项目的上游归属声明见 [`NOTICE`](NOTICE)。

本插件移植的循环与 HoH-lite 实现的是同一套机制，而 HoH-lite 采用 Apache-2.0，
因此本项目沿用同一许可证，而非降级为更弱的许可证。这里没有复制任何 HoH-lite
源文件：上游循环是 Python，本插件是 JavaScript。上游仓库自身的许可划分容易被误读，
值得说明：仓库根目录的论文与演示材料为 MIT（Copyright 2026 Hyoung Yan），
而本插件所移植的 `hoh-lite/` 源码为 Apache-2.0，并带有自己的 notices。