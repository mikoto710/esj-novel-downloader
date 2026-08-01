# 测试约定

## 目录职责

- `tests/*.test.ts`：当前单元测试与测试基础设施自测；后续按规模再拆分 `unit/`、`integration/` 和 `stress/`，不为目录形式提前搬动现有测试。
- `tests/support/`：所有测试共享的 mocks、fixtures、fakes、factories 和资源追踪工具。
- `tests/setup.ts`：每个用例统一安装/恢复 userscript API、fake IndexedDB、DOM 状态和资源泄漏检查。

## 异步与时间

- 需要控制 Promise 完成顺序时使用 `createDeferred()`，不要依赖真实网络或不确定的微任务顺序。
- 心跳、重试、退避和超时测试使用 `useFakeClock()`；测试中不得用真实秒级等待。
- 测试结束前应消费或清除所有 fake timers。全局 teardown 会把未清理 timer 作为失败报告。

## 外部边界

- GM API 使用 `getUserscriptApiMocks()` 读取调用记录或驱动响应。
- HTML 解析使用详情页、论坛页和章节 fixtures；业务流程测试不得依赖实时 ESJZone 页面。
- 下载核心测试使用 `FakeChapterFetcher`、`FakeChapterProcessor`、`InMemoryCacheRepository` 和 `FakeBookLockService`，不得访问真实网络或 IndexedDB。
- IndexedDB adapter 测试使用 `openTestDatabase()` 创建唯一数据库，并在结束前执行 `closeTestDatabase()` 与 `deleteTestDatabase()`。
- BroadcastChannel 测试使用 `installFakeBroadcastChannel()`，并显式关闭所有 channel。

## 隔离与命名

- 测试用例名称描述业务结果，不固定即将被重构的内部调用顺序。
- 每个用例独立创建 state、repository、lock 和 observer，不跨用例共享可变单例。
- timer、listener、channel、database 必须通过 `tests/support` 的追踪工具创建或注册；全局 teardown 会报告并清理泄漏资源。
