/**
 * 开机自启：偏好存 WebView 的 localStorage（与置顶、字号、底色同源，**缺省 = 开**），
 * 真正的注册表由后端命令落（见 `commands/autostart.rs`）。
 *
 * 为什么不把注册表当唯一状态源（cdown 是那样）：要「默认开 + 能关掉」就必须有地方记住
 * 「用户关过」—— 注册表表达不了「默认」：关掉后 Run 项就没了，下次启动会以为从没开过又给打开。
 *
 * dev 构建与无人值守场景下后端**不写注册表**（只按意图回显），所以 dev / e2e 都不会污染机器。
 */
import { ref } from "vue";
import { commands } from "@/bindings";
import { log } from "@/utils/logger";

/// 偏好键：与置顶、字号、底色同一命名
const KEY = "dnote:autostart";

function read(): boolean {
  return localStorage.getItem(KEY) !== "0"; // 缺省 = 开
}

function persist(on: boolean): void {
  localStorage.setItem(KEY, on ? "1" : "0");
}

/** 当前偏好（默认开）；只由 `setAutoStart` 改 */
export const autoStart = ref(read());

/** 用户点开关：先切视觉，再让后端落注册表；与意图不一致就把开关与偏好一起回滚 */
export async function setAutoStart(on: boolean): Promise<void> {
  const before = autoStart.value;
  autoStart.value = on;
  persist(on);
  try {
    const actual = await commands.setAutostart(on);
    if (actual !== on) {
      autoStart.value = before;
      persist(before);
      log.warn("[autostart] 未能设为", on, "实际", actual, "已回滚");
    }
  } catch (e) {
    autoStart.value = before;
    persist(before);
    log.error("[autostart] 设置失败，已回滚", String(e));
  }
}

/** 启动时按偏好应用一次（幂等）—— 与置顶同款，不能只改界面状态 */
export async function applyAutoStart(): Promise<void> {
  try {
    const actual = await commands.setAutostart(autoStart.value);
    if (actual !== autoStart.value) {
      // 只记日志、不动偏好：用户意图仍然有效，下次启动再试
      log.warn("[autostart] 系统实际状态与偏好不一致：偏好", autoStart.value, "实际", actual);
    }
  } catch (e) {
    log.error("[autostart] 启动应用失败", String(e));
  }
}
