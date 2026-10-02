/// 整轮 e2e 前做两件事：清掉上一轮泄漏的实例目录、构建一次带内嵌前端的调试二进制。
/// 构建输出不进控制台（失败时由抛出的异常带出），后续 spec 直接 spawn 该 exe。
import fs from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { e2eLog } from "./e2e-logger";

/// 实例目录名固定为 `temp/e2e-<序号>`，序号每轮从 0 重新计数；
/// 上一轮若没删掉（进程句柄未释放），本轮会复用旧数据目录而拿到脏状态。
function sweepLeakedDirs(): void {
  const temp = join(import.meta.dirname, "..", "temp");
  if (!fs.existsSync(temp)) return;
  const leaked = fs
    .readdirSync(temp)
    .filter((name) => /^e2e-\d+$/.test(name) || /-stale-\d+$/.test(name));
  for (const name of leaked) {
    try {
      fs.rmSync(join(temp, name), {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 200,
      });
      e2eLog.info(`[global-setup] 已清理上一轮残留目录 ${name}`);
    } catch (e) {
      e2eLog.warn(`[global-setup] 残留目录清理失败（本轮可能复用旧数据）：${name} — ${e}`);
    }
  }
}

export default function globalSetup(): void {
  sweepLeakedDirs();
  e2eLog.info("[global-setup] 构建调试二进制（tauri build --debug --no-bundle）");
  execSync("pnpm tauri build --debug --no-bundle", {
    cwd: join(import.meta.dirname, ".."),
    stdio: "ignore",
  });
  e2eLog.info("[global-setup] 构建完成");
}
