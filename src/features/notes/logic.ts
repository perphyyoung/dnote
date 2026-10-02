// 拖拽排序的纯计算：不碰 DOM、不读时钟，全部可单测（logic.test.ts）。
//
// 编辑语义一律交给浏览器原生（一个 <textarea>，见 useNotes.ts 顶部的说明），
// 所以这里只剩拖拽真正需要的那点数学 —— 拆行 / 合并 / 多行选择都是浏览器的事。

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

/**
 * 由指针位置换算**插入位**（0..行数）。
 *
 * 规则是「行优先 + 看方向」，与人把文件拖进文件夹的直觉一致：
 * - 指针落在第 i 行，且**从上往下**拖（i ≥ originIndex）→ 插到它下面（i + 1）；
 * - 指针落在第 i 行，且**从下往上**拖（i < originIndex）→ 插到它上面（i）。
 *
 * 于是「拖到哪一行的位置，就放到那一行」；指针停在自己那一行时正好得到 origin + 1，
 * 与「没动」等价（调用方据此不画插入线、不写盘）。指针拖到列表之外时钳制到两端，
 * 所以拖出窗口也仍然落在首行之前 / 末行之后。
 */
export function insertIndexAt(
  pointerY: number,
  listTop: number,
  rowHeight: number,
  count: number,
  originIndex: number,
): number {
  if (count <= 0 || rowHeight <= 0) return 0;
  const row = clamp(Math.floor((pointerY - listTop) / rowHeight), 0, count - 1);
  return row >= originIndex ? row + 1 : row;
}

// ── 行级编辑（应用内快捷键用）────────────────────────────────────────────────
// 文本与光标一起算清楚：这些函数只做计算，返回值交给组件去落到 textarea（见 NoteEditor.vue）。

/** 光标 offset → 所在行的行号与行内列（行按 `\n` 切分，列按字符数） */
export function caretLine(text: string, offset: number): { index: number; column: number } {
  const at = clamp(offset, 0, text.length);
  const before = text.slice(0, at);
  return { index: before.split("\n").length - 1, column: at - (before.lastIndexOf("\n") + 1) };
}

/** (行号, 行内列) → offset；行号与列都自动钳制到合法范围 */
export function caretOffset(text: string, index: number, column: number): number {
  const lines = text.split("\n");
  const i = clamp(index, 0, lines.length - 1);
  let offset = 0;
  for (let k = 0; k < i; k += 1) offset += lines[k].length + 1;
  return offset + clamp(column, 0, lines[i].length);
}

/**
 * 重排之后，原本第 `target` 行（按**内容**锚定）落在哪个下标。
 * `from` / `to` 就是 `moveItem` 的两个参数。拖拽要把光标放回「原来那一行」时用它：
 * 被搬走的那一行跟着走到 `to`，被它跨过的行整体挪一格，没被跨过的不动。
 */
export function moveIndexAfter(from: number, to: number, target: number): number {
  if (target === from) return to;
  if (from < to && target > from && target <= to) return target - 1;
  if (from > to && target >= to && target < from) return target + 1;
  return target;
}

/** 第 index 行的字符区间 [start, end)，**不含**行尾换行（复制当前行时用） */
export function lineRange(text: string, index: number): { start: number; end: number } {
  const lines = text.split("\n");
  const i = clamp(index, 0, lines.length - 1);
  const start = caretOffset(text, i, 0);
  return { start, end: start + lines[i].length };
}

/**
 * Ctrl+D 的纯计算：算出「删掉第 index 行」要替换的字符区间与删除后的光标位置。
 *
 * 删整行要连一个换行一起吃掉：优先吃行尾的 `\n`，光标落到下一行行首；末行没有行尾换行，
 * 就改吃行首那个（否则 `"a\n"` 里的末尾空行永远删不掉），光标收到上一行行尾。
 * 整篇只剩一行时退化为清空 —— 与「永远至少有一行」的约定一致。
 */
export function deleteLine(
  text: string,
  index: number,
): { start: number; end: number; caret: number } {
  const lines = text.split("\n");
  const i = clamp(index, 0, lines.length - 1);
  const start = caretOffset(text, i, 0);
  const end = start + lines[i].length;
  if (i < lines.length - 1) return { start, end: end + 1, caret: start };
  if (i > 0) return { start: start - 1, end, caret: start - 1 };
  return { start: 0, end, caret: 0 };
}
