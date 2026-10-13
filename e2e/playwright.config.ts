/**
 * e2e 配置：CDP 模式连接真实 Tauri 应用（参考 paim / cdown 的做法）。
 *
 * globalSetup 构建一次带内嵌前端的调试二进制；每个 **spec 文件** 一个应用实例
 * （独立数据目录 `temp/e2e-w<worker>-<序号>` 与独立 CDP 端口，file 级 scope 由
 * e2e-helpers 的 `_appPool` 自实现），文件结束优雅关闭该实例。
 *
 * 并行模型：`workers: 4` + `fullyParallel: false` —— 文件之间并行、文件内串行。
 * 实例的数据目录用 `DNOTE_DATA_DIR` 重定向到 temp/ 下，与开发实例的数据互不干扰。
 * e2e 跑的是 debug 构建，而单实例只在 release 注册，所以多个 e2e 实例能同时跑。
 * 实例一律不建托盘图标（`launchApp` 注入 `DNOTE_NO_TRAY=1`）：并行的每个实例都建托盘的话，
 * 系统托盘会被一串 DEV 图标塞满，而用例又碰不到托盘。任务栏图标与窗口不受影响。
 *
 * **两个 project：整机级用例单独一组，并排在最后独跑**。`16` 要按 `Win+D`（显示桌面）——
 * 那一下会最小化**整机所有窗口**，含别的 worker 的实例窗口：那期间谁要是改窗口尺寸
 * （`resizeWindowBy`）或采样 `rAF`，拿到的都是「没生效」的结果（实测：`13` 的「拖右缘」
 * 红在次级栏 320 没变）。
 *
 * 为什么要靠 `dependencies` —— 官方口径（`playwright.dev/docs/test-projects`）：
 * - 「By default, these projects will run in parallel, subject to the maximum workers limit.」
 *   即 **project 之间默认就是并行的**，光分组不解决（实测：两个 project 合并成
 *   `Running 105 tests using 5 workers`，`16` 照样可能和别人同时在跑）；
 * - 「the dependency will always run first and once all tests from this project have passed,
 *   then the other projects will run」→ `dependencies` 是唯一有保证的顺序；
 * - 代价一：「If the tests from a dependency fails then the tests that rely on this project will
 *   not be run.」→ 常规组一旦有红，`16` 就不跑（报告里会写出来，不会假装通过）；
 * - 代价二：「If those tests belong to a project with dependencies, all tests from those
 *   dependencies will also run.」→ **过滤跑 `16` 会把整组一起跑**；单跑要加 `--no-deps`
 *   （官方原话：`--no-deps` 忽略依赖与 teardown，只跑直接选中的 project）：
 *   `pnpm e2e 16-*.spec.ts --no-deps`。
 *
 * 注意：**系统剪贴板是整机唯一资源**，涉及剪贴板的动作必须包在 `withClipboard` 里，
 * 否则并行 worker 会互相串内容（见 e2e-helpers.ts 的注释）。`Win+D` 同理用 `withShowDesktop()`。
 */
import { defineConfig } from "@playwright/test";

// 测试侧日志级别（e2e-logger.ts）：默认 debug，全量落盘便于排查；嫌噪声多时临时改 warn
process.env.DNOTE_E2E_LOG_LEVEL ??= "debug";

export default defineConfig({
  testDir: import.meta.dirname,
  // 首个用例承担实例启动（spawn + CDP 就绪，典型 2~4 秒）；实例启动本身由 app fixture 的
  // 30s 超时兜底，这 15s 是给用例自身的操作与断言
  timeout: 15_000,
  // 覆盖 globalSetup 的构建耗时（缓存命中时整轮约 1 分钟）
  globalTimeout: 600_000,
  fullyParallel: false,
  reporter: "list",
  globalSetup: "./global-setup.ts",
  projects: [
    // 常规用例：文件之间并行（4 worker），文件内串行
    { name: "parallel", testIgnore: "16-*.spec.ts", workers: 4 },
    // 整机级用例（`Win+D`）：单独一组、且排在常规用例**之后**（顺序靠 `dependencies`，见文件头注释）
    { name: "machine-global", testMatch: "16-*.spec.ts", workers: 1, dependencies: ["parallel"] },
  ],
});
