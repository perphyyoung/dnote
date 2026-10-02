// 拖拽排序的纯计算：不碰 DOM、不读时钟，全部可单测（logic.test.ts）。

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 把 from 位置的元素移到 to 位置，返回新数组（不修改入参）；越界下标自动钳制。 */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = list.slice();
  if (out.length === 0) return out;
  const f = clamp(from, 0, out.length - 1);
  const t = clamp(to, 0, out.length - 1);
  if (f === t) return out;
  const [item] = out.splice(f, 1);
  out.splice(t, 0, item);
  return out;
}

/** 粘贴文本里的行分隔：CRLF / CR / LF 统一成 LF */
const NEWLINE = /\r\n?|\n/g;

/**
 * 把一段可能多行的粘贴文本切成「结果行」。
 *
 * `before` / `after` 是光标前后的原文：首行接在 `before` 后面、末行接在 `after` 前面，
 * 于是整段粘贴的结果与「把整个记事本当多行文本编辑」的直觉一致（后文自然留在最后一行）。
 * 不含换行时返回 `null` —— 交给浏览器默认行为在光标处插入，不接管。
 */
export function pasteLines(text: string, before: string, after: string): string[] | null {
  const normalized = text.replace(NEWLINE, "\n");
  if (!normalized.includes("\n")) return null;
  const parts = normalized.split("\n");
  parts[0] = before + parts[0];
  const last = parts.length - 1;
  parts[last] = parts[last] + after;
  return parts;
}

/** 行选区 `[start, end]`（闭区间）覆盖的行；下标自动钳制到合法范围 */
export function rangeLines(lines: readonly string[], start: number, end: number): string[] {
  if (lines.length === 0) return [];
  const from = clamp(Math.min(start, end), 0, lines.length - 1);
  const to = clamp(Math.max(start, end), 0, lines.length - 1);
  return lines.slice(from, to + 1);
}

/** 行选区对应的文本（多行复制的内容）：用 `\n` 连接 */
export function selectionText(lines: readonly string[], start: number, end: number): string {
  return rangeLines(lines, start, end).join("\n");
}

/**
 * 由拖拽位移换算目标行下标。
 *
 * 行高统一，位移每满一行高就跨一行（四舍五入，半行即换位）。
 * `originIndex` 是**拖拽开始时**的下标：拖拽过程中列表会被实时重排，
 * 若用「当前下标」当基准，来回拖动会累积误差，所以基准必须固定。
 */
export function dropIndex(
  pointerY: number,
  startY: number,
  rowHeight: number,
  originIndex: number,
  count: number,
): number {
  if (count <= 0) return 0;
  if (rowHeight <= 0) return clamp(originIndex, 0, count - 1);
  const shifted = originIndex + Math.round((pointerY - startY) / rowHeight);
  return clamp(shifted, 0, count - 1);
}
