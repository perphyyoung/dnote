import { describe, expect, it } from "vitest";
import {
  atLineBoundary,
  atLineStart,
  decodePayload,
  encodePayload,
  lineCount,
  lineIndexOf,
  marksAfterPaste,
} from "@/features/notes/clipboard";

const RED = "#f43f5e";
const BLUE = "#0ea5e9";
const BRIGHT = "#eab308";

describe("lineCount", () => {
  it("末尾换行只是分隔符，不多算一行", () => {
    expect(lineCount("")).toBe(0);
    expect(lineCount("甲")).toBe(1);
    expect(lineCount("甲\n")).toBe(1);
    expect(lineCount("甲\n乙")).toBe(2);
    expect(lineCount("甲\n乙\n")).toBe(2);
    expect(lineCount("\n")).toBe(1);
    expect(lineCount("\n\n")).toBe(2);
  });
});

describe("atLineStart / atLineBoundary / lineIndexOf", () => {
  const text = "甲\n乙\n丙";

  it("行首判定", () => {
    expect(atLineStart(text, 0)).toBe(true);
    expect(atLineStart(text, 2)).toBe(true);
    expect(atLineStart(text, 1)).toBe(false);
  });

  it("行边界判定：吃掉换行或到文末", () => {
    expect(atLineBoundary(text, 2)).toBe(true);
    expect(atLineBoundary(text, text.length)).toBe(true);
    expect(atLineBoundary(text, 1)).toBe(false);
  });

  it("偏移量换行号", () => {
    expect(lineIndexOf(text, 0)).toBe(0);
    expect(lineIndexOf(text, 1)).toBe(0);
    expect(lineIndexOf(text, 2)).toBe(1);
    expect(lineIndexOf(text, 4)).toBe(2);
  });
});

describe("encodePayload / decodePayload", () => {
  it("往返：颜色与星标都按行数保留空位", () => {
    const raw = encodePayload("甲\n乙", { colors: [RED, null], stars: [true, false] });
    expect(raw).not.toBeNull();
    expect(decodePayload(raw, "甲\n乙")).toEqual({
      colors: [RED, null],
      stars: [true, false],
    });
  });

  it("任一份数组与行数不符就不写载荷", () => {
    expect(encodePayload("甲\n乙", { colors: [RED], stars: [false, false] })).toBeNull();
    expect(encodePayload("甲\n乙", { colors: [RED, null], stars: [false] })).toBeNull();
    expect(encodePayload("", { colors: [], stars: [] })).toBeNull();
  });

  it("v1 载荷仍认：星标一律视为没有", () => {
    expect(decodePayload('{"v":1,"text":"甲\\n乙","colors":["#f43f5e",null]}', "甲\n乙")).toEqual({
      colors: [RED, null],
      stars: [false, false],
    });
  });

  it("文本变了、版本不对、颜色不在白名单、行数 / 星标不合法都拒绝", () => {
    const raw = encodePayload("甲\n乙", { colors: [RED, BLUE], stars: [false, true] });
    expect(raw).not.toBeNull();
    expect(decodePayload(raw, "甲\n丙")).toBeNull();
    expect(
      decodePayload(
        '{"v":3,"text":"甲\\n乙","colors":[null,null],"stars":[false,false]}',
        "甲\n乙",
      ),
    ).toBeNull();
    expect(decodePayload('{"v":1,"text":"甲","colors":["#ffffff"]}', "甲")).toBeNull();
    expect(decodePayload('{"v":1,"text":"甲\\n乙","colors":["#f43f5e"]}', "甲\n乙")).toBeNull();
    expect(
      decodePayload('{"v":2,"text":"甲\\n乙","colors":[null,null],"stars":[false]}', "甲\n乙"),
    ).toBeNull();
    expect(
      decodePayload(
        '{"v":2,"text":"甲\\n乙","colors":[null,null],"stars":[false,"true"]}',
        "甲\n乙",
      ),
    ).toBeNull();
    expect(decodePayload("不是 JSON", "甲")).toBeNull();
    expect(decodePayload(null, "甲")).toBeNull();
  });
});

describe("marksAfterPaste", () => {
  it("整行替换：只覆盖被替换的那几行，两份标记一起换", () => {
    const next = marksAfterPaste({
      oldText: "甲\n乙\n丙",
      newText: "甲\nX\n丙",
      selectionStart: 2,
      selectionEnd: 4,
      oldMarks: { colors: [RED, null, BLUE], stars: [false, true, false] },
      pasted: { colors: [null], stars: [true] },
    });
    expect(next).toEqual({
      colors: [RED, null, BLUE],
      stars: [false, true, false],
    });
  });

  it("行首插入：标记跟着插入的行走进来，下面各行下移", () => {
    const next = marksAfterPaste({
      oldText: "甲\n乙\n丙",
      newText: "X\n甲\n乙\n丙",
      selectionStart: 0,
      selectionEnd: 0,
      oldMarks: { colors: [null, RED, BLUE], stars: [false, true, false] },
      pasted: { colors: [RED], stars: [true] },
    });
    expect(next).toEqual({
      colors: [RED, null, RED, BLUE],
      stars: [true, false, true, false],
    });
  });

  it("粘贴多行：标记按顺序铺开", () => {
    const next = marksAfterPaste({
      oldText: "甲",
      newText: "X\nY",
      selectionStart: 0,
      selectionEnd: 1,
      oldMarks: { colors: [BRIGHT], stars: [true] },
      pasted: { colors: [RED, BLUE], stars: [false, true] },
    });
    expect(next).toEqual({
      colors: [RED, BLUE],
      stars: [false, true],
    });
  });

  it("行中开始 / 行中结束：拒绝套标记", () => {
    const base = {
      oldText: "甲\n乙\n丙",
      newText: "甲X\n乙\n丙",
      oldMarks: { colors: [RED, null, null], stars: [true, false, false] },
      pasted: { colors: [RED], stars: [true] },
    };
    expect(marksAfterPaste({ ...base, selectionStart: 1, selectionEnd: 1 })).toBeNull();
    expect(marksAfterPaste({ ...base, selectionStart: 0, selectionEnd: 1 })).toBeNull();
  });

  it("替换到文末：尾部标记被截掉", () => {
    const next = marksAfterPaste({
      oldText: "甲\n乙\n丙",
      newText: "甲\nX",
      selectionStart: 2,
      selectionEnd: 5,
      oldMarks: { colors: [RED, null, BLUE], stars: [false, true, true] },
      pasted: { colors: [BLUE], stars: [false] },
    });
    expect(next).toEqual({
      colors: [RED, BLUE],
      stars: [false, false],
    });
  });
});
