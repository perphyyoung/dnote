//! `lineColors.ts` 的色板校验：只有「无色 + 红 / 绿 / 蓝」四档有效。
import { describe, expect, it } from "vitest";
import { isLineColor, LINE_COLORS } from "./lineColors";

describe("LINE_COLORS", () => {
  it("只保留四档：无色 + 红 / 绿 / 蓝", () => {
    expect(LINE_COLORS.map((option) => option.label)).toEqual(["无色", "红", "绿", "蓝"]);
  });
});

describe("isLineColor", () => {
  it("当前色板的四档都认（含 null）", () => {
    for (const option of LINE_COLORS) {
      expect(isLineColor(option.value)).toBe(true);
    }
  });

  it("旧版十色 / 任意字符串 / 非字符串都不认", () => {
    expect(isLineColor("#8b5cf6")).toBe(false); // 旧色板里的紫
    expect(isLineColor("#ffffff")).toBe(false);
    expect(isLineColor("red")).toBe(false);
    expect(isLineColor(0)).toBe(false);
    expect(isLineColor(undefined)).toBe(false);
  });
});
