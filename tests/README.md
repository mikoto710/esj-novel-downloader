# 测试约定

## 目录职责

- `tests/*.test.ts`：单元测试、契约测试、流程特征测试与测试基础设施自测；文件名优先表达被验证的业务边界，不按实现目录机械映射。
- `tests/stress/`：3000 章规模下的缓存复杂度与主流程压力测试，不纳入普通测试命令。
- `tests/support/`：所有测试共享的 mocks、fixtures、fakes、factories 和资源追踪工具。
- `tests/setup.ts`：每个用例统一安装/恢复 userscript API、fake IndexedDB、DOM 状态和资源泄漏检查。

## 异步与时间

- 需要控制 Promise 完成顺序时使用 `createDeferred()`，不要依赖真实网络或不确定的微任务顺序。
- 心跳、重试、退避和超时测试使用 `useFakeClock()`；测试中不得用真实秒级等待。
- 测试结束前应消费或清除所有 fake timers。全局 teardown 会把未清理 timer 作为失败报告。
- 普通 `npm run test` 不运行 `tests/stress/`；完整规模测试通过 `npm run test:stress` 单独执行。

## 外部边界

- GM API 使用 `getUserscriptApiMocks()` 读取调用记录或驱动响应。
- HTML 解析使用详情页、论坛页和章节 fixtures；业务流程测试不得依赖实时 ESJZone 页面。
- 下载核心测试使用 `FakeChapterFetcher`、`FakeChapterProcessor`、`InMemoryCacheRepository` 和 `FakeBookLockService`，不得访问真实网络或 IndexedDB。
- IndexedDB adapter 测试使用 `openTestDatabase()` 创建唯一数据库，并在结束前执行 `closeTestDatabase()` 与 `deleteTestDatabase()`。
- BroadcastChannel 测试使用 `installFakeBroadcastChannel()`，并显式关闭所有 channel。

## 下载流程覆盖

- `*.test.ts`：验证纯函数、状态机、重试策略、worker pool 和缓存写入策略。
- `*.contract.test.ts`：验证页面适配层、下载核心、任务锁、缓存与导出之间的稳定业务契约。
- `*.characterization.test.ts`：保留复杂流程已经确认的行为，重构时应先判断行为是否仍然有效，再更新断言。
- 下载流程变更至少覆盖成功、失败、普通停止、停止并清除、缓存恢复和重复取消；涉及任务生命周期时还需断言锁、timer、listener、channel 与数据库资源均已释放。
- 修改下载调度、增量缓存、锁或取消机制后，除相关测试外还必须运行 `npm run test:stress`。

## 隔离与命名

- 测试用例名称描述业务结果，不固定即将被重构的内部调用顺序。
- 每个用例独立创建 state、repository、lock 和 observer，不跨用例共享可变单例。
- timer、listener、channel、database 必须通过 `tests/support` 的追踪工具创建或注册；全局 teardown 会报告并清理泄漏资源。
