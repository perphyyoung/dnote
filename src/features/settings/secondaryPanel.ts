/**
 * 次级面板（主面板右侧那一栏）+ **两块面板的宽度**。
 *
 * 宽度模型一句话：**窗口宽 = 主面板宽 + 次级面板宽**，两个拖拽点各改它左侧的那一栏 ——
 * - **窗口右缘**（系统缩放边框）只改**次级**那一栏：展开时主面板切成**固定宽**、次级 `flex-1`，
 *   窗口加宽的增量因此全落到次级上（纯 CSS，**不挂 `Resized` 监听** —— 也就不会跟用户的手抢着
 *   改尺寸，见 `AGENTS.md` 那条禁令）。
 * - **两栏之间的分界线**拖动只改**主面板**宽度：次级让位、窗口不动。
 *
 * 两个宽度都是偏好，但**权威按时刻切换**（这是唯一不自相矛盾的分法）：
 * - **启动**（偏好=开）：**主宽偏好**摆分界线 —— 它就是分界线位置；次级宽 = window-state 恢复的
 *   窗口宽 − 主宽（算出来，不读次级宽偏好）。
 * - **从关闭态展开**：关闭态下主面板吃满窗口，所以**窗口宽**权威 —— 主宽按它写一次，
 *   窗口再加宽「次级宽偏好」。
 * - **拖分界线松手**：写主宽偏好。**这是「重启后分界线位置不变」的唯一依据**。
 * - **收起**：窗口 := 主宽，并把次级宽偏好按「窗宽 − 主宽」记下来（下次展开给多宽）。
 * - **拖窗口右缘**：不写任何偏好 —— 窗口宽的变化由 window-state 承担，重启后
 *   `次级 = 窗口宽 − 主宽` 自动复位（所以这一路仍然不需要监听 `Resized`）。
 *
 * 为什么不能只存次级宽、用「窗宽 − 次级宽」反推主宽（曾经的实现，分界线重启就跑位）：次级宽
 * 只能在收起那一刻量到（拖右缘不挂 `Resized` 就量不到），它天然滞后 —— 展开态拖过分界线再重启，
 * 反推出来的是**拖动前**的位置。分界线位置必须有自己的真值。
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
/** 等视口宽度落定的上限（ms）：`setSize` 返回 ≠ WebView 视口已更新，收起时靠它兜一下 */
const SETTLE_TIMEOUT_MS = 60;

const OPEN_KEY = "dnote:secondary-panel";
const WIDTH_KEY = "dnote:secondary-panel-width";
const MAIN_WIDTH_KEY = "dnote:main-panel-width";

function readNumber(key: string, fallback: number, min: number): number {
  const raw = localStorage.getItem(key);
  const value = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(value) ? Math.max(min, Math.round(value)) : fallback;
}

/** 面板是否展开。缺省**关**：不打开就不会创建次级面板那个笔记文件。 */
export const secondaryOpen = ref(localStorage.getItem(OPEN_KEY) === "1");
/**
 * 次级面板宽度（px）：两个用途 —— 从关闭态展开时窗口加宽多少；启动时若主宽偏好缺失，
 * 用它反推主宽。**它不是"重启后摆分界线"的依据**（那个用 `mainPanelWidth`），
 * 因为拖动窗口右缘改的是它、而不挂 `Resized` 就量不到——它只能在收起时记一次。
 */
export const secondaryPanelWidth = ref(readNumber(WIDTH_KEY, SECONDARY_DEFAULT_W, SECONDARY_MIN_W));
/**
 * 主面板宽度（px）= **分界线位置**：重启后要精确复原的就是它，所以它是偏好。
 * `0` = 还没记过：从关闭态展开时按当时的窗口宽写一次（关闭态下主面板就是窗口宽）。
 */
export const mainPanelWidth = ref(readNumber(MAIN_WIDTH_KEY, 0, MAIN_MIN_W));

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

/// 主宽落盘：`0` 是「还没记过」的哨兵值，不写下去（否则下次启动会当成立即生效的 0）
function setMainWidth(width: number): void {
  const value = Math.max(MAIN_MIN_W, Math.round(width));
  mainPanelWidth.value = value;
  localStorage.setItem(MAIN_WIDTH_KEY, String(value));
}

/** 拖动中每帧都会调：只改值，**不发 IPC 也不落盘**（落盘留给松手时的 `commitMainPanelWidth`） */
export function setMainPanelWidth(width: number): void {
  mainPanelWidth.value = Math.max(MAIN_MIN_W, Math.round(width));
}

/** 松手：把分界线位置记下来 —— 它是**重启后复原分界线**的唯一依据（see `resizeFor`） */
export function commitMainPanelWidth(): void {
  setMainWidth(mainPanelWidth.value);
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

/** 客户区尺寸（逻辑像素）：两个方向都要先量它，才知道主面板此刻多宽 */
async function measure(): Promise<{ width: number; height: number }> {
  const win = getCurrentWindow();
  const scale = await win.scaleFactor();
  const inner = (await win.innerSize()).toLogical(scale);
  return { width: inner.width, height: inner.height };
}

/** 等 WebView 视口真的落到 `target` 宽：只作兜底，超时只记日志（不抛） */
async function settleWidth(target: number): Promise<void> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const { width } = await measure();
    if (Math.round(width) === Math.round(target)) return;
  }
  log.error(`[secondary] 等待视口宽度落定超时（目标 ${target}）`);
}

/**
 * 展开：**先把主宽权威写成实测窗宽，再切布局**。
 * 关态下主面板就是窗口宽（`flex-1`），所以写完之后主栏从「吃满窗口」变成「固定宽 = 同一个
 * 数」，正文一个像素都不动；随后窗口加宽，增量全归次级（主栏仍不动）。
 * 顺序反了（先 `secondaryOpen = true`）主栏会先跳到**上一次的主宽偏好**，再被窗口补一刀。
 */
async function openSecondary(): Promise<void> {
  const win = getCurrentWindow();
  const { width, height } = await measure();
  setMainWidth(Math.max(MAIN_MIN_W, Math.round(width)));
  secondaryOpen.value = true; // ← 布局切换点：到这里主栏宽度仍是刚才那个数
  const minWidth = mainPanelWidth.value + SECONDARY_MIN_W;
  // 下限先设：否则紧接着的 `setSize` 可能被旧下限挡住（系统会按当前下限夹一次）
  await win.setMinSize(new LogicalSize(minWidth, MIN_H));
  const target = mainPanelWidth.value + secondaryPanelWidth.value;
  await win.setSize(new LogicalSize(target, height));
}

/**
 * 收起：**先缩窗口、等视口落定，再切布局**。
 * 窗口窄到主宽时主栏仍是固定宽（不变）、次级被挤成 0 宽；此时切布局，主栏 `flex-1` 吃到的
 * 就是同一个数。顺序反了（先 `secondaryOpen = false`）主栏会先吃掉**旧窗宽**再被窗口补一刀。
 *
 * 缩小失败也照样切布局：状态必须与点击一致（只是主栏会空一截、可能跳一下），只记日志。
 */
async function closeSecondary(): Promise<void> {
  const win = getCurrentWindow();
  const { width, height } = await measure();
  // 窗口减掉的正是**当时的次级宽**（不是缺省值）—— 主面板因此一个像素都不动
  const actual = Math.max(SECONDARY_MIN_W, Math.round(width - mainPanelWidth.value));
  setSecondaryWidth(actual); // 留作"下次展开给多宽"
  const target = Math.max(MAIN_MIN_W, Math.round(width) - actual);
  try {
    await win.setMinSize(new LogicalSize(MAIN_MIN_W, MIN_H));
    await win.setSize(new LogicalSize(target, height));
    await settleWidth(target);
  } catch (e) {
    log.error("[secondary] 收窄窗口失败", e);
  } finally {
    secondaryOpen.value = false;
  }
}

/** 展开 / 收起次级面板（顺序见 `openSecondary` / `closeSecondary`：反了正文会跳） */
export async function setSecondaryOpen(on: boolean): Promise<void> {
  if (on === secondaryOpen.value) return;
  localStorage.setItem(OPEN_KEY, on ? "1" : "0");
  try {
    if (on) await openSecondary();
    else await closeSecondary();
  } catch (e) {
    log.error("[secondary] 调整窗口宽度失败", e);
  }
}

/// 启动时按偏好把窗口兜到合适宽度（上一轮的宽度由 window-state 插件恢复）
async function resizeAtStartup(): Promise<void> {
  const win = getCurrentWindow();
  const { width, height } = await measure();
  if (!secondaryOpen.value) return; // 关态：主面板吃满窗口，窗口宽就是它，什么都不用做
  // 分界线以**主宽偏好**为准；没记过就拿「窗宽 − 次级宽」起个头
  const stored = mainPanelWidth.value;
  const wanted = stored > 0 ? stored : width - secondaryPanelWidth.value;
  const clamped = clampMainWidth(wanted, width);
  if (stored > 0) {
    // 只在内存里夹（窗口可能被壳搞窄过）：夹出来的值不写回偏好，免得把用户拖的位置改掉
    mainPanelWidth.value = clamped;
  } else {
    setMainWidth(clamped);
  }
  const minWidth = mainPanelWidth.value + SECONDARY_MIN_W;
  await win.setMinSize(new LogicalSize(minWidth, MIN_H));
  const target = Math.max(width, minWidth); // 启动时只保证放得下，不替用户决定窗口该多宽
  if (Math.round(target) !== Math.round(width)) await win.setSize(new LogicalSize(target, height));
}

/// 启动入口：按偏好归一窗口宽度（上一轮的宽度由 window-state 插件恢复），失败只记日志
export async function applySecondaryPanel(): Promise<void> {
  try {
    await resizeAtStartup();
  } catch (e) {
    log.error("[secondary] 启动归一窗口宽度失败", e);
  }
}
