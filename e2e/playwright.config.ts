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
 * 注意：**系统剪贴板是整机唯一资源**，涉及剪贴板的动作必须包在 `withClipboard` 里，
 * 否则并行 worker 会互相串内容（见 e2e-helpers.ts 的注释）。
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
  workers: 4,
  reporter: "list",
  globalSetup: "./global-setup.ts",
});
