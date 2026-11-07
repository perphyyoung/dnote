/**
 * 行颜色（每行一条左侧强调条）。
 *
 * 三条口径：
 * - **只改"这一行长得怎么样"，不改内容**：颜色数组按**行号**存 localStorage（与字号之类同源，
 *   不进 `dnote.txt`）。改错字不动行号 → 颜色还在；行号变了（拖拽 / 删除 / 回车）则由下面
 *   那几个纯函数跟着搬 —— 所以颜色永远贴在"行"上，而不是贴在"第 N 个字符"上。
 * - **文字本身无法逐行上色**：编辑器是单个 `<textarea>`，做不到逐行设 `color`。所以呈现是
 *   左侧 2px 强调条（与"当前行"强调条同位置、同宽），由 `NoteEditor` 按实测行盒绘制。
 * - **不进备份**：备份包只装两份笔记（纯文本），颜色是界面偏好，换机器不带。
 */
import { ref, type Ref } from "vue";
import type { Panel } from "@/features/notes/useNotes";

/// 色板：第一项「默认」= 没有颜色（强调条回到 `--note-fg-faint` 那一档的语义）
export const LINE_COLORS = [
  { value: null, label: "默认" },
  { value: "#f43f5e", label: "红" },
  { value: "#f59e0b", label: "橙" },
  { value: "#eab308", label: "黄" },
  { value: "#10b981", label: "绿" },
  { value: "#2dd4bf", label: "青" },
  { value: "#0ea5e9", label: "蓝" },
  { value: "#818cf8", label: "靛" },
  { value: "#8b5cf6", label: "紫" },
  { value: "#f472b6", label: "粉" },
] as const;

export type LineColor = string | null;

const keyFor = (panel: Panel) => `dnote:line-colors:${panel}`;

/// 读盘：解析失败 / 非数组一律当"没有颜色"，坏数据不该让编辑器起不来
function read(panel: Panel): LineColor[] {
  try {
    const raw = localStorage.getItem(keyFor(panel));
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((v) => (typeof v === "string" ? v : null));
  } catch {
    return [];
  }
}

// ── 纯函数（有单测）：所有"行号变了"的场合都由它们搬颜色 ─────────────────────

/**
 * 按 `moved`（旧行号 → 新行号，`collapseBlankLines` 已经算好）整篇重排颜色。
 * 多个旧行指向同一个新行时**先到先得** —— 与「留段内第一行原样」一致：被压掉的
 * 连续空行，颜色归到这一段留下来的那个空行上，而不是凭空消失或盖住后面的行。
 */
export function remapColors(
  colors: readonly LineColor[],
  moved: readonly number[],
  newLineCount: number,
): LineColor[] {
  const out: LineColor[] = Array.from({ length: Math.max(0, newLineCount) }, () => null);
  moved.forEach((to, from) => {
    if (to < 0 || to >= out.length) return;
    if (out[to] === null) out[to] = colors[from] ?? null;
  });
  return out;
}

/// 删掉 `[first, last]` 这些行对应的颜色（越界安全）
export function spliceColors(
  colors: readonly LineColor[],
  first: number,
  last: number,
): LineColor[] {
  const out = colors.slice();
  out.splice(Math.max(0, first), Math.max(1, last - first + 1));
  return out;
}

/// 编辑前后**行文本**的共同前缀长度 = 新增/删掉的行从哪个下标开始。
/// 不用光标猜：行首回车会把原行整体下推，编辑后的光标行并不是新行的位置。
export function commonPrefix(a: readonly string[], b: readonly string[]): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
}

/**
 * 原生编辑后的对齐：把**插入点 p 及以下**的颜色整体 ±delta 行，新位填 `null`。
 * p 由 `commonPrefix(oldLines, newLines)` 给出，delta = 行数变化量 —— 于是行首/行尾回车、
 * 粘贴多行、退格并行、撤销恢复行都按同一个规则对齐，与 `inputType`、IME、光标位置无关。
 *
 * 已知限制：`delta === 0` 的跨行替换不动颜色；合并/替换区间的颜色归属按"整体平移"处理
 * （不判断哪一行内容幸存），见 `design.md`「行颜色」。
 */
export function shiftColors(
  oldLines: readonly string[],
  newLines: readonly string[],
  colors: readonly LineColor[],
): LineColor[] {
  const p = commonPrefix(oldLines, newLines);
  const delta = newLines.length - oldLines.length;
  const out: LineColor[] = Array.from({ length: oldLines.length }, (_, i) => colors[i] ?? null);
  if (delta > 0) {
    out.splice(p, 0, ...Array.from({ length: delta }, () => null));
  } else if (delta < 0) {
    out.splice(p, -delta);
  }
  while (out.length < newLines.length) out.push(null);
  return out.slice(0, newLines.length);
}

// ── 每块面板一份实例（与 `useNotes` 同款）──────────────────────────────────────

export interface LineColors {
  /// 行号 → 颜色（长度可能落后于行数，读取一律走 `colorAt`）
  colors: Ref<LineColor[]>;
  colorAt(index: number): LineColor;
  set(index: number, color: LineColor): void;
  /// 我们自己把行次序换过了：整份替换（拖拽 / Alt+↑↓ / 撤销恢复快照用它）
  replace(next: LineColor[]): void;
  /// 原生编辑后按"编辑前后行文本的共同前缀 + 行数变化"整体平移
  shift(oldLines: readonly string[], newLines: readonly string[]): void;
}

function createLineColors(panel: Panel): LineColors {
  const colors = ref<LineColor[]>(read(panel));
  const save = () => localStorage.setItem(keyFor(panel), JSON.stringify(colors.value));
  const commit = (next: LineColor[]) => {
    colors.value = next;
    save();
  };
  return {
    colors,
    colorAt: (index) => colors.value[index] ?? null,
    set(index, color) {
      const next = colors.value.slice();
      while (next.length <= index) next.push(null);
      next[index] = color;
      commit(next);
    },
    replace: (next) => commit(next),
    shift: (oldLines, newLines) => {
      const next = shiftColors(oldLines, newLines, colors.value);
      // 行数没变 / 只是改字时不写 localStorage（每敲一个字都落盘没意义）
      if (
        next.length === colors.value.length &&
        next.every((color, i) => color === colors.value[i])
      ) {
        return;
      }
      commit(next);
    },
  };
}

const instances: Record<Panel, LineColors> = {
  main: createLineColors("main"),
  secondary: createLineColors("secondary"),
};

export function useLineColors(panel: Panel = "main"): LineColors {
  return instances[panel];
}
