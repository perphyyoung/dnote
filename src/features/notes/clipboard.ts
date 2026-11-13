/**
 * 带色复制的载荷与落点映射（纯函数，有单测）。
 *
 * 口径：
 * - 载荷只描述**这次复制的文本**与它覆盖的每行标记（颜色 + 星标）；粘贴时必须文本完全一致才认。
 * - 颜色只接受行颜色色板里的值：剪贴板是公开通道，别的程序也能往里写同名格式。
 * - 粘贴套标记只支持「从行首开始、在行边界结束」的整行替换；行中粘贴只贴文字，
 *   否则标记该落在哪一行没有确定答案。
 * - v1 载荷（只有颜色）仍认：星标一律视为没有 —— 剪贴板可能还留着旧版本复制的内容。
 */
import { LINE_COLORS, type LineColor } from "@/features/settings/lineColors";
import type { LineMarksSnapshot } from "@/features/settings/lineMarks";

const PAYLOAD_VERSION = 2;
const LEGACY_VERSION = 1;
const VALID_COLORS: Set<string> = new Set(
  LINE_COLORS.flatMap((option) => (option.value === null ? [] : [option.value])),
);

interface MarksPayload {
  v: number;
  text: string;
  colors: LineColor[];
  stars: boolean[];
}

/// 文本覆盖的逻辑行数：末尾换行只是分隔符，不额外算一行
export function lineCount(text: string): number {
  if (text === "") return 0;
  const trailing = text.endsWith("\n") ? 1 : 0;
  return text.split("\n").length - trailing;
}

/// 起点是否在行首（空文本的 0 也算）
export function atLineStart(text: string, offset: number): boolean {
  return offset === 0 || text[offset - 1] === "\n";
}

/// 终点是否落在行边界：空选区在行首 / 吃掉了换行 / 直到文末
export function atLineBoundary(text: string, offset: number): boolean {
  return offset === 0 || offset === text.length || text[offset - 1] === "\n";
}

/// 偏移量所在的行号（0 起）
export function lineIndexOf(text: string, offset: number): number {
  let line = 0;
  const limit = Math.min(offset, text.length);
  for (let i = 0; i < limit; i += 1) {
    if (text[i] === "\n") line += 1;
  }
  return line;
}

/// 复制时写进剪贴板自定义格式的 JSON；两份数组长度对不上文本行数就不写载荷（只复制文字）
export function encodePayload(text: string, marks: LineMarksSnapshot): string | null {
  const count = lineCount(text);
  if (count === 0 || marks.colors.length !== count || marks.stars.length !== count) return null;
  const payload: MarksPayload = {
    v: PAYLOAD_VERSION,
    text,
    colors: marks.colors.slice(),
    stars: marks.stars.slice(),
  };
  return JSON.stringify(payload);
}

/// 读回载荷：版本 / 文本 / 行数 / 颜色白名单 / 星标类型任一项不符都当"没有标记"
export function decodePayload(
  raw: string | null | undefined,
  text: string,
): LineMarksSnapshot | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const payload = parsed as Partial<MarksPayload>;
  if (payload.v !== PAYLOAD_VERSION && payload.v !== LEGACY_VERSION) return null;
  if (payload.text !== text) return null;
  if (!Array.isArray(payload.colors)) return null;
  const count = lineCount(text);
  if (count === 0 || payload.colors.length !== count) return null;

  const colors: LineColor[] = [];
  for (const value of payload.colors) {
    if (value === null) {
      colors.push(null);
      continue;
    }
    if (typeof value !== "string" || !VALID_COLORS.has(value)) return null;
    colors.push(value);
  }

  // v1 没有 stars：全部视为没有星标（旧版本复制的内容仍能粘回颜色）
  if (payload.v === LEGACY_VERSION) {
    return { colors, stars: Array.from({ length: count }, () => false) };
  }
  if (!Array.isArray(payload.stars) || payload.stars.length !== count) return null;
  const stars: boolean[] = [];
  for (const value of payload.stars) {
    if (typeof value !== "boolean") return null;
    stars.push(value);
  }
  return { colors, stars };
}

interface PasteArgs {
  oldText: string;
  newText: string;
  selectionStart: number;
  selectionEnd: number;
  oldMarks: LineMarksSnapshot;
  pasted: LineMarksSnapshot;
}

/**
 * 带标记粘贴后的完整数组；不满足整行替换条件时返回 null（调用方只贴文字）。
 *
 * 行数用 `\n` 切分（textarea 的 `value` 口径）：空内容算 1 行，尾部换行会多出一个
 * 空行 —— 两份数组都必须与它同长，否则下一行的标记会串位。
 */
export function marksAfterPaste({
  oldText,
  newText,
  selectionStart,
  selectionEnd,
  oldMarks,
  pasted,
}: PasteArgs): LineMarksSnapshot | null {
  if (!atLineStart(oldText, selectionStart) || !atLineBoundary(oldText, selectionEnd)) {
    return null;
  }
  if (pasted.colors.length === 0) return null;

  const startLine = lineIndexOf(oldText, selectionStart);
  const oldLineCount = Math.max(1, oldText.split("\n").length);
  const endLine =
    selectionEnd === oldText.length ? oldLineCount : lineIndexOf(oldText, selectionEnd);
  const newLineCount = Math.max(1, newText.split("\n").length);

  /// 两块数组走同一套「替换 [startLine, endLine) 这一段」，只是空位不同
  function merge<T>(previous: readonly T[], incoming: readonly T[], empty: T): T[] {
    const base: T[] = Array.from({ length: oldLineCount }, (_, index) => previous[index] ?? empty);
    const next = [...base.slice(0, startLine), ...incoming, ...base.slice(endLine)];
    while (next.length < newLineCount) next.push(empty);
    return next.slice(0, newLineCount);
  }

  return {
    colors: merge(oldMarks.colors, pasted.colors, null),
    stars: merge(oldMarks.stars, pasted.stars, false),
  };
}
