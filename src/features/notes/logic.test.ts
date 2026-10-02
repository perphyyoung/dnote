import { describe, expect, it } from "vitest";
import { insertIndexAt, moveItem } from "@/features/notes/logic";

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

describe("insertIndexAt", () => {
  // 三行摆在视口 Y = 100 起，每行 28px；插入位取值 0..3
  const TOP = 100;
  const H = 28;
  const N = 3;
  /// 第 row 行行内偏下一点的位置（行优先模型下，行内位置不影响结果）
  const inRow = (row: number) => TOP + row * H + 20;

  it("指针停在自己那一行 → 落在 origin + 1，等价于没动", () => {
    for (let origin = 0; origin < N; origin += 1) {
      expect(insertIndexAt(inRow(origin), TOP, H, N, origin)).toBe(origin + 1);
    }
  });

  it("往下拖：插到指针所在那一行的下面", () => {
    expect(insertIndexAt(inRow(1), TOP, H, N, 0)).toBe(2);
    expect(insertIndexAt(inRow(2), TOP, H, N, 0)).toBe(3);
  });

  it("往上拖：插到指针所在那一行的上面", () => {
    expect(insertIndexAt(inRow(0), TOP, H, N, 2)).toBe(0);
    expect(insertIndexAt(inRow(1), TOP, H, N, 2)).toBe(1);
  });

  it("同一行：往下拖落到它之后，往上拖落到它之前", () => {
    expect(insertIndexAt(inRow(1), TOP, H, N, 0)).toBe(2); // 0 → 2 - 1 = 1
    expect(insertIndexAt(inRow(1), TOP, H, N, 2)).toBe(1); // 2 → 1
  });

  it("指针在列表之外钳制到两端（拖出窗口也落在首/末）", () => {
    expect(insertIndexAt(-999, TOP, H, N, 2)).toBe(0);
    expect(insertIndexAt(999, TOP, H, N, 0)).toBe(N); // 末尾 = 插到最后一行下面
  });

  it("空列表或行高非法返回 0", () => {
    expect(insertIndexAt(500, TOP, H, 0, 0)).toBe(0);
    expect(insertIndexAt(500, TOP, 0, N, 1)).toBe(0);
  });
});
