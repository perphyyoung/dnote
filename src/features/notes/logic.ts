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
