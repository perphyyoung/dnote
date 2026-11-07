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
 * 一个**逻辑行**排版后的行盒（内容坐标）：`top` 是它的上沿，`height` 是它折行后的总高
 * —— 未折行时就是行高，长行按右边界折行后可以有若干个行高那么高。
 *
 * 几何一律**实测**（镜像测层，见 `NoteEditor.vue`）：折行位置只有浏览器知道，
 * 所以这里不接受「行高 × 下标」这种假设。
 */
export interface LineBox {
  top: number;
  height: number;
}

/**
 * 指针 y（内容坐标）落在哪一个逻辑行里：首行之上 → 0，末行之下 → 最后一行。
 * 行盒首尾相接（行与行之间没有间隙），所以从头找一个「还没越过它下沿」的即可。
 * 空列表 → null（没有行可落）。
 */
export function lineIndexAt(pointerY: number, boxes: readonly LineBox[]): number | null {
  for (let i = 0; i < boxes.length; i += 1) {
    if (pointerY < boxes[i].top + boxes[i].height) return i;
  }
  return boxes.length === 0 ? null : boxes.length - 1;
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
 * 所以拖出窗口也仍然落在首行之前 / 末行之后。折行不改变这套规则，只改变几何来源。
 */
export function insertIndexAt(
  pointerY: number,
  boxes: readonly LineBox[],
  originIndex: number,
): number {
  const index = lineIndexAt(pointerY, boxes);
  if (index === null) return 0;
  return index >= originIndex ? index + 1 : index;
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
 * 选区覆盖的**行范围**（含首尾，`first <= last`）；只有光标（没有选区）时返回 `null` ——
 * 调用方据此走单行分支。
 *
 * 边界：浏览器选区是 `[from, to)` —— 终点正好落在某行**行首**时，那一行**没被选中**
 * （`caretTo(1, 0)` + `Shift+↓` 停在第三行行首，只该动第二行）。
 */
export function selectionLines(
  text: string,
  start: number,
  end: number,
): { first: number; last: number } | null {
  if (start === end) return null;
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  const first = caretLine(text, from).index;
  const head = caretLine(text, to);
  const last = head.column === 0 ? Math.max(first, head.index - 1) : head.index;
  return { first, last };
}

/**
 * 删掉 `[first, last]` 这一段逻辑行（`Ctrl+D`；单行是它的退化）：算出要替换的字符区间与
 * 删除后的光标位置 —— 文本与光标一起交给组件落到 textarea。
 *
 * 删整行要连一个换行一起吃掉：块后面还有行就吃**块尾行尾**那个 `\n`，光标落到**块首位置**
 * （顶上来的那一行行首）；块含末行时末行没有行尾换行，改吃**块首行首**那个（否则 `"a\n"`
 * 里的末尾空行永远删不掉），光标收到上一行行尾；整篇都在块里则退化为清空 ——
 * 与「永远至少有一行」的约定一致。
 */
export function deleteLines(
  text: string,
  first: number,
  last: number,
): { start: number; end: number; caret: number } {
  const lines = text.split("\n");
  const f = clamp(Math.min(first, last), 0, lines.length - 1);
  const l = clamp(Math.max(first, last), f, lines.length - 1);
  const start = caretOffset(text, f, 0);
  const blockEnd = caretOffset(text, l, lines[l].length);
  if (l < lines.length - 1) return { start, end: blockEnd + 1, caret: start };
  if (f > 0) return { start: start - 1, end: blockEnd, caret: start - 1 };
  return { start: 0, end: blockEnd, caret: 0 };
}

/** 删一行（行内「删除当前行」按钮走它）：与多行版**同一份规则**，只是块大小为 1 */
export function deleteLine(
  text: string,
  index: number,
): { start: number; end: number; caret: number } {
  return deleteLines(text, index, index);
}

/**
 * 右键菜单该摆在哪：默认贴指针（`x` / `y` 是 client 坐标），**右 / 下越界时朝指针那一侧翻转**。
 * 窗口是无边框的，越界出来的部分就是看不见（不像系统菜单会自己躲）。
 * 菜单比视口还大时钳到 0（至少让它从左上角开始，别整块跑到外面）。
 */
export function menuPosition(
  x: number,
  y: number,
  menuW: number,
  menuH: number,
  viewW: number,
  viewH: number,
): { x: number; y: number } {
  return {
    x: Math.max(0, x + menuW <= viewW ? x : x - menuW),
    y: Math.max(0, y + menuH <= viewH ? y : y - menuH),
  };
}

/**
 * 把 `[first, last]` 这一段**整体**上移（`delta < 0`）或下移（`delta > 0`）一行：与块外相邻
 * 的那一行交换。块已顶到首行还要上移 / 底到末行还要下移 → `null`（调用方据此什么都不做）。
 * 不修改入参。单行的 `Alt+↑/↓` 走 `moveItem`，多行走这里。
 */
export function moveLines<T>(
  list: readonly T[],
  first: number,
  last: number,
  delta: number,
): T[] | null {
  if (list.length === 0) return null;
  const f = clamp(Math.min(first, last), 0, list.length - 1);
  const l = clamp(Math.max(first, last), f, list.length - 1);
  const neighbour = delta < 0 ? f - 1 : l + 1;
  if (neighbour < 0 || neighbour >= list.length) return null;
  const out = list.slice();
  const [swapped] = out.splice(neighbour, 1);
  // 摘掉相邻那一行之后块整体挪了一格：上移时插到**块尾之后**、下移时插到**块首之前**
  out.splice(delta < 0 ? l : f, 0, swapped);
  return out;
}

/**
 * 清除**连续空行**（**整篇**，与选区无关）：连续 ≥2 个空行只留 1 个，留段内**第一行原样**；
 * 单个空行、非空行都不动。
 *
 * 「空行」= 内容全是空白字符的行（长度 0、纯空格、制表符、全角空格都算）—— 与「允许空行」的
 * 口径一致：缩进用的空白行不该被当成两段的分界。
 *
 * 返回 `null` = 没有可压的：调用方据此**不写盘、不进撤销栈**，连光标都不动。
 * `caret` 按**内容**锚定：原光标行留着 → 落到它的新行号（列不变，越界由 `caretOffset` 钳制）；
 * 它属于被压掉的那些空行 → 落到这一段留下来的那个空行上（列自然变成 0）。
 * `moved` = 旧行号 → 新行号（函数内部本来就要算）：供行颜色这类按行号存的旁路状态
 * 一起搬位，调用方不必再反推文本差异。
 */
export function collapseBlankLines(
  text: string,
  caret: number,
): { text: string; caret: number; moved: number[] } | null {
  const lines = text.split("\n");
  const at = caretLine(text, caret);
  const kept: string[] = [];
  /// 旧行号 → 新行号；被压掉的行指向该段**留下来的**那一行
  const moved: number[] = [];
  let collapsed = false;

  for (const line of lines) {
    const last = kept[kept.length - 1];
    if (kept.length > 0 && last !== undefined && last.trim() === "" && line.trim() === "") {
      collapsed = true;
      moved.push(kept.length - 1);
      continue;
    }
    moved.push(kept.length);
    kept.push(line);
  }

  if (!collapsed) return null;
  const next = kept.join("\n");
  return {
    text: next,
    caret: caretOffset(next, moved[at.index] ?? 0, at.column),
    moved,
  };
}
