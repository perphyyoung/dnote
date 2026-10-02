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
