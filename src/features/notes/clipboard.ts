/**
 * 带色复制的载荷与落点映射（纯函数，有单测）。
 *
 * 口径：
 * - 载荷只描述**这次复制的文本**与它覆盖的每行颜色；粘贴时必须文本完全一致才认。
 * - 颜色只接受行颜色色板里的值：剪贴板是公开通道，别的程序也能往里写同名格式。
 * - 粘贴套色只支持「从行首开始、在行边界结束」的整行替换；行中粘贴只贴文字，
 *   否则颜色该落在哪一行没有确定答案。
 */
import { LINE_COLORS, type LineColor } from "@/features/settings/lineColors";

const PAYLOAD_VERSION = 1;
const VALID_COLORS: Set<string> = new Set(
  LINE_COLORS.flatMap((option) => (option.value === null ? [] : [option.value])),
);

interface ColorPayload {
  v: number;
  text: string;
  colors: LineColor[];
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

/// 复制时写进剪贴板自定义格式的 JSON；颜色数对不上文本行数就不写载荷（只复制文字）
export function encodePayload(text: string, colors: readonly LineColor[]): string | null {
  const count = lineCount(text);
  if (count === 0 || colors.length !== count) return null;
  const payload: ColorPayload = { v: PAYLOAD_VERSION, text, colors: colors.slice() };
  return JSON.stringify(payload);
}

/// 读回载荷：版本 / 文本 / 行数 / 颜色白名单任一项不符都当“没有颜色”
export function decodePayload(raw: string | null | undefined, text: string): LineColor[] | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const payload = parsed as Partial<ColorPayload>;
  if (payload.v !== PAYLOAD_VERSION || payload.text !== text) return null;
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
  return colors;
}

interface PasteArgs {
  oldText: string;
  newText: string;
  selectionStart: number;
  selectionEnd: number;
  oldColors: readonly LineColor[];
  pasted: readonly LineColor[];
}

/**
 * 带色粘贴后的完整颜色数组；不满足整行替换条件时返回 null（调用方只贴文字）。
 *
 * 行数用 `\n` 切分（textarea 的 `value` 口径）：空内容算 1 行，尾部换行会多出一个
 * 空行 —— 颜色数组必须与它同长，否则下一行的颜色会串位。
 */
export function colorsAfterPaste({
  oldText,
  newText,
  selectionStart,
  selectionEnd,
  oldColors,
  pasted,
}: PasteArgs): LineColor[] | null {
  if (!atLineStart(oldText, selectionStart) || !atLineBoundary(oldText, selectionEnd)) {
    return null;
  }
  if (pasted.length === 0) return null;

  const startLine = lineIndexOf(oldText, selectionStart);
  const oldLineCount = Math.max(1, oldText.split("\n").length);
  const endLine =
    selectionEnd === oldText.length ? oldLineCount : lineIndexOf(oldText, selectionEnd);
  const base: LineColor[] = Array.from(
    { length: oldLineCount },
    (_, index) => oldColors[index] ?? null,
  );
  const next = [...base.slice(0, startLine), ...pasted, ...base.slice(endLine)];

  const newLineCount = Math.max(1, newText.split("\n").length);
  while (next.length < newLineCount) next.push(null);
  return next.slice(0, newLineCount);
}
