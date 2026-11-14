//! `lineMarks.ts` 的纯逻辑：行号变化时颜色 / 星标怎么搬（两者共用同一套函数）。
import { describe, expect, it } from "vitest";
import { commonPrefix, remapMarks, shiftMarks, spliceMarks } from "./lineMarks";

const RED = "#f43f5e";
const BLUE = "#2563eb";

describe("remapMarks", () => {
  it("普通行按映射跟随：「乙」从 index3 挪到 index2", () => {
    // ["甲","","","乙","丙"] → ["甲","","乙","丙"]，moved = [0,1,1,2,3]
    expect(remapMarks([null, null, null, BLUE, RED], [0, 1, 1, 2, 3], 4, null)).toEqual([
      null,
      null,
      BLUE,
      RED,
    ]);
  });

  it("被压掉的空行颜色归到留下来的那个空行（先到先得，留段内第一行）", () => {
    expect(remapMarks([null, RED, BLUE, null], [0, 1, 1, 2], 3, null)).toEqual([null, RED, null]);
    // 第一行空行无色时，被压掉那行的颜色顶上，仍不覆盖后面的行
    expect(remapMarks([null, null, BLUE, RED], [0, 1, 1, 2], 3, null)).toEqual([null, BLUE, RED]);
  });

  it("星标走同一套映射：被压掉的行让位给段内第一行", () => {
    expect(remapMarks([false, true, false, true], [0, 1, 1, 2], 3, false)).toEqual([
      false,
      true,
      true,
    ]);
  });
});

describe("spliceMarks", () => {
  it("删掉中间一行：后面的标记整体前移，长度减一", () => {
    expect(spliceMarks([RED, BLUE, null], 1, 1)).toEqual([RED, null]);
    expect(spliceMarks([false, true, true], 1, 1)).toEqual([false, true]);
  });

  it("删掉多行 / 越界都安全", () => {
    expect(spliceMarks([RED, BLUE, BLUE], 0, 2)).toEqual([]);
    expect(spliceMarks([RED], 5, 9)).toEqual([RED]);
  });
});

describe("commonPrefix", () => {
  it("行首回车：新行插在原行之前，前缀只到上一行", () => {
    expect(commonPrefix(["甲", "乙", "丙"], ["甲", "", "乙", "丙"])).toBe(1);
  });

  it("整篇替换到中部时前缀停在第一个不同的行", () => {
    expect(commonPrefix(["甲", "乙", "丙"], ["甲", "乙丙", "丁"])).toBe(1);
  });
});

describe("shiftMarks", () => {
  it("行首回车：新空行无颜色，下方红/蓝各下移一行（正是复现过的错行场景）", () => {
    expect(shiftMarks(["甲", "乙", "丙"], ["甲", "", "乙", "丙"], [null, RED, BLUE], null)).toEqual(
      [null, null, RED, BLUE],
    );
  });

  it("行尾回车：新行紧跟在原行之后、没有颜色", () => {
    expect(shiftMarks(["甲", "乙"], ["甲", "", "乙"], [RED, BLUE], null)).toEqual([
      RED,
      null,
      BLUE,
    ]);
  });

  it("粘贴多行：新增几行就补几个空位，其余整体后移", () => {
    expect(shiftMarks(["甲", "乙"], ["甲", "", "", "乙"], [RED, BLUE], null)).toEqual([
      RED,
      null,
      null,
      BLUE,
    ]);
  });

  it("退格并行：颜色跟着行数一起少，长度仍等于新行数", () => {
    expect(shiftMarks(["甲", "乙", "丙"], ["甲乙", "丙"], [null, RED, BLUE], null)).toEqual([
      RED,
      BLUE,
    ]);
  });

  it("撤销把被删的行恢复：新行位置补空位，其余后移（颜色值由快照恢复）", () => {
    expect(shiftMarks(["甲", "丙"], ["甲", "乙", "丙"], [null, BLUE], null)).toEqual([
      null,
      null,
      BLUE,
    ]);
  });

  it("行数没变（改错字 / 跨行替换）：标记原样返回", () => {
    expect(shiftMarks(["甲", "乙"], ["甲", "乙丙"], [null, RED], null)).toEqual([null, RED]);
    expect(shiftMarks(["甲", "乙"], ["甲", "乙丙"], [false, true], false)).toEqual([false, true]);
  });

  it("星标走同一套平移：行首回车后下方星标各下移一行", () => {
    expect(shiftMarks(["甲", "乙"], ["甲", "", "乙"], [true, false], false)).toEqual([
      true,
      false,
      false,
    ]);
  });
});
