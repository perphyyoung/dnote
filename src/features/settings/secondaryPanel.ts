/**
 * 次级面板（主面板右侧那一栏）+ **两块面板的宽度**。
 *
 * 宽度模型一句话：**窗口宽 = 主面板宽 + 次级面板宽**，两个拖拽点各改它左侧的那一栏 ——
 * - **窗口右缘**（系统缩放边框）只改**次级**那一栏：展开时主面板切成**固定宽**、次级 `flex-1`，
 *   窗口加宽的增量因此全落到次级上（纯 CSS，**不挂 `Resized` 监听** —— 也就不会跟用户的手抢着
 *   改尺寸，见 `AGENTS.md` 那条禁令）。
 * - **两栏之间的分界线**拖动只改**主面板**宽度：次级让位、窗口不动。
 *
 * 所以两个宽度里只有一个是**偏好**：`secondaryPanelWidth`（收起时按「窗宽 − 主宽」算出来写回）。
 * 主面板宽度是**会话内**状态：关闭态下主面板 `flex-1` 吃满窗口，所以「主面板宽」就是当时的窗口宽
 * —— 展开那一刻取它、拖分界线时改它，收起后这份宽度又变成窗口宽自然带着。**刻意不存第二份**：
 * 存了就有两个真值，改窗口宽与存下来的主宽必然对不上。
 *
 * 面板开着还是关着是**界面偏好**（localStorage），与字号 / 底色同源，不进任何一个笔记文件。
 * 为什么不是第二个窗口：两块面板要的是「同一套操作」，那件事的代价全在跨窗口上（焦点、置顶、
 * 坐标、跨窗口协议）；同窗再放一个 `NoteEditor` 则天然如此，代价只是把窗口加宽一栏。
 *
 * 打开时同时抬高窗口最小宽度：否则窗口能被拖到只够放主面板，两栏会被挤成一条缝。与 Rust 侧
 * `ensure_min_size`（按 `tauri.conf.json` 的 `minWidth` 兜底）不冲突：那个只在启动 / 托盘唤回时
 * 把**过小**的几何修回默认尺寸，不会把加宽后的窗口收回原样。
 */
import { LogicalSize, getCurrentWindow } from "@tauri-apps/api/window";
import { ref } from "vue";
import { log } from "@/utils/logger";

/** 次级面板的**缺省**宽度（逻辑像素）：没拖过时展开给的就是这一栏 */
export const SECONDARY_DEFAULT_W = 320;
/** 次级面板的宽度下限：分界线拖到底也留这么宽，否则窗口一窄它就被挤成 0 */
export const SECONDARY_MIN_W = 200;
/** 主面板宽度下限：与 `tauri.conf.json` 的 `minWidth` 同一个数（关闭态窗口的下限） */
export const MAIN_MIN_W = 260;
/** 高度下限：与 `tauri.conf.json` 的 `minHeight` 同一个数（`setMinSize` 必须宽高一起给） */
const MIN_H = 200;

const OPEN_KEY = "dnote:secondary-panel";
const WIDTH_KEY = "dnote:secondary-panel-width";

function readWidth(): number {
  const raw = localStorage.getItem(WIDTH_KEY);
  const value = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(value)
    ? Math.max(SECONDARY_MIN_W, Math.round(value))
    : SECONDARY_DEFAULT_W;
}

/** 面板是否展开。缺省**关**：不打开就不会创建次级面板那个笔记文件。 */
export const secondaryOpen = ref(localStorage.getItem(OPEN_KEY) === "1");
/** 次级面板宽度（px）：展开时窗口要加宽的正是它，收起时按「窗宽 − 主宽」写回 */
export const secondaryPanelWidth = ref(readWidth());
/** 主面板宽度（px，**会话内**状态，不落盘）：展开那一刻 = 当时的窗口宽，拖分界线时改它 */
export const mainPanelWidth = ref(0);

/** 主面板宽度的夹取：留出次级面板的下限，拖到底也不把那一栏挤没（纯函数，e2e 也按同一口径夹） */
export function clampMainWidth(width: number, containerWidth: number): number {
  const max = Math.max(MAIN_MIN_W, Math.round(containerWidth) - SECONDARY_MIN_W);
  return Math.min(Math.max(Math.round(width), MAIN_MIN_W), max);
}

function setSecondaryWidth(width: number): void {
  const value = Math.max(SECONDARY_MIN_W, Math.round(width));
  if (value === secondaryPanelWidth.value) return;
  secondaryPanelWidth.value = value;
  localStorage.setItem(WIDTH_KEY, String(value));
}

/** 主面板宽度变了（展开态下拖分界线）：只改会话状态 —— 拖动中每帧都会调，别在这儿发 IPC */
export function setMainPanelWidth(width: number): void {
  mainPanelWidth.value = Math.max(MAIN_MIN_W, Math.round(width));
}

/**
 * 把窗口下限对齐到「主面板宽 + 次级下限」。**拖分界线松手时调**（不是每帧）：否则右缘能一路
 * 拖到把次级挤成 0（下限还是展开时那一个）。失败只记日志：这只是护栏，不该拦住拖动。
 */
export async function syncPanelWidthLimits(): Promise<void> {
  if (!secondaryOpen.value) return;
  try {
    const win = getCurrentWindow();
    await win.setMinSize(new LogicalSize(mainPanelWidth.value + SECONDARY_MIN_W, MIN_H));
  } catch (e) {
    log.error("[secondary] 更新窗口最小宽度失败", e);
  }
}

/**
 * 把窗口宽度调到与 `on` 相称：开关时加减一栏，启动时只兜住「别比一栏还窄」。
 * 失败只记日志：加宽不成功时面板照样能显示（只是两栏会挤），不该因此拦住整个开关。
 */
async function resizeFor(on: boolean, atStartup: boolean): Promise<void> {
  const win = getCurrentWindow();
  const scale = await win.scaleFactor();
  const inner = (await win.innerSize()).toLogical(scale);

  let width = inner.width;
  if (on) {
    // 主面板宽：关闭态下它吃满窗口，所以就是**当时的窗口宽**；启动时窗口已经含两栏，反推回来
    mainPanelWidth.value = atStartup
      ? Math.max(MAIN_MIN_W, Math.round(inner.width - secondaryPanelWidth.value))
      : Math.max(MAIN_MIN_W, Math.round(inner.width));
    const minWidth = mainPanelWidth.value + SECONDARY_MIN_W;
    // 下限先设：否则紧接着的 setSize 可能被旧下限挡住（系统会按当前下限夹一次）
    await win.setMinSize(new LogicalSize(minWidth, MIN_H));
    width = atStartup
      ? Math.max(inner.width, minWidth) // 启动时只保证放得下，不替用户决定窗口该多宽
      : mainPanelWidth.value + secondaryPanelWidth.value;
  } else if (!atStartup) {
    // 收起：窗口减掉的正是**当时的次级宽**（不是缺省值）—— 主面板因此一个像素都不动
    const current = Math.max(SECONDARY_MIN_W, Math.round(inner.width - mainPanelWidth.value));
    setSecondaryWidth(current);
    await win.setMinSize(new LogicalSize(MAIN_MIN_W, MIN_H));
    width = Math.max(MAIN_MIN_W, inner.width - current);
  }

  if (Math.round(width) !== Math.round(inner.width)) {
    await win.setSize(new LogicalSize(width, inner.height));
  }
}

/** 展开 / 收起次级面板：先翻界面状态再调窗口，面板立刻出现，宽度随后跟上 */
export async function setSecondaryOpen(on: boolean): Promise<void> {
  secondaryOpen.value = on;
  localStorage.setItem(OPEN_KEY, on ? "1" : "0");
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
