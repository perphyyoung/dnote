// 前端日志助手：按级别经 commands.logMsg 上报后端（[FE] 前缀写入 dnote.log）。
// 本地缓存全局最低级别做预判，被过滤的日志不产生 IPC；缓存就绪前先放行，保证
// boot 早期日志不丢。级别变更经 log-level-changed 事件同步（set_log_level 热切）。
import { listen } from "@tauri-apps/api/event";
import { commands } from "@/bindings";

export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let cached: LogLevel | null = null;

function normalize(v: string): LogLevel {
  return v === "debug" || v === "warn" || v === "error" ? v : "info";
}

// 启动同步一次 + 监听热切事件
void commands
  .getLogLevel()
  .then((v) => (cached = normalize(v)))
  .catch(() => {}); // 缓存失败不阻塞：放行后续上报，由后端过滤
void listen<string>("log-level-changed", (e) => {
  cached = normalize(e.payload);
});

function send(level: LogLevel, parts: unknown[]) {
  if (cached && ORDER[level] < ORDER[cached]) return;
  const message = parts
    .map((p) => (typeof p === "object" ? JSON.stringify(p) : String(p)))
    .join(" ");
  commands.logMsg(level, message).catch(() => {}); // 上报失败静默（调试用途）
}

export const log = {
  debug: (...parts: unknown[]) => send("debug", parts),
  info: (...parts: unknown[]) => send("info", parts),
  warn: (...parts: unknown[]) => send("warn", parts),
  error: (...parts: unknown[]) => send("error", parts),
};

/** 运行时热切全局最低日志级别（后端会 emit log-level-changed 同步前端缓存）。 */
export async function setLogLevel(level: LogLevel): Promise<void> {
  await commands.setLogLevel(level);
  cached = level;
}
