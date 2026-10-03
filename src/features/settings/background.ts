/**
 * 笔记区底色：界面偏好，存 WebView 的 localStorage（与置顶、字号同源；`dnote.txt` 只存笔记文本）。
 *
 * 与 cdown 的差别：它走「`input` 只预览、关取色器才落盘 + 跨窗口广播」，而 dnote 只有一个窗口、
 * localStorage 写入也廉价 —— 所以 **`input` 即落盘**，拖动取色器时底色实时跟着变。
 * 不提供撤销（改坏了点「重置」）。
 *
 * 只管**笔记区底色**：标题条、设置面板、幽灵行、行内按钮都是界面 chrome，不跟它走；
 * 文字色也不跟着变（本项目只有一套深色配色，换底色换的是"调子"，不是主题）。
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

/** 回到默认底色（与 cdown 的「重置」同一语义） */
export function resetBackgroundColor(): void {
  setBackgroundColor(BACKGROUND_DEFAULT);
}

// 模块加载即写一次：首次渲染就是用户上次选的底色，不会先闪一下默认色
applyBackground(backgroundColor.value);
