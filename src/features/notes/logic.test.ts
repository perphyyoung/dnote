import { describe, expect, it } from "vitest";
import type { LineBox } from "@/features/notes/logic";
import {
  caretLine,
  caretOffset,
  deleteLine,
  insertIndexAt,
  lineIndexAt,
  lineRange,
  moveIndexAfter,
  moveItem,
} from "@/features/notes/logic";

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

// 行盒是实测的几何（长行折行后一个逻辑行可以很高），这里就用普通对象喂进去
const TOP = 100;
const H = 28;
const N = 3;
/// 未折行的三行：从 TOP 起每行 H 高
const ROWS: LineBox[] = Array.from({ length: N }, (_, i) => ({ top: TOP + i * H, height: H }));
/// 第 row 行行内偏下一点的位置（行优先模型里，行内位置不影响结果）
const inRow = (row: number) => TOP + row * H + 20;

describe("lineIndexAt", () => {
  it("落在各行里（含行的首末一格）", () => {
    expect(lineIndexAt(TOP, ROWS)).toBe(0);
    expect(lineIndexAt(TOP + H - 1, ROWS)).toBe(0);
    expect(lineIndexAt(TOP + H, ROWS)).toBe(1);
    expect(lineIndexAt(TOP + 2 * H + H - 1, ROWS)).toBe(2);
  });

  it("首行之上与末行之下都钳制到两端", () => {
    expect(lineIndexAt(-999, ROWS)).toBe(0);
    expect(lineIndexAt(TOP - 1, ROWS)).toBe(0);
    expect(lineIndexAt(9999, ROWS)).toBe(2);
  });

  it("折行后一个逻辑行可以很高（只按它的上下沿判所属）", () => {
    const wrapped: LineBox[] = [
      { top: 0, height: 3 * H }, // 折成 3 个视觉行
      { top: 3 * H, height: H },
    ];
    expect(lineIndexAt(0, wrapped)).toBe(0);
    expect(lineIndexAt(2 * H, wrapped)).toBe(0);
    expect(lineIndexAt(3 * H, wrapped)).toBe(1);
    expect(lineIndexAt(4 * H - 1, wrapped)).toBe(1);
  });

  it("空列表没有行可落", () => {
    expect(lineIndexAt(123, [])).toBeNull();
  });
});

describe("insertIndexAt", () => {
  it("指针停在自己那一行 → 落在 origin + 1，等价于没动", () => {
    for (let origin = 0; origin < N; origin += 1) {
      expect(insertIndexAt(inRow(origin), ROWS, origin)).toBe(origin + 1);
    }
  });

  it("往下拖：插到指针所在那一行的下面", () => {
    expect(insertIndexAt(inRow(1), ROWS, 0)).toBe(2);
    expect(insertIndexAt(inRow(2), ROWS, 0)).toBe(3);
  });

  it("往上拖：插到指针所在那一行的上面", () => {
    expect(insertIndexAt(inRow(0), ROWS, 2)).toBe(0);
    expect(insertIndexAt(inRow(1), ROWS, 2)).toBe(1);
  });

  it("同一行：往下拖落到它之后，往上拖落到它之前", () => {
    expect(insertIndexAt(inRow(1), ROWS, 0)).toBe(2); // 0 → 2 - 1 = 1
    expect(insertIndexAt(inRow(1), ROWS, 2)).toBe(1); // 2 → 1
  });

  it("指针在列表之外钳制到两端（拖出窗口也落在首/末）", () => {
    expect(insertIndexAt(-999, ROWS, 2)).toBe(0);
    expect(insertIndexAt(999, ROWS, 0)).toBe(N); // 末尾 = 插到最后一行下面
  });

  it("折行行按整块算：指针落在这块里就是这一行", () => {
    const wrapped: LineBox[] = [
      { top: 0, height: 3 * H }, // 第 0 行折成 3 个视觉行
      { top: 3 * H, height: H },
    ];
    expect(insertIndexAt(2 * H, wrapped, 0)).toBe(1); // 停在自己这一块里 → 等价于没动
    expect(insertIndexAt(2 * H, wrapped, 1)).toBe(0); // 往上拖 → 插到它上面
  });

  it("空列表返回 0", () => {
    expect(insertIndexAt(500, [], 0)).toBe(0);
  });
});

// 三行、每行 3 个字：offset 0..2 第一行（换行在 3）、4..6 第二行（换行在 7）、8..10 第三行
const TEXT = "第一行\n第二行\n第三行";

describe("caretLine / caretOffset", () => {
  it("offset 落在首行、行中、末行", () => {
    expect(caretLine(TEXT, 0)).toEqual({ index: 0, column: 0 });
    expect(caretLine(TEXT, 5)).toEqual({ index: 1, column: 1 });
    expect(caretLine(TEXT, 11)).toEqual({ index: 2, column: 3 });
  });

  it("换行符那一格仍算上一行行尾，过了它才是下一行行首", () => {
    // 光标停在换行符上时视觉上还在上一行末尾，Ctrl+D 因此删的是上一行（与编辑器惯例一致）
    expect(caretLine(TEXT, 3)).toEqual({ index: 0, column: 3 });
    expect(caretLine(TEXT, 4)).toEqual({ index: 1, column: 0 });
    expect(caretLine(TEXT, 7)).toEqual({ index: 1, column: 3 });
    expect(caretLine(TEXT, 8)).toEqual({ index: 2, column: 0 });
  });

  it("offset 越界钳制到文本两端", () => {
    expect(caretLine(TEXT, -5)).toEqual({ index: 0, column: 0 });
    expect(caretLine(TEXT, 999)).toEqual({ index: 2, column: 3 });
  });

  it("与 caretOffset 互为逆运算", () => {
    for (const offset of [0, 3, 5, 7, 11]) {
      const { index, column } = caretLine(TEXT, offset);
      expect(caretOffset(TEXT, index, column)).toBe(offset);
    }
  });

  it("行号与列越界都钳制", () => {
    expect(caretOffset(TEXT, 0, 0)).toBe(0);
    expect(caretOffset(TEXT, 1, 2)).toBe(6);
    expect(caretOffset(TEXT, 99, 99)).toBe(11);
    expect(caretOffset(TEXT, -1, -5)).toBe(0);
  });
});

describe("moveIndexAfter", () => {
  // 与 moveItem(["A","B","C","D"], from, to) 的结果对齐
  it("被搬的那一行跟着走", () => {
    expect(moveIndexAfter(0, 2, 0)).toBe(2); // A → 下标 2
    expect(moveIndexAfter(3, 1, 3)).toBe(1); // D → 下标 1
  });

  it("被跨过的行整体挪一格", () => {
    expect(moveIndexAfter(0, 2, 1)).toBe(0); // B: [A,B,C,D] → [B,C,A,D]
    expect(moveIndexAfter(0, 2, 2)).toBe(1); // C → 1
    expect(moveIndexAfter(3, 1, 1)).toBe(2); // B: [A,B,C,D] → [A,D,B,C]
    expect(moveIndexAfter(3, 1, 2)).toBe(3); // C → 3
  });

  it("没被跨过的行不动", () => {
    expect(moveIndexAfter(0, 2, 3)).toBe(3); // D 在区间外
    expect(moveIndexAfter(3, 1, 0)).toBe(0); // A 在区间外
  });

  it("原地不动时下标不变", () => {
    expect(moveIndexAfter(2, 2, 2)).toBe(2);
    expect(moveIndexAfter(0, 0, 1)).toBe(1);
  });
});

describe("lineRange", () => {
  it("给出该行的字符区间，不含行尾换行", () => {
    expect(lineRange(TEXT, 0)).toEqual({ start: 0, end: 3 });
    expect(lineRange(TEXT, 1)).toEqual({ start: 4, end: 7 });
    expect(lineRange(TEXT, 2)).toEqual({ start: 8, end: 11 });
  });

  it("行号越界钳制到首 / 末行", () => {
    expect(lineRange(TEXT, -3)).toEqual({ start: 0, end: 3 });
    expect(lineRange(TEXT, 99)).toEqual({ start: 8, end: 11 });
  });

  it("空行与末行都安全", () => {
    expect(lineRange("a\n\nb", 1)).toEqual({ start: 2, end: 2 });
    expect(lineRange("a\n", 1)).toEqual({ start: 2, end: 2 });
  });
});

describe("deleteLine", () => {
  it("删中间行：连行尾换行一起删，光标落到顶上来的那一行行首", () => {
    const { start, end, caret } = deleteLine(TEXT, 1);
    expect([start, end, caret]).toEqual([4, 8, 4]);
    expect(`${TEXT.slice(0, start)}${TEXT.slice(end)}`).toBe("第一行\n第三行");
  });

  it("删首行：光标落到新的首行行首", () => {
    const { start, end, caret } = deleteLine(TEXT, 0);
    expect([start, end, caret]).toEqual([0, 4, 0]);
    expect(`${TEXT.slice(0, start)}${TEXT.slice(end)}`).toBe("第二行\n第三行");
  });

  it("删末行：改吃行首换行，光标收到上一行行尾", () => {
    const { start, end, caret } = deleteLine(TEXT, 2);
    expect([start, end, caret]).toEqual([7, 11, 7]);
    expect(`${TEXT.slice(0, start)}${TEXT.slice(end)}`).toBe("第一行\n第二行");
  });

  it("删末尾空行：`a\\n` 里的那个空行也删得掉", () => {
    const { start, end, caret } = deleteLine("a\n", 1);
    expect([start, end, caret]).toEqual([1, 2, 1]);
    expect("a\n".slice(0, start) + "a\n".slice(end)).toBe("a");
  });

  it("只剩一行：退化为清空", () => {
    expect(deleteLine("abc", 0)).toEqual({ start: 0, end: 3, caret: 0 });
  });

  it("空文本：没有可删的区间", () => {
    expect(deleteLine("", 0)).toEqual({ start: 0, end: 0, caret: 0 });
  });
});
