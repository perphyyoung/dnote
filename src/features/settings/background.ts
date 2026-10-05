/**
 * 笔记区底色：界面偏好，存 WebView 的 localStorage（与置顶、字号同源；`dnote.txt` 只存笔记文本）。
 *
 * 与 cdown 的差别：它走「`input` 只预览、关取色器才落盘 + 跨窗口广播」，而 dnote 只有一个窗口、
 * localStorage 写入也廉价 —— 所以 **`input` 即落盘**，拖动取色器时底色实时跟着变。
 * 不提供撤销（改坏了点「重置」）。
 *
 * 只管**背景**：底色 + 背景透明度两个偏好，都由外壳根节点画成整窗背景（标题条也浮在它上面）——
 * 所以标题条上的图标、左槽标记、各种色罩都得读 `--note-fg*`（前景派生色），写死 slate 的话
 * 浅色搭配下会看不见。唯一的例外是设置面板：它自带不透明 `bg-slate-800`，与这里无关。
 * 透明度是**不透明度**（1 = 不透明）：窗口本身 `transparent: true`（见 `tauri.conf.json`），
 * 调低它才真的透出桌面。
 */
import { ref } from "vue";

/// 与 cdown 的 `DEFAULT_BACKGROUND_COLOR`、`tauri.conf.json` 里的窗口底色一致（slate-900）
export const BACKGROUND_DEFAULT = "#0f172a";

/// 偏好键：与置顶、字号同一命名
const KEY = "dnote:background-color";
/// 外壳消费的变量（`style.css` 里 `:root` 有默认值，这里只覆盖）
const CSS_VAR = "--note-bg";
/// 外壳**真正画**的那一层：底色 + 透明度。幽灵行实底仍用 `--note-bg`（不透明），所以分两个变量
const WINDOW_VAR = "--note-bg-window";

/// `#RRGGBB`（大小写皆可）；非法值一律回落默认
function normalize(hex: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : BACKGROUND_DEFAULT;
}

/** 背景透明度（= 不透明度，1 = 不透明）的最小 / 最大 / 步进 / 缺省 */
export const BACKGROUND_ALPHA_MIN = 0.1;
export const BACKGROUND_ALPHA_MAX = 1;
export const BACKGROUND_ALPHA_STEP = 0.05;
export const BACKGROUND_ALPHA_DEFAULT = 1;

const ALPHA_KEY = "dnote:background-alpha";

/// 夹取到值域内并按步进取整；非法值一律回落缺省
function normalizeAlpha(value: number): number {
  if (!Number.isFinite(value)) return BACKGROUND_ALPHA_DEFAULT;
  const stepped = Math.round(value / BACKGROUND_ALPHA_STEP) * BACKGROUND_ALPHA_STEP;
  const clamped = Math.min(BACKGROUND_ALPHA_MAX, Math.max(BACKGROUND_ALPHA_MIN, stepped));
  return Math.round(clamped * 100) / 100; // 去掉浮点尾巴（0.7000000000000001）
}

/**
 * 底色 + 透明度 → 可直接喂给 `backgroundColor` 的字符串。
 * 不透明时**原样返回十六进制**（计算值仍是 `rgb(...)`，与以前一致，用例都按这个比）；
 * 否则给 `rgba(...)`。窗口是 `transparent: true`，所以 alpha 真的会透出桌面。
 */
export function withAlpha(hex: string, alpha: number): string {
  if (normalizeAlpha(alpha) >= BACKGROUND_ALPHA_MAX) return normalize(hex);
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${normalizeAlpha(alpha)})`;
}

function read(): string {
  const raw = localStorage.getItem(KEY);
  return raw === null ? BACKGROUND_DEFAULT : normalize(raw);
}

/// 读透明度偏好；没有偏好就用缺省
function readAlpha(): number {
  const raw = localStorage.getItem(ALPHA_KEY);
  return raw === null ? BACKGROUND_ALPHA_DEFAULT : normalizeAlpha(Number(raw));
}

/** 当前底色（`#rrggbb`）；只由下面两个函数改 */
export const backgroundColor = ref(read());

/** 当前背景透明度（= 不透明度，0.1–1）；只由 `setBackgroundAlpha` 改 */
export const backgroundAlpha = ref(readAlpha());

/// 当前界面上显示的那个底色：预览会临时改它，`--note-bg-window` 得跟着它算
let shownHex = BACKGROUND_DEFAULT;

/// 写「底色 + 透明度」那一层
function applyWindowBackground(): void {
  document.documentElement.style.setProperty(
    WINDOW_VAR,
    withAlpha(shownHex, backgroundAlpha.value),
  );
}

/// 写变量：外壳（`App.vue` 根节点）读它；两个变量一起写，别只写一个
function applyBackground(hex: string): void {
  shownHex = hex;
  document.documentElement.style.setProperty(CSS_VAR, hex);
  applyWindowBackground();
}

/** 应用 + 记住（即时生效）。夹取后与当前值相同就什么都不做 */
export function setBackgroundColor(hex: string): void {
  const next = normalize(hex);
  if (next === backgroundColor.value) return;
  backgroundColor.value = next;
  localStorage.setItem(KEY, next);
  applyBackground(next);
}

/** 应用 + 记住（即时生效）。外壳按 `withAlpha(底色, 透明度)` 画整窗背景，所以这里只动 ref */
export function setBackgroundAlpha(value: number): void {
  const next = normalizeAlpha(value);
  if (next === backgroundAlpha.value) return;
  backgroundAlpha.value = next;
  localStorage.setItem(ALPHA_KEY, String(next));
  applyWindowBackground();
}

/**
 * 只预览：写变量，不落盘、不动 ref —— 给「颜色搭配推荐」的 hover 用。
 * 离开控件时再写回 `backgroundColor.value`（已提交的值）即还原，所以预览永远不会被记住。
 */
export function previewBackgroundColor(hex: string): void {
  applyBackground(normalize(hex));
}

/** 回到默认底色（与 cdown 的「重置」同一语义） */
export function resetBackgroundColor(): void {
  setBackgroundColor(BACKGROUND_DEFAULT);
}

// 模块加载即写一次：首次渲染就是用户上次选的底色，不会先闪一下默认色
applyBackground(backgroundColor.value);
