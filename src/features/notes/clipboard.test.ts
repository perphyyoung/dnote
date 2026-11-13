import { describe, expect, it } from "vitest";
import {
  atLineBoundary,
  atLineStart,
  colorsAfterPaste,
  decodePayload,
  encodePayload,
  lineCount,
  lineIndexOf,
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
  it("往返：颜色按行数保留 null", () => {
    const raw = encodePayload("甲\n乙", [RED, null]);
    expect(raw).not.toBeNull();
    expect(decodePayload(raw, "甲\n乙")).toEqual([RED, null]);
  });

  it("颜色数与行数不符就不写载荷", () => {
    expect(encodePayload("甲\n乙", [RED])).toBeNull();
    expect(encodePayload("", [])).toBeNull();
  });

  it("文本变了、版本不对、颜色不在白名单、行数不符都拒绝", () => {
    const raw = encodePayload("甲\n乙", [RED, BLUE]);
    expect(raw).not.toBeNull();
    expect(decodePayload(raw, "甲\n丙")).toBeNull();
    expect(decodePayload('{"v":2,"text":"甲\\n乙","colors":[null,null]}', "甲\n乙")).toBeNull();
    expect(decodePayload('{"v":1,"text":"甲","colors":["#ffffff"]}', "甲")).toBeNull();
    expect(decodePayload('{"v":1,"text":"甲\\n乙","colors":["#f43f5e"]}', "甲\n乙")).toBeNull();
    expect(decodePayload("不是 JSON", "甲")).toBeNull();
    expect(decodePayload(null, "甲")).toBeNull();
  });
});

describe("colorsAfterPaste", () => {
  it("整行替换：只覆盖被替换的那几行", () => {
    const next = colorsAfterPaste({
      oldText: "甲\n乙\n丙",
      newText: "甲\nX\n丙",
      selectionStart: 2,
      selectionEnd: 4,
      oldColors: [RED, null, BLUE],
      pasted: [null],
    });
    expect(next).toEqual([RED, null, BLUE]);
  });

  it("行首插入：颜色跟着插入的行走，下面各行下移", () => {
    const next = colorsAfterPaste({
      oldText: "甲\n乙\n丙",
      newText: "X\n甲\n乙\n丙",
      selectionStart: 0,
      selectionEnd: 0,
      oldColors: [null, RED, BLUE],
      pasted: [RED],
    });
    expect(next).toEqual([RED, null, RED, BLUE]);
  });

  it("粘贴多行：颜色按顺序铺开", () => {
    const next = colorsAfterPaste({
      oldText: "甲",
      newText: "X\nY",
      selectionStart: 0,
      selectionEnd: 1,
      oldColors: [BRIGHT],
      pasted: [RED, BLUE],
    });
    expect(next).toEqual([RED, BLUE]);
  });

  it("行中开始 / 行中结束：拒绝套色", () => {
    const base = {
      oldText: "甲\n乙\n丙",
      newText: "甲X\n乙\n丙",
      oldColors: [RED, null, null],
      pasted: [RED],
    };
    expect(colorsAfterPaste({ ...base, selectionStart: 1, selectionEnd: 1 })).toBeNull();
    expect(colorsAfterPaste({ ...base, selectionStart: 0, selectionEnd: 1 })).toBeNull();
  });

  it("替换到文末：尾部颜色被截掉", () => {
    const next = colorsAfterPaste({
      oldText: "甲\n乙\n丙",
      newText: "甲\nX",
      selectionStart: 2,
      selectionEnd: 5,
      oldColors: [RED, null, BLUE],
      pasted: [BLUE],
    });
    expect(next).toEqual([RED, BLUE]);
  });
});
