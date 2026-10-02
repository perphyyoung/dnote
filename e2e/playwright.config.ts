/**
 * e2e 配置：CDP 模式连接真实 Tauri 应用（参考 cdown / paim 的做法）。
 *
 * globalSetup 构建一次带内嵌前端的调试二进制，spec 自己 spawn 实例并通过 CDP 接管页面；
 * 实例的数据目录用 DNOTE_DATA_DIR 重定向到 temp/ 下，与开发实例互不干扰
 * （该变量同时是「隔离实例」标识，Rust 侧据此跳过单实例注册，因此 e2e 可以与 dev 实例并存）。
 *
 * 仍固定 workers: 1：同一时刻只跑一个实例，避免窗口状态文件互相覆盖。
 */
import { defineConfig } from "@playwright/test";

// 测试侧日志级别（e2e-logger.ts）：默认 debug，全量落盘便于排查；嫌噪声多时临时改 warn
process.env.DNOTE_E2E_LOG_LEVEL ??= "debug";

export default defineConfig({
  testDir: import.meta.dirname,
  // 首个用例承担实例启动（spawn + CDP 就绪，典型 2~4 秒）
  timeout: 15_000,
  // 覆盖 globalSetup 的构建耗时（缓存命中时整轮约 1 分钟）
  globalTimeout: 600_000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  globalSetup: "./global-setup.ts",
});
