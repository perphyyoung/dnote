/**
 * 笔记区底色：界面偏好，存 WebView 的 localStorage（与置顶、字号同源；`dnote.txt` 只存笔记文本）。
 *
 * 与 cdown 的差别：它走「`input` 只预览、关取色器才落盘 + 跨窗口广播」，而 dnote 只有一个窗口、
 * localStorage 写入也廉价 —— 所以 **`input` 即落盘**，拖动取色器时底色实时跟着变。
 * 不提供撤销（改坏了点「重置」）。
 *
 * 只管**背景**：这个颜色就是整窗背景（写在外壳根节点上），标题条也浮在它上面 —— 所以标题条上的
 * 图标、左槽标记、各种色罩都得读 `--note-fg*`（前景派生色），写死 slate 的话浅色搭配下会看不见。
 * 唯一的例外是设置面板：它自带不透明 `bg-slate-800`，与这里无关。
 */
import { ref } from "vue";

/// 与 cdown 的 `DEFAULT_BACKGROUND_COLOR`、`tauri.conf.json` 里的窗口底色一致（slate-900）
export const BACKGROUND_DEFAULT = "#0f172a";

/// 偏好键：与置顶、字号同一命名
const KEY = "dnote:background-color";
/// 外壳消费的变量（`style.css` 里 `:root` 有默认值，这里只覆盖）
const CSS_VAR = "--note-bg";

/// `#RRGGBB`（大小写皆可）；非法值一律回落默认
function normalize(hex: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : BACKGROUND_DEFAULT;
}

function read(): string {
  const raw = localStorage.getItem(KEY);
  return raw === null ? BACKGROUND_DEFAULT : normalize(raw);
}

/** 当前底色（`#rrggbb`）；只由下面两个函数改 */
export const backgroundColor = ref(read());

/// 写变量：外壳（`App.vue` 根节点）读它
function applyBackground(hex: string): void {
  document.documentElement.style.setProperty(CSS_VAR, hex);
}

/** 应用 + 记住（即时生效）。夹取后与当前值相同就什么都不做 */
export function setBackgroundColor(hex: string): void {
  const next = normalize(hex);
  if (next === backgroundColor.value) return;
  backgroundColor.value = next;
  localStorage.setItem(KEY, next);
  applyBackground(next);
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
