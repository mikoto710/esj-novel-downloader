# 测试约定

## 目录职责

- `tests/download/`：下载协调、生命周期、状态机、重试、完整性检查、worker pool 和取消。
- `tests/cache/`：任务锁、缓存恢复、增量写入、迁移、所有权、backpressure 和存储失败。
- `tests/mapping-font/`：映射字体检测、缓存规范化和导出绑定。
- `tests/export/`：TXT、HTML、EPUB、图片处理及全本／单章隔离。
- `tests/ui/`：日志、通用消息、诊断界面、缺章决策和映射字体状态。
- `tests/infrastructure/`：共享测试设施、诊断记录和浏览器持久化边界。
- `tests/stress/`：3000 章、高缓存命中、大 Blob、慢存储、backpressure 和取消矩阵。
- `tests/support/`：mocks、fixtures、fakes、factories 和资源追踪工具。
- `tests/setup.ts`：统一安装和恢复测试环境。

这些目录属于同一个 Vitest 测试包，不拆分为多个 npm package。

## 测试类型

- `*.test.ts`：纯函数、状态机、重试、worker pool 和缓存写入策略。
- `*.contract.test.ts`：页面适配、下载核心、缓存、锁和导出之间的稳定契约。
- `*.characterization.test.ts`：记录复杂流程已经确认的行为，供后续重构比较。

测试名称应描述外部可观察结果，不应固定容易变化的内部调用顺序。

测试文件及 `describe` / `it` 描述统一使用英文。

## 异步与时间

- 使用 `createDeferred()` 控制 Promise 完成顺序。
- 心跳、重试、退避和超时使用 `useFakeClock()`。
- 不得使用真实秒级等待模拟竞态。
- 测试结束前必须消费或清除 fake timers。
- 不应依赖不确定的微任务执行顺序。

## 外部边界

- GM API 使用统一 userscript mocks。
- HTML 解析使用最小化 fixtures。
- 下载核心使用 fake fetcher、processor、cache repository 和 lock service。
- IndexedDB 测试使用隔离数据库，并在结束后关闭和删除。
- BroadcastChannel 测试使用 fake channel，并显式关闭全部实例。
- 自动化测试不得访问实时 ESJZone、真实网络或生产 IndexedDB。

## 下载生命周期覆盖

修改下载流程时，应根据影响范围覆盖：

- 成功；
- 失败；
- 普通停止；
- 停止并清除；
- 缓存恢复；
- 重复取消；
- 存储失败；
- 锁和写入所有权丢失。

涉及生命周期时，还应确认 timer、listener、channel、数据库和任务锁均已释放。

## 命令与完成口径

迭代时先运行最接近改动边界的测试，然后执行：

```bash
npm run check
```

`npm run check` 包含 TypeScript 检查和普通测试，但不包含 `tests/stress/`。

修改下载调度、缓存、迁移、锁、跨页面同步、并发或取消时，额外执行：

```bash
npm run test:stress
```

发布准备执行：

```bash
npm run format:check
npm run build
npm run test:stress
```

局部测试通过不能描述为完整构建通过。未执行的检查、浏览器验证和剩余风险都应明确记录。

## 浏览器验证

以下场景不能完全由 jsdom 替代：

- userscript 页面注入；
- GM API 权限和网络请求；
- 浏览器下载触发；
- HTML / EPUB 阅读器显示；
- 弹窗尺寸、滚动和视觉状态。

涉及这些场景时，应记录实际使用的浏览器和 userscript 管理器。
