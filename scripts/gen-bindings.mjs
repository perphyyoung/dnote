// pnpm check 的 bindings 复写步骤：以「导出即退」模式启动调试主程序，重新生成
// src/bindings.ts（导出即退逻辑见 lib.rs run() 开头的 DNOTE_EXPORT_BINDINGS 短路）。
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");
// 共享 target 目录由机器级环境变量 CARGO_TARGET_DIR 提供；兜底只在未设置时生效。
const targetDir = process.env.CARGO_TARGET_DIR ?? path.join(root, "target");
const exe = path.join(targetDir, "debug", "dnote.exe");
const out = path.join(root, "src", "bindings.ts");

if (!fs.existsSync(exe)) {
  console.error(`未找到调试二进制 ${exe}（check 链路中的 cargo build 应先生成它）`);
  process.exit(1);
}

const r = spawnSync(exe, {
  env: { ...process.env, DNOTE_EXPORT_BINDINGS: "1" },
  timeout: 10_000, // 正常毫秒级退出；超时说明二进制过期，应重新 cargo build
});
if (r.error || r.status !== 0) {
  console.error(
    `导出即退进程失败：${r.error ?? `exit=${r.status}`}（请重新 cargo build 生成含 DNOTE_EXPORT_BINDINGS 短路的调试二进制）`,
  );
  process.exit(1);
}
if (!fs.existsSync(out)) {
  console.error(`复写失败：${out} 不存在`);
  process.exit(1);
}
