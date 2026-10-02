/// 整轮 e2e 前做两件事：清掉上一轮泄漏的实例目录、构建一次带内嵌前端的调试二进制。
/// 构建输出不进控制台（失败时由抛出的异常带出），后续 spec 直接 spawn 该 exe。
import fs from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { e2eLog } from "./e2e-logger";

/// 清理上一轮可能泄漏的实例目录。
/// 为什么必须做：目录名是 `temp/e2e-w<worker>-<序号>`，而序号每轮从 0 重新计数；
/// 上一轮若某实例的数据目录没删掉（进程句柄未释放 → 见 e2e-helpers 的 removeDirBestEffort），
/// 本轮同 worker 跑到相同序号就会**复用旧数据**，用例会拿到上一轮的脏状态。
/// `wv2-w<n>` 是按 worker 长期复用的 WebView2 profile，不动。
/// `clipboard.lock` 也一并清掉：持锁方异常退出时它可能残留，会把下一轮卡到超时。
function sweepLeakedDirs(): void {
  const temp = join(import.meta.dirname, "..", "temp");
  if (!fs.existsSync(temp)) return;
  const leaked = fs
    .readdirSync(temp)
    .filter((name) => /^e2e-w\d+-\d+$/.test(name) || /-stale-\d+$/.test(name));
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
  try {
    fs.rmSync(join(temp, "clipboard.lock"), { recursive: true, force: true });
  } catch (e) {
    e2eLog.warn(`[global-setup] 清理剪贴板锁失败：${e}`);
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
