import { describe, expect, it } from "vitest";
import type { LineBox } from "@/features/notes/logic";
import {
  caretLine,
  caretOffset,
  collapseBlankLines,
  deleteLine,
  deleteLines,
  insertIndexAt,
  lineIndexAt,
  lineRange,
  moveBlock,
  moveIndexAfter,
  moveItem,
  moveLines,
  menuPosition,
  selectionLines,
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

describe("moveBlock", () => {
  const LIST = ["A", "B", "C", "D", "E"];

  it("整块下移：插到目标行之后，块内顺序不变", () => {
    expect(moveBlock(LIST, 1, 2, 2)).toEqual(["A", "D", "B", "C", "E"]);
  });

  it("整块上移：插到目标行之前", () => {
    expect(moveBlock(LIST, 2, 3, 0)).toEqual(["C", "D", "A", "B", "E"]);
  });

  it("单行与 moveItem 同口径（to 都是移除后的下标）", () => {
    expect(moveBlock(LIST, 1, 1, 2)).toEqual(moveItem(LIST, 1, 2));
    expect(moveBlock(LIST, 3, 3, 0)).toEqual(moveItem(LIST, 3, 0));
  });

  it("to 落在块首 = 没动（返回等值新数组，不修改入参）", () => {
    const source = [...LIST];
    const moved = moveBlock(source, 1, 2, 1);
    expect(moved).toEqual(LIST);
    expect(moved).not.toBe(source);
    expect(source).toEqual(LIST);
  });

  it("整篇一块与空列表安全", () => {
    expect(moveBlock(LIST, 0, 4, 0)).toEqual(LIST);
    expect(moveBlock([], 0, 0, 0)).toEqual([]);
  });

  it("to 越界时钳制到两端", () => {
    expect(moveBlock(LIST, 1, 2, 99)).toEqual(["A", "D", "E", "B", "C"]);
    expect(moveBlock(LIST, 1, 2, -5)).toEqual(["B", "C", "A", "D", "E"]);
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

  it("多行整块：指针落在块内（含块末行）得到的都是「没动」的插入位", () => {
    // 块为第 0–1 行：块内任意位置都应落在 [0, 2]（块首 .. 块末 + 1）
    for (const row of [0, 1]) {
      const insert = insertIndexAt(inRow(row), ROWS, 1);
      expect(insert).toBeGreaterThanOrEqual(0);
      expect(insert).toBeLessThanOrEqual(2);
    }
  });

  it("多行整块：块上 / 下相邻行分别插到它上面 / 下面", () => {
    // 块取第 1–2 行（末行 = 2）：上一行往「拖向块」算，插到它上面
    expect(insertIndexAt(inRow(0), ROWS, 2)).toBe(0);
    // 三行里块已到底，换四行验「块下一行往下拖 → 插到它下面」
    const four: LineBox[] = Array.from({ length: 4 }, (_, i) => ({ top: TOP + i * H, height: H }));
    expect(insertIndexAt(inRow(3), four, 2)).toBe(4);
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

describe("selectionLines", () => {
  it("没有选区（只有光标）时返回 null —— 调用方走单行分支", () => {
    expect(selectionLines(TEXT, 5, 5)).toBeNull();
    expect(selectionLines(TEXT, 0, 0)).toBeNull();
  });

  it("反向选区与正向选区给出同一个行范围", () => {
    expect(selectionLines(TEXT, 4, 11)).toEqual({ first: 1, last: 2 });
    expect(selectionLines(TEXT, 11, 4)).toEqual({ first: 1, last: 2 });
  });

  it("终点落在行首时那一行不算（浏览器选区是 [from, to)）", () => {
    expect(selectionLines(TEXT, 4, 8)).toEqual({ first: 1, last: 1 });
    expect(selectionLines(TEXT, 0, 4)).toEqual({ first: 0, last: 0 });
  });

  it("行内部分选区按整行算", () => {
    expect(selectionLines(TEXT, 5, 6)).toEqual({ first: 1, last: 1 }); // 都在第二行里
    expect(selectionLines(TEXT, 5, 9)).toEqual({ first: 1, last: 2 }); // 9 落在第三行行中
    expect(selectionLines(TEXT, 0, 11)).toEqual({ first: 0, last: 2 }); // 全选
  });
});

// 四行：验证「块后面还有行」与「块含末行」这两条分支不是同一回事
const TEXT4 = "第一行\n第二行\n第三行\n第四行";

describe("deleteLines", () => {
  it("块后面还有行：吃块尾那个换行，光标落到块首位置", () => {
    const { start, end, caret } = deleteLines(TEXT4, 1, 2);
    expect([start, end, caret]).toEqual([4, 12, 4]);
    expect(TEXT4.slice(0, start) + TEXT4.slice(end)).toBe("第一行\n第四行");
  });

  it("块含末行：末行没有行尾换行，改吃块首那个，光标收到上一行行尾", () => {
    const { start, end, caret } = deleteLines(TEXT, 1, 2);
    expect([start, end, caret]).toEqual([3, 11, 3]);
    expect(TEXT.slice(0, start) + TEXT.slice(end)).toBe("第一行");
  });

  it("删首两行：光标落到新的首行行首", () => {
    const { start, end, caret } = deleteLines(TEXT, 0, 1);
    expect([start, end, caret]).toEqual([0, 8, 0]);
    expect(TEXT.slice(0, start) + TEXT.slice(end)).toBe("第三行");
  });

  it("整篇都在块里：退化为清空", () => {
    expect(deleteLines(TEXT, 0, 2)).toEqual({ start: 0, end: 11, caret: 0 });
  });

  it("首尾反着给也认（选区可能是反向拖出来的）", () => {
    expect(deleteLines(TEXT, 2, 1)).toEqual(deleteLines(TEXT, 1, 2));
  });

  it("单行是它的退化：与 deleteLine 完全一致", () => {
    for (const index of [0, 1, 2]) {
      expect(deleteLines(TEXT, index, index)).toEqual(deleteLine(TEXT, index));
    }
  });
});

describe("moveLines", () => {
  const LIST = ["A", "B", "C", "D"];

  it("整块上移一行：与块前那一行交换", () => {
    expect(moveLines(LIST, 1, 2, -1)).toEqual(["B", "C", "A", "D"]);
  });

  it("整块下移一行：与块后那一行交换", () => {
    expect(moveLines(LIST, 1, 2, 1)).toEqual(["A", "D", "B", "C"]);
  });

  it("单行等价于 moveItem", () => {
    expect(moveLines(LIST, 0, 0, 1)).toEqual(moveItem(LIST, 0, 1));
    expect(moveLines(LIST, 3, 3, -1)).toEqual(moveItem(LIST, 3, 2));
  });

  it("块顶到首行还上移 / 底到末行还下移 → null（调用方据此不动）", () => {
    expect(moveLines(LIST, 0, 1, -1)).toBeNull();
    expect(moveLines(LIST, 2, 3, 1)).toBeNull();
    expect(moveLines(LIST, 0, 3, -1)).toBeNull(); // 整篇一块：两个方向都动不了
  });

  it("块内顺序不变，且不修改入参", () => {
    const source = ["A", "B", "C", "D"];
    const moved = moveLines(source, 1, 2, -1);
    expect(source).toEqual(["A", "B", "C", "D"]);
    expect(moved?.slice(0, 2)).toEqual(["B", "C"]);
  });

  it("空列表安全", () => {
    expect(moveLines([], 0, 0, 1)).toBeNull();
  });
});

describe("collapseBlankLines", () => {
  it("连续空行只留一个，留段内第一行原样", () => {
    expect(collapseBlankLines("第一行\n\n\n\n第二行", 0)?.text).toBe("第一行\n\n第二行");
  });

  it("返回旧行号 → 新行号的映射，供按行号存的旁路状态一起搬位", () => {
    // ["a","","","b","","c"] → ["a","","b","","c"]：被压掉的空行指向段内留下来的那一个
    expect(collapseBlankLines("a\n\n\nb\n\nc", 0)?.moved).toEqual([0, 1, 1, 2, 3, 4]);
  });

  it("纯空格 / 制表符行也算空行（缩进用的空白行不该被当成两段的分界）", () => {
    expect(collapseBlankLines("a\n  \n\t\n \nb", 0)?.text).toBe("a\n  \nb");
  });

  it("多段各压各的", () => {
    // 末尾那一串空行压完只剩一个空行 → 文本以单个 `\n` 收尾（= 最后一行是空行）
    expect(collapseBlankLines("a\n\n\nb\nc\n\n\n\n", 0)?.text).toBe("a\n\nb\nc\n");
  });

  it("文首 / 文末的连续空行同样各压成一个", () => {
    expect(collapseBlankLines("\n\na", 0)?.text).toBe("\na");
    expect(collapseBlankLines("a\n\n\n", 0)?.text).toBe("a\n");
  });

  it("全篇都是空行 → 压成一个空行（即空文档，与「永远至少有一行」一致）", () => {
    expect(collapseBlankLines("\n\n\n", 0)?.text).toBe("");
    expect(collapseBlankLines(" \n\t\n ", 0)?.text).toBe(" ");
  });

  it("没有可压的就返回 null（调用方据此不写盘、不进撤销栈）", () => {
    expect(collapseBlankLines("a\nb", 0)).toBeNull();
    expect(collapseBlankLines("a\n\nb", 0)).toBeNull(); // 只有一个空行
    expect(collapseBlankLines("", 0)).toBeNull(); // 空文档
    expect(collapseBlankLines("a\n  \nb", 0)).toBeNull(); // 单个空白行
  });

  it("光标按内容锚定：所在行留着 → 落到新行号，列不变", () => {
    // "a\n\n\n\nbc" 共 7 个字符：原光标在末行第 1 列（'c'，offset 6）
    const result = collapseBlankLines("a\n\n\n\nbc", 6);
    expect(result?.text).toBe("a\n\nbc");
    // "a\n\nbc" 的第 2 行第 1 列 = "a\n\n" 之后 + 1 = 4（'c' 自己那一格）
    expect(result?.caret).toBe(4);
  });

  it("光标落在被压掉的那些空行上 → 落到这一段的那个空行（列随之归 0）", () => {
    // "a\n\n\n\nb" 共 6 个字符：第 3 个空行从 offset 4 开始
    const result = collapseBlankLines("a\n\n\n\nb", 4);
    expect(result?.text).toBe("a\n\nb");
    expect(result?.caret).toBe(2); // 留下来的那个空行行首
  });

  it("末尾连续空行里的光标：落到保留下来的那个空行上", () => {
    const result = collapseBlankLines("a\n\n\n", 4); // 原光标在最后一个空行
    expect(result?.text).toBe("a\n");
    expect(result?.caret).toBe(2); // "a\n" 末尾那个空行行首
  });
});

describe("menuPosition", () => {
  // 视口 800×600，菜单 120×80
  const W = 800;
  const H = 600;
  const MW = 120;
  const MH = 80;

  it("装得下就贴指针", () => {
    expect(menuPosition(100, 100, MW, MH, W, H)).toEqual({ x: 100, y: 100 });
  });

  it("右边装不下就朝指针那一侧翻转（无边框窗口溢出即看不见）", () => {
    expect(menuPosition(750, 100, MW, MH, W, H)).toEqual({ x: 630, y: 100 });
  });

  it("下边装不下同样翻转", () => {
    expect(menuPosition(100, 560, MW, MH, W, H)).toEqual({ x: 100, y: 480 });
  });

  it("右下角两个方向一起翻", () => {
    expect(menuPosition(790, 590, MW, MH, W, H)).toEqual({ x: 670, y: 510 });
  });

  it("正好贴着边界时不翻", () => {
    expect(menuPosition(W - MW, H - MH, MW, MH, W, H)).toEqual({ x: W - MW, y: H - MH });
  });

  it("菜单比视口还大时钳到 0（别整块跑到窗口外）", () => {
    expect(menuPosition(10, 10, 900, 700, W, H)).toEqual({ x: 0, y: 0 });
  });
});
