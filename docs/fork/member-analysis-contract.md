# Member analysis：当前数据与 IPC 契约

核对日期：2026-09-08。本页给出接口索引与兼容规则；精确字段由下列 schema/handler 定义，修改时同步此页，不复制完整类型声明。

## 定义位置

路径相对 `akari-src`：

- `src/shared/shards/member-analysis/schemas.ts`：请求、结果、设置、数据结构与版本常量。
- `src/main/shards/member-analysis/ipc-handlers.ts`：允许调用、参数与调用方检查。
- `src/main/shards/member-analysis/repository.ts`：持久化、分页、迁移与读取兼容。
- `src/main/shards/member-analysis/member-analysis-controller.ts`：能力、任务、刷新与清理行为。

## 当前版本与兼容

- 当前 `contractVersion = 1`，`dataVersion = 4`。前者表示 IPC/domain 结构，后者表示数据语义；数据库 schema 与 worker derivation 版本是另外的概念，不能互相代替。
- 旧无版本 payload 经 `migrateLegacyMemberAnalysisPayload` 完整校验，再转换为当前支持版本；不是无条件把任意旧数据标为新版。
- schema 不静默接受未知版本；repository 的旧数据兼容只按明确实现执行。缺少新指标应显示未生成/需刷新，不补为零。新增持久化变化需显式迁移、备份及失败恢复。

- worker 推导版本 4 修复固定分钟快照的毫秒偏差：取目标时刻前后 1 秒内最近的真实快照，精确时刻优先；不使用相邻分钟替代。保留原时间戳，不插值或补零。兼容读取推导版本 2/3，旧结果需通过正常刷新重新计算，不直接修改已有数据库。

## 允许调用

命名空间 `member-analysis-main`，仅接受受验证的主窗口调用方；参数使用对应 Zod schema。

| 调用                                | 用途              |
| ----------------------------------- | ----------------- |
| `getCapabilities`                   | 当前可用能力      |
| `getSettings` / `updateSettings`    | 读取/保存功能设置 |
| `getOverview`                       | 读取分页分析结果  |
| `startRefresh`                      | 启动刷新任务      |
| `getJob` / `cancelJob`              | 查询/取消任务     |
| `getStorageStatus`                  | 本地存储状态      |
| `previewCleanup` / `confirmCleanup` | 预览并确认清理    |

- `getOverview` 使用 cursor 分页，页大小上限 100；时长筛选为可空数值，不携带 React 表单字符串。
- 进度事件为 `job-progress`。允许字段、状态及错误码以 schema/controller 为准。
- 功能禁用时不启动后台能力。worker 可用性由运行环境判断；`WORKER_UNAVAILABLE` 是实际不可用时的错误，不是当前功能永远禁用的声明。
- 特征域返回 `MemberAnalysisResult`（`ok/value/error`）；外层 IPC 传输封装由 router 负责，不重复手工包装。
- 不开放任意路径、URL、SQL、命令、token、LCU endpoint 或文件访问。worker 不接收凭据；数据边界见根 AGENTS。

历史 Phase 0～2 的七个方法和 worker 占位状态已被后续实现取代，仅作为历史阅读，不再指导当前开发。
