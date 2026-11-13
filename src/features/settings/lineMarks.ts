/**
 * 行标记：颜色 + 星标，共用一套「按行号搬运」的状态。
 *
 * 两者的生命周期完全一致（改字不动行号、行号变了就整体搬、结构性编辑要能撤销），
 * 所以放在一个 store 里：一次 `shift / replace` 同时对齐两份数组，调用方不会再漏掉一份。
 * 存储仍是两个键（`dnote:line-colors:<panel>` / `dnote:line-stars:<panel>`），
 * 不迁移旧数据。
 */
import { ref, type Ref } from "vue";
import type { Panel } from "@/features/notes/useNotes";
import type { LineColor } from "@/features/settings/lineColors";

export interface LineMarksSnapshot {
  colors: LineColor[];
  stars: boolean[];
}

const colorKey = (panel: Panel) => `dnote:line-colors:${panel}`;
const starKey = (panel: Panel) => `dnote:line-stars:${panel}`;

function readColors(panel: Panel): LineColor[] {
  try {
    const raw = localStorage.getItem(colorKey(panel));
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((value) => (typeof value === "string" ? value : null));
  } catch {
    return [];
  }
}

function readStars(panel: Panel): boolean[] {
  try {
    const raw = localStorage.getItem(starKey(panel));
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((value) => value === true);
  } catch {
    return [];
  }
}

// ── 纯函数（有单测）：所有"行号变了"的场合都由它们搬标记 ─────────────────────

/**
 * 按 `moved`（旧行号 → 新行号，`collapseBlankLines` 已经算好）整篇重排。
 * 多个旧行指向同一个新行时**先到先得** —— 与「留段内第一行原样」一致。
 */
export function remapMarks<T>(
  marks: readonly T[],
  moved: readonly number[],
  newLineCount: number,
  empty: T,
): T[] {
  const out: T[] = Array.from({ length: Math.max(0, newLineCount) }, () => empty);
  moved.forEach((to, from) => {
    if (to < 0 || to >= out.length) return;
    if (out[to] === empty) out[to] = marks[from] ?? empty;
  });
  return out;
}

/// 删掉 `[first, last]` 这些行对应的标记（越界安全）
export function spliceMarks<T>(marks: readonly T[], first: number, last: number): T[] {
  const out = marks.slice();
  out.splice(Math.max(0, first), Math.max(1, last - first + 1));
  return out;
}

/// 编辑前后**行文本**的共同前缀长度 = 新增/删掉的行从哪个下标开始。
export function commonPrefix(a: readonly string[], b: readonly string[]): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
}

/**
 * 原生编辑后的对齐：把**插入点 p 及以下**的标记整体 ±delta 行，新位填 `empty`。
 * 与 `inputType`、IME、光标位置无关。
 */
export function shiftMarks<T>(
  oldLines: readonly string[],
  newLines: readonly string[],
  marks: readonly T[],
  empty: T,
): T[] {
  const p = commonPrefix(oldLines, newLines);
  const delta = newLines.length - oldLines.length;
  const out: T[] = Array.from({ length: oldLines.length }, (_, i) => marks[i] ?? empty);
  if (delta > 0) {
    out.splice(p, 0, ...Array.from({ length: delta }, () => empty));
  } else if (delta < 0) {
    out.splice(p, -delta);
  }
  while (out.length < newLines.length) out.push(empty);
  return out.slice(0, newLines.length);
}

// ── 每块面板一份实例 ────────────────────────────────────────────────────────

export interface LineMarks {
  colors: Ref<LineColor[]>;
  stars: Ref<boolean[]>;
  colorAt(index: number): LineColor;
  starAt(index: number): boolean;
  setColor(index: number, color: LineColor): void;
  setStar(index: number, on: boolean): void;
  /// 两份数组都补齐到 `lineCount`，交给 `moveItem` / `moveBlock` 做同一套置换
  padded(lineCount: number): LineMarksSnapshot;
  /// 两份数组一起替换（结构性编辑 / 撤销快照）
  replace(next: LineMarksSnapshot): void;
  /// 原生编辑后按共同前缀 + 行数变化整体平移
  shift(oldLines: readonly string[], newLines: readonly string[]): void;
}

function sameColors(a: readonly LineColor[], b: readonly LineColor[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sameStars(a: readonly boolean[], b: readonly boolean[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function createLineMarks(panel: Panel): LineMarks {
  const colors = ref<LineColor[]>(readColors(panel));
  const stars = ref<boolean[]>(readStars(panel));

  const commit = (nextColors: LineColor[], nextStars: boolean[]) => {
    if (!sameColors(nextColors, colors.value)) {
      colors.value = nextColors;
      localStorage.setItem(colorKey(panel), JSON.stringify(nextColors));
    }
    if (!sameStars(nextStars, stars.value)) {
      stars.value = nextStars;
      localStorage.setItem(starKey(panel), JSON.stringify(nextStars));
    }
  };

  return {
    colors,
    stars,
    colorAt: (index) => colors.value[index] ?? null,
    starAt: (index) => stars.value[index] === true,
    setColor(index, color) {
      const next = colors.value.slice();
      while (next.length <= index) next.push(null);
      next[index] = color;
      commit(next, stars.value.slice());
    },
    setStar(index, on) {
      const next = stars.value.slice();
      while (next.length <= index) next.push(false);
      next[index] = on;
      commit(colors.value.slice(), next);
    },
    padded(lineCount) {
      return {
        colors: Array.from({ length: lineCount }, (_, index) => colors.value[index] ?? null),
        stars: Array.from({ length: lineCount }, (_, index) => stars.value[index] === true),
      };
    },
    replace(next) {
      commit(next.colors.slice(), next.stars.slice());
    },
    shift(oldLines, newLines) {
      commit(
        shiftMarks(oldLines, newLines, colors.value, null),
        shiftMarks(oldLines, newLines, stars.value, false),
      );
    },
  };
}

const instances: Record<Panel, LineMarks> = {
  main: createLineMarks("main"),
  secondary: createLineMarks("secondary"),
};

export function useLineMarks(panel: Panel = "main"): LineMarks {
  return instances[panel];
}
