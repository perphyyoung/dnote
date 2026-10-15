/**
 * 全局热键 F9：偏好存 WebView 的 localStorage（与置顶、字号、开机自启同源，**缺省 = 开**），
 * 真正的注册 / 注销由后端命令落（见 `commands/hotkey.rs`）。
 *
 * 为什么偏好源在前端、而不是「现在有没有注册」：要「默认开 + 能关掉」就必须有地方记住
 * 「用户关过」—— 系统侧只能表达「现在有没有」；与开机自启同一口径（见 `autostart.ts`）。
 *
 * 关掉即**真的注销**：F9 是系统级独占键（`RegisterHotKey` 语义），注册期间别的程序收不到它。
 * 注册失败（被别的程序占着）时只回滚开关 + 记日志 —— 面板不给设置项写说明文案。
 */
import { ref } from "vue";
import { commands } from "@/bindings";
import { log } from "@/utils/logger";

/// 偏好键：与置顶、字号、开机自启同一命名
const KEY = "dnote:global-hotkey";

function read(): boolean {
  return localStorage.getItem(KEY) !== "0"; // 缺省 = 开
}

function persist(on: boolean): void {
  localStorage.setItem(KEY, on ? "1" : "0");
}

/** 当前偏好（默认开）；只由 `setGlobalHotkey` 改 */
export const globalHotkey = ref(read());

/** 用户点开关：先切视觉，再让后端注册 / 注销；实际状态与意图不一致就把开关与偏好一起回滚 */
export async function setGlobalHotkey(on: boolean): Promise<void> {
  const before = globalHotkey.value;
  globalHotkey.value = on;
  persist(on);
  try {
    const actual = await commands.setHotkey(on);
    if (actual !== on) {
      globalHotkey.value = before;
      persist(before);
      log.warn("[hotkey] 未能设为", on, "实际", actual, "已回滚（可能被别的程序占用）");
    }
  } catch (e) {
    globalHotkey.value = before;
    persist(before);
    log.error("[hotkey] 设置失败，已回滚", String(e));
  }
}

/** 启动时按偏好应用一次（幂等）—— 与开机自启同款，不能只改界面状态 */
export async function applyGlobalHotkey(): Promise<void> {
  try {
    const actual = await commands.setHotkey(globalHotkey.value);
    if (actual !== globalHotkey.value) {
      // 只记日志、不动偏好：用户意图仍然有效，下次启动再试
      log.warn("[hotkey] 系统实际状态与偏好不一致：偏好", globalHotkey.value, "实际", actual);
    }
  } catch (e) {
    log.error("[hotkey] 启动应用失败", String(e));
  }
}
