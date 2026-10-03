/**
 * 笔记正文字号：界面偏好，存 WebView 的 localStorage（与置顶同源）。
 *
 * 为什么不进 `dnote.txt`：那个文件的约定是「存储内容 = 界面内容」，字号属于界面偏好。
 *
 * 为什么落成 **CSS 变量** 而不是给 `NoteEditor` 传值：
 * - textarea 与镜像测层**必须逐字同源** —— 字号差一点折行位置就不同，手柄会系统性错位，
 *   一个变量最不容易走偏；
 * - `features/notes` 与 `features/settings` 是**同一层**，sentrux 的分层规则不允许同层互相依赖。
 *
 * 值域与默认值对齐 cdown 的设置页（10–20px、默认 14）。
 */
import { ref } from "vue";

export const FONT_SIZE_MIN = 10;
export const FONT_SIZE_MAX = 20;
export const FONT_SIZE_DEFAULT = 14;

/// 偏好键：与置顶的 `dnote:always-on-top` 同一命名
const KEY = "dnote:font-size";
/// 正文消费的变量（`style.css` 里 `:root` 有默认值，这里只覆盖）
const CSS_VAR = "--note-font-size";

/// 夹取到值域内的整数；非法值（NaN / 空 / 越界）一律回落默认
function clamp(px: number): number {
  if (!Number.isFinite(px)) return FONT_SIZE_DEFAULT;
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(px)));
}

function read(): number {
  const raw = localStorage.getItem(KEY);
  return raw === null ? FONT_SIZE_DEFAULT : clamp(Number(raw));
}

/** 当前字号（px）；只由 `setFontSize` 改 */
export const fontSize = ref(read());

/// 写变量：正文（textarea）与镜像测层都读它
function applyFontSize(px: number): void {
  document.documentElement.style.setProperty(CSS_VAR, `${px}px`);
}

/** 应用 + 记住。夹取后与当前值相同就什么都不做（不写 localStorage） */
export function setFontSize(px: number): void {
  const next = clamp(px);
  if (next === fontSize.value) return;
  fontSize.value = next;
  localStorage.setItem(KEY, String(next));
  applyFontSize(next);
}

// 模块加载即写一次：localStorage 是同步的，不必等任何组件挂载 —— 首次渲染就是对的字号
applyFontSize(fontSize.value);
