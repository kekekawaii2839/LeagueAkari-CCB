# 历史记录归档：截至 2026-09-06 文档整理前

> 只用于追溯，不是当前规范、当前测试结论或操作授权。下方保留原记录全文，包括当时的“当前”“禁止”和 PASS 表述。后继记录可能已经取代它们。
> 现行文档入口：[README](README.md)。后续普通进度仍写 README，不为每个任务建立归档。

---

# Member Analysis 统一进度文档

> 唯一进度记录：本文件  
> 最近更新：2026-09-06  
> 当前结论：**PASS（仅限本地实现验收）**  
> 正式发布：**BLOCKED**

> 当前设计规则：[统一设计规范](design-spec.md)。下方历史设计记录保留原貌，不代表现行要求；本次文档更新不改变已有实现或视觉验收状态。

## 1. 文档维护规则

- 本文件是 `member-analysis` 唯一的进度、验收、维护、上游同步和发布准备记录。
- 普通任务的进度、完成、验收、上游同步和发布准备只在本文件记录，不另建 Markdown 报告。允许新增长期使用且更适合独立维护的 Skill、设计规范、contract 或 runbook。
- 长期非进度类文档各自维护，避免重复定义；当前入口：
  - `design-spec.md`：现行项目设计规范，重点是 UI 风格；
  - `member-analysis-contract.md`：IPC/domain/data contract；
  - `member-analysis-maintenance-runbook.md`：长期维护规则；
  - `release-policy.md`：发布约束；
  - 根目录 `LEAGUE_AKARI_MEMBER_ANALYSIS_TECHNICAL_DESIGN.md`：总体技术设计；
  - `patch-manifest.json`：上游 patch 清单（非 Markdown）。
- 原有 Phase 0～8 报告已完整并入本文件第 7 节，原独立报告文件不再保留。历史数字按发生顺序保存，后继结果不覆盖早期事实。
- 不得把真实玩家/比赛数据、token、日志、缓存、临时数据库或生成数据写入本文件或任何仓库文件。
- 不执行部署、release、commit、push 或 PR，除非用户在当前会话明确要求。

## 2. 当前总状态

| 项目 | 当前结论 |
|---|---|
| Phase 0～7 | 已完成本地实现、功能、隐私、生命周期和 unsigned/internal/manual-update 范围验收 |
| Phase 8 初始独立验收 | `PASS WITH CONDITIONS`；发现的 future-schema P1 与 bytecode-cache P2 已修复 |
| Python 3.12 条件关闭 | 已完成；Python 3.12.13 worker contract 2/2、pipeline integration 1/1 |
| 当前本地验收 | **PASS** |
| 未解决缺陷 | P0/P1/P2/P3 均为 0 |
| Patch surface | **9/9** 个上游文件，67/350 changed lines |
| 正式发布 | **BLOCKED**；本地 PASS 不代表 release-ready |

## 3. 最新验证基线

- Python：3.12.13，Windows AMD64，仓库外 Codex workspace dependency runtime。
- Worker source contract：2/2 passed。
- Focused pipeline integration：1/1 passed，0 skipped。
- Full Vitest：86/86 files、463/463 tests、0 skipped。
- `typecheck:node`：通过。
- `typecheck:web`：通过。
- 数据泄漏检查：通过；报告合并并删除旧文件后，当前扫描为 1,499 个 tracked/candidate 文件。Phase 8 条件关闭时的历史数字 1,507 保留在第 7 节。
- Patch guard：通过；9/9 上游文件、67/350 changed lines。
- Unpacked package：127 files；worker 58/58 hashes；固定路径恰好一份 worker；退役 dashboard 和 raw/analysis 数据命中为 0。
- 隔离 `userData` smoke：Electron exit 0；disabled worker before/during/after 为 0/0/0；无孤儿 worker。
- Packaged worker 匿名 contract：通过；SQLite integrity `ok`。
- Build：Phase 8 初始验收已通过；Python 条件关闭仅改文档，未重复 build。

已知非阻断波动：Python 条件关闭时第一次 full Vitest 曾因既有 self-update 测试固定 50ms 超时失败一次；单独复跑 5/5，随后全量复跑 463/463。未修改断言、未增加 skip、未绕过测试。若再次发生，应在本文件“维护记录”中作为稳定性问题跟踪。

## 4. 不可变产品边界

- 唯一支持的产品面是 League Akari 主窗口内原生 Vue `member-analysis` 页面。
- renderer 只使用该功能白名单 Electron IPC；不增加 loopback HTTP、通用文件系统、进程执行或任意网络代理。
- `member-role-dashboard` 是退役参考，不恢复浏览器、Pages、WebView、第二窗口或其他运行时。
- 玩家数据、比赛数据、派生结果和缓存仅位于 Electron `userData/member-analysis`；导出仅写入用户显式选择的位置。
- token 只留在 Electron main 内存，不进入 renderer、worker、日志、Git、安装包或 CI artifact。
- 官方 updater 与 fork 自动更新保持不可执行，直到独立签名更新通道和回滚 gate 完整建立。
- 当前 patch surface 已到硬上限 9/9；不得新增第 10 个上游修改文件。

## 5. 剩余正式发布 Blocker

1. Windows 代码签名证书及受保护签名流程；
2. 独立 fork update feed 与签名 manifest；
3. artifact authenticity、原子切换和回滚验证；
4. 干净 Windows 安装/升级/卸载、SmartScreen 与 AV 验证；
5. 首次真实 upstream sync rehearsal；
6. 如未来启用公开更新，仍需保留上一完整版本并验证失败回退。

这些 blocker 不影响当前本地维护，但在全部关闭前不得宣称正式发布就绪。

## 6. 后续统一记录格式

以后不创建新报告/RFC/sync Markdown。每项工作直接在本节下方追加三级标题：

```text
### YYYY-MM-DD — <Bug / Feature / Upstream Sync / Release Prep / Acceptance>：标题
- 范围：
- HEAD / upstream SHA：
- 变更：
- 数据、IPC、schema、patch budget 影响：
- 实际命令与退出码：
- 测试/构建数量：
- 缺陷及严重级别：
- 回滚/降级：
- 临时数据与隐私清理：
- 结论：PASS / PASS WITH CONDITIONS / FAIL / BLOCKED
- 剩余事项：
```

当前没有待处理的本地 P0～P3。下一项工作应由实际 bug、新功能、上游同步或用户明确授权的发布准备触发。

### 2026-08-01 — Documentation：统一全部进度报告

- 范围：文档整理，不修改运行时代码、worker、IPC、schema 或构建配置。
- 变更：Phase 0 baseline、Phase 3～5、Phase 5、Phase 6、Phase 7、Phase 8 初始验收和 Python 3.12 条件关闭报告完整并入本文件第 7 节；删除原独立报告和已过期 Phase 8 prompt。
- 文档政策：以后禁止新建 Markdown；所有报告、RFC、bug、功能、上游同步和发布准备记录只追加到本文件。该规则同时写入根 `AGENTS.md` 和维护手册。
- 引用维护：主技术设计、维护手册和发布政策全部改为引用本统一进度文档；活动文档中不存在指向已删除报告的引用。
- 完整性：7 个历史来源标题均存在于第 7 节；统一文档 53,195 bytes（后续原地更新时长度可变化）。
- Gate：数据泄漏检查通过，1,499 个 tracked/candidate 文件；patch guard 通过，9/9 个上游文件、67/350 changed lines。
- 结论：PASS。没有部署、发布、commit、push 或 PR。

### 2026-08-01 — Bug：设置抽屉无法打开与上游凭据日志泄漏

- 用户复现：在 packaged CCB 的“成员分析已关闭”页面点击右上角“设置”或中央“打开设置”无反应；Vue 报 `structuredClone` 无法克隆响应式对象的 `DataCloneError`。
- P1 根因与修复：`MemberAnalysisSettingsDrawer.vue` 直接对 Pinia/Vue reactive proxy 执行 `structuredClone`，组件 setup 失败。改为按 contract 字段显式复制 settings、members 和 queueIds，不克隆 proxy；增加 reactive settings 打开抽屉的回归测试。
- P0 附带发现与修复：实际 console/file logger 输出未完整遮蔽 `authToken`、`riotClientAuthToken` 和 JSON 引号包围的 `token` 字段。扩展 fork-wide 文本脱敏规则，覆盖复合 token 键、带引号 JSON 键及自然语言 `Token:`；增加四类值均被替换为 `[REDACTED]` 的回归测试。
- 凭据处置：旧 unpacked 目录在重新打包时被替换，旧 package `logs` 目录已不存在；仍要求人工复测前重启 League/Riot 客户端，使本次终端中已出现的短期 LCU/Riot token 失效。
- Focused tests：3 files、5 tests passed。
- Full regression：87/87 files、465/465 tests passed；Python 3.12 integration 实际执行，0 skipped。
- Typecheck：node/web 均通过。
- Production build：通过；沙箱内首次因父目录访问权限失败，批准的沙箱外重试成功，仅保留既有 CSS `@reference` 和大 chunk warning。
- Package：重新生成 Windows x64 unpacked CCB；artifact scan 127 files、58/58 worker hashes，通过。
- 隐私与 patch gate：leak guard 通过，1,597 个 tracked/candidate 文件；patch surface 保持 9/9、67/350 changed lines。
- 变更文件：`MemberAnalysisSettingsDrawer.vue`、新增同目录组件回归测试、feature-owned `redaction.ts` 与既有 redaction test；未改变 IPC、schema、dataVersion、worker 或上游 patch 文件。
- 结论：P0/P1 均已修复，等待用户使用新包人工复测设置交互和真实启动日志。没有部署、发布、commit、push 或 PR。

### 2026-08-01 — Bug：保存设置时 reactive payload 无法通过 Electron IPC

- 用户复现：设置抽屉已可打开，但点击“保存设置”无界面响应；renderer 报 `An object could not be cloned`，栈位于 `AkariIpcRenderer.call -> MemberAnalysisRenderer.updateSettings`。
- 严重级别：P1，阻断首次启用和成员配置保存。
- 根因：抽屉 draft 是 Vue reactive proxy；虽然上一修复避免了在组件 setup 中 `structuredClone` proxy，但保存事件仍把 reactive payload 传给 renderer shard，Electron structured-clone IPC 拒绝该对象。
- 修复：在 `MemberAnalysisRenderer.updateSettings` 的 IPC 边界使用既有 strict Zod `MemberAnalysisUpdateSettingsRequestSchema.parse`，同时完成 contract 校验、字符串规范化并生成可克隆的普通对象，再调用白名单 IPC；不改变 IPC shape、contractVersion 或持久化 schema。
- 回归测试：新增 renderer IPC boundary 测试，传入 reactive settings，断言发送对象不是 Proxy、可被 `structuredClone` 且字段保持一致。
- Focused：2 files、2 tests passed。
- Full regression：88/88 files、466/466 tests passed，0 skipped；Python 3.12 integration 实际执行。
- Typecheck：node/web 均通过。
- Production build：通过，仅保留既有 CSS `@reference` 和大 chunk warning。
- Package：重新生成 Windows x64 unpacked CCB；artifact scan 127 files、58/58 worker hashes，通过。
- 隐私与 patch gate：leak guard 通过，1,598 个 tracked/candidate 文件；patch surface 保持 9/9、67/350 changed lines。
- 结论：代码修复及本地 gate 通过，等待用户使用最新重建包复测“保存设置”。没有部署、发布、commit、push 或 PR。

### 2026-08-02 — Bug：刷新/取消事件回调丢失 renderer shard 的 `this`

- 用户复现：设置保存成功并进入“尚未生成分析数据”，点击右上角“刷新”后 Vue 报 `Cannot read properties of undefined (reading '_call')`，栈位于 `MemberAnalysisRenderer.startRefresh`。
- 严重级别：P1，阻断真实刷新；同一绑定方式也潜在影响运行中“取消”按钮。
- 根因：Vue 模板把 `memberAnalysis.startRefresh` / `cancelRefresh` 作为裸事件回调传递，调用时不保留类实例 receiver，方法内的 `this` 为 `undefined`。
- 修复：在 `MemberAnalysisRenderer` 构造阶段绑定 `startRefresh` 和 `cancelRefresh` 到 shard 实例，保持现有公开方法、模板事件、IPC 名称与 store shape 不变。
- 回归测试：把两个方法从实例中取出后模拟 Vue 事件回调直接调用，确认分别到达 `startRefresh` 与 `cancelJob` IPC 且不会丢失 `_call`。
- Focused：2 files、16 tests passed。
- Full regression：受当前机器资源竞争影响，默认并行运行未在 180 秒内完成；使用 `--maxWorkers=1 --fileParallelism=false` 的完整套件为 88/88 files、467/467 tests passed，0 skipped，Python 3.12 integration 实际执行。没有降低断言或跳过测试。
- Typecheck：node/web 均通过。
- Production build：通过；本机当时明显变慢，延长超时后完成，仅保留既有 CSS `@reference`、plugin timing 和大 chunk warning。
- Package：重新生成 Windows x64 unpacked CCB；artifact scan 127 files、58/58 worker hashes，通过。
- 隐私与 patch gate：leak guard 通过，1,598 个 tracked/candidate 文件；patch surface 保持 9/9、67/350 changed lines。
- 结论：刷新与取消回调修复及本地 gate 通过，等待用户使用最新重建包继续人工刷新审核。没有部署、发布、commit、push 或 PR。

## 7. 已合并的历史报告

以下内容由原独立 Phase 报告按时间顺序合并。原文件名仅用于历史来源识别；独立文件在合并校验后删除。
### 历史来源：`phase-0-baseline.md`


#### Source baseline

- Branch: `dev`
- Upstream commit: `ba522009f0d85b0ee0979e76e3b92724555d4c53`
- Commit subject: `fix(cd-timer): restore window dragging`
- Node: `v23.10.0`
- npm: `10.9.2`
- Vendored Yarn: `4.9.1`
- Worktrees before implementation: clean in both `akari-src` and `member-role-dashboard`

`package.json#packageManager` declared Yarn 4.14.1 while `.yarnrc.yml#yarnPath` selected the
vendored 4.9.1 release. Phase 0 aligns the declaration to the executable actually checked into the
repository. The global `yarn` command is unavailable and Corepack cannot read its user cache in this
lab, so all Akari verification uses `node .yarn/releases/yarn-4.9.1.cjs ...`.

#### Commands actually run before implementation

| Command                                             | Result                                                                                                                                 |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `node .yarn/releases/yarn-4.9.1.cjs typecheck:node` | pass                                                                                                                                   |
| `node .yarn/releases/yarn-4.9.1.cjs typecheck:web`  | pass                                                                                                                                   |
| `node .yarn/releases/yarn-4.9.1.cjs test`           | fail: 70/71 files and 403 tests passed; `keyboard-shortcuts/index.test.ts` could not import the incomplete local Electron installation |
| `npm test` in `member-role-dashboard`               | pass: Vite build and 2/2 static/privacy tests                                                                                          |

The Vitest failure is environmental and is not treated as a green baseline. No dependency was
installed or repaired during this implementation.

#### Architecture verification

- Main shards are registered through `src/main/bootstrap/index.ts` and initialized/disposed by
  `AkariManager`.
- Main IPC uses `AkariIpcMain.onCall`; its router owns the standard success/error transport envelope.
- The member-analysis domain returns a separate stable typed result and verifies the main-window
  `webContents` before handling calls.
- The main window keeps `contextIsolation: true`, `nodeIntegration: false`, and no `webviewTag` via
  the existing window defaults. No preload capability or CSP exception is added.
- The main renderer uses Vue Router, a window-local renderer shard manager, Pinia, Naive UI, and
  theme attributes/variables from the existing provider.
- Electron Builder already excludes source, docs, logs, examples and development metadata. The new
  leak guard additionally blocks analysis data paths and the tracked-file scanner never traverses
  local raw/derived data directories.

#### Original deferrals and later remediation

- At the time of this baseline, no SGP query, Python worker, database migration, sidecar packaging or updater feed had been implemented. SGP DETAILS and the Python/SQLite one-dir proof of concept were subsequently completed before Phase 5; see `phase-5-report.md`.
- The old loopback server was not carried forward. The accepted product architecture is the native League Akari page over allowlisted Electron IPC, with no HTTP listener.
- No real player data was used as a fixture or read by tests.
- Packaged runtime smoke and `electron-builder` installer generation remain Phase 7 work.

#### Current verification status

The 70/71 initial test result above is retained as historical baseline evidence, not the current state. After dependency repair and Phase 0～5 implementation, full Vitest passed 83/83 files and 452/452 tests; node/web typecheck, Electron build, leak guard and the 9/9 patch-surface guard also passed.

---

### 历史来源：`phase-3-5-gate-report.md`


> This report supersedes the earlier temporary Phase 5 blocked-gate note. The missing Phase 0/1 prerequisites were remediated and Phase 5 subsequently passed.

#### Phase 3 — accepted

- Delivered native header, filters, section tabs, disabled/first-run/loading/empty/error/ready states, feature settings drawer, theme variables and narrow-window behavior.
- Verification: 16 focused tests, web typecheck, Electron build, and real Electron CDP smoke across all eight themes plus 620×640 at 150% zoom.
- Deviation: feature copy remains in feature-owned Vue files instead of the upstream i18n loader because the upstream patch budget is already 9/9.

#### Phase 4 — accepted

- Migrated in sequence: member/role, champion, lane pairs, conversion, synergy and paginated match details.
- Verification: anonymous golden metrics, combined filters, 10k-row search-index benchmark, 18 focused tests, web typecheck, Electron build, leak scan and patch-surface check.
- Deviation: match navigation uses a feature-owned route link and does not modify upstream `MatchCard`.

#### Phase 5 prerequisite remediation — accepted

- Verified the existing main-process SGP DETAILS path without exposing Authorization data to renderer.
- Added and tested the Python 3.12 contract, SQLite schemas and one-dir PyInstaller proof of concept.
- Product decisions: explicit fixed-member list, default 100 matches, supported Summoner's Rift 5v5 queues; a single member identity failure is skipped and reported without failing the whole refresh.

#### Phase 5 — accepted

- Delivered main-process collection, catalog/checksum incrementality, normalized raw storage, Python worker protocol, cancellation/timeout/checkpoint, staging integrity checks and atomic publication with old-data retention on failure.
- Verification: Python 2/2; focused Vitest 33/33; full Vitest 83/83 files and 452/452 tests; node/web typecheck, Electron build, leak guard and 9/9 patch-surface guard all passed.
- Detailed evidence and deviations: `docs/fork/phase-5-report.md`.

#### Decisions now fixed for Phase 6

- Product UI is the native League Akari Vue page only.
- `member-role-dashboard` is a retired historical reference; no browser runtime, GitHub Pages shell or loopback adapter remains in scope.
- Storage uses a 10 GiB default soft limit. Cleanup requires preview and explicit second confirmation, and must preserve settings and the current published database.
- OP.GG remains disabled by default.

The upstream patch surface remains 9/9; no tenth upstream file may be modified.

---

### 历史来源：`phase-5-report.md`


#### Remediated prerequisites

- Existing Electron main SGP path returned identical SHA-256 content for two reads of the same
  DETAILS response, contained timeline frames, and exposed no Authorization header to renderer.
- Python 3.12 source contract passed 2/2 tests.
- A temporary PyInstaller 6.16 one-dir PoC passed the same anonymous contract smoke: 58 files,
  23,869,695 bytes, executable SHA-256
  `B3721A584CE8F4CCC6AE5234CFE79BB9FD963A73C6F53D2164D320069E7B0D33`.
- The PoC output, installer modules, isolated Electron userData and runtime logs were deleted after
  verification.

#### Delivered

- Explicit fixed-member configuration, default 100-match depth and supported Summoner's Rift queue
  selection.
- Riot ID resolution and SGP history/SUMMARY/DETAILS calls remain in Electron main through existing
  authenticated helpers. No credential is accepted by or sent to Python.
- Checksum/catalog watermark, compressed atomic raw writes, separate catalog and analysis SQLite
  databases, WAL, checkpoint files and staging publication.
- Python NDJSON ready/progress/result/error protocol.
- Single active refresh, cancellation, deadline cancellation, forced termination fallback and
  shutdown disposal.
- Staging integrity validation and atomic current/previous replacement. Cancellation and failure do
  not replace the current published database.
- Renderer progress events and cancel action.

#### Verification

- Python: 2/2.
- Phase 5 focused Vitest: 33/33.
- Full Vitest: 83/83 files and 452/452 tests.
- Node/web typecheck, Electron production build, leak guard and 9/9 patch-surface guard passed.

#### Deviations

- Main uses Electron/Node's built-in `node:sqlite` instead of `better-sqlite3`, avoiding native ABI
  divergence between the host test Node and Electron. The API is still marked experimental by the
  host Node runtime and must remain covered by packaged-runtime tests.
- Production sidecar resources are deliberately not retained or wired into Electron Builder yet;
  that belongs to the Phase 7 signed packaging gate. Development requires the explicit
  `MEMBER_ANALYSIS_PYTHON` path, while packaged mode accepts only the fixed resources path.

#### Post-gate product decisions

- The supported UI is the native League Akari Vue page only. The old React dashboard is a retired historical reference.
- No browser runtime, GitHub Pages shell or loopback HTTP adapter will be implemented. All renderer access remains on allowlisted Electron IPC.
- Phase 6 uses a 10 GiB default storage soft limit; cleanup requires preview and explicit second confirmation. OP.GG remains disabled by default.

---

### 历史来源：`phase-6-report.md`


#### Entry gate

- Phase 5 and its remediated Phase 0/1 prerequisites passed.
- Product surface is the native League Akari Vue page over allowlisted Electron IPC only. The browser/Pages/loopback path is retired.
- Upstream patch surface entered and exited Phase 6 at the hard limit of 9/9; all Phase 6 changes are feature-owned.

#### Delivered

- Added a 10 GiB default storage soft limit and storage accounting under `userData/member-analysis`.
- Cleanup is never automatic. It requires a server-issued preview plus an explicit second confirmation, rejects stale previews and concurrent cleanup, selects oldest raw catalog rows, and preserves settings and the current published analysis database.
- Added catalog and derived-data indexes, WAL/busy timeout continuity, keyset pagination, parameterized SQLite filters, 100-row IPC page limits and a 10k-row pagination test.
- Added legacy analysis DB migration to schema/user version 2 with pre-migration backup and restore-on-failure behavior.
- Added recursive token redaction and hashed player-identifier logging helpers. Real packaged testing later found an upstream SGP token message; Phase 7 installed the same feature-owned sanitizer fork-wide from the already-budgeted bootstrap file. Collection/pipeline logs expose stable codes and counts only.
- Added `opggEnabled`, default `false`. No OP.GG network adapter exists, so enabling the policy flag currently produces no outbound request.
- Added a static architecture test and source scan proving the member-analysis runtime creates no HTTP listener or loopback adapter.
- Updated the native settings drawer with storage policy, privacy copy, cleanup preview/confirmation and the OP.GG opt-in flag.

#### Verification

- Phase 6/member-analysis focused Vitest: 12 passed files plus 1 conditional integration file; 44 executed tests passed.
- Python worker contract: 2/2.
- Full Vitest with the Python 3.12 integration path: 85/85 files and 459/459 tests passed.
- Node and web typecheck passed.
- Electron production build passed. The first sandboxed attempt was denied access to the repository parent; the approved unsandboxed retry succeeded with only the existing CSS/chunk-size warnings.
- Data leak guard passed across 1,443 tracked/candidate files.
- Patch-surface guard: 9/9 upstream files, 63 changed lines.
- Runtime source scan found no `createServer`, `LoopbackAdapter`, fixed `127.0.0.1:8765`, or old dashboard server reference.

#### Deviations

- OP.GG remains a policy setting only; third-party reference-data transport is intentionally absent pending terms/privacy review.
- To preserve the Phase 4 aggregate semantics, renderer reload follows the keyset cursor and combines derived rows in 100-row pages. Raw timeline remains main/worker-only. A future aggregate-query contract could further reduce renderer memory without changing the current views.

#### Acceptance

Accepted. Path traversal, stale/concurrent cleanup, 10k pagination, migration, cleanup preview/confirmation, default-off OP.GG, IPC-only transport, build, leak and patch-budget gates all pass.

---

### 历史来源：`phase-7-gate-report.md`


#### Entry gate and patch budget

- Phase 0～6 passed.
- Upstream patch surface was already at the hard limit of 9/9.
- Modifying upstream `electron-builder.yml` would have created a forbidden tenth upstream file. A feature-owned overlay, `packaging/member-analysis-builder.yml`, extends the upstream config, excludes duplicate resources and places the worker directly at `process.resourcesPath/member-analysis/worker`.
- Patch-surface guard remained 9/9; the final fork-wide log sanitizer brings the upstream diff to 65 changed lines.

#### Completed local packaging work

- Built a Python 3.12.13 / PyInstaller 6.16.0 Windows x64 one-dir worker from the controlled entrypoint.
- One-dir contract smoke passed 2/2 using the executable itself.
- Worker payload: 58 files, 23,870,515 bytes.
- Executable SHA-256: `E6405BA5171B16BFA7606F42A4D66F34B648B0936E5B43246ED87469C85A24E3`.
- Worker manifest SHA-256: `F251213FD9EDA7765BBCD59629731E96442EB4F19C2C68C6BD1CBD230D668B6A`.
- Generated a 58-file SHA-256 manifest and added a packaged-artifact verifier.
- Built an unsigned Windows unpacked application with Electron 41.9.2 using the feature-owned overlay.
- Verified the worker existed exactly once at the production fixed path, all 58 packaged hashes matched, `app.asar` existed, the retired dashboard/packaging source was excluded, and no raw/analysis/log/player-data-shaped artifact was present.
- Packaged scan covered 127 unpacked files; the ASAR exclusion check covered 7,265 entries.
- Isolated-userData packaged launch succeeded, created member-analysis state only under the supplied userData, did not start the worker while the feature was disabled, and left zero orphan workers. A test-only CDP `Browser.close` terminated the process without a forced kill; Electron returned exit code 7 for that CDP shutdown, so this is recorded as a launch/lifecycle smoke rather than a release-quality graceful-exit certification.
- Temporary PyInstaller tools/build/spec/dist, the 775 MB unpacked package and all isolated smoke userData were deleted after verification. The generated production worker and hash manifest remain under `resources/member-analysis`.

#### Real-machine packaged integration

- Windows Sandbox was removed from the acceptance policy by explicit user decision; no clean-Windows claim is made.
- A newly packaged `LeagueAkariCCB.exe` ran against the already-running local LoL client with a temporary CCB-only userData directory and one locally configured member. No official Akari userData was read or migrated.
- The packaged worker was available, the first real refresh completed and atomically published 37 matching games, and storage remained below the configured soft limit.
- A second refresh was cancelled. The published analysis DB SHA-256 remained identical before and after cancellation.
- Process shutdown required no forced stop and left zero worker processes.
- IPC evidence exposed no Authorization field or token. No Riot ID, PUUID, gameId or raw response was written to the report output.
- The first real run revealed an upstream `sgp-main` info message that included the League session token. Directly editing the upstream SGP file would have exceeded the 9/9 patch-file budget. A feature-owned fork-wide payload sanitizer is now installed from the already-budgeted bootstrap registration file, before any shard logging.
- Rebuilt packaged verification found zero credential values, two expected `[REDACTED]` token events, zero configured player identifiers in logs and zero orphan workers. Patch surface remains 9/9 (65 changed lines).

#### Updater result

- Full Vitest still passes the official artifact projection, updater lifecycle and fork-wide log-redaction guards: 86/86 files, 461/461 tests.
- Official League Akari packages remain non-executable and rejected at download/apply/quit/uninstall boundaries.
- No fork feed is configured. Automatic update remains compile-time disabled.

#### Acceptance and deferred maintenance gates

Phase 7 is **accepted for the current unsigned/internal/manual-update scope**.

- The first CCB version is pinned to upstream SHA `ba522009f0d85b0ee0979e76e3b92724555d4c53`; it does not consume newer upstream code.
- By explicit user decision, the first real upstream sync rehearsal is deferred until CCB actually needs to adopt a newer official version and local commits/temporary sync branches are allowed.
- Code signing, a clean-image compatibility claim and an independent update feed are intentionally deferred. They become blocking before any public release or fork self-update is enabled, but do not block current local/internal use.

No deployment, Git commit/push, PR or release artifact publication was performed.

#### User decisions recorded after the local gate

- Identity: `League Akari CCB`, appId `com.ccb.leagueakari`, executable `LeagueAkariCCB.exe`.
- Version: `0.1.0-ccb.1`; independent SemVer with exact upstream SHA recorded separately.
- Platform/package: Windows x64 portable full 7z only; no installer and no macOS sidecar in the first release.
- Distribution: unsigned local/internal use only; no public unsigned release.
- Update: manual complete-package replacement only. Fork self-update remains a future gated capability and must use an independent feed, hashes, signatures and tested rollback.
- Data: never migrate official League Akari userData automatically; only CCB-to-CCB schema migration is allowed.
- Verification: all acceptance runs on the current LoL-enabled Windows x64 machine. Packaged smoke uses isolated temporary userData; live integration uses CCB-only userData. No clean-Windows claim is made.
- Upstream: first release remains pinned to `ba522009f0d85b0ee0979e76e3b92724555d4c53`; future maintenance uses official `upstream` plus CCB `origin` and a temporary sync branch.

The canonical policy is `docs/fork/release-policy.md`. Windows Sandbox was explicitly removed from the current acceptance criteria, packaged live integration passes, and upstream sync is a future maintenance gate rather than a first-version Phase 7 blocker.

---

### 历史来源：`phase-8-acceptance-report.md`


> 结论：**PASS WITH CONDITIONS**  
> 验收日期：2026-08-01（Asia/Shanghai）  
> 验收范围：本地源码、测试、production build、Windows x64 unpacked package、隔离 userData smoke；不包含部署、发布、签名、PR 或 Git 提交。

#### 1. 环境、HEAD 与 worktree

- OS：Windows 10.0.26200，Windows x64。
- Node：`v23.10.0`；npm：`10.9.2`。
- 仓库锁定 Yarn：`.yarn/releases/yarn-4.9.1.cjs`，实际版本 `4.9.1`；`package.json#packageManager` 为 `yarn@4.9.1`。
- Electron：`41.9.2`；electron-builder：`26.15.6`；Vite：`8.1.4`；Vitest：`4.1.9`。
- Python launcher 仅发现 Python 3.7；`py -3.12` 与 PyInstaller 3.12 环境不可用。因此 Python 3.12 源码 contract 和源码 pipeline integration 记为 **BLOCKED**，没有用错误版本冒充通过。
- Akari branch：`dev...origin/dev`；HEAD/baseline：`ba522009f0d85b0ee0979e76e3b92724555d4c53`（`fix(cd-timer): restore window dragging`）。
- 根工作区自身尚无 Git commit；实际 Akari checkout 是 `akari-src` 内的独立 Git worktree。
- 开始验收时 Akari 有 9 个已修改上游文件和 134 个 feature/docs/resource 等未跟踪文件；这些是 Phase 0～7 的既有本地实现。验收未执行 `reset`、`clean`、强制 checkout、commit、push 或 PR。
- 验收生成的 `.phase7-package`（约 736 MB）、隔离 smoke userData、临时 worker contract 目录和已有 Python `__pycache__` 已在确认路径位于本 checkout/临时目录后删除；未删除任何玩家数据或用户配置。

#### 2. 审计范围和产品边界

实际阅读并交叉核对了根 `AGENTS.md`、技术设计、fork README、contract、maintenance runbook、patch manifest、Phase 0/3～7 报告、release policy，以及对应 route/sidebar/main/renderer shard、IPC schema/handler、collector、repository、pipeline、worker supervisor、redaction、self-update 和 packaging 实现。

结论如下：

- 唯一运行时入口是主窗口 Vue route `/member-analysis/:section?`；sidebar、renderer shard 和 main shard 均使用现有 Akari 注册点。
- 未发现 `member-role-dashboard`、React、WebView、第二窗口、Pages shell、旧 `dashboard_update_server` 或固定 `127.0.0.1:8765` 进入 Akari runtime/package。
- member-analysis feature 源码中没有 HTTP listener/loopback adapter；renderer 仅调用 `member-analysis-main` 业务 IPC。
- feature 默认关闭。初始化只创建 `userData/member-analysis` repository；不会 spawn worker，也不会开始 Riot/SGP 采集。隔离 packaged smoke 实测 disabled 状态 worker 数始终为 0，应用正常启动和退出。
- 初始化异常被 main shard 捕获为 degraded，不阻断 Akari shard manager；renderer 对 IPC/初始化异常进入现有 error state。未新增 Akari 启动/退出的全局硬依赖。
- preload 没有新增 API；member-analysis renderer 不具备 `fs`、`exec`、token、任意 URL、任意路径、SQL 或任意 LCU endpoint 能力。

#### 3. Phase 0～7 声明复核

| 阶段声明 | 本次实际核验 | 结论 |
|---|---|---|
| Phase 0：固定 upstream SHA、Yarn 对齐、原生 shard/IPC 边界 | HEAD 与 manifest baseline 一致；Yarn 4.9.1；main/renderer 注册点和 IPC transport 均存在 | 通过 |
| Phase 1～2：contract v1、稳定错误码、默认关闭和 worker unavailable 降级 | Zod strict schema、错误码、sender 检查、method allowlist 均存在；disabled 返回 `FEATURE_DISABLED`，无 worker 返回 `WORKER_UNAVAILABLE` | 通过 |
| Phase 3：原生 Vue 页面和 disabled/first-run/loading/empty/error/ready 状态 | route/sidebar/page/store 和 8 类视图状态测试存在；无 React runtime | 通过 |
| Phase 4：业务视图、过滤和分页 | 视图、匿名聚合测试、参数化过滤和 keyset pagination 存在；IPC page size schema/implementation 上限均为 100 | 通过 |
| Phase 5：main 内采集、增量 catalog、worker 协议、互斥/取消/超时/checkpoint/原子发布 | collector 通过 RiotClientMain/SgpMain 获取数据；token 不传 renderer/worker；单 job、abort、15 分钟 timeout、5/8 秒终止回退、staging integrity 和 current/previous 回滚实现及测试存在 | 通过；Python 3.12 源码 integration 本次 BLOCKED |
| Phase 6：10 GiB、清理二次确认、迁移、脱敏、无 HTTP | previewId + confirm、并发/陈旧 preview 拒绝、只清 raw catalog、保留 current/settings；fork-wide logger sanitizer；architecture scan 均存在 | 发现迁移版本处理缺陷后已修复并回归 |
| Phase 7：worker hash、固定资源路径、package 扫描、隔离 userData smoke、updater 禁用 | 本次重建 unpacked package、核对 58 hashes/唯一 worker/ASAR 排除，并完成 disabled smoke；updater guards 和 lifecycle 测试通过 | 本地复核通过；live LCU/SGP 未重跑 |

#### 4. IPC、安全与隐私结论

##### 4.1 IPC/capability

- 主 IPC namespace 为 `member-analysis-main`，只注册 10 个业务方法：`getCapabilities`、`getOverview`、`getSettings`、`updateSettings`、`startRefresh`、`getJob`、`cancelJob`、`getStorageStatus`、`previewCleanup`、`confirmCleanup`。
- 每个调用先校验 `event.sender === mainWindow.webContents`，再使用 strict Zod tuple/request schema 校验参数。
- contractVersion/dataVersion 均严格为 1；未知 payload version 不会被 schema 静默接受；legacy payload 只有显式 v0→v1 migration。
- 分页 schema 最大 100，repository 还做二次 clamp；cursor 结构和 path segment 均验证，SQL 使用参数绑定。
- IPC 未暴露路径、URL、SQL、命令、token、Authorization、文件系统或通用 LCU/SGP endpoint。

##### 4.2 token、日志和本地数据

- Riot/SGP 凭据保留在既有 Electron main helper 内存路径；collector 只接收业务响应，worker argv/manifest 不含凭据。
- fork-wide logger 在 shard 初始化前安装递归 secret sanitizer；member-analysis 自身对玩家标识提供 hash/redaction helper。相关 focused/full tests 通过。
- repository 根固定为 `app.getPath('userData')/member-analysis`；raw、catalog、analysis、jobs/checkpoint 均由该根派生并有 traversal guard。
- leak guard 最终扫描 1,505 个 tracked/candidate 文件并通过。package scanner 未发现 raw/analysis/log/player-data-shaped artifact。
- 本次补充 `__pycache__/`、`*.py[cod]` Git ignore 与 leak-guard 规则，并清除 checkout 内已有 Python bytecode cache。

##### 4.3 HTTP/dashboard

- 静态 architecture test 和独立 `rg` 源码扫描未发现 member-analysis `createServer`、loopback adapter、固定旧端口或 dashboard server runtime 引用。
- unpacked package 的 `app.asar` 中 `member-role-dashboard`、`dashboard_update_server`、`raw_data`、`analysis_output` 和 feature packaging source 命中数均为 0。

#### 5. worker、迁移、清理与退出

- `resolveWorkerLaunch`：packaged 只接受 `process.resourcesPath/member-analysis/worker/member-analysis-worker.exe`；development 只接受显式 `MEMBER_ANALYSIS_PYTHON`，并以 `-I` 运行受控 source entrypoint。spawn 使用 `shell:false`、`windowsHide:true`。
- 单实例刷新、collection AbortSignal、worker cancel NDJSON、超时、强制 kill 和 shard dispose 均有实现/测试。
- staging 在发布前执行 SQLite integrity check；current 先转 previous，rename 失败恢复 previous；取消/失败不替换 current。
- cleanup 先生成服务端 preview，再要求 64 位 previewId confirm；重新计算 fingerprint，拒绝 stale/concurrent cleanup，只移动并删除最老 raw catalog 项；错误时移回文件并 rollback DB。
- 本次发现旧迁移会把更高 `PRAGMA user_version` 静默写回 2，且初始化失败时 catalog handle 未显式关闭。已改为拒绝高于 2 的 schema、迁移异常前关闭 DB、从 migration backup 恢复原文件，并在 repository initialize 失败时关闭 catalog。
- 新增回归测试覆盖：legacy 成功迁移、legacy migration step 失败时字节级恢复并保留 backup、future schema 99 拒绝且保持 version/文件不变。

#### 6. updater 结论

- `OFFICIAL_SELF_UPDATE_ALLOWED_IN_FORK` 为编译期常量 `false`。
- onInit 不注册 update watchers/automatic checks；renderer `checkUpdates/startUpdate/forceStartUpdate/cancel/open dir/uninstall` 均在 handler 边界拒绝。
- downloader、apply preparation、quit launch 和 uninstaller 内部各自再次调用 guard；release projection 在 Windows x64 也返回 `isUpdateSupported:false`、`artifact:null`。
- 本次 focused/full tests 验证 renderer 请求不调用 `checkLatestRelease`、prepared updater 不在 quit 执行，并覆盖 download/apply/uninstall/platform projection。
- 未配置 fork feed；自动更新保持不可执行。

#### 7. package 与 Phase 7 复核

- source worker：58 files，23,870,515 bytes。
- worker executable SHA-256：`E6405BA5171B16BFA7606F42A4D66F34B648B0936E5B43246ED87469C85A24E3`。
- worker manifest SHA-256：`F251213FD9EDA7765BBCD59629731E96442EB4F19C2C68C6BD1CBD230D668B6A`。
- unpacked package scanner：127 files、58/58 worker hashes；worker executable 在固定资源路径恰好 1 份；`app.asar` 5,260 entries；package runtime data path 0。
- 合成匿名 packaged-worker smoke：exit 0，3 条 NDJSON，final `completed`，SQLite integrity `ok`，1 game/5 players，未发布 current DB，未见 token。
- 隔离 userData packaged smoke：CDP close exit 0，Electron exit 0；disabled 前/运行中/退出后 worker 均为 0；member-analysis catalog 只出现在临时 userData，package 目录无运行数据；临时 userData 已删除。
- 本次没有执行真实 LCU/SGP refresh/cancel：它会产生真实玩家数据，且当前验收不需要复制或记录这类数据。Phase 7 的历史 live evidence 只作为历史记录，本报告不把它伪装成本次执行结果。

#### 8. 实际命令与结果

所有表中数字均来自本次执行。

| 命令 | 退出码 | 结果/计数 | 警告或备注 |
|---|---:|---|---|
| `git status --short --branch; git rev-parse HEAD; git log -1 ...`（工作区根） | 1 | 根仓库无 commit；随后转入 `akari-src` 获取真实 HEAD | `HEAD` 在根仓库不存在，不影响嵌套 Akari checkout |
| `git status ...; git rev-parse HEAD`（akari-src） | 0 | HEAD `ba522...4c53`；9 个上游修改文件 | Git global ignore 读取权限 warning |
| `node/npm/Yarn/Python/Electron/PyInstaller` 版本检查 | 0（组合命令） | Node/npm/Yarn/Electron 成功；Python 3.12/PyInstaller 不存在 | launcher 仅列 Python 3.7；单项 `py -3.12` 失败信息被如实记录 |
| 初始 focused Vitest | 0 | 17 files：16 passed、1 skipped；61 tests：60 passed、1 skipped | Node SQLite experimental warning |
| 初始 full Vitest | 0 | 86 files：85 passed、1 skipped；461 tests：460 passed、1 skipped | 跳过 Python 3.12 pipeline integration；SQLite warning |
| `typecheck:node` | 0 | pass | 无输出 |
| `typecheck:web` | 0 | pass | 无输出 |
| 首次 `yarn build`（sandbox） | 1 | typecheck pass，electron-vite config load fail | esbuild 无权读取仓库父目录；属 sandbox 环境失败 |
| `yarn build`（批准的 sandbox 外重试） | 0 | production main/preload/renderer build pass | `@reference` CSS warning；>500 kB chunk warning；npm update notice |
| 初始 leak guard | 0 | 1,516 files | Git global ignore warning |
| 初始 patch guard | 0 | 9 files、65 changed lines | LF→CRLF/global ignore warning |
| 首次 unpacked electron-builder（sandbox） | 1 | packaging 启动后失败 | `connect EACCES ...:443` sandbox 网络/缓存限制 |
| sandbox 外 electron-builder 重试 | 0 | Windows x64 unpacked package 完成 | duplicate dependency references；输出显示 signtool 阶段，但没有代码签名/发布声明 |
| `scan-packaged-artifact.mjs` | 0 | 127 files、58 hashes | 无 |
| ASAR/固定路径/敏感路径复核 | 0 | 1 worker；5,260 ASAR entries；目标 prohibited refs 全为 0 | 第一次辅助 PowerShell regex 写法产生 warning，随后用 literal wildcard 独立重跑为 0 |
| 隔离 userData packaged smoke | 0 | Electron exit 0；worker before/during/after = 0/0/0 | 使用测试专用显式 CDP port；临时 userData 已删 |
| 合成匿名 packaged worker contract smoke | 0 | completed；integrity ok；1 game/5 players | Node SQLite experimental warning |
| Python 3.12 source `unittest` | BLOCKED | NOT RUN | Python 3.12 不可用 |
| Vitest Python source pipeline integration | BLOCKED | 1 test skipped | `MEMBER_ANALYSIS_TEST_PYTHON` 未设置，因为没有 Python 3.12 |
| 修复后 repository regression | 0 | 1 file、9 tests passed | SQLite warning |
| 修复后 focused Vitest | 0 | 17 files：16 passed、1 skipped；63 tests：62 passed、1 skipped | SQLite warning |
| 修复后 full Vitest | 0 | 86 files：85 passed、1 skipped；463 tests：462 passed、1 skipped | SQLite warning；唯一 skip 为 Python 3.12 integration |
| 修复后 `typecheck:node` | 0 | pass | 无输出 |
| 修复后 `typecheck:web` | 0 | pass | 无输出 |
| 修复后最终 `yarn build` | 0 | main 569 modules、preload 2、renderer 31,947；production build pass | CSS `@reference` 与大 chunk warning |
| 修复后 leak guard | 0 | 1,505 tracked/candidate files | Git global ignore warning |
| 修复后 patch guard | 0 | 9/9 upstream files、67 changed lines | LF→CRLF/global ignore warning |

#### 9. 缺陷、修复、影响与回滚

##### P1（已解决）：future schema 会被静默降级

- 复现：构造合法 analysis DB，设置 `PRAGMA user_version=99`，旧实现初始化后无条件执行 `PRAGMA user_version=2`。
- 根因：`_migrateAnalysisDatabase` 未读取/比较当前 schema version，并且异常路径没有先关闭数据库；repository initialize 失败也没有关闭已打开 catalog。
- 影响：未来 CCB 数据被旧程序打开时可能被错误标记为 v2；若结构不兼容会造成不可恢复的可用性风险和句柄泄漏。未观察到真实数据损坏。
- 修复：显式 schema 上限 2；更高版本 fail closed；迁移异常关闭 handle 后恢复 migration backup；initialize catch 关闭 catalog。
- 回归：新增 failure restore 和 future-version rejection 测试，repository 9/9、focused 62/62 executed、full 462/462 executed 均通过。
- 回滚：关闭 feature，保留 `analysis.migration-backup.sqlite3`，用该备份恢复 current；代码回滚仅涉及 feature-owned repository 与 test，不改变 contract/dataVersion。

##### P2（已解决）：Python bytecode cache 未被 ignore/leak guard 覆盖

- 复现：`git ls-files --others --exclude-standard` 列出 3 个 `__pycache__/*.pyc`。
- 根因：`.gitignore` 和 leak guard 只覆盖 raw/analysis/cache 通用目录及 SQLite/log，未覆盖 Python 标准 cache 命名。
- 影响：维护者可能误纳入生成 cache；当前 package overlay并未包含这些文件，未发现玩家数据或 token。
- 修复：新增 `__pycache__/`、`*.py[cod]` ignore 和 leak-guard prohibited pattern，删除现有生成 cache。
- 回滚：恢复这两条 ignore/guard 规则前应先确认 checkout 内无 Python cache；不涉及运行数据/schema。

##### 未解决缺陷

- P0：0；P1：0；P2：0；P3：0。
- 环境未覆盖项不是代码缺陷，见下一节。

#### 10. patch budget 与变更文件

- manifest baseline 与 HEAD 一致。
- 修改上游文件：**9/9**；changed lines：**67/350**。本次 `.gitignore` 只在既有 manifest 接入点增加 2 行，没有第 10 个上游 patch 文件。
- 本次实际新增/修改：
  - `.gitignore`
  - `scripts/check-member-analysis-data-leaks.mjs`
  - `src/main/shards/member-analysis/repository.ts`
  - `src/main/shards/member-analysis/repository.test.ts`
  - `docs/fork/phase-8-acceptance-report.md`
- contractVersion、dataVersion、IPC shape 和持久化目标 schema version 均未变化，因此不需要新 contract migration；本次修复只是让既有 version 2 migration fail closed 并补齐恢复测试。

#### 11. 未覆盖项与外部发布 blocker

##### 本次环境条件

- **BLOCKED**：Python 3.12 source worker contract 与 source pipeline integration；环境只有 Python 3.7。已用已固定 hash 的 packaged worker 做匿名 executable contract smoke，但不能替代源码解释器 gate。
- **NOT RUN**：真实 LCU/SGP refresh/cancel；本次不使用真实玩家数据。没有推翻 Phase 7 历史证据，也没有声称本次通过 live integration。
- **NOT RUN**：干净 Windows/VM、SmartScreen、杀毒兼容、安装/卸载；release policy 明确当前为 real-machine-only portable 范围。
- **NOT RUN**：真实上游同步 rehearsal；首版仍固定 baseline SHA。

##### 外部发布 blocker

- 无 Windows 代码签名证书和受保护签名流程。
- 无独立 fork update feed、签名 manifest、全 artifact hash authenticity、原子切换和回滚验证。
- 无干净 Windows 安装/升级/卸载/SmartScreen/AV 结论。
- 未完成首次真实 upstream sync rehearsal。
- 当前仅允许 unsigned local/internal/manual complete-package replacement；不得公开分发未签名包。

这些 blocker 不阻断本地代码验收，但阻断任何“正式发布/release-ready”声明。

#### 12. 最终结论与维护建议

最终结论：**PASS WITH CONDITIONS**。

理由：所有本地必需 gate 最终通过；无未解决 P0/P1；架构、隐私、IPC、updater 和 9/9 patch budget 符合。验收发现的 P1/P2 已以 feature-owned 最小修复解决并完成 focused/full/typecheck/build/leak/patch 回归。条件来自 Python 3.12 source integration 和 live/clean-machine 等非本地核心环境覆盖项。

后续维护建议：

1. 在可用的固定 Python 3.12 环境中立即补跑 `python/member_analysis/tests/test_worker.py` 和设置 `MEMBER_ANALYSIS_TEST_PYTHON` 的 full Vitest，并在后继维护记录中补充实际数字。
2. 每次 worker/PyInstaller 变化重新生成 58-file（或新数量）manifest、核对唯一固定资源路径并重复 packaged executable smoke。
3. DB schema 演进继续执行“拒绝未知未来版本、迁移前备份、异常关闭句柄、字节级恢复测试”；不得自动降级。
4. 上游同步前先减少或维持 9/9 接入面，逐项复核 bootstrap/route/sidebar/shards/updater/package layout。
5. 保持官方 updater 编译期关闭；在独立签名 feed 和回滚 gate 全部完成前不得启用 fork updater。
6. 不提交、上传或打包任何 userData、比赛数据、token、日志、cache 或临时 package；不得恢复退休 dashboard runtime。

本报告不表示已部署、不表示可正式发布，也不创建任何 release artifact。

#### 13. 验收后文档维护复核

Phase 8 状态同步到 README、维护手册和主技术设计后，再次执行两个无副作用 gate：

- `node scripts/check-member-analysis-data-leaks.mjs`：通过，扫描 **1,506** 个 tracked/candidate 文件；
- `node scripts/check-patch-surface.mjs --manifest docs/fork/patch-manifest.json`：通过，保持 **9/9** 个上游文件、**67** changed lines。

文件数量比第 8 节验收结束时的 1,505 增加 1，是候选文档集合变化，不代表新增运行数据。第 8 节保留原始执行数字，本节作为后续维护证据，不回写或伪造历史命令结果。

#### 14. 后继条件关闭记录

本报告第 1～13 节保留 2026-08-01 初始验收的历史环境、命令与数字，不作改写。后继维护已使用受控 Windows x64 Python 3.12.13 补跑源码 worker contract 与实际 pipeline integration，并在最终 full Vitest、node/web typecheck、leak、9/9 patch 和残留检查通过后，将当前本地 Phase 8 状态更新为 **PASS**。

完整的新执行数字、第一次 full Vitest 时序波动及清理证据见 `docs/fork/phase-8-condition-closure-report.md`。该状态变化不解除代码签名、独立更新源、签名 manifest、回滚、干净 Windows/SmartScreen/AV 和首次 upstream sync rehearsal 等正式发布 blocker。

---

### 历史来源：`phase-8-condition-closure-report.md`


> 结论：**PASS**（仅限本地实现验收）  
> 执行日期：2026-08-01（Asia/Shanghai）  
> 范围：补跑 Python 3.12 源码 worker contract、Electron main + Python pipeline integration 及必需回归 gate；不包含部署、发布、签名、commit、push 或 PR。

#### 1. 环境、HEAD 与既有 worktree

- OS：Windows 11 `10.0.26200`，AMD64。
- Python：`3.12.13 (main, Mar 3 2026, 15:01:35) [MSC v.1944 64 bit (AMD64)]`。
- executable：`<Codex runtime>\dependencies\python\python.exe`。
- 来源：Codex workspace dependencies 提供的受控 bundled runtime；位于仓库外的工具缓存，不是系统默认 Python，不需要下载、安装或修改 PATH，也未安装任何项目依赖。
- 已验证解释器为 64 位 Windows AMD64，指针宽度 64 bit，并能通过 `subprocess.run([sys.executable, ...])` 启动自身，满足 Node 子进程启动条件。
- 系统 `py -0p` 仍只列出 `D:\programming\python\python.exe` 的 Python 3.7；`py -3.12 --version` 退出 103。该版本没有被用于任何 gate。
- 根工作区 Git 仓库无 commit，`git rev-parse HEAD` 失败；实际 Akari checkout 位于 `akari-src`。
- Akari branch：`dev...origin/dev`；HEAD：`ba522009f0d85b0ee0979e76e3b92724555d4c53`（`fix(cd-timer): restore window dragging`）。
- 开始时已有 9 个修改的上游文件，以及 Phase 0～8 的 feature、文档、Python worker、packaging 和 resource 等未跟踪内容。根工作区其余分析脚本和退役 prototype 也已存在。本任务未覆盖、重置或清理这些用户修改。

#### 2. Python runtime 隔离方式

运行时来自 Codex 工具缓存，不位于源码树或 Electron `userData`。本任务只把 executable 的绝对路径设置到当前 PowerShell 进程的 `MEMBER_ANALYSIS_TEST_PYTHON`，并设置 `PYTHONDONTWRITEBYTECODE=1`；源码 worker contract 还同时使用 `-B -I`。没有把 Python 路径、环境变量、虚拟环境、cache 或本机配置写入源码或项目配置。

`python/member_analysis/pyproject.toml` 声明 `requires-python = "==3.12.*"` 且运行依赖为空，因此没有安装依赖。

#### 3. 实际命令、退出码与计数

所有命令均从 `akari-src` 执行；表中数字来自本次输出，不沿用 Phase 8 历史报告。

| 命令 | 退出码 | 本次结果 |
|---|---:|---|
| bundled Python `-B -c` 版本/平台/位数/subprocess 检查 | 0 | Python 3.12.13、Windows AMD64、64 bit；子进程输出 `123` |
| `$env:PYTHONDONTWRITEBYTECODE='1'; & <python> -B -I python/member_analysis/tests/test_worker.py` | 0 | **2 tests passed**，0.131s |
| 设置 `MEMBER_ANALYSIS_TEST_PYTHON=<python>` 与 `PYTHONDONTWRITEBYTECODE=1` 后运行 `vitest run src/main/shards/member-analysis/pipeline.integration.test.ts` | 0 | **1 file / 1 test passed**，0 skipped；integration 实际执行 |
| 第一次 `vitest run` | 1 | 86 files：85 passed、1 failed；463 tests：462 passed、1 failed；0 skipped。失败为既有 self-update 测试的 50ms `Promise.race` 超时 |
| `vitest run src/main/shards/self-update/update-executor.test.ts` | 0 | **1 file / 5 tests passed**；同一断言未复现 |
| 第二次 `vitest run` | 0 | **86 files / 463 tests passed**；**0 skipped、0 failed、0 unhandled error** |
| `typecheck:node` | 0 | passed |
| `typecheck:web` | 0 | passed |
| `node scripts/check-member-analysis-data-leaks.mjs` | 0 | 文档同步前 passed（1,506 files）；文档同步后最终复跑仍为 0，扫描 **1,507** 个 tracked/candidate files |
| `node scripts/check-patch-surface.mjs --manifest docs/fork/patch-manifest.json` | 0 | **9/9** upstream files；67/350 changed lines |

本任务仅新增/更新文档，没有修改 TypeScript、Python worker、构建配置或运行时代码，因此按任务规则没有重复执行 production `build`。Phase 8 历史报告中的 build 结果保持为历史证据，不冒充本次执行结果。

#### 4. worker contract 结果

源码测试确实由 Python 3.12.13 执行，两个 contract 均通过：

1. 合成匿名 summary 派生出 versioned game shape，5 个玩家且结果不含 token；
2. 合成 manifest 经真实源码 worker 写入 staging SQLite，worker 最终状态为 `completed`，`integrity_check` 为 `ok`，`derived_games` 为 1，且没有提前发布 current DB。

测试只使用仓库已有合成匿名 fixture 和 `tempfile.TemporaryDirectory()`，未读取真实 LCU/SGP、玩家、token 或比赛数据。

#### 5. Electron main + Python pipeline integration

focused integration 未显示 skipped：1/1 实际执行并通过。测试将匿名 normalized match 写入系统临时目录中的 repository，使用 `resolveWorkerLaunch` 以受控 Python 3.12 启动源码 worker，pipeline 完成后读到 1 场已发布对局（gameId 17、patch 26.1、Blue side），最后 `dispose`、关闭 repository 并递归删除临时 root。

带同一 `MEMBER_ANALYSIS_TEST_PYTHON` 环境变量的最终全量 Vitest 为 86/86 files、463/463 tests，0 skipped。原先因缺少解释器而跳过的 pipeline integration 已包含在实际通过数中。

#### 6. 第一次 full Vitest 波动分析

第一次全量运行唯一失败是 `src/main/shards/self-update/update-executor.test.ts` 的“download stream fails”用例：测试以固定 50ms 和 `executor.start()` 做 `Promise.race`，本次并行全量负载下先返回 `timeout`。失败输出和 462/463 计数已保留在上表。

- 分类：非 member-analysis 产品缺陷；一次性、负载相关的测试时序波动，不分配 P0～P3 产品缺陷等级。
- 影响：没有触及 Python worker、pipeline、数据、IPC 或 updater 可执行边界；官方 updater 仍由既有编译期/handler guard 禁用。
- 复核：立即单独运行该文件为 5/5，通过；不修改代码、不降低断言、不增加 skip 后，完整全量重跑为 463/463，通过且 0 skipped。
- 处置：本条件关闭任务不修改不属于 feature-owned 范围的 upstream test。若未来可稳定复现，应另立维护任务审查测试 deadline 与异步清理，而不是在本任务放宽 contract。

#### 7. 清理与残留检查

测试和 gate 结束后递归检查：

- Akari worktree 中 `__pycache__` / `*.pyc`：0；
- 排除依赖/packaged worker 后的临时 `.sqlite` / `.sqlite3` / `.db` / `.log`：0；
- 系统临时目录中的 `member-analysis-integration-*`：0；
- executable path 等于本次 bundled Python 3.12 的活动 `python.exe`：0。

因此没有 bytecode cache、临时 repository、测试 `userData`、日志、玩家数据或孤儿源码 worker 残留。无需执行额外删除。

#### 8. 缺陷与修复

- 本次 Python 3.12 worker contract 和 pipeline integration 没有发现代码缺陷。
- 未实施运行时代码、测试断言、contract、schema、构建配置或 updater 修改。
- 未解决 P0：0；P1：0。本次也没有新增 P2/P3。
- 第一次 full Vitest 的非稳定 50ms 时序失败按第 6 节保留证据；因 focused 与完整重跑均通过，不作为产品修复处理。

#### 9. 条件关闭判定

Phase 8 的 Python 3.12 环境条件已关闭，本地验收从 **PASS WITH CONDITIONS** 更新为 **PASS**：

- 确认为 Python 3.12.13 Windows x64；
- worker source contract 2/2 通过；
- pipeline integration 1/1 实际执行并通过；
- 最终 full Vitest 86/86 files、463/463 tests，0 skipped；
- node/web typecheck、leak guard 通过；
- patch surface 保持 9/9、67/350；
- 无未解决 P0/P1；
- 无 bytecode、临时数据或孤儿 worker 残留。

该 `PASS` 只表示本地 Phase 8 实现验收条件关闭，**不表示正式发布就绪**。

#### 10. 仍然存在的正式发布 blocker

- Windows 代码签名证书与受保护签名流程；
- 独立 fork update feed、签名 manifest、artifact authenticity、原子切换和回滚验证；
- 干净 Windows 上的安装/升级/卸载、SmartScreen 与 AV 验证；
- 首次真实 upstream sync rehearsal。

真实 LCU/SGP refresh/cancel 没有在本任务重复运行，以遵守“不读取或生成真实玩家/比赛数据”的边界；Phase 7 的历史 live evidence 不被改写或冒充为本次结果。官方 updater 继续不可执行，patch surface 没有新增第 10 个上游文件。

本任务没有部署、发布、release、commit、push 或创建 PR。

---

## 2026-08-02：成员 Riot ID 粘贴自动拆分

### 范围与行为

- 成员设置中的 Riot ID 输入框支持直接粘贴 `游戏名#Tag`，按最后一个 `#` 自动拆分并同时填写游戏名与 Tag。
- 拆分前后会去除两侧空白；缺少游戏名、缺少 Tag 或完全不含 `#` 时不拦截粘贴，保留原有手工输入行为。
- 输入框提示更新为“Riot ID（可粘贴 名称#Tag）”。服务器 ID、成员上限、保存确认、IPC 和数据边界均未改变。
- 解析只发生在 renderer 本地表单中，不读取 LCU/SGP、不新增 IPC、不写入运行数据，也不记录粘贴内容。

### 实现与验证

- 新增 feature-private `riot-id.ts` 解析器，并由 `MemberAnalysisSettingsDrawer.vue` 通过 Naive UI `inputProps.onPaste` 使用。
- focused Vitest：**1 file / 3 tests passed**，覆盖完整 Riot ID、空白规范化和普通文本不拆分。
- 最终 serialized full Vitest：**88 files / 469 tests passed**，0 skipped、0 failed。
- `typecheck:node`、`typecheck:web`：通过。
- Electron production build：通过；仅保留既有 CSS `@reference` 与大 chunk 警告。
- 最终 leak guard：通过，扫描 **1,695** 个 tracked/candidate 文件；测试只使用合成匿名标识。相较构建前计数增加的是独立 unpacked 测试包候选文件，不是玩家数据。
- patch guard：通过，仍为 **9/9** 个上游文件、**67/350** changed lines；本优化全部位于 feature-owned 文件。
- 独立 unpacked 测试包生成于 `.phase7-package/paste-optimization/win-unpacked`；artifact scan 通过：**127 files、58 worker hashes**。

### 后继修正：设置抽屉仅覆盖成员分析内容区

- 问题：Naive UI Drawer 默认 Teleport 到 `body`，其全窗口遮罩和层级会覆盖左侧导航 Tab 及顶部标题栏/窗口控制按钮。
- 修正：将 Drawer 定向挂载到 `.member-analysis-page`，并把该页面设为相对定位容器。抽屉与遮罩现在只占据成员分析右侧内容区，不再进入左侧导航或顶部标题栏的几何范围；没有通过任意降低全局 `z-index` 破坏弹层交互。
- focused Vitest：**2 files / 17 tests passed**，包含抽屉挂载目标 contract。
- 最终 serialized full Vitest：**88 files / 469 tests passed**，0 skipped、0 failed。
- `typecheck:node`、`typecheck:web` 与 Electron production build：通过；仅保留既有 CSS `@reference` 和大 chunk 警告。
- 最终 leak guard：通过，扫描 **1,695** 个 tracked/candidate 文件；patch guard 保持 **9/9** 个上游文件、**67/350** changed lines。
- 已更新同一独立 unpacked 测试包，artifact scan 再次通过：**127 files、58 worker hashes**。尚待人工确认实际视觉边界和标题栏按钮可点击性。

旧 `.phase7-package/win-unpacked` 当时仍有人工审核进程运行，因此未强制终止进程或覆盖旧包。本次未部署、未发布、未 commit、未 push、未创建 PR，也未生成或持久化真实玩家数据。

---


## 2026-08-02???????????????????

### ??

?????????????????????????????? `0.00` ???????????Python ???SQLite ??? Vue ????????????????????????????? `analyze_five_stack.py`?`analyze_lane_bp.py`?`analyze_joint.py`?`export_dashboard_data.py` ? `member-role-dashboard/app/dashboard.tsx` ?????????????????????? runtime?HTTP ????????

?????????????

1. ????????????????????????????????????????????????
2. ??/??/????15/20 ?????????????????????????????????? UI ???????? `0.00`?

???????????????? UI ???

### ????????

- main collector ??????????? PUUID????????????????????
- ???????????**??????????**???????????????????????????????????????
- raw summary ? `_target` ???????????????? `gameName#tagLine`?worker ???????5 ?????5 ??????????????
- ??? DETAILS ???????????????????????????????? derived DB??????????????????????????
- ??????????????????????? published DB???????/??????????????????
- UI ? controller ????????????????????????????????????

### ??????

Python 3.12 worker ???????????????

- ??/???KDA???????/??/????????DPM/GPM/CSPM???/????????????????????????????/??????????????/??????
- ???GD@10?GD@15?CSD@15?XPD@15????@15??????@15?
- ????????/??????@15??????@20?????@20????@15????@15???????@15?
- ??????????/???3/4 ???????????????????????/??/???????????
- ??????????/?????????????????????????????????????????
- ???????????????????/??/??????????????????????????????????/????20/50/100/???????????????????

OP.GG ??????????/?????????? adapter?????????? `?`?????????? `0.00`??????????????????????????????? `?`?

### ???????

- `MEMBER_ANALYSIS_DATA_VERSION` ??? 2?worker ? metadata ?? `derivation_version=2`?
- repository ??????????? analysis DB ?? first-run????????????
- ?????????????????? v2 ???raw ???????? DETAILS???? checksum watermark ???????

### ???????

- Python 3.12 ?? contract?**3/3 passed**?????????????????GD@10/15?CSD/XPD/????15/20 ??????????????? SQLite staging?
- packaged worker contract?**3/3 passed**?SQLite integrity `ok`?
- focused member-analysis Vitest?**16 files / 58 tests passed**????????? full Vitest?**88 files / 473 tests passed**?0 skipped?0 failed?
- `typecheck:node`?`typecheck:web`????
- Electron production build????????? CSS `@reference` ??? 500 kB chunk ???
- leak guard???????? **1,797** ? tracked/candidate ???????? fixture?token?raw?analysis???? cache ???
- patch guard?????? **9/9** ??????**67/350** changed lines?
- production worker ?? Python 3.12.13 / PyInstaller 6.16.0 ?????manifest ? **58 files**?manifest SHA-256?`3B666EE5B8A1B993844649F3D79E61E7995B54C0A78D0F88D1577C8D9D15855C`?
- ?? unpacked ??`.phase7-package/alignment/win-unpacked`?artifact scan?**127 files?58 worker hashes**?
- Python/PyInstaller ?????spec?work?dist ? `__pycache__`/`.pyc` ???????? Markdown ???

### ??????

?????????? `.phase7-package/alignment/win-unpacked/LeagueAkariCCB.exe` ?????? `--user-data-dir` ???????????? derived DB ????? first-run????????????

1. ??????????????????????????
2. ?????????????????????????????????`?`??????
3. ???????????????????????????????????????????
4. ??????????????????????????????????????????????????????

????? LCU/SGP ????????????????????????????????????????????????? commit?? push???? PR?


### ?????????????????

- ????????overview ?? `INVALID_ARGUMENT: Invalid overview cursor or filters`???? `LeagueAkariCCB-ManualAudit` ???????? schema issue ????????????????34 ?? 7 ???? `eventDecision.tradeDelayTotalSec` ? `>= 0` ???
- ?????????????????????? 30 ??? 90 ?????? `tradeDelayTotalSec` ??????worker ????????????? Zod schema ???????repository ???????cursor ? filters ???????
- ???`tradeDelayTotalSec` ????????????? contract ???????????? 34 ?????????? schema ???34/34 ??????????????
- ????????????? cursor ?? `INVALID_ARGUMENT`?stored payload ????????? `INTERNAL_ERROR`?????????????
- focused Vitest?3 files / 20 tests passed??? full Vitest?**88 files / 475 tests passed**?0 skipped?0 failed?
- node/web typecheck?Electron production build?artifact scan?127 files / 58 worker hashes??leak guard?1,797 files?? patch guard?9/9?67/350?????
- `.phase7-package/alignment/win-unpacked` ???????? build ?????? packaging ? Electron ?? TLS ??????????????????? artifact ???

---

---

## 2026-08-02：成员分析原生可视化重设计

### 调研与差距

本轮只读取 `member-role-dashboard/app/dashboard.tsx` 作为历史视觉与交互参考，没有启动、恢复或部署其 React runtime。旧版的主要能力包括 KPI 概览、蓝红方并列对比、英雄选用条、组合优势色阶、打野开野/方向/资源分组、事件决策流程、前期经济分桶、成员关系图、二维散点和卡片式逐场信息。改造前原生页已经具备一致的本地聚合语义与十个 Tab，但除简化散点和静态默契块外，大多数业务视图仍以 `NDataTable` 或 `NStatistic` 为主，正负、样本可靠度和蓝红差异缺少图形层级。

同时检查了 League Akari 主窗口标题区、Sidebar、设置抽屉、比赛卡片、Naive UI 控件及 `theme-system.css`。最终设计沿用 Akari 的轻量 surface、细边框、紧凑间距、Naive UI 交互和 `--la-*` 主题变量，没有引入新图表依赖、HTTP、WebView、renderer 文件系统能力或新的 IPC。

### 实际视觉改造

- **总览**：可点击 KPI 卡、正负状态条、最近胜负序列、经济差 sparkline、蓝红方样本/胜率分段条、固定五路成员快照。
- **成员分路**：指标组切换、五路标识、相对强度 mini bar、正负色阶、场次可靠度、常用英雄摘要；精确表格保留在图形摘要下方。
- **英雄**：英雄选用率横条与胜率点标记、成员/分路同步筛选、蓝红胜率详情卡、KDA/DPM/GPM/伤害转化/GD@15 摘要。
- **分路组合**：上野/中野/下辅热力卡、组合胜率、最低样本提示、蓝红方结果、经济/资源/OP.GG 优势中轴条；缺失 OP.GG 值继续显示 `—`。
- **打野**：己方/入侵开野环图、红蓝/F6/三狼分段、三路抓人/半区亲和柱、3/4 级抓人率、资源控制和 GD/XPD 发育条、蓝红方对比。
- **事件决策**：击杀兑现、死亡代价、资源团、跨图交换四区流程卡；风险条、蓝红对比和近期高代价对局卡。交换延迟使用有符号显示，负值保持合法语义。
- **前期转化**：15/20 分钟切换、领先/翻盘/未转化摘要、经济分桶柱与胜率点线、正负中轴、逐场胜负分布和明细表。
- **成员默契**：固定成员节点网络、按可靠度加粗的边、正负边色、成员聚焦、关系选择详情、共同胜率/基线/提升/可靠度/默契分。
- **二维散点**：可切换双轴、自动扩展相同值域、五级刻度/网格、分路图例、偏移标签、SVG `title` Tooltip、精确值表。
- **对局明细**：胜负边框、蓝红标签、时间/gameId/时长/版本、固定五路成员与英雄、可折叠关键指标，并提供进入 Akari 对局页的入口。

全局筛选区改为常用筛选首行、可折叠高级筛选、当前有效样本数、启用条件计数和一键重置。所有图表继续由现有 store 数据和 Vue `computed` 派生，切换 Tab 不重新拉取整份 IPC 数据。

### 数值、主题、响应式与可访问性

新增 feature-private 可视化纯函数，统一 `null/undefined -> —`、真实零、正负号、宽度约束、样本可靠度、散点 domain/position 和固定五路 roster。图形色彩通过页面语义变量建立在 Akari surface/text/link 变量之上，蓝红、正负均同时带文字或位置表达，不依赖颜色单独传达。SVG、卡片和表格支持键盘焦点/ARIA/原生 Tooltip；`prefers-reduced-motion` 下关闭 bar transition。

CSS 在 1100、900、760px 阶段将三列/五列内容逐步折为两列或单列；筛选器与散点允许局部横向滚动，表格继续使用 `scroll-x`，页面只保留 Akari 内容容器的单一纵向滚动。Windows packaged-app 人工检查确认深色主题下标题、Sidebar、feature-disabled/empty 语义和设置抽屉正常；抽屉仅覆盖成员分析内容区，不覆盖左侧导航或顶部窗口按钮。ready 图表的最终像素级复核仍建议在匿名且有样本的本地 userData 上完成。

### 测试、构建与本地包

- focused member-analysis Vitest：**4 files / 28 tests passed**；新增覆盖 null/零/正负格式、可靠度、正负 tone、相同值散点范围、固定五路、第六成员排除、跨图负延迟和经济分桶边界。
- 最终 full Vitest：**88 files passed、1 skipped；480 tests passed、1 skipped、0 failed**。原命令在 Windows 高并发下曾触发既有 updater 50ms 防挂死断言，未修改该上游测试；关闭验收窗口后的最终原命令复跑通过。
- `typecheck:node`、`typecheck:web`：通过。
- Electron production build：通过；仅保留既有 CSS `@reference` 与大 chunk warning。
- leak guard：通过，最终扫描 **1,609** 个 tracked/candidate 文件；没有加入真实玩家 fixture、日志、Token、缓存或数据集。
- patch guard：通过，保持 **9/9** 个上游文件、**67/350** changed lines；可视化实现均位于 feature-owned 文件。
- unpacked artifact：`.phase7-package/visualization/win-unpacked`。
- package scan：**127 files、58 worker hashes passed**；worker manifest 与 `process.resourcesPath/member-analysis/worker` 固定路径保持有效。

人工启动命令：

```powershell
.\.phase7-package\visualization\win-unpacked\LeagueAkariCCB.exe
```

本轮没有部署、发布、release、commit、push 或创建 PR；没有启用官方 updater；没有创建新的 Markdown 文件。


## 2026-08-02????????????????????

### ????? 28 ?????

??????????? `collector.ts` ??????? PUUID ????? SGP SUMMARY?`startIndex: 0, count: historyDepth`?????? gameId ??????? PUUID ???????? `historyDepth=100` ???????????????? 100 ???????????????? 100 ?????????????? 28 ??? main collector ??????????queueIds ?? PUUID ?????????????????????? 28 ???????????? 120 ?????????????? 100 ?????????????????????????? 2/3 ????????? 20/50/100 ??

Riot ID ??? main ????????????????????????????????? PUUID????????participant ???????????? Tag ????????????????? PUUID ?????????? 5?20 ??????????????????? PUUID???????????????????????????????????????????? `__sgpServerId` ? SGP SUMMARY/DETAILS???? renderer?LCU fallback?worker ? repository ? historyDepth ???????

### ?????????

- `historyDepth` ??????????????? queueIds ????????????? 20/50/100/200?
- ?????????? 100 ? SGP SUMMARY??? offset ???????????? `max(1000, historyDepth * 20)`??? 5000 ??
- ??? `(serverId, gameId)` ??????????/??????? summary ????? PUUID ???????????????????????????
- ??????????????? N ????????????????????????????????????????????????????????
- queueIds ?? collector ?????DETAILS ??????????????checksum ????? DETAILS??????????????? worker ???? staging?
- renderer ????????/???????sampleSize 20/50/100/all ????????`all` ??????????????overview ??? historyDepth?renderer keyset cursor ????????????????????
- ??????? staging integrity check ? rename ????????????? published DB??????? 3?? DB ???? UI ??????????????????

### ??????????

??? collection_audit ???????????????/??????? Riot ID?PUUID?gameId?Token ????????published metadata ??? Vue ???????/????????????/??/?????????/????????????????????????????DETAILS ??/??/???raw catalog?worker ???staging?published?overview?renderer ?????sampleSize ??? Tab ???

????????`resolvedMembers=requestedMembers >= 5`?`sourceIntersection <= sourceUnion`?`fiveSameTeam <= fivePresent <= sourceUnion`?`queueEligible <= mapEligible <= fiveSameTeam`?`targetSelected=min(historyDepth, queueEligible)`?`detailSucceeded=rawCatalog=workerReceived=stagingGames=publishedGames=overview.gameCount`?`rendererTab <= sample <= global <= overview.gameCount`?? published ?????UI ?? `source-exhausted` ? `safety-limit`???????????????????

### ????? Gate

??/??????????????? 100 ????????????????????????????/??/??????????????/Tag ??? PUUID ?????? PUUID?queueIds?historyDepth 20/50/100 ?????renderer sampleSize 20/50/100/all ?????side ? sample ????worker/raw/staging/published ???????/???????overview ????10k ??/?????? fixture????? HTTP/WebView/renderer filesystem ?????

- Python 3.12.13 source worker contract?3/3 passed??? Python pipeline integration?1/1 passed?0 skipped?
- packaged worker ?? Python 3.12.13 / PyInstaller 6.16.0 ????? executable contract?3/3 passed?manifest 58 files?SHA-256 `6BFB34E4D1C834EB00C9567C38E3C7D99B5289E9930B22156D230F1ECC33F5A9`?
- `typecheck:node`????`typecheck:web`????
- ???? `vitest run` ????????? 10k SQLite ??? self-update ?? 5 ?????????? 15/15 ????????????????? 89/89 files?487/487 tests passed?Python integration ?????
- `build`????31969 renderer modules transformed??????? lightningcss `@reference` ? chunk-size warning?
- data leak guard????patch surface?9/9 upstream files?67 changed lines??? 350 ????`git diff --check`????

????? 28 ??????????????????????????????????????????????????????????????????????????????????????


### 2026-08-02 follow-up?SGP ?????????????? 28 ?

?????? 28 ??????????????collector ?? `count=100` ?? `response.games.length < 100` ??????????? `page * 100` ?? `startIndex`?SGP ????????????????????????????????????????????? job ??????????

??????????? offset?`startIndex` ???????????????????????????????????????????????????? 250 ????????????????????? 100????????? 20 ??cursor ????? 0/20/40/.../160??? 9 ??????? 120 ???? 50 ??????????? 6?20 ????????????focused collector 10/10?typecheck:node?data leak ? 9/9 patch gate ???


### 2026-08-02 follow-up???????? staging 0 ?

???????? metadata ????published DB ???? 20:10:55 ?? `collection_audit`?22:28 ?? staging DB ? 0 ?????? worker ??????????? 28 ?????????? published ?????? collector ?????? 28 ??????????? terminal job failure?????????????

?????collector ???????? historyDepth ?????????? PUUID ?????? TOP/JUNGLE/MIDDLE/BOTTOM/UTILITY ??????????MID/SUPPORT ??????????????????? queue ?????? worker????????????????????? `roleEligible`??????????????????????????????/?????????? 100 ?????????????? 20 ????????????? 20 ??focused 4 files / 31 tests?node/web typecheck??? Python pipeline integration ????

### 2026-08-02 follow-up: Windows atomic publish recovery

The yellow legacy-result banner was traced past collection and worker export using aggregate-only diagnostics. The currently published database still contained 28 legacy rows and no collection audit, while the completed staging database contained 150 rows with a valid integrity check and a complete anonymous audit (150 role-eligible inputs, 150 worker inputs, 150 staging rows, and 150 expected published rows). The refresh therefore completed collection and worker generation but failed during the final staging-to-published file switch; the 28 count was no longer the new collection result.

`MemberAnalysisRepository.publishStaging()` now checkpoints the staging WAL before validation, closes the staging connection before file operations, removes stale SQLite WAL/SHM sidecars, retries transient Windows `EACCES`/`EBUSY`/`EPERM` rename failures, and rolls the previous database back if any publish step fails. Repository coverage includes publishing a WAL-backed staging database in the presence of stale sidecars, while the existing failed-publish test continues to verify that the previous published version is preserved.

Focused verification: repository/pipeline tests 15/15 passed; node and web typechecks passed; data-leak guard passed; patch-surface guard passed at 9/9 upstream files and 67 changed lines.

### 2026-08-03 follow-up: ranked-feed history coverage

An aggregate-only comparison with the retired dashboard established that its exported payload contained 193 five-member games, all from ranked-flex queue 440. The native refresh audit contained 150 published games (151 queue-eligible and one role-ineligible) even though the configured queue set included 440. This difference formed during history collection, not in the worker, repository, overview, or renderer.

The remaining cause was a data-source query semantic difference: the retired collector requested the SGP `ranked` history feed, while the native collector paged only the unfiltered history feed. SGP retains/caps these feeds independently; exhausting the unfiltered feed therefore does not prove that older ranked games have been exhausted. A busy member's other modes can displace older ranked-flex games from the unfiltered feed even though they remain available through `tag=ranked&tagsQueryType=AND`.

The collector now starts directly with the ranked feed when only ranked queues (420/440) are selected. For mixed queue settings it scans the unfiltered feed first and, if the final effective-sample target is still unmet, supplements it with the ranked feed. Feed-local pagination detects repeated cursors, while the cross-feed PUUID/game-key set deduplicates overlapping matches before five-member same-team, map, queue, and role checks. It remains bounded by the existing per-member scan limit, request limit, target stop, and cancellation checks.

Anonymous coverage verifies that a mixed unfiltered feed can exhaust below the target and that an older ranked page completes the target without duplicates. Collector tests pass 12/12. The complete Vitest gate passes 88 files plus one skipped file and 491 tests plus one skipped test; node/web typechecks and the production build pass. The first full Vitest attempt exposed one unrelated self-update timing timeout, whose focused rerun passed before the complete suite passed on rerun.

### 2026-08-03 follow-up: legacy/native member-pool mismatch

A post-refresh aggregate audit proved that the in-app refresh did publish successfully: the current database was regenerated with 150 worker inputs, 150 staging rows, and 150 published rows. The ranked-feed scan also ran, with per-member ranked histories and source-exhausted status recorded. Therefore the persistent 150 was not a stale published database or a renderer cache.

An anonymous stable-identity set comparison then found that the retired dashboard dataset used an 11-member pool, whereas the current native settings used 10 members. Their stable-PUUID intersection was 9: two legacy-pool identities were absent and one different identity was present in the native pool. No Riot ID or PUUID was emitted or recorded in this investigation. Since valid matches are defined as exactly five configured pool identities on the same team, these are different analysis cohorts and cannot be expected to reproduce the same game set. The old export's 193 games therefore cannot be used as an acceptance count until the native member pool is made identical.

The current refresh audit reaches 159 five-member same-team/map candidates, 151 queue-eligible candidates, and 150 complete-role published games. This confirms the 150 count is formed by cohort matching and eligibility after a successful refresh, not by a failed atomic switch. Reproducing the retired 193-game cohort requires configuring the same 11 stable identities and queue 440; an exact count still may change as SGP history availability and new matches change, so the product must report audited counts rather than fabricate or guarantee a historical constant.

---

## 2026-08-03：成员分析总览驾驶舱增强

针对“已有卡片和表格但结论仍不直观”的反馈，本轮把原生 `member-analysis` 总览从指标集合改为“结论 → 异常 → 证据 → 下钻”的分析驾驶舱，没有恢复退休的浏览器原型，也没有改变 IPC、数据采集或本地存储边界。

- 顶部新增当前胜率环、近五场状态和自动生成的状态结论，胜负数量与样本量同时显示，避免只看百分比。
- 新增三条自动洞察，直接指出前期经济、最需关注分路和蓝红方差异；每条均可跳转到对应原生分析 Tab。
- 近期走势改为胜负与 20 分钟经济差合并的正负柱图，同一时间轴同时表达结果和过程，而不是分离的小色块与折线。
- 新增经济、推进、小龙、巢虫、资源团五维前期指纹雷达图，并在右侧保留精确带符号数值，图形不替代原始证据。
- 四个关键 KPI 使用带中心基线的领先/落后条；蓝红方改为并列胜率条并自动给出偏差结论。
- 五路成员卡同时展示胜率、GD@15 和主要英雄，继续保持固定五路且支持下钻。
- 新增 `centeredScore`、`radialPoint`、`radarPolygon` 纯函数和边界测试；空值、零值、极端值和有限 SVG 坐标均有覆盖。
- 响应式在 1100px 和 760px 下逐步折叠；交互卡继续提供键盘焦点，正负与胜负不只依赖颜色表达。

本地验收：focused member-analysis **2 files / 20 tests passed**；完整 Vitest **88 passed、1 skipped files，492 passed、1 skipped tests，0 failed**；node/web typecheck 通过；Electron production build 通过，仅保留既有 CSS `@reference` 和大 chunk warning；data leak guard 通过（1,609 个 tracked/candidate files）；patch guard 保持 **9/9** 个上游文件、**67/350** changed lines。未新增依赖、HTTP、WebView、renderer 文件系统能力或 IPC；未部署、发布、commit、push 或创建 PR。

### 2026-08-03 follow-up：按设计技能审计移除模板化 Dashboard 语言

用户复核指出上一版仍然明显偏“工程师式 AI dashboard”。本轮按已安装 `visualize` 技能的图表/界面规则，并参考检索到的 Anthropic `frontend-design` 与 `ui-design-system` 公开准则，重新审视总览。远程 Skills CLI 安装因当前环境访问 GitHub 时 TLS 被隔离而失败；没有伪造安装成功状态。

重做删除了装饰性的胜率环、五维雷达、英文 eyebrow、编号自动洞察、渐变光晕和重复圆角卡片。新总览只保留四段清晰层级：紧凑比分板；以最近十二场胜负与 GD@20 为主的单一主图；共享零基线的五项前期小倍图；安静的蓝红/兑现对比与五路成员表。关键值直接标在图形和行内，结论只陈述可由当前样本直接验证的事实，不再生成泛化的状态话术。

Focused member-analysis Vitest：**2 files / 19 tests passed**；node/web typecheck 与 Electron production build 通过；data leak guard 通过（1,609 files）；patch guard 仍为 **9/9、67/350**。仅保留既有 CSS `@reference` 与大 chunk warning。本轮未新增依赖、IPC、HTTP、WebView、玩家数据、commit、push 或 PR。

---

## 2026-08-09：成员分析比赛模式改为复用 Akari SGP 标签

用户澄清“排位积分类模式”不能硬编码为 queue 420/440，因为 League Akari 的模式列表中还可能动态出现“5人排位赛”等具体队列。本轮撤回固定队列方案，并直接对齐 Akari 现有比赛记录筛选语义。

- 设置字段由数值 `queueIds` 改为 SGP `historyTag`，默认值为 `ranked`。
- 设置抽屉复用 `useSgpTagOptions()`；通用项中的“排位积分类模式”沿用 Akari 的 `tag=ranked&tagsQueryType=AND` 定义，具体模式来自 Akari/SGP 的 `supportedQueues`，因此可显示并选择“5人排位赛”等当前客户端支持的队列。
- 为避免无边界全历史扫描，成员分析设置隐藏“所有模式”，但保留 Akari 提供的分类与具体模式选项。
- collector 对分类标签（如 `ranked`、`normal`）完全信任 SGP 标签结果；选择 `q_<queueId>` 具体模式时，再以 summary 的 queueId 做一次一致性校验。
- 旧版没有 `historyTag` 的本地设置在恢复时自动采用 `ranked`，不迁移或伪造为 420/440 固定集合。
- schema 允许 `ranked`、`normal` 和受限格式的 `q_<id>`，拒绝 `all`、任意字符串和路径式输入。

Focused verification：**7 files passed、1 skipped；45 tests passed、1 skipped**；node/web typecheck 通过；Electron production build 通过，仅保留既有 CSS `@reference`、插件耗时和大 chunk warning；data leak guard 通过（1,609 files）；patch guard 保持 **9/9、67/350**。未启动退休网页 runtime，未新增 HTTP/IPC/依赖，未写入玩家数据，未 commit、push 或创建 PR。

---

## 2026-08-09：历史目标与扫描安全上限解耦

成员分析原先只允许 20/50/100/200 场固定五人结果目标，并通过 `max(1000, historyDepth * 20)` 隐式推导单成员扫描量。本轮将最终结果目标与上游扫描边界显式拆分。

- 结果目标增加 500、1000 和 `all`；`all` 在 UI 中显示为“全部有效样本（受扫描安全上限约束）”。
- 新增 `scanLimitPerMember` 设置，允许 100–5000，步进 100，默认 2000；这是每名成员最多读取的 SGP 历史条目数。
- 数字目标达到后仍提前停止；`all` 不再按结果数量提前停止或切片，而是持续到各成员历史源耗尽、扫描安全上限或既有请求循环上限。
- collector 仍保留 5000 条硬上限、分页去重、重复页检测、取消检查、请求循环上限和原子发布；“全部”不是无限网络请求。
- 审计 contract 的 `targetHistoryDepth` 支持 `all`；UI 显示“全部”，且只对数字目标显示“未达到目标”说明。
- 旧设置自动恢复默认扫描上限 2000，不影响既有成员、比赛模式和本地数据库。

Focused verification：**6 files passed、1 skipped；44 tests passed、1 skipped**，包含 120 条合成有效样本在 `all` 下全部发布并以 `source-exhausted` 停止；node/web typecheck 和 Electron production build 通过；data leak guard 通过（1,609 files）；patch guard 保持 **9/9、67/350**。仅保留既有 CSS `@reference`、插件耗时和大 chunk warning。未新增 HTTP/IPC/依赖，未读取或写入真实玩家数据，未 commit、push 或创建 PR。

---

## 2026-08-09：成员分析原生数据终端 UI 全面复核

本轮先对原生 `member-analysis` 的全部 Tab、筛选区、设置抽屉和宽窄窗口状态做了代码与运行截图审计，再按“结论 → 证据 → 下钻”的单一叙事重构视觉层级。设计依据包括已安装的 Anthropic `data-visualization`、`frontend-design`、`visualize` 与 accessibility skill；方向是 League Akari 原生、安静、紧凑的数据终端，而不是通用 SaaS/AI Dashboard。审计确认原界面的主要问题是重复圆角卡片和边框过多、首屏摘要分散、图表与表格争抢注意力、装饰性圆环/双重编码、窄窗筛选器拥挤，以及部分交互仅靠颜色或缺少明确图形语义。

- 为 feature 建立私有视觉 token 与统一标题层级，压低边框、圆角、说明文字和容器噪声；顶部仅保留三个必要摘要，并把样本量、时间与单位放回相应数据附近。
- 总览、成员分路、英雄、组合、打野、事件决策、前期转化、默契网络、散点图和对局明细统一使用共享视图标题；详细表格降为安静的证据层，对局条目改为分隔行而非卡片墙。
- 打野页移除装饰性圆环，改为直接标注的同基线开局资源对比；前期转化移除与柱形重复表达的胜率折线/圆点；散点图加入路位形状编码、图例与 SVG 标题/描述，不再仅靠颜色区分。
- 默契网络补齐键盘激活与 ARIA，方法公式改为可折叠说明；全局审计详情也改为按需展开。筛选器、设置抽屉和成员输入在窄窗下重新排布，并保留 `focus-visible`、tooltip、直播区域和 `prefers-reduced-motion` 支持。
- `updateSettings` 对旧式缺字段输入恢复 `scanLimitPerMember: 2000` 默认值；这是设置兼容性修复，不改变指标计算口径、historyTag、all 模式、刷新取消、审计或原子发布逻辑。

截图复核使用仓库外临时目录，覆盖深色主题、常见桌面宽度、较窄窗口、带数据的旧版基线，以及新版 disabled/设置状态；复核后临时截图和隔离 userData 均删除。复核中继续修正了首屏摘要过量、筛选器横向挤压、图表装饰性编码和证据表抢焦点。由于现有 League Akari 实例的单实例锁与隔离 userData 不共享正式样本，新版全部带数据 Tab 的最终视觉仍需在用户的真实本地样本上做一次人工确认；不会为截图复制、记录或提交玩家数据。

本地验收：focused member-analysis Vitest **17 files / 80 tests passed**；node/web typecheck 通过；Electron production build 通过（31,970 renderer modules transformed，仅保留既有 CSS `@reference`、插件耗时和大 chunk warning）；data leak guard 与 patch surface guard 通过，patch surface 保持 **9/9 upstream files、67/350 changed lines**；`git diff --check` 通过。完整 Vitest 额外尝试在限定时间内未返回汇总，因此不把它误报为通过。未新增图表依赖、HTTP、WebView、renderer 文件系统能力或 IPC；未启动退休网页 runtime；未提交玩家数据；未部署、发布、commit、push 或创建 PR。

### 2026-08-09 follow-up：真实数据 dev 截图闭环

用户补充了带现有 `userData` 启动 dev 的正确方式后，前述“新版全部带数据 Tab 仍需人工确认”的限制已解除。本轮通过 Electron dev 的 CDP 端口连接原生主窗口，在不复制数据库、不暴露 IPC、不启动退休网页 runtime 的前提下，实际加载当前 50 场有效样本并逐页检查总览、成员分路、英雄、组合、打野、事件决策、前期转化、默契、指标散点、对局明细和设置抽屉。宽窗与窄窗均分别截取顶部和内部滚动容器底部；截图只写入系统临时目录，复核完成后删除，不进入仓库或报告。

真实截图暴露并修正了三项仅靠代码审计未能发现的问题：默契网络在 46 条关系下成为不可读的连线团，现改为共享中线的正负默契关系排序，仅展示最有解释力的前 12 条并保留精确证据表；36 个成员分路散点的全量姓名严重重叠，现只直接标注高样本和极值点，近邻标签自动抑制，其余点通过键盘焦点、悬停、ARIA 和下方精确表查看；设置抽屉的说明文字曾与输入控件并排挤压，现改为字段内纵向排列，窄窗顶部和底部均无重叠。

新增 `scripts/member-analysis-ui-audit.mjs` 和 `audit:member-analysis-ui` 命令。脚本连接已运行 dev 实例，安全关闭常见首次运行对话框，自动遍历十个 Tab、宽窄窗口、顶部/底部和设置抽屉；输出固定进入系统临时目录，并在每次运行前清空旧审计目录。最终 focused member-analysis Vitest **17 files / 80 tests passed**；node/web typecheck 与 Electron production build 通过（31,970 renderer modules transformed）；data leak guard 通过（1,610 files）；patch surface guard 为 **9/9 upstream files、68/350 changed lines**；`git diff --check` 通过。未提交、推送、发布或部署。



### 2026-08-09 follow-up：指标语义优先的可视化重排与第二轮截图

本轮把可复用 UI 审计流程固定为九步：先保留工作区并审计源码/数据口径；用指定 Python 启动原生 Electron dev；通过 CDP 处理首次运行提示并进入成员分析；对十个 Tab、筛选区、设置抽屉分别截取宽/窄窗口的顶部和底部；在仓库外临时目录生成接触表并逐张查看原图；逐项回答“问题、单位、分母、基线、比较范围、样本量和不确定性”；仅在语义明确后选择图形；实现后重跑整套截图；最后清理临时截图并执行测试与守卫。自动化脚本不再依赖整页 reload 或不稳定的文案等待，而是切换 hash 路由并等待原生视图稳定，避免常驻请求阻塞 `load` 事件。

视觉方向继续保持 League Akari 原生、安静、紧凑的数据终端，但新增一条更严格的规则：**只有单位、分母和基线一致的数值才能共享图形尺度**。单一总体胜率使用大数值、胜负场次和一条紧凑胜负组成条；跨英雄/组合的胜率使用固定 0–100% 点轴、50% 参考线、95% Wilson 区间和样本数；选用率从零起算并与胜率分列，绝不叠在同一柱内；次数从零起算；有正负方向的差值使用零中心发散轴；不同指标只做对齐小倍图；低样本使用空心点和文字语义，不虚构综合评分，也不只靠颜色表达结论。

实际重排覆盖总览、成员分路、英雄、组合、打野、事件决策、前期转化、默契、指标散点和对局证据层。英雄页将选用率与胜率拆成独立列，并为胜率加入 Wilson 区间；组合页同样改为固定胜率点轴；打野页把每场抓人次数、区域倾向率、资源差值拆成不同尺度，且开局入侵使用真实字段，不再用己方开野率的补数推断；事件决策页把百分比改为独立分母的 0–100% 点轴；成员分路只在同分路、同指标内归一化，带符号指标使用零中心；散点图默认限定单一分路并保留“全部分路（探索）”，减少位置职责混杂；默契页从不可读的关系毛线团改为共享中线的正负关系排序；前期转化把场次直方图和胜率点图做成共享分档的上下双面板；总览的经济柱色只表示领先/落后，胜负改为独立文字，并补充胜负组成条。

第二轮真实 dev 截图确认：英雄页的选用率与胜率已能独立比较，区间和样本紧邻数值；散点图默认中路后由 36 个混杂点降为 7 个同职责点，标签碰撞显著减少；事件决策不再出现“所有数字都是进度条”；设置抽屉窄窗无控件/说明并排重叠。截图也暴露前期转化 SVG 会按超宽容器等比放大，导致胜率面板掉出首屏，且胜率点引用了不存在的强调色变量；随后为图形设置合理最大宽度并改用既有正向 token，第三次截图确认场次与胜率两个共享分档面板已同时进入主要视区。仍需真实长期样本人工确认 Wilson 区间在更大样本下的密度、英雄同成员分路选用率的业务解释，以及极端稀疏打野事件的空状态文案。

本轮最终验证：focused member-analysis Vitest **16 passed / 1 skipped files，80 passed / 1 skipped tests**；node/web typecheck 通过；Electron production build 通过（31,970 renderer modules transformed，仅保留既有 `@reference` 与大 chunk warning）；data leak guard 通过（1,610 files）；patch surface guard 保持 **9/9 upstream files、68/350 changed lines**；`git diff --check` 通过。完整 Vitest 额外运行 300 秒后未返回汇总并被超时终止，因此不报告为通过。没有新增图表依赖、HTTP、WebView、renderer 文件系统能力或 IPC；未启动退休网页 runtime；未提交、推送、发布或部署。

### 2026-08-09 follow-up：总览、成员分路与英雄池按比较语义重构

用户复核指出前三个页面仍存在核心信息不明确、把 KDA 等不同单位指标机械画成柱状图、跨分路混排，以及英雄英文原名缺少 Akari 原生头像/中文名的问题。本轮只集中处理总览、成员分路和英雄池，暂不继续扩展后续 Tab。

- 总览改为单一结论叙事：先用真实样本生成一句可验证的当前结论，再以 20 分钟领先、接近、落后三种局势的固定 0–100% 胜负组成尺度作为主证据；总体胜率、前期过程指标和蓝红方结果降为二级证据，不再堆 KPI 卡或混用单位。
- 成员分路按上、野、中、下、辅拆成独立比较区，每区只比较同一路位成员。胜率使用固定比例点轴并同时标注胜负场次；KDA、击杀、死亡、助攻、参团率以及不同单位的效率/视野/功能指标只显示对齐精确值；只有 GD@15 使用有业务零点的发散轴。窄窗隐藏非核心英雄摘要和胜负拆字，避免无意义横向滚动。
- 英雄池先固定“成员 + 分路”，使选用率拥有一致分母；选用率用从零起算的结构条，胜率使用独立 0–100% 点轴、50% 参考线、95% Wilson 区间和胜负场次，GD@15 作为独立精确差值。英雄身份通过 Akari `gameData.champions` 解析中文名并复用原生 `ChampionIcon`，详情中的 KDA、DPM、GPM 等不同单位不再绘制比较柱。
- dev 截图复核覆盖 1440×900 和较窄窗口的三个页面；复核后继续修正窄窗胜负文案折行、英雄页无意义第四列滚动和角色证据列密度。审计脚本现在会在截图前把成员名、tag 和长对局编号替换为合成文本，并模糊侧栏头像；截图仍只写系统临时目录，不进入仓库。

最终验证：focused member-analysis Vitest **16 passed / 1 skipped files，80 passed / 1 skipped tests**；完整 node/web typecheck 与 Electron production build 通过（31,970 renderer modules transformed，仅保留既有 CSS `@reference`、插件耗时和大 chunk warning）；data leak guard 通过（1,610 files）；patch surface guard 保持 **9/9 upstream files、68/350 changed lines**；`git diff --check` 通过。未更改指标计算口径、IPC、historyTag、all 模式、扫描安全上限、刷新取消、审计或原子发布逻辑；未部署、发布、commit、push 或创建 PR。

### 2026-08-09 follow-up：移除总览并完成其余页面语义化收敛

按用户复核决定删除无明确使用价值的总览 Tab 和 `OverviewView.vue`，未指定或遗留 `overview` 路由现在统一落到“成员分路”。英雄详情头像增加固定方形容器并覆盖组件默认尺寸，修复右侧头像被 flex 拉宽的问题；对局证据同时复用 Akari 英雄资源显示方形头像和中文名。

- 成员分路的输出经济、视野、承伤功能、对线资源四组继续采用同分路分区表：不同单位只对齐精确值，GD@15 才使用零中心标尺；宽窗逐组截图确认字段密度和分区层级。
- 组合页从重复卡片墙改成上野、中野、下辅三个职责分区；胜率保留独立 0–100% 点轴与 Wilson 区间，经济、资源团和小龙差值只显示带单位精确值，窄窗主动删减次要列。
- 打野页从每人一张卡改成成员对齐表。开野百分比共享固定点轴；抓人次数、区域亲和、资源次数和发育差值分列，避免次数与比例共用柱长；完整字段仍留在证据表。
- 事件决策页改为四行决策账本，各指标继续保留真实独立分母；蓝红对比和高代价死亡改成安静的数据行。前期转化删除大量 W/L 点重叠的重复散点层，只保留分档场次、固定胜率尺度和逐场表。默契与散点保留已有业务图形，但散点窄窗将分路筛选独占一行并隐藏冗余图例。对局证据加入中文英雄名与原生方形头像。
- 最终 Electron 截图覆盖四个成员分路子组、英雄、组合、打野、事件决策、前期转化、默契、指标散点、对局明细及宽窄窗口。复核中修正组合/打野窄窗的无意义横向滚动、散点筛选器拥挤，以及连续运行审计时旧匿名 DOM 导致的脱敏失效；脚本现在先切换路由强制重新渲染，再采集并替换身份文本。

最终验证：focused member-analysis Vitest **16 passed / 1 skipped files，80 passed / 1 skipped tests**；完整 node/web typecheck 与 Electron production build 通过（31,967 renderer modules transformed，仅保留既有 CSS `@reference` 与大 chunk warning）；data leak guard 通过（1,609 files）；patch surface guard保持 **9/9 upstream files、68/350 changed lines**；`git diff --check` 通过。未改变任何指标计算、IPC 或数据管线逻辑；未部署、发布、commit、push 或创建 PR。

### 2026-08-09 follow-up：成员分路去除重复英雄维度并统一对线差值

本轮只调整“成员分路”。此前五个指标子页的快速比较表和证据表都重复追加“常用英雄”，该维度既不随当前指标组变化，又挤压同分路成员比较，因此从成员分路完全移除；英雄身份与使用情况统一留在“英雄”页下钻，不再把相同内容复制到核心表现、输出与经济、视野、承伤与功能、对线与资源。

“对线与资源”中的 GD@15 取消零中心条长编码，改为与 GD@10、CSD@15、XPD@15、伤害差@15、单杀差@15 一致的带正负号精确值。原因是此处的主要任务是读取方向和大小，而不是把多个不同单位的差值伪装成可共享长度尺度。页面说明同步改为“所有对线差值统一显示正负方向和精确大小”。自动截图脚本增加了不同子页的指定分路滚动复核：输出与经济/打野、视野/中路、承伤与功能/下路、对线与资源/辅助，并确认各分路边界、样本语义和表格密度保持清楚。

验证：focused member-analysis Vitest **16 passed / 1 skipped files，80 passed / 1 skipped tests**；node/web typecheck 通过；Electron production build 通过（31,967 renderer modules transformed，仅保留既有 `@reference` 与大 chunk warning）；data leak guard 通过（1,609 files）；patch surface guard **9/9 upstream files、68/350 changed lines**；`git diff --check` 通过。未改变指标计算、IPC 或数据管线；未部署、发布、commit、push 或创建 PR。
### 2026-08-09 follow-up：成员分路滚动上下文固定

成员分路的五组指标切换条现固定在原生分析 Tab 下方；当前分路表格的“成员 / 样本”和指标名称表头紧随其下固定，滚动进入下一分路时由下一张表的同构表头自然接替。为避免固定元素遮挡或贯穿无关内容，固定范围仅限五路快速比较区，进入“精确指标与蓝红方拆分”证据层后自动释放。Naive UI 默认的 tab pane 裁剪会阻断子视图 sticky 定位，因此原生分析容器只解除 pane wrapper 的视觉裁剪，不改变 Tab、路由或数据生命周期。窄窗口保留前三个最重要指标列，完整字段仍由证据层承载，不引入横向滚动。

复核覆盖宽窗输出与经济/打野、对线与资源/辅助及窄窗底部边界；focused renderer member-analysis Vitest **6 files / 34 tests passed**，web typecheck、data leak guard、patch surface guard（**9/9、68/350**）与 `git diff --check` 通过。未部署、发布、commit、push 或创建 PR。
### 2026-08-09 follow-up：固定分路上下文并清理需求回声式微文案

成员分路滚动上下文进一步补全：指标组切换条下方现在同时固定当前分路标题和该组指标表头，所以上一路尾部仍在视口时也能明确识别其归属；下一分路进入后由新的分路标题与表头自然接替。固定背景改为不透明主题底色，避免下层数值透出。

同时把“产品 UI 不应复述设计决策、实现约束、需求历史或图表选择理由”加入仓库根 `AGENTS.md` 的长期项目规则。可见文案只保留操作标签、数据标签、单位、时间/样本上下文、状态/错误，以及用户确实需要的业务定义；设计理由只写在对话和本记录。依此清理了成员分析标题、成员分路、英雄、组合、打野、事件决策、前期转化、默契、散点和对局证据中的需求回声式小说明，包括“仅使用本机分析数据”“所有对线差值统一显示……”“本区数值仅在……”“完整证据层……”等。样本量、胜负数、单位、分母、可靠度、错误/空状态和按需展开的计算口径继续保留。

截图复核确认输出与经济滚动状态同时显示固定“上路”、指标组与列名，英雄及事件决策首屏也不再有设计说明副标题。Focused renderer member-analysis Vitest **6 files / 34 tests passed**；node/web typecheck 与 Electron production build 通过（31,967 renderer modules，保留既有 `@reference` 和大 chunk warning）；data leak guard、patch surface guard（**9/9、68/350**）与 `git diff --check` 通过。未部署、发布、commit、push 或创建 PR。
### 2026-08-10：成员分路合并精确指标并加入蓝红方开关

“成员分路”移除底部重复的“精确指标与蓝红方拆分”数据表。五个指标组现在直接展示各自完整字段集：核心表现 8 项、输出与经济 7 项、视野 4 项、承伤与功能 11 项、对线与资源 10 项；场次继续放在成员行的样本上下文中，不重复占用指标列。宽窗可直接看到完整字段，窄窗通过同一页面滚动容器查看剩余列，不再隐藏后半指标。

蓝红方拆分改为指标组右侧的即时开关，默认关闭。关闭时每名成员一行总计；开启后按“总计 / 蓝方 / 红方”三行成组展开，分路人数和样本总数仍只按总计计算，不会因拆分重复计数。全局筛选已限定为单一阵营时开关自动隐藏。

指标元数据增加按需定义。KDA、DPM、GPM、CSPM、VSPM、WPM、WCPM、CWPM、GD@10/15、CSD@15、XPD@15，以及伤害转化率、参团率、线杀率优势和前期资源差等非显然指标，在表头使用点状提示并通过鼠标悬浮 `title` 显示英文全称、计算式或业务定义；明显指标不额外堆说明文字。自动截图审计新增定义非空检查及蓝红方开启状态，宽窗五组、指定其他分路、窄窗横向字段和拆分行均完成复核。

验证：focused member-analysis Vitest **16 passed / 1 skipped files，80 passed / 1 skipped tests**；node/web typecheck 与 Electron production build 通过（31,967 renderer modules，仅保留既有 `@reference` 与大 chunk warning）；data leak guard、patch surface guard（**9/9、68/350**）及 `git diff --check` 通过。未改变指标计算口径、IPC 或数据管线；未部署、发布、commit、push 或创建 PR。

### 2026-08-10 follow-up：蓝红方拆分收敛为单成员行

三行展开虽然精确，但会把成员列表高度放大到约三倍，破坏同分路成员的纵向比较。本轮将拆分结果合并回单一成员行：总计仍是每个指标的主要读数，开启“蓝红方拆分”后，仅在主值下方追加带“蓝 / 红”文字标识的两项紧凑次级读数，成员格同步显示两方样本数。阵营色只承担快速扫读作用，文字标签确保含义不依赖颜色；缺失阵营样本保留为 `—`，真实零值不被替换。关闭开关时行高和原总计视图一致。

Electron dev 截图复核确认：同一路位仍保持一名成员一行，首要视觉层级依次为总计、蓝方、红方；胜率总计继续保留胜负场次和固定比例轴，蓝红方只显示精确次级值，不为每个阵营重复图形。自动审计脚本同时强化重复运行时的隐私处理：每次截图前重新收集当前 Vue DOM 中可见别名，并固定替换侧栏名称、tag 与头像，避免控件重渲染后恢复真实身份文本。截图仅位于系统临时目录并在复核后清理。

验证：focused member-analysis Vitest **16 passed / 1 skipped files，80 passed / 1 skipped tests**；node/web typecheck 与 Electron production build 通过（31,967 renderer modules，仅保留既有 `@reference` 与大 chunk warning）；data leak guard 通过（1,609 files）；patch surface guard **9/9 upstream files、68/350 changed lines**；`git diff --check` 通过。未改变指标计算、IPC 或数据管线；未部署、发布、commit、push 或创建 PR。

### 2026-08-10 follow-up：胜率图统一显示 95% 区间

成员分路、英雄和组合的胜率点轴统一提取为 feature-private `WinRateInterval`：固定 0–100% 基线和 50% 参考线，圆点表示样本胜率，横线表示 Wilson 95% 区间；低样本继续使用空心点，真实 0%/100% 不会被当作缺失。组件同时提供包含点估计及区间上下界的 `aria-label` 和悬浮标题。成员分路表头定义同步说明区间语义，组合列名直接标注“95% 区间”。

前期转化的分档胜率图增加同口径的纵向 Wilson 区间和端帽，保留圆点作为点估计；事件决策中的“资源团胜率”也使用相同区间组件。复核时同时发现其界面分母曾错误显示为“取得资源事件数”，而计算实际使用 `objectiveFightSamples`；现只修正展示和聚合证据字段为真实资源团样本/获胜次数，不改变胜率计算口径。其他“击杀兑现率、干净资源率、跨图交换率、开野倾向”等比例不是比赛胜率，继续使用普通比例点轴，避免把不同事件定义误装成胜率区间。

Electron dev 截图复核覆盖成员分路、英雄、组合、前期转化和事件决策：区间均与点估计共享同一尺度，没有增加额外卡片或行高；低样本英雄的宽区间和大样本资源团的窄区间能够直接区分可靠度。验证：focused member-analysis Vitest **17 passed / 1 skipped files，82 passed / 1 skipped tests**；node/web typecheck 和 Electron production build 通过（31,970 renderer modules，仅保留既有 `@reference` 与大 chunk warning）。未改变 IPC、历史扫描、刷新或发布逻辑；未部署、发布、commit、push 或创建 PR。

### 2026-08-10 follow-up：英雄池改为全成员分路总览

英雄池取消“先选择某一成员与分路”的单对象模式，改为按上路、打野、中路、下路、辅助分区，并在每个分路内同时列出全部成员及其所有英雄。每个成员块直接标出分路样本、英雄数量和前三集中度；英雄行保留 Akari 原生头像、中文名、精确场次、胜负、Wilson 95% 区间和 GD@15，因此无需切换选择器即可纵向浏览五路全部成员。

选用率没有改成逐英雄环图。环图需要比较角度和弧长，在同屏 137 个英雄选择时会形成大量重复圆环，而且难以辨认 6.3% 与 14.3% 等接近比例。本轮改用固定 0–100% 的轻量点轴：精确百分比与“该英雄场次 / 当前成员当前分路场次”作为主标签，单个圆点只承担位置比较，不使用填充面积，也不与胜率共享图形。选用率的分母定义放在可聚焦表头 tooltip 中；每名成员明确分组，避免跨成员误用不同分母比较。

Electron dev 截图复核覆盖宽窗顶部/底部和窄窗：宽窗可同时读取英雄、选用率、胜率区间和 GD@15；窄窗保留前三列并隐藏对线次要列，不发生成员选择控件挤压。页面在现有 50 场样本下显示 36 个成员分路、137 个英雄选择。验证：focused member-analysis Vitest **17 passed / 1 skipped files，82 passed / 1 skipped tests**；node/web typecheck 与 Electron production build 通过（31,970 renderer modules，仅保留既有 `@reference` 与大 chunk warning）。未改变英雄聚合、选用率或其他指标计算口径；未部署、发布、commit、push 或创建 PR。

### 2026-08-10 follow-up：英雄池移除逐行图形并压缩密度

全成员英雄池在 137 个英雄选择下不再为每行绘制选用率点轴和胜率区间线。选用率改为百分比与“英雄场次 / 当前成员分路场次”；比赛结果改为胜率、胜负数和 Wilson 95% 区间上下界的纯文本。95% 区间语义仍完整保留，但不再占用额外图形行。

列标题从每名成员重复一次改为每个分路只显示一次；英雄头像缩至 26px，名称与场次合并为同一基线，数据行最小高度从 52px 级别收敛到 38px。Electron dev 宽窄窗截图确认，同一视口可见的英雄数量明显增加，分路、成员、英雄三级结构仍清楚，胜率区间和选用率分母没有被省略。验证：focused member-analysis Vitest **17 passed / 1 skipped files，82 passed / 1 skipped tests**；node/web typecheck 与 Electron production build 通过（31,970 renderer modules，仅保留既有 `@reference` 与大 chunk warning）。未改变指标计算口径；未部署、发布、commit、push 或创建 PR。

### 2026-08-10 follow-up：英雄池构成小倍图与单一证据面板

按讨论结果，英雄池从 137 行英雄数据改为每个“成员 × 分路”一个构成小倍图。宽窗以五个分路列同时展示全部成员；每个成员单元只保留分路样本、英雄数、前三集中度、一个环状英雄池构成图和前四英雄头像/中文名/选用率。环中心直接标注场次，前四之外的英雄合并为“其他”，点击灰色扇区或“其他 N 个”可展开该成员完整英雄列表，因此低频英雄没有丢失。

环图只编码同一成员同一分路内的选用构成，不承载胜率或其他不同单位指标。点击任意扇区或英雄后，页面顶部唯一的证据面板更新为该英雄的场次、胜率、胜负、Wilson 95% 区间、蓝红方结果、KDA、DPM、GPM、参团率、伤害转化率和 GD@15。详情默认选择全体样本中场次最多的英雄；非显然指标继续提供可聚焦定义。环图扇区与图例一一对应并包含英雄名/比例 ARIA 标签，不仅依赖颜色；键盘可通过 Enter/Space 激活，reduced-motion 下关闭描边过渡。

Electron dev 截图复核覆盖 1440×900、较窄窗口、顶部和页面底部。五列宽窗能够在一个视觉平面内比较不同分路的英雄池宽度与集中度，窄窗自动改为三列或两列；顶部证据面板在宽窗滚动时固定，窄窗恢复普通文档流。自动审计新增环图和证据面板存在性检查。验证：focused member-analysis Vitest **17 passed / 1 skipped files，82 passed / 1 skipped tests**；node/web typecheck 与 Electron production build 通过（31,970 renderer modules，仅保留既有 `@reference` 与大 chunk warning）。未改变英雄聚合、选用率或其他指标口径；未部署、发布、commit、push 或创建 PR。
### 2026-08-10 follow-up：组合页合并精确指标并恢复 OP.GG 线杀率优势

“组合”页移除了底部重复的“组合精确指标”表，将其全部证据字段合并到按分路分组的主表：成员组合、比赛结果与 Wilson 95% 区间、OP.GG 线杀率优势、上/下半区经济差@15、经济差@20、防御塔差@20、资源团净击杀@15、小龙差@15、巢虫差@15及蓝/红方样本均在同一行读取。表格保留横向滚动以容纳完整字段，并固定成员组合列，滚动后仍能识别当前数据所属组合；底部重复表已删除。宽窗、窄窗和页面内部滚动状态均通过 Electron dev 匿名截图复核，临时截图未进入仓库。

OP.GG 列长期缺失的根因不是聚合或 UI：Python worker 此前无条件把每位成员的 `counter` 和每场比赛的 `counterMean` 写成 `None`，已有 `opggEnabled` 设置也未传入数据管线。现在刷新管线仅在该设置开启时传入 `--opgg-enabled`，worker 使用固定 OP.GG 英雄对位页面读取非打野位置的 Lane kill rate，并沿用历史指标语义执行 Beta(50,50) 收缩；每局 `counterMean` 仍是当局可用非打野位置的均值，没有改变组合聚合口径。已解析结果只原子缓存到 Electron `userData` 下的 member-analysis 数据目录；单次刷新最多请求 300 个未缓存对位，设有超时、并发上限与取消检查，OP.GG 不可达或页面缺字段时降级为真实空值而不阻断本地分析。现有已发布数据需要开启“OP.GG 公共参考数据”后刷新一次才会生成该列。

验证：focused member-analysis Vitest **17 passed / 1 skipped files，83 passed / 1 skipped tests**；Python worker/OP.GG tests **5/5 passed**；node/web typecheck 与 Electron production build 通过（仅保留既有 CSS `@reference` 与大 chunk warning）；data leak guard 通过（1,613 files）；patch surface guard **9/9 upstream files、68/350 changed lines**；`git diff --check` 通过。未新增 renderer HTTP、WebView、文件系统访问或 IPC；未部署、发布、commit、push 或创建 PR。

### 2026-08-10 follow-up：组合分区与指标表头固定

组合表不再只固定横向滚动时的成员列。每个上野、中野、下辅分区现在将“当前分区标题 + 全部指标列名”作为一个连续的固定上下文，纵向滚动到分区内部时固定在原生分析 Tab 下方，进入下一分区后由下一组标题和列名自然接替。由于原生横向滚动容器会阻断浏览器的纵向 sticky 定位，表头改为与表体语义表头对应的独立固定层，并同步每个分区的横向滚动位置；成员组合列继续在表体内横向固定。语义表头仍保留给表格可访问性，OP.GG 定义位于可见表头且支持键盘聚焦。

Electron dev 匿名截图已实际复核滚动到下辅分区中部的状态：分区名称、成员组合和当前横向范围内的指标列名同时可见，且 OP.GG 刷新数据已正常显示。临时截图已清理。验证：renderer member-analysis Vitest **5 files / 32 tests passed**；web typecheck 与 `git diff --check` 通过。未 commit、push、部署或发布。

### 2026-08-10 follow-up：打野四页按指标语义重构

“打野”移除了四个子页面底部重复的精确数据表，完整指标现均进入上方成员比较视图，并提供默认关闭的蓝红方紧凑拆分。开野与首轮不再把六个比例各画一条独立比例轴：己方/入侵改为二段100%构成条，红BUFF/蓝BUFF/F6/三狼改为四段100%首营地构成条，直接标注各部分比例与可识别开野分母。聚合同时修正了可空 `startCampOwn` 的分母：缺失归属不再被当作既非己方也非入侵的第三种结果；首营地可识别数、归属可识别数和首龙有效样本数均显式保留，null 与真实0继续区分。

早期抓人与方向将上/中/下活动区域合为同一条100%构成条；三级和四级抓人率保留为可同时发生的两个精确值，不错误堆叠；三路场均抓人使用所有成员共享尺度的三点图。资源控制按“首龙结果、场均资源账目、15分钟前正负结果”分区，小龙及其独控子集保持从属关系，巢虫、先锋、大龙不再用错误的共同柱长比较；小龙差、巢虫差和资源团净击杀直接保留单位内的正负精确值。发育与对位将同单位的 GD@10 与 GD@15 放在共享零中心尺度的连接点图中，XPD@15单独显示，CSPM、GPM和目标伤害/分以各自单位对齐，不把不同量纲编码成同一长度。

Electron dev 匿名截图复核覆盖四个子页面的常见桌面宽度和较窄窗口。首轮截图发现运行时生成的抓人点和GD轨迹标记没有继承 scoped 子节点样式，修复样式作用域后重新截图，确认共享尺度、零线、起止点、构成直接标注和两列窄窗卡片均完整可读；截图只位于系统临时目录并已清理。验证：focused member-analysis Vitest **17 passed / 1 skipped files，83 passed / 1 skipped tests**；node/web typecheck 与 Electron production build 通过（31,970 renderer modules，仅保留既有 CSS `@reference` 与大 chunk warning）；data leak guard 通过（1,613 files）；patch surface guard **9/9 upstream files、68/350 changed lines**；`git diff --check` 通过。未新增依赖、HTTP、WebView、renderer 文件系统访问或 IPC，未部署、发布、commit、push 或创建 PR。

### 2026-08-10 follow-up：首营地补齐六类野怪

首营地检测此前只包含红BUFF、蓝BUFF、三狼和F6，导致实际在魔沼蛙或石甲虫附近开野的对局被最近邻错误归入其他四类。Python时间线分析现在为蓝红双方各补入魔沼蛙与石甲虫坐标，worker输出与共享schema的 `startCamp` 枚举扩展为六类；已有四类值保持兼容。Renderer聚合新增魔沼蛙开率和石甲虫开率，首营地100%构成条与直接标注完整显示红BUFF、蓝BUFF、魔沼蛙、F6、三狼、石甲虫，不再使用“狼”简称。较窄窗口将六项标签排成三列两行，避免挤压和截断。旧数据库中的魔沼蛙/石甲虫场次已经按旧四点最近邻分类，需刷新一次分析数据后才能得到正确六类分布。

验证：Python worker tests **6/6 passed**，覆盖蓝红双方新增营地坐标；focused analytics/schema Vitest **2 files / 12 tests passed**，覆盖魔沼蛙与石甲虫各占50%的构成聚合；node/web typecheck 与 Electron production build 通过（31,970 renderer modules，仅保留既有 warning）。Electron dev宽窄窗口已复核六项完整标签，临时截图已清理。未部署、发布、commit、push 或创建 PR。

## 2026-08-26：Agent 前端设计、数据分析可视化与游戏辅助软件工程规范调研

### 1. 目标、边界与结论先行

本次工作的目标不是继续评价或重做五人车队页面，而是把“Agent 怎样稳定地做出符合产品的 UI”固化为原项目可复用的工程约束。视觉分析基线明确限定为 **上游原版 League Akari 中 `member-analysis` 以外的界面**；五人车队功能只被当作后续接入对象，不能反过来定义 Akari 的原始设计语言。

“调研所有公开 repo/blog”在字面上无法穷举：公开仓库持续新增、同一技能被大量复制、搜索引擎也不能保证完整收录。因此采用可复核的高信号覆盖法，覆盖以下来源类别，而不宣称枚举了整个互联网：

1. Agent Skills 开放规范与平台官方文档；
2. OpenAI、Microsoft 等官方或维护活跃的技能仓库；
3. 社区前端设计、数据分析和数据可视化技能；
4. W3C、WCAG、Vega-Lite、Tableau、IBM 等设计与可视化规范；
5. Playwright、Storybook 等可执行验收工具文档；
6. Riot 与 Overwolf 的游戏辅助/覆盖层产品边界；
7. 原版 Akari 源码、主题变量、Naive UI 覆盖、生产组件和窗口结构。

综合结论是：**Skill 有用，但 Skill 不是单独的解法。** 最可靠的脚手架是一个四层闭环：

- `AGENTS.md` 保存任何任务都必须遵守的产品边界和路由规则；
- 按需加载的 Skill 保存会实际改变 Agent 决策的领域工作流；
- 源码中的主题 token、组件家族、类型和 IPC contract 是可执行的产品事实；
- typecheck、行为测试、Electron/Storybook 实际渲染与截图复核提供反馈闭环。

如果只写一份很长的“UI 风格提示词”，Agent 仍会在具体页面上自由发挥；如果只有设计 token 而没有信息架构、数据真实性和验收规则，Agent 仍会做出颜色正确但产品逻辑错误的通用 Dashboard。四层必须同时存在。

### 2. 公开 Agent Skill 资料得到的共识

#### 2.1 Skill 的职责

[OpenAI Build Skills](https://learn.chatgpt.com/docs/build-skills)、[Agent Skills 规范](https://agentskills.io/specification)、[OpenAI skill-creator](https://github.com/openai/skills/blob/main/skills/.system/skill-creator/SKILL.md) 与 [Microsoft/VS Code Agent Skills](https://github.com/microsoft/vscode-docs/blob/main/docs/agent-customization/agent-skills.md) 的共同点如下：

- `name` 和 `description` 是发现入口，必须同时说明“能做什么”和“何时触发”；模糊描述会导致该加载时不加载，或无关任务误加载。
- `SKILL.md` 应保存每次执行都需要的核心判断、非显然约束、工作流和验证方法；大段条件化资料应按需披露，而不是一次塞满上下文。
- Skill 应聚焦一个稳定工作，而不是成为“任何前端问题都管”的百科全书。
- 优先写结果和决策标准，只有易错、危险或必须一致的过程才写成硬步骤。
- 额外脚本/引用只有在可重复减少错误时才值得存在，并且必须从 `SKILL.md` 被明确引用。
- 复制来的公开 Skill 必须重新审查和项目化；公开版本不知道本仓库的 UI、数据、权限、窗口和测试边界。
- 写完要校验 frontmatter、目录名、触发描述和真实行为；验证不能只检查 Markdown 是否存在某个标题。

公开规范建议对大型 Skill 使用渐进披露，并把 `SKILL.md` 控制在约 500 行以内。社区最佳实践也反复指出“巨型 SKILL 文件”是常见失败模式，因为每次加载都会占用上下文，还会让互相冲突的规则难以发现。参考：[Agent Skills best practices](https://github.com/agentskills/agentskills/blob/main/docs/skill-creation/best-practices.mdx)、[社区 skill 编写实践](https://github.com/nyosegawa/skills/blob/main/agent-skill-best-practices.md)。

[Microsoft/VS Code Agent Skills](https://github.com/microsoft/vscode-docs/blob/main/docs/agent-customization/agent-skills.md) 还强调项目级与个人级 Skill 的作用域、附属资源必须从入口被引用、以及共享 Skill 安装前必须审查；[OpenAI frontend prompting](https://developers.openai.com/api/docs/guides/frontend-prompt) 强调尊重已有设计、让业务工具第一屏直接提供实际用途、避免凭空添加通用功能并用截图验证。这些结论与 Akari 的桌面工具属性高度一致。

#### 2.2 对本项目的直接含义

本项目不应新增一个覆盖全部 UI/数据/游戏逻辑的“大一统 Skill”，但当新的稳定工作流具有独立触发条件和持续复用价值时，可以新增专门 Skill。审核后将数据分析与可视化从 UI Skill 中拆出，当前五个 Skill 对应以下真实边界：

| Skill | 稳定职责 |
|---|---|
| `league-akari-ui-components` | 原版 Akari 视觉语言、Vue/Naive UI 页面与组件、桌面游戏辅助交互、i18n、可访问性和人工视觉复核准备 |
| `league-akari-data-visualization` | 分析问题、指标 contract、数据画像、表格/图表选择、尺度、缺失、不确定性、交互和分析验收 |
| `league-akari-shard-development` | main/renderer 分层、长任务生命周期、typed IPC、数据聚合与发布边界 |
| `league-akari-sgp-data-source` | LCU/SGP 来源、token/region/endpoint、数据出处、完整性、时效性和错误分类 |
| `league-akari-mcp-debug` | Electron 窗口运行态、截图、八主题/尺寸/状态覆盖、console/network 复核与人工评审材料 |

常驻 `AGENTS.md` 只保留跨任务不变的原则，并指向相应 Skill；详细执行规则留在 Skill。新增 Skill 的判断标准不是“任务结束需要一份汇报”，而是出现了可独立触发、会持续改变 Agent 决策、且不适合塞入现有 Skill 的工作流。

### 3. 原版 League Akari 的设计语言

#### 3.1 研究方法

原版样式从当前 `origin/dev` 的非 `member-analysis` 生产代码提取，重点检查：

- `src/renderer-shared/assets/css/theme-system.css`；
- Tailwind 主题和 Akari 粉色色阶；
- Naive UI 的 light/dark 主题覆盖；
- 主侧边栏、标题栏、设置页、比赛卡、对局详情、进行中游戏、通知和辅助窗口；
- 原有折线图、横向条形图、英雄位置环图、地图点位/热图等真实可视化；
- 上游 Vue/TSX 中字号、gap、padding、圆角和阴影的整体使用频率。

明确排除五人车队页面后，原版 Akari 呈现出一致的产品性格。

#### 3.2 产品姿态：桌面应用，不是营销网站

- 页面首屏直接进入当前功能、状态、数据或控制，不先展示 hero、口号、价值主张或“欢迎使用”。
- 布局面向持续使用和高信息密度，而不是演示截图式的大留白。
- 功能通常通过 Tab、设置行、面板、比赛卡、表格、Popover/Modal 渐进展开。
- 说明文字服务于操作或领域定义，不在 UI 中解释“我们为何这样设计”。
- 原版运行态界面经常紧凑，但这不是所有新页面的强制密度。`member-analysis` 是五位朋友在局外共同分析和复盘的工作区，可以为阅读、比较、解释和讨论保留更充分的空间。

因此后续 Agent 默认禁止把 Akari 页面写成通用 SaaS Dashboard：大标题 + 四张 KPI 卡 + 渐变背景 + 营销段落不是中性选择，而是明显的产品漂移。

#### 3.3 颜色和主题

- Akari 的品牌重点是粉色，主要色接近 `#f83f6f`；主要操作、选中和焦点可使用品牌色，但图表不能把品牌粉当成所有数据的默认填充。
- 基础表面偏中性：默认浅色背景约为 `#f3f3f4`，默认深色背景约为 `#141416`；卡片常用低透明度填充和低对比边框，而不是强描边和大阴影。
- 主题不是只有 light/dark。当前具体主题包含 `light`、`dark`、`butter`、`graphite`、`cyber`、`sakura`、`mint`、`aurora`。
- 主题状态位于根元素 `data-theme` 与 `data-theme-id`；手写 `.dark` 会绕过本项目机制。
- `theme-system.css` 通过语义变量和对常见低透明度 utility 的主题映射，让壁纸/彩色主题下的表面、边框和文本保持可读。新页面应复用这些变量，不应只在白底和黑底上试色。

[W3C Design Tokens](https://www.w3.org/community/reports/design-tokens/CG-FINAL-format-20251028/) 的核心价值也适用于本项目：token 是跨工具共享的设计决定，而不是某个组件临时复制的颜色。这里应优先保留“品牌、表面、文本、边框、状态、队伍、胜负”等语义角色，而不是把所有值都降级为 `pink-500` 或一串 hex。

#### 3.4 字体、密度、形状和资产

- 通用 UI 使用应用/系统字体；Comfortaa 主要用于侧边栏应用名与品牌区域，不是功能页面的展示字体。
- 原版组件常见 `text-xs`、`text-sm`、短 `gap` 和短 `padding`，数值比较常使用 `tabular-nums`；这是上游事实而不是要求 `member-analysis` 复制同等密度。
- 圆角存在但克制；阴影不是建立层级的主要手段。层级更多依靠间距、低透明度表面、细边界、字号和字重。
- 原版会直接使用英雄、物品、召唤师技能、分路、队列和地图等 League 资产来降低识别成本。游戏数据页面不应换成抽象插画或无意义图标。
- 主侧边栏是图标优先、可折叠、占用窄；这也说明 Akari 优先保留工作区，而不是强调导航装饰。

#### 3.5 交互节奏

- Naive UI 是主要交互原语。具体尺寸和留白由页面阅读任务决定，局外复盘页面无需复制通知或侧边栏的紧凑程度。
- 页面常把详情放入右侧控制、Popover、抽屉或 Modal，但关键状态和主操作保持可见。
- 多窗口环境意味着焦点、关闭、置顶、缩放和窗口类型都是产品行为，不能把 Electron 页面当作普通响应式网站。
- 原版已有进行中游戏和辅助窗口，因此新增功能必须考虑“何时出现、是否抢焦点、是否遮挡、是否能一眼读懂”，而不只是静态页面是否漂亮。

### 4. 数据分析和数据可视化规范

#### 4.1 先定义问题，再选择图

[OpenAI 数据可视化 Skill](https://github.com/openai/plugins/blob/main/plugins/build-web-data-visualization/skills/data-visualization/SKILL.md)、[Tableau Dashboard Best Practices](https://help.tableau.com/current/pro/desktop/en-us/dashboards_best_practices.htm)、[IBM Data Visualization Basics](https://www.ibm.com/design/language/data-visualization/design/basics/) 与 [Vega-Lite Encoding](https://vega.github.io/vega-lite/docs/encoding.html) 的共同原则是：先判断分析任务和数据类型，再选编码；“能画出来”不等于“应该画”。

在 Akari 中采用以下顺序：

1. 单个事实：数值或紧凑 label-value；
2. 多对象精确比较：排序表格、对齐数字、单元格内条/点；
3. 趋势：折线或小倍图；
4. 排名/差距：零起点条形图、点图或零中心差值图；
5. 构成：互斥且组成同一整体时使用 100% 堆叠条；类别很少且只需粗略构成时才考虑环图；
6. 分布：直方图、箱线/区间或分位数；
7. 空间：只有真实地图位置问题才使用召唤师峡谷地图；
8. 更复杂的交互图：只有在确实减少理解成本时使用。

这套顺序故意把表格和直接标注放在复杂 Chart 之前，因为五名玩家、多指标、精确比较的场景往往是表格/小倍图更清楚，而不是每个指标都画一张大图。

#### 4.2 数据真实性

- 必须区分 `0`、缺失、不可用、不适用、未加载、过期和失败；不能用 `0` 填空。
- 百分比必须保留可识别样本/合格分母；总场次不一定等于某个指标的有效样本。
- 同一长度或坐标轴不能混合不同单位。GD、XPD、DPM、GPM、百分比和次数不应为了“都放一张图”而共享长度。
- 条形图从零开始；折线图只有在“局部变化本身就是问题”且尺度清楚时才允许非零起点。
- 用于相互比较的小图应共享尺度；如果不得不使用局部尺度，必须避免诱导跨图长度比较。
- 聚合、过滤、排序、归一化、平滑、置信区间和缺失处理应在 typed domain 层实现并测试，不在 Vue 模板或 tooltip 字符串里偷偷计算。
- 小样本差异要显示样本数，适合时显示区间，避免把噪声写成稳定结论。

[NIST Information Quality Standards](https://www.nist.gov/director/nist-information-quality-standards) 与 [UK Analysis Function 的质量/不确定性指南](https://analysisfunction.civilservice.gov.uk/policy-store/communicating-quality-uncertainty-and-change/) 支持这一方向：来源、方法、可复现性、样本和不确定性应当透明，而且要用读者能理解的语言表达。

#### 4.3 降低解码成本

- 关键值不依赖 hover；hover 只能补充，不应成为唯一证据入口。
- 优先直接标签、图内 key、注释、小倍图、单元格内图形，少用远离数据的图例。
- 排序必须有含义：排名按值、时间按时间、玩家/分路/队伍按稳定领域顺序；字母排序不是默认正确。
- 页面顶部和左上优先放最重要的工作视图，但不要一次塞太多图。Tableau 同样强调明确目的、有限视图数量和设备/尺寸特定布局。
- 图题和轴说明要短且包含必要单位、时间或样本语境；不要用一段设计说明替代清楚的编码。

#### 4.4 颜色、运动与可访问性

- 颜色只承担稳定语义：品牌操作、蓝/红方、胜/负/中性、状态严重度、选择高亮、类别系列。
- 不依赖红绿区分；同时使用直接标签、符号、线型、形状、位置或文本。
- 3D、透视、发光和装饰渐变不增加分析信息，默认禁止。
- 动画只有在表达状态变化、因果序列或空间变化时才有价值，并提供 reduced-motion 静态退化。
- Canvas/SVG 需要可读的 accessible name；关键精确值还要有直接标签、摘要或语义表格路径。[Observable Plot Accessibility](https://observablehq.com/plot/features/accessibility) 与 [WCAG 2.2 Quick Reference](https://www.w3.org/WAI/WCAG22/quickref/) 提供了 ARIA、对比度、键盘、焦点、目标尺寸和 reduced motion 的基础。

### 5. 游戏辅助软件的额外约束

[Overwolf overlay 合规指南](https://dev.overwolf.com/ow-native/guides/game-compliance/overview/) 将游戏辅助产品的关键问题概括为：增加价值但不干扰游戏、保持自己的身份、尊重公平竞争、在相关时机提供信息。[Riot Developer Policies](https://developer.riotgames.com/policies/general) 进一步要求第三方产品不要冒充 Riot 或暗示背书，并对可接受的游戏辅助能力设限。

在 Akari 中落地为：

- Pregame、champion select、loading、live、postgame、disconnected 是不同产品阶段；同一信息在错误阶段出现也是缺陷。
- 主窗口可以承载深分析；进行中/辅助窗口应当一眼可读、可关闭、不抢焦点、不覆盖关键游戏区域。
- 动画、轮询、canvas 重绘、通知和置顶行为都要有注意力与性能预算。
- 工具提供事实、历史和多个选择，不自动替用户做实时游戏决策，也不把不完整数据包装成确定建议。
- 使用玩家熟悉的 League 术语和资产，但保留 Akari 的粉色品牌与中性桌面工具外观，不能仿制 Riot 客户端 chrome。
- 第三方接口、私有 SGP 和远端配置都不是稳定官方 contract；UI 必须允许 unavailable/stale/partial，而不是无限 loading 或假装为零。

### 6. 从“设计提示词”升级为工程系统

#### 6.1 决策分层

| 层 | 保存内容 | 不应保存什么 |
|---|---|---|
| `AGENTS.md` | 产品边界、原版基线、数据真实性、技能路由、最小验收 | 具体组件教程、长示例、每张图的实现代码 |
| UI Skill | 原版视觉语言、页面/组件工作流、可访问性、八主题截图与人工复核准备 | 指标定义、SGP token 细节、main shard 拆分百科 |
| Data Visualization Skill | 分析问题、指标 contract、数据画像、表示选择、尺度、不确定性、分析验收 | Vue 组件细节、SGP token 和 IPC 实现 |
| Shard Skill | source → domain → controller → IPC → renderer 的边界和生命周期 | 页面美术偏好 |
| SGP Skill | 来源、region/token、完整性、时效性、错误分类 | 通用组件样式 |
| MCP Skill | 运行态探针、窗口/主题/尺寸/状态截图复核 | 生产代码架构替代方案 |
| 源码/测试 | token、类型、组件、真实 contract、行为与视觉证据 | 依赖 Agent 记忆的隐含规则 |

#### 6.2 Agent 每次 UI 任务的标准循环

1. **读取**：读 `AGENTS.md`、对应 Skill、目标页面、相邻生产组件、同族组件、token 和现有测试。
2. **写内部简报**：一句话说明用户、页面主任务、窗口/阶段、必须展示的证据、状态、主题和尺寸；不要把简报显示在 UI。
3. **选原生组合**：从原 Akari 页面结构中选择最近似的 tab/row/panel/table/chart 组合。
4. **定义数据 contract**：来源、时间/patch、分母、单位、缺失、时效、错误和不确定性。
5. **定义编码**：图表类型、排序、尺度、直接标签、颜色角色、非仅依赖 hover 和非仅依赖颜色的退化路径。
6. **实现所有状态**：loading、empty、partial、stale、error、success、cancelled，以及相应 game phase。
7. **静态验证**：Prettier、node/web typecheck、focused behavior tests；禁止用读取源文件匹配 class/string 的伪 UI 测试。
8. **运行态验证**：Electron 或 Storybook 查看常用宽度和窄宽、页面顶部/滚动中部/底部、浅/深主题；token 改动时抽查全部主题。
9. **交互与可访问性**：键盘、焦点、Esc、tooltip 非必需、24×24 目标、reduced motion、accessible name、精确值替代路径。
10. **复查与送审**：查看 console/network、修复截图中实际问题并重新截图；Agent 提交匿名截图和备选方案供人工把关，不自行宣布视觉设计最终通过。

#### 6.3 反模板化检查

出现以下模式时，Agent 必须停下来重新对照原版 Akari，而不是继续“美化”：

- hero、欢迎语、产品价值文案先于实际功能；
- 每个指标一张大 KPI 卡；
- 多层卡片嵌套、遍地 pill、渐变、glass、glow 和大阴影；
- 使用与 League 无关的 stock 图、抽象插画或 emoji 代替现有资产；
- 为显得“高级”而使用 serif/display 字体，或把 Comfortaa 扩散到所有标题；
- 把所有高亮都涂成品牌粉，导致队伍、胜负、状态和选择语义冲突；
- 图表只有 tooltip 才能读数，图例远离数据，缺失被画成 0；
- 不同单位共享轴，局部缩放夸大差异，百分比没有分母；
- UI 出现“为什么选择此图”“本页设计目标”“根据你的要求”等需求回声；
- 只看源码、不看 Electron 实际窗口就宣称视觉验收完成。

### 7. 验收矩阵

| 维度 | 最低通过条件 |
|---|---|
| 产品一致性 | 参考非 `member-analysis` 原版页面；首屏直接进入任务；无通用 Dashboard/landing-page 套路 |
| 主题 | 使用语义 token；每次实质性 UI/可视化修改均复核 `light`、`dark`、`butter`、`graphite`、`cyber`、`sakura`、`mint`、`aurora` 八个主题 |
| 组件 | 同族结构和交互一致；Naive UI 优先；native 元素完全样式化 |
| 数据 | source、time/patch、filter、sample/denominator、unit、missingness、freshness、uncertainty 正确 |
| 可视化 | 根据问题灵活选择最合适的可信编码；复杂图不是默认但允许在确有分析收益时使用；主任务不能只能靠 pointer hover 完成；比较尺度一致；不同单位不误导性混轴；颜色有冗余编码 |
| 游戏场景 | game phase 正确；辅助窗口不抢焦点/不遮挡；信息可快速扫读；没有自动化实时决策 |
| 可访问性 | 键盘、可见焦点、目标尺寸、reduced motion、图表 accessible name 与精确值路径 |
| 性能/生命周期 | refresh/resize/theme/tab 不泄漏 chart/listener/timer；长任务可取消；过期结果不覆盖新结果 |
| 运行态 | Electron/Storybook 真实渲染、常用与窄尺寸、主要状态、console/network 复核完成；实质性视觉改动提交匿名截图供人工最终审核 |
| 隐私 | 无真实玩家 fixture/screenshot/log/token 入库；数据只在规定本地路径；renderer 仅白名单 IPC |

[Playwright 视觉比较](https://playwright.dev/docs/test-snapshots) 提醒截图基线会受操作系统、字体和运行环境影响，因此基线必须在固定环境生成；[Storybook Visual Tests](https://storybook.js.org/docs/8/writing-tests/visual-testing) 与 [Storybook Accessibility Tests](https://storybook.js.org/docs/writing-tests/accessibility-testing) 适合组件态回归，但 Electron 多窗口、焦点、native 行为和真实主题仍需在对应运行时检查。

### 8. 本次已整合的仓库变更

首轮整合没有创建新的 Markdown；审核后规则调整为“不为普通任务创建无用的完成报告”，但允许新增具有长期复用价值的 Skill、contract、runbook 或技术设计。当前实际调整为：

- 根 `AGENTS.md`：补充“原版 Akari、排除五人车队作为设计基线”、数据真实性和颜色冗余编码的常驻规则；
- `akari-src/AGENTS.md`：扩展 UI 与数据可视化 Skill 路由，加入原版产品语言、局外复盘产品定位、游戏辅助交互、八主题截图和人工视觉验收；
- `league-akari-ui-components`：聚焦项目化 UI/游戏辅助组件、主题、i18n、Tailwind v4、Naive UI/native、可访问性和人工评审材料；
- `league-akari-data-visualization`：新增独立分析可视化 Skill，负责问题定义、指标 contract、数据画像、表示选择、尺度、缺失、不确定性、交互、性能和分析验收；
- `league-akari-shard-development`：加入分析管线分层、取消/过期结果/原子发布、typed IPC、renderer 最小状态和端到端验收；
- `league-akari-sgp-data-source`：加入 provenance、freshness、denominator、missingness、partial/stale/error taxonomy、隐私与下游分析复核；
- `league-akari-mcp-debug`：加入 Electron 视觉审计流程、主题/尺寸/状态矩阵、分析图表检查和临时截图隐私规则。

这些改动的目标不是让 Agent 永远不需要审美判断，而是把最常见的反复修改原因提前变成可检查的 contract：**基线选错、首屏任务错、组件家族不一致、数据语义不完整、图表编码不可信、主题/窗口未实测、以及用源码推断视觉结果。**

本次校验：Prettier 已执行于根/子目录 `AGENTS.md` 和四个现有 `SKILL.md`；Skill Creator `quick_validate.py` 对四个 Skill 均返回 `Skill is valid!`；四个 Skill 分别为 356、126、498、257 行，均未超过 500 行建议上限；`git diff --check` 通过，仅出现仓库既有 Windows LF/CRLF 提示。由于本次只修改现有 Markdown 指令与记录，没有修改应用源码、依赖、运行时 contract 或生成物，因此未重复执行应用 typecheck、Vitest 或 Electron build。未部署、发布、commit、push 或创建 PR。

## 2026-08-26：成员分析开发版一键启动入口

- 新增根目录 `start-dev-akari.cmd`，双击即可启动带成员分析 worker 的 League Akari dev 版。
- 启动器自动查找并校验 64 位 Python 3.12，优先接受显式 `-Python` 或已有 `MEMBER_ANALYSIS_PYTHON`，随后尝试 Codex bundled runtime、PATH Python 与 Windows `py -3.12`。
- 启动前检查 worker 源码入口并拒绝与同仓库既有 Electron dev 实例并行，避免单实例锁掩盖环境变量未生效；启动时设置 `MEMBER_ANALYSIS_PYTHON` 与 `PYTHONDONTWRITEBYTECODE=1`。
- 同时提供 `yarn dev:member-analysis`、`-NoWatch` 与 `-CheckOnly` 入口。未改变 SGP/LCU、成员数据、IPC、worker 协议或发布配置。

## 2026-08-26 follow-up：设计规范人工审核修订与独立数据可视化 Skill

人工审核确认并修订以下决策：

1. 原版上游非 `member-analysis` 页面继续作为唯一视觉语言基线；五人车队页面不能自证其设计合理性。
2. `member-analysis` 的产品定位是五位朋友在局外共同分析和复盘，不以桌面工具式紧凑为目标。它复用 Akari 的主题、组件、资产、层级与克制感，但可以为阅读、比较、解释和讨论使用更充分的留白与分组。
3. “无需 hover 可读”被明确为：页面主要结论和完成主要任务所需的证据不能只藏在鼠标 tooltip；不要求永久打印所有精确值。可使用直接标签、坐标轴、常驻选中证据面板、摘要、相邻表格或键盘焦点等方式；hover 继续用于次级精度和探索。
4. Agent 负责生成确定性匿名截图、发现客观缺陷并准备备选方案，但不能自行宣布实质性视觉设计最终通过；最终视觉验收由人工完成。
5. 每次实质性 UI 或可视化修改均检查并提供八主题证据：`light`、`dark`、`butter`、`graphite`、`cyber`、`sakura`、`mint`、`aurora`。
6. 不再禁止所有新 Markdown。禁止的是每次普通任务都新建无复用价值的完成汇报；具有长期用途的 Skill、contract、runbook 和技术设计可以新增。
7. Skill 路由不是封闭清单。有独立触发条件、持续复用价值且不适合塞入现有 Skill 的工作流可以新增 Skill。

据此新增 `league-akari-data-visualization`，并将 UI Skill 中的分析职责拆分：新 Skill 专门负责分析问题、指标 contract、数据画像、表示选择、尺度、缺失、不确定性、League 语义、交互、性能和人工验收证据；UI Skill 负责把结果落入 Akari 的 Vue/Naive UI、主题、窗口、组件和可访问性体系。根级与 `akari-src/AGENTS.md` 已同步更新路由与约束。

验证：Prettier 已执行于根/子目录 `AGENTS.md`、UI/MCP Skill 和新增数据可视化 Skill；Skill Creator `quick_validate.py` 对当前五个 Skill 均返回 `Skill is valid!`。行数分别为 data visualization 298、MCP 359、SGP 126、shard development 498、UI components 235，均在 500 行建议上限内；`git diff --check` 通过，仅保留仓库既有 Windows LF/CRLF 提示。本次未修改应用功能代码，因此未重复执行 typecheck、Vitest 或 Electron build；未部署、发布、commit、push 或创建 PR。

## 2026-08-26：现有 `member-analysis` 全面审计

### 1. 审计结论

当前页面已经不是原型：九个分析视图、全局筛选、蓝红方拆分、对局证据、刷新/取消、分页拉取、Wilson 胜率区间、键盘可达的部分图形以及本地 IPC/SQLite/worker 边界都已形成完整产品骨架。实际 Electron 深色主题运行态也证明，页面可以承载 350 场总数据、50 场当前样本和多人轮换阵容。

但按当前数据分析与可视化 contract，**尚不应把它判定为“分析可信且视觉验收完成”**。阻塞点不是审美，而是若干会改变结论的数据语义：缺失值在聚合时被变成 0、15 分钟团队经济差允许只累加 3 名成员、source 没有跨 overview IPC 到达 UI，以及“默契”分数使用容易被误解为因果关系的粗粒度胜率差。其次是产品 UI 直接暴露 worker/raw/staging/错误码、样本口径层级不够清楚、部分单位和可访问名称缺失、8–10px 小字过多、硬编码数据色尚未经过八主题人工复核。

综合判定：

- **架构与隐私边界：通过，保留少量错误呈现整改项。**
- **功能覆盖：通过。**
- **分析正确性：有条件不通过。** 修复 P1 数据语义后才可作为正式复盘结论。
- **可视化与交互：基本可用，但未完成八主题、窄窗口、键盘和人工视觉终审。**
- **发布准备度：不通过。** 当前适合作为本地开发/内部试用版，不适合声明已完成产品验收。

### 2. 严重度定义

| 等级 | 含义 |
|---|---|
| P1 | 可能把数据说错、把缺失画成事实、让用户形成错误结论，或破坏明确的产品/隐私 contract；应先于视觉打磨修复 |
| P2 | 不一定改变原始数值，但显著影响解释、可访问性、主题一致性、异常处理或共同复盘效率 |
| P3 | 体验、维护或验证缺口；可在 P1/P2 后安排 |

### 3. P1：必须优先修复

#### P1-1 缺失值在聚合阶段被改写为零

`analytics.ts` 的通用 `ratio` 在分母为 0 时返回 0，`average` 在没有任何有效值时也返回 0。它们被用于 GD@10/GD@15/CSD@15/XPD@15、伤害差、占比、转化率、开野率、空经济档胜率等大量指标。虽然展示层的 `formatMetric` 能把 `null` 显示为 `—`，但很多值在到达展示层前已丢失 null，因此相关 UI 和散点图会把“没有观测”当作“真实为 0”。现有测试甚至固定了空经济档 `{ games: 0, winRate: 0 }`，说明错误语义已被测试固化。

影响：无有效对线数据的成员可能看起来 GD@15 恰好为 0；没有击杀窗口时会显示 0% 转化；没有开野归属样本时会显示 0% 入侵/己方开；空经济档可能显示 0% 胜率；散点会把缺失点放到零坐标。用户无法区分“没发生”“没采到”“不适用”和“确实为零”。

建议：把 `ratioOrNull`、`meanOrNull` 与明确允许零分母的业务计算分开；让 Role/Jungle/Conversion/EarlyBucket 的类型保留 `number | null`；每个率同时携带 eligible count；删除把空桶固定为 0 的测试，新增缺失传播到表格、证据面板和散点的端到端测试。

#### P1-2 15 分钟“团队经济差”混用了不完整的成员总和

`earlyGoldDiff(game, '15')` 收集各成员 `gd15`，只要至少 3 个有效值就直接求和。三人、四人和五人的和处于不同量级，却共用同一组 `−3000 ... +3000` 档位并被称作团队经济差。即使每个成员的 GD@15 本身正确，缺两个位置后的总和也不能和完整五人总和直接比较。

影响：同样的真实团队局势可能仅因缺失位置数量不同而落入不同档位，进而改变“领先局取胜”“中性局取胜”“落后翻盘率”等核心结论。

建议优先使用可靠的 game-level 团队经济差；若只能由位置差求和，则要求五个固定位置全部有效。确需接受部分数据时，必须采用明确的归一化方法、显示覆盖位置数并与完整样本分组，不能继续共享现有档位。

#### P1-3 数据 source 在 IPC overview 中丢失

发布 payload 的 `meta.source` 有严格 schema，但 `MemberAnalysisOverviewSchema` 和 controller 返回值没有 `source`。因此 renderer 无法展示真正的数据来源；当前顶部的 `source-exhausted` 只是采集停止原因，而且直接使用英文内部枚举，不能替代 provenance。

影响：页面无法满足“来源、时间/补丁、样本、缺失、单位”中的来源要求；当 LCU、SGP、缓存或其他适配器语义变化时，用户无法判断数值来自哪里。

建议：将稳定、非敏感的 source/method/freshness 字段作为共享 contract，从 repository/published meta 原样带到 overview；UI 用简短中文展示来源和生成时间，把详细流水线审计留在日志或开发诊断页。

#### P1-4 “默契”指标的命名强于证据

当前公式是“二人共同胜率 − 两人各自出场胜率均值”，再乘 `games / (games + 8)`。这只是描述性胜率偏差，没有控制位置、英雄、版本、边色、队友组合、对手强度或筛选窗口；`games/(games+8)` 是收缩权重，不是统计学意义上的“可靠度”。运行态却直接标为“正默契/负默契”“可靠度”，容易让朋友们把共同出现时的相关性理解为两人配合造成的效果。若某一组固定五人总是一起出场，该指标还会退化为所有组合接近 0。

建议：在完成更可靠模型前，改名为“同队胜率偏差（描述性）”和“样本权重”，避免正/负默契的因果暗示；至少同时显示共同场次、共同胜率、各自基线和分层条件。若继续叫默契，需要按位置/补丁/边色等做可比性控制，并给出真正的不确定性。

### 4. P2：高价值整改

#### P2-1 产品界面泄露实现术语和原始错误

首页可见审计详情含 `raw`、`worker`、`staging`、`published`、`overview 返回`、`五源交集` 等流水线术语；设置抽屉也出现“关闭时不启动 worker”“raw 占用”等实现描述。实际运行态错误条直接显示 `PIPELINE_FAILED: failed to resolve 13 configured member(s)`。这些内容违反“产品 UI 不讲实现约束/设计过程”的约定，并混用中英文。

建议：把失败码映射成可行动的中文状态，例如“13 名成员身份解析失败，请检查区服和 Riot ID；已保留 08/09 的旧数据”；把技术码、阶段计数和 raw/staging 仅写入脱敏日志或显式开发诊断入口。设置文案改成用户概念，如“关闭后停止更新”“历史原始数据占用”。

#### P2-2 总数据、过滤后数据与当前样本窗口容易混淆

运行态同时出现“数据范围 350 / 全部场”“最近 50 场”“50 场有效样本”，但没有统一说明 350 是总语料、筛选后还有多少、当前视图实际取哪 50 场；高级筛选折叠后，补丁和日期范围也不会在各视图上下文中复述。

建议：增加一条简洁上下文：“总计 350 · 筛选后 87 · 当前最新 50 · 版本 26.15–26.16 · 蓝红合计”。这不是设计说明，而是解释数值必需的分析上下文。

#### P2-3 单位和分母覆盖不一致

事件决策页“平均延迟 31.82”“交换延迟 +32.2”在主视图没有直接显示“秒”；部分比率有窗口数，部分只给总场次或需要依赖 `title`。死亡代价点是加权复合分，却没有在主要证据路径中给出权重或量纲。成员分路的 DPM/GPM/CSPM 可由缩写理解，但中文共同复盘场景仍应在定义中明确单位和聚合方法。

建议：所有时间值直接带 `秒` 或 `mm:ss`；率值附 eligible denominator；复合分公开定义；说明哪些指标是“逐局平均”、哪些是“总量比总时长/总分母”，避免把加权与非加权平均混为一谈。

#### P2-4 不确定性只覆盖了部分胜率

成员、英雄、组合和前期经济档已使用 Wilson 95% 区间，这是明显优点；但转化率、高代价死亡率、资源团胜率、跨图交换率和默契偏差没有统一的不确定性/低样本处理。当前“样本稳定/参考样本/样本较少”的阈值又是按窗口大小人工切换，容易被理解为统计结论。

建议：将 Wilson 或相应二项区间复用于有明确成功/总数的比例；把阈值标签改成中性的样本量提示；默契/提升类指标使用成对或分层 bootstrap/模型区间，做不到时明确标为描述性，不显示“可靠度”。

#### P2-5 页面仍然过度紧凑，不符合已确认的共同复盘定位

源码中大量辅助文字为 8–10px，成员分路和打野的蓝红拆分为 9px，英雄池成员/英雄信息甚至有 8px。实际 1440×900 运行态中，页面有大量可用留白，但信息仍被压进非常密的小字表格；前期转化图上方大面积空白与下方密集元素并存，说明空间不是不足，而是分配不均。

建议：以 12px 作为多数辅助数据的现实下限，核心标签/表头 12–13px；减少同屏无关列或按讨论任务分组，而不是继续缩字；把可用垂直空间用于上下文、解释和对比，不做大 KPI 卡或营销式留白。

#### P2-6 可访问名称与帮助信息仍有缺口

全局基础筛选有 aria-label，但高级筛选的成员、位置、英雄、补丁、起止日期和最短/最长时长主要依赖视觉位置或 placeholder；原生 `title` 被广泛用作指标定义，键盘聚焦虽可达，但不同辅助技术对 `title` 的播报不稳定。散点 `<g tabindex="0" role="img">` 和英雄 donut 的 SVG 片段可聚焦，但焦点/选中与旁边按钮存在重复路径，需实际屏幕阅读器验证。

建议：为每个高级控件提供程序化 label；把指标定义放入可点击/可聚焦的 Naive UI popover，并用 `aria-describedby` 关联；为图形标记保留一个明确的交互入口，确保可见焦点、Enter/Space、选中状态和精确值表同步。

#### P2-7 颜色体系尚未满足八主题证据要求

表面和文字多数使用 Akari 语义变量，整体深色主题与上游框架相容；但英雄池、散点角色、打野分类仍散布多组硬编码十六进制颜色。散点同时使用角色单字和颜色、胜负/正负也有文字或符号，冗余编码做得较好；问题在于这些颜色尚未证明在 light、butter、graphite、cyber、sakura、mint、aurora 和壁纸背景上都具备足够对比。

建议：把数据色收敛为语义 token/每主题 palette；对文字、点、线、选中描边分别测对比；八主题截图交给人工最终把关，Agent 只报告客观缺陷，不自行宣告视觉通过。

#### P2-8 对局列表把零值也染成负色，时间区固定为上海

`MatchesView.vue` 对 `gold20Diff` 只判断是否 positive，否则一律套 negative；因此恰好为 0 的经济差也会显示成负面颜色。时间格式器硬编码 `Asia/Shanghai`，但界面没有声明时区；在非中国时区运行会与系统时间产生差异。

建议：使用完整的 positive/negative/neutral 映射；时间采用本机时区，或在 UI 明确标注服务器/北京时间并保证所有日期过滤采用同一语义。

### 5. P3：改进与验证缺口

1. 当前 `audit:member-analysis-ui` 能连接 Electron、匿名化名称/编号并截取宽/窄尺寸和多个滚动位置，这是很好的隐私与运行态基础；但脚本没有循环八个主题，也没有收集 console/page error、键盘路径、焦点截图或对比度证据。
2. 本次实际截取了深色主题宽窗口的成员分路、英雄、组合、打野、事件决策、前期转化、默契和散点图；运行时长超过本轮 30 秒命令窗口后被中断，因此不能把它当作完整的窄窗口/设置/对局明细验收。
3. 组合表固定最小宽度 1540px，散点最小宽度 700px；桌面分析允许横向滚动，但窄窗口下应验证表头、首列、滚动条、焦点和选择详情不会互相遮挡。
4. 成员在多数表中主要按分路和样本量排序，跨 tab 没有统一的稳定成员顺序或成员视觉身份。多人轮换阵容下，讨论中跟踪同一成员的成本较高；可优先采用稳定 roster 顺序和明确名称，而不是强制为每人增加装饰色。
5. 散点允许横纵轴选择同一指标，会产生没有额外信息的对角线；可禁用同指标组合或给出无打扰的替换行为。

### 6. 分视图审计摘要

| 视图 | 做得好的地方 | 主要问题 | 当前判定 |
|---|---|---|---|
| 成员分路 | 分路固定顺序、蓝红拆分、胜率区间、分组指标 | null 被聚合成 0；小字过多；定义依赖 title；成员顺序不稳定 | P1 修复后可用 |
| 英雄 | 构成 donut 只用于同一整体；有直接图例、键盘路径、选中详情和区间 | 8–10px 信息密度高；SVG 重复交互；硬编码 palette 未过八主题 | 基本可用 |
| 组合 | 按上野/中野/下辅分组；精确表格与胜率区间完整；蓝红语义清楚 | 宽表横向成本高；OP.GG 定义依赖 title；团队级指标容易被误读成二人因果 | 基本可用，需文案校准 |
| 打野 | 分母区分 start/ownership/首龙样本；构成条有文字；指标分组合理 | 零分母显示 0%；大量 9px；分类色硬编码 | P1 修复后可用 |
| 事件决策 | 以窗口/事件为分母；有总计和蓝红对比；保留高代价对局证据 | 零窗口显示 0%；时间缺单位；部分率无区间；复合点定义不足 | P1/P2 修复后可用 |
| 前期转化 | 零线、档位、场数、胜率、Wilson 区间和逐局证据路径齐全 | @15 部分位置求和不可比；空桶为 0%；空间分配失衡 | 当前不可信（@15） |
| 默契 | 共同场次、共同胜率、基线、原始差和权重均可见；图形不依赖 hover | 命名具有因果暗示；权重误称可靠度；未控制混杂 | 仅可作实验性描述 |
| 指标散点 | 角色颜色+单字冗余；轴、直接标签、键盘焦点、精确表格齐全 | 缺失点可能落在 0；硬编码色；同指标可重复；标签碰撞/窄宽待人工看 | P1 修复后可用 |
| 对局明细 | 直接回到单局证据；阵容、位置、英雄、版本、时长齐全；响应式分栏 | 零差值负色；固定上海时区；“Akari 对局”仅导航不自动定位 gameId | 基本可用 |

### 7. 已确认的优点

- renderer 通过 allowlisted Electron IPC 读取数据，没有 loopback HTTP；分页会完整拉取 overview，而不是只分析前 100 场。
- schema 使用 strict Zod、contract/data version，原始可空字段在入口层有类型约束。
- repository/worker/publish 边界、取消、旧数据保留、清理二次确认和 `userData` 本地存储方向符合项目规则。
- 九个 tab 都围绕真实复盘任务，没有 hero、营销文案、通用 KPI 大卡阵列或 League 无关插画。
- 蓝/红方、正/负、角色大多有文字、符号、位置或表格作为冗余，不是只靠颜色。
- 复杂图形通常附带直接标签、选中证据面板或精确表格，主任务不完全依赖 hover。
- 多个胜率视图已经接入 Wilson 95% 区间，且低样本提示和样本数普遍可见。
- Electron 截图脚本在截图前匿名化成员别名、tag 和 gameId，并模糊头像；截图保存在系统临时目录而非仓库。

### 8. 推荐修复顺序与验收门槛

**第一批：分析真实性（必须先做）**

1. nullable 聚合与零分母语义；
2. @15 完整团队经济差；
3. source/method/freshness overview contract；
4. 默契指标改名或重新建模；
5. 为上述边界新增代表性测试。

**第二批：解释与异常状态**

1. 样本层级上下文；
2. 单位、分母、聚合方法和不确定性；
3. 原始错误/流水线术语改为用户可行动文案；
4. stale/partial/error 状态统一。

**第三批：共同复盘体验**

1. 提升字号与空间分配；
2. 高级筛选 label、指标帮助 popover、SVG 焦点/选中；
3. 稳定成员顺序；
4. 零值色调和时区。

**最终视觉验收**

1. 用匿名数据完成八主题 × 常用/窄宽 × 顶部/滚动/选中/错误/空/partial 状态截图；
2. 检查 console/page error、键盘、焦点、Esc、reduced motion、水平滚动和文字截断；
3. 把匿名截图交给人工审核。只有人工确认后，才记录视觉通过。

### 9. 本次证据与限制

- 代码审计覆盖 shared schema、main controller/repository/IPC、renderer shard/store、筛选、聚合、九个视图、公共格式化和 UI audit 脚本。
- 运行态审计使用当前 Electron dev 窗口和本地数据，截图脚本已匿名化；仅将截图保存在 `%TEMP%/akari-member-analysis-ui-audit`，未复制进仓库。
- focused Vitest：`15 passed | 1 skipped` 个文件，`79 passed | 1 skipped` 个测试；现有测试证明主要计算和架构路径稳定，但也暴露出“空桶胜率为 0”被固化的问题。
- `typecheck:web` 在本轮执行中没有输出 TypeScript 诊断，但命令完成状态未形成可靠的独立审计证据，因此本报告不把它计作已通过门槛。
- 本轮没有修改功能源码、没有写入或上传玩家数据、没有部署、commit、push 或创建 PR。

## 2026-08-26：五排数据分析页审计整改

本轮依照上一节审计结果完成了本地实现整改，未涉及已退役的 `member-role-dashboard`，也未增加 HTTP 数据通道。

### 已完成

- **缺失值语义**：角色、打野、事件决策和散点聚合不再把缺失值或零分母伪装成 `0`；无数据明确显示为“暂无数据”，散点只绘制横纵轴都有有效值的成员，并报告被省略数量。
- **@15 团队经济差**：仅在对局达到 15 分钟且五个固定位置都有有效 GD@15 时纳入；页面明确显示“含 @15 完整经济数据”的场数，空档位胜率保持缺失而不是 0%。
- **同队偏差语义**：原“默契”改为“同队胜率偏差”，将“提升/可靠度/得分”改为“观察差值/样本收缩权重/收缩后差值”；方法说明明确其为描述性结果，不能解释为因果或个人配合能力。
- **来源与样本上下文**：overview contract 增加数据来源；页面统一显示来源、总语料、筛选后场数、当前样本、版本范围与采集状态，避免把 350 场语料和最近 50 场分析窗口混为一谈。
- **错误与设置文案**：不再把 `PIPELINE_FAILED`、worker、raw、staging 等内部术语直接暴露给用户；身份解析失败、更新状态、旧数据和本地存储均改成简洁、可行动的中文。
- **单位、分母和不确定性**：事件延迟直接标注“秒”；转化率、高代价死亡率、资源团胜率和跨图交换率补充实际分子/分母及 Wilson 95% 区间；低样本标签改为中性的样本量描述。
- **可访问性**：高级筛选控件补齐程序化名称，折叠按钮补充展开状态和关联区域；指标帮助文本不再只依赖鼠标悬停。
- **共同复盘可读性**：原 8–11px 辅助文字提升至 12px；图表系列色收敛为基于 Akari 主题变量的语义 token；成员顺序更稳定。
- **边界修复**：对局经济差 `0` 使用中性色；对局时间跟随本机时区；散点横纵轴不会同时选择同一指标。
- **数据来源元信息**：Python 采集产物写入 `SGP 对局历史与详情`，repository/controller/schema 将其传递到 renderer；旧数据缺少该字段时使用同一兼容回退值。

### 本地验证

- `npm run typecheck:node`：通过。
- `npm run typecheck:web`：通过。
- 聚焦 Vitest：`15 passed | 1 skipped` 个文件，`80 passed | 1 skipped` 个测试。
- `git diff --check`：通过；仅出现工作区既有的换行符提示。
- `npm run audit:member-analysis-ui`：完成 57 张匿名化运行态截图，覆盖宽/窄窗口、九个视图、关键分组和设置抽屉。截图仅位于 `%TEMP%/akari-member-analysis-ui-audit`，未写入仓库。
- Python 测试未能运行：当前解释器未安装 `pytest`（`No module named pytest`）；本轮 Python 改动仅为写入固定来源元信息，但这仍记录为未覆盖的验证缺口。

### 人工视觉验收状态

已人工预检当前深色主题的宽/窄窗口截图，未发现明显遮挡、原始错误泄露或缺失值伪装为零。八主题最终视觉判断仍需由人完成；本记录不宣告视觉验收通过。建议从临时截图目录检查成员分路、事件决策、前期转化、同队偏差和窄窗口，再在实际应用中逐一切换八个主题确认对比度与可读性。

本轮没有部署、commit、push、创建 PR，也没有写入或上传任何玩家数据。

## 2026-09-06：对线期被敌方打野参与击杀统计

在原生 `member-analysis` 的“成员分路”页增加“被抓统计”。第一版只统计 14:00 前发生在成员对应分路、且敌方打野作为击杀者或助攻者参与的成员死亡；不统计未产生死亡的抓人尝试，也不推断打野等级。

### 数据与界面

- Python worker 为每局生成可回查的事件证据：成员、分路、双方英雄、事件时间、分路区域和敌方打野的击杀/助攻身份。
- 共享 contract 将旧数据未生成、本局不可用、有效且事件数为零分开表达；数据版本升至 4，旧 derivation 2 数据仍可读取并提示刷新，新 worker 写入 derivation 3。
- renderer 展示有效场次、总次数、场均、3 分钟前、3 分钟、4 分钟、5–10 分钟、10–14 分钟和涉及对局率；3:00 属于“3 分钟”，4:00 属于“4 分钟”，14:00 不纳入。
- 选择成员分路后展示逐局事件表。旧数据统一显示“请刷新数据”，不把缺失值显示为零；打野位不适用并从该指标组中省略。
- renderer 仍仅通过现有 allowlisted Electron IPC 读取 typed domain data，没有新增 HTTP、文件直读或外部数据出口。

### 本地验证

- Python 3.12 `unittest`：8/8 通过。
- 聚焦 schema、repository、analytics 和页面 Vitest：40/40 通过。
- 真实 Python sidecar pipeline integration：1/1 通过；另一个聚焦 pipeline/collector 组合为 18 通过、1 个按环境跳过，随后已单独补跑该 integration。
- `npm run typecheck:node`、`npm run typecheck:web`：通过。
- `electron-vite build`：通过；保留既有 `@reference` 与 chunk size 警告。
- member-analysis data leak guard：通过。
- UI audit：通过；临时目录包含宽/窄视图及 `light`、`dark`、`butter`、`graphite`、`cyber`、`sakura`、`mint`、`aurora` 八主题的匿名截图。现有本地分析是旧 derivation，因此截图覆盖“需刷新”状态；填充事件后的最终视觉判断仍需人工确认。
- 全量 Vitest 未通过：既有 `src/main/shards/self-update/update-executor.test.ts` 出现 1 个与本功能无关的失败，之后进程未自行退出并被终止；本记录不将全量测试写成通过。

本轮未重建 `resources/member-analysis` 下的 PyInstaller worker；当前环境没有 PyInstaller。源码开发运行和 Electron renderer 构建已验证，若要制作新的安装包，必须先按维护 runbook 重建 worker、更新 hash manifest 并完成 packaged smoke。

本轮没有部署、commit、push、创建 PR，也没有写入或上传任何玩家数据。


## 2026-09-06：整理统一设计规范

- 新增长期使用的 `design-spec.md`，统一原生项目设计入口；重点明确 Akari 风格、原版组件参考、字号、间距、表格、主题颜色、页面顺序、小窗口和交互。
- 补充各分析页默认阅读与排序规则、普通中文说明、样本与缺失处理、工程隐私边界和可执行验收；尺寸及新交互要求明确为后续设计默认，不声称现有 UI 已实现。
- 根/子目录 AGENTS 及 UI、数据可视化 Skill 指向规范；统一条形图零基线规则；修正本文件开头已被后续规则取代的“禁止所有新 Markdown”表述。历史条目不删除、不改写。
- 对照本地 `origin/dev` 的 TabbedPage、Toolkit、SettingsRow、SettingsSection 和控件尺寸配置，以及现有主题变量；未以五排页作为原版风格依据。
- 本次仅维护文档，不修改应用、玩家数据或已有未提交功能，不运行部署、提交、推送或 PR。未进行运行态视觉验收，新规范不表示旧界面已全部达标。

- 文档验证：根/子目录 AGENTS、统一设计规范及两个 Skill 已格式化；两个 Skill 的 `quick_validate.py` 在 UTF-8 模式下通过；修改文档的 Markdown 链接与尾部空白检查通过；`git diff --check` 通过（仅既有换行符警告）。README 仅局部编辑，未整体重排历史记录。仅文档变更，未运行应用测试/构建或截图验收。
