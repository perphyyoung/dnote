/**
 * 颜色搭配推荐：十组「前景 + 背景」，中文命名，深浅都有（不按深浅分组，按排布顺序走）。
 *
 * 它**不是第三份状态**：点一组 = 调两次 setter（前景、背景各一次），之后照样能用两个取色器
 * 各自微调 —— 所以"当前搭配"是**算出来的**（两个颜色恰好等于某组才算选中），不进 localStorage。
 * 这样就没有"主题"与"颜色"谁说了算的问题：单一事实源永远是那两个颜色偏好。
 *
 * 每组都过一遍对比度（WCAG 相对亮度，见 `contrastRatio`）：正文 ≥ 7:1。唯一的例外是「柔灰」——
 * 它是**故意**的低对比深色（长时间盯屏幕最舒服），单独豁免到 6.5:1，由 `themes.test.ts` 盯着。
 * 表里不手抄对比度数字：抄了就会飘，让单测算。
 *
 * 这个模块**只有数据与纯函数**、不 import 任何带副作用的模块（`background.ts` / `foreground.ts`
 * 加载时会写 CSS 变量与 localStorage）：单测因此不用给 localStorage 打桩。把一组搭配"应用出去"
 * 是外壳的事 —— 就是连着调两次 setter（见 `App.vue`），没有第三份状态可存。
 */

export interface Theme {
  /** 中文名：面板上直接显示，也是 e2e 的定位依据 */
  name: string;
  /** 正文颜色 `#rrggbb` */
  fg: string;
  /** 笔记区底色 `#rrggbb` */
  bg: string;
}

/** 「柔灰」是故意压低的对比度（7:1 的下限对它豁免），别的组都按 7:1 卡 */
export const LOW_CONTRAST_THEME = "柔灰";

/**
 * 二十组推荐；顺序就是下拉里的顺序，**第一档与默认配色一致**（打开就是它被选中）。
 * 排布：前 10 档深色、后 10 档浅色 —— 单列列表里读起来就是"深色一段、浅色一段"，
 * 想换"浅色系"往下翻一屏就够，不用在深浅之间来回跳。
 * 每组的对比度由 `themes.test.ts` 现算（≥7:1，柔灰豁免到 6.5:1），表里不手抄数字。
 */
export const THEMES: readonly Theme[] = [
  // 深色系
  { name: "柔灰", fg: "#94a3b8", bg: "#0f172a" },
  { name: "墨蓝", fg: "#e2e8f0", bg: "#0f172a" },
  { name: "深灰", fg: "#cbd5e1", bg: "#1e293b" },
  { name: "碳灰", fg: "#e5e7eb", bg: "#18181b" },
  { name: "藏蓝", fg: "#dbeafe", bg: "#172554" },
  { name: "紫夜", fg: "#ede9fe", bg: "#2e1065" },
  { name: "墨绿", fg: "#d1fae5", bg: "#052e16" },
  { name: "终端绿", fg: "#86efac", bg: "#0a0a0a" },
  { name: "暖褐", fg: "#e7e5e4", bg: "#1c1917" },
  { name: "焦糖", fg: "#ffedd5", bg: "#431407" },
  // 浅色系
  { name: "冷白", fg: "#1e293b", bg: "#f8fafc" },
  { name: "浅灰", fg: "#334155", bg: "#f1f5f9" },
  { name: "天青", fg: "#0c4a6e", bg: "#f0f9ff" },
  { name: "青灰", fg: "#134e4a", bg: "#f0fdfa" },
  { name: "米色", fg: "#3f3a34", bg: "#f7f3ea" },
  { name: "琥珀", fg: "#713f12", bg: "#fffbeb" },
  { name: "秋叶", fg: "#7c2d12", bg: "#fff7ed" },
  { name: "藕荷", fg: "#4c1d95", bg: "#f5f3ff" },
  { name: "豆沙绿", fg: "#2b3a2f", bg: "#c7edcc" },
  { name: "樱粉", fg: "#831843", bg: "#fdf2f8" },
];

/** 当前的前景 / 背景恰好等于哪一组；都不是就是"自定义"（返回 `null`） */
export function matchTheme(fg: string, bg: string): Theme | null {
  return THEMES.find((theme) => theme.fg === fg && theme.bg === bg) ?? null;
}

/// 一个通道的线性值（sRGB 反伽马）
function channel(hex: string, index: number): number {
  const raw = Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
  return raw <= 0.04045 ? raw / 12.92 : ((raw + 0.055) / 1.055) ** 2.4;
}

/** WCAG 相对亮度（0..1） */
function luminance(hex: string): number {
  return 0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2);
}

/** 对比度（1:1 ~ 21:1）。面板不显示它 —— 只有单测与 e2e 用它当护栏 */
export function contrastRatio(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}
