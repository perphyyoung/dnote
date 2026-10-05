/**
 * 次级面板：主面板右侧那一栏，放「不常改的笔记」。**界面偏好**存 localStorage（与字号 / 置顶
 * 同源，不进任何一个笔记文件）：面板开着还是关着是界面状态，与笔记内容无关。
 *
 * 为什么不是第二个窗口：两块面板要的是「同一套操作」，那件事的代价全在跨窗口上（焦点、置顶、
 * 坐标、跨窗口协议）。同一个窗口里再放一个 `NoteEditor` 则天然如此，唯一要做的就是**把窗口
 * 加宽**腾出这一栏 —— 收起时再减回去，于是主面板那条边不动，右边「长出来」一栏。
 * 宽度只在 `SECONDARY_W` 出现一次，`App.vue` 的一栏与这里的加减都读它。
 *
 * 打开时同时抬高窗口最小宽度：否则窗口能被拖到只够放主面板，两栏会被挤成一条缝。与 Rust 侧
 * `ensure_min_size`（按 `tauri.conf.json` 的 `minWidth` 兜底）不冲突：那个只在启动 / 托盘唤回时
 * 把**过小**的几何修回默认尺寸，不会把加宽后的窗口收回原样。
 */
import { LogicalSize, getCurrentWindow } from "@tauri-apps/api/window";
import { ref } from "vue";
import { log } from "@/utils/logger";

/** 次级面板宽度（逻辑像素）。主面板默认 360 宽，所以展开后窗口默认 680。 */
export const SECONDARY_W = 320;
/** 主面板的最小宽度：与 `tauri.conf.json` 的 `minWidth` 同一个数 */
const MAIN_MIN_W = 260;
/** 高度下限：与 `tauri.conf.json` 的 `minHeight` 同一个数（`setMinSize` 必须宽高一起给） */
const MIN_H = 200;

const KEY = "dnote:secondary-panel";

/** 面板是否展开。缺省**关**：不打开就不会创建次级面板那个笔记文件。 */
export const secondaryOpen = ref(localStorage.getItem(KEY) === "1");

/**
 * 把窗口宽度调到与 `on` 相称：开关时加减一栏，启动时只兜住「别比一栏还窄」。
 * 失败只记日志：加宽不成功时面板照样能显示（只是两栏会挤），不该因此拦住整个开关。
 */
async function resizeFor(on: boolean, atStartup: boolean): Promise<void> {
  const win = getCurrentWindow();
  const scale = await win.scaleFactor();
  const inner = (await win.innerSize()).toLogical(scale);
  const minWidth = MAIN_MIN_W + (on ? SECONDARY_W : 0);
  // 下限先设：否则紧接着的 setSize 可能被旧下限挡住（系统会按当前下限夹一次）
  await win.setMinSize(new LogicalSize(minWidth, MIN_H));
  const width = atStartup
    ? Math.max(inner.width, minWidth) // 启动时只保证放得下，不替用户决定窗口该多宽
    : Math.max(MAIN_MIN_W, inner.width + (on ? SECONDARY_W : -SECONDARY_W));
  if (Math.round(width) !== Math.round(inner.width)) {
    await win.setSize(new LogicalSize(width, inner.height));
  }
}

/** 展开 / 收起次级面板：先翻界面状态再调窗口，面板立刻出现，宽度随后跟上 */
export async function setSecondaryOpen(on: boolean): Promise<void> {
  secondaryOpen.value = on;
  localStorage.setItem(KEY, on ? "1" : "0");
  try {
    await resizeFor(on, false);
  } catch (e) {
    log.error("[secondary] 调整窗口宽度失败", e);
  }
}

/// 启动时按偏好把窗口兜到合适宽度（上一轮的宽度由 window-state 插件恢复）
export async function applySecondaryPanel(): Promise<void> {
  try {
    await resizeFor(secondaryOpen.value, true);
  } catch (e) {
    log.error("[secondary] 启动归一窗口宽度失败", e);
  }
}
