import { describe, expect, it } from "vitest";
import { dropIndex, moveItem } from "@/features/notes/logic";

describe("moveItem", () => {
  it("向后移动", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
  });

  it("向前移动", () => {
    expect(moveItem(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("原地不动时返回等值新数组", () => {
    const source = ["a", "b", "c"];
    const moved = moveItem(source, 1, 1);
    expect(moved).toEqual(source);
    expect(moved).not.toBe(source);
  });

  it("不修改入参", () => {
    const source = ["a", "b", "c"];
    moveItem(source, 0, 2);
    expect(source).toEqual(["a", "b", "c"]);
  });

  it("下标越界时钳制到边界", () => {
    expect(moveItem(["a", "b", "c"], -5, 99)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 99, -5)).toEqual(["c", "a", "b"]);
  });

  it("空列表与单元素列表安全", () => {
    expect(moveItem([], 0, 3)).toEqual([]);
    expect(moveItem(["only"], 0, 5)).toEqual(["only"]);
  });
});

describe("dropIndex", () => {
  it("位移不足半行时下标不变", () => {
    expect(dropIndex(100, 100, 28, 2, 6)).toBe(2);
    expect(dropIndex(112, 100, 28, 2, 6)).toBe(2); // 12px < 14px
  });

  it("位移满半行即换位，满一行高跨一行", () => {
    expect(dropIndex(114, 100, 28, 2, 6)).toBe(3); // 14px = 0.5 行
    expect(dropIndex(128, 100, 28, 2, 6)).toBe(3);
    expect(dropIndex(156, 100, 28, 2, 6)).toBe(4);
  });

  it("向上拖同样按行高换算", () => {
    expect(dropIndex(72, 100, 28, 2, 6)).toBe(1);
    expect(dropIndex(44, 100, 28, 2, 6)).toBe(0);
  });

  it("基准是拖拽开始时的下标，来回拖动可逆", () => {
    // 从 2 拖到 4 再拖回 2：同一指针位置必须得到同一下标
    expect(dropIndex(100 + 2 * 28, 100, 28, 2, 6)).toBe(4);
    expect(dropIndex(100, 100, 28, 2, 6)).toBe(2);
  });

  it("两端钳制", () => {
    expect(dropIndex(999, 100, 28, 0, 3)).toBe(2);
    expect(dropIndex(-999, 100, 28, 2, 3)).toBe(0);
  });

  it("单行或空列表返回 0", () => {
    expect(dropIndex(500, 0, 28, 0, 1)).toBe(0);
    expect(dropIndex(500, 0, 28, 0, 0)).toBe(0);
  });

  it("行高为 0 时退化为原地不动", () => {
    expect(dropIndex(500, 0, 0, 2, 6)).toBe(2);
  });
});
