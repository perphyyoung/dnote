/// 整轮 e2e 前做两件事：清掉上一轮泄漏的实例目录、构建一次带内嵌前端的调试二进制。
/// 构建输出实时继承到控制台（进度可见），后续 spec 直接 spawn 该 exe。
import fs from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { e2eLog } from "./e2e-logger";
import { e2eTargetDir } from "./target-dir";

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
  const targetDir = e2eTargetDir();
  const started = Date.now();
  e2eLog.info(`[global-setup] 构建 e2e 二进制（target=${targetDir}）`);
  // beforeBuildCommand 走 `pnpm build` → build-stable-mtime.mjs：dist 内容未变时保留 mtime，
  // 否则 tauri/custom-protocol 每轮都会因 dist 重写而重编 dnote（见 AGENTS.md 环境要点）
  execSync("pnpm tauri build --debug --no-bundle", {
    cwd: join(import.meta.dirname, ".."),
    // 不吞输出：cargo/前端构建进度实时可见，避免看起来卡住
    stdio: "inherit",
    env: {
      ...process.env,
      CARGO_TARGET_DIR: targetDir,
      // auto：stderr 是 TTY 才显示进度，宽度自动探测；CI/重定向时自动隐藏
      CARGO_TERM_PROGRESS_WHEN: "auto",
    },
  });
  e2eLog.info(
    `[global-setup] e2e 二进制构建完成，用时 ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
}
