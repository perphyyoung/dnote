//! `lineColors.ts` 的纯逻辑：行号变化时颜色怎么搬。
import { describe, expect, it } from "vitest";
import { commonPrefix, remapColors, shiftColors, spliceColors } from "./lineColors";

const RED = "#f43f5e";
const BLUE = "#0ea5e9";

describe("remapColors", () => {
  it("普通行按映射跟随：「乙」从 index3 挪到 index2", () => {
    // ["甲","","","乙","丙"] → ["甲","","乙","丙"]，moved = [0,1,1,2,3]
    expect(remapColors([null, null, null, BLUE, RED], [0, 1, 1, 2, 3], 4)).toEqual([
      null,
      null,
      BLUE,
      RED,
    ]);
  });

  it("被压掉的空行颜色归到留下来的那个空行（先到先得，留段内第一行）", () => {
    expect(remapColors([null, RED, BLUE, null], [0, 1, 1, 2], 3)).toEqual([null, RED, null]);
    // 第一行空行无色时，被压掉那行的颜色顶上，仍不覆盖后面的行
    expect(remapColors([null, null, BLUE, RED], [0, 1, 1, 2], 3)).toEqual([null, BLUE, RED]);
  });
});

describe("spliceColors", () => {
  it("删掉中间一行：后面的颜色整体前移，长度减一", () => {
    expect(spliceColors([RED, BLUE, null], 1, 1)).toEqual([RED, null]);
  });

  it("删掉多行 / 越界都安全", () => {
    expect(spliceColors([RED, BLUE, BLUE], 0, 2)).toEqual([]);
    expect(spliceColors([RED], 5, 9)).toEqual([RED]);
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

describe("shiftColors", () => {
  it("行首回车：新空行无色，下方红/蓝各下移一行（正是复现过的错行场景）", () => {
    expect(shiftColors(["甲", "乙", "丙"], ["甲", "", "乙", "丙"], [null, RED, BLUE])).toEqual([
      null,
      null,
      RED,
      BLUE,
    ]);
  });

  it("行尾回车：新行紧跟在原行之后、没有颜色", () => {
    expect(shiftColors(["甲", "乙"], ["甲", "", "乙"], [RED, BLUE])).toEqual([RED, null, BLUE]);
  });

  it("粘贴多行：新增几行就补几个 null，其余整体后移", () => {
    expect(shiftColors(["甲", "乙"], ["甲", "", "", "乙"], [RED, BLUE])).toEqual([
      RED,
      null,
      null,
      BLUE,
    ]);
  });

  it("退格并行：颜色跟着行数一起少，长度仍等于新行数", () => {
    expect(shiftColors(["甲", "乙", "丙"], ["甲乙", "丙"], [null, RED, BLUE])).toEqual([RED, BLUE]);
  });

  it("撤销把被删的行恢复：新行位置补 null，其余后移（颜色值由快照恢复）", () => {
    expect(shiftColors(["甲", "丙"], ["甲", "乙", "丙"], [null, BLUE])).toEqual([null, null, BLUE]);
  });

  it("行数没变（改错字 / 跨行替换）：颜色原样返回", () => {
    expect(shiftColors(["甲", "乙"], ["甲", "乙丙"], [null, RED])).toEqual([null, RED]);
  });
});
