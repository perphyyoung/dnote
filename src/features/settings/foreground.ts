/**
 * 笔记正文的前景颜色：界面偏好，存 WebView 的 localStorage（与置顶、字号、底色同源）。
 *
 * 与 `background.ts` 同款：`input` 即落盘（拖动取色器时正文实时跟着变）、不做撤销、非默认时给「重置」。
 *
 * 它不只是"文字颜色"：`--note-fg` 还派生出**左槽标记与各种色罩**的弱化色（见 `style.css` 里那三个
 * `--note-fg-*`）—— 续行箭头、手柄 `⠿`、当前行高亮罩、拖拽源行罩、行内按钮的 chip 全跟着它走。
 * 理由是浅色搭配：这些元素原先写死 slate，浅底色上要么直接看不见（箭头），要么像贴了块黑胶布
 * （按钮 chip），所以它们的颜色必须与正文同源（见 `开发经验.md`）。
 */
import { ref } from "vue";

/// 默认前景 = slate-400：就是推荐表里第一档「柔灰」的前景色。不用 slate-200（#e2e8f0）——
/// 那个与深底的对比度接近 14.5:1，长时间看偏刺眼；柔灰 ≈6.7:1，是"看着舒服"那一档。
export const FOREGROUND_DEFAULT = "#94a3b8";

/// 偏好键：与置顶、字号、底色同一命名
const KEY = "dnote:foreground-color";
/// 消费的变量（`style.css` 里 `:root` 有默认值，这里只覆盖）
const CSS_VAR = "--note-fg";

/// `#RRGGBB`（大小写皆可）；非法值一律回落默认
function normalize(hex: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : FOREGROUND_DEFAULT;
}

function read(): string {
  const raw = localStorage.getItem(KEY);
  return raw === null ? FOREGROUND_DEFAULT : normalize(raw);
}

/** 当前前景（`#rrggbb`）；只由下面两个函数改 */
export const foregroundColor = ref(read());

/// 写变量：`NoteEditor` 的正文 / 镜像 / 标记与 `style.css` 里的派生色都读它
function applyForeground(hex: string): void {
  document.documentElement.style.setProperty(CSS_VAR, hex);
}

/** 应用 + 记住（即时生效）。规范化后与当前值相同就什么都不做 */
export function setForegroundColor(hex: string): void {
  const next = normalize(hex);
  if (next === foregroundColor.value) return;
  foregroundColor.value = next;
  localStorage.setItem(KEY, next);
  applyForeground(next);
}

/**
 * 只预览：写变量，不落盘、不动 ref —— 给「颜色搭配推荐」的 hover 用。
 * 离开控件时再写回 `foregroundColor.value`（已提交的值）即还原，所以预览永远不会被记住。
 */
export function previewForegroundColor(hex: string): void {
  applyForeground(normalize(hex));
}

/** 回到默认前景（与「背景颜色」的「重置」同一语义） */
export function resetForegroundColor(): void {
  setForegroundColor(FOREGROUND_DEFAULT);
}

// 模块加载即写一次：首次渲染就是用户上次选的前景，不会先闪一下默认色
applyForeground(foregroundColor.value);
